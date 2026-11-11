import { html, mount, $$, normalize, categorieBadge, nowTime, toast } from '../dom.js';
import { state } from '../api.js';
import { icon } from '../icons.js';
import { compute, MAX_CHARGES, MAJORATION_DEFCON, SEUILS_ALERTE, formatDollars, formatDuree } from '../calc.js';

const CATEGORIES = ['Contravention', 'Délit mineur', 'Délit majeur', 'Crime'];
const fmtCoef = n => `×${String(n).replace('.', ',')}`;

export function emptyCalcInput() {
  return {
    charges: [], retenue: 'nominal', approbateur: '', viceProcedure: false, mineur: false,
    majoration: 1, conversionGav: false, cautionDemandee: false,
    droits: { avocat: false, avocatNom: '', nourriture: false, soins: false, appel: false, appelNom: '', procureurNom: '' },
  };
}

const gauge = (label, n, max) => html`
  <div class="gauge ${n >= max ? 'is-over' : ''}">
    <div class="gauge-head"><span>${label}</span><strong>${n} / ${max}</strong></div>
    <div class="gauge-bar"><i style="width:${Math.min(100, (n / max) * 100)}%"></i></div>
  </div>`;

// Calculatrice de peine : choix des chefs, options, résultat en direct.
// onChange(input, result) est appelé à chaque modification.
export function mountCalculator(root, { value, onChange = () => {} } = {}) {
  const base = emptyCalcInput();
  const input = { ...base, ...structuredClone(value ?? {}) };
  input.droits = { ...base.droits, ...(value?.droits ?? {}) };
  const byId = new Map(state.penalCode.map(c => [c.id, c]));
  const getCode = id => byId.get(id);
  input.charges = (input.charges ?? []).filter(c => byId.has(c.code_id));
  const majorations = [1, 1.5, 2, 3].filter(m => m <= (MAJORATION_DEFCON[state.defcon] ?? 1));
  if (!majorations.includes(input.majoration)) input.majoration = 1;
  let filtreCat = '';
  let results = [];

  mount(root, html`
    <div class="calc">
      <div class="calc-main">
        <div class="charge-search">
          <div class="search-box">${icon('search')}<input type="search" class="input" data-ref="search" placeholder="Ajouter un chef : rechercher une infraction…" autocomplete="off"></div>
          <div class="chips">
            <button type="button" class="chip is-active" data-cat="">Toutes</button>
            ${CATEGORIES.map(c => html`<button type="button" class="chip" data-cat="${c}">${c}</button>`)}
          </div>
          <ul class="dropdown search-results" data-ref="results" hidden></ul>
        </div>
        <div class="table-wrap">
          <table class="table charges-table">
            <thead><tr>
              <th>Catégorie</th><th>Chef d'inculpation</th><th>Qté</th>
              <th title="Tentative">Tent.</th><th title="Complicité">Compl.</th><th title="Atténuation">Atté.</th>
              <th class="num">Amende</th><th class="num">Peine</th><th></th>
            </tr></thead>
            <tbody data-ref="rows"></tbody>
          </table>
        </div>
        <p class="empty-state" data-ref="empty">Aucun chef d'inculpation. Recherchez une infraction ci-dessus pour l'ajouter.</p>

        <div class="calc-options">
          <fieldset class="opt-group">
            <legend>Retenue</legend>
            <label class="radio-card"><input type="radio" name="retenue" value="nominal" data-opt="retenue">
              <span><strong>Nominale</strong><small>Peu coopératif ou situation de base</small></span></label>
            <label class="radio-card"><input type="radio" name="retenue" value="max" data-opt="retenue">
              <span><strong>MAX ×2</strong><small>Absolument pas coopératif : ralentit la procédure, menaces, insultes, tentative d'agression</small></span></label>
            <div data-ref="approbateurWrap" hidden>
              <p class="alert alert-warn">⛔ Sous l'approbation de l'état-major ou du juge/procureur</p>
              <label class="field">Approuvé par<input class="input" data-opt="approbateur" placeholder="Nom ou matricule de l'approbateur"></label>
            </div>
          </fieldset>
          <fieldset class="opt-group">
            <legend>Modificateurs</legend>
            <label class="check"><input type="checkbox" data-opt="viceProcedure"> Vice de procédure <small>annule amende et peine</small></label>
            <label class="check"><input type="checkbox" data-opt="mineur"> Prévenu mineur <small>÷ 2</small></label>
            <label class="field">Majoration Defcon ${state.defcon} (amendes)
              <select class="input" data-opt="majoration" ${majorations.length < 2 ? 'disabled' : ''}>
                ${majorations.map(m => html`<option value="${m}">${fmtCoef(m)}</option>`)}
              </select></label>
          </fieldset>
          <fieldset class="opt-group">
            <legend>Caution & conversion</legend>
            <label class="check"><input type="checkbox" data-opt="cautionDemandee"> Demande de libération sous caution</label>
            <label class="check" data-ref="conversionWrap"><input type="checkbox" data-opt="conversionGav"> Convertir l'amende au-delà de 50 000 $ en GAV <small>100 000 $ = 1 h</small></label>
          </fieldset>
          <fieldset class="opt-group">
            <legend>Droits exercés par le prévenu</legend>
            <label class="check"><input type="checkbox" data-droit="avocat"> Avocat</label>
            <input class="input" data-droit="avocatNom" data-show="avocat" placeholder="Nom de l'avocat">
            <label class="check"><input type="checkbox" data-droit="nourriture"> Nourriture</label>
            <label class="check"><input type="checkbox" data-droit="soins"> Soins</label>
            <label class="check"><input type="checkbox" data-droit="appel"> Appel téléphonique</label>
            <input class="input" data-droit="appelNom" data-show="appel" placeholder="Nom de la personne appelée">
            <input class="input" data-droit="procureurNom" data-show="procureur" placeholder="Nom du procureur">
          </fieldset>
        </div>
      </div>
      <aside class="calc-summary" data-ref="summary"></aside>
    </div>`);

  const refs = Object.fromEntries($$('[data-ref]', root).map(el => [el.dataset.ref, el]));

  // Valeurs initiales des options
  for (const el of $$('[data-opt]', root)) {
    const v = input[el.dataset.opt];
    if (el.type === 'radio') el.checked = el.value === v;
    else if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }
  for (const el of $$('[data-droit]', root)) {
    const v = input.droits[el.dataset.droit];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }

  function renderRows() {
    mount(refs.rows, input.charges.map((ch, i) => {
      const c = getCode(ch.code_id);
      return html`<tr data-i="${i}">
        <td>${categorieBadge(c.categorie)}</td>
        <td class="charge-name">${c.infraction}${c.supplements ? html`<small class="muted block">${c.supplements}</small>` : ''}</td>
        <td><input type="number" class="input input-qty" min="0" max="100000000" step="1" value="${ch.quantite}" data-f="quantite" aria-label="Quantité"></td>
        <td class="center"><input type="checkbox" data-f="tentative" ${ch.tentative ? 'checked' : ''} aria-label="Tentative"></td>
        <td class="center"><input type="checkbox" data-f="complicite" ${ch.complicite ? 'checked' : ''} aria-label="Complicité"></td>
        <td class="center"><input type="checkbox" data-f="attenuation" ${ch.attenuation ? 'checked' : ''} aria-label="Atténuation"></td>
        <td class="num" data-out="amende"></td>
        <td class="num" data-out="peine"></td>
        <td><button type="button" class="btn-icon" data-remove title="Retirer ce chef">✕</button></td>
      </tr>`;
    }));
  }

  function renderSummary(r) {
    const entree = new Date();
    const sortie = new Date(entree.getTime() + r.gavMinutes * 60000);
    const modifs = [
      input.retenue === 'max' && 'MAX ×2',
      input.mineur && 'mineur ÷2',
      input.majoration > 1 && `Defcon ${fmtCoef(input.majoration)}`,
      input.viceProcedure && 'vice de procédure',
    ].filter(Boolean);
    const depasses = [
      r.alertes.mineur && `${r.compteurs.mineur} délits mineurs`,
      r.alertes.majeur && `${r.compteurs.majeur} délits majeurs`,
      r.alertes.crime && `${r.compteurs.crime} crime${r.compteurs.crime > 1 ? 's' : ''}`,
    ].filter(Boolean);
    const caution = !r.caution.possible ? 'Impossible' : input.cautionDemandee ? formatDollars(r.caution.montant) : 'Non demandée';
    mount(refs.summary, html`
      <h3>Résultat</h3>
      ${r.alerteProc && html`<div class="alert alert-danger"><strong>Appelez un Procureur / Juge</strong><small>${depasses.join(' · ')}</small></div>`}
      <div class="kpis">
        <div class="kpi"><span>Chefs</span><strong>${r.nbChefs}<small> / ${MAX_CHARGES}</small></strong></div>
        <div class="kpi kpi-gold"><span>Amende</span><strong>${formatDollars(r.amende)}</strong>
          ${modifs.length ? html`<small>Base ${formatDollars(r.amendeBase)} · ${modifs.join(' · ')}</small>` : ''}</div>
        <div class="kpi"><span>Garde à vue</span><strong>${formatDuree(r.gavMinutes)}</strong>
          ${r.gavMinutes ? html`<small>Entrée ${nowTime(entree)} → sortie ${nowTime(sortie)}</small>` : ''}</div>
        <div class="kpi"><span>Caution</span><strong>${caution}</strong>
          <small>${!r.caution.possible ? r.caution.raison : r.nbChefs ? `Coefficient ${fmtCoef(r.caution.coefficient)}` : ''}</small></div>
      </div>
      ${r.conversion.appliquee
        ? html`<p class="note">Conversion : ${formatDollars(r.conversion.excedent)} → +${formatDuree(r.conversion.minutesEnPlus)} de GAV</p>`
        : r.conversion.eligible ? html`<p class="note note-gold">Amende supérieure à 50 000 $ : proposez la conversion en GAV.</p>` : ''}
      <div class="gauges">
        ${gauge('Délits mineurs', r.compteurs.mineur, SEUILS_ALERTE.mineur)}
        ${gauge('Délits majeurs', r.compteurs.majeur, SEUILS_ALERTE.majeur)}
        ${gauge('Crimes', r.compteurs.crime, SEUILS_ALERTE.crime)}
      </div>
      ${r.sanctions.length ? html`<h4>Sanctions / conséquences</h4><ul class="sanctions">${[...new Set(r.sanctions)].map(s => html`<li>${s}</li>`)}</ul>` : ''}`);
  }

  function refresh() {
    const r = compute(input, getCode);
    r.lignes.forEach((l, i) => {
      const tr = refs.rows.children[i];
      tr.querySelector('[data-out="amende"]').textContent = formatDollars(l.amende);
      tr.querySelector('[data-out="peine"]').textContent = formatDuree(l.peine);
    });
    refs.empty.hidden = input.charges.length > 0;
    refs.approbateurWrap.hidden = input.retenue !== 'max';
    const conv = refs.conversionWrap.querySelector('input');
    conv.disabled = !r.conversion.eligible;
    refs.conversionWrap.classList.toggle('is-disabled', conv.disabled);
    for (const el of $$('[data-show]', root)) {
      const k = el.dataset.show;
      el.hidden = !(k === 'procureur' ? input.droits.avocat && input.droits.appel : input.droits[k]);
    }
    renderSummary(r);
    onChange(input, r);
  }

  function showResults() {
    const words = normalize(refs.search.value).split(/\s+/).filter(Boolean);
    results = state.penalCode
      .filter(c => c.actif && (!filtreCat || c.categorie === filtreCat))
      .filter(c => {
        const hay = normalize(`${c.infraction} ${c.classification}`);
        return words.every(w => hay.includes(w));
      })
      .slice(0, 50);
    mount(refs.results, results.length
      ? results.map((c, i) => html`<li data-i="${i}">${categorieBadge(c.categorie)}<span class="grow">${c.infraction}</span><span class="muted nowrap">${formatDollars(c.amende)} · ${formatDuree(c.peine_minutes)}</span></li>`)
      : html`<li class="muted">Aucune infraction trouvée</li>`);
    refs.results.hidden = false;
  }

  function addCharge(code) {
    if (input.charges.length >= MAX_CHARGES) return toast(`Maximum ${MAX_CHARGES} chefs d'inculpation`, 'error');
    input.charges.push({ code_id: code.id, quantite: 1, tentative: false, complicite: false, attenuation: false });
    refs.search.value = '';
    refs.results.hidden = true;
    renderRows();
    refresh();
  }

  function onEdit(e) {
    const t = e.target;
    const row = t.closest('tr[data-i]');
    if (row && t.dataset.f) {
      const ch = input.charges[row.dataset.i];
      ch[t.dataset.f] = t.type === 'checkbox' ? t.checked : Math.max(0, Number(t.value) || 0);
    } else if (t.dataset.opt) {
      const k = t.dataset.opt;
      input[k] = t.type === 'checkbox' ? t.checked : k === 'majoration' ? Number(t.value) : t.value;
    } else if (t.dataset.droit) {
      input.droits[t.dataset.droit] = t.type === 'checkbox' ? t.checked : t.value;
    } else return;
    refresh();
  }

  root.addEventListener('input', onEdit);
  root.addEventListener('change', onEdit);
  refs.search.addEventListener('input', showResults);
  refs.search.addEventListener('focus', () => { if (refs.search.value || filtreCat) showResults(); });
  refs.search.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement !== refs.search) refs.results.hidden = true;
  }, 150));
  refs.search.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length && !refs.results.hidden) addCharge(results[0]);
    } else if (e.key === 'Escape') refs.results.hidden = true;
  });
  refs.results.addEventListener('mousedown', e => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    addCharge(results[li.dataset.i]);
  });
  root.addEventListener('click', e => {
    const chip = e.target.closest('[data-cat]');
    if (chip) {
      filtreCat = chip.dataset.cat;
      $$('[data-cat]', root).forEach(b => b.classList.toggle('is-active', b === chip));
      refs.search.focus();
      showResults();
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      input.charges.splice(Number(rm.closest('tr').dataset.i), 1);
      renderRows();
      refresh();
    }
  });

  renderRows();
  refresh();
  return { value: input, result: () => compute(input, getCode) };
}
