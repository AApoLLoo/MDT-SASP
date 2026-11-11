import { Router } from 'express';
import { db, parseJson, transaction } from '../db.js';
import { requireRole, requireJudge } from '../auth.js';
import { cleanAvocatIds } from '../justice.js';
import { fail, str, intParam, insertRow, updateRow, nextNumero, localDate, cleanPhotos, listLimit, logAction } from '../util.js';
import { upsertCitizen } from './citizens.js';
import { createReport } from './reports.js';

const fullName = p => [p.prenom, p.nom].filter(Boolean).join(' ');

const STATUT_LABELS = { ouverte: 'Ouverte', en_cours: 'Enquête en cours', classee: 'Classée sans suite', resolue: 'Résolue' };
const STATUTS = Object.keys(STATUT_LABELS);
const CLOSED = ['classee', 'resolue'];
const PERSON_FIELDS = ['nom', 'prenom', 'date_naissance', 'id_unique', 'telephone'];
const TEXT_FIELDS = ['date_depot', 'date_faits', 'lieu_faits', 'recit', 'prejudice', 'temoins', 'suivi'];
const JSON_DEFAULTS = { plaignant: {}, mis_en_cause: {}, qualifications: [], photos: {}, avocat_ids: [] };
// Date de clôture posée au passage à « classée » ou « résolue », effacée à la réouverture
const closedAt = statut => (CLOSED.includes(statut) ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null);

const codeStmt = db.prepare('SELECT id, infraction, categorie FROM penal_code WHERE id = ?');
const personSql = col => `TRIM(COALESCE(json_extract(${col}, '$.prenom'), '') || ' ' || COALESCE(json_extract(${col}, '$.nom'), ''))`;

function load(id) {
  const c = db.prepare(`
    SELECT p.*, u.matricule AS agent_matricule, u.nom AS agent_nom, u.prenom AS agent_prenom, u.grade AS agent_grade,
      a.numero AS report_numero, a.statut AS report_statut
    FROM complaints p JOIN users u ON u.id = p.created_by LEFT JOIN arrest_reports a ON a.id = p.report_id
    WHERE p.id = ?`).get(id);
  if (!c) fail(404, 'Plainte introuvable');
  for (const [k, def] of Object.entries(JSON_DEFAULTS)) c[k] = parseJson(c[k], def);
  c.avocats = c.avocat_ids.map(aid => db.prepare('SELECT id, matricule, nom, prenom FROM users WHERE id = ?').get(aid)).filter(Boolean);
  return c;
}

// Champs simples du corps de requête → colonnes
function fieldsFrom(b) {
  const f = {};
  for (const k of TEXT_FIELDS) if (b[k] !== undefined) f[k] = str(b[k]);
  if (b.statut !== undefined) {
    if (!STATUTS.includes(b.statut)) fail(400, 'Statut invalide');
    f.statut = b.statut;
  }
  if (b.qualifications !== undefined) {
    const codes = (Array.isArray(b.qualifications) ? b.qualifications : []).map(q => codeStmt.get(Number(q?.code_id))).filter(Boolean);
    f.qualifications = JSON.stringify([...new Map(codes.map(c => [c.id, { code_id: c.id, infraction: c.infraction, categorie: c.categorie }])).values()].slice(0, 20));
  }
  if (b.photos !== undefined) f.photos = JSON.stringify(cleanPhotos(b.photos));
  if (b.avocat_ids !== undefined) f.avocat_ids = cleanAvocatIds(b.avocat_ids);
  return f;
}

// Plaignant et mis en cause : fiches citoyens créées ou mises à jour au passage
function applyPersons(b, f) {
  if (b.plaignant !== undefined) {
    const { citizen_id, snapshot } = upsertCitizen(b.plaignant ?? {}, PERSON_FIELDS);
    if (!snapshot.nom) fail(400, 'Le nom du plaignant est obligatoire');
    f.plaignant_id = citizen_id;
    f.plaignant = JSON.stringify(snapshot);
  }
  if (b.mis_en_cause !== undefined) {
    const m = b.mis_en_cause ?? {};
    const description = str(m.description);
    if (m.inconnu) {
      f.mis_en_cause_id = null;
      f.mis_en_cause = JSON.stringify({ inconnu: true, description });
    } else {
      const { citizen_id, snapshot } = upsertCitizen(m, PERSON_FIELDS);
      f.mis_en_cause_id = citizen_id;
      f.mis_en_cause = JSON.stringify({ ...snapshot, description });
    }
  }
}

const r = Router();

r.get('/', (req, res) => {
  const q = `%${str(req.query.q)}%`;
  const where = [`(p.numero LIKE ? OR ${personSql('p.plaignant')} LIKE ? OR ${personSql('p.mis_en_cause')} LIKE ? OR p.lieu_faits LIKE ?)`];
  const params = [q, q, q, q];
  if (req.query.statut === 'actives') where.push(`p.statut IN ('ouverte', 'en_cours')`);
  else if (STATUTS.includes(req.query.statut)) { where.push('p.statut = ?'); params.push(req.query.statut); }
  res.json(db.prepare(`
    SELECT p.id, p.numero, p.statut, p.date_depot, p.date_faits, p.lieu_faits, p.qualifications, p.updated_at, p.report_id,
      ${personSql('p.plaignant')} AS plaignant_nom, ${personSql('p.mis_en_cause')} AS mis_en_cause_nom,
      json_extract(p.mis_en_cause, '$.inconnu') AS mis_en_cause_inconnu, u.matricule AS agent_matricule
    FROM complaints p JOIN users u ON u.id = p.created_by
    WHERE ${where.join(' AND ')}
    ORDER BY p.statut IN ('classee', 'resolue'), p.date_depot DESC, p.id DESC
    LIMIT ?`).all(...params, listLimit(req))
    .map(p => ({ ...p, qualifications: parseJson(p.qualifications, []).map(x => x.infraction) })));
});

r.get('/:id', (req, res) => {
  const c = load(intParam(req.params.id));
  // Un avocat ne lit que les plaintes où son compte est inscrit
  if (req.user.role === 'avocat' && !c.avocat_ids.includes(req.user.id)) fail(403, "Vous n'êtes pas l'avocat inscrit sur ce dossier");
  res.json(c);
});

r.post('/', (req, res) => {
  const b = req.body ?? {};
  const f = fieldsFrom(b);
  if (b.plaignant === undefined) fail(400, 'Le nom du plaignant est obligatoire');
  const id = transaction(() => {
    applyPersons(b, f);
    return insertRow('complaints', {
      ...f,
      numero: nextNumero('complaints', 'PLT'),
      date_depot: f.date_depot || localDate(),
      created_by: req.user.id,
      closed_at: closedAt(f.statut),
    });
  });
  const c = load(id);
  logAction(req.user, 'Plainte enregistrée', 'complaint', id, c.numero, `Plaignant : ${fullName(c.plaignant)}`);
  res.status(201).json(c);
});

r.put('/:id', (req, res) => {
  const id = intParam(req.params.id);
  const current = load(id);
  const b = req.body ?? {};
  const f = fieldsFrom(b);
  if (f.statut && CLOSED.includes(f.statut) !== CLOSED.includes(current.statut)) f.closed_at = closedAt(f.statut);
  transaction(() => {
    applyPersons(b, f);
    updateRow('complaints', id, f);
    logAction(req.user, 'Plainte modifiée', 'complaint', id, current.numero,
      f.statut && f.statut !== current.statut ? `Statut : ${STATUT_LABELS[current.statut]} → ${STATUT_LABELS[f.statut]}` : '');
  });
  res.json(load(id));
});

// Clôture par un magistrat : classée sans suite ou résolue, le reste de la plainte reste à la police
r.post('/:id/close', requireJudge, (req, res) => {
  const id = intParam(req.params.id);
  const statut = req.body?.statut;
  if (!CLOSED.includes(statut)) fail(400, 'Statut de clôture invalide : classée ou résolue');
  const current = load(id);
  const f = { statut };
  if (!CLOSED.includes(current.statut)) f.closed_at = closedAt(statut);
  updateRow('complaints', id, f);
  logAction(req.user, 'Plainte modifiée', 'complaint', id, current.numero, `Statut : ${STATUT_LABELS[current.statut]} → ${STATUT_LABELS[statut]}`);
  res.json(load(id));
});

// Ouvre un rapport d'arrestation pré-rempli (mis en cause + qualifications) et le lie à la plainte
r.post('/:id/report', (req, res) => {
  const id = intParam(req.params.id);
  const c = load(id);
  if (c.report_id) fail(400, "Un rapport d'arrestation est déjà lié à cette plainte");
  if (!c.mis_en_cause_id) fail(400, "Identifiez le mis en cause (nom) et enregistrez la plainte avant de créer le rapport");
  const reportId = transaction(() => {
    const rid = createReport(req.user, {
      citizenId: c.mis_en_cause_id,
      calcInput: { charges: c.qualifications.map(q => ({ code_id: q.code_id, quantite: 1 })) },
      faits: `Suite à la plainte ${c.numero} déposée par ${fullName(c.plaignant)}.\n\n${c.recit}`,
    });
    updateRow('complaints', id, { report_id: rid, ...(c.statut === 'ouverte' ? { statut: 'en_cours' } : {}) });
    return rid;
  });
  res.status(201).json({ report_id: reportId });
});

r.delete('/:id', requireRole('superviseur'), (req, res) => {
  const c = load(intParam(req.params.id));
  db.prepare('DELETE FROM complaints WHERE id = ?').run(c.id);
  logAction(req.user, 'Plainte supprimée', 'complaint', c.id, c.numero, `Plaignant : ${fullName(c.plaignant)}`);
  res.json({ ok: true });
});

export default r;
