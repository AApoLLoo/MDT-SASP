import { Router } from 'express';
import { db, parseJson, transaction } from '../db.js';
import { hasRole } from '../auth.js';
import { fail, str, bool, intParam, insertRow, updateRow, cleanPhotos, listLimit, logAction } from '../util.js';

const CATEGORIES = ['generale', 'operationnelle', 'academy', 'division'];
const IMPORTANCES = ['normale', 'importante', 'urgente'];

// Superviseurs : toutes les catégories. Formateurs (qualification) : Academy.
function canPost(user, categorie) {
  if (hasRole(user, 'superviseur')) return true;
  if (categorie !== 'academy') return false;
  const { qualifications } = db.prepare('SELECT qualifications FROM users WHERE id = ?').get(user.id);
  return parseJson(qualifications, []).some(q => q.toLowerCase() === 'formateur');
}

const canEdit = (user, a) => hasRole(user, 'superviseur') || a.created_by === user.id;

function clean(b) {
  const f = {};
  if (b.categorie !== undefined) {
    if (!CATEGORIES.includes(b.categorie)) fail(400, 'Catégorie invalide');
    f.categorie = b.categorie;
  }
  if (b.importance !== undefined) {
    if (!IMPORTANCES.includes(b.importance)) fail(400, 'Importance invalide');
    f.importance = b.importance;
  }
  for (const k of ['titre', 'contenu', 'division']) if (b[k] !== undefined) f[k] = str(b[k]).slice(0, k === 'contenu' ? 8000 : 200);
  if ('titre' in f && !f.titre) fail(400, 'Le titre est obligatoire');
  if (b.epingle !== undefined) f.epingle = bool(b.epingle);
  if (b.image_url !== undefined) f.image_url = cleanPhotos({ image: b.image_url }).image ?? '';
  return f;
}

const SELECT = `
  SELECT a.*, u.matricule AS auteur_matricule, u.nom AS auteur_nom, u.prenom AS auteur_prenom, u.grade AS auteur_grade, u.photo_url AS auteur_photo
  FROM announcements a JOIN users u ON u.id = a.created_by`;

function load(id) {
  const a = db.prepare(`${SELECT} WHERE a.id = ?`).get(id);
  if (!a) fail(404, 'Annonce introuvable');
  return a;
}

const r = Router();

r.get('/', (req, res) => {
  const categorie = CATEGORIES.includes(req.query.categorie) ? req.query.categorie : null;
  // division : une ou plusieurs (?division=A&division=B), ex. toutes les divisions de l'agent
  const divisions = [req.query.division ?? []].flat().map(str).filter(Boolean);
  const division = divisions.length ? JSON.stringify(divisions) : null;
  const rows = db.prepare(`
    SELECT * FROM (${SELECT}) a
    WHERE (? IS NULL OR a.categorie = ?) AND (? IS NULL OR (a.categorie = 'division' AND a.division COLLATE NOCASE IN (SELECT value FROM json_each(?))))
    ORDER BY a.epingle DESC, a.created_at DESC LIMIT ?`).all(categorie, categorie, division, division, listLimit(req));
  const lues = new Set(db.prepare('SELECT announcement_id AS id FROM announcement_reads WHERE user_id = ?').all(req.user.id).map(x => x.id));
  res.json(rows.map(a => ({ ...a, can_edit: canEdit(req.user, a), lu: a.created_by === req.user.id || lues.has(a.id) })));
});

// Annonces des autres agents que je n'ai pas encore lues
const UNREAD_SQL = `
  FROM announcements a
  WHERE a.created_by <> ? AND NOT EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.user_id = ?)`;

r.get('/unread', (req, res) => {
  const me = req.user.id;
  const { n } = db.prepare(`SELECT COUNT(*) AS n ${UNREAD_SQL}`).get(me, me);
  const latest = db.prepare(`SELECT a.id, a.titre, a.categorie, a.importance ${UNREAD_SQL} ORDER BY a.id DESC LIMIT 1`).get(me, me) ?? null;
  res.json({ count: n, latest, can_post: Object.fromEntries(CATEGORIES.map(c => [c, canPost(req.user, c)])) });
});

// Marque comme lues les annonces affichées à l'écran de l'agent
r.post('/seen', (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 500);
  const mark = db.prepare(`INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id)
    SELECT id, ? FROM announcements WHERE id = ?`);
  transaction(() => ids.forEach(id => mark.run(req.user.id, id)));
  res.json({ ok: true });
});

r.post('/', (req, res) => {
  const f = clean(req.body ?? {});
  if (!f.categorie || !f.titre) fail(400, 'Catégorie et titre obligatoires');
  if (!canPost(req.user, f.categorie)) fail(403, 'Vous ne pouvez pas publier dans cette catégorie');
  if (f.categorie === 'division' && !f.division) fail(400, 'Précisez la division concernée');
  if (f.categorie !== 'division') f.division = '';
  const id = insertRow('announcements', { ...f, created_by: req.user.id });
  logAction(req.user, 'Annonce publiée', 'announcement', id, f.titre, f.categorie);
  res.status(201).json(load(id));
});

r.put('/:id', (req, res) => {
  const current = load(intParam(req.params.id));
  if (!canEdit(req.user, current)) fail(403, 'Vous ne pouvez pas modifier cette annonce');
  const f = clean(req.body ?? {});
  const categorie = f.categorie ?? current.categorie;
  if (f.categorie && f.categorie !== current.categorie && !canPost(req.user, f.categorie)) fail(403, 'Vous ne pouvez pas publier dans cette catégorie');
  if (categorie === 'division' && !(f.division ?? current.division)) fail(400, 'Précisez la division concernée');
  if (categorie !== 'division') f.division = '';
  updateRow('announcements', current.id, f);
  logAction(req.user, 'epingle' in f && Object.keys(f).length === 1 ? (f.epingle ? 'Annonce épinglée' : 'Annonce désépinglée') : 'Annonce modifiée',
    'announcement', current.id, f.titre ?? current.titre);
  res.json(load(current.id));
});

r.delete('/:id', (req, res) => {
  const current = load(intParam(req.params.id));
  if (!canEdit(req.user, current)) fail(403, 'Vous ne pouvez pas supprimer cette annonce');
  db.prepare('DELETE FROM announcements WHERE id = ?').run(current.id);
  logAction(req.user, 'Annonce supprimée', 'announcement', current.id, current.titre);
  res.json({ ok: true });
});

export default r;
