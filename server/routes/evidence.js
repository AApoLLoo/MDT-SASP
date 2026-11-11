import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { fail, str, intParam, insertRow, updateRow, nextNumero, cleanPhotos, listLimit, logAction } from '../util.js';

export const STATUTS = { stockee: 'En stock', sortie: 'Sortie temporaire', transmise: 'Transmise à la justice', restituee: 'Restituée', detruite: 'Détruite' };
const DEFAULT_EMPLACEMENT = 'Salle des scellés';

const SELECT = `
  SELECT e.*, a.numero AS report_numero, i.numero AS incident_numero, u.matricule AS auteur_matricule
  FROM evidence e
  LEFT JOIN arrest_reports a ON a.id = e.report_id
  LEFT JOIN incident_reports i ON i.id = e.incident_id
  LEFT JOIN users u ON u.id = e.created_by`;

function load(id) {
  const e = db.prepare(`${SELECT} WHERE e.id = ?`).get(id);
  if (!e) fail(404, 'Scellé introuvable');
  // Chaîne de possession : tous les mouvements tracés dans l'historique
  e.history = db.prepare(`
    SELECT l.action, l.details, l.created_at, u.matricule FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.entity = 'evidence' AND l.entity_id = ? ORDER BY l.id DESC`).all(id);
  return e;
}

// Rapport d'origine désigné par son numéro (SASP-… ou INC-…)
function origin(numero) {
  numero = str(numero).toUpperCase();
  if (!numero) return { report_id: null, incident_id: null };
  const report = db.prepare('SELECT id FROM arrest_reports WHERE numero = ?').get(numero);
  if (report) return { report_id: report.id, incident_id: null };
  const incident = db.prepare('SELECT id FROM incident_reports WHERE numero = ?').get(numero);
  if (incident) return { report_id: null, incident_id: incident.id };
  fail(400, `Aucun rapport ne porte le numéro ${numero}`);
}

function clean(b) {
  const f = {};
  for (const k of ['categorie', 'description', 'quantite', 'emplacement', 'notes']) if (b[k] !== undefined) f[k] = str(b[k]).slice(0, k === 'notes' ? 4000 : 300);
  if ('description' in f && !f.description) fail(400, 'La description est obligatoire');
  if (b.statut !== undefined) {
    if (!STATUTS[b.statut]) fail(400, 'Statut invalide');
    f.statut = b.statut;
  }
  if (b.photo_url !== undefined) f.photo_url = cleanPhotos({ photo: b.photo_url }).photo ?? '';
  if (b.origine !== undefined) Object.assign(f, origin(b.origine));
  return f;
}

const isWeapon = db.prepare('SELECT 1 FROM weapons WHERE nom = ? COLLATE NOCASE');

// À la finalisation d'un rapport d'arrestation : chaque objet saisi devient un scellé.
// Un objet déjà mis sous scellé pour ce rapport (finalisation précédente) n'est pas dupliqué.
export function sealSeizedObjects(user, report) {
  const existing = new Set(db.prepare('SELECT description FROM evidence WHERE report_id = ?').all(report.id).map(e => e.description.toLowerCase()));
  for (const o of report.objets_illegaux) {
    if (existing.has(o.description.toLowerCase())) continue;
    const numero = nextNumero('evidence', 'PRV');
    const id = insertRow('evidence', {
      numero, description: o.description, quantite: o.quantite, categorie: isWeapon.get(o.description) ? 'Arme' : 'Objet',
      emplacement: DEFAULT_EMPLACEMENT, report_id: report.id, created_by: user.id,
    });
    logAction(user, 'Scellé créé', 'evidence', id, numero, `Saisi lors de l'arrestation ${report.numero} · ${DEFAULT_EMPLACEMENT}`);
  }
}

const r = Router();

r.get('/', (req, res) => {
  const q = `%${str(req.query.q)}%`;
  const statut = req.query.statut === 'en_stock' ? ['stockee', 'sortie'] : STATUTS[req.query.statut] ? [req.query.statut] : null;
  res.json(db.prepare(`
    SELECT * FROM (${SELECT}) e
    WHERE (e.numero LIKE ? OR e.description LIKE ? OR e.emplacement LIKE ? OR IFNULL(e.report_numero, '') LIKE ? OR IFNULL(e.incident_numero, '') LIKE ?)
      AND (? IS NULL OR e.statut IN (SELECT value FROM json_each(?)))
    ORDER BY e.id DESC LIMIT ?`).all(q, q, q, q, q, statut && 1, statut && JSON.stringify(statut), listLimit(req)));
});

r.get('/:id', (req, res) => res.json(load(intParam(req.params.id))));

r.post('/', (req, res) => {
  const f = clean(req.body ?? {});
  if (!f.description) fail(400, 'La description est obligatoire');
  const numero = nextNumero('evidence', 'PRV');
  const id = insertRow('evidence', { ...f, emplacement: f.emplacement || DEFAULT_EMPLACEMENT, numero, created_by: req.user.id });
  const e = load(id);
  logAction(req.user, 'Scellé créé', 'evidence', id, numero, [e.report_numero || e.incident_numero, e.emplacement].filter(Boolean).join(' · '));
  res.status(201).json(load(id));
});

// Un changement de statut ou d'emplacement est un mouvement : il est tracé avec son motif
r.put('/:id', (req, res) => {
  const id = intParam(req.params.id);
  const current = load(id);
  const f = clean(req.body ?? {});
  const motif = str(req.body?.motif).slice(0, 500);
  const statutChange = f.statut && f.statut !== current.statut;
  const placeChange = f.emplacement !== undefined && f.emplacement !== current.emplacement;
  if ((statutChange || placeChange) && !motif) fail(400, 'Indiquez le motif du mouvement (audience, expertise, restitution…)');
  updateRow('evidence', id, f);
  const details = [
    statutChange && `${STATUTS[current.statut]} → ${STATUTS[f.statut]}`,
    placeChange && `Emplacement : ${current.emplacement || '—'} → ${f.emplacement || '—'}`,
    motif,
  ].filter(Boolean).join(' · ');
  logAction(req.user, statutChange || placeChange ? 'Mouvement de scellé' : 'Scellé modifié', 'evidence', id, current.numero, details);
  res.json(load(id));
});

r.delete('/:id', requireRole('superviseur'), (req, res) => {
  const current = load(intParam(req.params.id));
  db.prepare('DELETE FROM evidence WHERE id = ?').run(current.id);
  logAction(req.user, 'Scellé supprimé', 'evidence', current.id, current.numero, current.description);
  res.json({ ok: true });
});

export default r;
