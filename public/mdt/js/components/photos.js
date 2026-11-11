import { html, mount, toast } from '../dom.js';
import { uploadImage } from '../api.js';
import { icon } from '../icons.js';

// Emplacements numérotés « photo_1 », « photo_2 »… (20 au plus). Un groupe `extra: true` ne montre que
// les photos déjà mises, puis un emplacement vide pour en ajouter une.
export const numberedSlots = (prefix = 'photo', label = 'Photo', max = 20) =>
  Array.from({ length: max }, (_, i) => [`${prefix}_${i + 1}`, `${label} ${i + 1}`]);

// Emplacements photo du bordereau d'arrestation
export const PHOTO_GROUPS = [
  { titre: "Pièces d'identité", slots: [['carte_identite', "Carte d'identité"], ['permis', 'Permis de conduire']] },
  { titre: 'Photo avec vêtements', slots: [['vetu_face', 'Face'], ['vetu_dos', 'Dos']] },
  { titre: 'Photo sans vêtements', slots: [['nu_face', 'Face'], ['nu_dos', 'Dos'], ['profil_g', 'Profil G'], ['profil_d', 'Profil D']] },
  { titre: 'Voiture', slots: [['voiture_1', 'Voiture 1'], ['voiture_2', 'Voiture 2'], ['voiture_3', 'Voiture 3']] },
  { titre: 'Objets saisis', slots: [['objet_1', 'Objet saisi 1'], ['objet_2', 'Objet saisi 2']] },
  { titre: 'Autres photos', slots: numberedSlots('autre'), extra: true },
];

const slotHtml = ([slot, label], url) => html`
  <div class="photo-slot" tabindex="0" data-slot="${slot}" title="Cliquez ici puis Ctrl+V pour coller une capture">
    <div class="photo-preview">${url
      ? html`<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${label}" loading="lazy"></a>`
      : html`<span>${icon('image')}<small>Ctrl+V, glisser ou importer</small></span>`}</div>
    <div class="photo-label">${label}</div>
    <div class="photo-actions">
      <input type="text" inputmode="url" class="input input-sm" placeholder="Lien https://…" value="${url}" data-url>
      <label class="btn btn-sm" title="Importer un fichier">${icon('plus')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden data-file></label>
      ${url ? html`<button type="button" class="btn btn-sm btn-ghost" data-clear title="Retirer la photo">✕</button>` : ''}
    </div>
  </div>`;

// Mention « n photo(s) » d'une ligne de liste
export const photoCount = photos => {
  const n = Object.keys(photos ?? {}).length;
  return n ? html`<small class="muted block">${icon('image')} ${n} photo${n > 1 ? 's' : ''}</small>` : '';
};

// photos : objet { slot: url } modifié en place ; onChange(photos) après chaque modification
export function mountPhotos(root, photos, onChange, groups = PHOTO_GROUPS) {
  const shown = g => {
    const free = g.slots.find(([k]) => !photos[k]);
    return g.extra ? g.slots.filter(s => photos[s[0]] || s === free) : g.slots;
  };
  const render = () => mount(root, html`${groups.map(g => html`
    <div class="photo-group">${g.titre ? html`<h4>${g.titre}</h4>` : ''}<div class="photo-grid">${shown(g).map(s => slotHtml(s, photos[s[0]] || ''))}</div></div>`)}`);

  const set = (slot, url) => {
    if (url) photos[slot] = url;
    else delete photos[slot];
    render();
    onChange(photos);
  };

  async function upload(slot, file) {
    if (!file || !file.type.startsWith('image/')) return toast('Seules les images sont acceptées', 'error');
    const el = root.querySelector(`[data-slot="${slot}"]`);
    el?.classList.add('is-loading');
    try {
      set(slot, await uploadImage(file));
    } catch (err) {
      toast(err.message, 'error');
      el?.classList.remove('is-loading');
    }
  }

  root.addEventListener('paste', e => {
    const slotEl = e.target.closest('[data-slot]');
    const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (slotEl && file) {
      e.preventDefault();
      upload(slotEl.dataset.slot, file);
    }
  });
  root.addEventListener('change', e => {
    const slotEl = e.target.closest('[data-slot]');
    if (!slotEl) return;
    if (e.target.matches('[data-file]')) upload(slotEl.dataset.slot, e.target.files[0]);
    if (e.target.matches('[data-url]')) {
      const url = e.target.value.trim();
      if (!url || /^https?:\/\/\S+$/.test(url)) set(slotEl.dataset.slot, url);
      else toast('Lien invalide : il doit commencer par https://', 'error');
    }
  });
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-clear]');
    if (btn) set(btn.closest('[data-slot]').dataset.slot, '');
  });
  root.addEventListener('dragover', e => {
    if (e.target.closest('[data-slot]')) e.preventDefault();
  });
  root.addEventListener('drop', e => {
    const slotEl = e.target.closest('[data-slot]');
    if (!slotEl) return;
    e.preventDefault();
    upload(slotEl.dataset.slot, e.dataTransfer.files[0]);
  });
  render();
}
