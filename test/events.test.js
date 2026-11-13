import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdt-events-'));
const { db } = await import('../server/db.js');
const { authRouter, authenticate, requireAuth, hashPassword } = await import('../server/auth.js');
const { events, broadcastChanges } = await import('../server/events.js');

for (const m of ['E1', 'E2']) db.prepare('INSERT INTO users (matricule, role, password_hash) VALUES (?, ?, ?)').run(m, 'agent', hashPassword('motdepasse12'));

const app = express();
app.use(express.json());
app.use(authenticate);
app.use('/api/auth', authRouter);
app.use('/api', requireAuth);
app.get('/api/events', events);
app.use('/api', broadcastChanges);
app.post('/api/warrants', (req, res) => res.json({ ok: true }));
app.post('/api/uploads', (req, res) => res.json({ ok: true }));
app.post('/api/reports', (req, res) => res.status(400).json({ error: 'refusé' }));
const server = app.listen(0);
after(() => server.close());
const url = p => `http://localhost:${server.address().port}${p}`;

async function login(matricule) {
  const res = await fetch(url('/api/auth/login'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matricule, password: 'motdepasse12' }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}

const post = (p, cookie) => fetch(url(p), { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });

// Lit le flux jusqu'au délai donné et renvoie les sujets « change » reçus
async function collect(stream, ms) {
  const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  const stop = setTimeout(() => reader.cancel(), ms);
  try {
    for (let r = await reader.read(); !r.done; r = await reader.read()) text += r.value;
  } finally {
    clearTimeout(stop);
  }
  return [...text.matchAll(/event: change\ndata: (\S+)/g)].map(m => m[1]);
}

test('temps réel : écriture signalée aux autres agents, pas à son auteur', async () => {
  const [a, b] = [await login('E1'), await login('E2')];
  const streamA = await fetch(url('/api/events'), { headers: { Cookie: a } });
  const streamB = await fetch(url('/api/events'), { headers: { Cookie: b } });
  assert.equal(streamB.status, 200);
  assert.match(streamB.headers.get('content-type'), /text\/event-stream/);
  const [gotA, gotB] = [collect(streamA, 300), collect(streamB, 300)];

  await post('/api/warrants', a);
  await post('/api/uploads', a); // silencieuse
  await post('/api/reports', a); // échouée : rien à signaler

  assert.deepEqual(await gotB, ['warrants']);
  assert.deepEqual(await gotA, [], "l'auteur n'est pas notifié de sa propre écriture");
});

test('temps réel : flux refusé sans session', async () => {
  assert.equal((await fetch(url('/api/events'))).status, 401);
});
