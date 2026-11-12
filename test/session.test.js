import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdt-session-'));
const { db } = await import('../server/db.js');
const { authRouter, authenticate, hashPassword } = await import('../server/auth.js');

const TWELVE_HOURS = 12 * 3600 * 1000;
db.prepare('INSERT INTO users (matricule, role, password_hash) VALUES (?, ?, ?)').run('S12', 'agent', hashPassword('motdepasse12'));

const app = express();
app.use(express.json());
app.use(authenticate);
app.use('/auth', authRouter);
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
const server = app.listen(0);
after(() => server.close());
const url = p => `http://localhost:${server.address().port}${p}`;

test('session MDT : 12 heures fixes, jamais prolongée, reconnexion ensuite', async () => {
  const login = await fetch(url('/auth/login'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matricule: 'S12', password: 'motdepasse12' }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /Max-Age=43200/, 'cookie de 12 h');
  const cookie = setCookie.split(';')[0];
  const token = cookie.split('=')[1];
  const { expires_at } = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token);
  assert.ok(Math.abs(expires_at - (Date.now() + TWELVE_HOURS)) < 60000, 'expire 12 h après la connexion');

  // Une session déjà entamée n'est pas prolongée par l'utilisation
  const nearEnd = Date.now() + 3600 * 1000;
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(nearEnd, token);
  const me = await fetch(url('/auth/me'), { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('set-cookie'), null, 'aucun cookie renouvelé');
  assert.equal(db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token).expires_at, nearEnd);

  // Au-delà : il faut se reconnecter
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(Date.now() - 1000, token);
  assert.equal((await fetch(url('/auth/me'), { headers: { Cookie: cookie } })).status, 401);
});
