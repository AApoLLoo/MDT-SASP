import { toast } from '../dom.js';
import { absoluteUrl } from './discord.js';

// Google Docs ne peut pas télécharger les images d'un MDT local ou réservé aux agents :
// on les intègre en data URI (JPEG, 1000 px max pour garder un presse-papiers léger).
async function inlineImage(src, dst, width) {
  try {
    if (!src.complete) await src.decode();
    if (!src.naturalWidth) throw new Error('image non chargée');
    const scale = Math.min(1, 1000 / src.naturalWidth);
    const canvas = Object.assign(document.createElement('canvas'), {
      width: Math.round(src.naturalWidth * scale), height: Math.round(src.naturalHeight * scale),
    });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // le JPEG n'a pas de transparence : fond blanc sous le sceau et la bannière
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    dst.src = canvas.toDataURL('image/jpeg', 0.85);
    dst.height = Math.round(width * src.naturalHeight / src.naturalWidth);
  } catch (err) {
    console.warn('Image non intégrée à la copie Google Docs, lien conservé :', src.src, err);
    dst.src = absoluteUrl(src.getAttribute('src'));
  }
  dst.width = width;
}

// Remplace un bloc en grille par un tableau d'une ligne (Google Docs ignore grid/flex)
function gridToTable(grid, cells, fill) {
  const row = document.createElement('table').insertRow();
  cells.forEach(c => fill(row.insertCell(), c));
  grid.replaceWith(row.closest('table'));
}

// Google Docs ignore les classes CSS au collage : on clone le document .paper affiché
// et on pose en ligne bordures, tailles d'images et retours à la ligne.
async function docsHtml(article) {
  const doc = article.cloneNode(true);
  const originals = [...article.querySelectorAll('img')];
  await Promise.all([...doc.querySelectorAll('img')].map((img, i) => inlineImage(originals[i], img,
    img.classList.contains('paper-banner') ? 500 : img.closest('.seal-cell') ? 80 : 150)));
  doc.querySelectorAll('.paper-photos').forEach(grid => gridToTable(grid, grid.querySelectorAll('figure'), (cell, fig) => {
    fig.querySelector('img').after(document.createElement('br')); // légende sous l'image
    cell.style.textAlign = 'center';
    cell.append(...fig.childNodes);
  }));
  doc.querySelectorAll('.paper-signatures').forEach(grid => gridToTable(grid, grid.querySelectorAll(':scope > div'), (cell, d) => {
    // Lignes vides : place pour signer
    cell.append(d.textContent, document.createElement('br'), document.createElement('br'), document.createElement('br'));
  }));
  doc.querySelectorAll('a').forEach(a => a.replaceWith(a.textContent));
  doc.querySelectorAll('table').forEach(t => { t.style.borderCollapse = 'collapse'; t.style.width = '100%'; });
  doc.querySelectorAll('td, th').forEach(c => Object.assign(c.style, { border: '1px solid #9ca3af', padding: '4px 6px', verticalAlign: 'top' }));
  doc.querySelectorAll('.paper-table th').forEach(th => { th.style.textAlign = 'left'; });
  // 9 colonnes sur une page A4 : police réduite pour que les en-têtes ne se coupent pas
  doc.querySelectorAll('.paper-calc th, .paper-calc td').forEach(c => { c.style.fontSize = '8pt'; });
  doc.querySelectorAll('.paper-title, .paper-sub, .seal-cell, .paper-banner').forEach(el => { el.style.textAlign = 'center'; });
  doc.querySelectorAll('.paper-text').forEach(el => { el.innerHTML = el.innerHTML.replace(/\n/g, '<br>'); });
  doc.querySelectorAll('.paper-totals > div').forEach(d => {
    d.querySelector('span').append(' : ');
    const small = d.querySelector('small');
    if (small && small.textContent.trim() === d.querySelector('strong').textContent.trim()) small.remove();
    else small?.replaceChildren(` (${small.textContent})`);
  });
  doc.querySelector('.paper-foot span')?.append(' · ');
  return `<meta charset="utf-8">${doc.outerHTML}`;
}

// Copie le document mis en forme puis ouvre un Google Doc vierge où le coller
export async function copyForDocs(article) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    toast('Copie mise en forme indisponible : le MDT doit être ouvert en HTTPS (ou sur localhost).', 'error');
    return;
  }
  try {
    // Contenu passé en promesse : le presse-papiers est réservé pendant le clic, le temps d'intégrer les images
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': docsHtml(article).then(h => new Blob([h], { type: 'text/html' })),
      'text/plain': new Blob([article.innerText], { type: 'text/plain' }),
    })]);
  } catch (err) {
    toast(`Copie impossible : ${err.message}`, 'error');
    return;
  }
  // Ouvert après la copie : le presse-papiers exige que la page ait le focus
  const tab = window.open('https://docs.new', '_blank');
  if (tab) tab.opener = null;
  toast(tab ? 'Document copié : collez-le (Ctrl+V) dans le nouveau Google Doc' : 'Document copié : ouvrez docs.new puis collez (Ctrl+V)', 'success', { duration: 6000 });
}
