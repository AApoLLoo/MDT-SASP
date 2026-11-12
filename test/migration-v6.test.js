import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Base existante en v5 : users et arrest_reports avec leurs anciennes contraintes CHECK
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdt-v6-'));
const old = new DatabaseSync(path.join(process.env.DATA_DIR, 'mdt.sqlite'));
old.exec(`
CREATE TABLE users (
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
CREATE TABLE arrest_reports (
  id INTEGER PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  citizen_id INTEGER,
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
INSERT INTO users (id, matricule, role, password_hash) VALUES (1, 'A1', 'admin', 'x');
INSERT INTO arrest_reports (numero, redacteur_id, statut, faits) VALUES ('SASP-OLD', 1, 'finalise', 'Vol à l''étalage');
PRAGMA user_version = 5;
`);
old.close();

const { db } = await import('../server/db.js');
const { hasRole, canJudge } = await import('../server/auth.js');

test('v6 : rôles justice et statut en_attente acceptés, données conservées', () => {
  assert.ok(db.prepare('PRAGMA user_version').get().user_version >= 6, 'v6 appliquée (et les suivantes)');
  const rep = db.prepare('SELECT statut, faits FROM arrest_reports WHERE numero = ?').get('SASP-OLD');
  assert.equal(rep.statut, 'finalise');
  assert.equal(rep.faits, "Vol à l'étalage");
  db.prepare(`INSERT INTO users (matricule, role, password_hash) VALUES ('J1', 'magistrat', 'x')`).run();
  db.prepare(`INSERT INTO users (matricule, role, password_hash) VALUES ('L1', 'avocat', 'x')`).run();
  db.prepare(`UPDATE arrest_reports SET statut = 'en_attente' WHERE numero = 'SASP-OLD'`).run();
  const cols = db.prepare('PRAGMA table_info(arrest_reports)').all().map(c => c.name);
  for (const c of ['avocat_id', 'calc_input_police', 'calc_result_police', 'depose_at', 'juge_id', 'renvoi_motif', 'blanchi_at', 'blanchi_par', 'blanchi_motif']) assert.ok(cols.includes(c), c);
  assert.ok(db.prepare('PRAGMA table_info(complaints)').all().some(c => c.name === 'avocat_ids'));
  assert.ok(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_reports_citizen'`).get(), 'index recréé');
});

test('magistrat et avocat hors hiérarchie police', () => {
  assert.equal(hasRole({ role: 'magistrat' }, 'agent'), false);
  assert.equal(hasRole({ role: 'avocat' }, 'agent'), false);
  assert.equal(canJudge({ role: 'magistrat' }), true);
  assert.equal(canJudge({ role: 'admin' }), true);
  assert.equal(canJudge({ role: 'etat_major' }), false);
  assert.equal(canJudge({ role: 'avocat' }), false);
});
