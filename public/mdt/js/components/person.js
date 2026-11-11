import { html, mount, $, $$, fullName } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { citizenPicker } from './picker.js';

const FIELDS = [
  ['nom', 'Nom *'], ['prenom', 'Prénom'], ['date_naissance', 'Date de naissance', 'date'],
  ['id_unique', 'N° sécu (ID unique)'], ['telephone', 'Téléphone'],
];

// Bloc « personne » d'un document : recherche d'une fiche existante ou saisie libre.
// `person` est modifié en place ({ id?, nom, prenom, …, inconnu?, description? }).
// allowUnknown : case « non identifié » + champ signalement (mis en cause).
export function mountPerson(root, person, { onChange = () => {}, allowUnknown = false, placeholder } = {}) {
  mount(root, html`
    ${allowUnknown ? html`<label class="check"><input type="checkbox" data-unknown ${person.inconnu ? 'checked' : ''}> Auteur non identifié</label>` : ''}
    <div data-identity>
      <div data-picker></div>
      <div class="suspect-status" data-status></div>
      <div class="form-grid cols-3">
        ${FIELDS.map(([k, label, type]) => html`<label>${label}<input class="input" type="${type || 'text'}" data-p="${k}" value="${person[k]}"></label>`)}
      </div>
    </div>
    ${allowUnknown ? html`<label class="field mt-sm">Signalement / description<textarea class="input" rows="2" data-p="description" placeholder="Tenue, corpulence, véhicule, signes distinctifs…">${person.description}</textarea></label>` : ''}`);

  async function renderStatus() {
    const el = $('[data-status]', root);
    if (person.id) {
      const c = await api(`/citizens/${person.id}`).catch(() => null);
      const actifs = c?.warrants.filter(w => w.statut === 'actif').length ?? 0;
      const arrestations = c?.reports.filter(r => r.statut === 'finalise').length ?? 0;
      mount(el, html`<p>${icon('user')} Fiche liée : <a href="#/casiers/${person.id}" target="_blank">${fullName(person)}</a>
        · ${arrestations} arrestation(s) au casier
        ${actifs ? html`<span class="badge badge-danger">${actifs} mandat(s) actif(s)</span>` : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-unlink>Dissocier</button></p>`);
    } else {
      mount(el, html`<p class="muted">${person.nom ? 'Nouvelle personne : une fiche sera créée à l\'enregistrement.' : 'Recherchez une fiche existante ou saisissez l\'identité.'}</p>`);
    }
  }

  const syncUnknown = () => { $('[data-identity]', root).hidden = !!person.inconnu; };

  citizenPicker($('[data-picker]', root), c => {
    person.id = c.id;
    for (const [k] of FIELDS) person[k] = c[k] ?? '';
    for (const input of $$('[data-p]', root)) if (input.dataset.p !== 'description') input.value = person[input.dataset.p];
    renderStatus();
    onChange();
  }, placeholder);

  root.addEventListener('input', e => {
    const k = e.target.dataset.p;
    if (!k) return;
    person[k] = e.target.value.trim();
    onChange();
  });
  root.addEventListener('change', e => {
    if (!e.target.matches('[data-unknown]')) return;
    person.inconnu = e.target.checked;
    syncUnknown();
    onChange();
  });
  root.addEventListener('click', e => {
    if (!e.target.closest('[data-unlink]')) return;
    delete person.id;
    renderStatus();
    onChange();
  });

  syncUnknown();
  renderStatus();
  // Après un enregistrement, le serveur renvoie l'id des fiches créées
  return { refresh: renderStatus };
}
