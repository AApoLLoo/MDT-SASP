import { Router } from 'express';
import { db, parseJson } from '../db.js';
import { hasRole } from '../auth.js';
import { fail, str, intParam, insertRow, updateRow, nextNumero, localDate, cleanPhotos, listLimit, logAction } from '../util.js';
import { INCIDENT_TYPES } from '../../public/mdt/js/incident-kinds.js';

const JSON_DEFAULTS = { agents_presents: [], details: {}, photos: {} };

const canEdit = (user, inc) => hasRole(user, 'superviseur') || (inc.statut === 'brouillon' && inc.redacteur_id === user.id);

function load(id, user) {
  const inc = db.prepare(`
    SELECT i.*, u.matricule AS redacteur_matricule, u.nom AS redacteur_nom, u.prenom AS redacteur_prenom, u.grade AS redacteur_grade
    FROM incident_reports i JOIN users u ON u.id = i.redacteur_id WHERE i.id = ?`).get(id);
  if (!inc) fail(404, 'Rapport introuvable');
  for (const [k, def] of Object.entries(JSON_DEFAULTS)) inc[k] = parseJson(inc[k], def);
  inc.evidence = db.prepare('SELECT id, numero, categorie, description, quantite, statut FROM evidence WHERE incident_id = ? ORDER BY id').all(id);
  inc.can_edit = canEdit(user, inc);
  return inc;
}

function typeOf(name) {
  const type = INCIDENT_TYPES[name];
  if (!type) fail(400, "Type d'incident invalide");
  return type;
}

// Garde uniquement les champs du type ; les listes déroulantes doivent avoir une valeur connue
function cleanDetails(type, details = {}) {
  const out = {};
  for (const f of type.fields) {
    const v = str(details?.[f.key]).slice(0, 4000);
    if (v && f.type === 'select' && !f.options.includes(v)) fail(400, `${f.label} : valeur invalide`);
    if (v) out[f.key] = v;
  }
  return out;
}

const r = Router();

r.get('/', (req, res) => {
  const q = `%${str(req.query.q)}%`;
  const statut = ['brouillon', 'finalise'].includes(req.query.statut) ? req.query.statut : null;
  const type = INCIDENT_TYPES[req.query.type] ? req.query.type : null;
  const mine = req.query.mine === '1' ? req.user.id : null;
  res.json(db.prepare(`
    SELECT i.id, i.numero, i.type, i.statut, i.date_faits, i.lieu, i.updated_at, u.matricule AS redacteur_matricule
    FROM incident_reports i JOIN users u ON u.id = i.redacteur_id
    WHERE (i.numero LIKE ? OR i.lieu LIKE ? OR i.personnes LIKE ?)
      AND (? IS NULL OR i.statut = ?) AND (? IS NULL OR i.type = ?) AND (? IS NULL OR i.redacteur_id = ?)
    ORDER BY i.updated_at DESC LIMIT ?`).all(q, q, q, statut, statut, type, type, mine, mine, listLimit(req)));
});

r.get('/:id', (req, res) => res.json(load(intParam(req.params.id), req.user)));

r.post('/', (req, res) => {
  const type = INCIDENT_TYPES[req.body?.type] ? req.body.type : 'autre';
  const numero = nextNumero('incident_reports', 'INC');
  const id = insertRow('incident_reports', {
    numero, type, date_faits: localDate(), redacteur_id: req.user.id,
    agents_presents: JSON.stringify([req.user.matricule]),
  });
  logAction(req.user, "Rapport d'incident créé", 'incident', id, numero);
  res.status(201).json({ id });
});

r.put('/:id', (req, res) => {
  const id = intParam(req.params.id);
  const inc = load(id, req.user);
  if (!inc.can_edit) fail(403, 'Ce rapport ne peut plus être modifié');
  const b = req.body ?? {};
  const f = {};
  for (const k of ['date_faits', 'heure', 'lieu', 'personnes', 'recit']) if (b[k] !== undefined) f[k] = str(b[k]).slice(0, k === 'recit' ? 20000 : 4000);
  if (b.type !== undefined) {
    typeOf(b.type);
    f.type = b.type;
  }
  const type = typeOf(f.type ?? inc.type);
  if (b.details !== undefined || f.type) f.details = JSON.stringify(cleanDetails(type, b.details ?? inc.details));
  if (b.agents_presents !== undefined) {
    f.agents_presents = JSON.stringify([...new Set((Array.isArray(b.agents_presents) ? b.agents_presents : []).map(str).filter(Boolean))].slice(0, 20));
  }
  if (b.photos !== undefined) f.photos = JSON.stringify(cleanPhotos(b.photos));
  updateRow('incident_reports', id, f);
  // Les brouillons s'enregistrent souvent : seule la modification d'un rapport finalisé est tracée
  if (inc.statut === 'finalise') logAction(req.user, "Rapport d'incident finalisé modifié", 'incident', id, inc.numero);
  res.json(load(id, req.user));
});

r.post('/:id/finalize', (req, res) => {
  const id = intParam(req.params.id);
  const inc = load(id, req.user);
  if (!inc.can_edit) fail(403, 'Droits insuffisants');
  if (inc.statut === 'finalise') fail(400, 'Ce rapport est déjà finalisé');
  if (!inc.lieu) fail(400, 'Indiquez le lieu des faits');
  if (!inc.recit.trim()) fail(400, 'Le récit des faits est vide');
  const missing = typeOf(inc.type).fields.filter(f => f.required && !inc.details[f.key]).map(f => f.label);
  if (missing.length) fail(400, `Champs obligatoires manquants : ${missing.join(', ')}`);
  db.prepare(`UPDATE incident_reports SET statut = 'finalise', finalized_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
  logAction(req.user, "Rapport d'incident finalisé", 'incident', id, inc.numero);
  res.json(load(id, req.user));
});

r.post('/:id/reopen', (req, res) => {
  if (!hasRole(req.user, 'superviseur')) fail(403, 'Droits insuffisants');
  const id = intParam(req.params.id);
  const inc = load(id, req.user);
  if (inc.statut !== 'finalise') fail(400, "Ce rapport n'est pas finalisé");
  db.prepare(`UPDATE incident_reports SET statut = 'brouillon', finalized_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);
  logAction(req.user, "Rapport d'incident rouvert", 'incident', id, inc.numero);
  res.json({ ok: true });
});

r.delete('/:id', (req, res) => {
  const id = intParam(req.params.id);
  const inc = load(id, req.user);
  if (!hasRole(req.user, 'superviseur') && !(inc.statut === 'brouillon' && inc.redacteur_id === req.user.id)) fail(403, 'Droits insuffisants');
  db.prepare('DELETE FROM incident_reports WHERE id = ?').run(id);
  logAction(req.user, "Rapport d'incident supprimé", 'incident', id, inc.numero, inc.statut === 'finalise' ? 'Rapport finalisé' : 'Brouillon');
  res.json({ ok: true });
});

export default r;
