import { Router } from 'express';
import { db, transaction, parseJson } from '../db.js';
import { requireRole } from '../auth.js';
import { fail, pick, str, intParam, insertRow, updateRow, getOr404, listLimit, logAction, cleanPhotos } from '../util.js';

const plaqueOf = id => getOr404('SELECT plaque FROM vehicles WHERE id = ?', id, 'Véhicule introuvable').plaque;

// Registre des véhicules volés
const FIELDS = ['plaque', 'modele', 'couleur', 'proprietaire', 'contact', 'date_vol', 'lieu_vol', 'notes', 'photos'];

function clean(body) {
  const fields = pick(body, FIELDS);
  for (const k of Object.keys(fields)) fields[k] = k === 'photos' ? JSON.stringify(cleanPhotos(fields[k])) : str(fields[k]);
  if ('plaque' in fields) {
    fields.plaque = fields.plaque.toUpperCase();
    if (!fields.plaque) fail(400, 'La plaque est obligatoire');
  }
  return fields;
}

const r = Router();

r.get('/', (req, res) => {
  const q = `%${str(req.query.q)}%`;
  const statut = ['vole', 'retrouve'].includes(req.query.statut) ? req.query.statut : null;
  res.json(db.prepare(`
    SELECT v.*, d.matricule AS declare_matricule, f.matricule AS retrouve_matricule,
      (SELECT COUNT(*) FROM warrants w WHERE w.vehicle_id = v.id AND w.statut = 'actif') AS bolos_actifs
    FROM vehicles v
    LEFT JOIN users d ON d.id = v.declare_par
    LEFT JOIN users f ON f.id = v.retrouve_par
    WHERE (v.plaque LIKE ? OR v.modele LIKE ? OR v.proprietaire LIKE ?)
      AND (? IS NULL OR v.statut = ?)
    ORDER BY v.statut = 'retrouve', COALESCE(NULLIF(v.date_vol, ''), v.created_at) DESC
    LIMIT ?`).all(q, q, q, statut, statut, listLimit(req)).map(v => ({ ...v, photos: parseJson(v.photos, {}) })));
});

// Déclarer un vol ; une plaque déjà retrouvée peut être déclarée volée à nouveau
r.post('/', (req, res) => {
  const fields = clean(req.body);
  if (!fields.plaque) fail(400, 'La plaque est obligatoire');
  const existing = db.prepare('SELECT id, statut FROM vehicles WHERE plaque = ?').get(fields.plaque);
  if (existing?.statut === 'vole') fail(409, 'Ce véhicule est déjà déclaré volé');
  const declaration = { ...fields, statut: 'vole', declare_par: req.user.id, retrouve_le: null, lieu_retrouve: '', retrouve_par: null };
  if (existing) {
    // Nouvelle déclaration : on garde la description du véhicule si elle n'est pas ressaisie
    for (const k of ['modele', 'couleur', 'proprietaire', 'contact']) if (!declaration[k]) delete declaration[k];
    if (declaration.photos === '{}') delete declaration.photos;
    updateRow('vehicles', existing.id, declaration);
    logAction(req.user, 'Vol de véhicule déclaré', 'vehicle', existing.id, fields.plaque, 'Nouvelle déclaration');
    return res.status(201).json({ id: existing.id });
  }
  const id = insertRow('vehicles', declaration);
  logAction(req.user, 'Vol de véhicule déclaré', 'vehicle', id, fields.plaque);
  res.status(201).json({ id });
});

r.put('/:id', (req, res) => {
  const id = intParam(req.params.id);
  updateRow('vehicles', id, clean(req.body));
  logAction(req.user, 'Véhicule modifié', 'vehicle', id, plaqueOf(id));
  res.json({ ok: true });
});

// Véhicule retrouvé : les BOLO actifs sur ce véhicule n'ont plus lieu d'être
r.post('/:id/found', (req, res) => {
  const id = intParam(req.params.id);
  const bolosClos = transaction(() => {
    const { changes } = db.prepare(`UPDATE vehicles SET statut = 'retrouve', retrouve_le = datetime('now'), retrouve_par = ?, lieu_retrouve = ?, updated_at = datetime('now')
      WHERE id = ? AND statut = 'vole'`).run(req.user.id, str(req.body?.lieu_retrouve), id);
    if (!changes) fail(404, 'Véhicule introuvable ou déjà retrouvé');
    return db.prepare(`UPDATE warrants SET statut = 'clos', closed_at = datetime('now'), closed_by = ?, updated_at = datetime('now')
      WHERE vehicle_id = ? AND statut = 'actif'`).run(req.user.id, id).changes;
  });
  logAction(req.user, 'Véhicule retrouvé', 'vehicle', id, plaqueOf(id),
    [str(req.body?.lieu_retrouve), bolosClos && `${bolosClos} BOLO clos`].filter(Boolean).join(' · '));
  res.json({ ok: true, bolos_clos: bolosClos });
});

r.delete('/:id', requireRole('superviseur'), (req, res) => {
  const id = intParam(req.params.id);
  const plaque = plaqueOf(id);
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(id);
  logAction(req.user, 'Véhicule supprimé', 'vehicle', id, plaque);
  res.json({ ok: true });
});

export default r;
