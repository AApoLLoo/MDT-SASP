import { html, mount, $, attempt } from '../dom.js';
import { api, loadPenalCode } from '../api.js';
import { navigate, rerender } from '../router.js';
import { icon } from '../icons.js';
import { mountCalculator } from '../components/charges-calculator.js';

// La saisie est conservée le temps de la session du navigateur (confort uniquement)
const KEY = 'mdt-calculatrice';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
const store = v => { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* stockage indisponible */ } };
const clear = () => { try { sessionStorage.removeItem(KEY); } catch { /* stockage indisponible */ } };

export async function render(main) {
  await loadPenalCode();
  mount(main, html`
    <div class="page-head">
      <div><h1>Calculatrice de peine</h1><p class="muted">Contrôle routier, amende simple ou estimation avant arrestation.</p></div>
      <div class="actions">
        <button class="btn btn-ghost" data-reset>Réinitialiser</button>
        <button class="btn btn-primary" data-create>${icon('report')} Créer un rapport avec ces chefs</button>
      </div>
    </div>
    <section class="card"><div data-calc></div></section>`);

  const calc = mountCalculator($('[data-calc]', main), { value: load(), onChange: store });

  $('[data-reset]', main).addEventListener('click', () => { clear(); rerender(); });
  $('[data-create]', main).addEventListener('click', e => attempt(async () => {
    const { id } = await api('/reports', { method: 'POST', body: { calc_input: calc.value } });
    clear();
    navigate(`/rapports/${id}/modifier`);
  }, e.target));
}
