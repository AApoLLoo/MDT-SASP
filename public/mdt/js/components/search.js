import { html, highlight } from '../dom.js';
import { api, state } from '../api.js';
import { navigate } from '../router.js';
import { picker } from './picker.js';

// Recherche globale (barre du haut) : citoyens, plaques, mandats actifs, documents par numéro
const TYPES = {
  citizen: ['Citoyen', r => `/casiers/${r.id}`],
  vehicle: ['Véhicule volé', r => `/vehicules?q=${encodeURIComponent(r.titre)}`],
  warrant: ['Mandat / BOLO', r => (r.citizen_id ? `/casiers/${r.citizen_id}` : '/mandats')],
  report: ["Rapport d'arrestation", r => `/rapports/${r.id}`],
  incident: ["Rapport d'incident", r => `/incidents/${r.id}`],
  complaint: ['Plainte', r => `/plaintes/${r.id}`],
  evidence: ['Scellé', r => `/preuves?q=${encodeURIComponent(r.titre)}`],
  ticket: ['Amende', r => `/amendes?q=${encodeURIComponent(r.titre)}`],
  recent: ['Récent', r => r.path],
};
const ALERTES = { citizen: 'Mandat actif', vehicle: 'Volé', warrant: 'Actif', ticket: 'Impayée' };

// Pages de détail consultées récemment, par agent (dans ce navigateur seulement)
const RECENT_MAX = 8;
const recentKey = () => `mdt-recent:${state.user?.id}`;
export function recentPages() {
  try {
    return JSON.parse(localStorage.getItem(recentKey())) ?? [];
  } catch {
    return []; // stockage indisponible ou illisible
  }
}
export function rememberPage(path, titre, detail = '') {
  if (!titre) return;
  const list = [{ type: 'recent', path, titre, detail },...recentPages().filter(r => r.path !== path)].slice(0, RECENT_MAX);
  try { localStorage.setItem(recentKey(), JSON.stringify(list)); } catch { /* historique non mémorisé */ }
}

export const globalSearch = root => picker(root, {
  placeholder: 'Rechercher : nom, alias, plaque, n° de document…  (Ctrl+K)',
  search: q => (q.length < 2 ? Promise.resolve([]) : api(`/search?q=${encodeURIComponent(q)}`)),
  empty: recentPages,
  renderItem: (r, q) => html`<span class="badge">${TYPES[r.type][0]}</span>
    <strong>${highlight(r.titre, q)}</strong><span class="muted grow">${highlight(r.detail, q)}</span>
    ${r.alerte ? html`<span class="badge badge-danger">${ALERTES[r.type]}</span>` : ''}`,
  onSelect: r => navigate(TYPES[r.type][1](r)),
});
