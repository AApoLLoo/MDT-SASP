"use strict";

// Officer space. All content comes from civilians or officers: insert with textContent only.

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
};

const POLL_MS = 20000;
const PRIORITY_LABELS = { basse: "Basse", normale: "Normale", haute: "Haute" };
const fmt = (iso) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const fmtDay = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const apptText = (a) => `${fmtDay(a.date)}, ${a.slot.toLowerCase()}`;
const label = (o) => [o.rank, o.name].filter(Boolean).join(" ") || o.matricule;

const state = {
  officer: null, view: "dash", type: "civil", status: "open", search: "",
  threads: [], selected: null, detail: null, notes: [], poll: null,
};

// --- API & feedback

const api = async (method, url, body) => {
  let res;
  try {
    res = await fetch(url, {
      method, credentials: "same-origin",
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

const toast = (message, kind = "ok") => {
  const t = $("#toast");
  t.textContent = message;
  t.className = `toast is-visible toast--${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = "toast"; }, 3200);
};
const fail = (err) => toast(err.message, "error");

const showFieldErrors = (form, err) => {
  form.querySelectorAll(".field").forEach((f) => { f.classList.remove("is-invalid"); f.querySelector(".error").textContent = ""; });
  Object.entries(err?.errors || {}).forEach(([name, message]) => {
    const field = form.querySelector(`[data-field="${name}"]`);
    if (!field) return;
    field.classList.add("is-invalid");
    field.querySelector(".error").textContent = message;
  });
  form.querySelector(".form__alert").textContent = !err ? "" : err.errors ? "Corrigez les champs signalés." : err.message;
};

// --- Auth

const showLogin = () => {
  clearInterval(state.poll);
  Object.assign(state, { officer: null, threads: [], selected: null, detail: null, notes: [] });
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#matricule").focus();
};

const showApp = async (officer, mdtUrl) => {
  state.officer = officer;
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#whoami").textContent = `${label(officer)} — ${officer.matricule}`;
  // Command staff get the full administration; PR agents only the news section of it.
  const adminLink = $("#admin-link");
  adminLink.hidden = !officer.command && !officer.pr;
  adminLink.textContent = officer.command ? "Administration" : "Publier une actualité";
  $("#new-note").hidden = !officer.command;
  const mdt = $("#mdt-link");
  mdt.hidden = !mdtUrl || mdtUrl === "#";
  mdt.href = mdtUrl || "#";
  await refresh();
  clearInterval(state.poll);
  // ponytail: polling every 20 s, paused when the tab is hidden; switch to SSE if many agents are online at once.
  state.poll = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
};

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const alert = $("#login-alert");
  const button = e.target.querySelector("[type=submit]");
  alert.textContent = "";
  button.disabled = true;
  try {
    await api("POST", "/api/agent/login", { matricule: $("#matricule").value.trim(), password: $("#password").value });
    $("#password").value = "";
    const { officer, mdtUrl } = await api("GET", "/api/agent/session");
    await showApp(officer, mdtUrl);
  } catch (err) {
    alert.textContent = err.message;
    $("#password").select();
  } finally {
    button.disabled = false;
  }
});

$("#logout").addEventListener("click", async () => {
  try {
    await api("POST", "/api/agent/logout");
  } catch (err) {
    fail(err);
  }
  showLogin();
});

// --- Data

const refresh = async () => {
  try {
    const threads = await api("GET", "/api/agent/threads");
    const before = state.threads.find((t) => t.id === state.selected)?.updatedAt;
    state.threads = threads;
    renderCounts();
    if (state.view === "dash") await loadDashboard();
    if (state.view === "notes") await loadNotes();
    if (state.view === "civil" || state.view === "internal") {
      renderList();
      const after = threads.find((t) => t.id === state.selected)?.updatedAt;
      if (state.selected && after && after !== before) await openThread(state.selected, { keepDrafts: true });
    }
  } catch (err) {
    fail(err);
  }
};

const openThread = async (id, { keepDrafts = false } = {}) => {
  const drafts = keepDrafts ? { reply: $("#reply-body")?.value, note: $("#note-body")?.value } : {};
  try {
    state.selected = id;
    state.detail = await api("GET", `/api/agent/threads/${id}`);
    const row = state.threads.find((t) => t.id === id);
    if (row) row.unread = false;
    renderCounts();
    renderList();
    renderDetail();
    if (drafts.reply) $("#reply-body").value = drafts.reply;
    if (drafts.note && $("#note-body")) $("#note-body").value = drafts.note;
  } catch (err) {
    fail(err);
  }
};

// Applies a server response to the open thread without triggering a re-fetch on the next poll
const applyDetail = (thread) => {
  state.detail = thread;
  const row = state.threads.find((t) => t.id === thread.id);
  if (row) Object.assign(row, { updatedAt: thread.updatedAt, status: thread.status, priority: thread.priority, assignee: thread.assignee });
  renderList();
  renderDetail();
};

// --- Tabs

const tabs = [...document.querySelectorAll('[role="tab"]')];
const panels = ["#panel-dash", "#panel", "#panel-notes"];

const selectView = (view, { focus = true } = {}) => {
  const tab = tabs.find((t) => t.dataset.view === view);
  tabs.forEach((t) => {
    const active = t === tab;
    t.setAttribute("aria-selected", String(active));
    t.tabIndex = active ? 0 : -1;
  });
  panels.forEach((p) => { $(p).hidden = `#${tab.getAttribute("aria-controls")}` !== p; });
  state.view = view;
  if (view === "civil" || view === "internal") {
    if (state.type !== view) Object.assign(state, { type: view, selected: null, detail: null });
    $("#panel").setAttribute("aria-labelledby", tab.id);
    $("#status-filters").hidden = view !== "civil";
    $("#new-message").hidden = view !== "internal";
    renderList();
    renderDetail();
  }
  if (view === "dash") loadDashboard();
  if (view === "notes") loadNotes();
  if (focus) tab.focus();
};

tabs.forEach((tab, i) => {
  tab.addEventListener("click", () => selectView(tab.dataset.view));
  tab.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    selectView(next.dataset.view);
  });
});

const setStatusFilter = (status) => {
  state.status = status;
  document.querySelectorAll("#status-filters .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.status === status)));
  renderList();
};
document.querySelectorAll("#status-filters .chip").forEach((chip) => chip.addEventListener("click", () => setStatusFilter(chip.dataset.status)));
$("#search").addEventListener("input", (e) => { state.search = e.target.value.trim().toLowerCase(); renderList(); });

// --- Dashboard

const loadDashboard = async () => {
  try {
    renderDashboard(await api("GET", "/api/agent/dashboard"));
  } catch (err) {
    fail(err);
  }
};

const goToCivil = (status, id) => {
  selectView("civil", { focus: false });
  setStatusFilter(status);
  if (id) openThread(id);
};

const renderDashboard = ({ counts, mine, announcements }) => {
  $("#dash-hello").textContent = `Bonjour, ${label(state.officer)}`;

  const count = (value, text, onClick) => {
    const b = el("button", { type: "button", className: "dash__count" }, el("strong", { textContent: String(value) }), el("span", { textContent: text }));
    b.addEventListener("click", onClick);
    return el("div", {}, b);
  };
  $("#dash-counts").replaceChildren(
    count(counts.mine, "demandes assignées à moi", () => goToCivil("mine")),
    count(counts.unassigned, "demandes sans agent", () => goToCivil("unassigned")),
    count(counts.open, "demandes ouvertes au total", () => goToCivil("open")),
    count(counts.unread, "messages internes non lus", () => selectView("internal")));

  $("#dash-mine").replaceChildren(...(mine.length
    ? mine.map((t) => {
        const b = el("button", { type: "button", className: "dash__item" },
          el("span", { className: "dash__item-title", textContent: t.subject }),
          el("span", { className: "dash__item-meta" },
            t.priority === "haute" ? el("span", { className: "badge badge--refused", textContent: "Priorité haute" }) : null,
            `${t.category} — ${t.civilName} — ${fmt(t.updatedAt)}`));
        b.addEventListener("click", () => goToCivil("mine", t.id));
        return el("li", {}, b);
      })
    : [el("li", { className: "empty", textContent: "Aucune demande ne vous est assignée. Consultez les demandes sans agent." })]));

  $("#dash-notes").replaceChildren(...(announcements.length
    ? announcements.map((n) => {
        const b = el("button", { type: "button", className: "dash__item" },
          el("span", { className: "dash__item-title", textContent: n.title }),
          el("span", { className: "dash__item-meta" },
            n.pinned ? el("span", { className: "badge badge--pending", textContent: "Épinglée" }) : null,
            `${label(n.author)} — ${fmt(n.createdAt)}`));
        b.addEventListener("click", () => selectView("notes"));
        return el("li", {}, b);
      })
    : [el("li", { className: "empty", textContent: "Aucune note de service publiée." })]));
};

// --- Service notes

const loadNotes = async () => {
  try {
    state.notes = await api("GET", "/api/agent/announcements");
    renderNotes();
  } catch (err) {
    fail(err);
  }
};

const renderNotes = () => {
  const root = $("#notes-list");
  if (!state.notes.length) {
    root.replaceChildren(el("li", { className: "empty", textContent: state.officer.command ? "Aucune note. Publiez la première avec « Publier une note »." : "Aucune note de service publiée." }));
    return;
  }
  root.replaceChildren(...state.notes.map((n) => {
    let del = null;
    if (state.officer.command) {
      del = el("button", { type: "button", className: "btn btn--danger btn--sm", textContent: "Supprimer" });
      del.addEventListener("click", () => removeNote(n));
    }
    return el("li", { className: `note${n.pinned ? " note--pinned" : ""}` },
      el("header", { className: "note__head" },
        el("div", {},
          el("h3", { textContent: n.title }),
          el("p", { className: "note__meta" },
            n.pinned ? el("span", { className: "badge badge--pending", textContent: "Épinglée" }) : null,
            `${label(n.author)} (${n.author.matricule}) — ${fmt(n.createdAt)}`)),
        del),
      n.image ? el("img", { className: "note__img", src: n.image, alt: `Photo jointe : ${n.title}`, loading: "lazy", decoding: "async" }) : null,
      el("p", { className: "longtext", textContent: n.body }));
  }));
};

const removeNote = async (note) => {
  if (!confirm(`Supprimer la note « ${note.title} » ?`)) return;
  try {
    await api("DELETE", `/api/agent/announcements/${note.id}`);
    state.notes = state.notes.filter((n) => n.id !== note.id);
    renderNotes();
    toast("Note supprimée.");
  } catch (err) {
    fail(err);
  }
};

const noteEditor = $("#note-editor");
const noteForm = $("#note-form");
const notePhoto = setupPhotoField($("#n-photo"));
$("#new-note").addEventListener("click", () => {
  noteForm.reset();
  showFieldErrors(noteForm, null);
  notePhoto.reset();
  noteEditor.showModal();
  noteForm.elements.title.focus();
});
$("#note-cancel").addEventListener("click", () => noteEditor.close());
noteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = noteForm.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const f = noteForm.elements;
    await api("POST", "/api/agent/announcements", { title: f.title.value, body: f.body.value, pinned: f.pinned.checked, image: notePhoto.get() });
    noteEditor.close();
    toast("Note publiée.");
    await loadNotes();
  } catch (err) {
    showFieldErrors(noteForm, err);
  } finally {
    button.disabled = false;
  }
});

// --- Conversation list

const others = (t) => (t.participants || []).filter((p) => p.matricule !== state.officer.matricule).map(label).join(", ");

const matchesStatus = (t) => {
  if (state.type !== "civil") return true;
  switch (state.status) {
    case "all": return true;
    case "closed": return t.status === "closed";
    case "mine": return t.status === "open" && t.assignee?.matricule === state.officer.matricule;
    case "unassigned": return t.status === "open" && !t.assignee;
    default: return t.status === "open";
  }
};

const visible = () =>
  state.threads.filter((t) =>
    t.type === state.type && matchesStatus(t) &&
    (!state.search || [t.subject, t.civilName, t.preview, others(t), t.assignee?.name].join(" ").toLowerCase().includes(state.search)));

const renderCounts = () => {
  ["civil", "internal"].forEach((type) => {
    const n = state.threads.filter((t) => t.type === type && t.unread).length;
    $(`#count-${type}`).textContent = n ? String(n) : "";
  });
};

const renderList = () => {
  const list = visible();
  const root = $("#list");
  if (!list.length) {
    const msg = state.search ? "Aucun résultat." : state.type === "civil" ? "Aucune demande dans cette catégorie." : "Aucune conversation. Lancez-en une avec « Nouveau message ».";
    root.replaceChildren(el("li", { className: "empty", textContent: msg }));
    return;
  }
  root.replaceChildren(...list.map((t) => {
    const sub = t.type === "civil"
      ? `${t.appointment ? `RDV ${t.appointment.date.split("-").reverse().join("/")} ${t.appointment.slot.toLowerCase()}` : t.category} — ${t.civilName} — ${t.assignee ? `Agent : ${label(t.assignee)}` : "Sans agent"}`
      : others(t);
    const button = el("button", { type: "button", className: `app-item${t.unread ? " is-unread" : ""}` },
      el("span", { className: "app-item__name", textContent: t.subject }),
      el("time", { className: "app-item__time", textContent: fmt(t.updatedAt) }),
      el("span", { className: "app-item__meta" },
        t.priority === "haute" ? el("span", { className: "badge badge--refused", textContent: "Haute" }) : null, sub),
      el("span", { className: "app-item__preview", textContent: `${t.lastFrom} : ${t.preview}` }));
    button.setAttribute("aria-current", String(t.id === state.selected));
    if (t.unread) button.setAttribute("aria-label", `Non lu : ${t.subject}`);
    button.addEventListener("click", () => openThread(t.id));
    return el("li", {}, button);
  }));
};

// --- Conversation detail

const messageItem = (m) => {
  const mine = m.officer?.matricule === state.officer.matricule;
  const author = m.from === "civil" ? state.detail.civil.name : mine ? "Vous" : `${label(m.officer)} (${m.officer.matricule})`;
  return el("li", { className: `msg msg--${m.from}${mine ? " msg--mine" : ""}` },
    el("p", { className: "msg__author", textContent: author }),
    el("p", { className: "msg__body", textContent: m.body }),
    el("time", { className: "msg__time", textContent: fmt(m.createdAt) }));
};

const textForm = ({ id, placeholder, button, onSubmit, rows = 3 }) => {
  const form = el("form", { className: "composer", noValidate: true },
    el("label", { className: "sr-only", htmlFor: id, textContent: placeholder }),
    el("textarea", { id, rows, maxLength: 4000, placeholder }),
    el("button", { type: "submit", className: "btn btn--primary", textContent: button }));
  const textarea = form.querySelector("textarea");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = textarea.value.trim();
    if (!body) return textarea.focus();
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      await onSubmit(body);
      textarea.value = "";
    } catch (err) {
      fail(err);
    } finally {
      submit.disabled = false;
    }
  });
  textarea.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
  return form;
};

const patchThread = async (id, changes, success) => {
  try {
    applyDetail(await api("PATCH", `/api/agent/threads/${id}`, changes));
    toast(success);
  } catch (err) {
    fail(err);
  }
};

// Management panel for civil requests: priority, assignee, status
const managePanel = (t) => {
  const closed = t.status === "closed";
  const priority = el("select", { id: "m-priority" },
    ...Object.entries(PRIORITY_LABELS).map(([value, text]) => el("option", { value, textContent: text, selected: t.priority === value })));
  priority.addEventListener("change", () => patchThread(t.id, { priority: priority.value }, "Priorité mise à jour."));

  const isMine = t.assignee?.matricule === state.officer.matricule;
  const assignMe = isMine ? null : el("button", { type: "button", className: "btn btn--outline btn--sm", textContent: "M'assigner" });
  assignMe?.addEventListener("click", () => patchThread(t.id, { assignee: state.officer.matricule }, "Demande assignée à vous."));
  const unassign = t.assignee ? el("button", { type: "button", className: "btn btn--ghost btn--sm", textContent: "Retirer" }) : null;
  unassign?.addEventListener("click", () => patchThread(t.id, { assignee: null }, "Assignation retirée."));

  const other = el("form", { className: "manage__assign", noValidate: true },
    el("label", { className: "sr-only", htmlFor: "m-assign", textContent: "Assigner à un matricule" }),
    el("input", { id: "m-assign", placeholder: "Matricule", autocomplete: "off" }),
    el("button", { type: "submit", className: "btn btn--ghost btn--sm", textContent: "Assigner" }));
  other.addEventListener("submit", (e) => {
    e.preventDefault();
    const mat = other.querySelector("input").value.trim();
    if (mat) patchThread(t.id, { assignee: mat }, `Demande assignée au matricule ${mat}.`);
  });

  const status = el("button", { type: "button", className: `btn btn--sm ${closed ? "btn--outline" : "btn--danger"}`, textContent: closed ? "Rouvrir la demande" : "Clôturer la demande" });
  status.addEventListener("click", () => patchThread(t.id, { status: closed ? "open" : "closed" }, closed ? "Demande rouverte." : "Demande clôturée."));

  return el("div", { className: "manage" },
    el("div", { className: "manage__item" }, el("label", { htmlFor: "m-priority", textContent: "Priorité" }), priority),
    el("div", { className: "manage__item manage__item--wide" },
      el("span", { className: "manage__label", textContent: "Agent assigné" }),
      el("span", { className: "manage__value", textContent: t.assignee ? `${label(t.assignee)} (${t.assignee.matricule})` : "Personne" }),
      el("span", { className: "manage__actions" }, assignMe, unassign, other)),
    el("div", { className: "manage__item" }, status));
};

const renderDetail = () => {
  const root = $("#detail");
  const t = state.detail;
  if (!t || t.type !== state.type) {
    root.replaceChildren(el("p", { className: "empty", textContent: "Sélectionnez une conversation." }));
    return;
  }

  const isCivil = t.type === "civil";
  const closed = isCivil && t.status === "closed";
  const meta = isCivil
    ? el("p", { className: "convo__meta" },
        el("span", { className: `tag tag--${t.category.toLowerCase()}`, textContent: t.category }),
        el("span", { className: `badge badge--${closed ? "draft" : "pending"}`, textContent: closed ? "Clôturée" : "Ouverte" }),
        `De ${t.civil.name}`, t.civil.contact ? ` — Contact : ${t.civil.contact}` : "")
    : el("p", { className: "convo__meta", textContent: `Participants : ${t.participants.map((p) => `${label(p)} (${p.matricule})`).join(", ")}` });

  const thread = el("ol", { className: "thread", ariaLabel: "Messages" }, ...t.messages.map(messageItem));
  const reply = closed
    ? el("p", { className: "notice", textContent: "Demande clôturée. Rouvrez-la pour répondre." })
    : textForm({
        id: "reply-body", button: "Envoyer",
        placeholder: isCivil ? "Répondre au civil… (Ctrl+Entrée pour envoyer)" : "Écrire un message… (Ctrl+Entrée pour envoyer)",
        onSubmit: async (body) => {
          applyDetail(await api("POST", `/api/agent/threads/${t.id}/messages`, { body }));
          $("#reply-body")?.focus();
        },
      });

  let internal = null;
  if (isCivil) {
    const notes = t.notes.length
      ? el("ul", { className: "inotes" }, ...t.notes.map((n) => el("li", {},
          el("p", { className: "inotes__meta", textContent: `${label(n.officer)} (${n.officer.matricule}) — ${fmt(n.createdAt)}` }),
          el("p", { className: "longtext", textContent: n.body }))))
      : el("p", { className: "hint", textContent: "Aucune note. Les notes ne sont jamais visibles par le civil." });
    const history = el("details", { className: "history" },
      el("summary", { textContent: `Historique (${t.history.length})` }),
      el("ol", {}, ...[...t.history].reverse().map((h) => el("li", {}, el("time", { textContent: fmt(h.at) }), ` ${h.by} — ${h.action}`))));
    internal = el("section", { className: "internal", ariaLabel: "Suivi interne" },
      el("h3", { textContent: "Notes internes" }),
      notes,
      textForm({
        id: "note-body", button: "Ajouter", rows: 2, placeholder: "Ajouter une note interne (non visible par le civil)",
        onSubmit: async (body) => {
          applyDetail(await api("POST", `/api/agent/threads/${t.id}/notes`, { body }));
          toast("Note ajoutée.");
        },
      }),
      history);
  }

  root.replaceChildren(
    el("header", { className: "convo__head" }, el("div", {}, el("h2", { textContent: t.subject }), meta)),
    t.appointment
      ? el("p", { className: "appt" }, el("strong", { textContent: "Rendez-vous souhaité : " }), apptText(t.appointment),
          el("span", { className: "appt__hint", textContent: "Confirmez-le ou proposez un autre horaire en répondant au civil." }))
      : null,
    isCivil ? managePanel(t) : null,
    thread,
    reply,
    internal);
  thread.scrollTop = thread.scrollHeight;
};

// --- Compose internal message

const compose = $("#compose");
const composeForm = $("#compose-form");
const fields = composeForm.elements;

$("#new-message").addEventListener("click", () => {
  composeForm.reset();
  showFieldErrors(composeForm, null);
  $("#c-to-hint").textContent = "Les matricules sont vérifiés dans le MDT.";
  compose.showModal();
  fields.to.focus();
});
$("#compose-cancel").addEventListener("click", () => compose.close());

// Show who the matricules belong to before sending
fields.to.addEventListener("change", async () => {
  const mats = fields.to.value.split(/[,;\s]+/).filter(Boolean);
  if (!mats.length) return;
  const names = await Promise.all(mats.map((m) => api("GET", `/api/agent/officers/${encodeURIComponent(m)}`).then(label, () => `${m} (inconnu)`)));
  $("#c-to-hint").textContent = `Destinataires : ${names.join(", ")}`;
});

composeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = composeForm.querySelector("[type=submit]");
  button.disabled = true;
  try {
    const thread = await api("POST", "/api/agent/threads", {
      to: fields.to.value.split(/[,;\s]+/).filter(Boolean), subject: fields.subject.value, body: fields.body.value,
    });
    compose.close();
    toast("Message envoyé.");
    await refresh();
    await openThread(thread.id);
  } catch (err) {
    showFieldErrors(composeForm, err);
  } finally {
    button.disabled = false;
  }
});

// --- Boot

api("GET", "/api/agent/session")
  .then(({ authenticated, officer, mdtUrl }) => (authenticated ? showApp(officer, mdtUrl) : showLogin()))
  .catch((err) => { showLogin(); $("#login-alert").textContent = err.message; });
