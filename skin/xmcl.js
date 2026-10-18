// Alloy skin extras, injected by ~/.local/lib/alloy-skin/alloyskin.so (after env.js).
//  - instance icons stacked in the left rail (click to open the instance)
//  - XMCL's stat strip under the instance title: Minecraft / loader / playtime / last played
//  - animated instance icons from small cached copies (made by alloy-skinned), still while unfocused
//  - animated backgrounds (GIF/video) pause while Alloy isn't the focused window
//  - background effects (Particles, or your own GIF/video) and icon animation options on the Appearance page
// Alloy's router is private to its bundle, so navigation goes through its own buttons.
(() => {
  const T = window.__TAURI_INTERNALS__;
  if (!T) return;
  const ENV = window.__XMCL_ENV || {};
  const html = document.documentElement;

  const LOADERS = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neo_forge: 'NeoForge', neoforge: 'NeoForge' };
  const ICONS = {
    cube: 'M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3L18.7 8 12 11.7 5.3 8 12 4.3zM5 9.7l6 3.3v6.6l-6-3.3V9.7zm8 9.9V13l6-3.3v6.6l-6 3.3z',
    loader: 'M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4c-1.1 0-1.99.9-1.99 2v3.8H3.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z',
    clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
    history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  };

  // ---------- preferences (Appearance → Background / Layout) ----------

  const PREFS_KEY = 'xmcl-skin';
  const prefs = { effect: 'none', icons: 'focused', smooth: 'off', speed: 'normal', pictureAccent: 'on', fxFile: '', fxBlend: 'screen', fxStrength: 0.6 };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch {}
  if (prefs.effect === 'halo') prefs.effect = 'none'; // Halo was removed
  // the loader turns WebKit's gliding wheel scroll off at start; this re-applies the user's choice live
  const applySmooth = () => window.webkit?.messageHandlers?.alloyskin?.postMessage('SMOOTH\n0').catch(() => {});
  function setPref(key, value) {
    prefs[key] = value;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
    if (key === 'smooth') applySmooth();
    applyState();
    renderSettings();
  }

  let instances = [];
  let running = new Set();
  let paused = false;

  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const slug = (id) => String(id).replace(/[^A-Za-z0-9]/g, '_');
  const asset = (path) => T.convertFileSrc(path, 'asset');

  function playtime(secs) {
    if (!secs) return '—';
    const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  }

  function lastPlayed(iso) {
    if (!iso) return 'Never';
    const d = new Date(iso), days = Math.floor((Date.now() - d) / 864e5);
    if (days === 0) return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days === 1) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(days > 300 ? { year: 'numeric' } : {}) });
  }

  // the name in the instance page header, or null when we're elsewhere
  function openInstanceName() {
    return document.querySelector('main.content header.head h1')?.textContent.trim() || null;
  }

  async function refresh() {
    try {
      instances = await T.invoke('list_instances');
      const r = await T.invoke('running_instances').catch(() => []);
      running = new Set((r || []).map((x) => (typeof x === 'string' ? x : x.id ?? x.instanceId)));
    } catch (e) {
      return;
    }
    update();
  }

  // ---------- instance icons ----------

  // one still frame, drawn once; shown whenever the animation is paused
  function drawStill(canvas, src) {
    const img = new Image();
    img.onload = () => {
      const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round((r.width || img.naturalWidth) * dpr);
      canvas.height = Math.round((r.height || img.naturalHeight) * dpr);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = src;
  }

  // icon markup: a still canvas plus, for animated icons, the small cached GIF.
  // CSS decides which one is visible; a hidden <img> doesn't animate, so a paused icon costs nothing.
  function iconMarkup(inst, cls) {
    if (!inst?.iconPath) return `<span class="${cls} x-icon x-icon-letter">${esc((inst?.name || '?').trim()[0].toUpperCase())}</span>`;
    const anim = /\.gif$/i.test(inst.iconPath) && ENV.iconCache ? asset(`${ENV.iconCache}/${slug(inst.id)}-v2.gif`) : '';
    return `<span class="${cls} x-icon"><canvas class="x-icon-still" data-src="${esc(asset(inst.iconPath))}"></canvas>${
      anim ? `<img class="x-icon-anim" alt="" data-src="${esc(anim)}">` : ''
    }</span>`;
  }

  function hydrateIcons(root) {
    root.querySelectorAll('canvas.x-icon-still[data-src]').forEach((c) => {
      drawStill(c, c.dataset.src);
      c.removeAttribute('data-src');
    });
    root.querySelectorAll('img.x-icon-anim[data-src]').forEach((img) => {
      img.onload = () => img.parentElement?.classList.add('x-has-anim');
      img.onerror = () => img.remove(); // no cached copy yet: keep the still frame
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    });
  }

  // Alloy's own icons on cards and lists get the same treatment
  function replaceCardIcons() {
    for (const img of document.querySelectorAll('main.content img.tile.custom')) {
      if (img.dataset.xFor === img.src) continue;
      const inst = instances.find((i) => i.iconPath && asset(i.iconPath) === img.src);
      if (!inst) continue;
      img.dataset.xFor = img.src;
      img.nextElementSibling?.classList.contains('x-card-icon') && img.nextElementSibling.remove();
      const size = (img.getAttribute('width') || 48) + 'px';
      img.insertAdjacentHTML('afterend', iconMarkup(inst, 'x-card-icon'));
      const icon = img.nextElementSibling;
      icon.style.width = icon.style.height = size;
      img.classList.add('x-replaced');
      hydrateIcons(icon);
    }
  }

  // ---------- Home: XMCL's home is the selected instance, so show the most recent one ----------

  const UPDATE_ICON = 'M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1a6.875 6.875 0 0 0 0 9.79 7.02 7.02 0 0 0 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58a8.987 8.987 0 0 1 12.65 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z';

  // Home's sections are loose siblings in main.content; tag the page and add our view after the recent instances.
  // Every layout gets the same header + cards: Sidebar/Card grid/Compact list put the most recent instance first
  // (as a .card, .big or .row), Hero shows the picked instance in its .centre above the instance strip.
  function tagHome() {
    const content = document.querySelector('main.content');
    if (!content) return;
    const hero = content.querySelector(':scope > .hero');
    const recent = hero ? null : content.querySelector(':scope > h2.sub + :is(.grid, .rows)');
    const home = !!(hero || recent);
    content.classList.toggle('x-home', home);
    const layout = hero ? 'hero' : !recent ? '' : recent.classList.contains('rows') ? 'list' : recent.classList.contains('big') ? 'cards' : 'sidebar';
    if ((content.dataset.xLayout || '') !== layout) content.dataset.xLayout = layout;
    // the Instances page: Sidebar gets Modrinth-library tiles, Card grid keeps big artwork cards, List a table (CSS)
    const lib = home ? '' : content.querySelector(':scope .grid.big > article[role=button]') ? 'big'
      : content.querySelector(':scope .grid > article[role=button]') ? 'tiles' : content.querySelector(':scope .rows > .row') ? 'rows' : '';
    content.classList.toggle('x-library', lib === 'tiles');
    content.classList.toggle('x-library-big', lib === 'big');
    content.classList.toggle('x-library-rows', lib === 'rows');
    if (lib === 'big') paintArt(content.querySelectorAll(':scope .grid.big > article'));
    if (lib === 'rows') rowsHeader(content.querySelector(':scope .rows'));
    if (lib === 'tiles') libraryView(content);
    else content.querySelector(':scope > .x-lib-detail')?.remove();
    // remember the layout (seen on Home) so other pages can style the rail for it (Compact list = wide rail)
    const shell = layout || rememberedLayout();
    if (layout) { try { localStorage.setItem('xmcl-layout', layout); } catch {} }
    for (const l of ['sidebar', 'hero', 'cards', 'list']) html.classList.toggle(`x-layout-${l}`, shell === l);
    if (!home) return;
    if (layout === 'cards') return altHome(content, recent, layout);
    const first = hero ? hero.querySelector(':scope > .centre') : recent.firstElementChild;
    (hero || recent).querySelectorAll('.x-hero').forEach((c) => c !== first && c.classList.remove('x-hero'));
    if (!first) return;
    first.classList.add('x-hero');
    const inst = instances.find((i) => i.name === first.querySelector(hero ? 'h1' : '.name')?.textContent.trim());
    if (!inst) return;
    if (hero) return heroHome(content, hero, first, inst);

    // settings gear beside the hero's PLAY, like the instance page (Hero's centre has Alloy's own settings button)
    const play = first.querySelector('.play:not(button)');
    if (play && !play.querySelector('.x-gear')) {
      const gear = document.createElement('button');
      gear.className = 'btn x-gear';
      gear.title = 'Instance settings';
      gear.innerHTML = svg(CARD_ICONS.gear);
      gear.addEventListener('click', (e) => {
        e.stopPropagation();
        openInstanceTab(gear.dataset.inst, 'settings');
      });
      play.append(gear);
    }
    play?.querySelector('.x-gear')?.setAttribute('data-inst', inst.name);

    const anchor = hero ? first : recent;
    let view = anchor.nextElementSibling?.classList.contains('x-home-view') ? anchor.nextElementSibling : null;
    if (!view) {
      content.querySelectorAll('.x-home-view').forEach((v) => v.remove());
      view = document.createElement('div');
      view.className = 'x-home-view';
      view.addEventListener('click', (e) => {
        if (flipShot(e) || e.target.closest('.x-rows-scroll')) return;
        const b = e.target.closest('[data-browse]');
        if (b) return openBrowse(b.dataset.browse);
        const tab = e.target.closest('[data-tab]');
        if (tab) return openInstanceTab(view.dataset.inst, tab.dataset.tab);
      });
      anchor.after(view);
    }
    view.dataset.inst = inst.name;

    // XMCL's metadata row sits in the header, next to the launch button; Alloy's update count joins it
    const row = [...content.querySelectorAll(':scope > .updates li')].findIndex((li) => li.querySelector('span')?.textContent.trim() === inst.name);
    const count = row < 0 ? 0 : parseInt(content.querySelectorAll(':scope > .updates li button')[row]?.textContent, 10) || 0;
    placeStats(first, statsMarkup(inst, count && { count, row }));
    const d = loadOverview(inst.id);
    const markup = `<div class="x-cards" data-inst="${esc(inst.id)}">${d ? overviewMarkup(d, inst) : '<div class="x-cards-loading"></div>'}</div>`;
    if (view.dataset.html !== markup) {
      view.innerHTML = markup;
      view.dataset.html = markup;
    }
    if (d) applyGrid(view.querySelector('.x-cards'));
  }

  // ---------- Card grid and Compact list homes: their own look instead of Sidebar's cards ----------

  // newest screenshot per instance, for artwork; one lookup per instance a minute at most
  const shotCache = new Map();
  const shotTime = (x) => Date.parse(x.modified ?? x.mtime ?? x.created ?? x.date ?? '') || x.modified || x.mtime || 0;
  function shotsOf(id) {
    const c = shotCache.get(id);
    if (c && (c.pending || Date.now() - c.at < 60000)) return c.shots;
    const entry = { at: Date.now(), pending: true, shots: c?.shots ?? [] };
    shotCache.set(id, entry);
    T.invoke('list_screenshots', { id }).catch(() => []).then((shots) => {
      const list = [...(shots || [])].sort((a, b) => shotTime(b) - shotTime(a));
      entry.pending = false;
      entry.at = Date.now();
      if (list.map((x) => x.path).join() !== entry.shots.map((x) => x.path).join()) { entry.shots = list; update(); }
    });
    return entry.shots;
  }
  const latestShot = (id) => (shotsOf(id)[0] ? asset(shotsOf(id)[0].path) : null);

  const byRecent = () => [...instances].sort((a, b) => (Date.parse(b.lastPlayed) || 0) - (Date.parse(a.lastPlayed) || 0));
  const loaderText = (inst) => (inst.loader && inst.loader !== 'vanilla' ? `${LOADERS[inst.loader] ?? inst.loader} ${inst.mcVersion}` : `Minecraft ${inst.mcVersion}`);
  const artStyle = (url) => (url ? ` style="background-image: url('${esc(url)}')"` : '');

  // PLAY: Alloy's own button when the instance has a (hidden) recent card, so stop/busy states and account
  // checks stay Alloy's; otherwise the same launch_instance call the rail's middle-click uses
  function playInstance(content, id, btn) {
    const inst = instances.find((i) => i.id === id);
    if (!inst || running.has(id)) return;
    const own = [...content.querySelectorAll(':scope > :is(.grid, .rows) > *')].find((el) => el.querySelector('.name')?.textContent.trim() === inst.name);
    const play = own?.querySelector('button.play');
    if (play) return play.click();
    btn.disabled = true;
    btn.lastChild.textContent = 'Starting…';
    T.invoke('launch_instance', { id, options: null }).catch((err) => {
      btn.disabled = false;
      window.__xcf?.toast(String(err?.message ?? err), 'err');
    }).finally(() => setTimeout(refresh, 1500));
  }

  function playButton(inst, big) {
    const on = running.has(inst.id);
    return `<button class="btn x-play${big ? ' x-play-big' : ''}${on ? ' on' : ''}" data-play="${esc(inst.id)}"${on ? ' disabled' : ''}>${svg(on ? ICONS.clock : PLAY_ICON)}<span>${on ? 'Running' : 'Play'}</span></button>`;
  }
  const PLAY_ICON = 'M8 5.14v13.72L19 12 8 5.14z';

  // Alloy's update list (hidden) as small rows; clicking one presses Alloy's own button
  function updatesMarkup(content) {
    const rows = [...content.querySelectorAll(':scope > .updates li')].map((li, i) => {
      const name = li.querySelector('span')?.textContent.trim();
      const n = parseInt(li.querySelector('button')?.textContent, 10) || 0;
      return name && n ? `<li data-upd="${i}"><span>${esc(name)}</span><em>${n} update${n === 1 ? '' : 's'}</em></li>` : '';
    }).join('');
    return rows ? `<section class="panel x-card x-mini"><span class="x-card-title">${svg(UPDATE_ICON)}Updates</span><ul class="x-mini-list">${rows}</ul></section>` : '';
  }


  // Card grid: "Jump back in" + Servers/Updates on top, every instance as an artwork card, then recent screenshots
  function cardsHome(content, feat) {
    const shot = latestShot(feat.id);
    const tiles = byRecent().map((inst) => {
      const art = latestShot(inst.id);
      return `<article class="x-art${running.has(inst.id) ? ' running' : ''}" data-xi="${esc(inst.name)}" role="button" tabindex="0">
        <div class="x-art-pic${art ? '' : ' none'}"${artStyle(art)}>${iconMarkup(inst, 'x-art-icon')}</div>
        <div class="x-art-body"><strong>${esc(inst.name)}</strong><span>${esc(loaderText(inst))} · ${esc(inst.playTimeSecs ? playtime(inst.playTimeSecs) : 'not played')}</span></div>
        ${playButton(inst)}
      </article>`;
    }).join('');
    const shots = instances.flatMap((inst) => shotsOf(inst.id).slice(0, 12).map((x) => ({ ...x, inst })))
      .sort((a, b) => shotTime(b) - shotTime(a)).slice(0, 12);
    galleryShots = shots;
    return `<section class="x-feat${shot ? '' : ' none'}" data-xi="${esc(feat.name)}">
        <div class="x-feat-pic"${artStyle(shot)}></div>
        <div class="x-feat-body">${iconMarkup(feat, 'x-feat-icon')}
          <div class="x-feat-text"><span class="x-feat-kicker">Jump back in</span><h2>${esc(feat.name)}</h2><div class="x-stats">${statsMarkup(feat)}</div></div>
          <div class="x-feat-actions">${playButton(feat, true)}<button class="btn x-gear" data-gear title="Instance settings">${svg(CARD_ICONS.gear)}</button></div>
        </div>
      </section>
      <aside class="x-alt-side">${window.__xpages ? `<div class="panel x-card x-card-servers" data-x-servers="${esc(feat.id)}"></div>` : ''}${updatesMarkup(content)}</aside>
      <section class="x-sec x-lib"><h3 class="x-sec-title">Your instances <em>${instances.length}</em></h3>
        <div class="x-art-grid">${tiles}<button class="x-art x-art-new" data-new>${svg('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z')}<span>New instance</span></button></div></section>
      <section class="x-sec x-shots"><h3 class="x-sec-title">Recent screenshots <em>${shots.length}</em></h3>
        ${shots.length ? `<div class="x-shot-strip">${shots.map((x, i) => `<button class="x-shot-thumb" data-view="${i}" style="background-image: url('${esc(asset(x.path))}')"><span>${esc(x.inst.name)}</span></button>`).join('')}</div>`
          : `<p class="x-sec-empty">${svg(CARD_ICONS.camera)}Press F2 in game to take screenshots; the newest show up here.</p>`}</section>`;
  }

  // full-size screenshot viewer: ←/→ to flip, Esc or a click outside to close
  let galleryShots = [];
  function openViewer(list, i) {
    if (!list.length) return;
    document.querySelector('.x-viewer')?.remove();
    const el = document.createElement('div');
    el.className = 'x-viewer';
    const show = () => {
      const x = list[(i + list.length) % list.length];
      el.innerHTML = `<img src="${esc(asset(x.path))}" alt=""><div class="x-viewer-bar"><span>${esc(x.inst?.name ?? '')}${x.inst ? ' · ' : ''}${(i % list.length + list.length) % list.length + 1} / ${list.length}</span>` +
        `<button data-v="-1" title="Previous">${svg(CARD_ICONS.left)}</button><button data-v="1" title="Next">${svg(CARD_ICONS.right)}</button><button data-v="x" title="Close">✕</button></div>`;
    };
    const close = () => { el.remove(); removeEventListener('keydown', key, true); };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); i += e.key === 'ArrowLeft' ? -1 : 1; show(); }
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return e.target === el && close();
      if (b.dataset.v === 'x') return close();
      i += +b.dataset.v;
      show();
    });
    addEventListener('keydown', key, true);
    show();
    document.body.append(el);
  }

  function altHome(content, recent, layout) {
    content.querySelectorAll(':scope > .grid .x-hero, :scope > .rows .x-hero').forEach((c) => c.classList.remove('x-hero'));
    const feat = byRecent()[0];
    let view = recent.nextElementSibling?.classList.contains('x-alt') ? recent.nextElementSibling : null;
    if (view && view.dataset.layout !== layout) { view.remove(); view = null; }
    if (!view) {
      content.querySelectorAll(':scope > :is(.x-home-view, .x-alt)').forEach((v) => v.remove());
      view = document.createElement('div');
      view.className = `x-alt x-alt-${layout}`;
      view.dataset.layout = layout;
      view.addEventListener('click', (e) => {
        if (e.target.closest('[data-x-servers], [data-x-logs]')) return;
        const play = e.target.closest('[data-play]');
        if (play) return playInstance(content, play.dataset.play, play);
        if (e.target.closest('[data-new]')) return document.querySelector('.x-pagebtn[data-page="new"]')?.click();
        const upd = e.target.closest('[data-upd]');
        if (upd) return content.querySelectorAll(':scope > .updates li button')[+upd.dataset.upd]?.click();
        const shotBtn = e.target.closest('[data-view]');
        if (shotBtn) return openViewer(galleryShots, +shotBtn.dataset.view);
        const world = e.target.closest('[data-world]');
        if (world) return openInstanceTab(world.dataset.world, 'worlds');
        const owner = e.target.closest('[data-xi]');
        if (e.target.closest('[data-gear]')) return owner && openInstanceTab(owner.dataset.xi, 'settings');
        if (owner && !owner.matches('.x-feat, .x-lhead')) openInstance(owner.dataset.xi);
      });
      recent.after(view);
    }
    if (!feat) { view.innerHTML = ''; view.dataset.html = ''; return; }
    const markup = cardsHome(content, feat);
    if (view.dataset.html !== markup) {
      // keep the hydrated Servers/Logs cards (pages.js fills them) across re-renders
      const keep = [...view.querySelectorAll('[data-x-servers], [data-x-logs]')];
      view.innerHTML = markup;
      view.dataset.html = markup;
      for (const old of keep) {
        const sel = old.dataset.xServers !== undefined ? `[data-x-servers="${CSS.escape(old.dataset.xServers)}"]` : `[data-x-logs="${CSS.escape(old.dataset.xLogs)}"]`;
        const slot = view.querySelector(sel);
        if (slot && old.dataset.ready) slot.replaceWith(old);
      }
      hydrateIcons(view);
    }
  }

  // Hero: a launcher screen. The picked instance's newest screenshot fills the page, name + big PLAY bottom-left,
  // chips that open the instance's tabs, the first saved server top-right, Alloy's instance strip along the bottom
  function heroHome(content, hero, centre, inst) {
    content.querySelectorAll(':scope .x-home-view').forEach((v) => v.remove());
    let art = hero.querySelector(':scope > .x-hero-art');
    if (!art) {
      art = document.createElement('div');
      art.className = 'x-hero-art';
      hero.prepend(art);
    }
    // your background picture is the artwork (screenshots are often F3/HUD clutter); a screenshot only without one
    const shot = bgImageURL() || document.querySelector('video[aria-hidden="true"]') ? null : latestShot(inst.id);
    if ((art.dataset.src || '') !== (shot || '')) {
      art.dataset.src = shot || '';
      art.style.backgroundImage = shot ? `url("${shot}")` : '';
      art.classList.toggle('none', !shot);
    }

    const part = (cls, tag = 'div') => {
      let el = centre.querySelector(`:scope > .${cls}`);
      if (!el) {
        el = document.createElement(tag);
        el.className = cls;
        centre.append(el);
      }
      return el;
    };
    centre.querySelector(':scope > .x-hero-kicker')?.remove();
    placeStats(centre, statsMarkup(inst));

    const chips = part('x-hero-chips');
    if (!chips.dataset.wired) {
      chips.dataset.wired = '1';
      chips.addEventListener('click', (e) => {
        const c = e.target.closest('[data-tab]');
        if (c) openInstanceTab(chips.dataset.inst, c.dataset.tab);
      });
    }
    chips.dataset.inst = inst.name;
    const d = loadOverview(inst.id);
    const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
    const markup = d ? [
      ['mods', ICONS.loader, n(d.mods.length, 'mod', 'mods')],
      ['resource', CARD_ICONS.palette, n(d.packs.length, 'resource pack', 'resource packs')],
      ['worlds', CARD_ICONS.map, n(d.worlds.length, 'world', 'worlds')],
      ['screenshots', CARD_ICONS.image, n(d.shots.length, 'screenshot', 'screenshots')],
    ].map(([tab, icon, label]) => `<button data-tab="${tab}">${svg(icon)}${label}</button>`).join('') : '';
    if (chips.dataset.html !== markup) {
      chips.innerHTML = markup;
      chips.dataset.html = markup;
    }

    let pill = hero.querySelector(':scope > .x-hero-server');
    if (!pill && window.__xpages) {
      pill = document.createElement('div');
      pill.className = 'x-hero-server';
      pill.hidden = true;
      hero.append(pill);
    }
    if (pill && pill.dataset.xPill !== inst.id) pill.dataset.xPill = inst.id;
  }

  const rememberedLayout = () => { try { return localStorage.getItem('xmcl-layout') || 'sidebar'; } catch { return 'sidebar'; } };

  // ---------- Instances page (Sidebar / Compact list): artwork tiles + a details panel on the right ----------

  let libSelected = null;
  function libraryView(content) {
    const grid = content.querySelector(':scope .grid');
    if (!grid) return;
    // screenshot artwork on top of each of Alloy's tiles
    for (const tile of grid.querySelectorAll(':scope > article')) {
      const inst = instances.find((i) => i.name === tile.querySelector('.name')?.textContent.trim());
      if (!inst) continue;
      let art = tile.querySelector(':scope > .x-tile-art');
      if (!art) {
        art = document.createElement('div');
        art.className = 'x-tile-art';
        tile.prepend(art);
      }
      const url = latestShot(inst.id);
      if ((art.dataset.src || '') !== (url || '')) {
        art.dataset.src = url || '';
        art.style.backgroundImage = url ? `url("${url}")` : '';
        art.classList.toggle('none', !url);
      }
      if (!tile.dataset.xWired) {
        tile.dataset.xWired = '1';
        const pickTile = () => { if (libSelected !== inst.name) { libSelected = inst.name; update(); } };
        tile.addEventListener('mouseenter', pickTile);
        tile.addEventListener('focusin', pickTile);
      }
      tile.classList.toggle('x-picked', libSelected === inst.name);
    }

    const inst = instances.find((i) => i.name === libSelected) || byRecent()[0];
    let panel = content.querySelector(':scope > .x-lib-detail');
    if (!inst) return panel?.remove();
    if (!panel) {
      panel = document.createElement('aside');
      panel.className = 'x-lib-detail panel';
      panel.addEventListener('click', (e) => {
        const name = panel.dataset.inst, it = instances.find((i) => i.name === name);
        if (!it) return;
        const play = e.target.closest('[data-play]');
        if (play) return playInstance(content, play.dataset.play, play);
        if (e.target.closest('[data-gear]')) return openInstanceTab(name, 'settings');
        const tab = e.target.closest('[data-tab]');
        if (tab) return openInstanceTab(name, tab.dataset.tab);
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act && window.__xpagesApi) return ({ folder: window.__xpagesApi.openFolder, logs: window.__xpagesApi.openLogs, dup: window.__xpagesApi.duplicate })[act]?.(it.id);
        const shot = e.target.closest('[data-view]');
        if (shot) return openViewer(shotsOf(it.id).map((x) => ({ ...x, inst: it })), +shot.dataset.view);
        if (e.target.closest('[data-open]')) return openInstance(name);
      });
      content.append(panel);
    }
    panel.dataset.inst = inst.name;
    const d = loadOverview(inst.id);
    const shots = shotsOf(inst.id);
    const art = shots[0] ? asset(shots[0].path) : null;
    const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
    const chips = d ? [
      ['mods', ICONS.loader, n(d.mods.length, 'mod', 'mods')],
      ['resource', CARD_ICONS.palette, n(d.packs.length, 'pack', 'packs')],
      ['worlds', CARD_ICONS.map, n(d.worlds.length, 'world', 'worlds')],
      ['screenshots', CARD_ICONS.image, n(shots.length, 'screenshot', 'screenshots')],
    ].map(([tab, icon, label]) => `<button data-tab="${tab}">${svg(icon)}${label}</button>`).join('') : '';
    const worlds = d ? [...d.worlds].sort((a, b) => String(b.lastPlayed ?? '').localeCompare(String(a.lastPlayed ?? ''))).slice(0, 3) : [];
    const markup = `<div class="x-ld-art${art ? '' : ' none'}" data-open${artStyle(art)}></div>
      <div class="x-ld-head">${iconMarkup(inst, 'x-ld-icon')}<div class="x-ld-title"><h2 data-open>${esc(inst.name)}</h2><div class="x-stats">${statsMarkup(inst)}</div></div></div>
      <div class="x-feat-actions x-ld-play">${playButton(inst, true)}<button class="btn x-gear" data-gear title="Instance settings">${svg(CARD_ICONS.gear)}</button></div>
      <div class="x-ld-chips">${chips}</div>
      <div class="x-ld-acts"><button data-act="folder">${svg(LIB_ICONS.folder)}Folder</button><button data-act="logs">${svg(LIB_ICONS.logs)}Logs</button><button data-act="dup">${svg(LIB_ICONS.copy)}Duplicate</button></div>
      ${worlds.length ? `<h4 class="x-ld-sub">Recent worlds</h4><ul class="x-ld-worlds">${worlds.map((w) => `<li data-tab="worlds"><b>${esc(w.name || w.folder)}</b><em>${esc(w.lastPlayed ? lastPlayed(w.lastPlayed) : '')}</em></li>`).join('')}</ul>` : ''}
      ${shots.length ? `<h4 class="x-ld-sub">Screenshots</h4><div class="x-ld-shots">${shots.slice(0, 6).map((x, i) => `<button data-view="${i}" style="background-image: url('${esc(asset(x.path))}')"></button>`).join('')}</div>` : ''}`;
    if (panel.dataset.html !== markup) {
      panel.innerHTML = markup;
      panel.dataset.html = markup;
      hydrateIcons(panel);
    }
  }
  const LIB_ICONS = {
    folder: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
    logs: 'M20 4H4c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm0 14H4V8h16v10zm-2-1h-6v-2h6v2zM7.5 17l-1.41-1.41L8.67 13l-2.59-2.59L7.5 9l4 4-4 4z',
    copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  };

  // Instances page in Card grid: Alloy's big cards get the instance's newest screenshot as artwork
  function paintArt(cards) {
    for (const card of cards) {
      const inst = instances.find((i) => i.name === card.querySelector('.name')?.textContent.trim());
      const art = card.querySelector(':scope > .art');
      const url = inst && latestShot(inst.id);
      if (art && url && art.dataset.xArt !== url) {
        art.dataset.xArt = url;
        art.style.setProperty('background-image', `linear-gradient(transparent 40%, color-mix(in srgb, var(--bg-elevated) 85%, transparent)), url('${url}')`, 'important');
        art.classList.add('x-has-art');
      }
    }
  }

  // Instances page in Compact list: column titles over Alloy's rows
  function rowsHeader(rows) {
    if (!rows || rows.previousElementSibling?.classList.contains('x-rows-head')) return;
    rows.insertAdjacentHTML('beforebegin', '<div class="x-rows-head"><span></span><span>Name</span><span>Loader</span><span>Version</span><span>Last played</span><span>Played</span><span></span><span></span></div>');
  }

  async function openInstanceTab(name, tab) {
    await openInstance(name);
    await waitFor(() => document.querySelector('main.content nav.tabs .tab'));
    openTab(tab);
  }

  // ---------- rail ----------

  function renderRail() {
    const sidebar = document.querySelector('nav.sidebar');
    if (!sidebar) return;
    let box = sidebar.querySelector('.x-insts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'x-insts';
      box.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-inst]');
        if (btn) openInstance(btn.dataset.inst);
      });
      sidebar.querySelector('ul')?.after(box);
    }
    const open = openInstanceName();
    const sorted = [...instances].sort((a, b) => (b.favourite - a.favourite) || String(b.lastPlayed ?? '').localeCompare(String(a.lastPlayed ?? '')));
    const key = sorted.map((i) => [i.id, i.name, i.iconPath, i.name === open, running.has(i.id)].join('|')).join('/');
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.innerHTML = sorted
      .map((i) => `<button class="nav x-inst${i.name === open ? ' active' : ''}${running.has(i.id) ? ' running' : ''}" data-inst="${esc(i.name)}">${iconMarkup(i, 'x-inst-icon')}<span>${esc(i.name)}<small>${esc(loaderText(i))}</small></span></button>`)
      .join('');
    hydrateIcons(box);
  }

  function waitFor(fn, ms = 2500) {
    return new Promise((resolve) => {
      const start = performance.now();
      (function tick() {
        const v = fn();
        if (v || performance.now() - start > ms) return resolve(v);
        requestAnimationFrame(tick);
      })();
    });
  }

  // pages.js opens a freshly created instance with this
  window.__xmcl = {
    openInstance: (name) => openInstance(name),
    openInstanceTab: (name, tab) => openInstanceTab(name, tab),
    iconMarkup: (inst, cls) => iconMarkup(inst, cls),
    hydrateIcons: (root) => hydrateIcons(root),
    showMenu: (x, y, items) => showMenu(x, y, items),
    instances: () => instances,
    refresh: () => refresh(),
  };

  async function openInstance(name) {
    if (openInstanceName() === name) return;
    // the second rail entry is Alloy's Instances page
    document.querySelectorAll('nav.sidebar ul .nav, nav.topbar ul .item')[1]?.click();
    const card = await waitFor(() =>
      [...document.querySelectorAll('main.content [role=button]')].find((el) => el.querySelector('.name')?.textContent.trim() === name),
    );
    card?.click();
  }

  // ---------- instance header stat strip ----------

  // one quiet line under the name, like the Modrinth app: "Fabric 1.21.11 · 3 h played · Played today 6:40 PM · 9 updates"
  function statsMarkup(inst, updates) {
    const loader = inst.loader && inst.loader !== 'vanilla' ? `${LOADERS[inst.loader] ?? inst.loader} ${inst.mcVersion}` : `Minecraft ${inst.mcVersion}`;
    const items = [
      `<span title="${esc(inst.loaderVersion ? `loader ${inst.loaderVersion}` : '')}">${svg(ICONS.cube)}${esc(loader)}</span>`,
      `<span>${svg(ICONS.clock)}${inst.playTimeSecs ? `${esc(playtime(inst.playTimeSecs))} played` : 'Not played yet'}</span>`,
      inst.lastPlayed ? `<span>${svg(ICONS.history)}Played ${esc(lastPlayed(inst.lastPlayed).replace(/^(Today|Yesterday)/, (w) => w.toLowerCase()))}</span>` : '',
      updates ? `<a class="x-meta-upd" data-upd="${updates.row}" role="button">${svg(UPDATE_ICON)}${updates.count} update${updates.count === 1 ? '' : 's'}</a>` : '',
    ];
    return items.filter(Boolean).join('');
  }

  // the strip lives inside the header (instance page) or the hero card (Home)
  function placeStats(host, markup) {
    let strip = host.querySelector(':scope > .x-stats');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'x-stats';
      strip.addEventListener('click', (e) => {
        const upd = e.target.closest('[data-upd]');
        if (!upd) return;
        e.stopPropagation();
        document.querySelectorAll('main.content > .updates li button')[+upd.dataset.upd]?.click();
      });
      host.append(strip);
    }
    if (strip.dataset.html !== markup) {
      strip.innerHTML = markup;
      strip.dataset.html = markup;
    }
  }

  function renderStats() {
    const head = document.querySelector('main.content header.head');
    if (!head) return;
    const inst = instances.find((i) => i.name === openInstanceName());
    if (inst) placeStats(head, statsMarkup(inst));
  }

  // ---------- instance page: XMCL-style overview cards + settings gear ----------

  const CARD_ICONS = {
    map: 'M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z',
    palette: 'M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
    shader: 'M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z',
    image: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
    left: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
    right: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
    camera: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z',
    download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  };

  // per-instance overview data, from the same backend calls Alloy's own tabs use
  const overview = new Map();
  function loadOverview(id) {
    const cached = overview.get(id);
    if (cached && (cached.pending || Date.now() - cached.at < 60000)) return cached.data;
    const entry = { at: Date.now(), pending: true, data: cached?.data ?? null };
    overview.set(id, entry);
    const items = (type) => T.invoke('content_list', { instanceId: id, contentType: type, lookup: false }).then((r) => r?.items ?? []).catch(() => []);
    Promise.all([
      items('mod'),
      items('resourcepack'),
      items('shader'),
      T.invoke('list_worlds', { id }).catch(() => []),
      T.invoke('list_screenshots', { id }).catch(() => []),
      // read_instance_file takes a full path and returns raw bytes
      T.invoke('instance_dir', { id })
        .then((dir) => T.invoke('read_instance_file', { id, path: `${dir}/config/iris.properties` }))
        .then((bytes) => new TextDecoder().decode(new Uint8Array(bytes)))
        .catch(() => ''),
    ]).then(([mods, packs, shaders, worlds, shots, props]) => {
      const pack = props.match(/^shaderPack=(.*)$/m)?.[1]?.trim().replace(/\.zip$/i, '');
      const shader = pack ? { name: pack, on: !/^enableShaders=false/m.test(props) } : null;
      entry.data = { mods, packs, shaders, worlds: worlds || [], shots: shots || [], shader };
      entry.at = Date.now();
      entry.pending = false;
      update();
      packIcons(id, packs);
    });
    return entry.data;
  }

  // Alloy leaves zipped resource packs without an icon; the loader pulls pack.png out of the zip and caches it
  const bridge = window.webkit?.messageHandlers?.alloyskin;
  async function packIcons(id, packs) {
    const missing = packs.filter((p) => !p.iconPath && /\.zip$/i.test(p.fileName ?? ''));
    if (!bridge || !missing.length) return;
    const dir = await T.invoke('instance_dir', { id }).catch(() => null);
    if (!dir) return;
    let found = false;
    await Promise.all(missing.map((p) => bridge.postMessage(`PI\n${dir}/resourcepacks/${p.fileName}`).then((path) => { p.iconPath = path; found = true; }).catch(() => {})));
    if (found) update();
  }

  // instance page: the tab bar sits under the header; Overview (the cards) is our tab, every other tab shows
  // only Alloy's own content (main.content.x-ov = Overview showing)
  function openTab(word) {
    const tab = [...document.querySelectorAll('main.content nav.tabs .tab:not(.x-ov-tab)')].find((t) => t.textContent.trim().toLowerCase().startsWith(word));
    if (!tab) return;
    tab.click();
    overviewFor = openInstanceName(); // so the next sync doesn't flip a just-opened instance back to Overview
    showOverview(false);
  }

  function showOverview(on) {
    const content = document.querySelector('main.content');
    if (!content) return;
    content.classList.toggle('x-ov', on);
    content.querySelector(':scope > nav.tabs .x-ov-tab')?.classList.toggle('active', on);
    content.scrollTop = 0;
    if (on) update();
  }

  let overviewFor = null;
  function syncTabs() {
    const content = document.querySelector('main.content');
    if (!content) return;
    const name = content.querySelector(':scope > header.head') ? openInstanceName() : null;
    content.classList.toggle('x-inst', !!name);
    if (!name) {
      content.classList.remove('x-ov');
      overviewFor = null;
      return;
    }
    // a freshly opened instance starts on Overview
    if (overviewFor !== name) {
      overviewFor = name;
      content.classList.add('x-ov');
    }
    const nav = content.querySelector(':scope > nav.tabs');
    if (nav && !nav.querySelector('.x-ov-tab')) {
      const b = document.createElement('button');
      b.className = 'tab x-ov-tab';
      b.textContent = 'Overview';
      nav.prepend(b);
      nav.addEventListener('click', (e) => {
        const t = e.target.closest('.tab');
        if (t) showOverview(t === b);
      });
    }
    nav?.querySelector('.x-ov-tab')?.classList.toggle('active', content.classList.contains('x-ov'));
  }

  // XMCL's HomeCard: title, one line of text, avatars, then MANAGE (left) and a green INSTALL (right)
  function card(tab, icon, title, text, body, browse) {
    return `<div class="panel x-card x-card-${tab}" data-card="${tab}" data-label="${title}" data-tab="${tab}" role="button"><span class="x-card-title">${svg(icon)}${title}</span>` +
      `<div class="x-card-text"><span class="x-card-sub">${text}</span>${body}</div>` +
      (browse ? `<span class="x-card-foot"><span class="x-card-action" data-browse="${browse}">Install</span></span>` : '') + '</div>';
  }

  // XMCL's screenshot card: the picture fills the card, title on top, arrows to flip through
  function shotCard(shots, i) {
    const n = shots.length;
    const cur = n ? shots[((i % n) + n) % n] : null;
    return `<div class="panel x-card x-card-screenshots${n ? '' : ' empty'}" data-card="screenshots" data-label="Screenshot Gallery" data-tab="screenshots" role="button">` +
      (cur ? `<img class="x-shot" src="${esc(asset(cur.path))}" alt="" decoding="async">` : `<span class="x-card-empty">${svg(CARD_ICONS.camera)}<strong>No screenshots yet</strong><span>Take screenshots in game by pressing F2</span></span>`) +
      `<span class="x-shot-head">${svg(CARD_ICONS.image)}Screenshot Gallery${n ? `<em>${n}</em>` : ''}</span>` +
      (n > 1 ? `<span class="x-shot-nav prev" data-shot="-1">${svg(CARD_ICONS.left)}</span><span class="x-shot-nav next" data-shot="1">${svg(CARD_ICONS.right)}</span>` : '') +
      '</div>';
  }
  let shotIndex = 0;

  function flipShot(e) {
    const nav = e.target.closest('[data-shot]');
    if (!nav) return false;
    shotIndex += +nav.dataset.shot;
    update();
    return true;
  }

  // Browse with the right chip selected, like XMCL's per-card Install
  async function openBrowse(chip) {
    document.querySelectorAll('nav.sidebar ul .nav, nav.topbar ul .item')[2]?.click();
    const el = await waitFor(() => [...document.querySelectorAll('main.content .chips .chip')].find((c) => c.textContent.trim().toLowerCase().startsWith(chip)));
    if (el && !el.classList.contains('active')) el.click();
  }

  function renderInstanceCards() {
    const head = document.querySelector('main.content header.head');
    const inst = head && instances.find((i) => i.name === openInstanceName());
    if (!inst) return;
    const d = loadOverview(inst.id);
    const anchor = head;
    let box = anchor.nextElementSibling?.classList.contains('x-cards') ? anchor.nextElementSibling : null;
    if (!box) {
      box = document.createElement('div');
      box.className = 'x-cards';
      box.addEventListener('click', (e) => {
        if (flipShot(e) || e.target.closest('.x-rows-scroll')) return;
        const b = e.target.closest('[data-browse]');
        if (b) return openBrowse(b.dataset.browse);
        const c = e.target.closest('[data-tab]');
        if (c) openTab(c.dataset.tab);
      });
      anchor.after(box);
    }

    // gear next to PLAY, like XMCL's launch button
    const actions = head.querySelector('.head-actions');
    if (actions && !actions.querySelector('.x-gear')) {
      const gear = document.createElement('button');
      gear.className = 'btn x-gear';
      gear.title = 'Instance settings';
      gear.innerHTML = svg(CARD_ICONS.gear);
      gear.addEventListener('click', () => openTab('settings'));
      actions.append(gear);
    }

    if (!d) {
      if (!box.dataset.html) box.innerHTML = '<div class="x-cards-loading"></div>';
      return;
    }
    const markup = overviewMarkup(d, inst);
    if (box.dataset.html !== markup || box.dataset.inst !== inst.id) {
      box.dataset.inst = inst.id;
      box.innerHTML = markup;
      box.dataset.html = markup;
    }
    applyGrid(box);
  }

  // Modrinth-app style rows: small square icon, name, version on the right; the card scrolls through all of them
  function rows(list, right) {
    return `<ul class="x-rows x-rows-scroll">${list.map((x) => `<li>${x.iconPath ? `<img src="${esc(asset(x.iconPath))}" alt="" loading="lazy" decoding="async">` : '<i></i>'}<b>${esc(x.title || x.fileName)}</b>${right(x)}</li>`).join('')}</ul>`;
  }

  // updates for this instance, from Alloy's own checker (cached; Alloy already runs it for Home)
  const updates = new Map();
  function loadUpdates(id) {
    const c = updates.get(id);
    if (c && (c.pending || Date.now() - c.at < 10 * 60000)) return c.list;
    const entry = { at: Date.now(), pending: true, list: c?.list ?? null };
    updates.set(id, entry);
    T.invoke('content_check_updates', { instanceId: id, contentType: 'mod' })
      .then((r) => { entry.list = Array.isArray(r) ? r : r?.updates ?? r?.items ?? []; })
      .catch(() => { entry.list = []; })
      .finally(() => { entry.pending = false; entry.at = Date.now(); update(); });
    return entry.list;
  }

  function overviewMarkup(d, inst) {
    const mods = d.mods.filter((m) => m.enabled !== false);
    const off = d.mods.length - mods.length;
    const packs = d.packs.filter((p) => p.enabled !== false);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const ver = (x) => (x.version ? `<em>${esc(x.version)}</em>` : '');

    // mods with an update first (old → new), then the rest by name
    const upd = (inst && loadUpdates(inst.id)) || [];
    // Alloy's update entries: { key, title, current, latest: { versionNumber } }
    const updOf = (m) => upd.find((u) => u.key === m.fileName || (u.title && u.title === m.title));
    const sorted = [...mods].sort((a, b) => (!!updOf(b) - !!updOf(a)) || String(a.title || a.fileName).localeCompare(String(b.title || b.fileName)));
    const modRight = (m) => {
      const u = updOf(m);
      return u ? `<em class="x-up-pill" title="${esc(u.current ?? m.version ?? '')} → ${esc(u.latest?.versionNumber ?? '')}">Update</em>` : ver(m);
    };
    const modText = `<span>${plural(mods.length, 'mod')}</span>${off ? `<span>${off} off</span>` : ''}${upd.length ? `<span class="x-up">${plural(upd.length, 'update')}</span>` : ''}`;

    const worlds = [...d.worlds].sort((a, b) => String(b.lastPlayed ?? '').localeCompare(String(a.lastPlayed ?? '')));
    return [
      card('mods', ICONS.loader, 'Mods', modText, rows(sorted, modRight), 'mods'),
      card('worlds', CARD_ICONS.map, 'Saves', plural(d.worlds.length, 'world'),
        `<ul class="x-rows plain">${worlds.slice(0, 2).map((w) => `<li><b>${esc(w.name || w.folder)}</b>${w.lastPlayed ? `<em>${esc(lastPlayed(w.lastPlayed))}</em>` : ''}</li>`).join('')}</ul>`, ''),
      // the active pack once (with an on/off dot), then only the other packs
      card('shaders', CARD_ICONS.shader, 'Shader Pack', d.shader ? `<span class="x-dot${d.shader.on ? ' on' : ''}"></span>${esc(d.shader.name)}${d.shader.on ? '' : ' · off'}` : 'None',
        (() => {
          const others = d.shaders.filter((x) => (x.title || x.fileName || '').replace(/\.zip$/i, '') !== d.shader?.name);
          return others.length ? `<ul class="x-rows plain">${others.slice(0, 3).map((x) => `<li><b>${esc(x.title || x.fileName)}</b></li>`).join('')}</ul>` : '';
        })(), 'shaders'),
      card('resource', CARD_ICONS.palette, 'Resource Packs', `<span>${packs.length} enabled</span>`, rows(packs, ver), 'resource'),
      shotCard(d.shots, shotIndex),
      // filled in by pages.js (live log tail, saved servers), only when it's loaded so the boxes are never empty
      window.__xpages ? `<div class="panel x-card x-card-logs" data-card="logs" data-label="Logs" data-x-logs="${esc(inst?.id ?? '')}"></div>` : '',
      window.__xpages ? `<div class="panel x-card x-card-servers" data-card="servers" data-label="Servers" data-x-servers="${esc(inst?.id ?? '')}"></div>` : '',
    ].join('');
  }

  // ---------- wheel: a calmer, instant step, and scrolls that start in a small box stay in it ----------

  const SPEED = { slow: 0.22, normal: 0.35, fast: 0.55 };
  // the page itself; everything else that scrolls is an "inner" box (log, card lists, tables, panes)
  const pageScroller = () => document.querySelector('main.content');
  function scrollableAncestor(el) {
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollHeight <= el.clientHeight + 1) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') return el;
    }
    return null;
  }
  // Smooth: glide to the target over ~120 ms; each new notch retargets from where the glide is now
  const glides = new Map(); // element -> { target, from, start }
  function glide(box, dy) {
    const g = glides.get(box);
    const max = box.scrollHeight - box.clientHeight;
    const target = Math.max(0, Math.min(max, (g ? g.target : box.scrollTop) + dy));
    glides.set(box, { target, from: box.scrollTop, start: performance.now() });
    if (g) return;
    (function step(now) {
      const cur = glides.get(box);
      if (!cur) return;
      const t = Math.min(1, (now - cur.start) / 120);
      box.scrollTop = cur.from + (cur.target - cur.from) * (1 - (1 - t) ** 3);
      if (t < 1) requestAnimationFrame(step);
      else glides.delete(box);
    })(performance.now());
  }

  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.defaultPrevented) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.target.closest?.('select, input[type=range]')) return;
    const box = scrollableAncestor(e.target);
    if (!box) return;
    const inner = box !== pageScroller() && box !== document.scrollingElement;
    let dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * box.clientHeight : e.deltaY;
    dy *= (SPEED[prefs.speed] ?? SPEED.normal) * (inner ? 0.5 : 1);
    // a mouse notch never moves less than a couple of rows; touchpad deltas stay as fine as they come
    const notch = Math.abs(e.deltaY) >= 50;
    if (notch && Math.abs(dy) < 24) dy = Math.sign(dy) * 24;
    e.preventDefault();
    // touchpads already send a smooth stream of small deltas; only mouse notches get the glide
    if (prefs.smooth === 'on' && notch) glide(box, dy);
    else { glides.delete(box); box.scrollTop += dy; }
  }, { passive: false });

  // ---------- card grid: XMCL's HomeGrid (12/12/6/4 columns, 32px rows, vertical compact), customizable ----------

  // <grid-core> (pure layout logic; tests/grid.test.js runs this block in node)
  const GRID = {
    cols: { lg: 12, md: 12, sm: 6, xs: 4 },
    widths: { lg: 1600, md: 1280, sm: 1024, xs: 0 },
    row: 32,
    gap: 10,
    min: { screenshots: [3, 4] },
    // XMCL's defaults (HomeGrid.vue DEFAULTS), with Servers under Resource Packs and Logs across the bottom
    defaults: {
      lg: { mods: [0, 0, 3, 11], worlds: [3, 0, 3, 5], shaders: [6, 0, 3, 5], resource: [9, 0, 3, 6], servers: [9, 6, 3, 5], screenshots: [3, 5, 6, 6], logs: [0, 11, 12, 7] },
      md: { mods: [0, 0, 3, 9], worlds: [3, 0, 3, 4], shaders: [6, 0, 3, 4], resource: [9, 0, 3, 5], servers: [9, 5, 3, 4], screenshots: [3, 4, 6, 5], logs: [0, 9, 12, 7] },
      sm: { mods: [0, 0, 3, 8], resource: [3, 0, 3, 8], worlds: [0, 8, 3, 4], shaders: [3, 8, 3, 4], screenshots: [0, 12, 6, 6], logs: [0, 18, 6, 8], servers: [0, 26, 6, 6] },
      xs: { mods: [0, 0, 2, 7], resource: [2, 0, 2, 7], worlds: [0, 7, 2, 4], shaders: [2, 7, 2, 4], screenshots: [0, 11, 4, 5], logs: [0, 16, 4, 8], servers: [0, 24, 4, 6] },
    },
  };
  const gridBreakpoint = (width) => (width >= GRID.widths.lg ? 'lg' : width >= GRID.widths.md ? 'md' : width >= GRID.widths.sm ? 'sm' : 'xs');
  const overlaps = (a, b) => a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const minOf = (id) => GRID.min[id] ?? [2, 4];

  // pack everything upward without overlaps; `first` keeps its spot when two cards want the same place
  function gridCompact(items, first = null) {
    const order = [...items].sort((a, b) => a.y - b.y || (a === first ? -1 : b === first ? 1 : a.x - b.x));
    const placed = [];
    for (const it of order) {
      it.y = Math.max(0, it.y);
      while (it.y > 0 && !placed.some((p) => overlaps({ ...it, y: it.y - 1 }, p))) it.y--;
      while (placed.some((p) => overlaps(it, p))) it.y++;
      placed.push(it);
    }
    return items;
  }

  // move or resize one card, pushing the cards it lands on below it
  function gridPlace(items, it, geo, cols) {
    const [minW, minH] = minOf(it.id);
    it.w = Math.max(minW, Math.min(cols, geo.w ?? it.w));
    it.h = Math.max(minH, geo.h ?? it.h);
    it.x = Math.max(0, Math.min(cols - it.w, geo.x ?? it.x));
    it.y = Math.max(0, geo.y ?? it.y);
    const push = (moved) => {
      for (const o of items) if (overlaps(moved, o)) { o.y = moved.y + moved.h; push(o); }
    };
    push(it);
    return gridCompact(items, it);
  }

  // defaults for this width, then what the user saved, minus hidden cards
  function gridLayout(ids, bp, saved = {}) {
    const cols = GRID.cols[bp];
    const items = [];
    for (const id of ids) {
      const meta = saved[id] ?? {};
      if (meta.hidden) continue;
      const d = GRID.defaults[bp][id] ?? [0, 99, Math.min(cols, 4), 5];
      const g = meta.layout?.[bp];
      const w = Math.min(cols, g?.w ?? d[2]);
      items.push({ id, x: Math.min(cols - w, g?.x ?? d[0]), y: g?.y ?? d[1], w, h: g?.h ?? d[3] });
    }
    return gridCompact(items);
  }
  // </grid-core>

  const GRID_KEY = 'xmcl-cards';
  const gridStore = {
    all() { try { return JSON.parse(localStorage.getItem(GRID_KEY)) ?? {}; } catch { return {}; } },
    get(inst) { return this.all()[inst] ?? {}; },
    set(inst, state) { try { const all = this.all(); all[inst] = state; localStorage.setItem(GRID_KEY, JSON.stringify(all)); } catch {} },
  };

  const cardIds = (box) => [...box.querySelectorAll(':scope > [data-card]')].map((el) => el.dataset.card);

  // place the cards of one .x-cards box; called after every render and on resize
  function applyGrid(box) {
    const inst = box.dataset.inst;
    if (!inst) return;
    const bp = gridBreakpoint(box.clientWidth || 1280);
    const cols = GRID.cols[bp];
    const saved = gridStore.get(inst);
    const items = box._drag?.items ?? gridLayout(cardIds(box), bp, saved);
    // stretch rows so the cards reach the bottom of the window (never below XMCL's 32px; short windows scroll)
    const rows = Math.max(1, ...items.map((i) => i.y + i.h));
    // Hero keeps its instance strip at the bottom, so the cards stop above it
    const bottom = box.closest('.hero')?.querySelector(':scope > .rail')?.getBoundingClientRect().top || innerHeight;
    const free = bottom - box.getBoundingClientRect().top - 24;
    const rowH = Math.max(GRID.row, Math.floor((free - GRID.gap * (rows - 1)) / rows));
    box._grid = { bp, cols, items, rowH };
    box.style.setProperty('--cols', cols);
    box.style.setProperty('--row', `${rowH}px`);
    box.classList.add('x-grid');
    for (const el of box.querySelectorAll(':scope > [data-card]')) {
      const it = items.find((i) => i.id === el.dataset.card);
      el.hidden = !it;
      if (!it) continue;
      const area = `${it.y + 1} / ${it.x + 1} / span ${it.h} / span ${it.w}`;
      if (el.style.gridArea !== area) el.style.gridArea = area;
      if (!el.querySelector(':scope > .x-card-resize')) el.insertAdjacentHTML('beforeend', '<span class="x-card-resize" title="Drag to resize"></span>');
    }
    if (!box._wired) wireGrid(box);
  }

  function saveGrid(box) {
    const { bp, items } = box._grid;
    const state = gridStore.get(box.dataset.inst);
    for (const it of items) {
      state[it.id] = { ...state[it.id], layout: { ...state[it.id]?.layout, [bp]: { x: it.x, y: it.y, w: it.w, h: it.h } } };
    }
    gridStore.set(box.dataset.inst, state);
  }

  function wireGrid(box) {
    box._wired = true;
    const ro = new ResizeObserver(() => box._grid && !box._drag && (gridBreakpoint(box.clientWidth) !== box._grid.bp || box.closest('.hero')) && applyGrid(box));
    ro.observe(box);
    // Hero: the space between header and instance strip changes when the header fills in
    if (box.closest('.hero')) ro.observe(box.closest('.x-home-view'));
    let resizing;
    addEventListener('resize', () => { clearTimeout(resizing); resizing = setTimeout(() => box.isConnected && !box._drag && applyGrid(box), 100); });

    // drag by the title, resize by the corner; cells are (width - gaps) / cols wide and 32px tall
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const handle = e.target.closest('.x-card-resize');
      const title = !handle && e.target.closest('.x-card-title, .x-shot-head');
      const el = (handle || title)?.closest('[data-card]');
      if (!el || el.parentElement !== box) return;
      const { cols } = box._grid;
      const base = box._grid.items.map((i) => ({ ...i }));
      const it = base.find((i) => i.id === el.dataset.card);
      const rect = box.getBoundingClientRect();
      const colW = (rect.width - GRID.gap * (cols - 1)) / cols;
      const start = { x: e.clientX, y: e.clientY, it: { ...it } };
      let moved = false;
      box._drag = { items: base };
      const onMove = (ev) => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 6) return;
        moved = true;
        box.classList.add('x-grid-busy');
        el.classList.add(handle ? 'x-resizing' : 'x-dragging');
        const cx = Math.round(dx / (colW + GRID.gap)), cy = Math.round(dy / (box._grid.rowH + GRID.gap));
        const geo = handle ? { w: start.it.w + cx, h: start.it.h + cy } : { x: start.it.x + cx, y: start.it.y + cy };
        // start from the layout as it was, so cards spring back when the dragged one moves on
        const fresh = base.map((i) => ({ ...i }));
        const target = fresh.find((i) => i.id === it.id);
        box._drag.items = gridPlace(fresh, target, geo, cols);
        applyGrid(box);
      };
      const onUp = () => {
        removeEventListener('pointermove', onMove);
        removeEventListener('pointerup', onUp);
        el.classList.remove('x-dragging', 'x-resizing');
        box.classList.remove('x-grid-busy');
        if (moved) {
          box._grid.items = box._drag.items;
          box._drag = null;
          saveGrid(box);
          applyGrid(box);
          // the click that ends a drag shouldn't open the card
          const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
          box.addEventListener('click', swallow, { capture: true, once: true });
          setTimeout(() => box.removeEventListener('click', swallow, { capture: true }), 0);
        } else box._drag = null;
      };
      addEventListener('pointermove', onMove);
      addEventListener('pointerup', onUp);
    });

    // right-click: hide this card, bring hidden ones back, or reset (XMCL's card / background menus)
    box.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const el = e.target.closest('[data-card]');
      const inst = box.dataset.inst;
      const state = gridStore.get(inst);
      const hidden = cardIds(box).filter((id) => state[id]?.hidden);
      const label = (id) => box.querySelector(`[data-card="${id}"]`)?.dataset.label ?? id;
      const items = [];
      if (el) items.push([`Hide ${label(el.dataset.card)}`, () => { state[el.dataset.card] = { ...state[el.dataset.card], hidden: true }; }]);
      for (const id of hidden) items.push([`Show ${label(id)}`, () => { state[id] = { ...state[id], hidden: false }; }]);
      items.push(['Reset layout', () => { for (const id of Object.keys(state)) delete state[id]; }]);
      showMenu(e.clientX, e.clientY, items.map(([text, fn]) => [text, () => { fn(); gridStore.set(inst, state); applyGrid(box); }]));
    });
  }

  function showMenu(x, y, items) {
    document.querySelector('.x-menu')?.remove();
    const m = document.createElement('div');
    m.className = 'x-menu';
    m.innerHTML = items.map(([t], i) => `<button data-i="${i}">${esc(t)}</button>`).join('');
    document.body.append(m);
    m.style.left = `${Math.min(x, innerWidth - m.offsetWidth - 8)}px`;
    m.style.top = `${Math.min(y, innerHeight - m.offsetHeight - 8)}px`;
    const close = () => { m.remove(); removeEventListener('pointerdown', away, true); };
    const away = (e) => { if (!m.contains(e.target)) close(); };
    addEventListener('pointerdown', away, true);
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) { items[+b.dataset.i][1](); close(); }
    });
  }

  // ---------- background: pause animated pictures and videos ----------

  let bgStill = null;
  function bgImageURL() {
    const v = getComputedStyle(html).getPropertyValue('--bg-image');
    return v.match(/url\(["']?(.*?)["']?\)/)?.[1] || null;
  }

  function syncBackground() {
    const video = document.querySelector('video[aria-hidden="true"]');
    if (video) paused ? video.pause() : video.play().catch(() => {});

    const url = bgImageURL();
    const gif = url && /\.gif(\?|$)/i.test(url);
    if (!gif) {
      bgStill?.remove();
      bgStill = null;
    } else if (bgStill?.dataset.src !== url) {
      bgStill?.remove();
      const canvas = (bgStill = document.createElement('canvas'));
      canvas.className = 'x-bg-still';
      canvas.dataset.src = url;
      document.body.prepend(canvas);
      // keep the loader referenced from the canvas so it isn't collected before onload
      const img = (canvas.loader = new Image());
      img.onload = () => {
        // drawn at the picture's own size (capped); CSS object-fit: cover matches Alloy's `center / cover`.
        // The window can still be 0×0 here, so its size is no use.
        const s = Math.min(1, 2560 / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * s);
        canvas.height = Math.round(img.naturalHeight * s);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.style.filter = getComputedStyle(document.body, '::before').filter;
        canvas.dataset.ready = '1';
        canvas.loader = null;
        syncBackground();
      };
      img.src = url;
    }
    // only swap to the still frame once it's drawn, so the background never goes blank
    html.classList.toggle('x-bg-frozen', !!(paused && bgStill?.dataset.ready));
    // over a picture or video the cards turn to glass so the background shows through
    html.classList.toggle('x-has-bg', !!(url || video));
    html.classList.toggle('x-light', isLightScheme());
    syncPictureAccent(url);
  }

  // Alloy's Light scheme (or light custom colours): judged from the page background's brightness
  const probe = document.createElement('i');
  function isLightScheme() {
    probe.style.color = 'var(--bg)';
    if (!probe.isConnected) { probe.hidden = true; document.documentElement.append(probe); }
    const [r, g, b] = (getComputedStyle(probe).color.match(/[\d.]+/g) || []).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
  }

  // ---------- accent colour taken from the background picture ----------

  // the loader decodes the picture (the page may not read its pixels) and answers "#vivid #dark" or "none"
  const pictureColours = new Map();
  let accentStyle = null;
  function syncPictureAccent(url) {
    const file = url && prefs.pictureAccent === 'on' ? assetPath(url) : null;
    const colours = file && pictureColours.get(file);
    if (file && colours === undefined) {
      pictureColours.set(file, null);
      window.webkit?.messageHandlers?.alloyskin?.postMessage(`PX\n${file}`)
        .then((r) => pictureColours.set(file, r === 'none' ? null : r.split(' ')))
        .catch(() => {})
        .finally(update);
    }
    const css = colours ? accentCSS(colours[0]) : '';
    if ((accentStyle?.textContent || '') === css) return;
    if (!accentStyle) {
      accentStyle = document.createElement('style');
      accentStyle.id = 'x-picture-accent';
      document.head.append(accentStyle);
    }
    accentStyle.textContent = css;
  }

  function assetPath(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'asset:' && u.hostname !== 'asset.localhost') return null;
      return decodeURIComponent(u.pathname).replace(/^\/+/, '/');
    } catch { return null; }
  }

  // Alloy sets the scheme inline on <html>; an !important sheet rule outranks it and drops out cleanly
  function accentCSS(hex) {
    const mix = (pct, to) => `color-mix(in srgb, ${hex} ${pct}%, ${to})`;
    return `html:root {
      --accent: ${hex} !important;
      --accent-hover: ${mix(82, 'white')} !important;
      --accent-text: ${mix(55, 'var(--text)')} !important;
      --accent-soft: ${mix(18, 'transparent')} !important;
    }`;
  }

  // ---------- XMCL background effects ----------

  let fx = null;
  let particles = null;

  const isVideo = (f) => /\.(mp4|webm)$/i.test(f);
  function syncEffect() {
    const key = prefs.effect === 'custom' ? `custom:${prefs.fxFile}` : prefs.effect;
    if (fx?.dataset.key !== key) {
      fx?.remove();
      fx = null;
      particles = null;
      if (prefs.effect === 'particles') {
        fx = document.createElement('div');
        fx.className = 'x-fx x-fx-particles';
        const canvas = document.createElement('canvas');
        fx.append(canvas);
        particles = startParticles(canvas);
      } else if (prefs.effect === 'custom' && prefs.fxFile) {
        // your own effect: a looping GIF/APNG/WebP or a muted video over the background, under the panels
        fx = document.createElement('div');
        fx.className = 'x-fx x-fx-custom';
        const url = asset(prefs.fxFile);
        if (isVideo(prefs.fxFile)) {
          const v = document.createElement('video');
          Object.assign(v, { src: url, loop: true, muted: true, playsInline: true, autoplay: true });
          fx.append(v);
          particles = (stop) => (stop ? v.pause() : v.play().catch(() => {}));
        } else {
          fx.innerHTML = `<canvas class="x-fx-still"></canvas><img class="x-fx-anim" alt="" src="${esc(url)}">`;
          drawStill(fx.querySelector('canvas'), url);
          // a hidden <img> doesn't animate, so the still frame costs nothing while paused
          particles = (stop) => fx?.classList.toggle('x-fx-paused', stop);
        }
      }
      if (fx) {
        fx.dataset.key = key;
        document.body.append(fx);
      }
    }
    if (fx?.classList.contains('x-fx-custom')) {
      fx.style.setProperty('--x-fx-opacity', String(prefs.fxStrength));
      fx.dataset.blend = prefs.fxBlend;
    }
    particles?.(paused);
    // cards turn see-through only while an effect is drawn behind them (solid cards scroll cheaper)
    html.classList.toggle('x-has-fx', !!fx);
  }

  // pick a file for "Your own" and let the loader copy it where the page may show it
  async function chooseEffectFile() {
    const picked = await T.invoke('plugin:dialog|open', { options: { multiple: false, directory: false, title: 'Choose an effect (GIF, MP4, WebM, PNG, WebP)',
      filters: [{ name: 'Effects', extensions: ['gif', 'mp4', 'webm', 'png', 'apng', 'webp'] }] } }).catch(() => null);
    const src = typeof picked === 'string' ? picked : picked?.path;
    if (!src) return;
    try {
      const dest = await window.webkit.messageHandlers.alloyskin.postMessage(`FXCOPY\n${src}`);
      prefs.fxFile = dest;
      setPref('effect', 'custom');
    } catch (e) {
      window.__xcf?.toast(String(e?.message ?? e), 'err');
    }
  }

  // slow drifting dots; ~20 fps, stopped completely while paused
  function startParticles(canvas) {
    const ctx = canvas.getContext('2d');
    let dots = [], raf = 0, last = 0, w = 0, h = 0;
    function resize() {
      w = canvas.width = Math.round(innerWidth / 1.5);
      h = canvas.height = Math.round(innerHeight / 1.5);
      const n = Math.round((w * h) / 9000);
      dots = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 1 + Math.random() * 2.2,
        vy: -(0.1 + Math.random() * 0.3),
        sway: Math.random() * Math.PI * 2,
        a: 0.35 + Math.random() * 0.5,
        teal: Math.random() < 0.3,
      }));
    }
    function frame(t) {
      raf = requestAnimationFrame(frame);
      if (t - last < 50) return;
      const dt = Math.min((t - last) / 16.7, 3);
      last = t;
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.y += d.vy * dt;
        d.sway += 0.01 * dt;
        d.x += Math.sin(d.sway) * 0.15 * dt;
        if (d.y < -4) { d.y = h + 4; d.x = Math.random() * w; }
        ctx.globalAlpha = d.a;
        ctx.fillStyle = d.teal ? '#1de9b6' : '#ffffff';
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    resize();
    addEventListener('resize', resize);
    return (stop) => {
      if (stop) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf && canvas.isConnected) { last = 0; raf = requestAnimationFrame(frame); }
    };
  }

  // ---------- Appearance page: effect and icon options ----------

  const OPTIONS = {
    effect: [['none', 'None'], ['particles', 'Particles'], ['custom', 'Your own']],
    fxBlend: [['normal', 'Normal'], ['screen', 'Light only']],
    icons: [['always', 'Always'], ['focused', 'While focused'], ['off', 'Off']],
    smooth: [['off', 'Instant'], ['on', 'Smooth']],
    speed: [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']],
    pictureAccent: [['on', 'On'], ['off', 'Off']],
  };

  function segmented(key) {
    return `<div class="x-seg" role="radiogroup">${OPTIONS[key]
      .map(([v, label]) => `<button role="radio" aria-checked="${prefs[key] === v}" class="${prefs[key] === v ? 'active' : ''}" data-key="${key}" data-value="${v}">${label}</button>`)
      .join('')}</div>`;
  }

  // each option lives in the Appearance card it belongs to, as a row styled like Alloy's own
  const PREF_ROWS = {
    effect: { panel: '.bg-options', title: 'Background effect', hint: "Over your background, under the panels. Pauses when Alloy isn't focused." },
    fxFile: { panel: '.bg-options', title: 'Your own effect', hint: 'A GIF, MP4, WebM, PNG or WebP that loops.', when: () => prefs.effect === 'custom', custom: 'file' },
    fxBlend: { panel: '.bg-options', title: 'Blend', hint: 'Light only hides a black background (snow, rain, sparkles).', when: () => prefs.effect === 'custom' && prefs.fxFile },
    fxStrength: { panel: '.bg-options', title: 'Strength', hint: 'How see-through the effect is.', when: () => prefs.effect === 'custom' && prefs.fxFile, custom: 'range' },
    pictureAccent: { panel: '.bg-options', title: 'Match accent to picture', hint: "Buttons and highlights take the picture's main colour." },
    icons: { panel: '.layouts', title: 'Animated instance icons', hint: 'GIF icons play from a small, light copy.' },
    speed: { panel: '.layouts', title: 'Scroll speed', hint: 'How far one wheel notch moves.' },
    smooth: { panel: '.layouts', title: 'Scrolling', hint: 'Smooth glides to each step instead of jumping.' },
  };

  function renderSettings() {
    const sections = document.querySelector('main.content .sections');
    if (!sections?.querySelector('.layouts')) return; // only on the Appearance page
    for (const [key, row] of Object.entries(PREF_ROWS)) {
      const panel = sections.querySelector(row.panel)?.closest('section.panel');
      if (!panel) continue;
      let el = panel.querySelector(`.x-pref[data-pref="${key}"]`);
      if (!el) {
        el = document.createElement('div');
        el.className = 'row x-pref';
        el.dataset.pref = key;
        el.addEventListener('click', (e) => {
          const b = e.target.closest('button[data-key]');
          if (b) setPref(b.dataset.key, b.dataset.value);
          if (e.target.closest('[data-fx="choose"]')) chooseEffectFile();
          if (e.target.closest('[data-fx="remove"]')) { prefs.fxFile = ''; setPref('effect', 'none'); }
        });
        el.addEventListener('input', (e) => {
          if (e.target.matches('input[type=range]')) { prefs.fxStrength = +e.target.value; syncEffect(); }
        });
        el.addEventListener('change', (e) => {
          if (e.target.matches('input[type=range]')) setPref('fxStrength', +e.target.value);
        });
        panel.append(el);
      }
      el.hidden = !!row.when && !row.when();
      const control = row.custom === 'file'
        ? `<div class="x-fx-pick"><span class="faint">${esc(prefs.fxFile ? prefs.fxFile.split('/').pop().replace(/^\d+-/, '') : 'No file chosen')}</span><button class="btn" data-fx="choose">Choose file…</button>${prefs.fxFile ? '<button class="btn btn-ghost" data-fx="remove">Remove</button>' : ''}</div>`
        : row.custom === 'range'
          ? `<input type="range" min="0.2" max="1" step="0.05" value="${prefs.fxStrength}">`
          : segmented(key);
      const markup = `<span>${row.title} <span class="faint block">${row.hint}</span></span>${control}`;
      if (row.custom === 'range' && el.dataset.html && el.querySelector('input:active')) continue;
      if (el.dataset.html !== markup) {
        el.innerHTML = markup;
        el.dataset.html = markup;
      }
    }
  }

  // ---------- focus / pause state ----------

  function applyState() {
    // forceFocus: dev override used when testing without stealing window focus
    paused = ENV.forcePaused || (!ENV.forceFocus && (document.hidden || !document.hasFocus()));
    html.classList.toggle('x-paused', paused);
    html.classList.toggle('x-icons-anim', prefs.icons === 'always' || (prefs.icons === 'focused' && !paused));
    syncBackground();
    syncEffect();
  }

  // ---------- wiring ----------

  let queued = false;
  function update() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      renderRail();
      renderStats();
      syncTabs();
      renderInstanceCards();
      tagHome();
      replaceCardIcons();
      renderSettings();
      syncBackground();
    });
  }

  function start() {
    const content = document.querySelector('main.content');
    if (!content) return setTimeout(start, 200);
    // re-render when Alloy swaps pages, without watching the (large) mod lists; a layout switch rebuilds the
    // shell around main.content, so watch the shell too and follow a new main.content
    const pages = new MutationObserver(update);
    let watched = null;
    const watch = () => {
      const c = document.querySelector('main.content');
      if (!c || c === watched) return;
      watched = c;
      pages.disconnect();
      pages.observe(c, { childList: true });
      pages.observe(c.parentElement, { childList: true });
    };
    watch();
    new MutationObserver(() => { watch(); update(); }).observe(document.body, { childList: true });
    setInterval(watch, 1000);
    let lastClickRefresh = 0;
    document.addEventListener('click', () => {
      setTimeout(update, 50);
      // a click may have deleted or renamed an instance (Alloy's own dialogs); re-read the list soon after
      if (Date.now() - lastClickRefresh > 2000) { lastClickRefresh = Date.now(); setTimeout(refresh, 1200); }
    }, true);
    // Alloy rewrites --bg-image / data-bg-video on <html> when the background changes
    new MutationObserver(update).observe(html, { attributes: true, attributeFilter: ['style', 'data-bg-video'] });
    addEventListener('focus', applyState);
    addEventListener('blur', applyState);
    document.addEventListener('visibilitychange', () => {
      applyState();
      if (!document.hidden) refresh();
    });
    setInterval(() => !document.hidden && refresh(), 15000);
    // Alloy announces creates, deletes and renames; follow them at once instead of on the next 15 s tick
    for (const event of ['instances:changed', 'game:exit', 'launch:started'])
      T.invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler: T.transformCallback(() => setTimeout(refresh, 150)) }).catch(() => {});
    // the loader swaps in edited skin scripts; pick them up by reloading while nobody is looking at the window
    const bridge = window.webkit?.messageHandlers?.alloyskin;
    let gen = null;
    if (bridge) setInterval(() => {
      bridge.postMessage('GEN').then((g) => {
        if (gen === null) gen = g;
        else if (g !== gen && !document.hasFocus()) location.reload();
      }).catch(() => {});
    }, 3000);
    applyState();
    applySmooth();
    refresh();
  }
  start();
})();
