import { html, mount, $, $$, attempt, toast, fullName, agentLabel, nowTime, fmtDate, openModal } from '../dom.js';
import { api, state, loadPenalCode, loadUsers, loadWeapons, loadAvocats } from '../api.js';
import { navigate, setLeaveGuard } from '../router.js';
import { icon } from '../icons.js';
import { formatDollars, formatDuree } from '../calc.js';
import { mountCalculator } from '../components/charges-calculator.js';
import { mountPhotos } from '../components/photos.js';
import { citizenPicker } from '../components/picker.js';
import { mountAgentsInput } from '../components/agents-input.js';
import { mirandaScript } from '../reference-data.js';
import { warrantTypeBadge } from './warrants.js';
import { statutBadge } from './reports.js';
import { templateSelect } from '../components/templates.js';

const SUSPECT_FIELDS = [
  ['nom', 'Nom *'], ['prenom', 'Prénom'], ['date_naissance', 'Date de naissance', 'date'],
  ['empreinte', 'Empreinte'], ['id_unique', 'N° sécu (ID unique)'], ['telephone', 'Téléphone'],
];

// Crée un brouillon puis ouvre l'éditeur (remplace l'URL pour éviter un doublon au retour arrière)
export async function renderNew(main, params, query) {
  const citizenId = Number(query.get('citoyen')) || undefined;
  const { id } = await api('/reports', { method: 'POST', body: { citizen_id: citizenId } });
  location.replace(`#/rapports/${id}/modifier`);
}

export const section = (n, title, body, extra = '') => html`
  <section class="card report-section">
    <div class="card-head"><h2 class="section-title"><span>${n}</span>${title}</h2>${extra}</div>
    ${body}
  </section>`;

export async function render(main, [id]) {
  const [rep, avocats] = await Promise.all([api(`/reports/${id}`), loadAvocats(), loadPenalCode(), loadUsers(), loadWeapons()]);
  if (!rep.can_edit) {
    location.replace(`#/rapports/${id}`);
    return;
  }

  const model = {
    agents_presents: [...rep.agents_presents],
    objets_illegaux: rep.objets_illegaux.map(o => ({ ...o })),
    photos: { ...rep.photos },
    suspect: { ...rep.suspect },
  };
  let calcResult = rep.calc_result;
  let suspectWarrants = [];
  let dirty = false;
  let ready = false;
  const redacteur = { matricule: rep.redacteur_matricule, nom: rep.redacteur_nom, prenom: rep.redacteur_prenom, grade: rep.redacteur_grade };

  mount(main, html`
    <div class="page-head">
      <div>
        <a href="#/rapports" class="back">${icon('back')} Rapports</a>
        <h1>Rapport d'arrestation <span class="mono gold">${rep.numero}</span></h1>
        <p class="muted">${statutBadge(rep.statut)} · Rédacteur ${agentLabel(redacteur)}</p>
      </div>
    </div>
    ${rep.renvoi_motif ? html`<div class="alert alert-warn"><strong>Renvoyé par la justice</strong><small>${rep.renvoi_motif}</small></div>` : ''}

    <form class="report-form" data-report autocomplete="off" novalidate>
      <datalist id="users-list">${state.users.filter(u => u.actif).map(u => html`<option value="${u.matricule}">${agentLabel(u)}</option>`)}</datalist>
      <datalist id="weapons-list">${state.weapons.map(w => html`<option value="${w.nom}">Catégorie ${w.categorie} · ${w.type}</option>`)}</datalist>

      ${section(1, 'En-tête', html`
        <div class="form-grid cols-4">
          <label>Fait le<input class="input" type="date" name="date_rapport" value="${rep.date_rapport}"></label>
          <label>Date des faits<input class="input" type="date" name="date_faits" value="${rep.date_faits}"></label>
          <label class="span-2">Agent rédacteur<input class="input" readonly value="${agentLabel(redacteur)}"></label>
          <div class="span-4 field">
            <span>Agents présents (matricule)</span>
            <div data-agents></div>
          </div>
        </div>`)}

      ${section(2, 'Suspect', html`
        <div data-suspect-picker></div>
        <div data-suspect-status class="suspect-status"></div>
        <div class="form-grid cols-3">
          ${SUSPECT_FIELDS.map(([k, label, type]) => html`<label>${label}<input class="input" type="${type || 'text'}" data-s="${k}" value="${model.suspect[k]}"></label>`)}
        </div>`)}

      ${section(3, "Chef(s) d'accusation · Calculatrice", html`<div data-calc></div>`)}

      ${section(4, 'Droits Miranda', html`
        <div class="miranda-grid">
          <div class="miranda-script" data-miranda></div>
          <div class="miranda-side">
            <label class="field">Lus à<input class="input" type="time" name="miranda_heure" value="${rep.miranda_heure}"></label>
            <label class="field">Par (matricule)<input class="input" name="miranda_par" list="users-list" value="${rep.miranda_par}"></label>
            <button type="button" class="btn" data-miranda-now>${icon('check')} Droits lus maintenant</button>
            <label class="field">Avocat inscrit (accès au dossier)<select class="input" name="avocat_id">
              <option value="">Aucun</option>
              ${avocats.map(a => html`<option value="${a.id}" ${a.id === rep.avocat_id ? 'selected' : ''}>${fullName(a)} (${a.matricule})</option>`)}
            </select></label>
          </div>
        </div>`)}

      ${section(5, 'Objet(s) illégal(aux) saisi(s)', html`<div data-objets></div>`,
        html`<button type="button" class="btn btn-sm" data-objet-add>${icon('plus')} Ajouter un objet</button>`)}

      ${section(6, 'Faits', html`${templateSelect('arrestation')}<textarea class="input faits" name="faits" rows="10" placeholder="Décrivez les faits de manière chronologique : contexte, interpellation, fouille, transport… (@matricule pour notifier un collègue)">${rep.faits}</textarea>`)}

      ${section(7, 'Photos', html`
        <p class="muted small">Cliquez sur un emplacement puis collez une capture (Ctrl+V), glissez-déposez une image, importez un fichier ou indiquez un lien.</p>
        <div data-photos></div>`)}
    </form>

    <div class="action-bar">
      <span class="save-status" data-status>Enregistré</span>
      <div class="actions">
        ${rep.statut === 'brouillon' && html`<button type="button" class="btn btn-ghost" data-delete>${icon('trash')} Supprimer</button>`}
        <button type="button" class="btn" data-preview>${icon('printer')} Aperçu</button>
        <button type="button" class="btn" data-save>Enregistrer <kbd>Ctrl+S</kbd></button>
        <button type="button" class="btn btn-primary" data-submit>${icon('check')} Déposer pour jugement</button>
      </div>
    </div>`);

  const form = $('[data-report]', main);
  const field = name => form.elements.namedItem(name);
  const status = $('[data-status]', main);

  const markDirty = () => {
    if (!ready) return;
    dirty = true;
    status.textContent = 'Modifications non enregistrées';
    status.classList.add('is-dirty');
  };
  setLeaveGuard(silent => !dirty || (!silent && confirm('Des modifications ne sont pas enregistrées. Quitter sans enregistrer ?')));

  // --- Agents présents
  mountAgentsInput($('[data-agents]', main), model.agents_presents, markDirty);

  // --- Suspect
  const renderMiranda = () => {
    const nom = fullName(model.suspect) === '—' ? '…' : fullName(model.suspect);
    const heure = field('miranda_heure').value || nowTime();
    mount($('[data-miranda]', main), mirandaScript({
      nom, date: fmtDate(field('date_faits').value), heure,
      charges: calcResult?.lignes.map(l => l.infraction) ?? [],
    }).map(p => html`<p>${p}</p>`));
  };

  async function renderSuspectStatus() {
    const s = model.suspect;
    const el = $('[data-suspect-status]', main);
    if (s.id) {
      const c = await api(`/citizens/${s.id}`).catch(() => null);
      suspectWarrants = c?.warrants.filter(w => w.statut === 'actif') ?? [];
      mount(el, html`
        <p>${icon('user')} Fiche citoyen liée : <a href="#/casiers/${s.id}" target="_blank">n° ${s.id}</a>
          ${c ? html`· ${c.reports.filter(r => r.statut === 'finalise').length} arrestation(s) au casier` : ''}
          <button type="button" class="btn btn-sm btn-ghost" data-unlink>Dissocier</button></p>
        ${suspectWarrants.length ? html`<div class="alert alert-danger"><strong>Mandat(s) / BOLO actif(s) sur ce suspect</strong>
          <small>${suspectWarrants.map(w => html`${warrantTypeBadge(w.type)} ${w.motif} `)}</small></div>` : ''}`);
    } else {
      suspectWarrants = [];
      mount(el, html`<p class="muted">${s.nom ? 'Nouveau citoyen : une fiche sera créée à l\'enregistrement.' : 'Recherchez un citoyen existant ou saisissez son identité.'}</p>`);
    }
  }

  citizenPicker($('[data-suspect-picker]', main), c => {
    model.suspect = { id: c.id, ...Object.fromEntries(SUSPECT_FIELDS.map(([k]) => [k, c[k] ?? ''])) };
    for (const input of $$('[data-s]', main)) input.value = model.suspect[input.dataset.s];
    markDirty();
    renderSuspectStatus();
    renderMiranda();
  }, 'Rechercher un citoyen existant (nom, ID unique, téléphone)…');

  for (const input of $$('[data-s]', main)) {
    input.addEventListener('input', () => {
      model.suspect[input.dataset.s] = input.value.trim();
      if (input.dataset.s === 'nom' || input.dataset.s === 'prenom') renderMiranda();
    });
  }

  // --- Calculatrice
  const calc = mountCalculator($('[data-calc]', main), {
    value: rep.calc_input,
    onChange: (input, result) => {
      calcResult = result;
      markDirty();
      if (ready) renderMiranda();
    },
  });

  // --- Miranda
  $('[data-miranda-now]', main).addEventListener('click', () => {
    field('miranda_heure').value = nowTime();
    if (!field('miranda_par').value) field('miranda_par').value = state.user.matricule;
    markDirty();
    renderMiranda();
  });
  field('miranda_heure').addEventListener('input', renderMiranda);
  field('date_faits').addEventListener('input', renderMiranda);

  // --- Objets illégaux
  const renderObjets = () => mount($('[data-objets]', main), model.objets_illegaux.length
    ? html`<div class="objets">${model.objets_illegaux.map((o, i) => html`
        <div class="objet-row" data-i="${i}">
          <input class="input grow" list="weapons-list" data-o="description" value="${o.description}" placeholder="Objet ou arme saisi(e)">
          <input class="input input-qty" data-o="quantite" value="${o.quantite}" placeholder="Qté">
          <button type="button" class="btn-icon" data-objet-rm title="Retirer">✕</button>
        </div>`)}</div>`
    : html`<p class="empty-state">Aucun objet saisi.</p>`);
  $('[data-objets]', main).addEventListener('input', e => {
    const row = e.target.closest('[data-i]');
    if (row && e.target.dataset.o) model.objets_illegaux[row.dataset.i][e.target.dataset.o] = e.target.value;
  });

  // --- Photos
  mountPhotos($('[data-photos]', main), model.photos, markDirty);

  // --- Enregistrement
  // Version chargée : le serveur refuse la sauvegarde si quelqu'un d'autre a enregistré depuis (409)
  let version = rep.updated_at;
  async function save({ quiet = false } = {}) {
    const saved = await api(`/reports/${id}`, {
      method: 'PUT',
      body: {
        updated_at: version,
        date_rapport: field('date_rapport').value,
        date_faits: field('date_faits').value,
        miranda_heure: field('miranda_heure').value,
        miranda_par: field('miranda_par').value,
        faits: field('faits').value,
        agents_presents: model.agents_presents,
        objets_illegaux: model.objets_illegaux,
        photos: model.photos,
        suspect: model.suspect,
        calc_input: calc.value,
        avocat_id: field('avocat_id').value || null,
      },
    });
    version = saved.updated_at;
    model.suspect = { ...saved.suspect };
    calcResult = saved.calc_result;
    dirty = false;
    status.textContent = `Enregistré à ${nowTime()}`;
    status.classList.remove('is-dirty');
    await renderSuspectStatus();
    if (!quiet) toast('Rapport enregistré');
    return saved;
  }

  function openSubmit(saved) {
    const r = saved.calc_result;
    const warnings = [
      !saved.miranda_heure && "Les droits Miranda ne sont pas notés comme lus.",
      !saved.faits.trim() && 'La section « Faits » est vide.',
      !Object.keys(saved.photos).length && 'Aucune photo jointe.',
      saved.calc_input.droits?.avocat && !saved.avocat_id && "Le suspect a demandé un avocat, mais aucun compte avocat n'est inscrit : il n'aura pas accès au dossier.",
    ].filter(Boolean);
    const dialog = openModal('Déposer pour jugement', html`
      <p>Le rapport de <strong>${fullName(saved.suspect)}</strong> part en attente de jugement : un procureur ou un juge le vérifie, ajuste les charges si besoin, puis le verse au casier.
        Vous ne pourrez plus le modifier, sauf s'il vous est renvoyé.</p>
      <div class="kpis kpis-inline">
        <div class="kpi"><span>Chefs</span><strong>${r.nbChefs}</strong></div>
        <div class="kpi kpi-gold"><span>Amende proposée</span><strong>${formatDollars(r.amende)}</strong></div>
        <div class="kpi"><span>GAV proposée</span><strong>${formatDuree(r.gavMinutes)}</strong></div>
      </div>
      ${warnings.length ? html`<div class="alert alert-warn"><strong>Points à vérifier</strong>${warnings.map(w => html`<small>• ${w}</small>`)}</div>` : ''}
      <div class="form-actions"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn btn-primary" data-confirm>${icon('check')} Déposer</button></div>`);
    $('[data-confirm]', dialog).addEventListener('click', e => attempt(async () => {
      await api(`/reports/${id}/submit`, { method: 'POST' });
      dirty = false;
      dialog.close();
      toast('Rapport déposé pour jugement');
      navigate(`/rapports/${id}`);
    }, e.target));
  }

  main.addEventListener('input', e => {
    if (e.target.type !== 'search' && !e.target.closest('[data-calc]')) markDirty();
  });
  main.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      attempt(() => save());
    }
  });
  main.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-unlink]')) {
      delete model.suspect.id;
      markDirty();
      renderSuspectStatus();
    } else if (t.matches('[data-objet-add]')) {
      model.objets_illegaux.push({ description: '', quantite: '' });
      renderObjets();
      $$('[data-o="description"]', main).at(-1)?.focus();
      markDirty();
    } else if (t.matches('[data-objet-rm]')) {
      model.objets_illegaux.splice(Number(t.closest('[data-i]').dataset.i), 1);
      renderObjets();
      markDirty();
    } else if (t.matches('[data-save]')) {
      attempt(() => save(), t);
    } else if (t.matches('[data-preview]')) {
      attempt(async () => {
        if (dirty) await save({ quiet: true });
        navigate(`/rapports/${id}`);
      }, t);
    } else if (t.matches('[data-submit]')) {
      attempt(async () => {
        if (!model.suspect.nom) throw new Error('Renseignez au moins le nom du suspect');
        if (!calc.result().nbChefs) throw new Error("Ajoutez au moins un chef d'accusation");
        openSubmit(await save({ quiet: true }));
      }, t);
    } else if (t.matches('[data-delete]') && confirm('Supprimer définitivement ce brouillon ?')) {
      attempt(async () => {
        await api(`/reports/${id}`, { method: 'DELETE' });
        dirty = false;
        toast('Brouillon supprimé');
        navigate('/rapports');
      });
    }
  });

  renderObjets();
  await renderSuspectStatus();
  renderMiranda();
  ready = true;
}
