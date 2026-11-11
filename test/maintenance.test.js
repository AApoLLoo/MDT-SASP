import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Base et dossier d'uploads jetables : DATA_DIR doit être fixé avant le chargement de db.js
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdt-test-'));
const { db, UPLOAD_DIR } = await import('../server/db.js');
const { backup, cleanUploads } = await import('../server/maintenance.js');

const upload = (name, ageDays) => {
  const file = path.join(UPLOAD_DIR, name);
  writeFileSync(file, 'x');
  const t = (Date.now() - ageDays * 86400000) / 1000;
  utimesSync(file, t, t);
  return file;
};

test('sauvegarde lisible contenant les données', () => {
  db.prepare(`INSERT INTO citizens (nom) VALUES ('Sauvegarde')`).run();
  const copy = new DatabaseSync(backup(), { readOnly: true });
  assert.equal(copy.prepare(`SELECT COUNT(*) AS n FROM citizens WHERE nom = 'Sauvegarde'`).get().n, 1);
  copy.close();
});

test('seules les images orphelines et anciennes sont supprimées', () => {
  const inDb = upload('photo-db.png', 30);
  const inBackup = upload('photo-backup.png', 30);
  const orphan = upload('orphan.png', 30);
  const recent = upload('recent.png', 1);

  db.prepare(`INSERT INTO citizens (nom, photo_url) VALUES ('Ancien', '/uploads/photo-backup.png')`).run();
  backup();
  db.prepare(`DELETE FROM citizens WHERE nom = 'Ancien'`).run();
  db.prepare(`INSERT INTO citizens (nom, notes) VALUES ('Actuel', 'Voir /uploads/photo-db.png')`).run();

  assert.deepEqual(cleanUploads(), ['orphan.png']);
  assert.ok(existsSync(inDb), 'référencée par la base');
  assert.ok(existsSync(inBackup), 'référencée par une sauvegarde conservée');
  assert.ok(existsSync(recent), 'importée récemment');
  assert.ok(!existsSync(orphan));
});
