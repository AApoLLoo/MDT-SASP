import { Router } from 'express';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { db, parseJson, transaction, getList } from '../db.js';
import { backup, backups, BACKUP_DIR } from '../maintenance.js';
import { fail, str, logAction } from '../util.js';

// Listes réglables : libellé de l'historique, et report d'un renommage sur les données qui portent l'ancienne valeur
const LISTS = {
  grades: ['Grades', (from, to) => db.prepare('UPDATE users SET grade = ? WHERE grade = ?').run(to, from)],
  grades_swat: ['Grades SWAT', (from, to) => db.prepare('UPDATE users SET grade_swat = ? WHERE grade_swat = ?').run(to, from)],
  grades_bci: ['Grades BCI', (from, to) => db.prepare('UPDATE users SET grade_bci = ? WHERE grade_bci = ?').run(to, from)],
  divisions: ['Divisions', (from, to) => {
    db.prepare(`
      UPDATE users SET divisions = (SELECT json_group_array(CASE WHEN value = ?1 THEN ?2 ELSE value END) FROM json_each(users.divisions))
      WHERE EXISTS (SELECT 1 FROM json_each(users.divisions) WHERE value = ?1)`).run(from, to);
    db.prepare('UPDATE announcements SET division = ? WHERE division = ?').run(to, from);
  }],
  qualifications: ['Qualifications', (from, to) => {
    db.prepare(`
      UPDATE users SET qualifications = (SELECT json_group_array(CASE WHEN value = ?1 THEN ?2 ELSE value END) FROM json_each(users.qualifications))
      WHERE EXISTS (SELECT 1 FROM json_each(users.qualifications) WHERE value = ?1)`).run(from, to);
    // Formations de l'Academy : la fiche du catalogue, les formations attribuées et les prérequis portent ce nom
    db.prepare(`UPDATE service_records SET data = json_set(data, '$.nom', ?2) WHERE kind = 'catalogue' AND json_extract(data, '$.nom') = ?1`).run(from, to);
    db.prepare(`UPDATE service_records SET data = json_set(data, '$.module', ?2) WHERE kind = 'formations' AND json_extract(data, '$.module') = ?1`).run(from, to);
    for (const rec of db.prepare(`SELECT id, data FROM service_records WHERE kind = 'catalogue'`).all()) {
      const data = parseJson(rec.data, {});
      if (!data.prerequis?.some(p => p.formation === from)) continue;
      data.prerequis = data.prerequis.map(p => (p.formation === from ? { ...p, formation: to } : p));
      db.prepare('UPDATE service_records SET data = ? WHERE id = ?').run(JSON.stringify(data), rec.id);
    }
  }],
  secteurs: ['Secteurs', (from, to) => db.prepare('UPDATE patrol_units SET secteur = ? WHERE secteur = ?').run(to, from)],
  postes: ['Postes de rattachement', (from, to) => db.prepare('UPDATE patrol_units SET poste = ? WHERE poste = ?').run(to, from)],
};

const r = Router();

// Corps : { items: [valeurs dans l'ordre], renames: { ancienne: nouvelle } }
r.put('/settings/:key', (req, res) => {
  const key = req.params.key;
  if (!Object.hasOwn(LISTS, key)) fail(404, 'Paramètre inconnu');
  const [label, rename] = LISTS[key];
  if (!Array.isArray(req.body?.items)) fail(400, 'Liste invalide');
  const list = [];
  for (const v of req.body.items.map(v => str(v).slice(0, 60)).filter(Boolean)) {
    if (!list.some(x => x.toLowerCase() === v.toLowerCase())) list.push(v);
  }
  if (list.length > 60) fail(400, '60 valeurs au maximum');
  const before = getList(key);
  const renames = Object.entries(req.body.renames ?? {}).map(([a, b]) => [str(a), str(b)])
    .filter(([a, b]) => a !== b && before.includes(a) && list.includes(b));
  transaction(() => {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(list), key);
    for (const [a, b] of renames) rename(a, b);
  });
  const renamedTo = renames.map(([, b]) => b);
  const added = list.filter(v => !before.includes(v) && !renamedTo.includes(v));
  const removed = before.filter(v => !list.includes(v) && !renames.some(([a]) => a === v));
  const reordered = !added.length && !removed.length && !renames.length && list.join('\n') !== before.join('\n');
  const details = [
    added.length && `Ajouté : ${added.join(', ')}`,
    removed.length && `Retiré : ${removed.join(', ')}`,
    renames.length && `Renommé : ${renames.map(([a, b]) => `${a} → ${b}`).join(', ')}`,
    reordered && 'Ordre modifié',
  ].filter(Boolean).join(' · ');
  if (details) logAction(req.user, 'Paramètres modifiés', 'settings', null, label, details);
  res.json({ items: list });
});

r.get('/backups', (req, res) => {
  mkdirSync(BACKUP_DIR, { recursive: true });
  res.json(backups().reverse().map(name => {
    const s = statSync(path.join(BACKUP_DIR, name));
    return { name, size: s.size, date: s.mtime.toISOString().slice(0, 19).replace('T', ' ') };
  }));
});

r.post('/backups', (req, res) => {
  const name = path.basename(backup());
  logAction(req.user, 'Sauvegarde manuelle', 'settings', null, 'Base de données', name);
  res.status(201).json({ name });
});

export default r;
