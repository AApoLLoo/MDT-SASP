import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GRADES, GRADES_SWAT, GRADES_BCI, DIVISIONS, QUALIFICATIONS } from '../public/mdt/js/reference-data.js';
import { SECTEURS, POSTES } from '../public/mdt/js/service-kinds.js';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'mdt.sqlite'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  matricule TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nom TEXT NOT NULL DEFAULT '',
  prenom TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'superviseur', 'etat_major', 'admin')),
  password_hash TEXT NOT NULL,
  actif INTEGER NOT NULL DEFAULT 1,
  photo_url TEXT NOT NULL DEFAULT '',
  telephone TEXT NOT NULL DEFAULT '',
  discord TEXT NOT NULL DEFAULT '',
  division TEXT NOT NULL DEFAULT '',
  date_entree TEXT NOT NULL DEFAULT '',
  qualifications TEXT NOT NULL DEFAULT '[]',
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  categorie TEXT NOT NULL CHECK (categorie IN ('generale', 'operationnelle', 'academy', 'division')),
  division TEXT NOT NULL DEFAULT '',
  titre TEXT NOT NULL,
  contenu TEXT NOT NULL DEFAULT '',
  importance TEXT NOT NULL DEFAULT 'normale' CHECK (importance IN ('normale', 'importante', 'urgente')),
  epingle INTEGER NOT NULL DEFAULT 0,
  image_url TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lecture des annonces, agent par agent
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS citizens (
  id INTEGER PRIMARY KEY,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL DEFAULT '',
  date_naissance TEXT NOT NULL DEFAULT '',
  id_unique TEXT UNIQUE,
  empreinte TEXT NOT NULL DEFAULT '',
  telephone TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY,
  plaque TEXT NOT NULL UNIQUE COLLATE NOCASE,
  modele TEXT NOT NULL DEFAULT '',
  couleur TEXT NOT NULL DEFAULT '',
  proprietaire TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'vole' CHECK (statut IN ('vole', 'retrouve')),
  date_vol TEXT NOT NULL DEFAULT '',
  lieu_vol TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  declare_par INTEGER REFERENCES users(id),
  retrouve_le TEXT,
  lieu_retrouve TEXT NOT NULL DEFAULT '',
  retrouve_par INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warrants (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('mandat', 'bolo_personne', 'bolo_vehicule')),
  citizen_id INTEGER REFERENCES citizens(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  motif TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'clos')),
  created_by INTEGER REFERENCES users(id),
  closed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS arrest_reports (
  id INTEGER PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  citizen_id INTEGER REFERENCES citizens(id) ON DELETE SET NULL,
  suspect TEXT NOT NULL DEFAULT '{}',
  date_rapport TEXT NOT NULL DEFAULT '',
  date_faits TEXT NOT NULL DEFAULT '',
  redacteur_id INTEGER NOT NULL REFERENCES users(id),
  agents_presents TEXT NOT NULL DEFAULT '[]',
  miranda_heure TEXT NOT NULL DEFAULT '',
  miranda_par TEXT NOT NULL DEFAULT '',
  objets_illegaux TEXT NOT NULL DEFAULT '[]',
  faits TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '{}',
  calc_input TEXT NOT NULL DEFAULT '{}',
  calc_result TEXT,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'finalise')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  finalized_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_citizen ON arrest_reports(citizen_id);

CREATE TABLE IF NOT EXISTS complaints (
  id INTEGER PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  statut TEXT NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'en_cours', 'classee', 'resolue')),
  plaignant_id INTEGER REFERENCES citizens(id) ON DELETE SET NULL,
  plaignant TEXT NOT NULL DEFAULT '{}',
  mis_en_cause_id INTEGER REFERENCES citizens(id) ON DELETE SET NULL,
  mis_en_cause TEXT NOT NULL DEFAULT '{}',
  date_depot TEXT NOT NULL DEFAULT '',
  date_faits TEXT NOT NULL DEFAULT '',
  lieu_faits TEXT NOT NULL DEFAULT '',
  qualifications TEXT NOT NULL DEFAULT '[]',
  recit TEXT NOT NULL DEFAULT '',
  prejudice TEXT NOT NULL DEFAULT '',
  temoins TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '{}',
  suivi TEXT NOT NULL DEFAULT '',
  report_id INTEGER REFERENCES arrest_reports(id) ON DELETE SET NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS patrol_units (
  id INTEGER PRIMARY KEY,
  indicatif TEXT NOT NULL UNIQUE COLLATE NOCASE,
  statut TEXT NOT NULL DEFAULT 'disponible',
  secteur TEXT NOT NULL DEFAULT '',
  poste TEXT NOT NULL DEFAULT '',
  vehicule TEXT NOT NULL DEFAULT '',
  agents TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Convocations, absences, matériel perdu, sanctions (champs propres à chaque type dans data)
CREATE TABLE IF NOT EXISTS service_records (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  agent_id INTEGER NOT NULL REFERENCES users(id),
  statut TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_service_records ON service_records(kind, agent_id);

CREATE TABLE IF NOT EXISTS penal_code (
  id INTEGER PRIMARY KEY,
  classification TEXT NOT NULL DEFAULT '',
  categorie TEXT NOT NULL CHECK (categorie IN ('Contravention', 'Délit mineur', 'Délit majeur', 'Crime')),
  infraction TEXT NOT NULL,
  amende REAL NOT NULL DEFAULT 0,
  supplements TEXT NOT NULL DEFAULT '',
  peine_minutes INTEGER NOT NULL DEFAULT 0,
  actif INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS weapons (
  id INTEGER PRIMARY KEY,
  groupe TEXT NOT NULL DEFAULT '',
  categorie TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  nom TEXT NOT NULL,
  amende_detention REAL NOT NULL DEFAULT 0,
  amende_utilisation REAL NOT NULL DEFAULT 0
);

-- Rapports d'incident : usage de la force, poursuite, intervention à haut risque…
-- (champs propres au type dans details, définis dans public/mdt/js/incident-kinds.js)
CREATE TABLE IF NOT EXISTS incident_reports (
  id INTEGER PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'finalise')),
  date_faits TEXT NOT NULL DEFAULT '',
  heure TEXT NOT NULL DEFAULT '',
  lieu TEXT NOT NULL DEFAULT '',
  redacteur_id INTEGER NOT NULL REFERENCES users(id),
  agents_presents TEXT NOT NULL DEFAULT '[]',
  personnes TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}',
  recit TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  finalized_at TEXT
);

-- Scellés : objets saisis conservés comme preuves ; leurs mouvements sont dans audit_log
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  categorie TEXT NOT NULL DEFAULT 'Objet',
  description TEXT NOT NULL,
  quantite TEXT NOT NULL DEFAULT '',
  statut TEXT NOT NULL DEFAULT 'stockee' CHECK (statut IN ('stockee', 'sortie', 'transmise', 'restituee', 'detruite')),
  emplacement TEXT NOT NULL DEFAULT '',
  report_id INTEGER REFERENCES arrest_reports(id) ON DELETE SET NULL,
  incident_id INTEGER REFERENCES incident_reports(id) ON DELETE SET NULL,
  photo_url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_evidence_report ON evidence(report_id);
CREATE INDEX IF NOT EXISTS idx_evidence_incident ON evidence(incident_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  label TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// v1 : la table vehicles (registre général) devient le registre des véhicules volés.
// Reconstruction de table recommandée par SQLite, clés étrangères suspendues
// pour que les BOLO qui pointent vers vehicles ne soient pas supprimés.
if (db.prepare('PRAGMA user_version').get().user_version < 1) {
  const oldSchema = db.prepare('PRAGMA table_info(vehicles)').all().some(c => c.name === 'proprietaire_id');
  if (oldSchema) {
    db.exec('PRAGMA foreign_keys = OFF');
    transaction(() => db.exec(`
      CREATE TABLE vehicles_v1 (
        id INTEGER PRIMARY KEY,
        plaque TEXT NOT NULL UNIQUE COLLATE NOCASE,
        modele TEXT NOT NULL DEFAULT '',
        couleur TEXT NOT NULL DEFAULT '',
        proprietaire TEXT NOT NULL DEFAULT '',
        contact TEXT NOT NULL DEFAULT '',
        statut TEXT NOT NULL DEFAULT 'vole' CHECK (statut IN ('vole', 'retrouve')),
        date_vol TEXT NOT NULL DEFAULT '',
        lieu_vol TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        declare_par INTEGER REFERENCES users(id),
        retrouve_le TEXT,
        lieu_retrouve TEXT NOT NULL DEFAULT '',
        retrouve_par INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO vehicles_v1 (id, plaque, modele, couleur, proprietaire, statut, notes, created_at, updated_at)
        SELECT v.id, v.plaque, v.modele, v.couleur, IFNULL(c.prenom || ' ' || c.nom, ''),
          CASE v.statut WHEN 'vole' THEN 'vole' ELSE 'retrouve' END, v.notes, v.created_at, v.updated_at
        FROM vehicles v LEFT JOIN citizens c ON c.id = v.proprietaire_id;
      DROP TABLE vehicles;
      ALTER TABLE vehicles_v1 RENAME TO vehicles;
    `));
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.exec('PRAGMA user_version = 1');
}

// v2 : le MDT est servi sous /mdt/, les liens vers ses photos (« /uploads/x » seul ou dans du JSON) suivent.
// Toutes les colonnes texte sont parcourues, comme pour le nettoyage des images ; une sauvegarde restaurée est migrée au démarrage.
if (db.prepare('PRAGMA user_version').get().user_version < 2) {
  transaction(() => {
    for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all()) {
      for (const col of db.prepare(`PRAGMA table_info("${name}")`).all().filter(c => c.type === 'TEXT')) {
        db.exec(`UPDATE "${name}" SET "${col.name}" = '/mdt' || "${col.name}" WHERE "${col.name}" LIKE '/uploads/%'`);
        db.exec(`UPDATE "${name}" SET "${col.name}" = REPLACE("${col.name}", '"/uploads/', '"/mdt/uploads/') WHERE "${col.name}" LIKE '%"/uploads/%'`);
      }
    }
    db.exec('PRAGMA user_version = 2');
  });
}

// Colonnes ajoutées après coup : créées sur les bases existantes si absentes
function ensureColumns(table, defs) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  for (const [name, def] of Object.entries(defs)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}

ensureColumns('users', {
  photo_url: "TEXT NOT NULL DEFAULT ''",
  telephone: "TEXT NOT NULL DEFAULT ''",
  discord: "TEXT NOT NULL DEFAULT ''",
  division: "TEXT NOT NULL DEFAULT ''",
  date_entree: "TEXT NOT NULL DEFAULT ''",
  qualifications: "TEXT NOT NULL DEFAULT '[]'",
  bio: "TEXT NOT NULL DEFAULT ''",
  grade_swat: "TEXT NOT NULL DEFAULT ''",
  grade_bci: "TEXT NOT NULL DEFAULT ''",
  tuteurs: "TEXT NOT NULL DEFAULT '[]'",
  divisions: "TEXT NOT NULL DEFAULT '[]'",
});

// v3 : un agent peut cumuler plusieurs divisions ; l'ancienne colonne `division` (une seule) est reprise
// dans `divisions` puis vidée, elle n'est plus lue
if (db.prepare('PRAGMA user_version').get().user_version < 3) {
  transaction(() => {
    db.exec(`UPDATE users SET divisions = json_array(division), division = '' WHERE division <> ''`);
    db.exec('PRAGMA user_version = 3');
  });
}

// v4 : rôle « état-major », entre superviseur et administrateur. SQLite ne modifie pas une contrainte CHECK :
// la table users est reconstruite d'après sa définition enregistrée (colonnes ajoutées comprises), clés étrangères
// suspendues pour que les tables qui pointent vers users ne soient pas touchées
if (db.prepare('PRAGMA user_version').get().user_version < 4) {
  const { sql } = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`).get();
  const rebuilt = sql.replace(/CHECK \(role IN \([^)]*\)\)/, `CHECK (role IN ('agent', 'superviseur', 'etat_major', 'admin'))`);
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    transaction(() => {
      if (rebuilt !== sql) db.exec(`
        ${rebuilt.replace(/^CREATE TABLE "?users"?/, 'CREATE TABLE users_v4')};
        INSERT INTO users_v4 SELECT * FROM users;
        DROP TABLE users;
        ALTER TABLE users_v4 RENAME TO users;
      `);
      db.exec('PRAGMA user_version = 4');
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// v5 : le tutorat ne concerne que les rookies (ROOKIE, service-kinds.js) ; les agents déjà promus perdent leurs tuteurs
if (db.prepare('PRAGMA user_version').get().user_version < 5) {
  transaction(() => {
    db.exec(`UPDATE users SET tuteurs = '[]' WHERE tuteurs <> '[]' AND grade NOT LIKE '%rookie%'`);
    db.exec('PRAGMA user_version = 5');
  });
}

ensureColumns('patrol_units', { poste: "TEXT NOT NULL DEFAULT ''" });
// Photos ajoutées aux dossiers : casiers, véhicules volés, mandats et BOLO ({ emplacement: url })
for (const table of ['citizens', 'vehicles', 'warrants']) ensureColumns(table, { photos: "TEXT NOT NULL DEFAULT '{}'" });

function seed(table, file, cols) {
  if (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n) return;
  const rows = JSON.parse(readFileSync(path.join(import.meta.dirname, 'seed', file), 'utf8'));
  const insert = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  transaction(() => rows.forEach(r => insert.run(...cols.map(c => r[c]))));
}

seed('penal_code', 'penal-code.json', ['classification', 'categorie', 'infraction', 'amende', 'supplements', 'peine_minutes']);
seed('weapons', 'weapons.json', ['groupe', 'categorie', 'type', 'nom', 'amende_detention', 'amende_utilisation']);
// Listes réglées par les administrateurs (Administration → Paramètres), créées avec leurs valeurs initiales
export const LIST_DEFAULTS = { grades: GRADES, grades_swat: GRADES_SWAT, grades_bci: GRADES_BCI, divisions: DIVISIONS, qualifications: QUALIFICATIONS, secteurs: SECTEURS, postes: POSTES };
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertSetting.run('defcon', '5');
for (const [key, list] of Object.entries(LIST_DEFAULTS)) insertSetting.run(key, JSON.stringify(list));

export const parseJson = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

export const getDefcon = () => Number(db.prepare(`SELECT value FROM settings WHERE key = 'defcon'`).get().value);
export const getList = key => parseJson(db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value, []);
export const getSettings = () => ({ defcon: getDefcon(), ...Object.fromEntries(Object.keys(LIST_DEFAULTS).map(k => [k, getList(k)])) });
