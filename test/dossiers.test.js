import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

// Base jetable : DATA_DIR doit être fixé avant le chargement de db.js
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdt-test-'));
const { db } = await import('../server/db.js');
const { default: citizens } = await import('../server/routes/citizens.js');
const { default: vehicles } = await import('../server/routes/vehicles.js');
const { default: warrants } = await import('../server/routes/warrants.js');

const agent = Number(db.prepare(`INSERT INTO users (matricule, role, password_hash) VALUES ('A1', 'agent', 'x')`).run().lastInsertRowid);
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: agent, role: 'agent' }; next(); });
app.use('/citizens', citizens);
app.use('/vehicles', vehicles);
app.use('/warrants', warrants);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
const server = app.listen(0);
after(() => server.close());

const call = async (method, url, body) => (await fetch(`http://localhost:${server.address().port}${url}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
})).json();

// Une photo du MDT, un lien, et deux entrées refusées (lien javascript:, emplacement invalide)
const sent = { photo_1: '/mdt/uploads/a.png', photo_2: 'https://i.test/b.jpg', photo_3: 'javascript:alert(1)', 'x y': '/mdt/uploads/c.png' };
const kept = { photo_1: '/mdt/uploads/a.png', photo_2: 'https://i.test/b.jpg' };

test('casiers, véhicules volés et mandats gardent leurs photos, nettoyées', async () => {
  const { id: citizen } = await call('POST', '/citizens', { nom: 'Doe', photos: sent });
  assert.deepEqual((await call('GET', `/citizens/${citizen}`)).photos, kept);
  await call('PUT', `/citizens/${citizen}`, { telephone: '555' });
  assert.deepEqual((await call('GET', `/citizens/${citizen}`)).photos, kept, 'une modification sans photos ne les efface pas');

  const { id: vehicle } = await call('POST', '/vehicles', { plaque: 'ab123', photos: sent });
  assert.deepEqual((await call('GET', '/vehicles'))[0].photos, kept);
  await call('POST', `/vehicles/${vehicle}/found`, {});
  await call('POST', '/vehicles', { plaque: 'AB123', photos: {} });
  assert.deepEqual((await call('GET', '/vehicles'))[0].photos, kept, 'une nouvelle déclaration sans photos garde les précédentes');

  await call('POST', '/warrants', { type: 'bolo_personne', motif: 'Braquage', description: 'Veste rouge', photos: sent });
  assert.deepEqual((await call('GET', '/warrants'))[0].photos, kept);
});
