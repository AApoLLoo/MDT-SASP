"use strict";

// --- Mobile menu
const toggle = document.querySelector(".menu-toggle");
const nav = document.getElementById("nav");
const setMenu = (open) => {
  nav.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", String(open));
};
toggle.addEventListener("click", () => setMenu(!nav.classList.contains("is-open")));
nav.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

// Highlight the current page in the nav (in-page anchors like /#divisions are skipped)
nav.querySelectorAll("a").forEach((a, i) => {
  a.style.setProperty("--i", i); // stagger of the mobile menu
  if (a.hash) return;
  const current = a.pathname === "/" ? location.pathname === "/" : location.pathname.startsWith(a.pathname);
  if (current) a.setAttribute("aria-current", "page");
});

// --- Motion. Everything below is decoration: skipped when the user asks for reduced motion.
// Styles go through CSSOM (style.setProperty), which the page's CSP allows, never through style="" attributes.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

// Header turns to glass once the page scrolls
const topbar = document.getElementById("topbar");
const onScroll = () => topbar.classList.toggle("is-scrolled", scrollY > 24);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Desktop nav: a pill slides under the hovered or focused link
const navInner = nav.querySelector(".nav__inner");
const pill = Object.assign(document.createElement("span"), { className: "nav__pill" });
pill.setAttribute("aria-hidden", "true");
navInner.append(pill);
const pillTo = (a) => {
  navInner.classList.toggle("has-pill", Boolean(a));
  if (!a) return;
  pill.style.setProperty("--x", `${a.offsetLeft}px`);
  pill.style.setProperty("--w", `${a.offsetWidth}px`);
};
navInner.addEventListener("pointerover", (e) => pillTo(e.target.closest("a")));
navInner.addEventListener("pointerleave", () => pillTo(null));
navInner.addEventListener("focusin", (e) => pillTo(e.target.closest("a")));
navInner.addEventListener("focusout", () => pillTo(null));

if (!reduceMotion) {
  // Titles rise word by word through a mask
  document.querySelectorAll(".hero__title, .page-hero h1").forEach((title) => {
    let i = 0;
    const split = (node) => [...node.childNodes].forEach((n) => {
      if (n.nodeType === Node.ELEMENT_NODE) return split(n);
      if (n.nodeType !== Node.TEXT_NODE || !n.textContent.trim()) return;
      const frag = document.createDocumentFragment();
      n.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (!part.trim()) return frag.append(part);
        const word = Object.assign(document.createElement("span"), { className: "w" });
        const inner = Object.assign(document.createElement("span"), { className: "w__in", textContent: part });
        inner.style.setProperty("--i", i++);
        word.append(inner);
        frag.append(word);
      });
      n.replaceWith(frag);
    });
    split(title);
    title.classList.add("is-split");
  });

  // Text scramble, then count-up for key figures, when they come into view
  const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const animate = (duration, frame) => {
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      frame(p);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const scramble = (el) => {
    const text = el.textContent;
    animate(1100, (p) => {
      const fixed = Math.floor(p * text.length);
      el.textContent = [...text].map((c, i) => (i < fixed || c === "-" || c === " " ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join("");
    });
  };
  const countUp = (el) => {
    const m = el.textContent.match(/^(\d+)(.*)$/s);
    if (!m) return;
    animate(1000, (p) => { el.textContent = Math.round(Number(m[1]) * (1 - (1 - p) ** 3)) + m[2]; });
  };
  const onView = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    onView.unobserve(entry.target);
    (entry.target.matches("[data-scramble]") ? scramble : countUp)(entry.target);
  }), { threshold: 0.6 });
  document.querySelectorAll("[data-scramble], .facts strong").forEach((el) => onView.observe(el));
}

if (!reduceMotion && finePointer) {
  // Cursor spotlight on rows and cards
  const SPOT = ".task, .post, .headline, .division-list > div";
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.(SPOT);
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, { passive: true });

  // Magnetic buttons lean toward the pointer
  document.querySelectorAll("[data-magnetic]").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--tx", `${(e.clientX - r.left - r.width / 2) * 0.22}px`);
      el.style.setProperty("--ty", `${(e.clientY - r.top - r.height / 2) * 0.32}px`);
    });
    el.addEventListener("pointerleave", () => { el.style.removeProperty("--tx"); el.style.removeProperty("--ty"); });
  });

  // The badge tilts toward the pointer and catches the light
  const seal = document.querySelector("[data-tilt]");
  const hero = seal?.closest("section");
  if (hero) {
    const clamp = (v) => Math.max(-0.6, Math.min(0.6, v));
    hero.addEventListener("pointermove", (e) => {
      const r = seal.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width - 0.5);
      const y = clamp((e.clientY - r.top) / r.height - 0.5);
      seal.style.setProperty("--rx", `${(-y * 16).toFixed(2)}deg`);
      seal.style.setProperty("--ry", `${(x * 20).toFixed(2)}deg`);
      seal.style.setProperty("--sx", `${((x + 0.5) * 100).toFixed(1)}%`);
      seal.style.setProperty("--sy", `${((y + 0.5) * 100).toFixed(1)}%`);
    });
    hero.addEventListener("pointerleave", () => ["--rx", "--ry", "--sx", "--sy"].forEach((p) => seal.style.removeProperty(p)));
  }
}

// --- News filters (cards are rendered by the server)
const newsRoot = document.querySelector("[data-news]");
if (newsRoot) {
  const chips = [...document.querySelectorAll("[data-filter]")];
  const cards = [...newsRoot.querySelectorAll(".post")];
  const empty = Object.assign(document.createElement("p"), { className: "news__empty", textContent: "Aucune actualité dans cette catégorie pour le moment.", hidden: true });
  newsRoot.append(empty);

  chips.forEach((chip) => chip.addEventListener("click", () => {
    const cat = chip.dataset.filter;
    chips.forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    const shown = cards.filter((card) => {
      card.hidden = cat !== "Tout" && card.dataset.cat !== cat;
      card.classList.remove("post--featured");
      return !card.hidden;
    });
    shown[0]?.classList.add("post--featured");
    empty.hidden = shown.length > 0;
  }));
}

// --- Shared form helpers (also used by civil.js through window.saspForms)
// A field's data-required attribute overrides the "missing value" message.
const messageFor = (input) => {
  const v = input.validity;
  if (v.valueMissing) return input.closest(".field")?.dataset.required || "Ce champ est requis.";
  if (v.rangeUnderflow || v.rangeOverflow) return `L'âge doit être compris entre ${input.min} et ${input.max} ans.`;
  if (v.badInput) return "Entrez un nombre.";
  if (v.patternMismatch) return "Format invalide : minuscules, chiffres, « _ » et « . » uniquement.";
  if (v.tooShort) return `Encore ${input.minLength - input.value.length} caractères minimum.`;
  return input.validationMessage;
};

const setFieldError = (field, message) => {
  field.classList.toggle("is-invalid", Boolean(message));
  field.querySelector(".error").textContent = message || "";
};

const validateField = (field) => {
  const bad = [...field.querySelectorAll("input, textarea")].find((i) => i.willValidate && !i.checkValidity());
  setFieldError(field, bad ? messageFor(bad) : "");
  return !bad;
};

// Validates every .field in container, focuses the first invalid one.
const validateFields = (container) => {
  const fields = [...container.querySelectorAll(".field")];
  const results = fields.map(validateField);
  const firstBad = fields[results.indexOf(false)];
  firstBad?.querySelector("input, textarea")?.focus();
  return !firstBad;
};

const showServerErrors = (form, errors) =>
  Object.entries(errors).forEach(([name, message]) => {
    const field = form.querySelector(`[data-field="${name}"]`);
    if (field) setFieldError(field, message);
  });

// Live re-validation once a field has been flagged, and on blur when filled.
const watchFields = (form) => {
  form.addEventListener("input", (e) => {
    const field = e.target.closest(".field");
    if (field?.classList.contains("is-invalid")) validateField(field);
  });
  form.addEventListener("focusout", (e) => {
    const field = e.target.closest(".field");
    if (field && e.target.value && e.target.type !== "radio") validateField(field);
  });
};

const postJson = async (url, data) => {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Erreur ${res.status}. Réessayez.`), { status: res.status, errors: body.errors });
  return body;
};

window.saspForms = { validateField, validateFields, setFieldError, showServerErrors, watchFields, postJson };

// Live character counters: <span data-count-for="textarea-id">
document.querySelectorAll("[data-count-for]").forEach((counter) => {
  const input = document.getElementById(counter.dataset.countFor);
  input.addEventListener("input", () => { counter.textContent = input.value.length; });
});

// --- Application form (3 steps)
const form = document.getElementById("apply-form");
if (form) {
  const steps = [...form.querySelectorAll(".step")];
  const stepperItems = [...document.querySelectorAll("#stepper li")];
  const progressBar = document.getElementById("progress-bar");
  const btnPrev = document.getElementById("prev");
  const btnNext = document.getElementById("next");
  const btnSubmit = document.getElementById("submit");
  const alertBox = document.getElementById("form-alert");
  let current = 0;

  const validateStep = (index) => validateFields(steps[index]);

  const showStep = (index) => {
    current = index;
    steps.forEach((s, i) => s.classList.toggle("is-active", i === index));
    stepperItems.forEach((li, i) => {
      li.classList.toggle("is-active", i === index);
      li.classList.toggle("is-done", i < index);
    });
    progressBar.style.width = `${((index + 1) / steps.length) * 100}%`;
    btnPrev.hidden = index === 0;
    btnNext.hidden = index === steps.length - 1;
    btnSubmit.hidden = index !== steps.length - 1;
    steps[index].querySelector("input, textarea")?.focus({ preventScroll: true });
  };

  btnNext.addEventListener("click", () => { if (validateStep(current)) showStep(current + 1); });
  btnPrev.addEventListener("click", () => showStep(current - 1));

  watchFields(form);
  // Enter in a text input moves to the next step instead of submitting early
  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT" && current < steps.length - 1) {
      e.preventDefault();
      btnNext.click();
    }
  });


  // Server-side errors: flag each field and jump to the first step that has one
  const showStepErrors = (errors) => {
    showServerErrors(form, errors);
    const names = Object.keys(errors);
    const firstStep = steps.findIndex((s) => names.some((n) => s.querySelector(`[data-field="${n}"]`)));
    if (firstStep !== -1) showStep(firstStep);
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    alertBox.textContent = "";
    if (!validateStep(current)) return;

    const data = Object.fromEntries(new FormData(form));
    btnSubmit.disabled = true;
    btnSubmit.textContent = "Envoi en cours…";

    try {
      await postJson("/api/applications", data);
      form.hidden = true;
      document.getElementById("apply-head").hidden = true;
      const success = document.getElementById("success");
      success.hidden = false;
      success.focus();
    } catch (err) {
      if (err.errors) showStepErrors(err.errors);
      alertBox.textContent = err.status ? err.message : "Connexion impossible. Vérifiez votre réseau puis réessayez : vos réponses sont conservées.";
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = "Envoyer ma candidature";
    }
  });
}
