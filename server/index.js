import express from 'express';
import path from 'node:path';
import { ROOT, DATA_DIR, UPLOAD_DIR, getList } from './db.js';
import { authRouter, authenticate, requireAuth, requireRole, ensureAdmin, siteAuth } from './auth.js';
import { createHandler, configFromEnv } from './site/app.js';
import citizens from './routes/citizens.js';
import vehicles from './routes/vehicles.js';
import warrants from './routes/warrants.js';
import reports from './routes/reports.js';
import complaints from './routes/complaints.js';
import service from './routes/service.js';
import announcements from './routes/announcements.js';
import mentions from './routes/mentions.js';
import reference from './routes/reference.js';
import users from './routes/users.js';
import misc from './routes/misc.js';
import incidents from './routes/incidents.js';
import evidence from './routes/evidence.js';
import tickets from './routes/tickets.js';
import search from './routes/search.js';
import admin from './routes/admin.js';
import justice, { justiceGate } from './justice.js';
import bordereau from './bordereau.js';
import { dailyMaintenance } from './maintenance.js';
import { events, broadcastChanges } from './events.js';

ensureAdmin();
dailyMaintenance();
setInterval(dailyMaintenance, 3600 * 1000);

const trustProxy = ['1', 'true'].includes(process.env.TRUST_PROXY);
const app = express();
app.disable('x-powered-by');
if (trustProxy) app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
  });
  next();
});

// Origine illisible (« null » d'une iframe isolée, valeur forgée) : traitée comme un autre site
const sameHost = (origin, host) => {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};

// Refuse les requêtes d'écriture venant d'un autre site
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !sameHost(origin, req.headers.host)) {
    return res.status(403).json({ error: 'Origine refusée' });
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(authenticate);

app.use('/api/auth', authRouter);
app.use('/api', requireAuth);
app.get('/api/events', events);
app.use('/api', broadcastChanges);
app.use('/api', justiceGate);
app.use('/api/justice', justice);
app.use('/api/citizens', citizens);
app.use('/api/vehicles', vehicles);
app.use('/api/warrants', warrants);
app.use('/api/reports/import', bordereau);
app.use('/api/reports', reports);
app.use('/api/incidents', incidents);
app.use('/api/evidence', evidence);
app.use('/api/tickets', tickets);
app.use('/api/search', search);
app.use('/api/complaints', complaints);
app.use('/api/service', service);
app.use('/api/announcements', announcements);
app.use('/api/mentions', mentions);
app.use('/api/users', users);
app.use('/api/admin', requireRole('admin'), admin);
app.use('/api', reference);
app.use('/api', misc);
app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

app.use('/uploads', requireAuth, express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(ROOT, 'public', 'mdt')));

const UNIQUE_MESSAGES = {
  'citizens.id_unique': 'Ce N° de sécu (ID unique) est déjà attribué à un autre citoyen',
  'vehicles.plaque': 'Cette plaque est déjà enregistrée',
  'users.matricule': 'Ce matricule est déjà utilisé',
  'patrol_units.indicatif': 'Cet indicatif est déjà utilisé par une unité en service',
};

app.use((err, req, res, next) => {
  const unique = err.message?.match(/UNIQUE constraint failed: (\S+)/);
  if (unique) return res.status(409).json({ error: UNIQUE_MESSAGES[unique[1]] || 'Cette valeur existe déjà' });
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  const message = status === 413 ? 'Fichier trop volumineux (8 Mo maximum)' : status >= 500 ? 'Erreur serveur' : err.message;
  res.status(status).json({ error: message });
});

// Un seul serveur : le site public à la racine, le MDT sous /mdt/ (barre finale exigée par ses chemins relatifs)
const site = createHandler({
  ...configFromEnv(process.env),
  trustProxy,
  dataDir: path.join(DATA_DIR, 'site'),
  auth: siteAuth,
  mdtList: getList,
  mdtUrl: '/mdt/#/', // cible nommée « mdt » : réutilise l'onglet MDT ouvert sans le recharger
});
const server = express();
server.disable('x-powered-by');
server.use((req, res, next) => (req.path === '/mdt' ? res.redirect(301, '/mdt/') : next()));
server.use('/mdt', app);
server.use(site);

const port = Number(process.env.PORT) || 3000;
server.listen(port, process.env.HOST, () => console.log(`SASP en ligne : http://localhost:${port} (MDT : /mdt/)`));
