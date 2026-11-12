import { html, mount, $, $$, agentLabel, toast, countUp, formValues, formControls, openModal, clearDrafts, normalize } from './dom.js';
import { api, state, setUnauthorizedHandler, setSessionExpiredHandler, hasRole, isJustice, isAvocat } from './api.js';
import { startRouter, resolve, navigate, rerender } from './router.js';
import { icon } from './icons.js';
import { defconInfo } from './reference-data.js';
import { SPECIAL_DIVISIONS, DIVISION_KINDS, managesDivision } from './service-kinds.js';
import { renderLogin } from './views/login.js';
import * as dashboard from './views/dashboard.js';
import * as citizens from './views/citizens.js';
import * as vehicles from './views/vehicles.js';
import * as warrants from './views/warrants.js';
import * as reports from './views/reports.js';
import * as reportEdit from './views/report-edit.js';
import * as reportView from './views/report-view.js';
import * as reportJudge from './views/report-judge.js';
import * as complaints from './views/complaints.js';
import * as calculator from './views/calculator.js';
import * as penalCode from './views/penal-code.js';
import * as references from './views/references.js';
import * as admin from './views/admin.js';
import * as agents from './views/agents.js';
import * as service from './views/service.js';
import * as divisions from './views/divisions.js';
import * as announcements from './views/announcements.js';
import * as incidents from './views/incidents.js';
import * as evidence from './views/evidence.js';
import * as tickets from './views/tickets.js';
import { globalSearch, rememberPage } from './components/search.js';
import { copyText } from './components/discord.js';
import * as audit from './views/audit.js';
import * as justice from './views/justice.js';
import { avatar } from './components/avatar.js';
import { startAmbient } from './ambient.js';

// Les chaînes seules sont des titres de groupe du menu
const NAV = [
  ['/', 'dashboard', 'Tableau de bord'],
  ['/annonces', 'megaphone', 'Annonces'],
  'Dossiers',
  ['/casiers', 'citizens', 'Casiers'],
  ['/vehicules', 'car', 'Véhicules volés'],
  ['/mandats', 'warrant', 'Mandats & BOLO'],
  'Rapports',
  ['/rapports', 'report', "Rapports d'arrestation"],
  ['/incidents', 'incident', "Rapports d'incident"],
  ['/plaintes', 'complaint', 'Plaintes'],
  ['/amendes', 'ticket', 'Amendes'],
  ['/preuves', 'box', 'Preuves'],
  'Outils',
  ['/calculatrice', 'calculator', 'Calculatrice'],
  ['/code-penal', 'book', 'Code pénal'],
  ['/references', 'library', 'Références'],
  'Personnel',
  ['/agents', 'badge', 'Effectifs'],
  ['/service', 'radio', 'Service'],
  divisionNav,
  'Commandement',
  ['/historique', 'history', 'Historique', 'superviseur'],
  ['/admin', 'shield', 'Administration', 'admin'],
];

// Une catégorie par division encadrée (managesDivision) : effectif, pages propres, puis dossiers
function divisionNav() {
  return Object.entries(SPECIAL_DIVISIONS).filter(([key]) => managesDivision(key, state.user)).flatMap(([key, d]) => [
    d.nom,
    [`/divisions/${key}/effectif`, 'citizens', 'Effectif'],
    ...(d.pages ?? []).map(([page, ic, titre]) => [`/divisions/${key}/${page}`, ic, titre]),
    ...Object.entries(DIVISION_KINDS).filter(([, kind]) => kind.division === key && kind.menu !== false).map(([k, kind]) => [`/divisions/${key}/${k}`, kind.icon, kind.titre]),
  ]);
}

// Comptes justice : le magistrat a les groupes Dossiers, Rapports et Outils ; l'avocat, ses seuls dossiers
const JUSTICE_GROUPS = NAV.slice(NAV.indexOf('Dossiers'), NAV.indexOf('Personnel'));
const justiceNav = () => (isAvocat() ? [['/', 'report', 'Mes dossiers']] : [['/', 'report', 'En attente de jugement'], ...JUSTICE_GROUPS]);
// Pages ouvertes aux comptes justice (le serveur refuse le reste de toute façon) ; aucune page de saisie police
const JUSTICE_PATHS = {
  magistrat: /^\/(casiers|vehicules|mandats|rapports|incidents|plaintes|preuves|amendes|calculatrice|code-penal|references)(\/\d+(\/juger)?)?$/,
  avocat: /^\/(rapports|plaintes)\/\d+$/,
};

// Entrées visibles pour le rôle courant ; un titre de groupe sans entrée visible disparaît
function navItems() {
  const entries = isJustice() ? justiceNav() : NAV;
  const items = entries.flatMap(e => (typeof e === 'function' ? e() : [e])).filter(e => typeof e === 'string' || !e[3] || hasRole(e[3]));
  return items.filter((e, i) => typeof e !== 'string' || (items[i + 1] && typeof items[i + 1] !== 'string'));
}

const ROUTES = [
  [/^\/$/, dashboard.render],
  [/^\/casiers$/, citizens.renderList],
  [/^\/casiers\/(\d+|nouveau)$/, citizens.renderDetail],
  [/^\/vehicules$/, vehicles.render],
  [/^\/mandats$/, warrants.render],
  [/^\/rapports$/, reports.render],
  [/^\/rapports\/nouveau$/, reportEdit.renderNew],
  [/^\/rapports\/(\d+)\/modifier$/, reportEdit.render],
  [/^\/rapports\/(\d+)\/juger$/, reportJudge.render],
  [/^\/rapports\/(\d+)$/, reportView.render],
  [/^\/incidents$/, incidents.renderList],
  [/^\/incidents\/nouveau$/, incidents.renderNew],
  [/^\/incidents\/(\d+)\/modifier$/, incidents.renderEdit],
  [/^\/incidents\/(\d+)$/, incidents.renderView],
  [/^\/preuves$/, evidence.render],
  [/^\/amendes$/, tickets.render],
  [/^\/historique$/, audit.render],
  [/^\/plaintes$/, complaints.renderList],
  [/^\/plaintes\/nouvelle$/, complaints.renderEdit],
  [/^\/plaintes\/(\d+)\/modifier$/, complaints.renderEdit],
  [/^\/plaintes\/(\d+)$/, complaints.renderView],
  [/^\/calculatrice$/, calculator.render],
  [/^\/code-penal$/, penalCode.render],
  [/^\/references$/, references.render],
  [/^\/agents$/, agents.renderList],
  [/^\/agents\/(\d+)$/, agents.renderProfile],
  [/^\/agents\/(\d+)\/modifier$/, agents.renderEdit],
  [/^\/service(?:\/(\w+))?$/, service.render],
  [/^\/divisions\/(\w+)\/(\w+)(?:\/(\d+))?$/, divisions.render],
  [/^\/annonces$/, announcements.render],
  [/^\/admin$/, admin.render],
];

let routerStarted = false;

function showLogin() {
  renderLogin($('#root'), showApp);
}

// Session de 12 h écoulée pendant l'utilisation : reconnexion par-dessus la page, sans perdre la saisie en cours.
// Résolue une fois le même agent reconnecté ; un autre agent recharge le MDT (il n'hérite pas de l'écran).
function promptRelogin() {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    mount(dialog, html`
      <div class="modal-head"><h2>Session expirée</h2></div>
      <form class="modal-body">
        <p>Votre session de 12 heures est terminée. Reconnectez-vous : la page et votre saisie en cours sont conservées.</p>
        <label class="field">Matricule<input class="input" name="matricule" required autocomplete="username" value="${state.user.matricule}"></label>
        <label class="field">Mot de passe<input class="input" name="password" type="password" required autocomplete="current-password" autofocus></label>
        <p class="form-error" hidden></p>
        <div class="form-actions">
          <button type="button" class="btn" data-switch>Changer d'agent</button>
          <button class="btn btn-primary">Reconnexion</button>
        </div>
      </form>`);
    const form = $('form', dialog);
    const error = $('.form-error', dialog);
    dialog.addEventListener('cancel', e => e.preventDefault()); // Échap ne ferme pas : la reconnexion est obligatoire
    $('[data-switch]', dialog).addEventListener('click', () => location.reload());
    form.addEventListener('submit', async e => {
      e.preventDefault();
      error.hidden = true;
      e.submitter.disabled = true;
      try {
        const { user } = await api('/auth/login', { method: 'POST', body: formValues(form) });
        if (user.id !== state.user.id) {
          location.reload();
          return;
        }
        dialog.close();
        dialog.remove();
        resolve();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        e.submitter.disabled = false;
      }
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

function updateDefconBadge() {
  const badge = $('[data-defcon-badge]');
  if (!badge) return;
  badge.className = `defcon-badge defcon-${state.defcon}`;
  badge.title = defconInfo(state.defcon).signification;
  badge.textContent = `DEFCON ${state.defcon}`;
  // DEFCON 1–2 : la rampe de gyrophare s'allume
  if (state.defcon <= 2) document.body.dataset.alert = state.defcon;
  else delete document.body.dataset.alert;
}

function flashLightbar() {
  const bar = $('[data-lightbar]');
  if (!bar) return;
  bar.classList.add('is-flashing');
  setTimeout(() => bar.classList.remove('is-flashing'), 6000);
}

function updateUserLabel() {
  const el = $('[data-user-label]');
  if (el) mount(el, html`${avatar(state.user, 'sm')}<span>${agentLabel(state.user)}</span>`);
}

// Pastille du menu : annonces publiées depuis la dernière visite de la page
const BASE_TITLE = document.title;
const UNREAD_POLL_MS = 30000;
let lastPingId = null; // dernière annonce déjà signalée à l'agent connecté (null : pas encore vérifié)

// Petit « ping » sonore (deux notes) ; ignoré si le navigateur bloque l'audio
function playPing() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((freq, i) => {
      const t = ctx.currentTime + i * 0.15;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch { /* audio indisponible */ }
}

// Pastille du menu, titre de l'onglet et notification des nouvelles annonces non lues
async function updateUnread() {
  if (!state.user || $('.tab-lock')) return; // onglet masqué : pas de ping en double
  if (isJustice()) return; // les annonces sont internes à la police
  const data = await api('/announcements/unread').catch(() => null);
  const net = $('[data-net]');
  if (net) {
    net.classList.toggle('is-offline', !data);
    $('[data-net-label]').textContent = data ? 'En ligne' : 'Connexion perdue';
  }
  const badge = $('[data-unread]');
  if (!data || !badge) return;
  const { count, latest } = data;
  badge.textContent = count > 9 ? '9+' : count;
  badge.hidden = !count;
  badge.classList.toggle('is-pinging', count > 0);
  document.title = count ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;

  const open = () => navigate('/annonces');
  if (lastPingId === null) {
    lastPingId = latest?.id ?? 0;
    if (count) toast(`Vous avez ${count} annonce${count > 1 ? 's' : ''} non lue${count > 1 ? 's' : ''}`, 'annonce', { onClick: open, duration: 8000 });
  } else if (latest && latest.id > lastPingId) {
    lastPingId = latest.id;
    const urgent = latest.importance === 'urgente';
    toast(`Nouvelle annonce${urgent ? ' URGENTE' : ''} : ${latest.titre}`, urgent ? 'error' : 'annonce', { onClick: open, duration: 12000 });
    if (urgent) flashLightbar();
    playPing();
  }
}

// Mode fluide : sans flou ni fond animé, pour les postes qui rament (GPU occupé par le jeu, accélération matérielle coupée)
const LITE_KEY = 'mdt-lite';

function updateLiteButton() {
  const btn = $('[data-lite]');
  const lite = document.body.classList.contains('lite');
  btn.setAttribute('aria-pressed', lite);
  btn.title = lite ? 'Mode fluide activé : cliquer pour réactiver les effets visuels' : 'Mode fluide : couper les effets visuels si le MDT rame';
}

// Choix mémorisé de l'agent ; à défaut, mode fluide si le navigateur dessine sans carte graphique
function initLite() {
  let saved = null;
  try { saved = localStorage.getItem(LITE_KEY); } catch { /* stockage indisponible */ }
  if (saved) return document.body.classList.toggle('lite', saved === '1');
  const gl = document.createElement('canvas').getContext('webgl');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  document.body.classList.toggle('lite', !gl || /swiftshader|basic render|llvmpipe|software/i.test(renderer));
}

function updateClock() {
  const el = $('[data-clock]');
  if (!el) return;
  const now = new Date();
  el.firstElementChild.textContent = now.toLocaleTimeString('fr-FR');
  el.lastElementChild.textContent = now.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

async function showApp() {
  lastPingId = null;
  state.settings = await api('/settings');
  state.defcon = state.settings.defcon;
  mount($('#root'), html`
    <div class="layout is-entering">
      <aside class="sidebar">
        <a class="brand" href="#/">
          <img src="img/sasp-seal.png" alt="">
          ${isJustice()
            ? html`<span><strong>DOJ</strong><small>Department of Justice</small></span>`
            : html`<span><strong>SASP</strong><small>San Andreas State Police</small></span>`}
        </a>
        <nav class="nav">
          ${navItems().map(e => (typeof e === 'string' ? html`<p class="nav-group">${e}</p>` : html`
            <a href="#${e[0]}" data-nav="${e[0]}">${icon(e[1])}<span>${e[2]}</span>${e[0] === '/annonces' ? html`<b class="nav-badge" data-unread hidden></b>` : ''}</a>`))}
        </nav>
        <div class="sidebar-foot">
          <i class="net-dot" data-net></i>
          <span><strong>Mobile Data Terminal</strong><span data-net-label>En ligne</span></span>
        </div>
      </aside>
      <div class="main-wrap">
        <header class="topbar">
          <div class="lightbar" data-lightbar></div>
          <a href="#/references?onglet=defcon" data-defcon-badge></a>
          <span class="clock" data-clock><b></b><small></small></span>
          ${isAvocat() ? '' : html`<div class="topbar-search" data-global-search></div>`}
          <div class="topbar-user">
            <a class="user-label" href="#/${isJustice() ? 'profil' : `agents/${state.user.id}`}" title="Mon profil" data-user-label></a>
            <a class="btn btn-sm btn-ghost" href="/" title="Site public">${icon('back')}</a>
            <button type="button" class="btn btn-sm btn-ghost" data-lite>${icon('zap')}</button>
            <button type="button" class="btn btn-sm btn-ghost" data-logout title="Déconnexion">${icon('logout')}</button>
          </div>
        </header>
        <main id="app"></main>
      </div>
    </div>`);
  updateDefconBadge();
  updateUserLabel();
  updateClock();
  updateLiteButton();
  if (!isAvocat()) globalSearch($('[data-global-search]'));

  $('[data-lite]').addEventListener('click', () => {
    const lite = document.body.classList.toggle('lite');
    try { localStorage.setItem(LITE_KEY, lite ? '1' : '0'); } catch { /* préférence non mémorisée */ }
    if (!lite) resumeAmbient();
    updateLiteButton();
    toast(lite ? 'Mode fluide activé' : 'Effets visuels réactivés');
  });

  $('[data-logout]').addEventListener('click', async () => {
    state.user = null; // avant la requête : un 401 reçu entre-temps ne doit pas ouvrir la reconnexion
    clearDrafts(); // le prochain agent sur ce poste ne voit pas les saisies du précédent
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    showLogin();
  });

  if (!routerStarted) {
    routerStarted = true;
    startRouter(ROUTES, route);
    setInterval(updateClock, 1000);
    setInterval(updateUnread, UNREAD_POLL_MS);
    window.addEventListener('defcon-change', updateDefconBadge);
    window.addEventListener('profile-change', updateUserLabel);
    window.addEventListener('annonces-seen', updateUnread);
    window.addEventListener('keydown', onShortcut);
    window.addEventListener('show-shortcuts', showShortcuts);
  }
  route();
}

async function route() {
  if (!state.user) return showLogin();
  let { view, params, query, path } = resolve();
  if (isJustice()) {
    view = { '/': justice.render, '/profil': justice.renderProfile }[path] ?? (JUSTICE_PATHS[state.user.role].test(path) ? view : null);
  }
  if (path !== '/annonces') updateUnread();
  for (const a of $$('[data-nav]')) {
    const p = a.dataset.nav;
    a.classList.toggle('is-active', p === '/' ? path === '/' : path.startsWith(p));
  }
  // Chaque navigation rend dans un conteneur neuf : un rendu tardif d'une page quittée reste invisible
  const container = document.createElement('div');
  container.className = 'view';
  $('#app').replaceChildren(container);
  window.scrollTo(0, 0);
  if (!view) return mount(container, html`<div class="empty-state">Page introuvable. <a href="#/">Retour au tableau de bord</a></div>`);
  mount(container, html`<div class="skeleton" aria-busy="true" aria-label="Chargement…"><i></i><i></i><i></i><i></i></div>`);
  try {
    await view(container, params, query);
    countUp(container);
    // Pages de détail : proposées ensuite dans la recherche (Ctrl+K, champ vide)
    const text = sel => $(sel, container)?.textContent.replace(/\s+/g, ' ').trim() ?? '';
    if (/\/\d+$/.test(path) && container.isConnected) rememberPage(path, text('h1'), text('.paper-sub'));
  } catch (err) {
    mount(container, html`<div class="alert alert-danger">${err.message}</div>`);
  }
}

// ---------- Raccourcis clavier ----------

// Création rapide (Alt+lettre) : pas pour les comptes justice
const CREATE = {
  r: ["Nouveau rapport d'arrestation", () => navigate('/rapports/nouveau')],
  a: ['Dresser une amende', () => tickets.openTicketForm({}, () => { if (/^\/(amendes|casiers\/\d+)$/.test(resolve().path)) rerender(); })],
  i: ["Nouveau rapport d'incident", () => navigate('/incidents/nouveau')],
  p: ['Nouvelle plainte', () => navigate('/plaintes/nouvelle')],
};
// Navigation « G » puis lettre
const GOTO = {
  t: ['/', 'Tableau de bord'], c: ['/casiers', 'Casiers'], v: ['/vehicules', 'Véhicules volés'], m: ['/mandats', 'Mandats & BOLO'],
  r: ['/rapports', "Rapports d'arrestation"], i: ['/incidents', "Rapports d'incident"], p: ['/plaintes', 'Plaintes'],
  a: ['/amendes', 'Amendes'], e: ['/preuves', 'Preuves'], k: ['/code-penal', 'Code pénal'], s: ['/service', 'Service'], f: ['/agents', 'Effectifs'],
};
const GOTO_DELAY_MS = 1500;
let gPressedAt = 0;

const typing = e => e.target.closest?.('input, textarea, select, [contenteditable]');
const openDialog = () => $$('dialog[open]').at(-1);

// Envoie le formulaire de la modale par son bouton principal (les gestionnaires lisent e.submitter)
function submitDialog(dialog) {
  const form = $('form', dialog);
  if (!form) return;
  const buttons = [...formControls(form)].filter(b => b.type === 'submit');
  form.requestSubmit(buttons.find(b => b.classList.contains('btn-primary')) ?? buttons[0]);
}

function onShortcut(e) {
  if (!state.user || $('.tab-lock')) return;
  const key = e.key?.toLowerCase() ?? ''; // e.key absent sur les keydown de saisie automatique
  const ctrl = e.ctrlKey || e.metaKey;
  // Ctrl+K : recherche globale
  if (ctrl && key === 'k') {
    const input = $('[data-global-search] input');
    if (input && !openDialog()) { e.preventDefault(); input.focus(); }
    return;
  }
  // Ctrl+S : enregistre la modale ouverte (les pages d'édition gèrent le leur) ; jamais « Enregistrer sous » du navigateur
  if (ctrl && key === 's') {
    if (e.defaultPrevented) return;
    e.preventDefault();
    const dialog = openDialog();
    if (dialog) submitDialog(dialog);
    return;
  }
  // Alt+lettre (AltGr = Ctrl+Alt exclu, pour taper @, €…) : création rapide
  if (e.altKey && !ctrl && !e.shiftKey && CREATE[key] && !isJustice() && !openDialog()) {
    e.preventDefault();
    CREATE[key][1]();
    return;
  }
  if (ctrl || e.altKey || typing(e) || openDialog()) return;
  if (e.key === '?') { showShortcuts(); return; }
  // Échap hors modale : retour à la page parente (lien « retour » de la page)
  if (e.key === 'Escape') { $('#app a.back')?.click(); return; }
  if (Date.now() - gPressedAt < GOTO_DELAY_MS && GOTO[key]) {
    gPressedAt = 0;
    navigate(GOTO[key][0]);
    return;
  }
  gPressedAt = key === 'g' ? Date.now() : 0;
}

function showShortcuts() {
  if (openDialog()) return;
  const combo = keys => html`${keys.map((k, i) => html`${i ? ' + ' : ''}<kbd>${k}</kbd>`)}`;
  const rows = [
    [['Ctrl', 'K'], 'Recherche globale (champ vide : pages consultées récemment)'],
    [['Ctrl', 'S'], 'Enregistrer la page ou la fenêtre ouverte'],
    [['Échap'], 'Fermer la fenêtre, ou revenir à la page parente'],
    [['?'], 'Afficher cette aide'],
    ...(isJustice() ? [] : Object.entries(CREATE).map(([k, [label]]) => [['Alt', k.toUpperCase()], label])),
  ];
  openModal('Raccourcis clavier', html`
    <table class="table shortcuts"><tbody>
      ${rows.map(([keys, label]) => html`<tr><td class="nowrap">${combo(keys)}</td><td>${label}</td></tr>`)}
    </tbody></table>
    <h3>Aller à… <small class="muted"><kbd>G</kbd> puis la lettre</small></h3>
    <table class="table shortcuts"><tbody>
      ${Object.entries(GOTO).map(([k, [, label]]) => html`<tr><td class="nowrap"><kbd>G</kbd> puis <kbd>${k.toUpperCase()}</kbd></td><td>${label}</td></tr>`)}
    </tbody></table>`);
}

// ---------- Copie et tri (délégués : valables sur toutes les pages) ----------

// Phase de capture : le clic sur « copier » ne déclenche pas aussi le clic de la ligne de tableau
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-copy-text]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const text = btn.dataset.copyText;
  if (await copyText(text)) toast(`« ${text} » copié`);
  else toast('Copie impossible : sélectionnez le texte et faites Ctrl+C', 'error');
}, true);

// Clé de tri d'une cellule : date JJ/MM/AAAA [HH:MM], nombre ou montant, sinon texte
function sortKey(cell) {
  const t = cell?.textContent.trim() ?? '';
  const d = t.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\D{1,3}(\d{2}):(\d{2}))?/);
  if (d) return `${d[3]}${d[2]}${d[1]}${d[4] ?? '00'}${d[5] ?? '00'}`;
  if (/\d/.test(t) && /^[-$\d\s., ]+$/.test(t)) return Number(t.replace(/[^\d-]/g, ''));
  return normalize(t);
}

// Tri au clic sur l'en-tête de colonne ; ne trie que les lignes affichées (« Afficher plus » charge le reste)
document.addEventListener('click', e => {
  const th = e.target.closest('.table-wrap thead th');
  if (!th || !th.textContent.trim() || e.target.closest('a, button, input, select')) return;
  const tbody = th.closest('table').tBodies[0];
  if (!tbody || tbody.rows.length < 2) return;
  const dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
  for (const h of th.parentElement.cells) h.removeAttribute('aria-sort');
  th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
  const col = th.cellIndex;
  const rows = [...tbody.rows].map(row => [sortKey(row.cells[col]), row]);
  const compare = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'fr', { numeric: true }));
  rows.sort(([a], [b]) => dir * compare(a, b));
  tbody.append(...rows.map(([, row]) => row));
});

// Verre liquide : le reflet des panneaux suit le pointeur (variables lues par app.css)
document.addEventListener('pointermove', e => {
  if (document.body.classList.contains('lite')) return;
  const el = e.target.closest?.('.card, .stat, .agent-card, .unit-card, .annonce');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - r.left}px`);
  el.style.setProperty('--my', `${e.clientY - r.top}px`);
}, { passive: true });

// Un seul onglet MDT à la fois : verrou Web Locks tenu tant que l'onglet est ouvert, libéré à sa fermeture.
// « Utiliser ici » le reprend ; l'onglet dépossédé est masqué sans être rechargé (un rapport en cours n'est pas perdu).
// Sans Web Locks (HTTP hors localhost), pas de contrôle.
const TAB_LOCK = 'mdt-onglet';

function claimTab(steal = false) {
  return new Promise(resolve => {
    navigator.locks.request(TAB_LOCK, steal ? { steal: true } : { ifAvailable: true }, lock => {
      resolve(Boolean(lock));
      return lock && new Promise(() => {});
    }).catch(() => waitForTab()); // verrou repris par un autre onglet
  });
}

async function waitForTab() {
  if ($('.tab-lock')) return;
  const overlay = mount(document.createElement('div'), html`
    <div class="login-screen">
      <div class="login-card">
        <div class="lightbar"></div>
        <img src="img/sasp-banner.png" alt="San Andreas State Police" class="login-banner">
        <h1>MDT déjà ouvert</h1>
        <p class="muted">Le MDT est ouvert dans un autre onglet. Un seul onglet peut l'utiliser à la fois.</p>
        <button type="button" class="btn btn-primary btn-block">Utiliser le MDT ici</button>
      </div>
    </div>`);
  overlay.className = 'tab-lock';
  document.body.append(overlay);
  await new Promise(resolve => $('button', overlay).addEventListener('click', resolve, { once: true }));
  await claimTab(true);
  overlay.remove();
}

initLite();
const resumeAmbient = startAmbient($('#ambient'), $('.backdrop'));
setUnauthorizedHandler(showLogin);
setSessionExpiredHandler(promptRelogin);

if (navigator.locks && !(await claimTab())) await waitForTab();
try {
  state.user = (await api('/auth/me')).user;
  await showApp();
} catch {
  showLogin();
}

