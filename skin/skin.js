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

  // ---------- wheel ----------

  // Alloy's Appearance → Smooth scrolling; read once, then kept in sync when it's flipped
  let smooth = true;
  for (const cmd of ['get_settings', 'load_settings', 'settings']) {
    T?.invoke(cmd).then((s) => { if (s && typeof s.smoothScrolling === 'boolean') smooth = s.smoothScrolling; }).catch(() => {});
  }
  document.addEventListener('click', (e) => {
    const row = e.target.closest?.('.row, label');
    if (row && /smooth scrolling/i.test(row.textContent)) setTimeout(() => { const box = row.querySelector('input[type=checkbox]'); if (box) smooth = box.checked; }, 0);
  }, true);

  const STEP = 90; // px per wheel notch on the page; boxes inside the page move a bit less
  const pageScroller = () => document.querySelector('main');
  function scrollableAncestor(el) {
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollHeight <= el.clientHeight + 1) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return el;
    }
    return null;
  }

  const glides = new Map(); // element -> { target, from, start }
  function glide(box, dy) {
    const max = box.scrollHeight - box.clientHeight;
    const g = glides.get(box);
    const target = Math.max(0, Math.min(max, (g ? g.target : box.scrollTop) + dy));
    const state = { target, from: box.scrollTop, start: performance.now() };
    glides.set(box, state);
    if (g) return; // the running animation picks up the new target
    const frame = (now) => {
      const s = glides.get(box);
      if (!s) return;
      const t = Math.min(1, (now - s.start) / 110);
      box.scrollTop = s.from + (s.target - s.from) * (1 - (1 - t) ** 3);
      if (t < 1) requestAnimationFrame(frame);
      else glides.delete(box);
    };
    requestAnimationFrame(frame);
  }

  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.target.closest?.('select, input[type=range], canvas')) return; // the skin viewer zooms with the wheel
    const box = scrollableAncestor(e.target);
    if (!box) return;
    const inner = box !== pageScroller() && box !== document.scrollingElement;
    const notch = Math.abs(e.deltaY) >= 50 || e.deltaMode !== 0;
    // touchpads send many small deltas: pass them through as they are
    let dy = notch ? Math.sign(e.deltaY) * STEP * (inner ? 0.7 : 1) : e.deltaY;
    e.preventDefault();
    if (smooth && notch) glide(box, dy);
    else { glides.delete(box); box.scrollTop += dy; }
  }, { passive: false });

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
