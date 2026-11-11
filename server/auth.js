import { Router } from 'express';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, parseJson } from './db.js';
import { fail, str } from './util.js';

const COOKIE = 'mdt_session';
const SESSION_MS = 7 * 24 * 3600 * 1000;
const RENEW_AFTER_MS = 24 * 3600 * 1000;
// Dans l'ordre hiérarchique : chaque rôle a les droits des précédents (hasRole)
export const ROLES = ['agent', 'superviseur', 'etat_major', 'admin'];

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  return timingSafeEqual(scryptSync(password, Buffer.from(salt, 'hex'), expected.length), expected);
}

export function checkPassword(password) {
  if (str(password).length < 8) fail(400, 'Le mot de passe doit contenir au moins 8 caractères');
}

export const hasRole = (user, role) => ROLES.indexOf(user?.role) >= ROLES.indexOf(role);

// Comptes justice : hors de la hiérarchie police (hasRole(magistrat, 'agent') est faux, ils n'héritent de rien)
export const JUSTICE_ROLES = ['magistrat', 'avocat'];
export const ALL_ROLES = [...ROLES, ...JUSTICE_ROLES];
// Fonction affichée, portée par la colonne grade
export const JUSTICE_FONCTIONS = { magistrat: ['Procureur', 'Juge'], avocat: ['Avocat'] };
export const isJustice = user => JUSTICE_ROLES.includes(user?.role);
// Juger, finaliser, rouvrir, blanchir : magistrats et administrateurs
export const canJudge = user => user?.role === 'magistrat' || hasRole(user, 'admin');
export const requireJudge = (req, res, next) => (canJudge(req.user) ? next() : res.status(403).json({ error: 'Réservé aux magistrats' }));

function readCookie(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === COOKIE) return value;
  }
  return null;
}

function setSessionCookie(req, res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_MS, path: '/' });
}

export function authenticate(req, res, next) {
  const token = readCookie(req);
  if (token) {
    const row = db.prepare(`
      SELECT u.id, u.matricule, u.nom, u.prenom, u.grade, u.role, u.photo_url, u.divisions, u.qualifications, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND u.actif = 1`).get(token);
    if (row && row.expires_at > Date.now()) {
      // Session glissante : prolongée au plus une fois par jour
      if (row.expires_at - Date.now() < SESSION_MS - RENEW_AFTER_MS) {
        db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(Date.now() + SESSION_MS, token);
        setSessionCookie(req, res, token);
      }
      const { expires_at, ...user } = row;
      req.user = { ...user, divisions: parseJson(user.divisions, []), qualifications: parseJson(user.qualifications, []) };
      req.sessionToken = token;
    }
  }
  next();
}

// Comptes du MDT pour l'espace agent du site public : superviseurs, état-major et administrateurs y forment le commandement
const officer = u => (u ? { matricule: u.matricule, name: [u.prenom, u.nom].filter(Boolean).join(' '), rank: u.grade, command: hasRole(u, 'superviseur') } : null);
const activeUser = matricule => db.prepare('SELECT * FROM users WHERE matricule = ? AND actif = 1').get(matricule);
export const siteAuth = {
  find: matricule => officer(activeUser(matricule)),
  verify: (matricule, password) => {
    const user = activeUser(matricule);
    return user && verifyPassword(password, user.password_hash) ? officer(user) : null;
  },
};

export const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Session expirée, reconnectez-vous' }));

export const requireRole = role => (req, res, next) => (hasRole(req.user, role) ? next() : res.status(403).json({ error: 'Droits insuffisants' }));

// Anti-bruteforce : 5 échecs par IP + matricule bloquent 15 minutes
const failures = new Map();
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;

export function ensureAdmin() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n) return;
  const matricule = process.env.ADMIN_MATRICULE || 'admin';
  const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  db.prepare(`INSERT INTO users (matricule, nom, grade, role, password_hash) VALUES (?, 'Administrateur', 'Chief', 'admin', ?)`)
    .run(matricule, hashPassword(password));
  console.log('\n=== Compte administrateur créé ===');
  console.log(`  Matricule : ${matricule}`);
  console.log(`  Mot de passe : ${process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD)' : password}`);
  console.log('  Changez ce mot de passe après la première connexion.\n');
}

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const matricule = str(req.body?.matricule);
  const password = str(req.body?.password);
  const key = `${req.ip}|${matricule.toLowerCase()}`;
  const entry = failures.get(key);
  if (entry && entry.count >= MAX_FAILURES && entry.until > Date.now()) {
    fail(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
  }
  const user = db.prepare('SELECT * FROM users WHERE matricule = ? AND actif = 1').get(matricule);
  if (!user || !verifyPassword(password, user.password_hash)) {
    const count = entry && entry.until > Date.now() ? entry.count + 1 : 1;
    failures.set(key, { count, until: Date.now() + LOCK_MS });
    fail(401, 'Matricule ou mot de passe incorrect');
  }
  failures.delete(key);
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, Date.now() + SESSION_MS);
  setSessionCookie(req, res, token);
  const { id, nom, prenom, grade, role, photo_url } = user;
  res.json({ user: { id, matricule: user.matricule, nom, prenom, grade, role, photo_url, divisions: parseJson(user.divisions, []), qualifications: parseJson(user.qualifications, []) } });
});

authRouter.post('/logout', (req, res) => {
  if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

authRouter.post('/password', requireAuth, (req, res) => {
  const { current, next } = req.body ?? {};
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(str(current), user.password_hash)) fail(400, 'Mot de passe actuel incorrect');
  checkPassword(next);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(str(next)), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user.id, req.sessionToken);
  res.json({ ok: true });
});
