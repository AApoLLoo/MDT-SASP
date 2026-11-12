import { db } from './db.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function fail(status, message) {
  throw new HttpError(status, message);
}

export const str = v => (v ?? '').toString().trim();
export const bool = v => (v ? 1 : 0);

export function intParam(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) fail(400, 'Identifiant invalide');
  return n;
}

export const optionalId = v => (v === null || v === undefined || v === '' ? null : intParam(v));

// Garde uniquement les clés autorisées présentes dans le corps, chaînes nettoyées
export function pick(body = {}, keys) {
  const out = {};
  for (const k of keys) if (body[k] !== undefined) out[k] = typeof body[k] === 'string' ? body[k].trim() : body[k];
  return out;
}

// Les noms de table et de colonnes viennent toujours de listes blanches du code
export function insertRow(table, fields) {
  const keys = Object.keys(fields);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return Number(db.prepare(sql).run(...keys.map(k => fields[k])).lastInsertRowid);
}

export function updateRow(table, id, fields, { touch = true } = {}) {
  const keys = Object.keys(fields);
  if (!keys.length && !touch) return;
  const sets = keys.map(k => `${k} = ?`);
  if (touch) sets.push(`updated_at = datetime('now')`);
  const res = db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
  if (!res.changes) fail(404, 'Élément introuvable');
}

// Numéro de document annuel : PREFIXE-AAAA-NNNN ; `column` : expression SQL qui porte le numéro
export function nextNumero(table, prefix, column = 'numero') {
  const base = `${prefix}-${new Date().getFullYear()}-`;
  const { n } = db.prepare(`SELECT MAX(CAST(substr(${column}, ?) AS INTEGER)) AS n FROM ${table} WHERE ${column} LIKE ?`).get(base.length + 1, `${base}%`);
  return `${base}${String((n || 0) + 1).padStart(4, '0')}`;
}

export function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const PHOTO_URL = /^(\/mdt\/uploads\/[\w.-]+|https:\/\/\S+)$/;

// Photos { emplacement: url } : uniquement nos uploads ou des liens https (http en clair refusé, comme par la CSP)
export function cleanPhotos(photos = {}) {
  const out = {};
  for (const [slot, url] of Object.entries(photos ?? {})) {
    if (/^[a-z0-9_]{1,30}$/.test(slot) && PHOTO_URL.test(str(url))) out[slot] = str(url);
  }
  return out;
}

// Nombre de lignes renvoyées par une liste ; le bouton « Afficher plus » augmente `limit`
// ponytail: plafond 2000 lignes, au-delà passer par la recherche ou une vraie pagination
export const listLimit = req => Math.min(Math.max(Number(req.query.limit) || 100, 1), 2000);

// Historique des actions : qui a fait quoi, sur quel document, et quand
export function logAction(user, action, entity, entityId = null, label = '', details = '') {
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, label, details) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user?.id ?? null, action, entity, entityId, str(label), str(details).slice(0, 1000));
}

// Verrou optimiste : le client renvoie l'updated_at du document qu'il a chargé ; s'il a changé entre-temps,
// quelqu'un d'autre a enregistré et la sauvegarde l'écraserait. Sans updated_at, aucun contrôle.
// ponytail: updated_at est à la seconde, deux enregistrements dans la même seconde passent ; horodatage plus fin si ça arrive
export function checkVersion(current, sent) {
  if (sent !== undefined && sent !== current) {
    fail(409, "Ce document a été modifié par quelqu'un d'autre depuis son ouverture. Copiez votre texte, puis rechargez la page.");
  }
}

export function getOr404(sql, id, message = 'Élément introuvable') {
  const row = db.prepare(sql).get(id);
  if (!row) fail(404, message);
  return row;
}
