import { html, mount, $, formValues, reducedMotion } from '../dom.js';
import { api, state } from '../api.js';

export function renderLogin(root, onSuccess) {
  mount(root, html`
    <div class="login-screen">
      <form class="login-card">
        <div class="lightbar"></div>
        <img src="img/sasp-banner.png" alt="San Andreas State Police" class="login-banner">
        <h1>Mobile Data Terminal</h1>
        <p class="muted">San Andreas State Police · accès réservé aux agents</p>
        <label class="field">Matricule<input class="input" name="matricule" required autocomplete="username" autofocus></label>
        <label class="field">Mot de passe<input class="input" name="password" type="password" required autocomplete="current-password"></label>
        <p class="form-error" hidden></p>
        <button class="btn btn-primary btn-block">Connexion</button>
        <ol class="boot-lines" aria-live="polite">
          <li>Identité vérifiée</li>
          <li>Connexion au réseau SASP</li>
          <li>Ouverture du terminal…</li>
        </ol>
      </form>
    </div>`);
  const form = $('form', root);
  const error = $('.form-error', root);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    error.hidden = true;
    e.submitter.disabled = true;
    try {
      state.user = (await api('/auth/login', { method: 'POST', body: formValues(form) })).user;
      // Séquence de démarrage (rampe, étapes) avant l'ouverture du terminal
      if (!reducedMotion()) {
        form.classList.add('is-booting');
        await new Promise(r => setTimeout(r, 1300));
      }
      await onSuccess();
    } catch (err) {
      form.classList.remove('is-booting');
      error.textContent = err.message;
      error.hidden = false;
      e.submitter.disabled = false;
    }
  });
}
