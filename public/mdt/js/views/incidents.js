import { html, mount, $, $$, attempt, toast, agentLabel, fmtDate, fmtDateTime, nowTime, debounce, PAGE, moreButton } from '../dom.js';
import { api, loadUsers, hasRole } from '../api.js';
import { navigate, setLeaveGuard, rerender } from '../router.js';
import { icon } from '../icons.js';
import { INCIDENT_TYPES, incidentTitre } from '../incident-kinds.js';
import { mountPhotos, numberedSlots } from '../components/photos.js';
import { mountAgentsInput } from '../components/agents-input.js';
import { openDiscordModal, joinLines, absoluteUrl, copyBtn } from '../components/discord.js';
import { copyForDocs } from '../components/gdocs.js';
import { statutBadge } from './reports.js';
import { section } from './report-edit.js';
import { agentPresent } from './report-view.js';
import { fieldInput } from './service.js';
import { openEvidenceForm, evidenceBadge } from './evidence.js';
import { templateSelect } from '../components/templates.js';

const PHOTOS = [{ titre: '', slots: numberedSlots(), extra: true }];
const redacteurOf = inc => ({ matricule: inc.redacteur_matricule, nom: inc.redacteur_nom, prenom: inc.redacteur_prenom, grade: inc.redacteur_grade });

// ---------- Liste ----------

export async function renderList(main, params, query) {
  mount(main, html`
    <div class="page-head">
      <div><h1>Rapports d'incident</h1><p class="muted">Usage de la force, poursuites, interventions à haut risque, accidents…</p></div>
      <div class="actions"><a class="btn btn-primary" href="#/incidents/nouveau">${icon('plus')} Nouveau rapport d'incident</a></div>
    </div>
    <div class="toolbar">
      <div class="search-box grow">${icon('search')}<input type="search" class="input" data-q placeholder="N°, lieu ou personne impliquée…"></div>
      <select class="input" data-type><option value="">Tous les types</option>${Object.entries(INCIDENT_TYPES).map(([k, t]) => html`<option value="${k}">${t.titre}</option>`)}</select>
      <select class="input" data-statut><option value="">Tous les statuts</option><option value="brouillon">Brouillons</option><option value="finalise">Finalisés</option></select>
      <label class="check"><input type="checkbox" data-mine ${query.get('mine') === '1' ? 'checked' : ''}> Mes rapports</label>
    </div>
    <div class="card table-wrap" data-results></div>`);

  let limit = PAGE;
  const load = async () => {
    const qs = new URLSearchParams({
      q: $('[data-q]', main).value, type: $('[data-type]', main).value, statut: $('[data-statut]', main).value,
      mine: $('[data-mine]', main).checked ? '1' : '', limit,
    });
    const list = await api(`/incidents?${qs}`);
    mount($('[data-results]', main), list.length ? html`<table class="table table-click">
      <thead><tr><th>N°</th><th>Type</th><th>Date des faits</th><th>Lieu</th><th>Rédacteur</th><th>Statut</th><th>Modifié</th></tr></thead>
      <tbody>${list.map(i => html`<tr data-href="#/incidents/${i.id}${i.statut === 'brouillon' ? '/modifier' : ''}">
        <td class="mono strong">${i.numero}</td><td>${incidentTitre(i.type)}</td><td>${fmtDate(i.date_faits)}</td><td>${i.lieu || '—'}</td>
        <td class="mono">『${i.redacteur_matricule}』</td><td>${statutBadge(i.statut)}</td><td class="muted nowrap">${fmtDateTime(i.updated_at)}</td></tr>`)}</tbody></table>
      ${moreButton(list.length, limit)}`
      : html`<p class="empty-state">Aucun rapport d'incident.</p>`);
  };
  const reload = debounce(() => { limit = PAGE; attempt(load); });
  $('[data-q]', main).addEventListener('input', reload);
  for (const sel of ['[data-type]', '[data-statut]', '[data-mine]']) $(sel, main).addEventListener('change', reload);
  main.addEventListener('click', e => {
    if (e.target.closest('[data-more]')) { limit += PAGE; attempt(load); }
    const tr = e.target.closest('tr[data-href]');
    if (tr) location.hash = tr.dataset.href;
  });
  await load();
}

// ---------- Création / modification ----------

// Crée un brouillon puis ouvre l'éditeur (remplace l'URL pour éviter un doublon au retour arrière)
export async function renderNew() {
  const { id } = await api('/incidents', { method: 'POST', body: {} });
  location.replace(`#/incidents/${id}/modifier`);
}

export async function renderEdit(main, [id]) {
  const [inc] = await Promise.all([api(`/incidents/${id}`), loadUsers()]);
  if (!inc.can_edit) {
    location.replace(`#/incidents/${id}`);
    return;
  }
  const model = { agents_presents: [...inc.agents_presents], photos: { ...inc.photos }, details: { ...inc.details } };
  let dirty = false;

  mount(main, html`
    <div class="page-head">
      <div>
        <a href="#/incidents" class="back">${icon('back')} Rapports d'incident</a>
        <h1>Rapport d'incident <span class="mono gold">${inc.numero}</span></h1>
        <p class="muted">${inc.statut === 'finalise' ? html`<span class="badge badge-ok">Finalisé</span> modification superviseur` : html`<span class="badge badge-warn">Brouillon</span>`} · Rédacteur ${agentLabel(redacteurOf(inc))}</p>
      </div>
    </div>

    <form class="report-form" data-form autocomplete="off" novalidate>
      ${section(1, 'En-tête', html`
        <div class="form-grid cols-4">
          <label>Type d'incident<select class="input" name="type">${Object.entries(INCIDENT_TYPES).map(([k, t]) => html`<option value="${k}" ${k === inc.type ? 'selected' : ''}>${t.titre}</option>`)}</select></label>
          <label>Date des faits<input class="input" type="date" name="date_faits" value="${inc.date_faits}"></label>
          <label>Heure<input class="input" type="time" name="heure" value="${inc.heure}"></label>
          <label>Lieu *<input class="input" name="lieu" value="${inc.lieu}" placeholder="Ex. : Autoroute 1, sortie Chumash"></label>
          <div class="span-4 field"><span>Agents présents (matricule)</span><div data-agents></div></div>
        </div>`)}
      ${section(2, 'Détails', html`<div class="form-grid" data-details></div>`)}
      ${section(3, 'Personnes impliquées', html`<textarea class="input" name="personnes" rows="3" placeholder="Suspects, victimes, témoins : nom, rôle, état…">${inc.personnes}</textarea>`)}
      ${section(4, 'Récit des faits *', html`${templateSelect('incident')}<textarea class="input faits" name="recit" rows="10" placeholder="Déroulé chronologique : appel, arrivée sur zone, actions, issue…">${inc.recit}</textarea>`)}
      ${section(5, 'Photos', html`
        <p class="muted small">Cliquez sur un emplacement puis collez une capture (Ctrl+V), glissez-déposez une image, importez un fichier ou indiquez un lien.</p>
        <div data-photos></div>`)}
    </form>

    <div class="action-bar">
      <span class="save-status" data-status>Enregistré</span>
      <div class="actions">
        ${inc.statut === 'brouillon' && html`<button type="button" class="btn btn-ghost" data-delete>${icon('trash')} Supprimer</button>`}
        <button type="button" class="btn" data-preview>${icon('printer')} Aperçu</button>
        <button type="button" class="btn" data-save>Enregistrer <kbd>Ctrl+S</kbd></button>
        ${inc.statut === 'brouillon' && html`<button type="button" class="btn btn-primary" data-finalize>${icon('check')} Finaliser</button>`}
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

  // Champs propres au type ; les valeurs saisies sont gardées si l'on change de type
  const readDetails = () => {
    for (const el of $$('[data-details] [name]', main)) model.details[el.name] = el.value.trim();
    return model.details;
  };
  const renderDetails = () => {
    const fields = INCIDENT_TYPES[field('type').value].fields;
    mount($('[data-details]', main), fields.length
      ? fields.map(f => fieldInput(f, model.details[f.key] ?? '', true))
      : html`<p class="muted small span-2">Pas de champ spécifique : décrivez l'incident dans le récit.</p>`);
  };
  field('type').addEventListener('change', () => { readDetails(); renderDetails(); markDirty(); });

  mountAgentsInput($('[data-agents]', main), model.agents_presents, markDirty);
  mountPhotos($('[data-photos]', main), model.photos, markDirty, PHOTOS);

  // Version chargée : le serveur refuse la sauvegarde si quelqu'un d'autre a enregistré depuis (409)
  let version = inc.updated_at;
  async function save({ quiet = false } = {}) {
    const details = readDetails();
    const fields = INCIDENT_TYPES[field('type').value].fields;
    const saved = await api(`/incidents/${id}`, {
      method: 'PUT',
      body: {
        updated_at: version,
        ...Object.fromEntries(['type', 'date_faits', 'heure', 'lieu', 'personnes', 'recit'].map(k => [k, field(k).value])),
        details: Object.fromEntries(fields.map(f => [f.key, details[f.key] ?? ''])),
        agents_presents: model.agents_presents,
        photos: model.photos,
      },
    });
    version = saved.updated_at;
    dirty = false;
    status.textContent = `Enregistré à ${nowTime()}`;
    status.classList.remove('is-dirty');
    if (!quiet) toast('Rapport enregistré');
    return saved;
  }

  main.addEventListener('input', e => {
    if (e.target.type !== 'search') markDirty();
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
    if (t.matches('[data-save]')) attempt(() => save(), t);
    else if (t.matches('[data-preview]')) {
      attempt(async () => {
        if (dirty) await save({ quiet: true });
        navigate(`/incidents/${id}`);
      }, t);
    } else if (t.matches('[data-finalize]')) {
      attempt(async () => {
        await save({ quiet: true });
        if (!confirm('Finaliser ce rapport ? Il ne pourra plus être modifié, sauf par un superviseur.')) return;
        await api(`/incidents/${id}/finalize`, { method: 'POST' });
        toast("Rapport d'incident finalisé");
        navigate(`/incidents/${id}`);
      }, t);
    } else if (t.matches('[data-delete]') && confirm('Supprimer définitivement ce brouillon ?')) {
      attempt(async () => {
        await api(`/incidents/${id}`, { method: 'DELETE' });
        dirty = false;
        toast('Brouillon supprimé');
        navigate('/incidents');
      });
    }
  });

  renderDetails();
}

// ---------- Aperçu (impression / Discord) ----------

const detailRows = inc => (INCIDENT_TYPES[inc.type]?.fields ?? []).filter(f => inc.details[f.key]).map(f => [f.label, inc.details[f.key]]);

function discordText(inc) {
  const photos = PHOTOS[0].slots.filter(([k]) => inc.photos[k]).map(([k, label]) => `${label} : ${absoluteUrl(inc.photos[k])}`);
  return joinLines([
    `## 🚨 Rapport d'incident — ${inc.numero}${inc.statut === 'brouillon' ? ' (brouillon)' : ''}`,
    `**Type :** ${incidentTitre(inc.type)}`,
    `**Date :** ${fmtDate(inc.date_faits)}${inc.heure ? ` à ${inc.heure}` : ''} · **Lieu :** ${inc.lieu || '—'}`,
    `**Rédacteur :** ${agentLabel(redacteurOf(inc))}`,
    `**Agents présents :** ${inc.agents_presents.map(agentPresent).join(', ') || '—'}`,
    '',
    ...(detailRows(inc).length ? ['### 📋 Détails', ...detailRows(inc).map(([l, v]) => `> **${l} :** ${v}`), ''] : []),
    ...(inc.personnes ? ['### 👥 Personnes impliquées', inc.personnes, ''] : []),
    '### 📝 Récit des faits',
    inc.recit || '—',
    ...(inc.evidence.length ? ['', '### 🔒 Scellés', ...inc.evidence.map(e => `- ${e.numero} : ${e.description}${e.quantite ? ` ×${e.quantite}` : ''}`)] : []),
    ...(photos.length ? ['', '### 📷 Photos', ...photos] : []),
  ]);
}

export async function renderView(main, [id]) {
  const [inc] = await Promise.all([api(`/incidents/${id}`), loadUsers()]);
  const photos = PHOTOS[0].slots.filter(([k]) => inc.photos[k]);

  mount(main, html`
    <div class="report-toolbar no-print">
      <a href="#/incidents" class="back">${icon('back')} Rapports d'incident</a>
      <div class="actions">
        ${statutBadge(inc.statut)}
        ${inc.can_edit && html`<a class="btn" href="#/incidents/${inc.id}/modifier">${icon('edit')} Modifier</a>`}
        ${inc.statut === 'finalise' && hasRole('superviseur') && html`<button class="btn" data-reopen>Rouvrir en brouillon</button>`}
        <button class="btn" data-evidence>${icon('box')} Mettre une preuve sous scellé</button>
        <button class="btn" data-discord>${icon('copy')} Copier pour Discord</button>
        <button class="btn" data-gdocs>${icon('copy')} Google Docs</button>
        <button class="btn btn-primary" data-print>${icon('printer')} Imprimer / PDF</button>
      </div>
    </div>
    ${inc.statut === 'brouillon' ? html`<div class="alert alert-warn no-print">Brouillon : ce rapport n'est pas encore finalisé.</div>` : ''}

    <article class="paper${inc.statut === 'brouillon' ? ' is-draft' : ''}" data-stamp="${inc.statut === 'finalise' ? 'Finalisé' : ''}">
      <img class="paper-banner" src="img/sasp-banner.png" alt="San Andreas State Police">
      <h1 class="paper-title">Rapport d'incident</h1>
      <p class="paper-sub">N° ${inc.numero}${copyBtn(inc.numero)} · ${incidentTitre(inc.type)}${inc.statut === 'brouillon' ? ' · BROUILLON' : ''}</p>

      <table class="paper-table">
        <colgroup><col class="c1"><col class="c2"><col></colgroup>
        <tr>
          <td colspan="2" class="seal-cell"><img src="img/sasp-seal.png" alt=""></td>
          <td><strong>Date des faits :</strong> ${fmtDate(inc.date_faits)}${inc.heure ? ` à ${inc.heure}` : ''}<br><strong>Lieu :</strong> ${inc.lieu || '—'}</td>
        </tr>
        <tr><th>Agent rédacteur :</th><td colspan="2">${agentLabel(redacteurOf(inc))}</td></tr>
        <tr><th>Agents présents :</th><td colspan="2">${inc.agents_presents.length ? inc.agents_presents.map(m => html`<span class="nowrap">${agentPresent(m)}</span><br>`) : '—'}</td></tr>
        ${detailRows(inc).map(([l, v]) => html`<tr><th>${l} :</th><td colspan="2" class="pre-wrap">${v}</td></tr>`)}
      </table>

      ${inc.personnes ? html`<h2 class="paper-h2">Personnes impliquées</h2><div class="paper-text">${inc.personnes}</div>` : ''}

      <h2 class="paper-h2">Récit des faits</h2>
      <div class="paper-text">${inc.recit || '—'}</div>

      ${inc.evidence.length ? html`<h2 class="paper-h2">Scellés</h2>
        <ul class="dash-list">${inc.evidence.map(e => html`<li><a href="#/preuves?q=${e.numero}" class="mono">${e.numero}</a> · ${e.description}${e.quantite ? ` ×${e.quantite}` : ''} ${evidenceBadge(e.statut)}</li>`)}</ul>` : ''}

      ${photos.length ? html`<h2 class="paper-h2">Photos</h2>
        <div class="paper-photos">${photos.map(([k, label]) => html`<figure><img src="${inc.photos[k]}" alt="${label}"><figcaption>${label}</figcaption></figure>`)}</div>` : ''}

      <footer class="paper-foot">
        <span>SAN ANDREAS STATE POLICE · LOS SANTOS</span>
        <span>${inc.numero} · ${inc.statut === 'finalise' ? `finalisé le ${fmtDateTime(inc.finalized_at)}` : 'brouillon'}</span>
      </footer>
    </article>`);

  $('[data-print]', main).addEventListener('click', () => window.print());
  $('[data-discord]', main).addEventListener('click', () => openDiscordModal(discordText(inc)));
  $('[data-gdocs]', main).addEventListener('click', () => copyForDocs($('.paper', main)));
  $('[data-evidence]', main).addEventListener('click', () => openEvidenceForm({ origine: inc.numero }, rerender));
  $('[data-reopen]', main)?.addEventListener('click', e => {
    if (!confirm('Rouvrir ce rapport en brouillon ?')) return;
    attempt(async () => {
      await api(`/incidents/${inc.id}/reopen`, { method: 'POST' });
      toast('Rapport rouvert');
      rerender();
    }, e.target);
  });
}
