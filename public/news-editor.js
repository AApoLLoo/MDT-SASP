"use strict";

// Full-page news editor. Content is a list of typed blocks; text is inserted with .value / textContent only.

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
};

const BLOCK_LABELS = { p: "Paragraphe", h2: "Intertitre", quote: "Citation", list: "Liste", image: "Photo", section: "Rubrique" };
const PLACEHOLDERS = {
  p: "Écrivez votre paragraphe…",
  h2: "Intertitre",
  quote: "Citation (ex. une déclaration du commandement)",
  list: "Un élément par ligne",
  section: "Nom de la rubrique (ex. Arrestations)",
};
// Starting layout of a new Journal edition; the blocks left empty are dropped on save
const JOURNAL_TEMPLATE = ["Arrestations", "Saisies", "Interventions", "Nouveautés au SASP", "Infos diverses"];
// Masthead of the very first edition; the next ones start from the previous edition's
const MASTHEAD_KEYS = ["kicker", "name", "slogan", "edition", "motto", "footer"];
const MASTHEAD_START = {
  kicker: "San Andreas State Police", name: "SASP TIP", slogan: "Votre source d'information officielle",
  motto: "Protéger\nServir\nSécuriser", footer: "Ensemble pour une ville plus sûre",
};

const state = { id: null, published: false, dirty: false, saving: false };

// --- Feedback

const toast = (message, kind = "ok") => {
  const t = $("#toast");
  t.textContent = message;
  t.className = `toast is-visible toast--${kind}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = "toast"; }, 3200);
};

const setStatus = () => {
  const label = state.dirty ? "Modifications non enregistrées" : state.id ? (state.published ? "Publié" : "Brouillon enregistré") : "Nouveau brouillon";
  $("#ed-status").textContent = label;
  $("#ed-status").classList.toggle("is-dirty", state.dirty);
  $("#ed-publish").textContent = state.published ? "Mettre à jour" : "Publier";
  $("#ed-draft").textContent = state.published ? "Dépublier" : "Enregistrer le brouillon";
};

const markDirty = () => {
  if (state.dirty) return;
  state.dirty = true;
  setStatus();
};

const showErrors = (errors = {}, message = "") => {
  document.querySelectorAll("[data-error]").forEach((p) => { p.textContent = errors[p.dataset.error] || ""; });
  const cover = $("#ed-cover .error");
  if (errors.image) cover.textContent = errors.image;
  $("#ed-alert").textContent = message;
  if (message) $("#ed-alert").scrollIntoView({ block: "center" });
};

const api = async (method, url, body) => {
  let res;
  try {
    res = await fetch(url, {
      method, credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Serveur injoignable. Vérifiez votre connexion : rien n'a été perdu, réessayez.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Erreur ${res.status}`), { status: res.status, errors: data.errors });
  return data;
};

// --- Auto-growing textareas

const autosize = (ta) => {
  ta.style.height = "auto";
  ta.style.height = `${ta.scrollHeight}px`;
};
document.addEventListener("input", (e) => {
  if (e.target.matches("textarea")) autosize(e.target);
  if (e.target.closest("#ed-canvas")) markDirty();
});
window.addEventListener("resize", () => document.querySelectorAll("#ed-canvas textarea").forEach(autosize));

// --- Blocks

const blocksRoot = $("#ed-blocks");
let lastText = null; // last focused text area inside a block, target of the toolbar

const photoFieldMarkup = (id) => {
  const field = el("div", { className: "field photo-field", id });
  field.dataset.kind = "public";
  field.append(
    el("div", { className: "photo" },
      el("img", { className: "photo__preview", alt: "Aperçu de la photo", hidden: true }),
      el("div", { className: "photo__actions" },
        el("label", { className: "btn btn--outline btn--sm photo__pick" },
          el("span", { className: "photo__pick-text", textContent: "Choisir une photo" }),
          el("input", { type: "file", accept: "image/jpeg,image/png,image/webp", className: "sr-only" })),
        el("button", { type: "button", className: "btn btn--ghost btn--sm photo__remove", textContent: "Retirer la photo", hidden: true })),
      el("input", { type: "hidden" })),
    el("p", { className: "error" }));
  return field;
};

let blockSeq = 0;

const createBlock = (block) => {
  const { type } = block;
  const li = el("li", { className: `ed-block ed-block--${type}` });
  li.dataset.type = type;
  const uid = `b${++blockSeq}`;

  const move = (dir) => {
    const sibling = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
    if (!sibling) return;
    if (dir < 0) sibling.before(li);
    else sibling.after(li);
    markDirty();
    li.querySelector("textarea, input, button")?.focus();
  };
  const controls = el("div", { className: "ed-block__controls" },
    el("span", { className: "ed-block__type", textContent: BLOCK_LABELS[type] }),
    el("button", { type: "button", className: "ed-icon", ariaLabel: "Monter le bloc", textContent: "↑", onclick: () => move(-1) }),
    el("button", { type: "button", className: "ed-icon", ariaLabel: "Descendre le bloc", textContent: "↓", onclick: () => move(1) }),
    el("button", {
      type: "button", className: "ed-icon ed-icon--danger", ariaLabel: "Supprimer le bloc", textContent: "✕",
      onclick: () => {
        const next = li.nextElementSibling || li.previousElementSibling;
        li.remove();
        markDirty();
        next?.querySelector("textarea, input")?.focus();
      },
    }));
  li.append(controls);

  if (type === "image") {
    const field = photoFieldMarkup(`${uid}-photo`);
    const alt = el("input", { className: "ed-input", id: `${uid}-alt`, maxLength: 150, placeholder: "Description de la photo (obligatoire)", value: block.alt || "" });
    const caption = el("input", { className: "ed-input ed-caption", id: `${uid}-caption`, maxLength: 200, placeholder: "Légende affichée sous la photo (facultatif)", value: block.caption || "" });
    li.append(field,
      el("label", { className: "sr-only", htmlFor: alt.id, textContent: "Description de la photo" }), alt,
      el("label", { className: "sr-only", htmlFor: caption.id, textContent: "Légende" }), caption);
    li.photo = setupPhotoField(field, () => markDirty());
    li.photo.set(block.image || null);
  } else {
    const ta = el("textarea", {
      className: `ed-text ed-text--${type}`, id: `${uid}-text`, rows: 1, placeholder: PLACEHOLDERS[type],
      value: type === "list" ? (block.items || []).join("\n") : block.text || "",
    });
    ta.addEventListener("focus", () => { lastText = ta; });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addBlock("p", li); }
      if (e.key.toLowerCase() === "b" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); wrapSelection(ta, "**", "**", "texte en gras"); }
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); insertLink(ta); }
    });
    li.append(el("label", { className: "sr-only", htmlFor: ta.id, textContent: BLOCK_LABELS[type] }), ta);
    requestAnimationFrame(() => autosize(ta));
  }
  return li;
};

const addBlock = (type, after) => {
  const li = createBlock({ type });
  if (after) after.after(li);
  else blocksRoot.append(li);
  markDirty();
  (li.querySelector("textarea") || li.querySelector(".photo__pick input"))?.focus();
  return li;
};

document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => addBlock(b.dataset.add)));

const readBlocks = () =>
  [...blocksRoot.children].map((li) => {
    const type = li.dataset.type;
    if (type === "image") {
      const [alt, caption] = li.querySelectorAll(".ed-input");
      return { type, image: li.photo.get(), alt: alt.value, caption: caption.value };
    }
    const text = li.querySelector("textarea").value;
    return type === "list" ? { type, items: text.split("\n") } : { type, text };
  });

// --- Inline formatting toolbar

const wrapSelection = (ta, before, after, fallback) => {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const selected = value.slice(s, e) || fallback;
  ta.setRangeText(`${before}${selected}${after}`, s, e, "end");
  ta.setSelectionRange(s + before.length, s + before.length + selected.length);
  ta.focus();
  autosize(ta);
  markDirty();
};

const insertLink = (ta) => {
  const url = prompt("Adresse du lien (doit commencer par https://)", "https://");
  if (url === null) return ta.focus();
  if (!/^https?:\/\/\S+$/.test(url.trim()) || /[()]/.test(url)) {
    toast("Adresse invalide : elle doit commencer par https:// et ne pas contenir d'espace ni de parenthèse.", "error");
    return ta.focus();
  }
  wrapSelection(ta, "[", `](${url.trim()})`, "texte du lien");
};

const needText = () => {
  if (lastText && document.contains(lastText)) return lastText;
  toast("Cliquez d'abord dans un bloc de texte.", "error");
  return null;
};
$("#ed-bold").addEventListener("click", () => { const ta = needText(); if (ta) wrapSelection(ta, "**", "**", "texte en gras"); });
$("#ed-link").addEventListener("click", () => { const ta = needText(); if (ta) insertLink(ta); });

// --- Journal

const isJournal = () => $("#ed-category").value === "Journal";
const syncJournal = () => document.querySelectorAll("[data-journal]").forEach((n) => { n.hidden = !isJournal(); });
const readMasthead = () => Object.fromEntries(MASTHEAD_KEYS.map((k) => [k, $(`#ed-m-${k}`).value]));
const fillMasthead = (m) => MASTHEAD_KEYS.forEach((k) => { $(`#ed-m-${k}`).value = m?.[k] || ""; });
$("#ed-category").addEventListener("change", async () => {
  syncJournal();
  if (!isJournal()) return;
  const empty = readBlocks().every((b) => (b.type === "image" ? !b.image : !(b.text ?? b.items.join("")).trim()));
  if (empty) blocksRoot.replaceChildren(...JOURNAL_TEMPLATE.flatMap((text) => [{ type: "section", text }, { type: "h2" }, { type: "p" }]).map(createBlock));
  if (Object.values(readMasthead()).some(Boolean)) return;
  const news = await api("GET", "/api/admin/news").catch(() => []);
  const previous = news.find((n) => n.category === "Journal" && n.id !== state.id && n.masthead);
  fillMasthead({ ...(previous?.masthead || MASTHEAD_START), edition: "" });
  document.querySelectorAll(".ed-masthead textarea").forEach(autosize);
});

// --- Cover photo

const cover = setupPhotoField($("#ed-cover"), (hasPhoto) => {
  $("#ed-cover-alt").hidden = !hasPhoto;
  markDirty();
});

// --- Load / save

const payload = (published) => ({
  title: $("#ed-title").value, category: $("#ed-category").value, date: $("#ed-date").value,
  excerpt: $("#ed-excerpt").value, image: cover.get(), imageAlt: $("#ed-image-alt").value,
  blocks: readBlocks(), masthead: readMasthead(), published,
});

const fill = (post) => {
  $("#ed-title").value = post.title;
  $("#ed-category").value = post.category;
  $("#ed-date").value = post.date;
  $("#ed-excerpt").value = post.excerpt;
  $("#ed-image-alt").value = post.imageAlt || "";
  cover.set(post.image || null);
  blocksRoot.replaceChildren(...post.blocks.map(createBlock));
  fillMasthead(post.masthead);
  syncJournal();
  Object.assign(state, { id: post.id, published: post.published, dirty: false });
  document.title = `${post.title} — Éditeur SASP`;
};

const save = async (published) => {
  if (state.saving) return null;
  state.saving = true;
  showErrors();
  document.querySelectorAll(".ed-bar button").forEach((b) => { b.disabled = true; });
  try {
    const body = payload(published);
    const post = state.id ? await api("PUT", `/api/admin/news/${state.id}`, body) : await api("POST", "/api/admin/news", body);
    Object.assign(state, { id: post.id, published: post.published, dirty: false });
    history.replaceState(null, "", `/admin/actualites/editer?id=${post.id}`);
    document.title = `${post.title} — Éditeur SASP`;
    return post;
  } catch (err) {
    if (err.status === 401 || err.status === 403) showErrors({}, "Votre session a expiré ou vous n'avez plus le droit de publier. Reconnectez-vous dans un autre onglet, puis réessayez : vos modifications sont toujours là.");
    else showErrors(err.errors, err.errors ? "Corrigez les éléments signalés en rouge." : err.message);
    return null;
  } finally {
    state.saving = false;
    document.querySelectorAll(".ed-bar button").forEach((b) => { b.disabled = false; });
    setStatus();
  }
};

$("#ed-publish").addEventListener("click", async () => {
  const wasPublished = state.published;
  const post = await save(true);
  if (post) toast(wasPublished ? "Actualité mise à jour." : "Actualité publiée sur le site.");
});
$("#ed-draft").addEventListener("click", async () => {
  if (state.published && !confirm("Retirer cette actualité du site ? Elle restera disponible en brouillon.")) return;
  const post = await save(false);
  if (post) toast("Brouillon enregistré. L'actualité n'est pas visible sur le site.");
});
$("#ed-preview").addEventListener("click", async () => {
  // The preview renders the saved version: save first (keeping the current published state)
  if (!state.id || state.dirty) {
    const post = await save(state.published);
    if (!post) return;
  }
  window.open(`/admin/apercu/${state.id}`, "_blank", "noopener");
});

window.addEventListener("beforeunload", (e) => {
  if (state.dirty) e.preventDefault();
});

// --- Boot

const boot = async () => {
  try {
    const { scopes } = await api("GET", "/api/admin/session");
    if (!scopes.includes("news")) {
      $("#ed-denied").hidden = false;
      document.querySelector(".ed-bar__actions").hidden = true;
      return;
    }
    $("#ed-canvas").hidden = false;
    const id = new URLSearchParams(location.search).get("id");
    if (id) {
      fill(await api("GET", `/api/admin/news/${encodeURIComponent(id)}`));
    } else {
      $("#ed-date").value = new Date().toISOString().slice(0, 10);
      blocksRoot.append(createBlock({ type: "p" }));
    }
    state.dirty = false;
    setStatus();
    document.querySelectorAll("#ed-canvas textarea").forEach(autosize);
    $("#ed-title").focus();
  } catch (err) {
    $("#ed-canvas").hidden = false;
    showErrors({}, err.status === 404 ? "Cette actualité n'existe plus." : err.message);
  }
};
boot();
