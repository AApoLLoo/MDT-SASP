// Mentions @matricule dans les faits d'un rapport d'arrestation ou le récit d'un rapport d'incident :
// l'agent mentionné est notifié une fois par rapport (cloche du MDT, flux temps réel).
import { Router } from 'express';
import { db } from '../db.js';
import { JUSTICE_ROLES } from '../auth.js';
import { notifyUsers } from '../events.js';

// « @12 », « @S-12 » ; pas une adresse e-mail (lettre ou chiffre juste avant l'arobase)
const MENTION = /(?<![\w@])@([A-Za-z0-9][\w-]*)/g;
const MAX_MENTIONS = 20;

export const mentionedMatricules = text =>
  [...new Set([...String(text ?? '').matchAll(MENTION)].map(m => m[1].toLowerCase()))].slice(0, MAX_MENTIONS);

// Seuls les policiers actifs sont notifiés (matricule insensible à la casse : COLLATE NOCASE)
const findAgent = db.prepare(`SELECT id FROM users WHERE matricule = ? AND actif = 1
  AND role NOT IN (${JUSTICE_ROLES.map(r => `'${r}'`).join(', ')})`);
const insertMention = db.prepare('INSERT OR IGNORE INTO mentions (user_id, author_id, entity, entity_id, numero) VALUES (?, ?, ?, ?, ?)');

export function notifyMentions(author, entity, entityId, numero, text) {
  const notified = [];
  for (const matricule of mentionedMatricules(text)) {
    const id = findAgent.get(matricule)?.id;
    if (!id || id === author.id) continue;
    if (insertMention.run(id, author.id, entity, entityId, numero).changes) notified.push(id);
  }
  if (notified.length) notifyUsers(notified, 'mentions');
}

// Rapport supprimé ou blanchi : la mention disparaît de la liste
const VISIBLE = `((m.entity = 'report' AND EXISTS (SELECT 1 FROM arrest_reports a WHERE a.id = m.entity_id AND a.blanchi_at IS NULL))
  OR (m.entity = 'incident' AND EXISTS (SELECT 1 FROM incident_reports i WHERE i.id = m.entity_id)))`;

const r = Router();

r.get('/', (req, res) => {
  const items = db.prepare(`
    SELECT m.id, m.entity, m.entity_id, m.numero, m.created_at, m.read_at,
      u.matricule AS auteur_matricule, u.nom AS auteur_nom, u.prenom AS auteur_prenom, u.grade AS auteur_grade
    FROM mentions m JOIN users u ON u.id = m.author_id
    WHERE m.user_id = ? AND ${VISIBLE} ORDER BY m.id DESC LIMIT 30`).all(req.user.id);
  res.json({ unread: items.filter(i => !i.read_at).length, items });
});

r.post('/seen', (req, res) => {
  db.prepare(`UPDATE mentions SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`).run(req.user.id);
  res.json({ ok: true });
});

export default r;
