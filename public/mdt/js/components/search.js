import { html } from '../dom.js';
import { api } from '../api.js';
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
};
const ALERTES = { citizen: 'Mandat actif', vehicle: 'Volé', warrant: 'Actif', ticket: 'Impayée' };

export const globalSearch = root => picker(root, {
  placeholder: 'Rechercher : nom, alias, plaque, n° de document…  (Ctrl+K)',
  search: q => (q.length < 2 ? Promise.resolve([]) : api(`/search?q=${encodeURIComponent(q)}`)),
  renderItem: r => html`<span class="badge">${TYPES[r.type][0]}</span>
    <strong>${r.titre}</strong><span class="muted grow">${r.detail}</span>
    ${r.alerte ? html`<span class="badge badge-danger">${ALERTES[r.type]}</span>` : ''}`,
  onSelect: r => navigate(TYPES[r.type][1](r)),
});
