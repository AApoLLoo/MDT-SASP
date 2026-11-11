"use strict";

// Contact form (/contact) and request tracking (/suivi). Relies on window.saspForms from main.js.
// Civilian and officer messages are inserted with textContent only.

const forms = window.saspForms;
const CODE_KEY = "sasp-last-code";
const NETWORK_ERROR = "Connexion impossible. Vérifiez votre réseau puis réessayez.";
const fmt = (iso) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const fmtDay = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

// sessionStorage can throw (private mode, blocked storage): the code is still shown on screen, so failures are only logged.
const remember = (code) => {
  try { sessionStorage.setItem(CODE_KEY, code); } catch (err) { console.warn("sessionStorage indisponible :", err.message); }
};
const recall = () => {
  try {
    const code = sessionStorage.getItem(CODE_KEY);
    sessionStorage.removeItem(CODE_KEY);
    return code;
  } catch (err) {
    console.warn("sessionStorage indisponible :", err.message);
    return null;
  }
};


// --- /contact
const ticketForm = document.getElementById("ticket-form");
if (ticketForm) {
  const alertBox = ticketForm.querySelector(".form__alert");
  const submit = ticketForm.querySelector("[type=submit]");
  forms.watchFields(ticketForm);

  const preset = new URLSearchParams(location.search).get("type");
  const presetInput = [...ticketForm.elements.category].find((r) => r.value === preset);
  if (presetInput) presetInput.checked = true;

  // Appointment fields only exist for "Rendez-vous": a disabled fieldset is neither validated nor submitted.
  const appointment = document.getElementById("appointment");
  const dateInput = document.getElementById("t-date");
  const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  dateInput.min = isoDay(0);
  dateInput.max = isoDay(60);
  const syncAppointment = () => {
    const show = ticketForm.elements.category.value === "Rendez-vous";
    appointment.hidden = !show;
    appointment.disabled = !show;
    dateInput.required = show;
    ticketForm.querySelector('input[name="appointmentSlot"]').required = show;
  };
  ticketForm.addEventListener("change", (e) => { if (e.target.name === "category") syncAppointment(); });
  syncAppointment();

  ticketForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    alertBox.textContent = "";
    if (!forms.validateFields(ticketForm)) return;
    submit.disabled = true;
    submit.textContent = "Envoi en cours…";
    try {
      const { code } = await forms.postJson("/api/tickets", Object.fromEntries(new FormData(ticketForm)));
      remember(code);
      ticketForm.hidden = true;
      document.querySelector(".notice--alert").hidden = true;
      document.getElementById("receipt-code").textContent = code;
      const receipt = document.getElementById("receipt");
      receipt.hidden = false;
      receipt.focus();
    } catch (err) {
      if (err.errors) forms.showServerErrors(ticketForm, err.errors);
      alertBox.textContent = err.status ? err.message : NETWORK_ERROR;
    } finally {
      submit.disabled = false;
      submit.textContent = "Envoyer ma demande";
    }
  });

  document.getElementById("copy-code").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(document.getElementById("receipt-code").textContent);
      e.target.textContent = "Code copié";
    } catch {
      e.target.textContent = "Copie impossible, notez-le à la main";
    }
  });
}

// --- /suivi
const lookupForm = document.getElementById("lookup-form");
if (lookupForm) {
  const ticket = document.getElementById("ticket");
  const replyForm = document.getElementById("reply-form");
  const replyAlert = replyForm.querySelector(".form__alert");
  const codeInput = lookupForm.elements.code;
  let currentCode = null; // kept in memory only, never in the URL

  const render = (t) => {
    document.getElementById("ticket-subject").textContent = t.subject;
    const status = Object.assign(document.createElement("span"), {
      className: `badge badge--${t.status === "open" ? "pending" : "draft"}`,
      textContent: t.status === "open" ? "En cours" : "Clôturée",
    });
    const cat = Object.assign(document.createElement("span"), { className: `tag tag--${t.category.toLowerCase()}`, textContent: t.category });
    document.getElementById("ticket-meta").replaceChildren(cat, status, `Ouverte le ${fmt(t.createdAt)}`,
      t.appointment ? ` — Rendez-vous souhaité : ${fmtDay(t.appointment.date)}, ${t.appointment.slot.toLowerCase()}` : "");

    document.getElementById("ticket-thread").replaceChildren(...t.messages.map((m) => {
      const li = document.createElement("li");
      li.className = `msg msg--${m.from}`;
      li.append(
        Object.assign(document.createElement("p"), { className: "msg__author", textContent: m.author }),
        Object.assign(document.createElement("p"), { className: "msg__body", textContent: m.body }),
        Object.assign(document.createElement("time"), { className: "msg__time", textContent: fmt(m.createdAt) }));
      return li;
    }));

    const closed = t.status === "closed";
    document.getElementById("ticket-closed").hidden = !closed;
    replyForm.hidden = closed;
    lookupForm.hidden = true;
    ticket.hidden = false;
  };

  const lookup = async (code) => {
    const alert = lookupForm.querySelector(".error");
    const field = lookupForm.querySelector(".field");
    try {
      render(await forms.postJson("/api/tickets/lookup", { code }));
      currentCode = code;
      document.getElementById("ticket-subject").focus?.();
    } catch (err) {
      field.classList.add("is-invalid");
      alert.textContent = err.status ? err.message : NETWORK_ERROR;
      codeInput.focus();
    }
  };

  lookupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!forms.validateFields(lookupForm)) return;
    lookup(codeInput.value.trim());
  });

  replyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    replyAlert.textContent = "";
    const body = replyForm.elements.body.value.trim();
    if (!body) { replyAlert.textContent = "Écrivez un message avant d'envoyer."; return; }
    const button = replyForm.querySelector("[type=submit]");
    button.disabled = true;
    try {
      render(await forms.postJson("/api/tickets/reply", { code: currentCode, body }));
      replyForm.reset();
    } catch (err) {
      replyAlert.textContent = err.status ? err.message : NETWORK_ERROR;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("ticket-close-view").addEventListener("click", () => {
    currentCode = null;
    ticket.hidden = true;
    lookupForm.hidden = false;
    lookupForm.reset();
    codeInput.focus();
  });

  const saved = recall();
  if (saved) {
    codeInput.value = saved;
    lookup(saved);
  }
}
