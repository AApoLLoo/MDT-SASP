import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

// Base jetable : DATA_DIR doit être fixé avant le chargement de db.js
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdt-test-'));
const { db, getList } = await import('../server/db.js');
const { default: admin } = await import('../server/routes/admin.js');

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: null }; next(); });
app.use(admin);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
const server = app.listen(0);
after(() => server.close());

const put = (key, body) => fetch(`http://localhost:${server.address().port}/settings/${key}`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('listes initiales reprises du manuel', () => {
  assert.equal(getList('grades')[0], 'Rookie');
  assert.equal(getList('grades').at(-1), 'Chief');
});

test('renommer un grade ou une qualification met à jour les agents', async () => {
  db.prepare(`INSERT INTO users (matricule, grade, qualifications, password_hash) VALUES ('T1', 'Sergent', '["Formateur","Secourisme"]', 'x')`).run();
  const grades = getList('grades').map(g => (g === 'Sergent' ? 'Sergeant' : g));
  assert.equal((await put('grades', { items: grades, renames: { Sergent: 'Sergeant', Inconnu: 'Rookie' } })).status, 200);
  assert.deepEqual(getList('grades'), grades);

  const qualifs = getList('qualifications').map(q => (q === 'Formateur' ? 'Instructeur' : q));
  await put('qualifications', { items: qualifs, renames: { Formateur: 'Instructeur' } });
  const u = db.prepare(`SELECT grade, qualifications FROM users WHERE matricule = 'T1'`).get();
  assert.equal(u.grade, 'Sergeant');
  assert.deepEqual(JSON.parse(u.qualifications), ['Instructeur', 'Secourisme']);
});

test("renommer une qualification met à jour les formations de l'Academy", async () => {
  const user = db.prepare(`SELECT id FROM users WHERE matricule = 'T1'`).get().id;
  const add = (kind, data) => db.prepare(`INSERT INTO service_records (kind, agent_id, statut, data) VALUES (?, ?, 'x', ?)`).run(kind, user, JSON.stringify(data));
  add('catalogue', { nom: 'Secourisme', rookie: 'Oui' });
  add('catalogue', { nom: 'Brigade canine', prerequis: [{ formation: 'Secourisme' }, { formation: 'Permis moto' }] });
  add('formations', { module: 'Secourisme', note: '15/20' });
  const qualifs = getList('qualifications').map(q => (q === 'Secourisme' ? 'Premiers secours' : q));
  await put('qualifications', { items: qualifs, renames: { Secourisme: 'Premiers secours' } });
  const rows = db.prepare(`SELECT kind, data FROM service_records ORDER BY id`).all().map(r => [r.kind, JSON.parse(r.data)]);
  assert.deepEqual(rows, [
    ['catalogue', { nom: 'Premiers secours', rookie: 'Oui' }],
    ['catalogue', { nom: 'Brigade canine', prerequis: [{ formation: 'Premiers secours' }, { formation: 'Permis moto' }] }],
    ['formations', { module: 'Premiers secours', note: '15/20' }],
  ]);
});

test('doublons et vides retirés, clé inconnue refusée', async () => {
  const res = await put('secteurs', { items: ['Sud', ' sud ', '', 'Nord', 'Est'] });
  assert.deepEqual((await res.json()).items, ['Sud', 'Nord', 'Est']);
  assert.equal((await put('defcon', { items: ['1'] })).status, 404);
  assert.equal((await put('__proto__', { items: [] })).status, 404);
});
