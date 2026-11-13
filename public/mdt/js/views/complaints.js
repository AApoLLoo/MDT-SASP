import { html, mount, $, attempt, toast, fullName, agentLabel, fmtDate, fmtDateTime, todayIso, nowTime, normalize, categorieBadge, debounce, PAGE, moreButton, live } from '../dom.js';
import { api, state, loadPenalCode, loadAvocats, hasRole, canJudge, isJustice, isAvocat } from '../api.js';
import { navigate, setLeaveGuard, rerender } from '../router.js';
import { icon } from '../icons.js';
import { mountPerson } from '../components/person.js';
import { mountPhotos, numberedSlots } from '../components/photos.js';
import { picker } from '../components/picker.js';
import { openDiscordModal, joinLines, absoluteUrl, copyBtn } from '../components/discord.js';
import { copyForDocs } from '../components/gdocs.js';

export const COMPLAINT_STATUTS = { ouverte: 'Ouverte', en_cours: 'Enquête en cours', classee: 'Classée sans suite', resolue: 'Résolue' };
const STATUT_BADGE = { ouverte: 'badge-info', en_cours: 'badge-warn', classee: '', resolue: 'badge-ok' };
export const complaintBadge = s => html`<span class="badge ${STATUT_BADGE[s]}">${COMPLAINT_STATUTS[s]}</span>`;

const PREUVES = [{ titre: '', slots: numberedSlots('preuve', 'Preuve'), extra: true }];
const misEnCauseLabel = m => (m?.inconnu ? 'Non identifié' : fullName(m));
const upperName = p => [p.nom?.toUpperCase(), p.prenom].filter(Boolean).join(' ') || '—';
const agentOf = c => ({ matricule: c.agent_matricule, nom: c.agent_nom, prenom: c.agent_prenom, grade: c.agent_grade });

// Remplace le contenu d'un objet partagé avec un composant (sans changer sa référence)
const replaceIn = (target, src) => {
  for (const k of Object.keys(target)) delete target[k];
  return Object.assign(target, src);
};

// ---------- Liste ----------

export async function renderList(main, params, query) {
  const statut = query.get('statut') ?? 'actives';
  mount(main, html`
    <div class="page-head">
      <div><h1>Plaintes</h1><p class="muted" data-count></p></div>
      ${isJustice() ? '' : html`<div class="actions"><a class="btn btn-primary" href="#/plaintes/nouvelle">${icon('plus')} Nouvelle plainte</a></div>`}
    </div>
    <div class="toolbar">
      <div class="search-box grow">${icon('search')}<input type="search" class="input" data-q placeholder="N°, plaignant, mis en cause ou lieu…" autofocus></div>
      <div class="segmented">
        ${[['actives', 'En cours'], ['classee', 'Classées'], ['resolue', 'Résolues'], ['toutes', 'Toutes']].map(([k, l]) => html`<a href="#/plaintes?statut=${k}" class="${k === statut ? 'is-active' : ''}">${l}</a>`)}
      </div>
    </div>
    <div class="card table-wrap" data-results></div>`);

  let limit = PAGE;
  const load = async () => {
    const qs = new URLSearchParams({ q: $('[data-q]', main).value, statut: statut === 'toutes' ? '' : statut, limit });
    const list = await api(`/complaints?${qs}`);
    $('[data-count]', main).textContent = `${list.length}${list.length >= limit ? '+' : ''} plainte(s)`;
    mount($('[data-results]', main), list.length ? html`<table class="table table-click">
      <thead><tr><th>N°</th><th>Dépôt</th><th>Plaignant</th><th>Mis en cause</th><th>Faits</th><th>Statut</th><th>Agent</th></tr></thead>
      <tbody>${list.map(p => html`<tr data-href="#/plaintes/${p.id}">
        <td class="mono strong">${p.numero}</td>
        <td class="nowrap">${fmtDate(p.date_depot)}</td>
        <td>${p.plaignant_nom || '—'}</td>
        <td>${p.mis_en_cause_inconnu ? html`<span class="muted">Non identifié</span>` : p.mis_en_cause_nom || html`<span class="muted">—</span>`}</td>
        <td>${p.qualifications.join(' · ') || '—'}${p.lieu_faits ? html`<small class="muted block">${p.lieu_faits}${p.date_faits ? ` · ${fmtDate(p.date_faits)}` : ''}</small>` : ''}</td>
        <td>${complaintBadge(p.statut)}${p.report_id ? html` <span class="badge" title="Rapport d'arrestation lié">${icon('report')}</span>` : ''}</td>
        <td class="mono">『${p.agent_matricule}』</td></tr>`)}</tbody></table>${moreButton(list.length, limit)}`
      : html`<p class="empty-state">Aucune plainte${statut === 'actives' ? ' en cours' : ''}.</p>`);
  };
  $('[data-q]', main).addEventListener('input', debounce(() => { limit = PAGE; attempt(load); }));
  main.addEventListener('click', e => {
    if (e.target.closest('[data-more]')) { limit += PAGE; attempt(load); }
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
  // Temps réel : seul le tableau est redessiné (recherche, statut, « Afficher plus » et tri conservés)
  live(main, ['complaints', 'justice'], load);
  await load();
}

// ---------- Création / modification ----------

const section = (n, title, body, extra = '') => html`
  <section class="card report-section">
    <div class="card-head"><h2 class="section-title"><span>${n}</span>${title}</h2>${extra}</div>
    ${body}
  </section>`;

async function personFromCitizen(id) {
  if (!id) return {};
  const c = await api(`/citizens/${id}`).catch(() => null);
  return c ? { id: c.id, nom: c.nom, prenom: c.prenom, date_naissance: c.date_naissance, id_unique: c.id_unique ?? '', telephone: c.telephone } : {};
}

export async function renderEdit(main, [id], query) {
  const [avocats] = await Promise.all([loadAvocats(), loadPenalCode()]);
  const c = id
    ? await api(`/complaints/${id}`)
    : {
      statut: 'ouverte', date_depot: todayIso(), date_faits: '', lieu_faits: '', recit: '', prejudice: '', temoins: '', suivi: '',
      qualifications: [], photos: {}, avocat_ids: [],
      plaignant: await personFromCitizen(Number(query.get('plaignant'))),
      mis_en_cause: await personFromCitizen(Number(query.get('mis_en_cause'))),
      agent_matricule: state.user.matricule, agent_nom: state.user.nom, agent_prenom: state.user.prenom, agent_grade: state.user.grade,
    };
  const model = { plaignant: { ...c.plaignant }, mis_en_cause: { ...c.mis_en_cause }, qualifications: [...c.qualifications], photos: { ...c.photos } };
  let dirty = false;

  mount(main, html`
    <div class="page-head">
      <div>
        <a href="#/plaintes" class="back">${icon('back')} Plaintes</a>
        <h1>${id ? html`Plainte <span class="mono gold">${c.numero}</span>` : 'Nouvelle plainte'}</h1>
        <p class="muted">${id ? html`${complaintBadge(c.statut)} · enregistrée par ${agentLabel(agentOf(c))} le ${fmtDateTime(c.created_at)}` : 'Le numéro est attribué au premier enregistrement.'}</p>
      </div>
    </div>

    <form class="report-form" data-form autocomplete="off" novalidate>
      ${section(1, 'Dépôt de plainte', html`
        <div class="form-grid cols-4">
          <label>Date de dépôt<input class="input" type="date" name="date_depot" value="${c.date_depot}"></label>
          <label>Statut<select class="input" name="statut">${Object.entries(COMPLAINT_STATUTS).map(([k, l]) => html`<option value="${k}" ${k === c.statut ? 'selected' : ''}>${l}</option>`)}</select></label>
          <label class="span-2">Agent enregistrant<input class="input" readonly value="${agentLabel(agentOf(c))}"></label>
          <label class="span-4">Avocat(s) inscrit(s) · accès au dossier (Ctrl+clic pour en choisir plusieurs)
            <select class="input" name="avocat_ids" multiple size="${Math.min(Math.max(avocats.length, 2), 5)}">
              ${avocats.map(a => html`<option value="${a.id}" ${c.avocat_ids.includes(a.id) ? 'selected' : ''}>${fullName(a)} (${a.matricule})</option>`)}
            </select></label>
        </div>`)}

      ${section(2, 'Plaignant', html`<div data-plaignant></div>`)}
      ${section(3, 'Mis en cause', html`<div data-mec></div>`)}

      ${section(4, 'Faits', html`
        <div class="form-grid cols-4">
          <label>Date des faits<input class="input" type="date" name="date_faits" value="${c.date_faits}"></label>
          <label class="span-3">Lieu des faits<input class="input" name="lieu_faits" value="${c.lieu_faits}" placeholder="Ex. : Supérette de Grove Street"></label>
          <div class="span-4 field"><span>Qualification des faits (Code pénal)</span>
            <div class="chips-input"><span data-qualifs></span></div>
            <div data-qualif-picker></div>
          </div>
          <label class="span-4">Déclaration du plaignant<textarea class="input faits" name="recit" rows="8" placeholder="Récit des faits tel que rapporté par le plaignant…">${c.recit}</textarea></label>
          <label class="span-2">Préjudice subi<textarea class="input" name="prejudice" rows="3" placeholder="Blessures, biens volés ou endommagés, montant estimé…">${c.prejudice}</textarea></label>
          <label class="span-2">Témoins<textarea class="input" name="temoins" rows="3" placeholder="Nom et contact des témoins éventuels">${c.temoins}</textarea></label>
        </div>`)}

      ${section(5, 'Preuves', html`
        <p class="muted small">Captures, photos de blessures ou de dégâts : Ctrl+V sur un emplacement, glisser-déposer, import ou lien.</p>
        <div data-photos></div>`)}

      ${section(6, "Suivi de l'enquête", html`
        <label class="field">Notes d'enquête<textarea class="input" name="suivi" rows="4" placeholder="Démarches effectuées, auditions, pistes…">${c.suivi}</textarea></label>
        <div class="linked-report">
          ${c.report_id
            ? html`<p>${icon('report')} Rapport d'arrestation lié : <a href="#/rapports/${c.report_id}" class="mono">${c.report_numero}</a> (${c.report_statut === 'finalise' ? 'finalisé' : 'brouillon'})</p>`
            : html`<p class="muted small">Une fois le mis en cause identifié, ouvrez directement son rapport d'arrestation avec les infractions de la plainte.</p>
              <button type="button" class="btn" data-create-report>${icon('report')} Créer le rapport d'arrestation</button>`}
        </div>`)}
    </form>

    <div class="action-bar">
      <span class="save-status" data-status>${id ? 'Enregistré' : 'Non enregistrée'}</span>
      <div class="actions">
        ${id && hasRole('superviseur') ? html`<button type="button" class="btn btn-ghost" data-delete>${icon('trash')} Supprimer</button>` : ''}
        ${id ? html`<button type="button" class="btn" data-preview>${icon('printer')} Aperçu</button>` : ''}
        <button type="button" class="btn btn-primary" data-save>Enregistrer <kbd>Ctrl+S</kbd></button>
      </div>
    </div>`);

  const form = $('[data-form]', main);
  const field = name => form.elements.namedItem(name);
  const status = $('[data-status]', main);
  const markDirty = () => {
    dirty = true;
    status.textContent = 'Modifications non enregistrées';
    status.classList.add('is-dirty');
  };
  setLeaveGuard(silent => !dirty || (!silent && confirm('Des modifications ne sont pas enregistrées. Quitter sans enregistrer ?')));

  const plaignant = mountPerson($('[data-plaignant]', main), model.plaignant, { onChange: markDirty, placeholder: 'Rechercher le plaignant (nom, ID unique, téléphone)…' });
  const mec = mountPerson($('[data-mec]', main), model.mis_en_cause, { onChange: markDirty, allowUnknown: true, placeholder: 'Rechercher le mis en cause (nom, ID unique, téléphone)…' });
  mountPhotos($('[data-photos]', main), model.photos, markDirty, PREUVES);

  // Qualification : infractions du Code pénal
  const renderQualifs = () => mount($('[data-qualifs]', main), model.qualifications.length
    ? model.qualifications.map(q => html`<span class="chip chip-static">${categorieBadge(q.categorie)} ${q.infraction}<button type="button" class="btn-icon" data-qualif-rm="${q.code_id}">✕</button></span>`)
    : html`<span class="muted small">Aucune infraction retenue pour l'instant.</span>`);
  picker($('[data-qualif-picker]', main), {
    placeholder: 'Ajouter une infraction…',
    search: async q => {
      const words = normalize(q).split(/\s+/).filter(Boolean);
      return state.penalCode.filter(code => code.actif && words.every(w => normalize(code.infraction).includes(w))).slice(0, 30);
    },
    renderItem: code => html`${categorieBadge(code.categorie)}<span class="grow">${code.infraction}</span>`,
    onSelect: code => {
      if (model.qualifications.some(q => q.code_id === code.id)) return;
      model.qualifications.push({ code_id: code.id, infraction: code.infraction, categorie: code.categorie });
      renderQualifs();
      markDirty();
    },
  });

  async function save({ quiet = false } = {}) {
    const body = {
      ...Object.fromEntries(['statut', 'date_depot', 'date_faits', 'lieu_faits', 'recit', 'prejudice', 'temoins', 'suivi'].map(k => [k, field(k).value])),
      plaignant: model.plaignant,
      mis_en_cause: model.mis_en_cause,
      qualifications: model.qualifications,
      photos: model.photos,
      avocat_ids: [...field('avocat_ids').selectedOptions].map(o => Number(o.value)),
    };
    const saved = await api(id ? `/complaints/${id}` : '/complaints', { method: id ? 'PUT' : 'POST', body });
    dirty = false;
    if (!quiet) toast(id ? 'Plainte enregistrée' : `Plainte ${saved.numero} enregistrée`);
    if (!id) {
      // Première sauvegarde : on bascule sur l'URL de la plainte (le numéro s'affiche)
      location.replace(`#/plaintes/${saved.id}/modifier`);
      return saved;
    }
    replaceIn(model.plaignant, saved.plaignant);
    replaceIn(model.mis_en_cause, saved.mis_en_cause);
    plaignant.refresh();
    mec.refresh();
    status.textContent = `Enregistré à ${nowTime()}`;
    status.classList.remove('is-dirty');
    return saved;
  }

  main.addEventListener('input', e => {
    if (e.target.name && e.target.type !== 'search') markDirty();
  });
  main.addEventListener('change', e => {
    if (e.target.name === 'statut') markDirty();
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
    if (t.dataset.qualifRm) {
      model.qualifications = model.qualifications.filter(q => q.code_id !== Number(t.dataset.qualifRm));
      renderQualifs();
      markDirty();
    } else if (t.matches('[data-save]')) {
      attempt(() => save(), t);
    } else if (t.matches('[data-preview]')) {
      attempt(async () => {
        if (dirty) await save({ quiet: true });
        navigate(`/plaintes/${id}`);
      }, t);
    } else if (t.matches('[data-create-report]')) {
      attempt(async () => {
        if (model.mis_en_cause.inconnu || !model.mis_en_cause.nom) throw new Error("Identifiez d'abord le mis en cause (au moins son nom)");
        const saved = await save({ quiet: true });
        const { report_id } = await api(`/complaints/${saved.id}/report`, { method: 'POST' });
        toast("Rapport d'arrestation créé à partir de la plainte");
        navigate(`/rapports/${report_id}/modifier`);
      }, t);
    } else if (t.matches('[data-delete]') && confirm(`Supprimer définitivement la plainte ${c.numero} ?`)) {
      attempt(async () => {
        await api(`/complaints/${id}`, { method: 'DELETE' });
        dirty = false;
        toast('Plainte supprimée');
        navigate('/plaintes');
      });
    }
  });

  renderQualifs();
}

// ---------- Procès-verbal (vue / impression / Discord) ----------

const personRows = p => html`
  <p><strong>NOM Prénom :</strong> ${upperName(p)}</p>
  <p><strong>Date de naissance :</strong> ${fmtDate(p.date_naissance)}</p>
  <p><strong>N° sécu (ID unique) :</strong> ${p.id_unique || '—'}</p>
  <p><strong>Téléphone :</strong> ${p.telephone || '—'}</p>`;

function discordText(c) {
  const m = c.mis_en_cause;
  const preuves = PREUVES[0].slots.filter(([k]) => c.photos[k]).map(([k, label]) => `${label} : ${absoluteUrl(c.photos[k])}`);
  return joinLines([
    `## 📢 Dépôt de plainte — ${c.numero}`,
    `**Déposée le :** ${fmtDate(c.date_depot)} · **Statut :** ${COMPLAINT_STATUTS[c.statut]}`,
    `**Agent :** ${agentLabel(agentOf(c))}`,
    '',
    '### 🙋 Plaignant',
    `> **NOM Prénom :** ${upperName(c.plaignant)}`,
    `> **Date de naissance :** ${fmtDate(c.plaignant.date_naissance)} · **N° sécu :** ${c.plaignant.id_unique || '—'} · **Tél. :** ${c.plaignant.telephone || '—'}`,
    '',
    '### 🎯 Mis en cause',
    m.inconnu ? '> Non identifié' : `> **NOM Prénom :** ${upperName(m)} · **N° sécu :** ${m.id_unique || '—'}`,
    m.description ? `> **Signalement :** ${m.description}` : '',
    '',
    '### ⚖️ Faits',
    `**Date :** ${fmtDate(c.date_faits)} · **Lieu :** ${c.lieu_faits || '—'}`,
    `**Qualification :** ${c.qualifications.map(q => q.infraction).join(' · ') || '—'}`,
    '',
    '**Déclaration du plaignant :**',
    c.recit || '—',
    c.prejudice ? `\n**Préjudice :** ${c.prejudice}` : '',
    c.temoins ? `**Témoins :** ${c.temoins}` : '',
    ...(preuves.length ? ['', '### 📷 Preuves', ...preuves] : []),
    ...(c.suivi || c.report_numero ? ['', "### 🔎 Suivi de l'enquête", c.suivi, c.report_numero ? `Rapport d'arrestation lié : ${c.report_numero}` : ''] : []),
  ]);
}

export async function renderView(main, [id]) {
  const c = await api(`/complaints/${id}`);
  const m = c.mis_en_cause;
  const preuves = PREUVES[0].slots.filter(([k]) => c.photos[k]);
  const justice = isJustice();
  const canCreateReport = !justice && !c.report_id && c.mis_en_cause_id;
  const canClose = canJudge() && !['classee', 'resolue'].includes(c.statut);

  mount(main, html`
    <div class="report-toolbar no-print">
      <a href="#/${isAvocat() ? '' : 'plaintes'}" class="back">${icon('back')} ${isAvocat() ? 'Mes dossiers' : 'Plaintes'}</a>
      <div class="actions">
        ${complaintBadge(c.statut)}
        ${justice ? '' : html`<a class="btn" href="#/plaintes/${c.id}/modifier">${icon('edit')} Modifier</a>`}
        ${canClose ? html`<button class="btn" data-close-as="classee">Classer sans suite</button>
          <button class="btn" data-close-as="resolue">Résoudre</button>` : ''}
        ${canCreateReport ? html`<button class="btn" data-create-report>${icon('report')} Créer le rapport d'arrestation</button>` : ''}
        <button class="btn" data-discord>${icon('copy')} Copier pour Discord</button>
        <button class="btn" data-gdocs>${icon('copy')} Google Docs</button>
        <button class="btn btn-primary" data-print>${icon('printer')} Imprimer / PDF</button>
      </div>
    </div>

    <article class="paper" data-stamp="${{ classee: 'Classée', resolue: 'Résolue' }[c.statut] ?? ''}">
      <img class="paper-banner" src="img/sasp-banner.png" alt="San Andreas State Police">
      <h1 class="paper-title">Dépôt de plainte</h1>
      <p class="paper-sub">Procès-verbal N° ${c.numero}${copyBtn(c.numero)}</p>

      <table class="paper-table">
        <colgroup><col class="c1"><col class="c2"><col></colgroup>
        <tr>
          <td colspan="2" class="seal-cell"><img src="img/sasp-seal.png" alt=""></td>
          <td><strong>Déposée le :</strong> ${fmtDate(c.date_depot)}<br><strong>Statut :</strong> ${COMPLAINT_STATUTS[c.statut]}${c.closed_at ? ` (le ${fmtDateTime(c.closed_at)})` : ''}</td>
        </tr>
        <tr><th>Agent enregistrant :</th><td colspan="2">${agentLabel(agentOf(c))}</td></tr>
        ${c.avocats.length ? html`<tr><th>Avocat(s) :</th><td colspan="2">${c.avocats.map(fullName).join(', ')}</td></tr>` : ''}
        <tr><th>Date et lieu des faits :</th><td colspan="2">${[c.date_faits && fmtDate(c.date_faits), c.lieu_faits].filter(Boolean).join(' · ') || '—'}</td></tr>
        <tr><th>Qualification des faits :</th><td colspan="2"><ul class="dash-list">${c.qualifications.length ? c.qualifications.map(q => html`<li>${q.infraction} (${q.categorie})</li>`) : html`<li>Non qualifiés</li>`}</ul></td></tr>
      </table>

      <table class="paper-table paper-persons">
        <tr><th>Plaignant</th><th>Mis en cause</th></tr>
        <tr>
          <td>${personRows(c.plaignant)}</td>
          <td>${m.inconnu ? html`<p><strong>Non identifié</strong></p>` : personRows(m)}
            ${m.description ? html`<p><strong>Signalement :</strong> ${m.description}</p>` : ''}</td>
        </tr>
      </table>

      <h2 class="paper-h2">Déclaration du plaignant</h2>
      <div class="paper-text">${c.recit || '—'}</div>

      ${c.prejudice ? html`<h2 class="paper-h2">Préjudice subi</h2><div class="paper-text">${c.prejudice}</div>` : ''}
      ${c.temoins ? html`<h2 class="paper-h2">Témoins</h2><div class="paper-text">${c.temoins}</div>` : ''}

      ${preuves.length ? html`<h2 class="paper-h2">Preuves</h2>
        <div class="paper-photos">${preuves.map(([k, label]) => html`<figure><img src="${c.photos[k]}" alt="${label}"><figcaption>${label}</figcaption></figure>`)}</div>` : ''}

      ${c.suivi || c.report_id ? html`<h2 class="paper-h2">Suivi de l'enquête</h2>
        ${c.suivi ? html`<div class="paper-text">${c.suivi}</div>` : ''}
        ${c.report_id ? html`<p><strong>Rapport d'arrestation lié :</strong> <a href="#/rapports/${c.report_id}">${c.report_numero}</a></p>` : ''}` : ''}

      <p class="paper-mention">Le plaignant déclare que les faits relatés ci-dessus sont exacts et sincères.</p>
      <div class="paper-signatures">
        <div><span>Signature du plaignant</span></div>
        <div><span>Signature de l'agent ${c.agent_matricule ? `『${c.agent_matricule}』` : ''}</span></div>
      </div>

      <footer class="paper-foot">
        <span>SAN ANDREAS STATE POLICE · LOS SANTOS</span>
        <span>${c.numero} · mis à jour le ${fmtDateTime(c.updated_at)}</span>
      </footer>
    </article>`);

  $('[data-print]', main).addEventListener('click', () => window.print());
  $('[data-discord]', main).addEventListener('click', () => openDiscordModal(discordText(c)));
  $('[data-gdocs]', main).addEventListener('click', () => copyForDocs($('.paper', main)));
  main.addEventListener('click', e => {
    const t = e.target.closest('[data-close-as]');
    if (!t || !confirm(`${t.textContent.trim()} : la plainte sera close. Confirmer ?`)) return;
    attempt(async () => {
      await api(`/complaints/${c.id}/close`, { method: 'POST', body: { statut: t.dataset.closeAs } });
      toast('Plainte close');
      rerender();
    }, t);
  });
  $('[data-create-report]', main)?.addEventListener('click', e => attempt(async () => {
    const { report_id } = await api(`/complaints/${c.id}/report`, { method: 'POST' });
    toast("Rapport d'arrestation créé à partir de la plainte");
    navigate(`/rapports/${report_id}/modifier`);
  }, e.target));
}

