import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

// Base jetable : DATA_DIR doit être fixé avant le chargement de db.js
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdt-justice-'));
const { db } = await import('../server/db.js');
const { siteAuth } = await import('../server/auth.js');
const { justiceGate, default: justice } = await import('../server/justice.js');
const routes = Object.fromEntries(await Promise.all(
  ['citizens', 'vehicles', 'warrants', 'reports', 'incidents', 'evidence', 'complaints', 'service', 'announcements', 'users', 'reference', 'misc']
    .map(async name => [name, (await import(`../server/routes/${name}.js`)).default]),
));

const addUser = (matricule, role, grade = '') => Number(db.prepare(
  'INSERT INTO users (matricule, role, grade, password_hash) VALUES (?, ?, ?, ?)').run(matricule, role, grade, 'x').lastInsertRowid);
const agent = addUser('A1', 'agent');
const superviseur = addUser('S1', 'superviseur');
const admin = addUser('AD1', 'admin');
const magistrat = addUser('J1', 'magistrat', 'Juge');
const avocat = addUser('L1', 'avocat', 'Avocat');
const avocat2 = addUser('L2', 'avocat', 'Avocat');

// Montage comme server/index.js ; l'utilisateur courant est choisi par l'en-tête x-user (id)
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = db.prepare('SELECT id, matricule, nom, prenom, grade, role FROM users WHERE id = ?').get(Number(req.get('x-user')));
  req.user.divisions = [];
  req.user.qualifications = [];
  next();
});
app.use(justiceGate);
for (const name of ['citizens', 'vehicles', 'warrants', 'reports', 'incidents', 'evidence', 'complaints', 'service', 'announcements', 'users']) app.use(`/${name}`, routes[name]);
app.use('/justice', justice);
app.use(routes.reference);
app.use(routes.misc);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
const server = app.listen(0);
after(() => server.close());

const req = async (method, url, user, body) => {
  const res = await fetch(`http://localhost:${server.address().port}${url}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-user': String(user) }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test('barrière : le magistrat lit les dossiers, pas le personnel', async () => {
  assert.equal((await req('GET', '/citizens', magistrat)).status, 200);
  assert.equal((await req('GET', '/service/units', magistrat)).status, 403);
  assert.equal((await req('GET', '/audit', magistrat)).status, 403);
  assert.equal((await req('GET', '/announcements', magistrat)).status, 403);
  assert.equal((await req('POST', '/warrants', magistrat, { type: 'bolo_personne', motif: 'Vol', description: 'Veste rouge' })).status, 201);
});

test("barrière : l'avocat ne voit que ses dossiers", async () => {
  assert.equal((await req('GET', '/citizens', avocat)).status, 403);
  assert.equal((await req('GET', '/reports', avocat)).status, 403);
  assert.equal((await req('POST', '/warrants', avocat, { type: 'bolo_personne', motif: 'Vol', description: 'x' })).status, 403);
  assert.equal((await req('GET', '/justice/mes-dossiers', avocat)).status, 200);
  assert.equal((await req('GET', '/justice/mes-dossiers', agent)).status, 403);
});

test('annuaire : les comptes justice ne sont pas des agents', async () => {
  const roles = (await req('GET', '/users', agent)).body.map(u => u.role);
  assert.ok(!roles.includes('magistrat') && !roles.includes('avocat'));
  assert.deepEqual((await req('GET', '/users/avocats', agent)).body.map(u => u.matricule).sort(), ['L1', 'L2']);
  assert.equal((await req('GET', '/users?justice=1', agent)).status, 403);
  assert.equal((await req('GET', '/users?justice=1', admin)).body.length, 3);
});

test('comptes justice : fonction contrôlée, site public refusé', async () => {
  assert.equal((await req('POST', '/users', admin, { matricule: 'J9', role: 'magistrat', grade: 'Officier I', password: '12345678' })).status, 400);
  assert.equal((await req('POST', '/users', admin, { matricule: 'J9', role: 'magistrat', grade: 'Procureur', password: '12345678' })).status, 201);
  assert.equal(siteAuth.find('J9'), null);
  assert.notEqual(siteAuth.find('A1'), null);
});

