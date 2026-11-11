import { html, mount, $, agentLabel } from '../dom.js';
import { state, userByMatricule } from '../api.js';
import { icon } from '../icons.js';

// Agents présents : saisie d'un matricule (suggestions = agents actifs), retrait d'un clic.
// `list` (tableau de matricules) est modifié en place ; onChange() après chaque modification.
export function mountAgentsInput(root, list, onChange) {
  mount(root, html`
    <div class="chips-input">
      <span data-chips></span>
      <input class="input" list="agents-input-list" data-agent-input placeholder="Matricule puis Entrée…">
      <button type="button" class="btn btn-sm" data-agent-add>${icon('plus')} Ajouter</button>
    </div>
    <datalist id="agents-input-list">${state.users.filter(u => u.actif).map(u => html`<option value="${u.matricule}">${agentLabel(u)}</option>`)}</datalist>`);

  const render = () => mount($('[data-chips]', root), list.map(m => {
    const u = userByMatricule(m);
    return html`<span class="chip chip-static" title="${u ? agentLabel(u) : 'Agent hors MDT'}">『${m}』${u ? ` ${u.nom}` : ''}<button type="button" class="btn-icon" data-chip-rm="${m}">✕</button></span>`;
  }));
  const add = () => {
    const input = $('[data-agent-input]', root);
    const m = input.value.trim();
    if (m && !list.includes(m)) {
      list.push(m);
      render();
      onChange();
    }
    input.value = '';
  };

  $('[data-agent-add]', root).addEventListener('click', add);
  $('[data-agent-input]', root).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });
  root.addEventListener('click', e => {
    const m = e.target.closest('[data-chip-rm]')?.dataset.chipRm;
    if (!m) return;
    list.splice(list.indexOf(m), 1);
    render();
    onChange();
  });
  render();
}
