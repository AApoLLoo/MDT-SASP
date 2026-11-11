import { html, mount, fullName, fmtDate, fmtDateTime } from '../dom.js';
import { api, isAvocat } from '../api.js';
import { formatDollars } from '../calc.js';
import { statutBadge } from './reports.js';

const suspect = r => (r.suspect_nom ? fullName({ nom: r.suspect_nom, prenom: r.suspect_prenom }) : html`<span class="muted">Non renseigné</span>`);

// Accueil des comptes justice : rapports à juger (magistrat) ou dossiers où l'avocat est inscrit
export async function render(main) {
  if (isAvocat()) return renderAvocat(main);
  const list = await api('/reports?statut=en_attente&limit=200');
  mount(main, html`
    <div class="page-head">
      <div><h1>En attente de jugement</h1>
        <p class="muted">${list.length ? `${list.length} rapport(s) déposé(s) par la police, du plus ancien au plus récent` : 'Aucun rapport à juger'}</p></div>
    </div>
    ${list.length ? html`<div class="card table-wrap"><table class="table table-click">
      <thead><tr><th>N°</th><th>Suspect</th><th>Date des faits</th><th>Rédacteur</th><th class="num">Chefs</th><th class="num">Amende proposée</th><th>Déposé le</th></tr></thead>
      <tbody>${list.map(r => html`<tr data-href="#/rapports/${r.id}">
        <td class="mono strong">${r.numero}</td><td>${suspect(r)}</td><td>${fmtDate(r.date_faits)}</td>
        <td class="mono">『${r.redacteur_matricule}』</td><td class="num">${r.nb_chefs ?? 0}</td>
        <td class="num">${formatDollars(r.amende ?? 0)}</td><td class="muted nowrap">${fmtDateTime(r.depose_at)}</td></tr>`)}</tbody>
    </table></div>` : html`<p class="empty-state">Les rapports déposés par la police apparaîtront ici.</p>`}`);
  main.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
}

async function renderAvocat(main) {
  const { reports, complaints } = await api('/justice/mes-dossiers');
  mount(main, html`
    <div class="page-head"><div><h1>Mes dossiers</h1><p class="muted">Dossiers où votre compte est inscrit comme avocat</p></div></div>
    <section class="card">
      <div class="card-head"><h3>Rapports d'arrestation</h3></div>
      ${reports.length ? html`<div class="table-wrap"><table class="table table-click">
        <thead><tr><th>N°</th><th>Client</th><th>Date des faits</th><th>Statut</th></tr></thead>
        <tbody>${reports.map(r => html`<tr data-href="#/rapports/${r.id}">
          <td class="mono strong">${r.numero}</td><td>${suspect(r)}</td><td>${fmtDate(r.date_faits)}</td><td>${statutBadge(r.statut)}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="empty-state">Aucun rapport d'arrestation.</p>`}
    </section>
    <section class="card">
      <div class="card-head"><h3>Plaintes</h3></div>
      ${complaints.length ? html`<div class="table-wrap"><table class="table table-click">
        <thead><tr><th>N°</th><th>Déposée le</th></tr></thead>
        <tbody>${complaints.map(c => html`<tr data-href="#/plaintes/${c.id}"><td class="mono strong">${c.numero}</td><td>${fmtDate(c.date_depot)}</td></tr>`)}</tbody>
      </table></div>` : html`<p class="empty-state">Aucune plainte.</p>`}
    </section>`);
  main.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
}
