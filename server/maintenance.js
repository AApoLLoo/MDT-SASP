import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, DATA_DIR, UPLOAD_DIR } from './db.js';
import { purgeExpired } from './auth.js';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
// Copie de chaque sauvegarde hors du disque des données (lecteur réseau, dossier synchronisé…) ; vide = aucune copie
const COPY_DIR = process.env.BACKUP_COPY_DIR ? path.resolve(process.env.BACKUP_COPY_DIR) : null;
const KEEP = Number(process.env.BACKUP_KEEP) || 14;
const DAY_MS = 24 * 3600 * 1000;
const ORPHAN_GRACE_MS = 7 * DAY_MS; // laisse le temps d'enregistrer un formulaire où la photo vient d'être importée

export const backups = (dir = BACKUP_DIR) => readdirSync(dir).filter(f => /^mdt-\d{8}-\d{9}\.sqlite$/.test(f)).sort();

// Copie cohérente de la base, serveur en marche compris : contrairement à une copie du fichier,
// VACUUM INTO inclut ce qui est encore dans le journal WAL. Garde les KEEP plus récentes.
export function backup() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 23).replace(/[-:.]/g, '').replace('T', '-');
  const file = path.join(BACKUP_DIR, `mdt-${stamp}.sqlite`);
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  for (const old of backups().slice(0, -KEEP)) rmSync(path.join(BACKUP_DIR, old));
  if (COPY_DIR) {
    // Échec de la copie : signalé, la sauvegarde locale reste valable
    try {
      mkdirSync(COPY_DIR, { recursive: true });
      copyFileSync(file, path.join(COPY_DIR, path.basename(file)));
      for (const old of backups(COPY_DIR).slice(0, -KEEP)) rmSync(path.join(COPY_DIR, old));
    } catch (err) {
      console.error(`Copie de la sauvegarde vers ${COPY_DIR} en échec :`, err);
    }
  }
  return file;
}

// Images référencées par une base : toutes les colonnes texte de toutes les tables sont parcourues,
// une future table avec des photos est donc couverte d'office
function collectUploads(database, used) {
  for (const { name } of database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all()) {
    for (const col of database.prepare(`PRAGMA table_info(${name})`).all().filter(c => c.type === 'TEXT')) {
      for (const row of database.prepare(`SELECT ${col.name} AS v FROM ${name} WHERE ${col.name} LIKE '%/uploads/%'`).all()) {
        for (const m of row.v.matchAll(/\/uploads\/([\w.-]+)/g)) used.add(m[1]);
      }
    }
  }
}

// Supprime les images importées que ni la base ni aucune sauvegarde conservée ne référencent :
// restaurer une sauvegarde ne fait jamais perdre de photo
export function cleanUploads() {
  const used = new Set();
  collectUploads(db, used);
  mkdirSync(BACKUP_DIR, { recursive: true });
  for (const file of backups()) {
    const copy = new DatabaseSync(path.join(BACKUP_DIR, file), { readOnly: true });
    try { collectUploads(copy, used); } finally { copy.close(); }
  }
  const removed = [];
  for (const file of readdirSync(UPLOAD_DIR)) {
    const full = path.join(UPLOAD_DIR, file);
    if (used.has(file) || Date.now() - statSync(full).mtimeMs < ORPHAN_GRACE_MS) continue;
    rmSync(full);
    removed.push(file);
  }
  return removed;
}

// Lancée au démarrage puis toutes les heures : purge des sessions expirées, une sauvegarde par jour au plus
export function dailyMaintenance() {
  purgeExpired();
  mkdirSync(BACKUP_DIR, { recursive: true });
  const last = backups().at(-1);
  if (last && Date.now() - statSync(path.join(BACKUP_DIR, last)).mtimeMs < DAY_MS) return;
  try {
    console.log(`Sauvegarde : ${backup()}`);
    const removed = cleanUploads();
    if (removed.length) console.log(`${removed.length} image(s) inutilisée(s) supprimée(s)`);
  } catch (err) {
    console.error('Maintenance quotidienne en échec :', err);
  }
}

// npm run backup : sauvegarde immédiate
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`Sauvegarde : ${backup()}`);
