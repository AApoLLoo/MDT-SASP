import { html, mount, $, attempt, formValues, toast, fullName, fmtDate, fmtDateTime, debounce, PAGE, moreButton, openModal } from '../dom.js';
import { api, hasRole, canJudge, isJustice } from '../api.js';
import { navigate, rerender } from '../router.js';
import { icon } from '../icons.js';
import { formatDollars, formatDuree } from '../calc.js';
import { mountPhotos, numberedSlots } from '../components/photos.js';
import { openWarrantForm, closeWarrant, warrantTypeBadge } from './warrants.js';
import { complaintBadge } from './complaints.js';
import { canManage, statutBadge } from './service.js';
import { DIVISION_KINDS } from '../service-kinds.js';
import { citizenPicker } from '../components/picker.js';
import { openTicketForm, openTicket, ticketBadge } from './tickets.js';
import { copyBtn } from '../components/discord.js';

const citizenForm = (c = {}, affiliations = []) => html`
  <form class="form-grid" data-form>
    <label>Nom *<input class="input" name="nom" required value="${c.nom}"></label>
    <label>Prénom<input class="input" name="prenom" value="${c.prenom}"></label>
    <label>Date de naissance<input class="input" type="date" name="date_naissance" value="${c.date_naissance}"></label>
    <label>N° sécu (ID unique)<input class="input" name="id_unique" value="${c.id_unique}"></label>
    <label>Empreinte<input class="input" name="empreinte" value="${c.empreinte}"></label>
    <label>Téléphone<input class="input" name="telephone" value="${c.telephone}" placeholder="(000) 000-0000"></label>
    <label>Alias / surnoms<input class="input" name="alias" value="${c.alias}" placeholder="Ex. : Le Gros, Bobby"></label>
    <label>Affiliation (groupe, gang)<input class="input" name="affiliation" value="${c.affiliation}" list="affiliations" placeholder="Ex. : Ballas"></label>
    <datalist id="affiliations">${affiliations.map(a => html`<option value="${a.nom}">`)}</datalist>
    <label class="span-2">Signalement<textarea class="input" name="signalement" rows="2" placeholder="Taille, corpulence, tatouages, cicatrices, tenue habituelle…">${c.signalement}</textarea></label>
    <label class="span-2">Notes<textarea class="input" name="notes" rows="3">${c.notes}</textarea></label>
    <div class="span-2 form-actions"><button class="btn btn-primary">Enregistrer</button></div>
  </form>`;

// Liste des casiers : citoyens ayant au moins une arrestation finalisée
export async function renderList(main, params, query) {
  mount(main, html`
    <div class="page-head">
      <div><h1>Casiers judiciaires</h1><p class="muted" data-count></p></div>
      <div class="actions">
        <a class="btn btn-ghost" href="#/casiers/nouveau" title="Pour émettre un mandat sur une personne sans casier">${icon('plus')} Créer une fiche</a>
        <a class="btn btn-primary" href="#/rapports/nouveau">${icon('report')} Nouveau rapport d'arrestation</a>
      </div>
    </div>
    <div class="toolbar">
      <div class="search-box grow">${icon('search')}<input type="search" class="input" data-q value="${query.get('q') ?? ''}" placeholder="Nom, prénom, ID unique ou téléphone…" autofocus></div>
    </div>
    <div class="card table-wrap" data-results></div>`);

  let limit = PAGE;
  const load = async () => {
    const q = $('[data-q]', main).value;
    const list = await api(`/citizens?casier=1&q=${encodeURIComponent(q)}&limit=${limit}`);
    const plus = list.length >= limit ? '+' : '';
    $('[data-count]', main).textContent = q ? `${list.length}${plus} résultat(s)` : `${list.length}${plus} citoyen(s) avec au moins une arrestation`;
    mount($('[data-results]', main), list.length ? html`<table class="table table-click">
      <thead><tr><th>Nom</th><th>ID unique</th><th>Date de naissance</th><th class="num">Arrestations</th><th>Dernière arrestation</th><th>Statut</th></tr></thead>
      <tbody>${list.map(c => html`<tr data-href="#/casiers/${c.id}">
        <td class="strong">${fullName(c)}</td><td class="mono">${c.id_unique ?? '—'}</td><td>${fmtDate(c.date_naissance)}</td>
        <td class="num">${c.nb_arrestations}</td><td>${fmtDate(c.derniere_arrestation)}</td>
        <td>${c.mandats_actifs ? html`<span class="badge badge-danger">${c.mandats_actifs} mandat(s) actif(s)</span>` : ''}</td>
      </tr>`)}</tbody></table>${moreButton(list.length, limit)}`
      : html`<p class="empty-state">${q ? 'Aucun casier ne correspond à cette recherche.' : "Aucun casier pour l'instant : un casier est créé à la finalisation d'un rapport d'arrestation."}</p>`);
  };
  $('[data-q]', main).addEventListener('input', debounce(() => { limit = PAGE; attempt(load); }));
  main.addEventListener('click', e => {
    if (e.target.closest('[data-more]')) { limit += PAGE; attempt(load); }
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
  await load();
}

export async function renderDetail(main, [id]) {
  // Groupes déjà saisis, proposés à la saisie (orthographe commune) ; pas pour les comptes justice
  const affiliations = isJustice() ? [] : await api('/citizens/affiliations');
  if (id === 'nouveau') {
    mount(main, html`
      <div class="page-head"><div><a href="#/casiers" class="back">${icon('back')} Casiers</a><h1>Nouvelle fiche</h1>
        <p class="muted">Le casier se remplira à la finalisation des rapports d'arrestation de cette personne.</p></div></div>
      <section class="card">${citizenForm({}, affiliations)}</section>`);
    $('[data-form]', main).addEventListener('submit', e => {
      e.preventDefault();
      attempt(async () => {
        const { id: newId } = await api('/citizens', { method: 'POST', body: formValues(e.target) });
        toast('Fiche créée');
        navigate(`/casiers/${newId}`);
      }, e.submitter);
    });
    return;
  }

  const c = await api(`/citizens/${id}`);
  // Enquêtes du BCI où la personne apparaît : pour le BCI et les superviseurs seulement
  const enquetes = canManage(DIVISION_KINDS.enquetes) ? await api(`/service/enquetes?citoyen=${c.id}`) : null;
  const actifs = c.warrants.filter(w => w.statut === 'actif');
  // Condamnations blanchies : renvoyées par le serveur aux seuls magistrats et administrateurs, hors statistiques
  const casier = c.reports.filter(r => r.statut === 'finalise' && !r.blanchi_at);
  const blanchis = c.reports.filter(r => r.statut === 'finalise' && r.blanchi_at);
  const brouillons = c.reports.filter(r => r.statut === 'brouillon');
  const enAttente = c.reports.filter(r => r.statut === 'en_attente');
  const judge = canJudge();
  const justice = isJustice();
  const totalAmendes = casier.reduce((s, r) => s + r.amende, 0);
  const totalGav = casier.reduce((s, r) => s + r.gav_minutes, 0);
  const unpaid = c.tickets.filter(t => t.statut === 'impayee').reduce((s, t) => s + t.montant, 0);

  mount(main, html`
    <a href="#/casiers" class="back">${icon('back')} Casiers</a>
    <div class="page-head">
      <div class="id-card ${actifs.length ? 'is-wanted' : ''}">
        ${c.photo_url ? html`<img class="id-card-photo" src="${c.photo_url}" alt="Photo d'identité">`
          : html`<div class="id-card-photo is-empty" aria-hidden="true">${[c.prenom, c.nom].filter(Boolean).map(s => s[0]).join('').toUpperCase()}</div>`}
        <div class="id-card-body">
          <small class="id-card-kicker">State of San Andreas · ${casier.length ? 'Casier judiciaire' : "Fiche d'identité"}</small>
          <h1>${casier.length ? 'Casier' : 'Fiche'} de ${fullName(c)} ${actifs.length ? html`<span class="badge badge-danger">Recherché</span>` : ''}</h1>
          <dl class="id-card-fields">
            <div><dt>ID unique</dt><dd class="mono">${c.id_unique || '—'}${copyBtn(c.id_unique)}</dd></div>
            <div><dt>Naissance</dt><dd>${fmtDate(c.date_naissance)}</dd></div>
            <div><dt>Téléphone</dt><dd class="mono">${c.telephone || '—'}</dd></div>
            ${c.alias ? html`<div><dt>Alias</dt><dd>« ${c.alias} »</dd></div>` : ''}
            ${c.affiliation ? html`<div><dt>Affiliation</dt><dd><span class="badge badge-warn">${c.affiliation}</span></dd></div>` : ''}
          </dl>
        </div>
      </div>
      <div class="actions">
        ${justice ? '' : html`<a class="btn btn-primary" href="#/rapports/nouveau?citoyen=${c.id}">${icon('report')} Nouveau rapport d'arrestation</a>`}
        ${judge && casier.length ? html`<button class="btn" data-blanchir-casier>Blanchir le casier</button>` : ''}
        ${hasRole('superviseur') && html`<button class="btn btn-ghost" data-merge title="Rattacher un doublon de cette personne à cette fiche">Fusionner un doublon</button>`}
        ${hasRole('superviseur') && html`<button class="btn btn-ghost" data-delete>${icon('trash')} Supprimer</button>`}
      </div>
    </div>

    ${actifs.length ? html`<div class="alert alert-danger"><strong>${actifs.length} mandat(s) / BOLO actif(s)</strong>
      <small>${actifs.map(w => w.motif).join(' · ')}</small></div>` : ''}

    <div class="stats stats-4">
      <div class="stat"><strong>${casier.length}</strong><span>Arrestation${casier.length > 1 ? 's' : ''}</span></div>
      <div class="stat"><strong>${formatDollars(totalAmendes)}</strong><span>Amendes cumulées</span></div>
      <div class="stat"><strong>${formatDuree(totalGav)}</strong><span>GAV cumulée</span></div>
      <div class="stat"><strong>${casier.length ? fmtDate(casier[0].date_faits) : '—'}</strong><span>Dernière arrestation</span></div>
    </div>

    <section class="card">
      <div class="card-head"><h3>Rapports d'arrestation</h3></div>
      ${casier.length ? html`<div class="table-wrap"><table class="table table-click">
        <thead><tr><th>N°</th><th>Date des faits</th><th>Chefs d'accusation</th><th class="num">Amende</th><th class="num">GAV</th><th>Agent</th><th></th></tr></thead>
        <tbody>${casier.map(r => html`<tr data-href="#/rapports/${r.id}">
          <td class="mono strong">${r.numero}</td><td class="nowrap">${fmtDate(r.date_faits)}</td>
          <td>${r.charges.length ? html`<ul class="charges-list">${r.charges.map(ch => html`<li>${ch}</li>`)}</ul>` : '—'}</td>
          <td class="num">${formatDollars(r.amende)}</td><td class="num">${formatDuree(r.gav_minutes)}</td>
          <td class="mono">『${r.redacteur_matricule}』</td>
          <td class="nowrap"><a class="btn btn-sm" href="#/rapports/${r.id}">Voir</a>
            ${judge ? html`<button class="btn btn-sm btn-ghost" data-blanchir="${r.id}">Blanchir</button>` : ''}</td></tr>`)}</tbody></table></div>`
        : html`<p class="empty-state">Casier vierge : aucune arrestation finalisée.</p>`}
      ${brouillons.length ? html`<p class="muted small">Rapports en cours de rédaction : ${brouillons.map(r => html`<a href="#/rapports/${r.id}${justice ? '' : '/modifier'}" class="mono">${r.numero}</a> `)}</p>` : ''}
      ${enAttente.length ? html`<p class="muted small">En attente de jugement : ${enAttente.map(r => html`<a href="#/rapports/${r.id}" class="mono">${r.numero}</a> `)}</p>` : ''}
      ${blanchis.length ? html`<p class="muted small">Condamnations blanchies (visibles de la justice seulement) :
        ${blanchis.map(r => html`<span class="nowrap"><a href="#/rapports/${r.id}" class="mono" title="${r.blanchi_motif}">${r.numero}</a>
          <button class="btn btn-sm btn-ghost" data-unblanchir="${r.id}">Annuler le blanchiment</button></span> `)}</p>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><h3>Amendes</h3>${justice ? '' : html`<button class="btn btn-sm" data-new-ticket>${icon('plus')} Dresser une amende</button>`}</div>
      ${c.tickets.length ? html`<div class="table-wrap"><table class="table table-click">
        <thead><tr><th>N°</th><th>Date</th><th>Infractions</th><th class="num">Montant</th><th>Statut</th><th>Agent</th></tr></thead>
        <tbody>${c.tickets.map(t => html`<tr data-ticket="${t.id}">
          <td class="mono strong">${t.numero}</td><td class="nowrap">${fmtDate(t.date_faits)}</td>
          <td>${t.charges.map(l => l.infraction).join(' · ')}</td><td class="num">${formatDollars(t.montant)}</td>
          <td>${ticketBadge(t.statut)}</td><td class="mono">『${t.agent_matricule}』</td></tr>`)}</tbody></table></div>
        ${unpaid ? html`<p class="muted small">Impayé : <strong>${formatDollars(unpaid)}</strong></p>` : ''}`
        : html`<p class="empty-state">Aucune amende.</p>`}
    </section>

    <section class="card">
      <div class="card-head"><h3>Plaintes</h3>${justice ? '' : html`<a class="btn btn-sm" href="#/plaintes/nouvelle?mis_en_cause=${c.id}">${icon('plus')} Plainte contre cette personne</a>`}</div>
      ${c.complaints.length ? html`<div class="table-wrap"><table class="table table-click">
        <thead><tr><th>N°</th><th>Rôle</th><th>Dépôt</th><th>Qualification</th><th>Statut</th></tr></thead>
        <tbody>${c.complaints.map(p => html`<tr data-href="#/plaintes/${p.id}">
          <td class="mono strong">${p.numero}</td>
          <td>${p.role === 'plaignant' ? html`<span class="badge badge-info">Plaignant</span>` : html`<span class="badge badge-danger">Mis en cause</span>`}</td>
          <td class="nowrap">${fmtDate(p.date_depot)}</td>
          <td>${p.qualifications.join(' · ') || '—'}</td>
          <td>${complaintBadge(p.statut)}</td></tr>`)}</tbody></table></div>`
        : html`<p class="empty-state">Aucune plainte.</p>`}
    </section>

    ${enquetes ? html`<section class="card">
      <div class="card-head"><h3>Enquêtes du BCI</h3><small class="muted">Visible par le BCI et l’état-major</small></div>
      ${enquetes.length ? html`<div class="table-wrap"><table class="table table-click">
        <thead><tr><th>N°</th><th>Objet</th><th>Qualité</th><th>Ouvert le</th><th>Statut</th></tr></thead>
        <tbody>${enquetes.map(e => html`<tr data-href="#/divisions/bci/enquetes/${e.id}">
          <td class="mono strong">${e.data.numero}</td><td>${e.data.objet}</td>
          <td>${[...new Set(e.data.personnes.filter(p => p.citoyen === String(c.id)).map(p => p.role))].join(', ')}</td>
          <td class="nowrap">${fmtDate(e.date)}</td>
          <td>${statutBadge(DIVISION_KINDS.enquetes.statuts[e.statut])}</td></tr>`)}</tbody></table></div>`
        : html`<p class="empty-state">Cette personne n'apparaît dans aucune enquête.</p>`}
    </section>` : ''}

    <div class="detail-grid">
      <section class="card">
        <div class="card-head"><h3>Mandats & BOLO</h3><button class="btn btn-sm" data-new-warrant>${icon('plus')} Émettre</button></div>
        ${c.warrants.length ? html`<ul class="list">${c.warrants.map(w => html`
          <li class="${w.statut === 'clos' ? 'is-muted' : ''}">${warrantTypeBadge(w.type)}
            <span class="grow">${w.motif}<small class="muted">${w.statut === 'clos' ? `Clos le ${fmtDateTime(w.closed_at)}` : `Émis le ${fmtDateTime(w.created_at)} par 『${w.auteur_matricule ?? '—'}』`}</small></span>
            ${w.statut === 'actif' && !justice && html`<button class="btn btn-sm" data-close-w="${w.id}">Clore</button>`}</li>`)}</ul>`
          : html`<p class="empty-state">Aucun mandat.</p>`}
      </section>

      <section class="card">
        <h3>Identité</h3>
        <div class="identity">
          <div data-photo class="identity-photo"></div>
          <div class="grow"><fieldset class="bare-fieldset" ${justice ? 'disabled' : ''}>${citizenForm(c, affiliations)}</fieldset></div>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h3>Photos</h3><small class="muted">Tatouages, signes distinctifs, véhicules, lieux… Ctrl+V sur un emplacement, glisser-déposer, import ou lien.</small></div>
      <div data-photos></div>
    </section>`);

  if (!justice) mountPhotos($('[data-photos]', main), c.photos, photos => attempt(async () => {
    await api(`/citizens/${c.id}`, { method: 'PUT', body: { photos } });
    toast('Photos mises à jour');
  }), [{ titre: '', slots: numberedSlots(), extra: true }]);

  if (justice) {
    mount($('[data-photos]', main), Object.values(c.photos).length
      ? html`<div class="paper-photos">${Object.values(c.photos).map(url => html`<figure><img src="${url}" alt=""></figure>`)}</div>`
      : html`<p class="empty-state">Aucune photo.</p>`);
    if (c.photo_url) mount($('[data-photo]', main), html`<img src="${c.photo_url}" alt="Photo d'identité">`);
  } else mountPhotos($('[data-photo]', main), { photo_url: c.photo_url }, photos => attempt(async () => {
    await api(`/citizens/${c.id}`, { method: 'PUT', body: { photo_url: photos.photo_url ?? '' } });
    toast('Photo mise à jour');
  }), [{ titre: '', slots: [['photo_url', "Photo d'identité"]] }]);

  $('[data-form]', main).addEventListener('submit', e => {
    e.preventDefault();
    attempt(async () => {
      await api(`/citizens/${c.id}`, { method: 'PUT', body: formValues(e.target) });
      toast('Fiche mise à jour');
      rerender();
    }, e.submitter);
  });

  main.addEventListener('click', e => {
    const t = e.target.closest('button, a, tr[data-href], tr[data-ticket]');
    if (!t || t.matches('a')) return;
    if (t.matches('tr[data-href]')) { location.hash = t.dataset.href; return; }
    if (t.dataset.ticket) {
      const ticket = c.tickets.find(x => x.id === Number(t.dataset.ticket));
      openTicket({ ...ticket, citizen_nom: c.nom, citizen_prenom: c.prenom }, rerender);
      return;
    }
    if (t.matches('[data-new-ticket]')) attempt(() => openTicketForm({ citizen: c }, rerender));
    if (t.matches('[data-merge]')) openMerge(c);
    if (t.dataset.closeW) closeWarrant(t.dataset.closeW);
    if (t.dataset.blanchir || t.matches('[data-blanchir-casier]')) {
      const motif = prompt(t.dataset.blanchir ? 'Motif du blanchiment de cette condamnation :' : `Motif du blanchiment de tout le casier de ${fullName(c)} :`);
      if (!motif?.trim()) return;
      attempt(async () => {
        await api(t.dataset.blanchir ? `/reports/${t.dataset.blanchir}/blanchir` : `/citizens/${c.id}/blanchir`, { method: 'POST', body: { motif } });
        toast(t.dataset.blanchir ? 'Condamnation blanchie' : 'Casier blanchi');
        rerender();
      }, t);
    }
    if (t.dataset.unblanchir) {
      const motif = prompt("Motif de l'annulation du blanchiment :");
      if (!motif?.trim()) return;
      attempt(async () => {
        await api(`/reports/${t.dataset.unblanchir}/unblanchir`, { method: 'POST', body: { motif } });
        toast('Blanchiment annulé');
        rerender();
      }, t);
    }
    if (t.matches('[data-new-warrant]')) openWarrantForm({ type: 'mandat', citizen_id: c.id, citizen_nom: c.nom, citizen_prenom: c.prenom });
    if (t.matches('[data-delete]') && confirm(`Supprimer définitivement la fiche de ${fullName(c)} ? Ses mandats seront supprimés.`)) {
      attempt(async () => {
        await api(`/citizens/${c.id}`, { method: 'DELETE' });
        toast('Fiche supprimée');
        navigate('/casiers');
      });
    }
  });
}

// Fusion d'un doublon dans cette fiche (superviseurs) : le doublon choisi est absorbé puis supprimé
function openMerge(c) {
  const dialog = openModal(`Fusionner un doublon dans la fiche de ${fullName(c)}`, html`
    <p>Choisissez la fiche en double. Ses rapports, plaintes, mandats, amendes, photos et apparitions dans les enquêtes
      passent sur <strong>cette fiche</strong>, qui garde son identité (les champs vides sont complétés), puis le doublon est supprimé.</p>
    <div data-pick></div>
    <div data-choice></div>`, { wide: true });
  citizenPicker($('[data-pick]', dialog), source => {
    if (source.id === c.id) {
      toast('Choisissez une autre fiche que celle-ci', 'error');
      return;
    }
    mount($('[data-choice]', dialog), html`
      <div class="alert alert-warn"><strong>${fullName(source)}</strong>
        <small>${[source.id_unique && `ID ${source.id_unique}`, source.date_naissance && `né(e) le ${fmtDate(source.date_naissance)}`, `fiche n° ${source.id}`, `${source.nb_arrestations} arrestation(s)`].filter(Boolean).join(' · ')}</small></div>
      <div class="form-actions"><button type="button" class="btn" data-close>Annuler</button>
        <button type="button" class="btn btn-primary" data-confirm>Fusionner et supprimer le doublon</button></div>`);
    $('[data-confirm]', dialog).addEventListener('click', e => attempt(async () => {
      await api(`/citizens/${c.id}/merge`, { method: 'POST', body: { source_id: source.id } });
      toast(`Fiche de ${fullName(source)} fusionnée`);
      dialog.close();
      rerender();
    }, e.target));
  }, 'Rechercher la fiche en double…');
}
