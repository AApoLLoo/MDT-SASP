import { html, mount, $, attempt, openModal, formValues, toast, fullName, agentLabel, fmtDate, todayIso, normalize } from '../dom.js';
import { api, state, userByMatricule } from '../api.js';
import { navigate } from '../router.js';
import { icon } from '../icons.js';
import { DIVISION_KINDS } from '../service-kinds.js';
import { incidentTitre } from '../incident-kinds.js';
import { openRecordForm, canManage, statutBadge, linkedLabel } from './service.js';
import { sketchSvg, openSketchEditor } from '../components/sketch.js';
import { citizenPicker } from '../components/picker.js';
import { openWarrantForm } from './warrants.js';
import { COMPLAINT_STATUTS } from './complaints.js';
import { EVIDENCE_STATUTS } from './evidence.js';

// Pages du BCI : liste des dossiers d'enquête et page d'un dossier.
// Un dossier (`enquetes`) porte un numéro BCI-AAAA-NNNN. Ce numéro rattache au dossier ses actes (`actes`) et les
// opérations du S.W.A.T. (`operations`, champ « Dossier BCI ») ; le serveur les renvoie dans `liens` avec les documents
// du MDT cités par leur numéro et les fiches citoyens des personnes liées.
const KIND = DIVISION_KINDS.enquetes;
const REFRESH_MS = 15000;
const ACTIFS = ['ouverte', 'en_cours', 'suspendue'];
const PRIORITE = { Basse: '', Normale: 'badge-info', Haute: 'badge-warn', Critique: 'badge-danger' };
const QUALITE = { Suspect: 'badge-danger', "Personne d'intérêt": 'badge-warn', Témoin: 'badge-info', Victime: '', Informateur: 'badge-ok' };
const QUALITES = KIND.fields.find(f => f.key === 'personnes').columns[0].options;
const TABLEAU = KIND.fields.find(f => f.key === 'tableau');

// Document cité : [type, lien, détail, statut]
const DOCS = {
  rapport: d => ["Rapport d'arrestation", `#/rapports/${d.id}`, d.label && `Suspect : ${d.label}`, d.statut === 'finalise' ? 'Finalisé' : 'Brouillon'],
  plainte: d => ['Plainte', `#/plaintes/${d.id}`, d.label && `Plaignant : ${d.label}`, COMPLAINT_STATUTS[d.statut]],
  incident: d => [incidentTitre(d.type), `#/incidents/${d.id}`, d.label, d.statut === 'finalise' ? 'Finalisé' : 'Brouillon'],
  scelle: d => ['Scellé', `#/preuves?q=${encodeURIComponent(d.numero)}`, d.label, EVIDENCE_STATUTS[d.statut]?.[0]],
};

const equipe = rec => (rec.data.equipe ?? []).map(r => r.agent).filter(Boolean);
const isMine = rec => rec.agent_id === state.user.id || equipe(rec).some(m => m.toLowerCase() === state.user.matricule.toLowerCase());
const agentOf = rec => userByMatricule(rec.agent_matricule) ?? { matricule: rec.agent_matricule, nom: rec.agent_nom, prenom: rec.agent_prenom, grade: rec.agent_grade };
const priorite = p => (p ? html`<span class="badge ${PRIORITE[p]}">${p}</span>` : '');

export const renderEnquetes = (main, id) => (id ? renderDossier(main, Number(id)) : renderListe(main));

// ---------- Liste des dossiers ----------

async function renderListe(main) {
  mount(main, html`
    <div class="page-head">
      <div><h1>${icon('search')} ${KIND.titre}</h1><p class="muted">Division BCI · ${KIND.aide}</p></div>
      ${canManage(KIND) ? html`<div class="actions"><button class="btn btn-primary" data-new>${icon('plus')} ${KIND.nouveau}</button></div>` : ''}
    </div>
    <div class="toolbar">
      <div class="search-box grow">${icon('search')}<input type="search" class="input" data-q placeholder="N° de dossier, objet, personne, plaque…"></div>
      <select class="input" data-statut aria-label="Statut"><option value="">Dossiers actifs</option><option value="tous">Tous les statuts</option>
        ${Object.entries(KIND.statuts).map(([k, [l]]) => html`<option value="${k}">${l}</option>`)}</select>
      <label class="check"><input type="checkbox" data-mine> Mes dossiers</label>
    </div>
    <div class="card table-wrap" data-results></div>`);

  let list = [];
  const draw = () => {
    const q = normalize($('[data-q]', main).value);
    const statut = $('[data-statut]', main).value;
    const mine = $('[data-mine]', main).checked;
    const rows = list.filter(rec => (statut === 'tous' || (statut ? rec.statut === statut : ACTIFS.includes(rec.statut)))
      && (!mine || isMine(rec))
      && (!q || normalize([rec.data.numero, rec.data.objet, rec.data.type, ...(rec.data.personnes ?? []).map(p => p.nom), ...(rec.data.vehicules ?? []).map(v => v.plaque)].join(' ')).includes(q)));
    mount($('[data-results]', main), rows.length ? html`<table class="table table-click">
      <thead><tr><th>N°</th><th>Objet</th><th>Priorité</th><th>${KIND.agent}</th><th>Personnes</th><th>Ouvert le</th><th>Statut</th></tr></thead>
      <tbody>${rows.map(rec => html`<tr data-href="#/divisions/bci/enquetes/${rec.id}">
        <td class="mono strong nowrap">${rec.data.numero}</td>
        <td>${rec.data.objet}<small class="muted block">${rec.data.type}</small></td>
        <td>${priorite(rec.data.priorite) || '—'}</td>
        <td>${agentLabel(agentOf(rec))}${equipe(rec).length ? html`<small class="muted block">+ ${equipe(rec).length} enquêteur(s)</small>` : ''}</td>
        <td>${(rec.data.personnes ?? []).length || '—'}</td>
        <td class="nowrap">${fmtDate(rec.date)}</td>
        <td>${statutBadge(KIND.statuts[rec.statut])}</td></tr>`)}</tbody></table>`
      : html`<p class="empty-state">${list.length ? 'Aucun dossier ne correspond.' : 'Aucun dossier d’enquête.'}</p>`);
  };

  for (const el of [$('[data-q]', main), $('[data-statut]', main), $('[data-mine]', main)]) el.addEventListener('input', draw);
  $('[data-new]', main)?.addEventListener('click', e => attempt(() => openRecordForm('enquetes', null,
    saved => navigate(`/divisions/bci/enquetes/${saved.id}`), { agent_id: state.user.id, date_ouverture: todayIso(), priorite: 'Normale' }), e.currentTarget));
  main.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
  list = await api('/service/enquetes?limit=2000');
  draw();
}

// ---------- Page d'un dossier ----------

async function renderDossier(main, id) {
  const manage = canManage(KIND);
  const url = `/service/enquetes/${id}`;
  let rec;

  const section = (titre, texte) => html`<h4>${titre}</h4>${texte ? html`<p class="pre-wrap">${texte}</p>` : html`<p class="muted small">Non renseigné.</p>`}`;

  function personnes(citoyens) {
    const fiches = new Map(citoyens.map(c => [String(c.id), c]));
    const list = rec.data.personnes ?? [];
    return html`<ul class="list">${list.map((p, i) => {
      const c = fiches.get(p.citoyen);
      return html`<li>
        <span class="badge ${QUALITE[p.role] ?? ''}">${p.role || '—'}</span>
        <span class="grow">${c ? html`<a href="#/casiers/${c.id}">${p.nom || fullName(c)}</a>` : html`<strong>${p.nom}</strong> <small class="muted">(non fiché)</small>`}
          ${c?.mandats_actifs ? html` <span class="badge badge-danger">Mandat actif</span>` : ''}
          ${c ? html`<small class="muted">${c.nb_arrestations} arrestation(s) au casier${p.notes ? ` · ${p.notes}` : ''}</small>` : p.notes ? html`<small class="muted">${p.notes}</small>` : ''}</span>
        ${manage && c ? html`<button type="button" class="btn btn-sm btn-ghost" data-warrant="${i}" title="Émettre un mandat ou un BOLO">${icon('warrant')}</button>` : ''}
        ${manage ? html`<button type="button" class="btn-icon" data-person-rm="${i}" title="Retirer du dossier">✕</button>` : ''}
      </li>`;
    })}</ul>${list.length ? '' : html`<p class="muted small">Aucune personne liée.</p>`}
    ${manage ? html`<button type="button" class="btn btn-sm mt-sm" data-person-add>${icon('plus')} Ajouter une personne</button>` : ''}`;
  }

  function documents(docs) {
    const notes = new Map((rec.data.pieces ?? []).map(p => [p.numero, p.note]));
    return html`<ul class="list">${docs.map(d => {
      const [type, href, detail, statut] = DOCS[d.doc]?.(d) ?? [];
      const note = notes.get(d.numero);
      return html`<li><span class="grow">
        ${d.introuvable ? html`<span class="mono">${d.numero}</span> <span class="badge badge-warn">Introuvable</span>`
          : d.doc === 'dossier' ? html`Dossier lié : ${linkedLabel(d.dossier)}`
            : html`<a class="mono" href="${href}">${d.numero}</a> · ${type} <span class="badge">${statut}</span>${detail ? html`<small class="muted">${detail}</small>` : ''}`}
        ${note ? html`<small class="muted">${note}</small>` : ''}</span>
        ${manage ? html`<button type="button" class="btn-icon" data-doc-rm="${d.numero}" title="Retirer le lien">✕</button>` : ''}</li>`;
    })}</ul>${docs.length ? '' : html`<p class="muted small">Aucun document lié.</p>`}
    ${manage ? html`<form class="inline-form" data-doc-form>
      <input class="input input-sm mono" name="numero" required placeholder="SASP-, PLT-, INC-, PRV-, BCI-…" aria-label="Numéro du document">
      <input class="input input-sm" name="note" placeholder="Note (facultatif)" aria-label="Note">
      <button class="btn btn-sm">Lier</button></form>` : ''}`;
  }

  const acte = a => html`<li class="acte" data-acte="${a.id}">
    <div class="acte-head"><strong>${a.data.type}</strong>${a.statut === 'realise' ? '' : html` ${statutBadge(DIVISION_KINDS.actes.statuts[a.statut])}`}
      <small class="muted">${fmtDate(a.data.date)}${a.data.heure ? ` à ${a.data.heure}` : ''}${a.data.lieu ? ` · ${a.data.lieu}` : ''} · 『${a.agent_matricule}』</small></div>
    ${a.data.personnes ? html`<small class="muted">Personnes : ${a.data.personnes}</small>` : ''}
    <p class="acte-text pre-wrap">${a.data.compte_rendu}</p>
    ${Object.keys(a.data.pieces ?? {}).length ? html`<small class="muted">${Object.keys(a.data.pieces).length} photo(s)</small>` : ''}
  </li>`;

  const operation = o => html`<li data-op="${o.id}" class="${o.resume ? '' : 'is-click'}"><span class="grow"><strong>${o.data.nom}</strong>
    <small class="muted">${[o.data.type, o.data.lieu, fmtDate(o.date)].filter(Boolean).join(' · ')} · ${o.statut === 'demandee' ? 'Demandeur' : "Chef d'opération"} 『${o.agent_matricule}』</small></span>
    ${statutBadge(DIVISION_KINDS.operations.statuts[o.statut])}</li>`;

  function draw() {
    const { liens, data } = rec;
    const actes = liens.entrants.filter(r => r.kind === 'actes')
      .sort((a, b) => `${b.data.date}${b.data.heure ?? ''}`.localeCompare(`${a.data.date}${a.data.heure ?? ''}`) || b.id - a.id);
    const ops = liens.entrants.filter(r => r.kind === 'operations');
    const photos = Object.values(data.photos ?? {});
    mount(main, html`
      <div class="page-head">
        <div>
          <p class="case-num"><span class="mono">${data.numero}</span> ${statutBadge(KIND.statuts[rec.statut])} ${priorite(data.priorite)}</p>
          <h1>${data.objet}</h1>
          <p class="muted">${data.type} · ouvert le ${fmtDate(data.date_ouverture)} · ${KIND.agent} : <a href="#/agents/${rec.agent_id}">${agentLabel(agentOf(rec))}</a></p>
        </div>
        <div class="actions">
          <span class="sketch-live" data-live></span>
          <a class="btn btn-ghost" href="#/divisions/bci/enquetes">${icon('back')} Dossiers</a>
          ${manage ? html`<button type="button" class="btn" data-edit>${icon('edit')} Modifier le dossier</button>
            <button type="button" class="btn btn-primary" data-acte-new>${icon('plus')} Consigner un acte</button>` : ''}
        </div>
      </div>
      <div class="case-grid">
        <div>
          <section class="card case-synthese"><div class="card-head"><h3>Synthèse</h3></div>
            ${section('Résumé des faits', data.resume)}${section('Hypothèses et pistes', data.elements)}${data.conclusion ? section('Conclusion', data.conclusion) : ''}</section>
          <section class="card"><div class="card-head"><h3>Journal d'enquête <span class="muted">(${actes.length})</span></h3></div>
            ${actes.length ? html`<ul class="list actes">${actes.map(acte)}</ul>` : html`<p class="muted small">Aucun acte consigné : auditions, perquisitions, filatures, réquisitions…</p>`}</section>
          <section class="card"><div class="card-head"><h3>${TABLEAU.label}</h3>
            ${manage ? html`<button type="button" class="btn btn-sm btn-primary" data-tableau>${icon('edit')} Ouvrir le tableau partagé</button>` : ''}</div>
            <div class="sketch-preview ${manage ? 'is-click' : ''}" data-tableau>${sketchSvg(data.tableau ?? { fond: '', objets: [] }, TABLEAU.units)}</div>
            <p class="muted small">Suspects, liens, lieux et véhicules : chacun dessine en direct, tout s'enregistre au fil de l'eau.</p></section>
        </div>
        <div>
          <section class="card"><div class="card-head"><h3>Équipe</h3></div>
            <ul class="list"><li><span class="grow">${agentLabel(agentOf(rec))}</span><span class="badge badge-gold">Référent</span></li>
              ${(data.equipe ?? []).map(r => html`<li><span class="grow">${userByMatricule(r.agent) ? agentLabel(userByMatricule(r.agent)) : `『${r.agent}』`}</span><span class="badge">${r.role || 'Co-enquêteur'}</span></li>`)}</ul></section>
          <section class="card"><div class="card-head"><h3>Personnes liées</h3></div>${personnes(liens.citoyens)}</section>
          <section class="card"><div class="card-head"><h3>Opérations S.W.A.T.</h3></div>
            ${ops.length ? html`<ul class="list">${ops.map(operation)}</ul>` : html`<p class="muted small">Aucune opération liée à ce dossier.</p>`}
            ${manage ? html`<button type="button" class="btn btn-sm mt-sm" data-appui>${icon('target')} ${canManage(DIVISION_KINDS.operations) ? 'Planifier une opération liée' : "Demander l'appui du S.W.A.T."}</button>` : ''}</section>
          <section class="card"><div class="card-head"><h3>Documents liés</h3></div>${documents(liens.documents)}</section>
          <section class="card"><div class="card-head"><h3>Véhicules</h3></div>
            ${(data.vehicules ?? []).length ? html`<ul class="list">${data.vehicules.map(v => html`<li><span class="grow"><strong class="mono">${v.plaque || '—'}</strong> ${v.modele ?? ''}${v.notes ? html`<small class="muted">${v.notes}</small>` : ''}</span></li>`)}</ul>`
              : html`<p class="muted small">Aucun véhicule. Ajoutez-les avec « Modifier le dossier ».</p>`}</section>
          ${photos.length ? html`<section class="card"><div class="card-head"><h3>Photos et documents</h3></div>
            <div class="photo-grid">${photos.map(src => html`<a href="${src}" target="_blank" rel="noopener"><img class="photo-thumb" src="${src}" alt="" loading="lazy"></a>`)}</div></section>` : ''}
        </div>
      </div>`);
    $('[data-live]', main).textContent = `● En direct · actualisé à ${new Date().toLocaleTimeString('fr-FR')}`;
  }

  const load = async () => {
    rec = await api(url);
    draw();
  };
  const reload = () => attempt(load);

  // Les listes du dossier sont modifiées à partir de leur dernière version : un autre enquêteur a pu y toucher.
  // Renvoie true une fois enregistré (l'erreur est affichée par attempt)
  const patch = (key, change) => attempt(async () => {
    const fresh = await api(url);
    await api(url, { method: 'PUT', body: { [key]: change(fresh.data[key] ?? []) } });
    await load();
    return true;
  });
  const same = a => b => JSON.stringify(a) === JSON.stringify(b);

  function openPersonForm() {
    let fiche = null;
    const dialog = openModal(`Ajouter une personne · ${rec.data.numero}`, html`
      <form class="form-grid" data-form>
        <label>Qualité *<select class="input" name="role" required>${QUALITES.map(q => html`<option>${q}</option>`)}</select></label>
        <div class="span-2 field"><span>Fiche citoyen</span><div data-fiche></div><div data-picker></div></div>
        <label class="span-2">Identité *<input class="input" name="nom" required placeholder="Nom et prénom, ou signalement si la personne n'est pas identifiée"></label>
        <label class="span-2">Notes<input class="input" name="notes" placeholder="Rôle dans l'affaire, alias, lien avec les autres…"></label>
        <div class="span-2 form-actions"><button class="btn btn-primary">Ajouter</button></div>
      </form>`);
    const form = $('[data-form]', dialog);
    const showFiche = () => mount($('[data-fiche]', dialog), fiche
      ? html`<span class="chosen">${fullName(fiche)}${fiche.mandats_actifs ? html` <span class="badge badge-danger">Mandat actif</span>` : ''} <button type="button" class="btn-icon" data-unset>✕</button></span>`
      : html`<span class="muted small">Aucune : recherchez la personne au fichier, ou saisissez seulement son identité</span>`);
    citizenPicker($('[data-picker]', dialog), c => {
      fiche = c;
      form.nom.value = fullName(c);
      showFiche();
    });
    dialog.addEventListener('click', e => { if (e.target.closest('[data-unset]')) { fiche = null; showFiche(); } });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const row = { ...formValues(form), citoyen: fiche ? String(fiche.id) : '' };
      patch('personnes', list => [...list, row]).then(ok => ok && dialog.close());
    });
    showFiche();
  }

  main.addEventListener('submit', e => {
    if (!e.target.matches('[data-doc-form]')) return;
    e.preventDefault();
    const { numero, note } = formValues(e.target);
    const n = numero.toUpperCase();
    if ((rec.data.pieces ?? []).some(p => p.numero === n)) return toast(`${n} est déjà lié au dossier`, 'error');
    patch('pieces', list => [...list, { numero: n, note }]);
  });

  main.addEventListener('click', e => {
    const t = e.target.closest('button, [data-acte], [data-op], [data-tableau]');
    if (!t || e.target.closest('a')) return;
    const ds = t.dataset;
    const numero = rec.data.numero;
    if (t.matches('[data-edit]')) attempt(() => openRecordForm('enquetes', rec, load), t);
    else if (t.matches('[data-acte-new]')) attempt(() => openRecordForm('actes', null, load, { dossier: numero, agent_id: state.user.id, date: todayIso() }), t);
    else if (ds.acte) attempt(() => openRecordForm('actes', rec.liens.entrants.find(r => r.id === Number(ds.acte)), load));
    else if (ds.op) {
      const o = rec.liens.entrants.find(r => r.id === Number(ds.op));
      if (!o.resume) attempt(() => openRecordForm('operations', o, load));
    } else if (t.matches('[data-appui]')) {
      attempt(() => openRecordForm('operations', null, load, { dossier: numero, type: 'Mandat à haut risque', date: todayIso(), objectif: `Appui du BCI, dossier ${numero} : ${rec.data.objet}` }), t);
    } else if (t.matches('[data-tableau]') && manage) {
      openSketchEditor({ url: `${url}/live/tableau`, units: TABLEAU.units, onClose: () => reload() });
    } else if (t.matches('[data-person-add]')) openPersonForm();
    else if (ds.personRm) {
      const p = rec.data.personnes[ds.personRm];
      if (confirm(`Retirer ${p.nom} du dossier ?`)) patch('personnes', list => list.filter(x => !same(p)(x)));
    } else if (ds.warrant) {
      const c = rec.liens.citoyens.find(x => String(x.id) === rec.data.personnes[ds.warrant].citoyen);
      openWarrantForm({ type: 'mandat', citizen_id: c.id, citizen_nom: c.nom, citizen_prenom: c.prenom, motif: `Dossier ${numero} : ${rec.data.objet}` }, reload);
    } else if (ds.docRm && confirm(`Retirer le lien vers ${ds.docRm} ?`)) patch('pieces', list => list.filter(p => p.numero !== ds.docRm));
  });

  // Actualisation automatique tant que la page est affichée, sans formulaire ouvert ni saisie en cours
  const timer = setInterval(() => {
    if (!main.isConnected) return clearInterval(timer);
    if (!document.querySelector('dialog[open]') && !main.contains(document.activeElement?.closest('input, select, textarea'))) load().catch(() => {});
  }, REFRESH_MS);

  await load();
}
