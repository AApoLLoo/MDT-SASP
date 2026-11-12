import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdt-fonctions-'));
const { db } = await import('../server/db.js');
const { default: citizens } = await import('../server/routes/citizens.js');
const { default: tickets } = await import('../server/routes/tickets.js');
const { default: search } = await import('../server/routes/search.js');

const user = role => Number(db.prepare(`INSERT INTO users (matricule, role, password_hash) VALUES (?, ?, 'x')`).run(`${role}-${Math.random()}`, role).lastInsertRowid);
const users = { agent: user('agent'), superviseur: user('superviseur') };
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const role = req.headers['x-role'] ?? 'agent';
  req.user = { id: users[role], role, matricule: role };
  next();
});
app.use('/citizens', citizens);
app.use('/tickets', tickets);
app.use('/search', search);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
const server = app.listen(0);
after(() => server.close());

const call = async (method, url, body, role = 'agent') => {
  const res = await fetch(`http://localhost:${server.address().port}${url}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-role': role }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const code = categorie => db.prepare('SELECT id, amende FROM penal_code WHERE categorie = ? AND actif = 1 LIMIT 1').get(categorie);
const citizen = async fields => (await call('POST', '/citizens', fields)).body.id;

test('amendes : contraventions seules, montant repris du Code pénal, réglée par un agent, supprimée par un superviseur', async () => {
  const id = await citizen({ nom: 'Conducteur' });
  const c = code('Contravention');
  assert.equal((await call('POST', '/tickets', { citizen_id: id, charges: [{ code_id: code('Crime').id }] })).status, 400, 'crime refusé');
  assert.equal((await call('POST', '/tickets', { citizen_id: id, charges: [] })).status, 400, 'au moins une infraction');

  const { status, body: t } = await call('POST', '/tickets', { citizen_id: id, plaque: 'ab12', charges: [{ code_id: c.id, quantite: 2, amende: 1 }] });
  assert.equal(status, 201);
  assert.match(t.numero, /^PV-\d{4}-0001$/);
  assert.equal(t.montant, c.amende * 2, 'montant du Code pénal, pas du client');
  assert.equal(t.plaque, 'AB12');
  assert.equal(t.statut, 'impayee');
  assert.equal((await call('GET', `/citizens/${id}`)).body.tickets.length, 1, 'visible sur la fiche');

  assert.equal((await call('PUT', `/tickets/${t.id}/statut`, { statut: 'payee' })).body.statut, 'payee');
  assert.equal((await call('GET', '/tickets?statut=impayee')).body.length, 0);
  assert.equal((await call('DELETE', `/tickets/${t.id}`)).status, 403, 'agent : pas de suppression');
  assert.equal((await call('DELETE', `/tickets/${t.id}`, undefined, 'superviseur')).status, 200);
});

test('fusion : le doublon est absorbé (documents, enquêtes, champs vides, photos) puis supprimé', async () => {
  const keep = await citizen({ nom: 'Doe', prenom: 'John', notes: 'gardée', photos: { photo_1: '/mdt/uploads/a.png' } });
  const dup = await citizen({ nom: 'Doe', prenom: 'Jhon', id_unique: '999', alias: 'JD', notes: 'doublon', photos: { photo_1: '/mdt/uploads/b.png' } });
  const report = Number(db.prepare(`INSERT INTO arrest_reports (numero, citizen_id, suspect, redacteur_id) VALUES ('SASP-T-1', ?, json_object('id', ?, 'nom', 'Doe'), ?)`)
    .run(dup, dup, users.agent).lastInsertRowid);
  db.prepare(`INSERT INTO warrants (type, citizen_id, motif) VALUES ('mandat', ?, 'Vol')`).run(dup);
  db.prepare(`INSERT INTO tickets (numero, citizen_id, agent_id) VALUES ('PV-T-1', ?, ?)`).run(dup, users.agent);
  const enquete = Number(db.prepare(`INSERT INTO service_records (kind, agent_id, statut, data) VALUES ('enquetes', ?, 'ouverte', ?)`)
    .run(users.agent, JSON.stringify({ personnes: [{ role: 'Suspect', nom: 'Jhon Doe', citoyen: String(dup) }] })).lastInsertRowid);

  assert.equal((await call('POST', `/citizens/${keep}/merge`, { source_id: dup })).status, 403, 'agent refusé');
  assert.equal((await call('POST', `/citizens/${keep}/merge`, { source_id: keep }, 'superviseur')).status, 400, 'pas sur elle-même');
  const { status, body } = await call('POST', `/citizens/${keep}/merge`, { source_id: dup }, 'superviseur');
  assert.equal(status, 200);
  assert.deepEqual([body.rapports, body.mandats, body.amendes, body.enquetes], [1, 1, 1, 1]);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM citizens WHERE id = ?').get(dup).n, 0, 'doublon supprimé');
  const c = (await call('GET', `/citizens/${keep}`)).body;
  assert.equal(c.prenom, 'John', 'identité de la fiche gardée');
  assert.equal(c.id_unique, '999', 'n° sécu repris (unique)');
  assert.equal(c.alias, 'JD');
  assert.match(c.notes, /gardée[\s\S]*doublon/);
  assert.deepEqual(Object.values(c.photos).sort(), ['/mdt/uploads/a.png', '/mdt/uploads/b.png']);
  assert.equal(c.reports[0].id, report);
  assert.equal(JSON.parse(db.prepare('SELECT suspect FROM arrest_reports WHERE id = ?').get(report).suspect).id, keep);
  assert.equal(c.warrants.length, 1);
  assert.equal(c.tickets.length, 1);
  assert.equal(JSON.parse(db.prepare('SELECT data FROM service_records WHERE id = ?').get(enquete).data).personnes[0].citoyen, String(keep));
  assert.match(db.prepare('SELECT details FROM audit_log ORDER BY id DESC LIMIT 1').get().details, /Jhon Doe .*ID 999/);
});

test('alias, signalement, affiliation : enregistrés, cherchables, groupes proposés', async () => {
  const id = await citizen({ nom: 'Smith', alias: 'Le Fantôme', affiliation: 'Ballas', signalement: 'Tatouage au cou' });
  await citizen({ nom: 'Jones', affiliation: 'ballas' });
  const c = (await call('GET', `/citizens/${id}`)).body;
  assert.deepEqual([c.alias, c.affiliation, c.signalement], ['Le Fantôme', 'Ballas', 'Tatouage au cou']);
  assert.equal((await call('GET', '/citizens?q=fant')).body[0].id, id, 'recherche par alias');
  const groupes = (await call('GET', '/citizens/affiliations')).body;
  assert.equal(groupes.length, 1, 'casse ignorée');
  assert.equal(groupes[0].membres, 2);
});

test('recherche globale : citoyens par alias, plaques, numéros de document ; condamnation blanchie cachée', async () => {
  const id = await citizen({ nom: 'Martin', alias: 'Rocket' });
  db.prepare(`INSERT INTO vehicles (plaque, modele) VALUES ('ZZ999', 'Sultan')`).run();
  db.prepare(`INSERT INTO arrest_reports (numero, citizen_id, redacteur_id, statut, blanchi_at) VALUES ('SASP-B-1', ?, ?, 'finalise', datetime('now'))`).run(id, users.agent);

  assert.deepEqual((await call('GET', '/search?q=r')).body, [], 'deux caractères au moins');
  const hit = (q, type) => call('GET', `/search?q=${q}`).then(r => r.body.filter(x => x.type === type));
  assert.equal((await hit('rocket', 'citizen'))[0].id, id);
  assert.match((await hit('rocket', 'citizen'))[0].detail, /Rocket/);
  assert.equal((await hit('zz9', 'vehicle'))[0].titre, 'ZZ999');
  assert.equal((await hit('PV-T', 'ticket')).length, 1);
  assert.equal((await hit('SASP-B', 'report')).length, 0, 'blanchi : invisible pour la police');
});
