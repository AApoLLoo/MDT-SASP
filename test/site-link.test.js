import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Base jetable en v1, avec des liens de photos d'avant le passage sous /mdt/ : DATA_DIR doit être fixé avant le chargement de db.js
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdt-test-'));
const old = new DatabaseSync(path.join(process.env.DATA_DIR, 'mdt.sqlite'));
old.exec(`CREATE TABLE ancienne (photo TEXT, photos TEXT); PRAGMA user_version = 1;
  INSERT INTO ancienne VALUES ('/uploads/a.png', '{"face":"/uploads/b.png","lien":"https://h.test/uploads/c.png"}');`);
old.close();
const { db } = await import('../server/db.js');
const { siteAuth, hashPassword } = await import('../server/auth.js');

test('migration v2 : les photos du MDT passent sous /mdt/uploads/, les liens externes ne bougent pas', () => {
  assert.deepEqual({ ...db.prepare('SELECT * FROM ancienne').get() }, {
    photo: '/mdt/uploads/a.png',
    photos: '{"face":"/mdt/uploads/b.png","lien":"https://h.test/uploads/c.png"}',
  });
});

test("l'espace agent du site utilise les comptes du MDT", () => {
  const add = db.prepare(`INSERT INTO users (matricule, nom, prenom, grade, role, actif, password_hash) VALUES (?, 'Hayes', 'Jackson', 'Sergent', ?, ?, ?)`);
  add.run('12', 'superviseur', 1, hashPassword('secret-123'));
  add.run('70', 'agent', 1, hashPassword('secret-123'));
  add.run('99', 'admin', 0, hashPassword('secret-123'));

  assert.deepEqual(siteAuth.verify('12', 'secret-123'), { matricule: '12', name: 'Jackson Hayes', rank: 'Sergent', command: true });
  assert.equal(siteAuth.verify('12', 'mauvais'), null);
  assert.equal(siteAuth.find('70').command, false, "un agent n'est pas du commandement");
  assert.equal(siteAuth.verify('99', 'secret-123'), null, 'compte révoqué');
  assert.equal(siteAuth.find('inconnu'), null);
});
