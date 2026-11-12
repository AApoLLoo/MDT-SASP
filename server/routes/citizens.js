import { Router } from 'express';
import { db, parseJson, transaction } from '../db.js';
import { KINDS, DIVISION_KINDS } from '../../public/mdt/js/service-kinds.js';
import { requireRole, requireJudge, canJudge } from '../auth.js';
import { blanchirRapports } from '../justice.js';
import { fail, pick, str, intParam, optionalId, insertRow, updateRow, getOr404, listLimit, logAction, cleanPhotos } from '../util.js';

const citizenName = c => [c.prenom, c.nom].filter(Boolean).join(' ');

const FIELDS = ['nom', 'prenom', 'date_naissance', 'id_unique', 'empreinte', 'telephone', 'photo_url', 'notes', 'photos', 'alias', 'signalement', 'affiliation'];

export function cleanCitizen(body, keys = FIELDS) {
  const fields = pick(body, keys);
  for (const k of Object.keys(fields)) fields[k] = k === 'photos' ? JSON.stringify(cleanPhotos(fields[k])) : str(fields[k]);
  if ('id_unique' in fields && !fields.id_unique) fields.id_unique = null;
  return fields;
}

const CHANGE_LABELS = {
  nom: 'Nom', prenom: 'Prénom', date_naissance: 'Naissance', id_unique: 'N° sécu', empreinte: 'Empreinte', telephone: 'Téléphone',
  alias: 'Alias', affiliation: 'Affiliation',
};
const BULKY = { notes: 'Notes modifiées', photos: 'Photos modifiées', photo_url: 'Photo modifiée', signalement: 'Signalement modifié' };
const short = v => {
  const s = str(v) || '—';
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
};

// Champs qui changent réellement, pour le journal : « N° sécu : 123 → 456 · Notes modifiées »
export function citizenChanges(before, fields) {
  return Object.entries(fields)
    .filter(([k, v]) => str(before[k]) !== str(v))
    .map(([k, v]) => BULKY[k] ?? `${CHANGE_LABELS[k] ?? k} : ${short(before[k])} → ${short(v)}`)
    .join(' · ');
}

// Met à jour (champs non vides) ou crée la fiche citoyen d'une personne saisie
// dans un document (suspect d'un rapport, plaignant ou mis en cause d'une plainte) ;
// une fiche existante modifiée ainsi est journalisée au nom de `user`, avec le document d'origine
export function upsertCitizen(person, keys, user, source = '') {
  const fields = cleanCitizen(person, keys);
  if (!fields.nom) return { citizen_id: null, snapshot: fields };
  const id = optionalId(person.id);
  if (id) {
    const before = getOr404('SELECT * FROM citizens WHERE id = ?', id, 'Citoyen introuvable');
    const update = Object.fromEntries(Object.entries(fields).filter(([, v]) => v));
    updateRow('citizens', id, update);
    const changes = citizenChanges(before, update);
    if (changes) logAction(user, 'Fiche citoyen modifiée', 'citizen', id, citizenName({ ...before, ...update }), [source, changes].filter(Boolean).join(' · '));
    return { citizen_id: id, snapshot: { ...fields, id } };
  }
  const newId = insertRow('citizens', fields);
  return { citizen_id: newId, snapshot: { ...fields, id: newId } };
}

// La photo d'identité d'une fiche est celle de la carte d'identité : reprise de chaque rapport qui en joint une
export function useIdentityPhoto(user, citizenId, url, source) {
  if (!citizenId || !url) return;
  const before = db.prepare('SELECT nom, prenom, photo_url FROM citizens WHERE id = ?').get(citizenId);
  if (!before || before.photo_url === url) return;
  updateRow('citizens', citizenId, { photo_url: url });
  logAction(user, 'Fiche citoyen modifiée', 'citizen', citizenId, citizenName(before), `${source} · Photo d'identité remplacée par la carte d'identité`);
}

// Fiche créée en dressant une amende : nom, date de naissance et photo de la carte d'identité obligatoires
export function createFromId(user, person, source) {
  const fields = cleanCitizen(person, ['nom', 'prenom', 'date_naissance', 'photo_url']);
  if (!fields.nom) fail(400, 'Le nom du contrevenant est obligatoire');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date_naissance ?? '')) fail(400, 'La date de naissance du contrevenant est obligatoire');
  if (!cleanPhotos({ photo: fields.photo_url }).photo) fail(400, "La photo de la carte d'identité est obligatoire");
  const id = insertRow('citizens', fields);
  logAction(user, 'Fiche citoyen créée', 'citizen', id, citizenName(fields), source);
  return { id, ...fields };
}

const r = Router();

r.get('/', (req, res) => {
  const q = `%${str(req.query.q)}%`;
  // casier=1 : uniquement les citoyens ayant au moins une arrestation finalisée
  const casier = req.query.casier === '1' ? 1 : 0;
  res.json(db.prepare(`
    SELECT * FROM (
      SELECT c.*,
        (SELECT COUNT(*) FROM warrants w WHERE w.citizen_id = c.id AND w.statut = 'actif') AS mandats_actifs,
        (SELECT COUNT(*) FROM arrest_reports a WHERE a.citizen_id = c.id AND a.statut = 'finalise' AND (:judge OR a.blanchi_at IS NULL)) AS nb_arrestations,
        (SELECT MAX(a.date_faits) FROM arrest_reports a WHERE a.citizen_id = c.id AND a.statut = 'finalise' AND (:judge OR a.blanchi_at IS NULL)) AS derniere_arrestation
      FROM citizens c
      WHERE c.nom || ' ' || c.prenom LIKE :q OR c.prenom || ' ' || c.nom LIKE :q
         OR IFNULL(c.id_unique, '') LIKE :q OR c.telephone LIKE :q OR c.alias LIKE :q OR c.affiliation LIKE :q
    )
    WHERE :casier = 0 OR nb_arrestations > 0
    ORDER BY ${casier ? 'derniere_arrestation DESC,' : ''} nom, prenom
    LIMIT :limit`).all({ judge: canJudge(req.user) ? 1 : 0, q, casier, limit: listLimit(req) }));
});

// Groupes déjà saisis, proposés à la saisie pour garder une orthographe unique
r.get('/affiliations', (req, res) => {
  res.json(db.prepare(`SELECT affiliation AS nom, COUNT(*) AS membres FROM citizens WHERE affiliation <> '' GROUP BY affiliation COLLATE NOCASE ORDER BY affiliation`).all());
});

r.get('/:id', (req, res) => {
  const id = intParam(req.params.id);
  const citizen = getOr404('SELECT * FROM citizens WHERE id = ?', id, 'Citoyen introuvable');
  citizen.photos = parseJson(citizen.photos, {});
  citizen.warrants = db.prepare(`
    SELECT w.*, u.matricule AS auteur_matricule FROM warrants w LEFT JOIN users u ON u.id = w.created_by
    WHERE w.citizen_id = ? ORDER BY w.statut = 'clos', w.created_at DESC`).all(id);
  // Condamnations blanchies : hors du casier vu par la police, visibles de la justice
  citizen.reports = db.prepare(`
    SELECT a.id, a.numero, a.statut, a.date_faits, a.calc_result, a.finalized_at, a.blanchi_at, a.blanchi_motif, u.matricule AS redacteur_matricule
    FROM arrest_reports a JOIN users u ON u.id = a.redacteur_id
    WHERE a.citizen_id = ? AND (? OR a.blanchi_at IS NULL) ORDER BY a.date_faits DESC, a.id DESC`).all(id, canJudge(req.user) ? 1 : 0)
    .map(({ calc_result, ...a }) => {
      const result = parseJson(calc_result, null);
      return { ...a, charges: result?.lignes.map(l => l.infraction) ?? [], amende: result?.amende ?? 0, gav_minutes: result?.gavMinutes ?? 0 };
    });
  citizen.complaints = db.prepare(`
    SELECT id, numero, statut, date_depot, date_faits, qualifications,
      CASE WHEN plaignant_id = ? THEN 'plaignant' ELSE 'mis_en_cause' END AS role
    FROM complaints WHERE plaignant_id = ? OR mis_en_cause_id = ?
    ORDER BY date_depot DESC, id DESC`).all(id, id, id)
    .map(p => ({ ...p, qualifications: parseJson(p.qualifications, []).map(q => q.infraction) }));
  citizen.tickets = db.prepare(`
    SELECT t.id, t.numero, t.date_faits, t.plaque, t.lieu, t.charges, t.montant, t.statut, u.matricule AS agent_matricule
    FROM tickets t JOIN users u ON u.id = t.agent_id WHERE t.citizen_id = ? ORDER BY t.id DESC`).all(id)
    .map(t => ({ ...t, charges: parseJson(t.charges, []) }));
  res.json(citizen);
});

r.post('/', (req, res) => {
  const fields = cleanCitizen(req.body);
  if (!fields.nom) fail(400, 'Le nom est obligatoire');
  const id = insertRow('citizens', fields);
  logAction(req.user, 'Fiche citoyen créée', 'citizen', id, citizenName(fields));
  res.status(201).json({ id });
});

r.put('/:id', (req, res) => {
  const fields = cleanCitizen(req.body);
  if ('nom' in fields && !fields.nom) fail(400, 'Le nom est obligatoire');
  const id = intParam(req.params.id);
  const before = getOr404('SELECT * FROM citizens WHERE id = ?', id, 'Citoyen introuvable');
  updateRow('citizens', id, fields);
  logAction(req.user, 'Fiche citoyen modifiée', 'citizen', id, citizenName({ ...before, ...fields }), citizenChanges(before, fields));
  res.json({ ok: true });
});

// Blanchit tout le casier : chaque condamnation finalisée non blanchie
r.post('/:id/blanchir', requireJudge, (req, res) => {
  const id = intParam(req.params.id);
  const citizen = getOr404('SELECT nom, prenom FROM citizens WHERE id = ?', id, 'Citoyen introuvable');
  const reports = db.prepare(`SELECT id, numero FROM arrest_reports WHERE citizen_id = ? AND statut = 'finalise' AND blanchi_at IS NULL`).all(id);
  const count = blanchirRapports(req.user, reports, req.body?.motif);
  logAction(req.user, 'Casier blanchi', 'citizen', id, [citizen.prenom, citizen.nom].filter(Boolean).join(' '), `${count} condamnation(s) · ${str(req.body?.motif)}`);
  res.json({ count });
});

// Colonnes « fiche citoyen » des dossiers de service (ex. personnes d'une enquête du BCI) : [[type, champ, colonne]]
const CITIZEN_CELLS = Object.entries({ ...KINDS, ...DIVISION_KINDS }).flatMap(([kind, k]) => k.fields
  .filter(f => f.type === 'rows').flatMap(f => f.columns.filter(c => c.citizen).map(c => [kind, f.key, c.key])));

// Fusion d'un doublon : la fiche :id garde son identité, complétée par celle du doublon (champs vides, photos, notes) ;
// rapports, plaintes, mandats, amendes et enquêtes du doublon passent sur :id, puis le doublon est supprimé
r.post('/:id/merge', requireRole('superviseur'), (req, res) => {
  const id = intParam(req.params.id);
  const sourceId = intParam(req.body?.source_id);
  if (id === sourceId) fail(400, 'Choisissez une autre fiche que celle-ci');
  const target = getOr404('SELECT * FROM citizens WHERE id = ?', id, 'Citoyen introuvable');
  const source = getOr404('SELECT * FROM citizens WHERE id = ?', sourceId, 'Fiche à fusionner introuvable');

  // Champs vides de la fiche gardée : repris du doublon ; notes et signalement présents des deux côtés : mis bout à bout
  const fields = {};
  for (const k of ['prenom', 'date_naissance', 'id_unique', 'empreinte', 'telephone', 'photo_url', 'alias', 'affiliation', 'notes', 'signalement']) {
    const mine = str(target[k]);
    const theirs = str(source[k]);
    if (!theirs || mine === theirs) continue;
    if (!mine) fields[k] = source[k];
    else if (k === 'notes' || k === 'signalement') fields[k] = `${target[k]}\n\n— Repris de la fiche fusionnée ${citizenName(source)} —\n${source[k]}`;
  }
  // Photos du doublon ajoutées sur des emplacements libres « photo_N » (20 au plus, sans doublon d'adresse)
  const photos = parseJson(target.photos, {});
  let n = 1;
  for (const url of Object.values(parseJson(source.photos, {}))) {
    if (Object.values(photos).includes(url)) continue;
    while (photos[`photo_${n}`]) n++;
    if (n > 20) break;
    photos[`photo_${n}`] = url;
  }
  fields.photos = JSON.stringify(photos);

  const counts = transaction(() => {
    // Le n° sécu est unique : libéré sur le doublon avant d'être repris
    db.prepare('UPDATE citizens SET id_unique = NULL WHERE id = ?').run(sourceId);
    updateRow('citizens', id, fields);
    const move = (sql, ...params) => db.prepare(sql).run(...params).changes;
    const c = {
      rapports: move(`UPDATE arrest_reports SET citizen_id = ?, suspect = json_set(suspect, '$.id', ?) WHERE citizen_id = ?`, id, id, sourceId),
      plaintes: move(`UPDATE complaints SET plaignant_id = ?, plaignant = json_set(plaignant, '$.id', ?) WHERE plaignant_id = ?`, id, id, sourceId)
        + move(`UPDATE complaints SET mis_en_cause_id = ?, mis_en_cause = json_set(mis_en_cause, '$.id', ?) WHERE mis_en_cause_id = ?`, id, id, sourceId),
      mandats: move('UPDATE warrants SET citizen_id = ? WHERE citizen_id = ?', id, sourceId),
      amendes: move('UPDATE tickets SET citizen_id = ? WHERE citizen_id = ?', id, sourceId),
      enquetes: 0,
    };
    const kinds = [...new Set(CITIZEN_CELLS.map(([kind]) => kind))];
    for (const rec of db.prepare('SELECT id, kind, data FROM service_records WHERE kind IN (SELECT value FROM json_each(?))').all(JSON.stringify(kinds))) {
      const data = parseJson(rec.data, {});
      let changed = false;
      for (const [kind, field, col] of CITIZEN_CELLS.filter(([kind]) => kind === rec.kind)) {
        for (const row of data[field] ?? []) {
          if (row[col] === String(sourceId)) {
            row[col] = String(id);
            changed = true;
          }
        }
      }
      if (changed) {
        db.prepare('UPDATE service_records SET data = ? WHERE id = ?').run(JSON.stringify(data), rec.id);
        c.enquetes++;
      }
    }
    db.prepare('DELETE FROM citizens WHERE id = ?').run(sourceId);
    return c;
  });
  const moved = Object.entries(counts).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ');
  logAction(req.user, 'Fiches citoyens fusionnées', 'citizen', id, citizenName({ ...target, ...fields }),
    `Doublon absorbé : ${citizenName(source)} (fiche n° ${sourceId}${source.id_unique ? `, ID ${source.id_unique}` : ''})${moved ? ` · repris : ${moved}` : ''}`);
  res.json({ ok: true, ...counts });
});

r.delete('/:id', requireRole('superviseur'), (req, res) => {
  const c = getOr404('SELECT id, nom, prenom FROM citizens WHERE id = ?', intParam(req.params.id), 'Citoyen introuvable');
  db.prepare('DELETE FROM citizens WHERE id = ?').run(c.id);
  logAction(req.user, 'Fiche citoyen supprimée', 'citizen', c.id, citizenName(c), 'Ses mandats et BOLO sont supprimés avec elle');
  res.json({ ok: true });
});

export default r;
