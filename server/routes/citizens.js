import { Router } from 'express';
import { db, parseJson } from '../db.js';
import { requireRole, requireJudge, canJudge } from '../auth.js';
import { blanchirRapports } from '../justice.js';
import { fail, pick, str, intParam, optionalId, insertRow, updateRow, getOr404, listLimit, logAction, cleanPhotos } from '../util.js';

const citizenName = c => [c.prenom, c.nom].filter(Boolean).join(' ');

const FIELDS = ['nom', 'prenom', 'date_naissance', 'id_unique', 'empreinte', 'telephone', 'photo_url', 'notes', 'photos'];

export function cleanCitizen(body, keys = FIELDS) {
  const fields = pick(body, keys);
  for (const k of Object.keys(fields)) fields[k] = k === 'photos' ? JSON.stringify(cleanPhotos(fields[k])) : str(fields[k]);
  if ('id_unique' in fields && !fields.id_unique) fields.id_unique = null;
  return fields;
}

// Met à jour (champs non vides) ou crée la fiche citoyen d'une personne saisie
// dans un document (suspect d'un rapport, plaignant ou mis en cause d'une plainte)
export function upsertCitizen(person, keys) {
  const fields = cleanCitizen(person, keys);
  if (!fields.nom) return { citizen_id: null, snapshot: fields };
  const id = optionalId(person.id);
  if (id) {
    updateRow('citizens', id, Object.fromEntries(Object.entries(fields).filter(([, v]) => v)));
    return { citizen_id: id, snapshot: { ...fields, id } };
  }
  const newId = insertRow('citizens', fields);
  return { citizen_id: newId, snapshot: { ...fields, id: newId } };
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
         OR IFNULL(c.id_unique, '') LIKE :q OR c.telephone LIKE :q
    )
    WHERE :casier = 0 OR nb_arrestations > 0
    ORDER BY ${casier ? 'derniere_arrestation DESC,' : ''} nom, prenom
    LIMIT :limit`).all({ judge: canJudge(req.user) ? 1 : 0, q, casier, limit: listLimit(req) }));
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
  updateRow('citizens', id, fields);
  logAction(req.user, 'Fiche citoyen modifiée', 'citizen', id, citizenName(getOr404('SELECT nom, prenom FROM citizens WHERE id = ?', id)));
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

r.delete('/:id', requireRole('superviseur'), (req, res) => {
  const c = getOr404('SELECT id, nom, prenom FROM citizens WHERE id = ?', intParam(req.params.id), 'Citoyen introuvable');
  db.prepare('DELETE FROM citizens WHERE id = ?').run(c.id);
  logAction(req.user, 'Fiche citoyen supprimée', 'citizen', c.id, citizenName(c), 'Ses mandats et BOLO sont supprimés avec elle');
  res.json({ ok: true });
});

export default r;
