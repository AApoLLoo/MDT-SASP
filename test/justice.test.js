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


// Rapport prêt à déposer : suspect fiché et un chef d'accusation
const chargesInitiales = { charges: [{ code_id: 1, quantite: 1 }] };
async function rapportPret(user) {
  const { id: citizen_id } = (await req('POST', '/citizens', user, { nom: 'Doe', prenom: 'John' })).body;
  return (await req('POST', '/reports', user, { citizen_id, calc_input: chargesInitiales })).body.id;
}

test("circuit : dépôt par l'agent, finalisation par le magistrat seulement", async () => {
  const id = await rapportPret(agent);
  assert.equal((await req('POST', `/reports/${id}/finalize`, agent)).status, 403);
  assert.equal((await req('POST', `/reports/${id}/submit`, agent)).status, 200);
  assert.equal((await req('PUT', `/reports/${id}`, agent, { faits: 'x' })).status, 403);
  assert.equal((await req('PUT', `/reports/${id}`, superviseur, { faits: 'x' })).status, 403);
  assert.equal((await req('POST', `/reports/${id}/finalize`, superviseur)).status, 403);
  assert.equal((await req('PUT', `/reports/${id}/jugement`, superviseur, { calc_input: { charges: [] } })).status, 403);
  await req('PUT', `/reports/${id}/jugement`, magistrat, { calc_input: { charges: [] } });
  assert.equal((await req('POST', `/reports/${id}/finalize`, magistrat)).status, 400, 'aucun chef après jugement');
  await req('PUT', `/reports/${id}/jugement`, magistrat, { calc_input: chargesInitiales });
  const ok = (await req('POST', `/reports/${id}/finalize`, magistrat)).body;
  assert.equal(ok.statut, 'finalise');
  assert.equal(ok.juge.matricule, 'J1');
  assert.ok(ok.calc_result_police, 'calcul police conservé');
  assert.equal((await req('POST', `/reports/${id}/finalize`, magistrat)).status, 400, 'déjà finalisé');
});

test('renvoi et réouverture', async () => {
  const id = await rapportPret(agent);
  await req('POST', `/reports/${id}/submit`, agent);
  assert.equal((await req('POST', `/reports/${id}/send-back`, magistrat, {})).status, 400);
  const back = (await req('POST', `/reports/${id}/send-back`, magistrat, { motif: 'Faits incomplets' })).body;
  assert.equal(back.statut, 'brouillon');
  assert.equal(back.renvoi_motif, 'Faits incomplets');
  assert.equal((await req('PUT', `/reports/${id}`, agent, { faits: 'Complétés' })).status, 200, "l'agent corrige");
  await req('POST', `/reports/${id}/submit`, agent);
  await req('POST', `/reports/${id}/finalize`, admin);
  assert.equal((await req('POST', `/reports/${id}/reopen`, superviseur)).status, 403);
  assert.equal((await req('POST', `/reports/${id}/reopen`, magistrat)).status, 200);
  assert.equal((await req('GET', `/reports/${id}`, magistrat)).body.statut, 'en_attente');
  assert.equal((await req('DELETE', `/reports/${id}`, superviseur)).status, 403, 'un rapport déposé ne se supprime que par un admin');
});

test('avocat rattaché : accès à son dossier seulement', async () => {
  const id = await rapportPret(agent);
  await req('PUT', `/reports/${id}`, agent, { avocat_id: avocat });
  assert.equal((await req('GET', `/reports/${id}`, avocat)).status, 200);
  assert.equal((await req('GET', `/reports/${id}`, avocat2)).status, 403);
  assert.equal((await req('PUT', `/reports/${id}`, agent, { avocat_id: agent })).status, 400);
  assert.deepEqual((await req('GET', '/justice/mes-dossiers', avocat)).body.reports.map(r => r.id), [id]);
  assert.equal((await req('GET', `/reports/${id}`, agent)).body.avocat.matricule, 'L1');
});

test('liste des rapports en attente, du plus ancien au plus récent', async () => {
  const a = await rapportPret(agent);
  const b = await rapportPret(agent);
  await req('POST', `/reports/${b}/submit`, agent);
  db.prepare(`UPDATE arrest_reports SET depose_at = '2026-01-02 10:00:00' WHERE id = ?`).run(b);
  await req('POST', `/reports/${a}/submit`, agent);
  db.prepare(`UPDATE arrest_reports SET depose_at = '2026-01-01 10:00:00' WHERE id = ?`).run(a);
  const list = (await req('GET', '/reports?statut=en_attente', magistrat)).body;
  assert.ok(list.every(r => r.statut === 'en_attente'), 'filtre sur en_attente');
  const ids = list.map(r => r.id);
  assert.ok(ids.includes(a) && ids.indexOf(a) < ids.indexOf(b));
});
