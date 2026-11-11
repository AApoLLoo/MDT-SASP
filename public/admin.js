"use strict";

// All user-supplied data is inserted with textContent, never innerHTML.

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};

const STATUS_LABELS = { pending: "En attente", accepted: "Acceptée", refused: "Refusée" };
const CAT_SLUGS = { Recrutement: "recrutement", Opérations: "operations", Communiqué: "communique", Communauté: "communaute", Journal: "journal" };
const fmtDateTime = (iso) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const fmtDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { dateStyle: "long", timeZone: "UTC" });

const state = { apps: [], news: [], perms: [], status: "pending", search: "", selected: null };

// --- API

const api = async (method, url, body) => {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Serveur injoignable. Vérifiez votre connexion.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.endsWith("/login")) showLogin();
  if (!res.ok) throw Object.assign(new Error(data.error || `Erreur ${res.status}`), { errors: data.errors });
  return data;
};

// --- Toast

const toast = (message, kind = "ok") => {
  const t = $("#toast");
  t.textContent = message;
  t.className = `toast is-visible toast--${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = "toast"; }, 3200);
};
const fail = (err) => toast(err.message, "error");

// --- Auth

const showLogin = () => {
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#password").focus();
};

// Each tab needs a scope granted by the server: PR agents only get "news".
const TAB_SCOPES = { "tab-apps": "applications", "tab-news": "news", "tab-perms": "permissions" };

const showApp = async () => {
  $("#login").hidden = true;
  $("#app").hidden = false;
  try {
    const { via, scopes } = await api("GET", "/api/admin/session");
    // Agents arrive through their MDT session: no separate logout, a way back instead.
    $("#back-agent").hidden = via !== "agent";
    $("#logout").hidden = via === "agent";
    tabs.forEach((t) => { t.hidden = !scopes.includes(TAB_SCOPES[t.id]); });
    selectTab(tabs.find((t) => !t.hidden), { focus: false });
    const loaders = {
      applications: async () => { state.apps = await api("GET", "/api/admin/applications"); renderApps(); },
      news: async () => { state.news = await api("GET", "/api/admin/news"); renderPosts(); },
      permissions: async () => { state.perms = await api("GET", "/api/admin/permissions"); renderPerms(); },
    };
    await Promise.all(scopes.map((s) => loaders[s]()));
  } catch (err) {
    fail(err);
  }
};

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const alert = $("#login-alert");
  const button = e.target.querySelector("button[type=submit]");
  alert.textContent = "";
  button.disabled = true;
  try {
    await api("POST", "/api/admin/login", { password: $("#password").value });
    $("#password").value = "";
    await showApp();
  } catch (err) {
    alert.textContent = err.message;
    $("#password").select();
  } finally {
    button.disabled = false;
  }
});

$("#logout").addEventListener("click", async () => {
  try {
    await api("POST", "/api/admin/logout");
  } catch (err) {
    fail(err);
  }
  state.apps = [];
  state.news = [];
  showLogin();
});

// --- Tabs

const tabs = [...document.querySelectorAll('[role="tab"]')];
const selectTab = (tab, { focus = true } = {}) => {
  tabs.forEach((t) => {
    const active = t === tab;
    t.setAttribute("aria-selected", String(active));
    t.tabIndex = active ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !active;
  });
  if (focus) tab.focus();
};
tabs.forEach((tab) => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const shown = tabs.filter((t) => !t.hidden);
    const i = shown.indexOf(tab);
    selectTab(shown[(i + (e.key === "ArrowRight" ? 1 : -1) + shown.length) % shown.length]);
  });
});

// --- PR rights

const renderPerms = () => {
  const root = $("#perm-list");
  if (!state.perms.length) {
    root.replaceChildren(el("li", { className: "empty", textContent: "Aucun agent PR. Ajoutez un matricule ci-dessus." }));
    return;
  }
  root.replaceChildren(...state.perms.map((p) => {
    const revoke = el("button", { type: "button", className: "btn btn--danger btn--sm", textContent: "Retirer le droit" });
    revoke.addEventListener("click", () => revokePr(p));
    return el("li", { className: "post-row" },
      el("div", { className: "post-row__main" },
        el("span", { className: "post-row__title", textContent: `${[p.rank, p.name].filter(Boolean).join(" ")} (${p.matricule})` }),
        el("span", { className: "post-row__meta", textContent: `Accordé par ${p.grantedBy} le ${fmtDateTime(p.grantedAt)}` })),
      el("div", { className: "post-row__actions" }, revoke));
  }));
};

const revokePr = async (p) => {
  if (!confirm(`Retirer le droit PR à ${p.name} (${p.matricule}) ?`)) return;
  try {
    await api("DELETE", `/api/admin/permissions/${encodeURIComponent(p.matricule)}`);
    state.perms = state.perms.filter((x) => x.matricule !== p.matricule);
    renderPerms();
    toast("Droit PR retiré.");
  } catch (err) {
    fail(err);
  }
};

$("#perm-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const field = form.querySelector(".field");
  const input = form.elements.matricule;
  field.classList.remove("is-invalid");
  field.querySelector(".error").textContent = "";
  const button = form.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const entry = await api("POST", "/api/admin/permissions", { matricule: input.value.trim() });
    state.perms = [...state.perms.filter((p) => p.matricule !== entry.matricule), entry].sort((a, b) => a.matricule.localeCompare(b.matricule));
    renderPerms();
    form.reset();
    toast(`Droit PR accordé à ${entry.name}.`);
  } catch (err) {
    field.classList.add("is-invalid");
    field.querySelector(".error").textContent = err.errors?.matricule || err.message;
    input.focus();
  } finally {
    button.disabled = false;
  }
});

// --- Applications

const badge = (status) => el("span", { className: `badge badge--${status}`, textContent: STATUS_LABELS[status] });

// Applications received before the form mirrored the Google Form used firstname/lastname/age/division/experience.
const appName = (a) => a.fullname || `${a.firstname} ${a.lastname}`;
const appService = (a) => a.service || a.division;
const APP_TEXTS = [
  ["Objectif", "goal"], ["Disponibilités", "availability"], ["Qualités et défauts", "traits"],
  ["Parcours professionnel", "career"], ["Pourquoi lui plutôt qu'un autre", "whyYou"],
  ["Lettre de motivation", "motivation"], ["Un dernier mot", "lastWord"], ["Expérience", "experience"],
];

const visibleApps = () => {
  const q = state.search.toLowerCase();
  return state.apps.filter((a) =>
    (state.status === "all" || a.status === state.status) &&
    (!q || [appName(a), a.discord, appService(a), a.phone].join(" ").toLowerCase().includes(q)));
};

const renderApps = () => {
  const pending = state.apps.filter((a) => a.status === "pending").length;
  $("#pending-count").textContent = pending ? String(pending) : "";

  const list = visibleApps();
  const root = $("#app-list");
  if (!list.length) {
    root.replaceChildren(el("li", { className: "empty", textContent: state.search ? "Aucun résultat pour cette recherche." : "Aucune candidature dans cette catégorie." }));
  } else {
    root.replaceChildren(...list.map((a) => {
      const button = el("button", { type: "button", className: "app-item" },
        el("span", { className: "app-item__name", textContent: appName(a) }),
        badge(a.status),
        el("span", { className: "app-item__meta", textContent: `${appService(a)} — ${fmtDateTime(a.createdAt)}` }));
      button.setAttribute("aria-current", String(a.id === state.selected));
      button.addEventListener("click", () => { state.selected = a.id; renderApps(); });
      return el("li", {}, button);
    }));
  }
  renderDetail(state.apps.find((a) => a.id === state.selected));
};

const renderDetail = (app) => {
  const root = $("#app-detail");
  if (!app) {
    root.replaceChildren(el("p", { className: "empty", textContent: "Sélectionnez une candidature pour l'afficher." }));
    return;
  }

  const copy = el("button", { type: "button", className: "btn btn--ghost btn--sm", textContent: "Copier" });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(app.discord);
      toast("Pseudo Discord copié.");
    } catch {
      toast("Copie impossible, sélectionnez le pseudo à la main.", "error");
    }
  });

  const item = (label, ...value) => el("div", {}, el("dt", { textContent: label }), el("dd", {}, ...value));
  const action = (label, status, cls) => {
    const b = el("button", { type: "button", className: `btn ${cls}`, textContent: label });
    b.addEventListener("click", () => setStatus(app.id, status, b));
    return b;
  };
  const remove = el("button", { type: "button", className: "btn btn--danger", textContent: "Supprimer" });
  remove.addEventListener("click", () => removeApp(app));

  root.replaceChildren(
    el("header", { className: "app-detail__head" },
      el("h2", { textContent: appName(app) }), badge(app.status)),
    el("dl", { className: "facts" },
      item("Discord", el("span", { className: "mono", textContent: app.discord }), copy),
      item("Service souhaité", appService(app)),
      item("Naissance et âge", app.birth || `${app.age} ans`),
      app.phone ? item("Téléphone", app.phone) : null,
      app.nationality ? item("Nationalité", app.nationality) : null,
      app.service ? item("Casier vierge", app.record || "Non renseigné") : null,
      item("Reçue le", fmtDateTime(app.createdAt)),
      app.decidedAt ? item("Décision le", fmtDateTime(app.decidedAt)) : null),
    ...APP_TEXTS.filter(([, key]) => app[key]).flatMap(([label, key]) => [
      el("h3", { textContent: label }),
      el("p", { className: "longtext", textContent: app[key] }),
    ]),
    el("div", { className: "app-detail__actions" },
      app.status !== "accepted" ? action("Accepter", "accepted", "btn--success") : null,
      app.status !== "refused" ? action("Refuser", "refused", "btn--ghost") : null,
      app.status !== "pending" ? action("Remettre en attente", "pending", "btn--ghost") : null,
      remove));
};

const setStatus = async (id, status, button) => {
  button.disabled = true;
  try {
    const updated = await api("PATCH", `/api/admin/applications/${id}`, { status });
    state.apps = state.apps.map((a) => (a.id === id ? updated : a));
    renderApps();
    toast(`Candidature ${STATUS_LABELS[status].toLowerCase()}.`);
  } catch (err) {
    button.disabled = false;
    fail(err);
  }
};

const removeApp = async (app) => {
  if (!confirm(`Supprimer définitivement la candidature de ${appName(app)} ?`)) return;
  try {
    await api("DELETE", `/api/admin/applications/${app.id}`);
    state.apps = state.apps.filter((a) => a.id !== app.id);
    state.selected = null;
    renderApps();
    toast("Candidature supprimée.");
  } catch (err) {
    fail(err);
  }
};

document.querySelectorAll("#status-filters .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    state.status = chip.dataset.status;
    document.querySelectorAll("#status-filters .chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    renderApps();
  });
});
$("#app-search").addEventListener("input", (e) => { state.search = e.target.value.trim(); renderApps(); });

// --- News

const renderPosts = () => {
  const root = $("#post-list");
  if (!state.news.length) {
    root.replaceChildren(el("li", { className: "empty", textContent: "Aucune actualité. Publiez la première avec « Nouvelle actualité »." }));
    return;
  }
  root.replaceChildren(...state.news.map((p) => {
    const edit = el("a", { className: "btn btn--outline btn--sm", href: `/admin/actualites/editer?id=${p.id}`, textContent: "Modifier" });
    const del = el("button", { type: "button", className: "btn btn--danger btn--sm", textContent: "Supprimer" });
    del.addEventListener("click", () => removePost(p));
    const viewLink = p.published
      ? el("a", { className: "btn btn--ghost btn--sm", href: `/actualites/${p.slug}`, target: "_blank", rel: "noopener", textContent: "Voir" })
      : el("a", { className: "btn btn--ghost btn--sm", href: `/admin/apercu/${p.id}`, target: "_blank", rel: "noopener", textContent: "Aperçu" });
    return el("li", { className: "post-row" },
      el("div", { className: "post-row__main" },
        el("span", { className: "post-row__title", textContent: p.title }),
        el("span", { className: "post-row__meta" },
          el("span", { className: `tag tag--${CAT_SLUGS[p.category]}`, textContent: p.category }),
          fmtDate(p.date),
          el("span", { className: `badge ${p.published ? "badge--accepted" : "badge--draft"}`, textContent: p.published ? "Publiée" : "Brouillon" }))),
      el("div", { className: "post-row__actions" }, viewLink, edit, del));
  }));
};

const removePost = async (post) => {
  if (!confirm(`Supprimer « ${post.title} » ? Le lien de l'article ne fonctionnera plus.`)) return;
  try {
    await api("DELETE", `/api/admin/news/${post.id}`);
    state.news = state.news.filter((p) => p.id !== post.id);
    renderPosts();
    toast("Actualité supprimée.");
  } catch (err) {
    fail(err);
  }
};

// --- Boot

api("GET", "/api/admin/session")
  .then(({ authenticated }) => (authenticated ? showApp() : showLogin()))
  .catch((err) => { showLogin(); $("#login-alert").textContent = err.message; });
