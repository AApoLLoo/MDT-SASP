import { Router } from 'express';
import { db, parseJson } from '../db.js';
import { requireRole } from '../auth.js';
import { fail, pick, str, intParam, optionalId, insertRow, updateRow, listLimit, logAction, cleanPhotos } from '../util.js';

const TYPE_LABELS = { mandat: "Mandat d'arrêt", bolo_personne: 'BOLO personne', bolo_vehicule: 'BOLO véhicule' };
const TYPES = Object.keys(TYPE_LABELS);

function clean(body) {
  const fields = pick(body, ['type', 'citizen_id', 'vehicle_id', 'motif', 'description', 'photos']);
  if ('type' in fields && !TYPES.includes(fields.type)) fail(400, 'Type invalide');
  if ('photos' in fields) fields.photos = JSON.stringify(cleanPhotos(fields.photos));
  if ('citizen_id' in fields) fields.citizen_id = optionalId(fields.citizen_id);
  if ('vehicle_id' in fields) fields.vehicle_id = optionalId(fields.vehicle_id);
  for (const k of ['motif', 'description']) if (k in fields) fields[k] = str(fields[k]);
  if ('motif' in fields && !fields.motif) fail(400, 'Le motif est obligatoire');
  return fields;
}

function validate(w) {
  if (w.type === 'mandat' && !w.citizen_id) fail(400, "Un mandat d'arrêt doit viser un citoyen");
  if (w.type === 'bolo_vehicule' && !w.vehicle_id && !w.description) fail(400, 'Indiquez le véhicule ou une description');
  if (w.type === 'bolo_personne' && !w.citizen_id && !w.description) fail(400, 'Indiquez le citoyen ou une description');
}

export const WARRANT_SELECT = `
  SELECT w.*, c.nom AS citizen_nom, c.prenom AS citizen_prenom, v.plaque AS vehicle_plaque, v.modele AS vehicle_modele,
    u.matricule AS auteur_matricule, cu.matricule AS cloture_matricule
  FROM warrants w
  LEFT JOIN citizens c ON c.id = w.citizen_id
  LEFT JOIN vehicles v ON v.id = w.vehicle_id
  LEFT JOIN users u ON u.id = w.created_by
  LEFT JOIN users cu ON cu.id = w.closed_by`;

// « Mandat d'arrêt · Prénom Nom » ou « BOLO véhicule · PLAQUE » pour l'historique
function warrantLabel(id) {
  const w = db.prepare(`${WARRANT_SELECT} WHERE w.id = ?`).get(id);
  if (!w) return '';
  const cible = w.citizen_id ? [w.citizen_prenom, w.citizen_nom].filter(Boolean).join(' ') : w.vehicle_plaque || w.description;
  return [TYPE_LABELS[w.type], cible].filter(Boolean).join(' · ');
}

const r = Router();

r.get('/', (req, res) => {
  const statut = ['actif', 'clos'].includes(req.query.statut) ? req.query.statut : null;
  res.json(db.prepare(`${WARRANT_SELECT} WHERE (? IS NULL OR w.statut = ?) ORDER BY w.statut = 'clos', w.created_at DESC LIMIT ?`).all(statut, statut, listLimit(req))
    .map(w => ({ ...w, photos: parseJson(w.photos, {}) })));
});

r.post('/', (req, res) => {
  const fields = clean(req.body);
  if (!fields.type) fail(400, 'Type obligatoire');
  if (!fields.motif) fail(400, 'Le motif est obligatoire');
  validate(fields);
  const id = insertRow('warrants', { ...fields, created_by: req.user.id });
  logAction(req.user, 'Mandat / BOLO émis', 'warrant', id, warrantLabel(id), fields.motif);
  res.status(201).json({ id });
});

r.put('/:id', (req, res) => {
  const id = intParam(req.params.id);
  const fields = clean(req.body);
  const current = db.prepare('SELECT * FROM warrants WHERE id = ?').get(id);
  if (!current) fail(404, 'Mandat introuvable');
  validate({ ...current, ...fields });
  updateRow('warrants', id, fields);
  logAction(req.user, 'Mandat / BOLO modifié', 'warrant', id, warrantLabel(id), fields.motif ?? current.motif);
  res.json({ ok: true });
});

r.post('/:id/close', (req, res) => {
  const { changes } = db.prepare(`UPDATE warrants SET statut = 'clos', closed_at = datetime('now'), closed_by = ?, updated_at = datetime('now') WHERE id = ? AND statut = 'actif'`)
    .run(req.user.id, intParam(req.params.id));
  if (!changes) fail(404, 'Mandat introuvable ou déjà clos');
  logAction(req.user, 'Mandat / BOLO clos', 'warrant', Number(req.params.id), warrantLabel(req.params.id));
  res.json({ ok: true });
});

r.delete('/:id', requireRole('superviseur'), (req, res) => {
  const id = intParam(req.params.id);
  const label = warrantLabel(id);
  const { changes } = db.prepare('DELETE FROM warrants WHERE id = ?').run(id);
  if (!changes) fail(404, 'Mandat introuvable');
  logAction(req.user, 'Mandat / BOLO supprimé', 'warrant', id, label);
  res.json({ ok: true });
});

export default r;
