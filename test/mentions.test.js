import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

// Base jetable : DATA_DIR doit être fixé avant le chargement de db.js
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdt-mentions-'));
const { db } = await import('../server/db.js');
const { default: incidents } = await import('../server/routes/incidents.js');
const { default: mentions, mentionedMatricules } = await import('../server/routes/mentions.js');

const addUser = (matricule, role = 'agent', actif = 1) =>
  Number(db.prepare('INSERT INTO users (matricule, role, actif, password_hash) VALUES (?, ?, ?, ?)').run(matricule, role, actif, 'x').lastInsertRowid);
const auteur = addUser('A1');
const cible = addUser('S-12');
addUser('J9', 'magistrat');
addUser('X7', 'agent', 0);

let current = auteur;
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: current, role: 'agent', matricule: current === auteur ? 'A1' : 'S-12' }; next(); });
app.use('/incidents', incidents);
app.use('/mentions', mentions);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
const server = app.listen(0);
after(() => server.close());

const call = async (method, url, body) => (await fetch(`http://localhost:${server.address().port}${url}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
})).json();

test('détection des @matricule : sans doublon ni adresse e-mail', () => {
  assert.deepEqual(mentionedMatricules('Vu avec @S-12 et @s-12, puis @A1. Contact : x@mail.com'), ['s-12', 'a1']);
  assert.deepEqual(mentionedMatricules(''), []);
});

test('mention notifiée une fois aux policiers actifs, jamais à son auteur', async () => {
  const { id } = await call('POST', '/incidents', { type: 'autre' });
  let inc = await call('GET', `/incidents/${id}`);
  inc = await call('PUT', `/incidents/${id}`, { updated_at: inc.updated_at, recit: 'Renfort de @s-12, @A1, @J9 et @X7.' });
  await call('PUT', `/incidents/${id}`, { updated_at: inc.updated_at, recit: 'Renfort de @S-12 (corrigé).' });

  current = cible;
  let mine = await call('GET', '/mentions');
  assert.equal(mine.unread, 1, 'une seule mention malgré deux enregistrements');
  assert.equal(mine.items[0].numero, inc.numero);
  assert.equal(mine.items[0].auteur_matricule, 'A1');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mentions').get().n, 1, 'ni auteur, ni magistrat, ni compte désactivé');

  await call('POST', '/mentions/seen');
  mine = await call('GET', '/mentions');
  assert.equal(mine.unread, 0);

  db.prepare('DELETE FROM incident_reports WHERE id = ?').run(id);
  assert.equal((await call('GET', '/mentions')).items.length, 0, 'rapport supprimé : mention masquée');
  current = auteur;
});
