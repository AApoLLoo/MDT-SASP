import { html, mount, $, $$, agentLabel, toast, countUp } from './dom.js';
import { api, state, setUnauthorizedHandler, hasRole, isJustice, isAvocat } from './api.js';
import { startRouter, resolve, navigate } from './router.js';
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
  magistrat: /^\/(casiers|vehicules|mandats|rapports|incidents|plaintes|preuves|calculatrice|code-penal|references)(\/\d+(\/juger)?)?$/,
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
          <div class="topbar-user">
            <a class="user-label" href="#/${isJustice() ? '' : `agents/${state.user.id}`}" title="${isJustice() ? 'Accueil' : 'Mon profil'}" data-user-label></a>
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

  $('[data-lite]').addEventListener('click', () => {
    const lite = document.body.classList.toggle('lite');
    try { localStorage.setItem(LITE_KEY, lite ? '1' : '0'); } catch { /* préférence non mémorisée */ }
    if (!lite) resumeAmbient();
    updateLiteButton();
    toast(lite ? 'Mode fluide activé' : 'Effets visuels réactivés');
  });

  $('[data-logout]').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    state.user = null;
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
  }
  route();
}

async function route() {
  if (!state.user) return showLogin();
  let { view, params, query, path } = resolve();
  if (isJustice()) view = path === '/' ? justice.render : JUSTICE_PATHS[state.user.role].test(path) ? view : null;
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
  } catch (err) {
    mount(container, html`<div class="alert alert-danger">${err.message}</div>`);
  }
}

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

if (navigator.locks && !(await claimTab())) await waitForTab();
try {
  state.user = (await api('/auth/me')).user;
  await showApp();
} catch {
  showLogin();
}

