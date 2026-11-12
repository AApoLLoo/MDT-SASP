import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdt-fiabilite-'));
const { db } = await import('../server/db.js');
const { purgeExpired } = await import('../server/auth.js');
const { cleanPhotos } = await import('../server/util.js');
const { default: citizens } = await import('../server/routes/citizens.js');
const { default: reports } = await import('../server/routes/reports.js');
const { default: incidents } = await import('../server/routes/incidents.js');

const agent = Number(db.prepare(`INSERT INTO users (matricule, role, password_hash) VALUES ('F1', 'agent', 'x')`).run().lastInsertRowid);
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.user = { id: agent, matricule: 'F1', role: 'agent' }; next(); });
app.use('/citizens', citizens);
app.use('/reports', reports);
app.use('/incidents', incidents);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
const server = app.listen(0);
after(() => server.close());

const call = async (method, url, body) => {
  const res = await fetch(`http://localhost:${server.address().port}${url}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

for (const kind of ['reports', 'incidents']) {
  test(`${kind} : une sauvegarde sur une version périmée est refusée (409), sans updated_at elle passe`, async () => {
    const { body: { id } } = await call('POST', `/${kind}`, {});
    const loaded = (await call('GET', `/${kind}/${id}`)).body;
    // Quelqu'un d'autre enregistre entre-temps
    db.prepare(`UPDATE ${kind === 'reports' ? 'arrest_reports' : 'incident_reports'} SET updated_at = '2000-01-01 00:00:00' WHERE id = ?`).run(id);
    assert.equal((await call('PUT', `/${kind}/${id}`, { updated_at: loaded.updated_at, recit: 'x', faits: 'x' })).status, 409);
    const fresh = (await call('GET', `/${kind}/${id}`)).body;
    const ok = await call('PUT', `/${kind}/${id}`, { updated_at: fresh.updated_at, recit: 'y', faits: 'y' });
    assert.equal(ok.status, 200);
    assert.equal((await call('PUT', `/${kind}/${id}`, { recit: 'z', faits: 'z' })).status, 200, 'ancien client sans version');
  });
}

const lastLog = () => db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').get();

test('fiche citoyen : le journal garde les valeurs avant → après, y compris depuis un rapport', async () => {
  const { body: { id } } = await call('POST', '/citizens', { nom: 'Doe', id_unique: '111', notes: 'a' });
  await call('PUT', `/citizens/${id}`, { nom: 'Doe', id_unique: '222', notes: 'b' });
  assert.equal(lastLog().details, 'N° sécu : 111 → 222 · Notes modifiées', 'champs inchangés absents');

  const { body: { id: rep } } = await call('POST', '/reports', { citizen_id: id });
  const numero = db.prepare('SELECT numero FROM arrest_reports WHERE id = ?').get(rep).numero;
  await call('PUT', `/reports/${rep}`, { suspect: { id, nom: 'Doe', id_unique: '333' } });
  const log = lastLog();
  assert.equal(log.entity, 'citizen');
  assert.equal(log.details, `Depuis le rapport ${numero} · N° sécu : 222 → 333`);

  const before = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
  await call('PUT', `/reports/${rep}`, { suspect: { id, nom: 'Doe', id_unique: '333' } });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n, before, 'rien de journalisé sans changement');
});

test('photos : liens http en clair refusés, https gardés', () => {
  assert.deepEqual(cleanPhotos({ a: 'http://i.test/a.jpg', b: 'https://i.test/b.jpg' }), { b: 'https://i.test/b.jpg' });
});

test('maintenance : sessions expirées purgées', () => {
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?), (?, ?, ?)').run('old', agent, Date.now() - 1, 'new', agent, Date.now() + 60000);
  purgeExpired();
  assert.deepEqual(db.prepare('SELECT token FROM sessions').all().map(s => s.token), ['new']);
});
