// Temps réel du MDT : chaque écriture réussie est signalée aux autres agents connectés (flux SSE).
// Seul le nom de la ressource circule (« warrants », « reports »…), jamais son contenu :
// la page concernée recharge ses données par l'API, avec les contrôles de droits habituels.
import { sessionUser } from './auth.js';

const clients = new Set();
const PING_MS = 25000;
// Écritures sans intérêt pour les autres : annonces lues, envoi de photo, croquis (qui a son propre flux)
const SILENT = /^\/(uploads$|announcements\/seen$|service\/[^/]+\/\d+\/live\/)/;

const send = (client, topic) => client.res.write(`event: change\ndata: ${topic}\n\n`);

export function events(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  res.write(': connecté\n\n');
  const client = { res, userId: req.user.id };
  clients.add(client);
  // Ping (garde la connexion ouverte derrière un reverse proxy) et contrôle de la session :
  // déconnexion, expiration ou compte désactivé ferment le flux, et la reconnexion d'EventSource reçoit alors un 401
  const ping = setInterval(() => {
    if (sessionUser(req.sessionToken)?.id !== client.userId) return res.end();
    res.write(': ping\n\n');
  }, PING_MS);
  res.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

// À monter sur /api après requireAuth : la ressource est le premier segment du chemin
export function broadcastChanges(req, res, next) {
  if (req.method === 'GET' || SILENT.test(req.path)) return next();
  const topic = req.path.split('/')[1];
  const author = req.user.id;
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    for (const client of clients) if (client.userId !== author) send(client, topic);
  });
  next();
}
