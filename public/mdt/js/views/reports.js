import { html, mount, $, attempt, fullName, fmtDate, fmtDateTime, debounce, PAGE, moreButton } from '../dom.js';
import { api, isJustice } from '../api.js';
import { icon } from '../icons.js';
import { formatDollars, formatDuree } from '../calc.js';

const STATUTS = { brouillon: ['Brouillon', 'badge-warn'], en_attente: ['En attente de jugement', 'badge-info'], finalise: ['Finalisé', 'badge-ok'] };
export const statutLabel = s => (STATUTS[s] ?? STATUTS.brouillon)[0];
export const statutBadge = s => html`<span class="badge ${(STATUTS[s] ?? STATUTS.brouillon)[1]}">${statutLabel(s)}</span>`;

export async function render(main, params, query) {
  mount(main, html`
    <div class="page-head">
      <h1>Rapports d'arrestation</h1>
      ${isJustice() ? '' : html`<div class="actions"><a class="btn btn-primary" href="#/rapports/nouveau">${icon('plus')} Nouveau rapport</a></div>`}
    </div>
    <div class="toolbar">
      <div class="search-box grow">${icon('search')}<input type="search" class="input" data-q placeholder="N° de rapport ou nom du suspect…"></div>
      <select class="input" data-statut>
        <option value="">Tous les statuts</option><option value="brouillon">Brouillons</option><option value="en_attente">En attente de jugement</option><option value="finalise">Finalisés</option>
      </select>
      <label class="check"><input type="checkbox" data-mine ${query.get('mine') === '1' ? 'checked' : ''}> Mes rapports</label>
    </div>
    <div class="card table-wrap" data-results></div>`);

  let limit = PAGE;
  const load = async () => {
    const qs = new URLSearchParams({ q: $('[data-q]', main).value, statut: $('[data-statut]', main).value, mine: $('[data-mine]', main).checked ? '1' : '', limit });
    const list = await api(`/reports?${qs}`);
    mount($('[data-results]', main), list.length ? html`<table class="table table-click">
      <thead><tr><th>N°</th><th>Suspect</th><th>Date des faits</th><th>Rédacteur</th><th class="num">Chefs</th><th class="num">Amende</th><th class="num">GAV</th><th>Statut</th><th>Modifié</th></tr></thead>
      <tbody>${list.map(r => html`<tr data-href="#/rapports/${r.id}${r.statut === 'brouillon' && !isJustice() ? '/modifier' : ''}">
        <td class="mono strong">${r.numero}</td>
        <td>${r.suspect_nom ? fullName({ nom: r.suspect_nom, prenom: r.suspect_prenom }) : html`<span class="muted">Non renseigné</span>`}</td>
        <td>${fmtDate(r.date_faits)}</td>
        <td class="mono">『${r.redacteur_matricule}』</td>
        <td class="num">${r.nb_chefs ?? 0}</td>
        <td class="num">${formatDollars(r.amende ?? 0)}</td>
        <td class="num">${formatDuree(r.gav_minutes ?? 0)}</td>
        <td>${statutBadge(r.statut)}</td>
        <td class="muted nowrap">${fmtDateTime(r.updated_at)}</td></tr>`)}</tbody></table>${moreButton(list.length, limit)}`
      : html`<p class="empty-state">Aucun rapport.</p>`);
  };
  const reload = debounce(() => { limit = PAGE; attempt(load); });
  $('[data-q]', main).addEventListener('input', reload);
  $('[data-statut]', main).addEventListener('change', reload);
  $('[data-mine]', main).addEventListener('change', reload);
  main.addEventListener('click', e => {
    if (e.target.closest('[data-more]')) { limit += PAGE; attempt(load); }
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
  await load();
}
