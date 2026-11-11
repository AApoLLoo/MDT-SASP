import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { fail, pick, str, bool, intParam, insertRow, updateRow, getOr404, logAction } from '../util.js';

const CATEGORIES = ['Contravention', 'Délit mineur', 'Délit majeur', 'Crime'];

function cleanCode(body) {
  const f = pick(body, ['classification', 'categorie', 'infraction', 'amende', 'supplements', 'peine_minutes', 'actif']);
  for (const k of ['classification', 'infraction', 'supplements']) if (k in f) f[k] = str(f[k]);
  if ('infraction' in f && !f.infraction) fail(400, "L'intitulé de l'infraction est obligatoire");
  if ('categorie' in f && !CATEGORIES.includes(f.categorie)) fail(400, 'Catégorie invalide');
  if ('amende' in f) {
    f.amende = Number(f.amende);
    if (!(f.amende >= 0)) fail(400, 'Amende invalide');
  }
  if ('peine_minutes' in f) {
    f.peine_minutes = Number(f.peine_minutes);
    if (!Number.isInteger(f.peine_minutes) || f.peine_minutes < 0) fail(400, 'Peine invalide (minutes entières)');
  }
  if ('actif' in f) f.actif = bool(f.actif);
  return f;
}

const r = Router();

r.get('/penal-code', (req, res) => res.json(db.prepare('SELECT * FROM penal_code ORDER BY id').all()));

r.post('/penal-code', requireRole('admin'), (req, res) => {
  const f = cleanCode(req.body);
  if (!f.infraction || !f.categorie) fail(400, 'Infraction et catégorie obligatoires');
  const id = insertRow('penal_code', f);
  logAction(req.user, 'Infraction ajoutée au Code pénal', 'penal_code', id, f.infraction, f.categorie);
  res.status(201).json({ id });
});

r.put('/penal-code/:id', requireRole('admin'), (req, res) => {
  const id = intParam(req.params.id);
  const before = getOr404('SELECT * FROM penal_code WHERE id = ?', id, 'Infraction introuvable');
  const f = cleanCode(req.body);
  updateRow('penal_code', id, f, { touch: false });
  const changes = Object.keys(f).filter(k => f[k] !== before[k]).map(k => `${k} : ${before[k]} → ${f[k]}`);
  if (changes.length) logAction(req.user, 'Code pénal modifié', 'penal_code', id, before.infraction, changes.join(' · '));
  res.json({ ok: true });
});

r.get('/weapons', (req, res) => res.json(db.prepare('SELECT * FROM weapons ORDER BY id').all()));

export default r;
