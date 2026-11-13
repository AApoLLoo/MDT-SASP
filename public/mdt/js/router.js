// Routeur par hash (#/chemin?param=valeur) avec garde de sortie optionnelle
let routes = [];
let renderRoute = () => {};
let leaveGuard = null;
let currentHash = '';
let ignoreNext = false;

export function parseHash() {
  const [path, query = ''] = location.hash.slice(1).split('?');
  return { path: path || '/', query: new URLSearchParams(query) };
}

export function navigate(path) {
  location.hash = '#' + path;
}

// fn() doit renvoyer true pour autoriser la sortie de la vue courante
export const setLeaveGuard = fn => { leaveGuard = fn; };
// Sortie possible sans rien demander (aucune modification en cours sur la page)
export const canLeave = () => !leaveGuard || leaveGuard(true);

export function resolve() {
  const { path, query } = parseHash();
  for (const [re, view] of routes) {
    const m = path.match(re);
    if (m) return { view, params: m.slice(1), query, path };
  }
  return { view: null, params: [], query, path };
}

export function startRouter(routeTable, render) {
  routes = routeTable;
  renderRoute = render;
  currentHash = location.hash;
  window.addEventListener('hashchange', () => {
    if (ignoreNext) { ignoreNext = false; return; }
    if (leaveGuard && !leaveGuard()) {
      ignoreNext = true;
      location.hash = currentHash;
      return;
    }
    leaveGuard = null;
    currentHash = location.hash;
    renderRoute();
  });
  window.addEventListener('beforeunload', e => {
    if (leaveGuard && !leaveGuard(true)) e.preventDefault();
  });
}

export const rerender = () => { leaveGuard = null; renderRoute(); };
