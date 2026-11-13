// @ts-check
// Accès à l'API et cache des données de référence partagées par les vues
// settings : listes réglées par l'administration (grades, divisions, qualifications, secteurs, postes)
export const state = { user: null, defcon: 5, settings: null, penalCode: null, users: null, weapons: null };

let onUnauthorized = () => {};
export const setUnauthorizedHandler = fn => { onUnauthorized = fn; };
// Session expirée en cours d'utilisation : reconnexion sans quitter la page (formulaire en cours conservé).
// Une seule fenêtre pour toutes les requêtes refusées en même temps ; chacune est relancée ensuite.
let onSessionExpired = null;
export const setSessionExpiredHandler = fn => { onSessionExpired = fn; };
let relogin = null;

export async function api(path, options = {}) {
  const { method = 'GET', body, file } = options;
  const opts = { method, headers: {} };
  if (file) {
    opts.body = file;
    opts.headers['Content-Type'] = file.type || 'application/octet-stream';
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch('api' + path, opts);
  const data = await res.json().catch(() => null);
  if (res.status === 401 && !path.startsWith('/auth/') && state.user && onSessionExpired) {
    relogin ??= onSessionExpired().finally(() => { relogin = null; });
    await relogin;
    return api(path, options);
  }
  if (res.status === 401 && !path.startsWith('/auth/')) {
    state.user = null;
    onUnauthorized();
  }
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data;
}

export async function loadPenalCode(force = false) {
  if (!state.penalCode || force) state.penalCode = await api('/penal-code');
  return state.penalCode;
}

export async function loadUsers(force = false) {
  if (!state.users || force) state.users = await api('/users');
  return state.users;
}

export async function loadWeapons() {
  if (!state.weapons) state.weapons = await api('/weapons');
  return state.weapons;
}

export const userByMatricule = m => state.users?.find(u => u.matricule.toLowerCase() === String(m).toLowerCase());

const ROLES = ['agent', 'superviseur', 'etat_major', 'admin'];
export const hasRole = role => ROLES.indexOf(state.user?.role) >= ROLES.indexOf(role);

// Comptes justice (miroir de server/auth.js) : hors hiérarchie police, hasRole(...) est faux pour eux
export const isMagistrat = () => state.user?.role === 'magistrat';
export const isAvocat = () => state.user?.role === 'avocat';
export const isJustice = () => isMagistrat() || isAvocat();
export const canJudge = () => isMagistrat() || hasRole('admin');

export async function loadAvocats(force = false) {
  if (!state.avocats || force) state.avocats = await api('/users/avocats');
  return state.avocats;
}

export async function uploadImage(file) {
  const { url } = await api('/uploads', { method: 'POST', file });
  return url;
}
