// Mode sombre : choix mémorisé (localStorage), sinon réglage du système. Chargé sans defer dans <head>
// pour poser data-theme avant le premier affichage. Les boutons [data-theme-toggle] basculent le thème.
(() => {
  const KEY = "sasp-theme";
  const root = document.documentElement;
  const system = matchMedia("(prefers-color-scheme: dark)");
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  let choice = read();

  const apply = () => {
    const dark = choice ? choice === "dark" : system.matches;
    root.dataset.theme = dark ? "dark" : "light";
    document.querySelectorAll("[data-theme-toggle]").forEach((b) => b.setAttribute("aria-pressed", String(dark)));
  };

  apply();
  system.addEventListener("change", apply);
  // Même choix dans tous les onglets du site
  addEventListener("storage", (e) => { if (e.key === KEY) { choice = e.newValue; apply(); } });
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.addEventListener("click", (e) => {
      if (!e.target.closest("[data-theme-toggle]")) return;
      choice = root.dataset.theme === "dark" ? "light" : "dark";
      try { localStorage.setItem(KEY, choice); } catch { /* choix gardé pour cette page seulement */ }
      apply();
    });
  });
})();
