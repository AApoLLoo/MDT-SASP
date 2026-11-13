import { html, attempt, toast, fullName, fmtDate, fmtDateTime, live } from '../dom.js';
import { api, state, hasRole } from '../api.js';
import { rerender } from '../router.js';
import { icon } from '../icons.js';
import { defconInfo } from '../reference-data.js';
import { warrantTypeBadge, warrantTarget } from './warrants.js';
import { complaintBadge } from './complaints.js';
import { statutBadge } from './service.js';
import { UNIT_STATUTS } from '../service-kinds.js';
import { categorieBadge as annonceBadge } from './announcements.js';
import { html as lit, render as litRender } from '../vendor/lit-html-3.2.1/lit-html.js';
import { unsafeHTML } from '../vendor/lit-html-3.2.1/directives/unsafe-html.js';

// Ressources de l'API lues par /dashboard (voir server/events.js) ; settings et admin : niveau DEFCON
const TOPICS = ['warrants', 'vehicles', 'reports', 'incidents', 'tickets', 'complaints', 'announcements', 'service', 'justice', 'citizens', 'settings', 'admin'];

const stat = (label, value, href, ic, cls = '') => html`<a class="stat ${cls}" href="${href}">${icon(ic)}<strong>${value}</strong><span>${label}</span></a>`;

// Une entrée par bloc de la page, toujours dans le même ordre (bloc absent : '') :
// lit-html compare chaque bloc à son rendu précédent et ne remplace que ceux qui ont changé
const blocks = d => {
  const info = defconInfo(state.defcon);
  return [
    html`<section class="card defcon-card defcon-${state.defcon}">
      <div class="defcon-level"><span>DEFCON</span><strong>${state.defcon}</strong></div>
      <div class="defcon-body">
        <h3>${info.signification}</h3>
        <dl class="dl">
          <dt>Droits FDO</dt><dd>${info.droits}</dd>
          <dt>Équipement</dt><dd>${info.equipement}</dd>
          <dt>Amendes</dt><dd>${info.amendes}</dd>
        </dl>
        ${hasRole('superviseur') && html`
          <label class="field-inline">Changer le niveau
            <select class="input" data-defcon>${[5, 4, 3, 2, 1].map(n => html`<option value="${n}" ${n === state.defcon ? 'selected' : ''}>Defcon ${n}</option>`)}</select>
          </label>`}
      </div>
    </section>`,

    html`<section class="stats">
      ${stat('Casiers judiciaires', d.stats.casiers, '#/casiers', 'citizens')}
      ${stat('Mandats & BOLO actifs', d.stats.mandats_actifs, '#/mandats', 'warrant', d.stats.mandats_actifs ? 'stat-danger' : '')}
      ${stat('Véhicules volés', d.stats.vehicules_voles, '#/vehicules', 'car', d.stats.vehicules_voles ? 'stat-danger' : '')}
      ${stat('Arrestations ce mois', d.stats.rapports_mois, '#/rapports', 'report')}
    </section>`,

    d.moi ? html`<section class="card span-2">
      <div class="card-head"><h3>Mon activité ce mois</h3><a href="#/agents/${state.user.id}">Mon profil</a></div>
      <div class="stats stats-4">
        ${stat('Arrestations', d.moi.arrestations, '#/rapports', 'report')}
        ${stat('Amendes', d.moi.amendes, '#/amendes', 'ticket')}
        ${stat("Rapports d'incident", d.moi.incidents, '#/incidents', 'incident')}
        ${stat('Plaintes reçues', d.moi.plaintes, '#/plaintes', 'complaint')}
      </div>
    </section>` : '',

    html`<section class="card span-2">
      <div class="card-head"><h3>Dernières annonces</h3><a href="#/annonces">Toutes les annonces</a></div>
      ${d.annonces.length ? html`<ul class="list">${d.annonces.map(a => html`
        <li>${a.lu ? '' : html`<span class="ping" title="Non lue">Nouveau</span>`}${a.epingle ? '📌' : ''}${annonceBadge(a.categorie)}${a.division ? html`<span class="badge">${a.division}</span>` : ''}
          <a class="grow strong" href="#/annonces?onglet=${a.categorie}">${a.titre}</a>
          ${a.importance === 'urgente' ? html`<span class="badge badge-danger">Urgente</span>` : ''}
          <small class="muted nowrap">${fmtDateTime(a.created_at)} · 『${a.auteur_matricule}』</small></li>`)}</ul>`
        : html`<p class="empty-state">Aucune annonce.</p>`}
    </section>`,

    html`<section class="card span-2">
      <div class="card-head"><h3>Unités en service</h3><a href="#/service/patrouilles">Tableau des patrouilles</a></div>
      ${d.unites.length ? html`<div class="units-mini">${d.unites.map(u => html`
        <a class="unit-mini unit-${u.statut}" href="#/service/patrouilles">
          <strong class="mono">${u.indicatif}</strong>${statutBadge(UNIT_STATUTS[u.statut])}
          <small class="muted">${u.agents.map(m => `『${m}』`).join(' ') || 'Aucun agent'}${[u.secteur, u.poste].filter(Boolean).map(s => ` · ${s}`).join('')}</small>
        </a>`)}</div>`
        : html`<p class="empty-state">Aucune unité en service. <a href="#/service/patrouilles">Prendre le service</a></p>`}
    </section>`,

    html`<section class="card">
      <div class="card-head"><h3>Mandats & BOLO actifs</h3><a href="#/mandats">Tout voir</a></div>
      ${d.mandats.length ? html`<ul class="list">${d.mandats.map(w => html`
        <li>${warrantTypeBadge(w.type)} <span class="grow">${warrantTarget(w)}<small class="muted">${w.motif}</small></span><small class="muted nowrap">${fmtDateTime(w.created_at)}</small></li>`)}</ul>`
        : html`<p class="empty-state">Aucun mandat actif.</p>`}
    </section>`,

    html`<section class="card">
      <div class="card-head"><h3>Dernières arrestations</h3><a href="#/rapports">Tout voir</a></div>
      ${d.rapports.length ? html`<ul class="list">${d.rapports.map(r => html`
        <li><a href="#/rapports/${r.id}" class="mono">${r.numero}</a><span class="grow">${fullName({ nom: r.suspect_nom, prenom: r.suspect_prenom })}<small class="muted">${r.nb_chefs} chef(s) · 『${r.redacteur_matricule}』</small></span><small class="muted">${fmtDate(r.date_faits)}</small></li>`)}</ul>`
        : html`<p class="empty-state">Aucune arrestation enregistrée.</p>`}
    </section>`,

    html`<section class="card">
      <div class="card-head"><h3>Mes brouillons</h3></div>
      ${d.brouillons.length ? html`<ul class="list">${d.brouillons.map(r => html`
        <li><a href="#/rapports/${r.id}/modifier" class="mono">${r.numero}</a><span class="grow">${fullName({ nom: r.suspect_nom, prenom: r.suspect_prenom })}</span><small class="muted">${fmtDateTime(r.updated_at)}</small></li>`)}</ul>`
        : html`<p class="empty-state">Aucun brouillon en cours.</p>`}
    </section>`,

    html`<section class="card">
      <div class="card-head"><h3>Plaintes en cours</h3><a href="#/plaintes">Tout voir</a></div>
      ${d.plaintes.length ? html`<ul class="list">${d.plaintes.map(p => html`
        <li><a href="#/plaintes/${p.id}" class="mono">${p.numero}</a><span class="grow">${p.plaignant_nom || '—'}</span>${complaintBadge(p.statut)}<small class="muted">${fmtDate(p.date_depot)}</small></li>`)}</ul>`
        : html`<p class="empty-state">Aucune plainte en cours.</p>`}
    </section>`,
  ];
};

export async function render(main) {
  const d = await api('/dashboard');
  // Le squelette de chargement posé par app.js est retiré : lit-html rend dans un conteneur vide
  main.replaceChildren();
  // Blocs déjà échappés par le html de dom.js : unsafeHTML ne remplace le bloc que si son HTML a changé
  const draw = data => litRender(lit`
    <div class="page-head">
      <div>
        <h1>Bonjour, ${state.user.grade} ${fullName(state.user)}</h1>
        <p class="muted">${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>
      <div class="actions">
        <a class="btn btn-primary" href="#/rapports/nouveau">${unsafeHTML(String(icon('plus')))} Nouveau rapport d'arrestation</a>
        <a class="btn" href="#/calculatrice">${unsafeHTML(String(icon('calculator')))} Calculatrice</a>
        <button type="button" class="btn btn-ghost" data-shortcuts title="Raccourcis clavier (?)">${unsafeHTML(String(icon('zap')))} Raccourcis</button>
      </div>
    </div>
    <div class="dash-grid">${blocks(data).map(b => unsafeHTML(String(b)))}</div>`, main);
  draw(d);

  // Délégués : les blocs redessinés gardent leurs gestionnaires
  main.addEventListener('click', e => {
    if (e.target.closest('[data-shortcuts]')) window.dispatchEvent(new Event('show-shortcuts'));
  });
  main.addEventListener('change', e => {
    if (!e.target.matches('[data-defcon]')) return;
    attempt(async () => {
      state.defcon = (await api('/settings', { method: 'PUT', body: { defcon: Number(e.target.value) } })).defcon;
      window.dispatchEvent(new Event('defcon-change'));
      toast(`Niveau Defcon ${state.defcon} activé`);
      rerender();
    });
  });

  // Temps réel : seuls les blocs dont les données ont changé sont remplacés
  live(main, TOPICS, async () => draw(await api('/dashboard')));
}
