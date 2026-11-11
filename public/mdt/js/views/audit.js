import { html, mount, $, attempt, agentLabel, fmtDateTime, debounce, PAGE, moreButton } from '../dom.js';
import { api, loadUsers, hasRole } from '../api.js';
import { icon } from '../icons.js';
import { DIVISION_KINDS } from '../service-kinds.js';

// Type de document → [libellé du filtre, lien vers le document]
const ENTITIES = {
  report: ["Rapports d'arrestation", l => `#/rapports/${l.entity_id}`],
  incident: ["Rapports d'incident", l => `#/incidents/${l.entity_id}`],
  evidence: ['Scellés', l => `#/preuves?q=${encodeURIComponent(l.label)}`],
  citizen: ['Citoyens', l => `#/casiers/${l.entity_id}`],
  complaint: ['Plaintes', l => `#/plaintes/${l.entity_id}`],
  warrant: ['Mandats & BOLO', () => '#/mandats?statut=tous'],
  vehicle: ['Véhicules volés', () => '#/vehicules?statut=tous'],
  user: ['Comptes des agents', l => `#/agents/${l.entity_id}`],
  service: ['Dossiers de service et de division', l => {
    const k = l.entity.split(':')[1];
    // Un dossier numéroté a sa propre page
    return Object.hasOwn(DIVISION_KINDS, k) ? `#/divisions/${DIVISION_KINDS[k].division}/${k}${DIVISION_KINDS[k].numero ? `/${l.entity_id}` : ''}` : `#/service/${k}`;
  }],
  announcement: ['Annonces', () => '#/annonces'],
  penal_code: ['Code pénal', () => '#/code-penal'],
  settings: ['Paramètres & Defcon', l => (l.label === 'Defcon' ? '#/references?onglet=defcon' : l.label === 'Base de données' ? '#/admin?onglet=sauvegardes' : '#/admin?onglet=parametres')],
};

const target = l => {
  const link = ENTITIES[l.entity.split(':')[0]]?.[1];
  const label = l.label || '—';
  return link && !/supprim/i.test(l.action) ? html`<a href="${link(l)}">${label}</a>` : label;
};

export async function render(main) {
  if (!hasRole('superviseur')) {
    mount(main, html`<div class="alert alert-danger">Accès réservé aux superviseurs.</div>`);
    return;
  }
  const users = await loadUsers();
  mount(main, html`
    <div class="page-head">
      <div><h1>Historique des actions</h1><p class="muted">Qui a fait quoi, et quand : rapports finalisés, réouvertures, suppressions, mandats, scellés, comptes, Defcon…</p></div>
    </div>
    <div class="toolbar">
      <div class="search-box grow">${icon('search')}<input type="search" class="input" data-q placeholder="Action, n° de document, nom, détail…" autofocus></div>
      <select class="input" data-entity><option value="">Tous les documents</option>${Object.entries(ENTITIES).map(([k, [l]]) => html`<option value="${k}">${l}</option>`)}</select>
      <select class="input" data-user><option value="">Tous les agents</option>${users.map(u => html`<option value="${u.id}">${agentLabel(u)}</option>`)}</select>
    </div>
    <div class="card table-wrap" data-results></div>`);

  let limit = PAGE;
  const load = async () => {
    const qs = new URLSearchParams({ q: $('[data-q]', main).value, entity: $('[data-entity]', main).value, user_id: $('[data-user]', main).value, limit });
    const list = await api(`/audit?${qs}`);
    mount($('[data-results]', main), list.length ? html`<table class="table">
      <thead><tr><th>Date</th><th>Agent</th><th>Action</th><th>Document</th><th>Détails</th></tr></thead>
      <tbody>${list.map(l => html`<tr>
        <td class="nowrap muted">${fmtDateTime(l.created_at)}</td>
        <td class="nowrap">${l.matricule ? agentLabel(l) : '—'}</td>
        <td class="strong">${l.action}</td>
        <td>${target(l)}</td>
        <td class="small">${l.details}</td></tr>`)}</tbody></table>
      ${moreButton(list.length, limit)}`
      : html`<p class="empty-state">Aucune action enregistrée.</p>`);
  };
  const reload = debounce(() => { limit = PAGE; attempt(load); });
  $('[data-q]', main).addEventListener('input', reload);
  $('[data-entity]', main).addEventListener('change', reload);
  $('[data-user]', main).addEventListener('change', reload);
  main.addEventListener('click', e => {
    if (e.target.closest('[data-more]')) { limit += PAGE; attempt(load); }
  });
  await load();
}
