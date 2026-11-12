import { html, mount, $, attempt, openModal, formValues, toast, fullName, fmtDate, fmtDateTime, debounce, todayIso, nowTime, PAGE, moreButton } from '../dom.js';
import { api, hasRole, isJustice, loadPenalCode } from '../api.js';
import { icon } from '../icons.js';
import { formatDollars } from '../calc.js';
import { citizenPicker } from '../components/picker.js';

// Amendes simples (PV) : contraventions du Code pénal, dressées sans arrestation ni jugement

export const ticketBadge = s => (s === 'payee' ? html`<span class="badge badge-ok">Réglée</span>` : html`<span class="badge badge-warn">Impayée</span>`);
const MAX_LIGNES = 10;

// Formulaire de PV ; citizen : { id, nom, prenom } déjà connu (fiche citoyen), sinon choisi dans le formulaire
export async function openTicketForm({ citizen = null } = {}, onSaved = () => {}) {
  const codes = (await loadPenalCode()).filter(c => c.categorie === 'Contravention' && c.actif);
  if (!codes.length) {
    toast('Aucune contravention active dans le Code pénal', 'error');
    return;
  }
  let target = citizen;
  const lignes = [{ code_id: codes[0].id, quantite: 1 }];
  const dialog = openModal('Dresser une amende', html`
    <form class="form-grid" data-form>
      <div class="span-2" data-citizen></div>
      <label>Date<input class="input" type="date" name="date_faits" value="${todayIso()}" required></label>
      <label>Heure<input class="input" type="time" name="heure" value="${nowTime()}"></label>
      <label>Lieu<input class="input" name="lieu" placeholder="Ex. : Route 68, Harmony"></label>
      <label>Plaque<input class="input mono upper" name="plaque" placeholder="Si un véhicule est en cause"></label>
      <div class="span-2"><strong>Infractions</strong><div data-lignes></div>
        <button type="button" class="btn btn-sm" data-add>${icon('plus')} Ajouter une infraction</button></div>
      <p class="span-2">Total : <strong data-total></strong></p>
      <label class="span-2">Notes<textarea class="input" name="notes" rows="2" placeholder="Circonstances, observations…"></textarea></label>
      <label class="span-2 check"><input type="checkbox" name="payee"> Réglée sur place</label>
      <div class="span-2 form-actions"><button class="btn btn-primary">Dresser l'amende</button></div>
    </form>`, { wide: true });

  const showCitizen = () => {
    const slot = $('[data-citizen]', dialog);
    if (target) {
      mount(slot, html`<p>Contrevenant : <strong>${fullName(target)}</strong> ${citizen ? '' : html`<button type="button" class="btn btn-sm btn-ghost" data-change>Changer</button>`}</p>`);
      $('[data-change]', slot)?.addEventListener('click', () => { target = null; showCitizen(); });
    } else {
      mount(slot, html`<label>Contrevenant *<div data-pick></div></label>`);
      citizenPicker($('[data-pick]', slot), c => { target = c; showCitizen(); }, 'Rechercher le contrevenant (nom, ID unique, alias)…', {
        // Personne sans fiche : créée sur place (dernier mot = nom, le reste = prénom ; corrigeable ensuite sur la fiche)
        onCreate: q => attempt(async () => {
          const words = q.split(/\s+/);
          const person = { nom: words.pop(), prenom: words.join(' ') };
          const { id } = await api('/citizens', { method: 'POST', body: person });
          target = { id, ...person };
          toast(`Fiche de ${fullName(person)} créée`);
          showCitizen();
        }),
      });
    }
  };

  const renderLignes = () => {
    mount($('[data-lignes]', dialog), lignes.map((l, i) => html`
      <div class="row-inline" data-i="${i}">
        <select class="input grow" data-code aria-label="Infraction">${codes.map(c => html`<option value="${c.id}" ${c.id === l.code_id ? 'selected' : ''}>${c.infraction} — ${formatDollars(c.amende)}</option>`)}</select>
        <input class="input input-sm" type="number" min="1" max="99" value="${l.quantite}" data-qte aria-label="Quantité" style="width: 5rem">
        ${lignes.length > 1 ? html`<button type="button" class="btn btn-sm btn-ghost" data-remove aria-label="Retirer">✕</button>` : ''}
      </div>`));
    $('[data-add]', dialog).disabled = lignes.length >= MAX_LIGNES;
    const total = lignes.reduce((s, l) => s + (codes.find(c => c.id === l.code_id)?.amende ?? 0) * l.quantite, 0);
    $('[data-total]', dialog).textContent = formatDollars(total);
  };

  $('[data-lignes]', dialog).addEventListener('change', e => {
    const l = lignes[e.target.closest('[data-i]').dataset.i];
    if (e.target.matches('[data-code]')) l.code_id = Number(e.target.value);
    if (e.target.matches('[data-qte]')) l.quantite = Math.min(Math.max(Math.trunc(Number(e.target.value)) || 1, 1), 99);
    renderLignes();
  });
  $('[data-lignes]', dialog).addEventListener('click', e => {
    if (!e.target.closest('[data-remove]')) return;
    lignes.splice(e.target.closest('[data-i]').dataset.i, 1);
    renderLignes();
  });
  $('[data-add]', dialog).addEventListener('click', () => {
    lignes.push({ code_id: codes[0].id, quantite: 1 });
    renderLignes();
  });
  $('[data-form]', dialog).addEventListener('submit', ev => {
    ev.preventDefault();
    if (!target) {
      toast('Choisissez le contrevenant', 'error');
      return;
    }
    const { payee, ...v } = formValues(ev.target);
    attempt(async () => {
      const t = await api('/tickets', { method: 'POST', body: { ...v, citizen_id: target.id, charges: lignes, statut: payee ? 'payee' : 'impayee' } });
      toast(`Amende ${t.numero} dressée : ${formatDollars(t.montant)}`);
      dialog.close();
      onSaved(t);
    }, ev.submitter);
  });
  showCitizen();
  renderLignes();
}

// Détail d'un PV : réglée / impayée, suppression par un superviseur
export function openTicket(t, onChange = () => {}) {
  const justice = isJustice();
  const dialog = openModal(`Amende ${t.numero}`, html`
    <p>${ticketBadge(t.statut)} <strong>${fullName({ nom: t.citizen_nom, prenom: t.citizen_prenom })}</strong>
      ${t.citizen_id ? html` · <a href="#/casiers/${t.citizen_id}" data-close>Voir la fiche</a>` : ''}</p>
    <p class="muted">${[fmtDate(t.date_faits) + (t.heure ? ` à ${t.heure}` : ''), t.lieu, t.plaque && `Plaque ${t.plaque}`, `Agent 『${t.agent_matricule}』`].filter(Boolean).join(' · ')}</p>
    <table class="table"><thead><tr><th>Infraction</th><th class="num">Qté</th><th class="num">Montant</th></tr></thead>
      <tbody>${t.charges.map(l => html`<tr><td>${l.infraction}</td><td class="num">${l.quantite}</td><td class="num">${formatDollars(l.total)}</td></tr>`)}</tbody>
      <tfoot><tr><th colspan="2">Total</th><th class="num">${formatDollars(t.montant)}</th></tr></tfoot></table>
    ${t.notes ? html`<p class="pre-wrap">${t.notes}</p>` : ''}
    ${justice ? '' : html`<div class="form-actions">
      ${hasRole('superviseur') ? html`<button type="button" class="btn btn-ghost" data-delete>${icon('trash')} Supprimer</button>` : ''}
      <button type="button" class="btn btn-primary" data-statut="${t.statut === 'payee' ? 'impayee' : 'payee'}">${t.statut === 'payee' ? 'Remettre en impayée' : 'Marquer réglée'}</button>
    </div>`}`, { wide: true });
  $('[data-statut]', dialog)?.addEventListener('click', e => attempt(async () => {
    await api(`/tickets/${t.id}/statut`, { method: 'PUT', body: { statut: e.target.dataset.statut } });
    toast(e.target.dataset.statut === 'payee' ? 'Amende réglée' : 'Amende remise en impayée');
    dialog.close();
    onChange();
  }, e.target));
  $('[data-delete]', dialog)?.addEventListener('click', e => {
    if (!confirm(`Supprimer définitivement l'amende ${t.numero} ?`)) return;
    attempt(async () => {
      await api(`/tickets/${t.id}`, { method: 'DELETE' });
      toast('Amende supprimée');
      dialog.close();
      onChange();
    }, e.target);
  });
}

export async function render(main, params, query) {
  const statut = ['impayee', 'payee'].includes(query.get('statut')) ? query.get('statut') : 'tous';
  mount(main, html`
    <div class="page-head">
      <div><h1>Amendes</h1><p class="muted">Contraventions dressées sans arrestation : contrôles routiers, infractions mineures.</p></div>
      ${isJustice() ? '' : html`<div class="actions"><button class="btn btn-primary" data-new>${icon('plus')} Dresser une amende</button></div>`}
    </div>
    <div class="toolbar">
      <div class="search-box grow">${icon('search')}<input type="search" class="input" data-q value="${query.get('q') ?? ''}" placeholder="N° d'amende, contrevenant ou plaque…" autofocus></div>
      <div class="segmented">
        ${[['tous', 'Toutes'], ['impayee', 'Impayées'], ['payee', 'Réglées']].map(([k, l]) => html`<a href="#/amendes?statut=${k}" class="${k === statut ? 'is-active' : ''}">${l}</a>`)}
      </div>
    </div>
    <div class="card table-wrap" data-results></div>`);

  let list = [];
  let limit = PAGE;
  const load = async () => {
    list = await api(`/tickets?${new URLSearchParams({ q: $('[data-q]', main).value, statut: statut === 'tous' ? '' : statut, limit })}`);
    mount($('[data-results]', main), list.length ? html`<table class="table table-click">
      <thead><tr><th>N°</th><th>Contrevenant</th><th>Infractions</th><th class="num">Montant</th><th>Statut</th><th>Dressée le</th></tr></thead>
      <tbody>${list.map(t => html`<tr data-id="${t.id}">
        <td class="mono strong">${t.numero}</td>
        <td>${fullName({ nom: t.citizen_nom, prenom: t.citizen_prenom })}${t.plaque ? html`<small class="muted block mono">${t.plaque}</small>` : ''}</td>
        <td>${t.charges.map(l => l.infraction).join(' · ')}</td>
        <td class="num">${formatDollars(t.montant)}</td>
        <td>${ticketBadge(t.statut)}</td>
        <td class="nowrap">${fmtDateTime(t.created_at)}<small class="muted block">『${t.agent_matricule}』</small></td></tr>`)}</tbody></table>
      ${moreButton(list.length, limit)}`
      : html`<p class="empty-state">Aucune amende.</p>`);
  };

  const reload = () => attempt(load);
  $('[data-q]', main).addEventListener('input', debounce(() => { limit = PAGE; reload(); }));
  $('[data-new]', main)?.addEventListener('click', () => attempt(() => openTicketForm({}, reload)));
  main.addEventListener('click', e => {
    if (e.target.closest('[data-more]')) { limit += PAGE; reload(); return; }
    const t = list.find(x => x.id === Number(e.target.closest('tr[data-id]')?.dataset.id));
    if (t) openTicket(t, reload);
  });
  await load();
}
