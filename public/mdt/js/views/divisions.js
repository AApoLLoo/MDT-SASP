import { html, mount, $, attempt, toast, agentLabel } from '../dom.js';
import { api, state, loadUsers, hasRole } from '../api.js';
import { icon } from '../icons.js';
import { SPECIAL_DIVISIONS, DIVISION_KINDS, isMember } from '../service-kinds.js';
import { renderRecords } from './service.js';
import { gradeOptions } from './agents.js';
import { renderRookies, renderCatalogue } from './academy.js';
import { renderEnquetes } from './bci.js';

// Pages déclarées par une division (`pages` dans SPECIAL_DIVISIONS), ou page propre d'un type de dossier
// qui remplace la liste générique (id : un dossier)
const PAGES = { rookies: renderRookies, catalogue: renderCatalogue, enquetes: renderEnquetes };

// Pages de la catégorie du menu propre à une division : #/divisions/<division>/effectif, /<page> ou /<dossier>[/<id>]
export async function render(main, [key, page, id]) {
  if (!Object.hasOwn(SPECIAL_DIVISIONS, key)) return mount(main, html`<p class="empty-state">Page introuvable.</p>`);
  const division = SPECIAL_DIVISIONS[key];
  await loadUsers();
  if (page === 'effectif') return renderEffectif(main, key, division);
  const own = division.pages?.some(([p]) => p === page) || DIVISION_KINDS[page]?.division === key;
  if (own && Object.hasOwn(PAGES, page)) return PAGES[page](main, id);
  if (!own || !Object.hasOwn(DIVISION_KINDS, page)) return mount(main, html`<p class="empty-state">Page introuvable.</p>`);
  const kind = DIVISION_KINDS[page];
  mount(main, html`
    <div class="page-head"><div><h1>${icon(kind.icon)} ${kind.titre}</h1><p class="muted">Division ${division.nom}</p></div></div>
    <div data-records></div>`);
  await renderRecords($('[data-records]', main), page);
}

// Membres de la division, du grade interne le plus élevé au plus bas (puis par grade SASP) ;
// un superviseur change le grade interne directement dans la liste
function renderEffectif(main, key, division) {
  const grades = division.grades ? state.settings[division.grades] : null;
  const sasp = state.settings.grades;
  const field = division.gradeField;
  const sup = hasRole('superviseur');
  const members = state.users.filter(u => u.actif && isMember(key, u))
    .sort((a, b) => (grades ? grades.indexOf(b[field]) - grades.indexOf(a[field]) : 0) || sasp.indexOf(b.grade) - sasp.indexOf(a.grade));
  // Tutorat (Academy) : les rookies confiés à chaque membre, réglés dans le suivi des rookies
  const suivis = u => state.users.filter(r => r.actif && r.tuteurs.includes(u.id));
  mount(main, html`
    <div class="page-head"><div>
      <h1>${icon('citizens')} Effectif ${division.nom}</h1>
      <p class="muted">${members.length} membre(s), rattachés par une division de leur profil.${grades ? ` Grades ${division.nom} réglés par un superviseur, liste dans Administration → Paramètres.` : ''}</p>
    </div></div>
    <div class="card table-wrap">${members.length ? html`<table class="table">
      <thead><tr>${grades ? html`<th>Grade ${division.nom}</th>` : ''}<th>Agent</th><th>Divisions</th>${division.tutorat ? html`<th>Rookies suivis</th>` : ''}</tr></thead>
      <tbody>${members.map(u => html`<tr>
        ${grades ? html`<td>${sup
          ? html`<select class="input input-sm" data-grade="${u.id}" aria-label="Grade ${division.nom} de ${u.matricule}">${gradeOptions(u[field], grades)}</select>`
          : u[field] ? html`<span class="badge badge-gold">${u[field]}</span>` : html`<span class="muted">—</span>`}</td>` : ''}
        <td><a href="#/agents/${u.id}">${agentLabel(u)}</a></td>
        <td>${u.divisions.join(', ') || '—'}</td>
        ${division.tutorat ? html`<td>${suivis(u).length ? html`<div class="tags">${suivis(u).map(r => html`<a class="chip chip-static" href="#/agents/${r.id}">${agentLabel(r)}</a>`)}</div>` : html`<span class="muted">—</span>`}</td>` : ''}</tr>`)}</tbody></table>`
      : html`<p class="empty-state">Aucun agent rattaché à cette division.</p>`}</div>`);

  main.addEventListener('change', e => {
    const id = e.target.dataset.grade;
    if (id) attempt(async () => {
      await api(`/users/${id}`, { method: 'PUT', body: { [field]: e.target.value } });
      await loadUsers(true);
      toast('Grade mis à jour');
    });
  });
}
