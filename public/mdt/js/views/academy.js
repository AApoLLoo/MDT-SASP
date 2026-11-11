import { html, mount, $, attempt, agentLabel, fmtDate, todayIso, normalize } from '../dom.js';
import { api, state, loadUsers } from '../api.js';
import { icon } from '../icons.js';
import { DIVISION_KINDS, isMember, ROOKIE } from '../service-kinds.js';
import { openRecordForm, canManage, statutBadge } from './service.js';
import { avatar } from '../components/avatar.js';

// Pages de l'Academy : catalogue des formations et suivi des rookies.
// Une formation est une entrée de « Qualifications & formations » (Administration → Paramètres) ; sa fiche
// (dossier `catalogue`) ajoute prérequis et programme. Formations attribuées : dossiers `formations` ;
// validées, elles rejoignent les qualifications du profil. Notes des formateurs : dossiers `notes_recrue`.
const REFRESH_MS = 10000;
const EVALS = DIVISION_KINDS.formations;

const prereqs = c => (c.data.prerequis ?? []).map(r => r.formation).filter(Boolean);

// Des bases aux plus avancées : niveau = plus longue chaîne de prérequis (une boucle de prérequis est ignorée)
function byLevel(catalogue) {
  const byName = new Map(catalogue.map(c => [c.data.nom, c]));
  const level = (c, seen) => Math.max(0, ...prereqs(c).filter(n => byName.has(n) && !seen.has(n)).map(n => level(byName.get(n), new Set([...seen, n])) + 1));
  return catalogue.map(c => [c, level(c, new Set([c.data.nom]))])
    .sort((a, b) => a[1] - b[1] || a[0].data.nom.localeCompare(b[0].data.nom)).map(([c]) => c);
}

// ---------- Catalogue des formations ----------

export async function renderCatalogue(main) {
  const kind = DIVISION_KINDS.catalogue;
  mount(main, html`
    <div class="page-head">
      <div><h1>${icon('book')} Formations</h1><p class="muted">Division Academy · catalogue des formations et de leurs prérequis</p></div>
      ${canManage(kind) ? html`<div class="actions"><button class="btn btn-primary" data-new>${icon('plus')} Nouvelle formation</button></div>` : ''}
    </div>
    <div class="toolbar">
      <div class="search-box grow">${icon('search')}<input type="search" class="input" data-q placeholder="Formation ou prérequis…"></div>
      <select class="input" data-cat><option value="">Toutes les catégories</option>${kind.fields.find(f => f.key === 'categorie').options.map(c => html`<option>${c}</option>`)}</select>
      <label class="check"><input type="checkbox" data-archives> Archivées</label>
    </div>
    <div class="card table-wrap" data-results></div>`);

  let list = [];
  const draw = () => {
    const q = normalize($('[data-q]', main).value);
    const cat = $('[data-cat]', main).value;
    const archives = $('[data-archives]', main).checked;
    const names = state.settings.qualifications;
    const fiches = new Set(list.map(c => c.data.nom));
    // Les fiches, des bases aux plus avancées, puis les formations de la liste qui n'en ont pas encore
    const rows = [...byLevel(list), ...names.filter(n => !fiches.has(n)).map(nom => ({ data: { nom } }))]
      .filter(c => (archives || c.statut !== 'archivee') && (!cat || c.data.categorie === cat) && (!q || normalize([c.data.nom, ...(c.id ? prereqs(c) : [])].join(' ')).includes(q)));
    mount($('[data-results]', main), rows.length ? html`<table class="table table-click">
      <thead><tr><th>Formation</th><th>Catégorie</th><th>Prérequis</th><th>Grade min.</th><th>Rookies</th><th>Référent</th></tr></thead>
      <tbody>${rows.map(c => (c.id ? html`<tr data-id="${c.id}">
        <td><strong>${c.data.nom}</strong>${c.statut === 'archivee' ? html` <span class="badge">Archivée</span>` : ''}${names.includes(c.data.nom) ? '' : html` <span class="badge badge-warn">Retirée de la liste</span>`}${c.data.duree ? html`<br><small class="muted">${c.data.duree}</small>` : ''}</td>
        <td>${c.data.categorie || '—'}</td>
        <td>${prereqs(c).length ? html`<div class="tags">${prereqs(c).map(p => html`<span class="chip chip-static">${p}</span>`)}</div>` : html`<span class="muted">Aucun</span>`}</td>
        <td>${c.data.grade_min || '—'}</td>
        <td>${c.data.rookie === 'Oui' ? html`<span class="badge badge-ok">Programme</span>` : '—'}</td>
        <td class="mono">『${c.agent_matricule}』</td></tr>`
        : html`<tr data-nom="${c.data.nom}"><td><strong>${c.data.nom}</strong></td><td colspan="5" class="muted">Fiche à compléter : prérequis, programme rookie, contenu…</td></tr>`))}</tbody></table>`
      : html`<p class="empty-state">${list.length || names.length ? 'Aucune formation ne correspond.' : 'Aucune formation.'}</p>`);
  };
  // La liste peut avoir changé (formation ajoutée par une fiche, renommage dans l'administration)
  const load = async () => {
    [list, state.settings] = await Promise.all([api('/service/catalogue?limit=2000'), api('/settings')]);
    draw();
  };
  const reload = () => attempt(load);
  for (const el of [$('[data-q]', main), $('[data-cat]', main), $('[data-archives]', main)]) el.addEventListener('input', draw);
  $('[data-new]', main)?.addEventListener('click', e => attempt(() => openRecordForm('catalogue', null, reload, { agent_id: state.user.id, rookie: 'Oui' }), e.currentTarget));
  main.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id], tr[data-nom]');
    if (tr?.dataset.id) attempt(() => openRecordForm('catalogue', list.find(c => c.id === Number(tr.dataset.id)), reload));
    else if (tr && canManage(kind)) attempt(() => openRecordForm('catalogue', null, reload, { nom: tr.dataset.nom, agent_id: state.user.id, rookie: 'Non' }));
  });
  await load();
}

// ---------- Suivi des rookies ----------

export async function renderRookies(main) {
  const manage = canManage(EVALS);
  mount(main, html`
    <div class="page-head">
      <div><h1>${icon('cap')} Suivi des rookies</h1><p class="muted">Agents au grade Rookie : programme de formation, évaluations et notes des formateurs. Cliquez sur une formation pour l'attribuer ou l'évaluer.</p></div>
      <span class="sketch-live" data-live></span>
    </div>
    <div class="toolbar">
      <div class="search-box grow">${icon('search')}<input type="search" class="input" data-q placeholder="Nom ou matricule d'un rookie…"></div>
      <label class="check"><input type="checkbox" data-mine> Mes rookies</label>
      <span class="rookie-warn small" data-sans></span>
    </div>
    <div class="rookies" data-rookies></div>`);

  let catalogue = [];
  let evals = [];
  let notes = [];
  const openNotes = new Set(); // notes dépliées, gardées d'une actualisation à l'autre

  // Tuteurs du rookie : agents de l'Academy, plusieurs possibles ; un tuteur suit autant de rookies que nécessaire
  function tutorsRow(u, academy) {
    const tuteurs = u.tuteurs.map(id => state.users.find(a => a.id === id)).filter(Boolean);
    const free = academy.filter(a => a.id !== u.id && !u.tuteurs.includes(a.id));
    return html`<div class="rookie-tutors"><span class="muted small">Tuteurs</span>
      ${tuteurs.length ? tuteurs.map(t => html`<span class="chip chip-static">${agentLabel(t)}${manage ? html`<button type="button" class="btn-icon" data-tutor-rm="${t.id}" data-rookie="${u.id}" title="Retirer ce tuteur">✕</button>` : ''}</span>`)
        : html`<span class="badge badge-warn">Sans tuteur</span>`}
      ${manage && free.length && tuteurs.length < 5 ? html`<select class="input input-sm" data-tutor-add="${u.id}" aria-label="Confier ce rookie à un tuteur">
        <option value="">+ Tuteur…</option>${free.map(a => html`<option value="${a.id}">${agentLabel(a)}</option>`)}</select>` : ''}
    </div>`;
  }

  function card(u, programme, byName, academy) {
    const mine = evals.filter(e => e.agent_id === u.id); // du plus récent au plus ancien
    const latest = nom => mine.find(e => e.data.module === nom);
    // Acquise : dernière évaluation validée, ou qualification déjà sur le profil
    const done = nom => latest(nom)?.statut === 'validee' || u.qualifications.includes(nom);
    const items = [...new Set([...programme.map(c => c.data.nom), ...mine.map(e => e.data.module)])];
    const myNotes = notes.filter(n => n.agent_id === u.id);
    const validated = programme.filter(c => done(c.data.nom)).length;
    const grades = state.settings.grades;
    return html`<article class="card rookie">
      <div class="rookie-head">
        ${avatar(u, 'md')}
        <div class="grow"><a href="#/agents/${u.id}"><strong>${agentLabel(u)}</strong></a>
          <small class="muted">${u.date_entree ? `Entré le ${fmtDate(u.date_entree)}` : "Date d'entrée non renseignée"}</small></div>
        ${manage ? html`<span class="actions">
          <button class="btn btn-sm" data-assign="${u.id}">${icon('plus')} Formation</button>
          <button class="btn btn-sm" data-add-note="${u.id}">${icon('edit')} Note</button></span>` : ''}
      </div>
      ${tutorsRow(u, academy)}
      <div class="rookie-progress"><progress max="${programme.length || 1}" value="${validated}"></progress>
        <small>${programme.length ? `${validated} / ${programme.length} formations du programme acquises` : 'Aucune formation au programme rookie'}</small></div>
      <ul class="list rookie-list">${items.map(nom => {
        const e = latest(nom);
        const c = byName.get(nom);
        const missing = c && !done(nom) ? [...prereqs(c).filter(p => !done(p)), ...(c.data.grade_min && grades.indexOf(u.grade) < grades.indexOf(c.data.grade_min) ? [`grade ${c.data.grade_min}`] : [])] : [];
        return html`<li data-formation="${nom}" data-agent="${u.id}" data-eval="${e?.id ?? ''}">
          <span class="grow"><strong>${nom}</strong>${c?.data.rookie === 'Oui' ? '' : html` <small class="muted">(hors programme)</small>`}
            ${e ? html`<small class="muted">${fmtDate(e.data.date)} · ${e.data.type} · 『${e.auteur_matricule ?? '—'}』${e.data.note ? ` · Note : ${e.data.note}` : ''}</small>` : ''}
            ${e?.data.observations ? html`<small class="pre-wrap">${e.data.observations}</small>` : ''}
            ${missing.length ? html`<small class="rookie-warn">⚠ Prérequis manquants : ${missing.join(', ')}</small>` : ''}</span>
          ${e ? statutBadge(EVALS.statuts[e.statut]) : done(nom) ? html`<span class="badge badge-ok">Acquise</span>` : html`<span class="badge">À faire</span>`}
        </li>`;
      })}</ul>
      <details data-notes="${u.id}" ${openNotes.has(u.id) ? 'open' : ''}>
        <summary>Notes de suivi (${myNotes.length})</summary>
        ${myNotes.length ? html`<ul class="list">${myNotes.map(n => html`<li data-note="${n.id}"><span class="grow">
          <small class="muted">${fmtDate(n.data.date)} · ${n.data.type} · 『${n.auteur_matricule ?? '—'}』</small>
          <span class="pre-wrap">${n.data.texte}</span></span></li>`)}</ul>` : html`<p class="muted small">Aucune note.</p>`}
      </details>
    </article>`;
  }

  const draw = () => {
    const q = normalize($('[data-q]', main).value);
    const mine = $('[data-mine]', main).checked;
    const all = state.users.filter(u => u.actif && ROOKIE.test(u.grade));
    const rookies = all.filter(u => (!mine || u.tuteurs.includes(state.user.id)) && (!q || normalize(`${u.prenom} ${u.nom} ${u.matricule}`).includes(q)));
    const sans = all.filter(u => !u.tuteurs.length).length;
    $('[data-sans]', main).textContent = sans ? `⚠ ${sans} rookie${sans > 1 ? 's' : ''} sans tuteur` : '';
    const academy = state.users.filter(a => a.actif && isMember('academy', a));
    const active = byLevel(catalogue.filter(c => c.statut !== 'archivee'));
    const byName = new Map(active.map(c => [c.data.nom, c]));
    mount($('[data-rookies]', main), rookies.length
      ? rookies.map(u => card(u, active.filter(c => c.data.rookie === 'Oui'), byName, academy))
      : html`<p class="empty-state">${mine ? 'Aucun rookie ne vous est confié.' : 'Aucun agent au grade Rookie.'}</p>`);
  };
  const load = async () => {
    // Agents et listes réglables aussi : grades et qualifications changent (formation validée → qualification)
    [catalogue, evals, notes, , state.settings] = await Promise.all([
      api('/service/catalogue?limit=2000'), api('/service/formations?limit=2000'), api('/service/notes_recrue?limit=2000'), loadUsers(true), api('/settings'),
    ]);
    draw();
    $('[data-live]', main).textContent = `● En direct · actualisé à ${new Date().toLocaleTimeString('fr-FR')}`;
  };
  const reload = () => attempt(load);

  // Actualisation automatique tant que la page est affichée et qu'aucun formulaire ni choix de tuteur n'est ouvert
  const timer = setInterval(() => {
    if (!main.isConnected) return clearInterval(timer);
    if (!document.querySelector('dialog[open]') && !document.activeElement?.matches('[data-tutor-add]')) load().catch(() => {});
  }, REFRESH_MS);

  const setTuteurs = (rookieId, ids) => attempt(async () => {
    await api(`/users/${rookieId}`, { method: 'PUT', body: { tuteurs: ids } });
    await load();
  });
  const tuteursOf = id => state.users.find(u => u.id === id).tuteurs;

  $('[data-q]', main).addEventListener('input', draw);
  main.addEventListener('change', e => {
    if (e.target.matches('[data-mine]')) draw();
    const rookie = Number(e.target.dataset.tutorAdd);
    if (rookie && e.target.value) setTuteurs(rookie, [...tuteursOf(rookie), Number(e.target.value)]);
  });
  main.addEventListener('toggle', e => {
    const id = Number(e.target.dataset?.notes);
    if (id) e.target.open ? openNotes.add(id) : openNotes.delete(id);
  }, true);
  main.addEventListener('click', e => {
    const rm = e.target.closest('[data-tutor-rm]');
    if (rm) return setTuteurs(Number(rm.dataset.rookie), tuteursOf(Number(rm.dataset.rookie)).filter(id => id !== Number(rm.dataset.tutorRm)));
    const t = e.target.closest('[data-assign], [data-add-note], [data-formation], [data-note]');
    if (!t || e.target.closest('a')) return;
    const today = todayIso();
    const ds = t.dataset;
    if (ds.assign) attempt(() => openRecordForm('formations', null, reload, { agent_id: Number(ds.assign), date: today, type: 'Formation initiale' }), t);
    else if (ds.addNote) attempt(() => openRecordForm('notes_recrue', null, reload, { agent_id: Number(ds.addNote), date: today, type: 'Observation' }), t);
    else if (ds.note) attempt(() => openRecordForm('notes_recrue', notes.find(n => n.id === Number(ds.note)), reload));
    else if (ds.eval) attempt(() => openRecordForm('formations', evals.find(x => x.id === Number(ds.eval)), reload));
    else if (manage) attempt(() => openRecordForm('formations', null, reload, { agent_id: Number(ds.agent), module: ds.formation, date: today, type: 'Formation initiale' }));
  });
  await load();
}
