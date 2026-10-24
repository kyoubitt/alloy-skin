// Alloy skin: small fixes on top of Alloy's own UI.
//  - plain layout names (Alloy calls its new look "XMCL")
//  - hides the Play time card
//  - calmer wheel scrolling: one even step per notch (a short glide when Alloy's Smooth scrolling is on),
//    and a scroll that starts inside a box (log, mod list) stays in that box
(() => {
  if (window.__alloySkin) return;
  window.__alloySkin = true;
  const T = window.__TAURI_INTERNALS__;

  // ---------- names ----------

  const RENAMES = [
    [/\bthe XMCL restyle\b/g, 'the redesign'],
    [/\bXMCL[- ]style\b/gi, 'modern'],
    [/\bXMCL home\b/g, 'card home'],
    [/\bXMCL\b/g, 'Modern'],
  ];
  function rename(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.includes('XMCL') ? 1 : 3) });
    for (let n; (n = walker.nextNode()); ) {
      let v = n.nodeValue;
      for (const [re, to] of RENAMES) v = v.replace(re, to);
      n.nodeValue = v;
    }
  }

  // ---------- Play time card (CSS can't match a card by its title) ----------

  function tagPlaytime(root) {
    for (const h of root.querySelectorAll?.('section.card h3') ?? []) {
      if (h.textContent.trim() === 'Play time') h.closest('section.card').classList.add('skin-playtime');
    }
  }

  // ---------- settings ----------

  // Alloy's home card arrangement: while it's still the default (nothing arranged), the cards fit their contents.
  // Re-read after clicks on the page so arranging cards switches this off straight away.
  const readSettings = () => T?.invoke('get_settings').then((s) => {
    if (s && Array.isArray(s.homeCards)) document.documentElement.classList.toggle('skin-fit', s.homeCards.length === 0);
  }).catch(() => {});
  readSettings();
  let reread;
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('main')) { clearTimeout(reread); reread = setTimeout(readSettings, 800); }
  }, true);

  // ---------- no sideways page scroll ----------

  // the screenshot carousel scrolls itself into view, which also slid the whole page sideways; put it back
  document.addEventListener('scroll', (e) => {
    const t = e.target;
    if (t.scrollLeft && t.matches?.('main, .shell, .shell > .body')) t.scrollLeft = 0;
  }, true);

  // ---------- wiring ----------

  // only what was just added is checked, so a streaming log doesn't make the whole page get re-read
  new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) {
        if (n.nodeType === 3 ? n.nodeValue.includes('XMCL') : n.nodeType === 1 && n.textContent.includes('XMCL')) rename(n.nodeType === 3 ? n.parentNode : n);
        if (n.nodeType === 1 && n.tagName !== "SPAN") tagPlaytime(n);
      }
  }).observe(document.documentElement, { childList: true, subtree: true });
  rename(document.body);
  tagPlaytime(document);
})();
