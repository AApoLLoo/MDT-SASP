"use strict";

// Photo picker shared by the news editor (admin) and the service-note editor (agent space).
// The file is uploaded as soon as it is chosen; the form only keeps the returned URL in a hidden input.
const PHOTO_MAX_BYTES = 3 * 1024 * 1024;

const setupPhotoField = (field, onChange = () => {}) => {
  const kind = field.dataset.kind;
  const fileInput = field.querySelector('input[type="file"]');
  const hidden = field.querySelector('input[type="hidden"]');
  const preview = field.querySelector(".photo__preview");
  const removeBtn = field.querySelector(".photo__remove");
  const pickText = field.querySelector(".photo__pick-text");
  const error = field.querySelector(".error");

  const showError = (message) => {
    field.classList.toggle("is-invalid", Boolean(message));
    error.textContent = message || "";
  };

  const set = (url) => {
    hidden.value = url || "";
    preview.hidden = !url;
    if (url) preview.src = url;
    else preview.removeAttribute("src");
    removeBtn.hidden = !url;
    pickText.textContent = url ? "Changer de photo" : "Choisir une photo";
    onChange(Boolean(url));
  };

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    showError("");
    if (file.size > PHOTO_MAX_BYTES) return showError("Photo trop lourde : 3 Mo maximum.");
    pickText.textContent = "Envoi en cours…";
    try {
      const res = await fetch(`/api/uploads?kind=${kind}`, {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": file.type || "application/octet-stream" }, body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Envoi impossible (erreur ${res.status}).`);
      set(data.url);
    } catch (err) {
      showError(err instanceof TypeError ? "Serveur injoignable. Vérifiez votre connexion." : err.message);
      set(hidden.value);
    }
  });
  removeBtn.addEventListener("click", () => set(null));

  return { set, get: () => hidden.value || null, reset: () => { showError(""); set(null); } };
};
