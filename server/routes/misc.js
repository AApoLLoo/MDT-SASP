import express, { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR, getDefcon, getSettings } from '../db.js';
import { requireRole } from '../auth.js';
import { fail, str, listLimit, logAction } from '../util.js';
import { WARRANT_SELECT } from './warrants.js';

const r = Router();

// Type déterminé par la signature du fichier, pas par l'en-tête envoyé
export function imageExtension(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

r.post('/uploads', express.raw({ type: 'image/*', limit: '8mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) fail(400, 'Image manquante');
  const ext = imageExtension(req.body);
  if (!ext) fail(415, 'Format non supporté (PNG, JPEG, WebP ou GIF)');
  const name = `${randomBytes(12).toString('hex')}.${ext}`;
  writeFileSync(path.join(UPLOAD_DIR, name), req.body);
  res.status(201).json({ url: `/mdt/uploads/${name}` });
});

r.get('/settings', (req, res) => res.json(getSettings()));

r.put('/settings', requireRole('superviseur'), (req, res) => {
  const defcon = Number(req.body?.defcon);
  if (![1, 2, 3, 4, 5].includes(defcon)) fail(400, 'Niveau Defcon invalide');
  const before = getDefcon();
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'defcon'`).run(String(defcon));
  if (before !== defcon) logAction(req.user, 'Niveau Defcon changé', 'settings', null, 'Defcon', `${before} → ${defcon}`);
  res.json({ defcon });
});

// Historique des actions (superviseurs) ; filtres : texte, type de document, agent
r.get('/audit', requireRole('superviseur'), (req, res) => {
  const q = `%${str(req.query.q)}%`;
  const entity = str(req.query.entity) || null;
  const userId = Number(req.query.user_id) || null;
  res.json(db.prepare(`
    SELECT l.*, u.matricule, u.nom, u.prenom, u.grade FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
    WHERE (l.action LIKE ? OR l.label LIKE ? OR l.details LIKE ?)
      AND (? IS NULL OR l.entity = ? OR l.entity LIKE ? || ':%') AND (? IS NULL OR l.user_id = ?)
    ORDER BY l.id DESC LIMIT ?`).all(q, q, q, entity, entity, entity, userId, userId, listLimit(req)));
});

r.get('/dashboard', (req, res) => {
  const count = (sql, ...params) => db.prepare(sql).get(...params).n;
  res.json({
    stats: {
      casiers: count(`SELECT COUNT(DISTINCT citizen_id) AS n FROM arrest_reports WHERE statut = 'finalise' AND blanchi_at IS NULL`),
      mandats_actifs: count(`SELECT COUNT(*) AS n FROM warrants WHERE statut = 'actif'`),
      vehicules_voles: count(`SELECT COUNT(*) AS n FROM vehicles WHERE statut = 'vole'`),
      rapports_mois: count(`SELECT COUNT(*) AS n FROM arrest_reports WHERE statut = 'finalise' AND blanchi_at IS NULL AND finalized_at >= date('now', 'start of month')`),
    },
    mandats: db.prepare(`${WARRANT_SELECT} WHERE w.statut = 'actif' ORDER BY w.created_at DESC LIMIT 8`).all(),
    rapports: db.prepare(`
      SELECT a.id, a.numero, a.date_faits, json_extract(a.suspect, '$.nom') AS suspect_nom, json_extract(a.suspect, '$.prenom') AS suspect_prenom,
        json_extract(a.calc_result, '$.nbChefs') AS nb_chefs, u.matricule AS redacteur_matricule
      FROM arrest_reports a JOIN users u ON u.id = a.redacteur_id
      WHERE a.statut = 'finalise' AND a.blanchi_at IS NULL ORDER BY a.finalized_at DESC LIMIT 8`).all(),
    annonces: db.prepare(`
      SELECT a.id, a.categorie, a.division, a.titre, a.importance, a.epingle, a.created_at, u.matricule AS auteur_matricule,
        (a.created_by = ? OR EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.user_id = ?)) AS lu
      FROM announcements a JOIN users u ON u.id = a.created_by
      ORDER BY a.epingle DESC, a.created_at DESC LIMIT 4`).all(req.user.id, req.user.id),
    unites: db.prepare('SELECT id, indicatif, statut, secteur, poste, agents FROM patrol_units ORDER BY indicatif').all()
      .map(u => ({ ...u, agents: JSON.parse(u.agents) })),
    plaintes: db.prepare(`
      SELECT id, numero, statut, date_depot,
        TRIM(COALESCE(json_extract(plaignant, '$.prenom'), '') || ' ' || COALESCE(json_extract(plaignant, '$.nom'), '')) AS plaignant_nom
      FROM complaints WHERE statut IN ('ouverte', 'en_cours') ORDER BY date_depot DESC, id DESC LIMIT 8`).all(),
    brouillons: db.prepare(`
      SELECT id, numero, updated_at, json_extract(suspect, '$.nom') AS suspect_nom, json_extract(suspect, '$.prenom') AS suspect_prenom
      FROM arrest_reports WHERE statut = 'brouillon' AND redacteur_id = ? ORDER BY updated_at DESC LIMIT 8`).all(req.user.id),
  });
});

export default r;
