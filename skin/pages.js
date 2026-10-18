// Extra pages for Alloy, injected after xmcl.js and curseforge.js by ~/.local/lib/alloy-skin/alloyskin.so.
//  - instance cards (Home / instance page): live log tail with the last crash, saved servers with ping + Join
//  - two rail pages under Appearance: Modpacks (Prism's "new instance from a platform") and Logs (Prism's console)
(() => {
  const T = window.__TAURI_INTERNALS__;
  if (!T) return;
  window.__xpages = true; // xmcl.js only draws the Logs/Servers cards when this script is running

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n ?? 0));
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
  const content = () => document.querySelector('main.content');
  const invoke = (cmd, args) => T.invoke(cmd, args);

  const ICON = {
    logs: 'M20 4H4c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2zm0 14H4V8h16v10zm-2-1h-6v-2h6v2zM7.5 17l-1.41-1.41L8.67 13l-2.59-2.59L7.5 9l4 4-4 4z',
    pack: 'M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z',
    dns: 'M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM7 19c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM20 3H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1zM7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
    folder: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
    open: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
    warn: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
    add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    cube: 'M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3L18.7 8 12 11.7 5.3 8 12 4.3zM5 9.7l6 3.3v6.6l-6-3.3V9.7zm8 9.9V13l6-3.3v6.6l-6 3.3z',
    upload: 'M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z',
    tune: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
    import: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  };

  // ---------- Alloy's game events ----------

  function listen(event, fn) {
    return invoke('plugin:event|listen', { event, target: { kind: 'Any' }, handler: T.transformCallback((e) => fn(e.payload)) }).catch(() => {});
  }

  let running = new Set();
  const refreshRunning = () => invoke('running_instances').then((r) => {
    running = new Set((r || []).map((x) => (typeof x === 'string' ? x : x.id ?? x.instanceId)));
  }).catch(() => {});

  // ---------- logs: latest.log once, then live lines from Alloy ----------

  const MAX = 4000;
  const logs = new Map(); // instance id -> { lines, subs, loaded }

  function level(text, prev) {
    const m = text.match(/\/(INFO|WARN|ERROR|FATAL|DEBUG|TRACE)\]/);
    if (m) return m[1] === 'WARN' ? 'warn' : m[1] === 'ERROR' || m[1] === 'FATAL' ? 'err' : 'info';
    if (/^\s+(at |\.\.\. \d+ more)|^Caused by:|^[\w.$]+(Exception|Error)\b/.test(text)) return prev === 'warn' ? 'warn' : 'err';
    return prev ?? 'info';
  }

  function push(log, text) {
    const line = { text, lvl: level(text, log.lines[log.lines.length - 1]?.lvl) };
    log.lines.push(line);
    if (log.lines.length > MAX) log.lines.splice(0, log.lines.length - MAX);
    return line;
  }

  function logOf(id) {
    let log = logs.get(id);
    if (!log) logs.set(id, (log = { lines: [], subs: new Set(), loaded: null }));
    if (!log.loaded) log.loaded = loadFile(id, log);
    return log;
  }

  async function loadFile(id, log) {
    try {
      const dir = await invoke('instance_dir', { id });
      const bytes = await invoke('read_instance_file', { id, path: `${dir}/logs/latest.log` });
      const all = new Uint8Array(bytes);
      // only the tail matters, and decoding megabytes of log is slow
      const tail = all.subarray(Math.max(0, all.length - 256 * 1024));
      const lines = new TextDecoder().decode(tail).split(/\r?\n/);
      if (tail.length < all.length) lines.shift();
      log.lines = [];
      for (const t of lines) if (t) push(log, t);
    } catch {
      log.lines = [];
    }
    log.subs.forEach((f) => f(null));
  }

  listen('game:log', (p) => {
    const log = logs.get(p?.instanceId);
    if (!log || !p.line) return;
    const line = push(log, String(p.line));
    log.subs.forEach((f) => f(line));
  });
  const startedAt = new Map(); // instance id -> ms, for "Running · 12 min"
  listen('launch:started', (id) => {
    running.add(id);
    startedAt.set(id, Date.now());
    const log = logs.get(id);
    if (log) { log.lines = []; log.subs.forEach((f) => f(null)); }
    crashes.delete(id);
    schedule();
  });
  listen('game:exit', (p) => {
    running.delete(p?.instanceId);
    startedAt.delete(p?.instanceId);
    crashes.delete(p?.instanceId);
    schedule();
  });

  // ---------- the last crash, explained by Alloy's own analyser ----------

  const crashes = new Map(); // instance id -> Promise<{ text } | null>
  function crashOf(id) {
    if (crashes.has(id)) return crashes.get(id);
    const job = (async () => {
      const exits = await invoke('last_exits').catch(() => []);
      const exit = (exits || []).find((e) => e.instanceId === id);
      if (!exit || exit.code === 0 || exit.code == null) return null;
      const log = logOf(id);
      await log.loaded;
      let text = `Minecraft exited with code ${exit.code}`;
      try {
        const a = await invoke('analyse_crash', { id, startedAtMs: exit.startedAtMs, output: log.lines.slice(-400).map((l) => l.text).join('\n') });
        const s = a?.summary ?? a?.title ?? a?.cause ?? a?.message;
        if (s) text = String(s);
      } catch {}
      return { text, code: exit.code };
    })();
    crashes.set(id, job);
    return job;
  }

  // a <pre> that shows an instance's log and keeps following it; repeats of the same message fold into one line with ×N
  const repeatKey = (text) => text.replace(/^\[\d\d:\d\d:\d\d\] /, '');
  function mountLog(pre, id, opts = {}) {
    const log = logOf(id);
    const keep = opts.keep ?? 80;
    const match = (l) => (!opts.levels || opts.levels.has(l.lvl)) && (!opts.q || l.text.toLowerCase().includes(opts.q));
    const lineHTML = (l, n) => `<span class="${l.lvl}" data-k="${esc(repeatKey(l.text))}">${esc(l.text)}${n > 1 ? `<b class="x-rep">×${n.toLocaleString()}</b>` : ''}</span>\n`;
    const fold = (lines) => {
      const out = [];
      for (const l of lines) {
        const last = out[out.length - 1];
        if (opts.collapse !== false && last && repeatKey(last.l.text) === repeatKey(l.text)) last.n++;
        else out.push({ l, n: 1 });
      }
      return out;
    };
    let queue = [];
    let frame = 0;
    const atBottom = () => pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
    const full = () => {
      const html = fold(log.lines.filter(match)).slice(-keep).map((g) => lineHTML(g.l, g.n)).join('');
      pre.innerHTML = html || '<span class="info">No log yet.</span>';
      if (html) delete pre.dataset.empty;
      else pre.dataset.empty = '1';
      pre.scrollTop = pre.scrollHeight;
    };
    const flush = () => {
      frame = 0;
      const follow = opts.follow !== false && atBottom();
      if (pre.dataset.empty) { pre.innerHTML = ''; delete pre.dataset.empty; }
      let html = '';
      for (const l of queue.filter(match)) {
        const last = pre.lastElementChild;
        if (!html && opts.collapse !== false && last && last.dataset.k === repeatKey(l.text)) {
          const n = (parseInt(last.dataset.n || '1', 10) || 1) + 1;
          last.dataset.n = n;
          let badge = last.querySelector('.x-rep');
          if (!badge) last.insertAdjacentHTML('beforeend', '<b class="x-rep"></b>');
          last.querySelector('.x-rep').textContent = `×${n.toLocaleString()}`;
        } else html += lineHTML(l, 1);
      }
      if (html) pre.insertAdjacentHTML('beforeend', html);
      queue = [];
      while (pre.childElementCount > keep) pre.firstElementChild.remove();
      if (follow) pre.scrollTop = pre.scrollHeight;
    };
    const sub = (line) => {
      if (!pre.isConnected) return log.subs.delete(sub);
      if (!line) return full();
      queue.push(line);
      if (!frame) frame = requestAnimationFrame(flush);
    };
    log.subs.add(sub);
    full();
    return { refresh: full, stop: () => log.subs.delete(sub) };
  }

  // Prism's "Upload": Alloy's own share_log sends it to mclo.gs with IPs, user names and tokens removed
  async function uploadLog(id, btn) {
    const label = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
    try {
      const exit = ((await invoke('last_exits').catch(() => [])) || []).find((e) => e.instanceId === id);
      let r = null, err = null;
      for (const kind of ['latest', 'log', 'game']) {
        try { r = await invoke('share_log', { id, kind, startedAtMs: exit?.startedAtMs ?? null }); break; } catch (e) { err = e; }
      }
      const url = typeof r === 'string' ? r : r?.url ?? r?.link;
      if (!url) throw err ?? new Error('mclo.gs gave no link');
      await invoke('plugin:clipboard-manager|write_text', { text: url }).catch(() => navigator.clipboard?.writeText(url));
      toastLink(`Uploaded to mclo.gs, link copied`, url);
    } catch (e) {
      window.__xcf?.toast(`Upload failed: ${e?.message ?? e}`, 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = label; }
    }
  }

  function toastLink(text, url) {
    const t = document.createElement('div');
    t.className = 'x-cf-toast ok x-toast-link';
    t.innerHTML = `<span>${esc(text)}</span><button class="btn btn-ghost">Open</button>`;
    t.querySelector('button').onclick = () => invoke('open_link', { url }).catch(() => {});
    document.body.append(t);
    setTimeout(() => t.remove(), 8000);
  }

  // ---------- instance cards: Logs + Servers ----------

  const nameOf = (id) => instancesCache.find((i) => i.id === id)?.name ?? '';
  let instancesCache = [];
  const loadInstances = () => invoke('list_instances').then((l) => (instancesCache = l || [])).catch(() => instancesCache);

  function logsCard(el) {
    const id = el.dataset.xLogs;
    if (!id || el.dataset.ready === id) return;
    el.dataset.ready = id;
    el.innerHTML = `<span class="x-card-title">${svg(ICON.logs)}Logs<span class="x-live"${running.has(id) ? '' : ' hidden'}>live</span></span>
      <div class="x-crash" hidden></div>
      <pre class="x-log"></pre>
      <span class="x-card-foot"><span class="x-card-btn" data-act="folder">${svg(ICON.folder)}Folder</span><span class="x-card-btn" data-act="upload">${svg(ICON.upload)}Upload</span><span class="x-card-btn x-card-action" data-act="console">${svg(ICON.open)}Open console</span></span>`;
    mountLog(el.querySelector('pre'), id, { keep: 60 });
    crashOf(id).then((c) => {
      const box = el.querySelector('.x-crash');
      if (!c || !box) return;
      box.hidden = false;
      box.innerHTML = `${svg(ICON.warn)}<span><b>Last run crashed</b>${esc(c.text)}</span>`;
    });
    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'folder') invoke('open_instance_folder', { id, sub: 'logs' }).catch(() => {});
      if (act === 'console') openPage('logs', { inst: id });
      if (act === 'upload') uploadLog(id, e.target.closest('[data-act]'));
    });
  }

  const pings = new Map(); // address -> { at, status, error }
  let serverList = null, serverAt = 0;

  async function loadServers() {
    if (serverList && Date.now() - serverAt < 60000) return serverList;
    serverAt = Date.now();
    const r = await invoke('list_servers').catch(() => []);
    serverList = Array.isArray(r) ? r : r?.servers ?? [];
    const stale = serverList.map((s) => s.address).filter((a) => !pings.has(a) || Date.now() - pings.get(a).at > 60000);
    if (stale.length) {
      invoke('ping_servers', { addresses: stale }).then((res) => {
        for (const p of res || []) pings.set(p.address, { at: Date.now(), status: p.status, error: p.error });
        document.querySelectorAll('[data-x-servers]').forEach((el) => { el.dataset.ready = ''; serversCard(el); });
        document.querySelectorAll('[data-x-pill]').forEach(serverPill);
      }).catch(() => {});
    }
    return serverList;
  }

  // Hero's small "Cytra smp · 6/67 online · Join" pill: the first saved server
  async function serverPill(el) {
    const id = el.dataset.xPill;
    const s = (await loadServers())[0];
    if (!s) { el.hidden = true; return; }
    const p = pings.get(s.address), st = p?.status;
    const state = !p ? 'pinging…' : st ? `${st.players ? `${st.players.online ?? 0}/${st.players.max ?? 0} online` : 'online'}${st.latencyMs != null ? ` · ${st.latencyMs} ms` : ''}` : 'offline';
    const icon = st?.favicon && /^data:image\//.test(st.favicon) ? `<img src="${esc(st.favicon)}" alt="">` : `<i>${svg(ICON.dns)}</i>`;
    const html = `${icon}<span class="x-pill-text"><b>${esc(s.name || s.address)}</b><small><i class="x-pill-dot${st ? ' on' : p ? ' off' : ''}"></i>${state}</small></span>` +
      `<button class="x-pill-join" data-join="${esc(s.address)}"${running.has(id) || !id || (p && !st) ? ' disabled' : ''}>Join</button>`;
    el.hidden = false;
    if (el.dataset.html === html) return;
    el.dataset.html = html;
    el.innerHTML = html;
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    el.addEventListener('click', (e) => {
      const join = e.target.closest('[data-join]');
      if (!join || join.disabled) return;
      join.disabled = true;
      join.textContent = 'Starting…';
      invoke('launch_instance', { id: el.dataset.xPill, options: { server: join.dataset.join } }).catch((err) => {
        join.disabled = false;
        join.textContent = 'Join';
        window.__xcf?.toast(String(err?.message ?? err), 'err');
      });
    });
  }

  async function serversCard(el) {
    const id = el.dataset.xServers;
    const list = await loadServers();
    const markup = list.length
      ? `<ul class="x-servers">${list.map((s) => {
          const p = pings.get(s.address);
          const st = p?.status;
          const players = st?.players ? `${st.players.online ?? 0}/${st.players.max ?? 0}` : '';
          const state = !p ? '<em>pinging…</em>' : st ? `<em class="on">${players}${st.latencyMs != null ? ` · ${st.latencyMs} ms` : ''}</em>` : '<em class="off">offline</em>';
          const icon = st?.favicon && /^data:image\//.test(st.favicon) ? `<img src="${esc(st.favicon)}" alt="">` : `<i>${svg(ICON.dns)}</i>`;
          return `<li>${icon}<span class="x-srv"><b>${esc(s.name || s.address)}</b><small>${esc(st?.motdPlain?.replace(/\s+/g, ' ').trim() || s.address)}</small></span>${state}<button class="btn btn-ghost" data-join="${esc(s.address)}"${running.has(id) || !id ? ' disabled' : ''}>Join</button></li>`;
        }).join('')}</ul>`
      : '<p class="x-card-sub">No saved servers yet. Add one on the Servers page.</p>';
    const html = `<span class="x-card-title">${svg(ICON.dns)}Servers</span><div class="x-card-text">${markup}</div>
      <span class="x-card-foot"><span class="x-card-btn" data-act="servers">${svg(ICON.open)}Manage</span></span>`;
    if (el.dataset.html === html) return;
    el.dataset.html = html;
    el.innerHTML = html;
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    el.addEventListener('click', (e) => {
      const join = e.target.closest('[data-join]');
      if (join && !join.disabled) {
        join.disabled = true;
        join.textContent = 'Starting…';
        invoke('launch_instance', { id: el.dataset.xServers, options: { server: join.dataset.join } }).catch((err) => {
          join.disabled = false;
          join.textContent = 'Join';
          window.__xcf?.toast(String(err?.message ?? err), 'err');
        });
      }
      if (e.target.closest('[data-act="servers"]')) {
        closePage();
        document.querySelectorAll('nav.sidebar ul .nav, nav.topbar ul .item')[3]?.click();
      }
    });
  }

  function hydrateCards() {
    document.querySelectorAll('main.content [data-x-logs]').forEach(logsCard);
    document.querySelectorAll('main.content [data-x-pill]').forEach((el) => el.dataset.for !== el.dataset.xPill && ((el.dataset.for = el.dataset.xPill), serverPill(el)));
    document.querySelectorAll('main.content [data-x-servers]').forEach((el) => {
      if (el.dataset.ready === '1') return;
      el.dataset.ready = '1';
      serversCard(el);
    });
    document.querySelectorAll('main.content .x-card-logs .x-live').forEach((b) => (b.hidden = !running.has(b.closest('[data-x-logs]')?.dataset.xLogs)));
  }

  // "Running · 12 min" next to the launch button, like XMCL's launch status
  function runState() {
    const c = content();
    const name = c?.querySelector('.x-home-view')?.dataset.inst ?? c?.querySelector('header.head h1')?.textContent.trim();
    const host = c?.querySelector('header.head .head-actions') ?? c?.querySelector('.x-hero .play:not(button), .hero > .centre.x-hero > .actions');
    if (!host) return;
    const id = instancesCache.find((i) => i.name === name)?.id;
    let tag = host.querySelector(':scope > .x-runstate');
    if (!id || !running.has(id)) return tag?.remove();
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'x-runstate';
      host.querySelector(':scope > button.play')?.before(tag);
    }
    const mins = startedAt.has(id) ? Math.floor((Date.now() - startedAt.get(id)) / 60000) : null;
    const text = mins == null ? 'Running' : `Running · ${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`}`;
    if (tag.textContent !== text) tag.textContent = text;
  }
  setInterval(() => document.hasFocus() && runState(), 30000);

  // ---------- Skins page: use a player's skin by name, and a gallery of skins ----------

  const skinRender = (name, size) => `https://mc-heads.net/body/${encodeURIComponent(name)}/${size}`;

  async function activeAccount() {
    const accounts = await invoke('list_accounts').catch(() => null);
    const accs = Array.isArray(accounts) ? accounts : accounts?.accounts ?? [];
    return accounts?.active ?? accounts?.activeId ?? accs.find((a) => a.active)?.id ?? accs[0]?.id;
  }
  // Alloy's Classic/Slim switch on the Skins page
  const armStyle = () => ([...content().querySelectorAll('.seg button')].find((b) => /^slim$/i.test(b.textContent.trim()))?.classList.contains('active') ? 'slim' : 'classic');
  const refreshSkins = () => [...content().querySelectorAll('button')].find((b) => /^refresh$/i.test(b.textContent.trim()))?.click();

  // a gallery skin is just a Mojang texture; Alloy uploads it to the account like any skin link
  async function useTexture(texture, label, btn) {
    const text = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try {
      const accountId = await activeAccount();
      if (!accountId) throw new Error('Sign in to a Microsoft account first');
      await invoke('set_skin_from_url', { accountId, url: `https://textures.minecraft.net/texture/${texture}`, variant: armStyle() });
      window.__xcf?.toast(`Now wearing ${label}`, 'ok');
      refreshSkins();
    } catch (e) {
      window.__xcf?.toast(String(e?.message ?? e), 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = text; }
    }
  }

  async function useSkinByName(name, btn) {
    if (!/^\w{1,16}$/.test(name)) return window.__xcf?.toast('Names are 1 to 16 letters, numbers or underscores', 'err');
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    try {
      const added = await invoke('add_skin_from_username', { username: name });
      const list = Array.isArray(added) ? added : added?.skins ?? added?.library ?? [added];
      const skin = list.find((x) => x?.name?.toLowerCase() === name.toLowerCase()) ?? list[list.length - 1];
      const accountId = await activeAccount();
      if (skin?.id && accountId) {
        await invoke('use_library_skin', { accountId, skinId: skin.id });
        window.__xcf?.toast(`Now wearing ${name}'s skin`, 'ok');
      } else window.__xcf?.toast(`Added ${name}'s skin to your Library`, 'ok');
      refreshSkins();
    } catch (e) {
      window.__xcf?.toast(String(e?.message ?? e), 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  function enhanceSkins() {
    const c = content();
    if (!c || c.querySelector(':scope > h1')?.textContent.trim() !== 'Skins') return;
    // the "https://…" row becomes a player-name row with a live preview
    const url = c.querySelector('input[placeholder^="https"]');
    const row = url?.closest('form, .row');
    if (row && !row.classList.contains('x-hidden')) {
      row.classList.add('x-hidden');
      row.insertAdjacentHTML('afterend', `<div class="x-skin-name">
          <img class="x-skin-prev" alt="" hidden>
          <div class="x-skin-form"><label>Use a player's skin</label>
            <div class="x-skin-row"><input class="input" maxlength="16" placeholder="Player name, e.g. Technoblade" spellcheck="false"><button class="btn btn-primary">Use skin</button></div>
            <p class="faint small">Their current skin goes into your Library and onto your account.</p></div></div>`);
      const box = row.nextElementSibling;
      const input = box.querySelector('input'), img = box.querySelector('img');
      let typing;
      input.addEventListener('input', () => {
        clearTimeout(typing);
        typing = setTimeout(() => {
          const n = input.value.trim();
          img.hidden = !/^\w{3,16}$/.test(n);
          if (!img.hidden) img.src = skinRender(n, 120);
        }, 350);
      });
      img.addEventListener('error', () => (img.hidden = true));
      box.querySelector('button').addEventListener('click', (e) => { e.preventDefault(); useSkinByName(input.value.trim(), e.currentTarget); });
      input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), useSkinByName(input.value.trim(), box.querySelector('button'))));
    }
    // an endless, searchable MineSkin gallery fills the space under the viewer
    const layout = c.querySelector(':scope > .layout');
    if (layout && !c.querySelector(':scope > .x-pop')) {
      layout.insertAdjacentHTML('afterend', `<section class="x-pop">
          <div class="x-pop-head"><h2 class="x-pop-title">Browse skins</h2><input class="input" placeholder="Search skins" spellcheck="false"></div>
          <ul data-list="browse"></ul><p class="x-pop-more faint small"></p></section>`);
      wireGallery(c.querySelector(':scope > .x-pop'));
    }
  }

  // MineSkin's public gallery: newest first, searchable, paged with an "after" cursor
  function wireGallery(pop) {
    const list = pop.querySelector('[data-list="browse"]'), more = pop.querySelector('.x-pop-more'), search = pop.querySelector('.x-pop-head input');
    const st = { q: '', after: null, done: false, loading: false, gen: 0, started: false };
    const load = async () => {
      if (st.loading || st.done) return;
      st.loading = true;
      const gen = st.gen;
      more.textContent = 'Loading skins…';
      try {
        const q = `?size=48${st.q ? `&filter=${encodeURIComponent(st.q)}` : ''}${st.after ? `&after=${encodeURIComponent(st.after)}` : ''}`;
        const r = JSON.parse(await bridgeCall(`MSK\n${q}`));
        if (gen !== st.gen) return;
        const skins = (r.skins ?? []).filter((x) => /^[0-9a-f]{40,80}$/.test(x.texture ?? ''));
        list.insertAdjacentHTML('beforeend', skins.map((x) => `<li data-texture="${x.texture}" data-label="${esc(x.name || 'this skin')}"><img src="${skinRender(x.texture, 110)}" alt="" decoding="async">${x.name ? `<span>${esc(x.name)}</span>` : ''}<button class="btn" data-use>Use</button></li>`).join(''));
        st.after = r.pagination?.next?.after ?? null;
        st.done = !st.after || !skins.length;
        more.textContent = st.done ? (list.children.length ? '' : 'No skins found') : 'Loading more…';
      } catch (e) {
        if (gen === st.gen) { more.textContent = `MineSkin: ${e?.message ?? e}`; st.done = true; }
      } finally {
        if (gen === st.gen) st.loading = false;
      }
    };
    const reset = () => { st.gen++; st.after = null; st.done = false; st.loading = false; list.innerHTML = ''; load(); };
    new IntersectionObserver((en) => en.some((x) => x.isIntersecting) && load(), { rootMargin: '800px' }).observe(more);
    load();
    let typing;
    search.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { st.q = search.value.trim(); reset(); }, 400); });
    pop.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      const use = e.target.closest('[data-use]');
      if (li.dataset.texture) {
        if (use) return useTexture(li.dataset.texture, li.dataset.label, use);
        const img = content().querySelector('.x-skin-name .x-skin-prev');
        if (img) { img.hidden = false; img.src = skinRender(li.dataset.texture, 120); img.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        return;
      }
    });
  }

  // our gallery hangs off main.content, so it has to go when Alloy shows another page
  function cleanupSkins() {
    const c = content();
    if (c && c.querySelector(':scope > h1')?.textContent.trim() !== 'Skins') c.querySelectorAll(':scope > .x-pop').forEach((el) => el.remove());
  }

  // ---------- rail pages ----------

  let page = null; // { name, ...opts }

  // New instance and Logs sit under Alloy's own pages: in the sidebar, or in the top bar (Hero / Card grid layouts)
  function mountRail() {
    const nav = document.querySelector('nav.sidebar, nav.topbar');
    const ul = nav?.querySelector('ul');
    if (!ul || nav.querySelector('.x-pages')) return;
    const cls = nav.classList.contains('topbar') ? 'item' : 'nav';
    const box = document.createElement('div');
    box.className = 'x-pages';
    box.innerHTML = `<button class="${cls} x-pagebtn" data-page="new" title="New instance">${svg(ICON.add)}<span>New instance</span></button>` +
      `<button class="${cls} x-pagebtn" data-page="logs" title="Logs">${svg(ICON.logs)}<span>Logs</span></button>`;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (b) openPage(b.dataset.page);
    });
    ul.after(box);
    // any of Alloy's own navigation leaves our page
    nav.addEventListener('click', (e) => {
      if (page && e.target.closest('.nav, .item, button') && !e.target.closest('.x-pages')) closePage();
    }, true);
  }

  function openPage(name, opts = {}) {
    // reopening New instance (e.g. Duplicate… from a menu) starts it fresh
    if (name === 'new' && page?.name === 'new') content()?.querySelector(':scope > .x-page')?.remove();
    page = { name, ...opts };
    render();
  }

  function closePage() {
    if (!page) return;
    page = null;
    content()?.querySelector(':scope > .x-page')?.remove();
    content()?.classList.remove('x-page-on');
    document.documentElement.classList.remove('x-pageview');
    document.querySelectorAll('.x-pagebtn.active').forEach((b) => b.classList.remove('active'));
  }

  function render() {
    const c = content();
    if (!c || !page) return;
    c.classList.add('x-page-on');
    document.documentElement.classList.add('x-pageview');
    document.querySelectorAll('.x-pagebtn').forEach((b) => b.classList.toggle('active', b.dataset.page === page.name));
    let el = c.querySelector(':scope > .x-page');
    if (el?.dataset.page !== page.name) {
      el?.remove();
      el = document.createElement('section');
      el.className = `x-page x-page-${page.name}`;
      el.dataset.page = page.name;
      c.prepend(el);
      c.scrollTop = 0;
      (page.name === 'logs' ? logsPage : newPage)(el, page);
    } else if (page.name === 'logs' && page.inst && el.querySelector('select').value !== page.inst) {
      el.querySelector('select').value = page.inst;
      el.querySelector('select').dispatchEvent(new Event('change'));
    }
  }

  // ---------- Logs page: Prism's console ----------

  async function logsPage(el, opts) {
    const list = await loadInstances();
    const sorted = [...list].sort((a, b) => String(b.lastPlayed ?? '').localeCompare(String(a.lastPlayed ?? '')));
    let id = opts.inst ?? sorted.find((i) => running.has(i.id))?.id ?? sorted[0]?.id;
    const levels = new Set(['info', 'warn', 'err']);
    el.innerHTML = `<h1>Logs</h1>
      <div class="x-logbar">
        <select class="select">${sorted.map((i) => `<option value="${esc(i.id)}"${i.id === id ? ' selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
        <span class="x-lvls"><button class="chip active" data-lvl="info">Info</button><button class="chip active" data-lvl="warn">Warnings</button><button class="chip active" data-lvl="err">Errors</button></span>
        <input class="input" placeholder="Search the log" spellcheck="false">
        <label class="x-follow"><input type="checkbox" class="switch" checked data-opt="follow"> Follow</label>
        <label class="x-follow" title="Fold repeats of the same message into one line"><input type="checkbox" class="switch" checked data-opt="collapse"> Fold repeats</label>
        <button class="btn btn-ghost" data-act="upload" title="Upload to mclo.gs and copy the link">${svg(ICON.upload)}Upload</button>
        <button class="btn btn-ghost" data-act="copy" title="Copy what's shown">${svg(ICON.copy)}Copy</button>
        <button class="btn btn-ghost" data-act="folder" title="Open the logs folder">${svg(ICON.folder)}Folder</button>
        <button class="btn btn-ghost" data-act="crash" title="Open crash reports">${svg(ICON.warn)}Crash reports</button>
      </div>
      <div class="x-crash" hidden></div>
      <pre class="x-log x-log-big"></pre>`;
    const pre = el.querySelector('pre');
    const o = { keep: MAX, levels, q: '', follow: true };
    let view = null;
    const show = () => {
      view?.stop();
      view = mountLog(pre, id, o);
      const box = el.querySelector('.x-crash');
      box.hidden = true;
      crashOf(id).then((c) => {
        if (!c || el.querySelector('select').value !== id) return;
        box.hidden = false;
        box.innerHTML = `${svg(ICON.warn)}<span><b>Last run crashed</b>${esc(c.text)}</span>`;
      });
    };
    show();
    el.querySelector('select').addEventListener('change', (e) => { id = e.target.value; show(); });
    let typing;
    el.querySelector('input.input').addEventListener('input', (e) => {
      clearTimeout(typing);
      typing = setTimeout(() => { o.q = e.target.value.trim().toLowerCase(); view.refresh(); }, 200);
    });
    el.querySelector('[data-opt="follow"]').addEventListener('change', (e) => (o.follow = e.target.checked));
    el.querySelector('[data-opt="collapse"]').addEventListener('change', (e) => { o.collapse = e.target.checked; view.refresh(); });
    el.addEventListener('click', (e) => {
      const lvl = e.target.closest('[data-lvl]');
      if (lvl) {
        lvl.classList.toggle('active');
        levels[lvl.classList.contains('active') ? 'add' : 'delete'](lvl.dataset.lvl);
        return view.refresh();
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'copy') navigator.clipboard?.writeText(pre.textContent).then(() => window.__xcf?.toast('Copied', 'ok'));
      if (act === 'folder') invoke('open_instance_folder', { id, sub: 'logs' }).catch(() => {});
      if (act === 'upload') uploadLog(id, e.target.closest('[data-act]'));
      if (act === 'crash') invoke('open_instance_folder', { id, sub: 'crash-reports' }).catch(() => window.__xcf?.toast('No crash reports yet', 'ok'));
    });
  }

  // ---------- modpack sources for the New instance page ----------

  // just enough Markdown for Modrinth descriptions; the result goes through the same sanitiser as CurseForge's HTML
  function markdown(md) {
    const inline = (s) => s
      .replace(/!\[([^\]]*)\]\((https:[^)\s]+)[^)]*\)/g, '<img src="$2" alt="">')
      .replace(/\[([^\]]+)\]\((https:[^)\s]+)[^)]*\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    const out = [];
    let list = false;
    for (const raw of String(md ?? '').split(/\r?\n/)) {
      const line = raw.trimEnd();
      const h = line.match(/^(#{1,6})\s+(.*)/);
      const li = line.match(/^\s*[-*+]\s+(.*)/);
      if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
      if (list) { out.push('</ul>'); list = false; }
      if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
    if (list) out.push('</ul>');
    return out.join('');
  }

  // ---------- ATLauncher packs: Configs.json lists the loader, the mods and a configs zip ----------

  let atlPacks = null;

  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }));
  }
  const atlSafe = (name) => name.replace(/[^A-Za-z0-9]/g, '');
  const bridgeCall = (msg) => window.webkit.messageHandlers.alloyskin.postMessage(msg);
  const ATL_LOADERS = { forge: 'forge', neoforge: 'neo_forge', fabric: 'fabric', quilt: 'quilt' };
  const ATL_FOLDERS = { mods: 'mods', resourcepack: 'resourcepacks', texturepack: 'resourcepacks', shaderpack: 'shaderpacks' };

  async function installAtlPack(pack, ver, step) {
    const PACKS = window.__XMCL_ENV?.packs;
    const safe = atlSafe(pack.name);
    const base = `/containers/atl/packs/${safe}/versions/${encodeURIComponent(ver.version)}`;
    step('Reading the pack…');
    const cfg = JSON.parse(await bridgeCall(`ATL\n${base}/Configs.json`));
    const mc = cfg.minecraft ?? ver.minecraft;
    const loader = ATL_LOADERS[cfg.loader?.type] ?? 'vanilla';
    let loaderVersion = null;
    if (loader !== 'vanilla') {
      const want = String(cfg.loader?.metadata?.version ?? cfg.loader?.metadata?.loader ?? '');
      const list = await invoke('list_loader_versions', { loader, mcVersion: mc });
      loaderVersion = (list.find((l) => l.version === want) ?? list.find((l) => want && (l.version.endsWith(want) || want.endsWith(l.version))) ?? list.find((l) => l.stable) ?? list[0])?.version ?? null;
      if (!loaderVersion) throw new Error(`Alloy has no ${cfg.loader.type} for Minecraft ${mc}`);
    }
    step(`Creating the instance (${loader === 'vanilla' ? 'Minecraft' : cfg.loader.type} ${mc})…`);
    const before = new Set((await loadInstances()).map((i) => i.id));
    const name = `${pack.name} ${ver.version}`.slice(0, 48);
    const made = await invoke('create_instance', { new: { name, mcVersion: mc, loader, loaderVersion, copySettingsFrom: null } });
    const inst = (Array.isArray(made) ? made : await loadInstances()).find((i) => !before.has(i.id));
    if (!inst) throw new Error('Alloy did not create the instance');
    const dir = await invoke('instance_dir', { id: inst.id });

    // client-side files the pack wants by default (ATLauncher's own "selected/recommended" rules for optional ones)
    const wanted = (cfg.mods ?? []).filter((m) => m.client !== false && !m.library && (!m.optional || m.selected || m.recommended));
    const manual = [];
    let done = 0;
    step(`Downloading files 0/${wanted.length}…`);
    await pool(wanted, 6, async (m) => {
      const url = m.download === 'server' ? encodeURI(`https://download.nodecdn.net/containers/atl/${m.url}`) : m.url;
      const folder = ATL_FOLDERS[m.type];
      try {
        if (m.download === 'browser' || !folder) throw new Error('manual');
        await bridgeCall(['DL', url, `${dir}/${folder}`, m.file].join('\n'));
      } catch {
        if (m.type !== 'forge' && m.type !== 'jar' && m.type !== 'mcpc') manual.push({ name: m.name, url: m.website ?? m.url });
      }
      step(`Downloading files ${++done}/${wanted.length}…`);
    });

    if (cfg.configs) {
      step('Unpacking the pack\'s configs…');
      const zip = `atl-${safe}-${ver.version.replace(/[^A-Za-z0-9.-]/g, '')}.zip`;
      try {
        await bridgeCall(['DL', `https://download.nodecdn.net${base}/Configs.zip`, PACKS, zip].join('\n'));
        await bridgeCall(['UNZIP', `${PACKS}/${zip}`, dir].join('\n'));
      } finally {
        bridgeCall(['RM', PACKS, zip].join('\n')).catch(() => {});
      }
    }
    return { name: inst.name, id: inst.id, manual, count: wanted.length - manual.length };
  }

  // ---------- FTB packs (api.modpacks.ch): a version lists its loader and every file with a download link ----------

  let ftbIds = { key: null, ids: [] };
  const ftbCache = new Map();
  const ftbPack = (id) => {
    if (!ftbCache.has(id)) ftbCache.set(id, bridgeCall(`FTB\n/public/modpack/${id}`).then((t) => JSON.parse(t)));
    return ftbCache.get(id);
  };
  const FTB_LOADERS = { neoforge: 'neo_forge', forge: 'forge', fabric: 'fabric', quilt: 'quilt' };

  async function installFtbPack(pack, ver, step) {
    step('Reading the pack…');
    const v = JSON.parse(await bridgeCall(`FTB\n/public/modpack/${pack.id}/${ver.id}`));
    const target = (name) => (v.targets ?? []).find((t) => t.name === name);
    const mc = target('minecraft')?.version;
    if (!mc) throw new Error("The pack doesn't say which Minecraft version it's for");
    const lt = (v.targets ?? []).find((t) => t.type === 'modloader');
    const loader = FTB_LOADERS[lt?.name] ?? 'vanilla';
    let loaderVersion = null;
    if (loader !== 'vanilla') {
      const list = await invoke('list_loader_versions', { loader, mcVersion: mc });
      loaderVersion = (list.find((l) => l.version === lt.version) ?? list.find((l) => l.version.endsWith(lt.version) || lt.version.endsWith(l.version)) ?? list.find((l) => l.stable) ?? list[0])?.version ?? null;
      if (!loaderVersion) throw new Error(`Alloy has no ${lt.name} for Minecraft ${mc}`);
    }
    step(`Creating the instance (${lt?.name ?? 'Minecraft'} ${mc})…`);
    const before = new Set((await loadInstances()).map((i) => i.id));
    const made = await invoke('create_instance', { new: { name: `${pack.name} ${ver.name}`.slice(0, 48), mcVersion: mc, loader, loaderVersion, copySettingsFrom: null } });
    const inst = (Array.isArray(made) ? made : await loadInstances()).find((i) => !before.has(i.id));
    if (!inst) throw new Error('Alloy did not create the instance');
    const dir = await invoke('instance_dir', { id: inst.id });

    const files = (v.files ?? []).filter((f) => !f.serveronly && !f.optional);
    // a few files only name a CurseForge file; ask CurseForge for their links
    const cfOnly = files.filter((f) => !f.url && f.curseforge?.file);
    if (cfOnly.length && window.__xcf) {
      const r = await window.__xcf.post('/v1/mods/files', { fileIds: cfOnly.map((f) => f.curseforge.file) }).catch(() => ({ data: [] }));
      for (const cf of r.data ?? []) cfOnly.filter((f) => f.curseforge.file === cf.id).forEach((f) => (f.url = cf.downloadUrl));
    }
    const manual = [];
    let done = 0;
    step(`Downloading files 0/${files.length}…`);
    await pool(files, 6, async (f) => {
      const rel = `${(f.path ?? './').replace(/^\.\/?/, '').replace(/\/+$/, '')}/${f.name}`.replace(/^\//, '');
      try {
        if (!f.url) throw new Error('no link');
        await bridgeCall(['DLI', f.url, dir, rel].join('\n'));
      } catch {
        manual.push({ name: f.name, url: f.curseforge?.project ? `https://www.curseforge.com/projects/${f.curseforge.project}` : f.url ?? '' });
      }
      step(`Downloading files ${++done}/${files.length}…`);
    });
    return { name: inst.name, id: inst.id, manual, count: files.length - manual.length };
  }

  const SOURCES = {
    curseforge: {
      label: 'CurseForge',
      sorts: [['Popularity', 2], ['Downloads', 6], ['Recently updated', 3], ['Newest', 11]],
      async search(q, sort, offset) {
        const x = window.__xcf;
        const path = `/v1/mods/search?gameId=432&classId=${x.CLASS.modpacks}&index=${offset}&pageSize=40&sortField=${sort}&sortOrder=desc${q ? `&searchFilter=${encodeURIComponent(q)}` : ''}`;
        const r = await x.get(path);
        return {
          total: Math.min(r.pagination?.totalCount ?? 0, 10000),
          hits: (r.data ?? []).map((m) => ({ id: m.id, title: m.name, icon: m.logo?.thumbnailUrl, author: m.authors?.[0]?.name, summary: m.summary, downloads: m.downloadCount, updated: m.dateModified, raw: m })),
        };
      },
      async details(hit) {
        const x = window.__xcf;
        const [desc, files] = await Promise.all([
          x.get(`/v1/mods/${hit.id}/description`).then((r) => x.cleanHTML(r.data ?? '')).catch(() => ''),
          x.get(`/v1/mods/${hit.id}/files?pageSize=50`).then((r) => r.data ?? []),
        ]);
        files.sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate));
        return {
          html: desc,
          url: hit.raw.links?.websiteUrl,
          versions: files.map((f) => ({ id: f.id, label: `${f.displayName || f.fileName}${f.releaseType !== 1 ? ` (${x.RELEASE[f.releaseType]})` : ''}`, mc: (f.gameVersions ?? []).filter((g) => /^\d/.test(g)).join(', '), file: f })),
        };
      },
      async install(hit, v, step) {
        const r = await window.__xcf.installModpack(hit.raw, v.file, step);
        return { name: r.inst.name, id: r.inst.id, manual: r.manual, count: r.count };
      },
    },
    atlauncher: {
      label: 'ATLauncher',
      sorts: [['Featured', 'position'], ['Name', 'name'], ['Newest Minecraft', 'mc']],
      async search(q, sort, offset) {
        if (offset) return { total: 0, hits: [] }; // the whole list comes at once
        atlPacks ??= JSON.parse(await bridgeCall(`ATL\n/containers/atl/launcher/json/packsnew.json`)).filter((p) => p.type === 'public' && p.versions?.length);
        const needle = q.toLowerCase();
        const mcKey = (p) => p.versions[0].minecraft.split('.').map((n) => n.padStart(3, '0')).join('.');
        const list = atlPacks.filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.description ?? '').toLowerCase().includes(needle))
          .sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : sort === 'mc' ? (a, b) => mcKey(b).localeCompare(mcKey(a)) : (a, b) => (a.position ?? 999) - (b.position ?? 999));
        return {
          total: list.length,
          hits: list.map((p) => ({ id: p.id, title: p.name, icon: `https://download.nodecdn.net/containers/atl/launcher/images/${atlSafe(p.name).toLowerCase()}.png`, summary: p.description, author: `Minecraft ${p.versions[0].minecraft}`, byline: '', raw: p })),
        };
      },
      async details(hit) {
        const p = hit.raw;
        const versions = [...p.versions].sort((a, b) => (b.isRecommended - a.isRecommended));
        return {
          html: `<p>${esc(p.description ?? '')}</p>`,
          url: `https://atlauncher.com/pack/${atlSafe(p.name)}`,
          versions: versions.map((v) => ({ id: v.version, label: `${v.version}${v.isRecommended ? ' (recommended)' : ''}`, mc: v.minecraft, raw: v })),
        };
      },
      install: (hit, v, step) => installAtlPack(hit.raw, v.raw, step),
    },
    ftb: {
      label: 'FTB',
      sorts: [['Most installed', 'installs'], ['Most played', 'plays'], ['All packs', 'all']],
      async search(q, sort, offset) {
        const key = `${q}|${sort}`;
        if (ftbIds.key !== key) {
          const path = q ? `/public/modpack/search/100?term=${encodeURIComponent(q)}` : sort === 'all' ? '/public/modpack/all' : `/public/modpack/popular/${sort}/100`;
          const r = JSON.parse(await bridgeCall(`FTB\n${path}`));
          ftbIds = { key, ids: r.packs ?? [] };
        }
        const ids = ftbIds.ids.slice(offset, offset + 20);
        const packs = (await Promise.all(ids.map((id) => ftbPack(id).catch(() => null)))).filter((p) => p && p.status !== 'error');
        return {
          total: ftbIds.ids.length,
          hits: packs.map((p) => ({ id: p.id, title: p.name, icon: (p.art ?? []).find((a) => a.type === 'square')?.url ?? p.art?.[0]?.url, summary: p.synopsis, author: p.authors?.[0]?.name, downloads: p.installs, raw: p })),
        };
      },
      async details(hit) {
        const p = hit.raw;
        const versions = [...(p.versions ?? [])].sort((a, b) => b.id - a.id);
        return {
          html: window.__xcf.cleanHTML(markdown(p.description ?? p.synopsis ?? '')),
          url: `https://www.feed-the-beast.com/modpacks/${p.id}`,
          versions: versions.map((v) => ({ id: v.id, label: `${v.name}${v.type && v.type.toLowerCase() !== 'release' ? ` (${v.type.toLowerCase()})` : ''}`, mc: (v.targets ?? []).find((t) => t.type === 'game')?.version ?? '', raw: v })),
        };
      },
      install: (hit, v, step) => installFtbPack(hit.raw, v.raw, step),
    },
    modrinth: {
      label: 'Modrinth',
      sorts: [['Relevance', 'relevance'], ['Downloads', 'downloads'], ['Recently updated', 'updated'], ['Newest', 'newest']],
      async search(q, sort, offset) {
        const r = await invoke('content_search', { query: { source: 'modrinth', query: q, contentType: 'modpack', gameVersion: null, loader: null, categories: [], side: null, offset, limit: 40, sort } });
        return {
          total: r?.total ?? 0,
          hits: (r?.hits ?? []).map((h) => ({ id: h.projectId, title: h.title, icon: h.iconUrl, author: h.author, summary: h.description ?? h.summary, downloads: h.downloads, updated: h.dateModified ?? h.updated, raw: h })),
        };
      },
      async details(hit) {
        const [p, versions] = await Promise.all([
          invoke('content_project', { source: 'modrinth', id: hit.id }).catch(() => null),
          invoke('content_versions', { source: 'modrinth', id: hit.id, instanceId: null, contentType: 'modpack' }).catch(() => []),
        ]);
        const body = p?.body ?? p?.longDescription ?? p?.description ?? hit.summary;
        return {
          html: window.__xcf.cleanHTML(markdown(body)),
          url: p?.pageUrl ?? `https://modrinth.com/modpack/${hit.raw.slug ?? hit.id}`,
          versions: (versions || []).map((v) => ({ id: v.versionId, label: `${v.versionNumber}${v.versionType && v.versionType !== 'release' ? ` (${v.versionType})` : ''}`, mc: (v.gameVersions ?? []).join(', '), loaders: v.loaders })),
        };
      },
      async install(hit, v, step) {
        step('Installing… (Alloy downloads the pack and its mods)');
        const r = await invoke('install_modpack', { projectId: hit.id, versionId: v.id });
        await loadInstances();
        return { name: nameOf(r?.instanceId) || hit.title, id: r?.instanceId, manual: [], warnings: r?.warnings ?? [] };
      },
    },
  };

  // a modpack source as a list + details pane (used by the New instance page)
  function packBrowser(el, srcKey, done) {
    const st = { src: srcKey, q: '', sort: SOURCES[srcKey].sorts[0][1], hits: [], total: 0, loading: false, done: false, sel: null, gen: 0 };
    el.innerHTML = `
      <div class="x-packs">
        <div class="x-packs-col">
          <div class="x-packs-bar"><input class="input" placeholder="Search ${SOURCES[srcKey].label} modpacks" spellcheck="false"><select class="select"></select></div>
          <p class="x-cf-count faint small"></p>
          <ul class="x-cf-list"></ul>
          <p class="x-cf-more faint small"></p>
        </div>
        <aside class="x-cf-detail panel"></aside>
      </div>`;
    const ul = el.querySelector('.x-cf-list');
    const more = el.querySelector('.x-cf-more');
    const count = el.querySelector('.x-cf-count');
    const sortSel = el.querySelector('.x-packs-bar select');
    const pane = el.querySelector('.x-cf-detail');

    const fillSorts = () => {
      sortSel.innerHTML = SOURCES[st.src].sorts.map(([l, v]) => `<option value="${v}">${l}</option>`).join('');
      st.sort = SOURCES[st.src].sorts[0][1];
    };
    const row = (h) => `<li class="x-cf-item${st.sel === h.id ? ' sel' : ''}" data-id="${esc(h.id)}">
      ${h.icon ? `<img src="${esc(h.icon)}" alt="" loading="lazy" decoding="async">` : '<span class="x-cf-noicon"></span>'}
      <span class="x-cf-main"><span class="x-cf-name"><strong>${esc(h.title)}</strong>${h.author ? `<span>${h.byline ?? 'by '}${esc(h.author)}</span>` : ''}</span><span class="x-cf-sum">${esc(h.summary)}</span></span>
      <span class="x-cf-side"><span>${h.downloads != null ? fmt(h.downloads) : ''}</span></span></li>`;

    async function loadMore() {
      if (st.loading || st.done) return;
      st.loading = true;
      const gen = st.gen;
      more.textContent = 'Loading…';
      try {
        const r = await SOURCES[st.src].search(st.q, st.sort, st.hits.length);
        if (gen !== st.gen) return;
        st.hits.push(...r.hits);
        st.total = r.total;
        st.done = !r.hits.length || st.hits.length >= st.total || st.hits.length + 40 > 10000;
        ul.insertAdjacentHTML('beforeend', r.hits.map(row).join(''));
        count.textContent = st.hits.length ? `${st.total.toLocaleString()} modpacks on ${SOURCES[st.src].label}` : 'Nothing found';
        more.textContent = st.done ? '' : 'Loading more…';
        if (!st.sel && st.hits[0]) select(st.hits[0].id);
      } catch (e) {
        if (gen === st.gen) { more.textContent = `${SOURCES[st.src].label}: ${e?.message ?? e}`; st.done = true; }
      } finally {
        if (gen === st.gen) st.loading = false;
      }
    }

    function reset() {
      st.gen++;
      st.hits = [];
      st.total = 0;
      st.done = false;
      st.loading = false;
      st.sel = null;
      ul.innerHTML = '';
      pane.innerHTML = '';
      count.textContent = 'Searching…';
      loadMore();
    }

    async function select(id) {
      const hit = st.hits.find((h) => String(h.id) === String(id));
      if (!hit) return;
      st.sel = hit.id;
      ul.querySelectorAll('.x-cf-item.sel').forEach((li) => li.classList.remove('sel'));
      ul.querySelector(`.x-cf-item[data-id="${CSS.escape(String(hit.id))}"]`)?.classList.add('sel');
      const src = SOURCES[st.src];
      pane.innerHTML = `<div class="x-cf-dhead">${hit.icon ? `<img src="${esc(hit.icon)}" alt="">` : '<span class="x-cf-noicon"></span>'}
          <div><h2>${esc(hit.title)}</h2><span class="faint small">${[hit.author ? `${hit.byline ?? 'by '}${esc(hit.author)}` : '', hit.downloads != null ? `${fmt(hit.downloads)} downloads` : ''].filter(Boolean).join(' · ')}</span></div></div>
        <div class="x-cf-install"><select class="select" disabled><option>Loading versions…</option></select><button class="btn btn-primary" data-go disabled>Create instance</button><button class="btn btn-ghost" data-open>${src.label} ↗</button></div>
        <p class="x-cf-status faint small"></p>
        <div class="x-cf-desc"><p class="faint">Loading description…</p></div>`;
      pane.scrollTop = 0;
      let d;
      try {
        d = await src.details(hit);
      } catch (e) {
        if (st.sel === hit.id) pane.querySelector('.x-cf-desc').innerHTML = `<p class="error">${esc(e?.message ?? e)}</p>`;
        return;
      }
      if (st.sel !== hit.id) return;
      const sel = pane.querySelector('select');
      const go = pane.querySelector('[data-go]');
      const status = pane.querySelector('.x-cf-status');
      sel.innerHTML = d.versions.length ? d.versions.map((v, i) => `<option value="${i}">${esc(v.label)}${v.mc ? ` · ${esc(v.mc)}` : ''}</option>`).join('') : '<option>No versions</option>';
      sel.disabled = !d.versions.length;
      go.disabled = !d.versions.length;
      pane.querySelector('.x-cf-desc').innerHTML = d.html || `<p>${esc(hit.summary)}</p>`;
      pane.querySelector('[data-open]').onclick = () => d.url && invoke('open_link', { url: d.url }).catch(() => {});
      go.onclick = async () => {
        const v = d.versions[+sel.value];
        if (!v) return;
        go.disabled = true;
        sel.disabled = true;
        const step = (t) => { status.textContent = t; };
        try {
          const r = await src.install(hit, v, step);
          await done?.(r);
          step(`Created “${r.name}”.${r.manual?.length ? ` ${r.manual.length} file${r.manual.length === 1 ? '' : 's'} can only be downloaded on CurseForge's website:` : ''}${r.warnings?.length ? ` ${r.warnings.join(' ')}` : ''}`);
          if (r.manual?.length) status.insertAdjacentHTML('beforeend', `<span class="x-cf-manual">${r.manual.map((x) => `<a data-href="${esc(x.url)}">${esc(x.name)}</a>`).join('')}</span>`);
          window.__xcf?.toast(`Created ${r.name}`, 'ok');
          go.textContent = 'Created';
        } catch (e) {
          step('');
          window.__xcf?.showError(e);
          go.disabled = false;
          sel.disabled = false;
        }
      };
    }

    fillSorts();
    el.addEventListener('click', (e) => {
      const link = e.target.closest('[data-href], .x-cf-desc a[href]');
      if (link) {
        e.preventDefault();
        const url = link.dataset.href ?? link.getAttribute('href');
        if (/^https:\/\//.test(url)) invoke('open_link', { url }).catch(() => {});
        return;
      }
      const li = e.target.closest('.x-cf-item');
      if (li) select(li.dataset.id);
    });
    let typing;
    el.querySelector('.x-packs-bar input').addEventListener('input', (e) => {
      clearTimeout(typing);
      typing = setTimeout(() => { st.q = e.target.value.trim(); reset(); }, 350);
    });
    sortSel.addEventListener('change', () => { st.sort = isNaN(+sortSel.value) ? sortSel.value : +sortSel.value; reset(); });
    new IntersectionObserver((en) => en.some((x) => x.isIntersecting) && loadMore(), { rootMargin: '600px' }).observe(more);
    reset();
  }


  // ---------- New instance page: Prism's sources, XMCL / Modrinth app look ----------

  const LOADER_NAMES = { vanilla: 'None', fabric: 'Fabric', quilt: 'Quilt', neo_forge: 'NeoForge', forge: 'Forge' };
  const PRESETS = [['', 'None'], ['optimised', 'Performance'], ['shaders_ready', 'Shaders ready'], ['low_end', 'Low-end PC']];
  const COPY_WHAT = [['mods', 'Mods', true], ['config', 'Mod settings (config)', true], ['resourcepacks', 'Resource packs', true], ['shaderpacks', 'Shader packs', true], ['saves', 'Worlds', false], ['screenshots', 'Screenshots', false], ['options', 'Game settings (options.txt)', true]];
  let versionsCache = null;

  // Alloy's own pages keep their instance list in memory; this makes them reload it
  const instancesChanged = () => invoke('plugin:event|emit', { event: 'instances:changed', payload: null }).catch(() => {});

  async function finishCreate(id, group) {
    if (id && group) await invoke('set_instance_group', { id, group }).catch(() => {});
    instancesChanged();
    const list = await loadInstances();
    const name = list.find((i) => i.id === id)?.name;
    window.__xcf?.toast(`Created ${name ?? 'the instance'}`, 'ok');
    if (name) {
      closePage();
      // let Alloy pick up the new list before opening it
      setTimeout(() => window.__xmcl?.openInstance(name), 400);
    }
  }

  const favicon = (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

  // Prism's "New Instance": icon + Name + Group on top, sources on the left, OK / Cancel at the bottom right
  const PACK_SOURCES = new Set(['atlauncher', 'curseforge', 'ftb', 'modrinth']);
  function newPage(el) {
    const st = { src: 'custom', nameTouched: false };
    const src = (k, icon, label) => `<button class="x-src-btn${k === 'custom' ? ' active' : ''}" data-src="${k}">${icon.startsWith('https:') ? `<img src="${icon}" alt="">` : svg(icon)}${label}</button>`;
    el.innerHTML = `<div class="x-pr-head">
        <div class="x-pr-icon">${svg(ICON.cube)}</div>
        <div class="x-pr-fields">
          <label class="x-pr-field"><span>Name</span><input class="input" data-f="name" spellcheck="false"></label>
          <label class="x-pr-field"><span>Group</span><input class="input" data-f="group" list="x-groups" placeholder="No group" spellcheck="false"><datalist id="x-groups"></datalist></label>
        </div></div>
      <div class="x-new">
        <nav class="x-srcs">
          ${src('custom', ICON.tune, 'Custom')}${src('import', ICON.import, 'Import')}${src('copy', ICON.copy, 'Copy')}
          <span class="x-srcs-h">Modpacks</span>
          ${src('modrinth', favicon('modrinth.com'), 'Modrinth')}${src('curseforge', favicon('curseforge.com'), 'CurseForge')}${src('ftb', favicon('feed-the-beast.com'), 'FTB')}${src('atlauncher', favicon('atlauncher.com'), 'ATLauncher')}
        </nav>
        <section class="x-pr-body"><h2 class="x-pr-title">Custom</h2><div class="x-new-body"></div></section>
      </div>
      <div class="x-new-foot"><span class="x-new-sum"></span><span class="x-new-err"></span>
        <button class="btn btn-primary" data-create>${svg(ICON.check)}OK</button><button class="btn" data-cancel>Cancel</button></div>`;
    const body = el.querySelector('.x-new-body');
    const nameIn = el.querySelector('[data-f="name"]');
    const groupIn = el.querySelector('[data-f="group"]');
    const sum = el.querySelector('.x-new-sum');
    const err = el.querySelector('.x-new-err');
    const createBtn = el.querySelector('[data-create]');
    let source = null; // { summary(), create(), name(), ready() }

    loadInstances().then((list) => {
      el.querySelector('#x-groups').innerHTML = [...new Set(list.map((i) => i.group).filter(Boolean))].map((g) => `<option value="${esc(g)}">`).join('');
    });
    nameIn.addEventListener('input', () => { st.nameTouched = !!nameIn.value.trim(); refresh(); });
    el.querySelector('[data-cancel]').addEventListener('click', () => { closePage(); document.querySelectorAll('nav.sidebar ul .nav, nav.topbar ul .item')[1]?.click(); });

    function refresh() {
      if (!source) { createBtn.disabled = true; return; }
      if (!st.nameTouched && source.name) nameIn.value = source.name() ?? '';
      sum.innerHTML = source.summary?.() ?? '';
      createBtn.disabled = !source.ready?.();
    }

    async function create() {
      if (!source?.ready?.()) return;
      createBtn.disabled = true;
      err.textContent = '';
      try {
        const id = await source.create(nameIn.value.trim());
        await finishCreate(id, groupIn.value.trim());
      } catch (e) {
        err.textContent = String(e?.message ?? e);
      } finally {
        refresh();
      }
    }
    createBtn.addEventListener('click', create);

    function show(key) {
      st.src = key;
      el.querySelectorAll('.x-src-btn').forEach((b) => b.classList.toggle('active', b.dataset.src === key));
      el.querySelector('.x-pr-title').textContent = el.querySelector(`.x-src-btn[data-src="${key}"]`).textContent.trim();
      const pack = PACK_SOURCES.has(key);
      el.classList.toggle('x-new-pack', pack);
      // modpacks are named by the pack and created from their own details pane, like Prism's per-pack version picker
      el.querySelector('.x-pr-field').hidden = pack || key === 'import';
      createBtn.hidden = pack || key === 'import';
      sum.innerHTML = '';
      err.textContent = '';
      body.innerHTML = '';
      if (pack) {
        source = null;
        return packBrowser(body, key, (r) => finishCreate(r.id, groupIn.value.trim()));
      }
      source = (key === 'custom' ? customSource : key === 'copy' ? copySource : importSource)(body, refresh, () => groupIn.value.trim());
      refresh();
    }
    el.querySelector('.x-srcs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-src]');
      if (b && b.dataset.src !== st.src) show(b.dataset.src);
    });
    if (pendingCopy) show('copy');
    else show('custom');
  }

  // Custom, laid out like Prism: version table with a Filter column, then the loader table with a Mod Loader column
  const VERSION_TYPES = [['release', 'Releases'], ['snapshot', 'Snapshots'], ['old_beta', 'Betas'], ['old_alpha', 'Alphas']];
  function customSource(body, refresh) {
    const st = { mc: null, loader: 'vanilla', lv: null, loaders: null, preset: '', copyFrom: '', show: new Set(['release']), q: '', lq: '' };
    const LOADER_ORDER = ['vanilla', 'neo_forge', 'forge', 'fabric', 'quilt'];
    body.innerHTML = `<div class="x-pr-custom">
      <div class="x-pr-row">
        <div class="x-pr-table">
          <div class="x-pr-thead"><span>Version</span><span>Released</span><span>Type</span></div>
          <ul class="x-table" data-list="mc"><li class="faint">Loading versions…</li></ul>
          <div class="x-pr-search"><input class="input" placeholder="Search" data-f="q" spellcheck="false"><button class="btn" data-refresh="mc">Refresh</button></div>
        </div>
        <aside class="x-pr-side"><b>Filter</b>${VERSION_TYPES.map(([t, l]) => `<label><input type="checkbox" data-t="${t}"${t === 'release' ? ' checked' : ''}> ${l}</label>`).join('')}</aside>
      </div>
      <div class="x-pr-row">
        <div class="x-pr-table">
          <div class="x-pr-thead"><span>Version</span><span></span><span>Type</span></div>
          <ul class="x-table" data-list="lv"></ul>
          <div class="x-pr-search"><input class="input" placeholder="Search" data-f="lq" spellcheck="false"><button class="btn" data-refresh="lv">Refresh</button></div>
        </div>
        <aside class="x-pr-side"><b>Mod Loader</b>${LOADER_ORDER.map((k) => `<label><input type="radio" name="x-loader" data-loader="${k}"${k === 'vanilla' ? ' checked' : ''}> ${LOADER_NAMES[k]}</label>`).join('')}</aside>
      </div>
      <details class="x-pr-more"><summary>More options</summary>
        <div class="x-opts">
          <label class="x-new-field"><span>Starter mods</span><select class="select" data-f="preset">${PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <label class="x-new-field"><span>Copy game settings from</span><select class="select" data-f="copy"><option value="">Don't copy</option></select></label>
        </div>
        <p class="faint small x-hint">Starter mods come from Modrinth right after the instance is made. Game settings are keybinds, video and sound (options.txt).</p>
      </details></div>`;
    const mcList = body.querySelector('[data-list="mc"]');
    const lvList = body.querySelector('[data-list="lv"]');
    const presetSel = body.querySelector('[data-f="preset"]');
    loadInstances().then((list) => {
      body.querySelector('[data-f="copy"]').insertAdjacentHTML('beforeend', list.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join(''));
    });

    const typeName = (t) => ({ release: 'release', snapshot: 'snapshot', old_beta: 'beta', old_alpha: 'alpha' })[t] ?? t;
    const date = (v) => { const t = v.releaseTime ?? v.time; return t ? new Date(t).toLocaleDateString([], { year: '2-digit', month: 'numeric', day: 'numeric' }) : ''; };
    const empty = (text) => `<li class="x-pr-empty"><span>${esc(text)}</span></li>`;
    function drawVersions() {
      const all = versionsCache?.versions ?? [];
      const latest = versionsCache?.latestRelease;
      const rows = all.filter((v) => st.show.has(v.type) && (!st.q || v.id.includes(st.q)));
      mcList.innerHTML = rows.map((v) => `<li data-v="${esc(v.id)}" class="${v.id === st.mc ? 'sel' : ''}"><b>${v.id === latest ? `<i class="x-star">${svg(ICON.star)}</i>` : ''}${esc(v.id)}</b><span>${date(v)}</span><em class="t-${typeName(v.type)}">${typeName(v.type)}</em></li>`).join('') || empty('No versions match.');
      mcList.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    }
    function drawLoaderRows() {
      if (st.loader === 'vanilla') { lvList.innerHTML = empty('No mod loader is selected.'); return; }
      if (!st.loaders) return;
      const rows = st.loaders.filter((l) => !st.lq || l.version.includes(st.lq));
      lvList.innerHTML = rows.map((l) => `<li data-lv="${esc(l.version)}" class="${l.version === st.lv ? 'sel' : ''}"><b>${l.stable ? `<i class="x-star">${svg(ICON.star)}</i>` : ''}${esc(l.version)}</b><span></span><em class="${l.stable ? 't-release' : ''}">${l.stable ? 'recommended' : 'beta'}</em></li>`).join('') ||
        empty(`No ${LOADER_NAMES[st.loader]} versions for Minecraft ${st.mc}.`);
    }
    async function drawLoaders() {
      presetSel.disabled = st.loader === 'vanilla';
      st.lv = null;
      st.loaders = null;
      if (st.loader === 'vanilla') { drawLoaderRows(); return refresh(); }
      lvList.innerHTML = empty('Loading loader versions…');
      refresh();
      const want = [st.loader, st.mc];
      try {
        const list = await invoke('list_loader_versions', { loader: st.loader, mcVersion: st.mc });
        if (want[0] !== st.loader || want[1] !== st.mc) return;
        st.loaders = list || [];
        st.lv = (st.loaders.find((l) => l.stable) ?? st.loaders[0])?.version ?? null;
        drawLoaderRows();
      } catch (e) {
        lvList.innerHTML = empty(String(e?.message ?? e));
      }
      refresh();
    }
    const loadVersions = (fresh) => (versionsCache && !fresh ? Promise.resolve(versionsCache) : invoke('list_versions')).then((r) => {
      versionsCache = r;
      st.mc ??= r?.latestRelease ?? r?.versions?.[0]?.id;
      drawVersions();
      refresh();
    }).catch((e) => { mcList.innerHTML = empty(String(e?.message ?? e)); });
    loadVersions(false);
    drawLoaderRows();

    body.addEventListener('click', (e) => {
      const v = e.target.closest('[data-v]');
      if (v) { st.mc = v.dataset.v; mcList.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel')); v.classList.add('sel'); drawLoaders(); return; }
      const lv = e.target.closest('[data-lv]');
      if (lv) { st.lv = lv.dataset.lv; lvList.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel')); lv.classList.add('sel'); refresh(); return; }
      const r = e.target.closest('[data-refresh]');
      if (r) r.dataset.refresh === 'mc' ? loadVersions(true) : drawLoaders();
    });
    body.addEventListener('change', (e) => {
      const t = e.target.dataset.t;
      if (t) { st.show[e.target.checked ? 'add' : 'delete'](t); drawVersions(); }
      if (e.target.dataset.loader) { st.loader = e.target.dataset.loader; drawLoaders(); }
      if (e.target.dataset.f === 'preset') st.preset = e.target.value;
      if (e.target.dataset.f === 'copy') st.copyFrom = e.target.value;
    });
    let typing;
    body.addEventListener('input', (e) => {
      const f = e.target.dataset.f;
      if (f !== 'q' && f !== 'lq') return;
      clearTimeout(typing);
      typing = setTimeout(() => { st[f] = e.target.value.trim(); f === 'q' ? drawVersions() : drawLoaderRows(); }, 150);
    });

    const label = () => (st.loader === 'vanilla' ? `${st.mc ?? ''}` : `${LOADER_NAMES[st.loader]} ${st.mc ?? ''}`);
    return {
      name: label,
      ready: () => !!st.mc && (st.loader === 'vanilla' || !!st.lv),
      summary: () => (st.mc ? `<b>${esc(st.loader === 'vanilla' ? `Minecraft ${st.mc}` : label())}</b>${st.lv ? ` · loader ${esc(st.lv)}` : ''}${st.preset && st.loader !== 'vanilla' ? ` · ${esc(PRESETS.find((p) => p[0] === st.preset)[1])} mods` : ''}` : ''),
      async create(name) {
        const before = new Set((await loadInstances()).map((i) => i.id));
        const list = await invoke('create_instance', { new: { name: name || label(), mcVersion: st.mc, loader: st.loader, loaderVersion: st.loader === 'vanilla' ? null : st.lv, copySettingsFrom: st.copyFrom || null } });
        const made = (Array.isArray(list) ? list : await loadInstances()).find((i) => !before.has(i.id));
        if (made && st.preset && st.loader !== 'vanilla') {
          window.__xcf?.toast('Adding starter mods…', 'ok');
          await invoke('content_install_preset', { instanceId: made.id, preset: st.preset }).catch(() => {});
        }
        return made?.id;
      },
    };
  }

  // Copy: pick an instance tile, choose what comes along (Alloy's duplicate)
  function copySource(body, refresh) {
    const st = { id: null, what: Object.fromEntries(COPY_WHAT.map(([k, , on]) => [k, on])) };
    body.innerHTML = `<div class="x-copy">
        <div class="x-copy-tiles"><p class="faint">Loading…</p></div>
        <div class="x-copy-what"><b>Copy these</b><div class="x-chips">${COPY_WHAT.map(([k, l, on]) => `<button class="x-chip${on ? ' on' : ''}" data-w="${k}">${l}</button>`).join('')}</div>
          <p class="faint small">Play time starts again from zero for the copy.</p></div></div>`;
    const tiles = body.querySelector('.x-copy-tiles');
    loadInstances().then((list) => {
      st.id = (pendingCopy && list.some((i) => i.id === pendingCopy) ? pendingCopy : list[0]?.id) ?? null;
      pendingCopy = null;
      const icon = (i) => window.__xmcl?.iconMarkup(i, 'x-copy-icon') ?? '';
      tiles.innerHTML = list.map((i) => `<button class="x-copy-tile${i.id === st.id ? ' sel' : ''}" data-id="${esc(i.id)}">${icon(i)}<b>${esc(i.name)}</b><span>${esc(LOADER_NAMES[i.loader] === 'None' ? 'Minecraft' : LOADER_NAMES[i.loader] ?? i.loader)} ${esc(i.mcVersion)}</span></button>`).join('') || '<p class="faint">No instances yet.</p>';
      window.__xmcl?.hydrateIcons(tiles);
      refresh();
    });
    body.addEventListener('click', (e) => {
      const tile = e.target.closest('[data-id]');
      if (tile) {
        st.id = tile.dataset.id;
        tiles.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
        tile.classList.add('sel');
        return refresh();
      }
      const chip = e.target.closest('[data-w]');
      if (chip) { st.what[chip.dataset.w] = !st.what[chip.dataset.w]; chip.classList.toggle('on', st.what[chip.dataset.w]); }
    });
    return {
      name: () => (nameOf(st.id) ? `${nameOf(st.id)} (copy)` : ''),
      ready: () => !!st.id,
      summary: () => (st.id ? `Copy of <b>${esc(nameOf(st.id))}</b>` : ''),
      async create(name) {
        const r = await invoke('duplicate_instance', { id: st.id, name: name || `${nameOf(st.id)} (copy)`, what: st.what });
        return r?.id;
      },
    };
  }

  // Import: drop a modpack file anywhere on the zone (Alloy's window reports dropped files), or pick one;
  // below, instances found in other launchers on this PC, grouped by launcher
  const LAUNCHERS = { prism: ['Prism Launcher', 'prismlauncher.org'], multimc: ['MultiMC', 'multimc.org'], modrinth: ['Modrinth App', 'modrinth.com'],
    curseforge: ['CurseForge app', 'curseforge.com'], official: ['Minecraft Launcher', 'minecraft.net'], vanilla: ['Minecraft Launcher', 'minecraft.net'], violet: ['Violet', 'github.com'] };
  let dropHandler = null;
  listen('tauri://drag-drop', (p) => dropHandler?.(p?.paths ?? []));
  listen('tauri://drag-enter', () => document.querySelector('.x-drop-zone')?.classList.add('over'));
  listen('tauri://drag-leave', () => document.querySelector('.x-drop-zone')?.classList.remove('over'));

  function importSource(body, refresh, group) {
    body.innerHTML = `<div class="x-imports">
      <button class="x-drop-zone">${svg(ICON.import)}<b>Drop a modpack here</b><span>or click to choose a file · Modrinth .mrpack, CurseForge .zip, Alloy .alloy</span></button>
      <p class="x-imp-status faint small"></p>
      <h3 class="x-imp-h">From another launcher</h3>
      <div class="x-ext"><p class="faint">Looking for other launchers…</p></div>
      <p class="faint small">Files are copied; the other launcher keeps its own.</p></div>`;
    const status = body.querySelector('.x-imp-status');
    const ext = body.querySelector('.x-ext');
    const zone = body.querySelector('.x-drop-zone');
    let found = [];
    let progress = null;
    listen('pack:progress', (p) => { if (progress) progress(p); });

    invoke('list_external_instances').then((list) => {
      found = list || [];
      if (!found.length) return (ext.innerHTML = '<p class="faint">No other launchers found. Prism, MultiMC, the official launcher, Modrinth App, CurseForge app and Violet are checked.</p>');
      const groups = new Map();
      found.forEach((f, i) => {
        const k = String(f.launcher ?? f.source ?? f.kind ?? 'other').toLowerCase();
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push([f, i]);
      });
      ext.innerHTML = [...groups].map(([k, rows]) => {
        const [label, domain] = LAUNCHERS[k] ?? [k, null];
        return `<section class="x-ext-group"><header>${domain ? `<img src="${favicon(domain)}" alt="">` : ''}<b>${esc(label)}</b><span class="faint small">${rows.length} instance${rows.length === 1 ? '' : 's'}</span></header>
          <ul class="x-table">${rows.map(([f, i]) => `<li><b>${esc(f.name)}</b><em>${esc(f.mcVersion ?? '?')}${f.loader && f.loader !== 'vanilla' ? ` · ${esc(LOADER_NAMES[f.loader] ?? f.loader)}` : ''}</em><span>${f.mcVersion ? '' : '<input class="input x-ver" placeholder="MC version" spellcheck="false">'}<button class="btn btn-ghost" data-ext="${i}">Import</button></span></li>`).join('')}</ul></section>`;
      }).join('');
    }).catch((e) => { ext.innerHTML = `<p class="error">${esc(e?.message ?? e)}</p>`; });

    let before = new Set();
    const run = async (job, btn, label) => {
      if (btn) btn.disabled = true;
      progress = (p) => { status.textContent = p?.total ? `${label} ${p.done ?? 0} of ${p.total} files` : label; };
      status.textContent = label;
      try {
        const r = await job();
        status.textContent = r?.warnings?.length ? `Imported. Some things couldn't come across: ${r.warnings.join('; ')}` : 'Imported.';
        await finishCreate(r?.instanceId ?? r?.id ?? (await loadInstances()).find((i) => !before.has(i.id))?.id, group());
      } catch (e) {
        status.textContent = String(e?.message ?? e);
      } finally {
        progress = null;
        if (btn) btn.disabled = false;
      }
    };
    const importFile = async (path) => {
      if (!/\.(mrpack|zip|alloy)$/i.test(path)) return (status.textContent = 'That isn\'t a .mrpack, .zip or .alloy file.');
      before = new Set((await loadInstances()).map((i) => i.id));
      run(() => invoke('import_pack', { path: String(path) }), zone, `Importing ${String(path).split('/').pop()}…`);
    };
    dropHandler = (paths) => { zone.classList.remove('over'); if (zone.isConnected && paths[0]) importFile(paths[0]); };

    body.addEventListener('click', async (e) => {
      if (e.target.closest('.x-drop-zone')) {
        const path = await invoke('plugin:dialog|open', { options: { title: 'Choose a modpack or share file', multiple: false, directory: false, filters: [{ name: 'Modpack', extensions: ['mrpack', 'zip', 'alloy'] }] } }).catch(() => null);
        if (path) importFile(path);
        return;
      }
      const b = e.target.closest('[data-ext]');
      if (b) {
        const f = found[+b.dataset.ext];
        const typed = b.parentElement.querySelector('.x-ver')?.value.trim();
        if (!f.mcVersion && !typed) return (status.textContent = 'Type the Minecraft version for that one first.');
        before = new Set((await loadInstances()).map((i) => i.id));
        run(() => invoke('import_external', { found: f, mcVersion: f.mcVersion ? null : typed }), b, `Importing ${f.name}…`);
      }
    });
    return { ready: () => false };
  }

  // ---------- QoL: Prism's instance menu, quick launch, keyboard shortcuts ----------

  const instByName = (name) => (window.__xmcl?.instances() ?? instancesCache).find((i) => i.name === name);
  let pendingCopy = null;

  function confirmDelete(inst) {
    const back = document.createElement('div');
    back.className = 'backdrop x-cf-backdrop';
    back.innerHTML = `<div class="dialog panel x-cf-dialog x-confirm" role="dialog" aria-modal="true"><h2>Delete ${esc(inst.name)}?</h2>
      <p class="muted">Its mods, worlds, screenshots and settings are removed from this PC. This can't be undone.</p>
      <div class="actions"><button class="btn" data-no>Cancel</button><button class="btn x-danger" data-yes>Delete</button></div></div>`;
    document.body.append(back);
    back.addEventListener('click', async (e) => {
      if (e.target === back || e.target.closest('[data-no]')) return back.remove();
      if (!e.target.closest('[data-yes]')) return;
      e.target.disabled = true;
      try {
        await invoke('delete_instance', { id: inst.id });
        instancesChanged();
        window.__xmcl?.refresh();
        window.__xcf?.toast(`Deleted ${inst.name}`, 'ok');
        if (content()?.querySelector('header.head h1')?.textContent.trim() === inst.name) document.querySelectorAll('nav.sidebar ul .nav, nav.topbar ul .item')[1]?.click();
      } catch (err) {
        window.__xcf?.toast(String(err?.message ?? err), 'err');
      }
      back.remove();
    });
  }

  // the same actions as the instance menu, for xmcl.js's Instances details panel
  window.__xpagesApi = {
    openFolder: (id) => invoke('open_instance_folder', { id, sub: null }).catch(() => {}),
    openLogs: (id) => openPage('logs', { inst: id }),
    duplicate: (id) => { pendingCopy = id; openPage('new'); },
  };

  const launch = (inst) => invoke('launch_instance', { id: inst.id, options: null }).then(() => window.__xcf?.toast(`Starting ${inst.name}…`, 'ok')).catch((e) => window.__xcf?.toast(String(e?.message ?? e), 'err'));

  function instanceMenu(inst, x, y) {
    const items = [
      [running.has(inst.id) ? 'Running…' : 'Play', () => !running.has(inst.id) && launch(inst)],
      ['Open folder', () => invoke('open_instance_folder', { id: inst.id, sub: null }).catch(() => {})],
      ['Open logs', () => openPage('logs', { inst: inst.id })],
      ['Settings', () => window.__xmcl?.openInstanceTab(inst.name, 'settings')],
      ['Duplicate…', () => { pendingCopy = inst.id; openPage('new'); }],
      ['Delete…', () => confirmDelete(inst)],
    ];
    window.__xmcl?.showMenu(x, y, items);
  }

  document.addEventListener('contextmenu', (e) => {
    const rail = e.target.closest('.x-inst');
    const ours = !rail && e.target.closest('[data-xi]');
    const tile = !rail && !ours && e.target.closest(':is(.x-library, .x-library-big) .grid > article, .x-library-rows .rows > .row');
    const name = rail?.dataset.inst ?? ours?.dataset.xi ?? tile?.querySelector('.name')?.textContent.trim();
    const inst = name && instByName(name);
    if (!inst) return;
    e.preventDefault();
    e.stopPropagation();
    instanceMenu(inst, e.clientX, e.clientY);
  }, true);

  // middle-click a rail icon: launch straight away (XMCL-style quick launch)
  document.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const inst = instByName(e.target.closest('.x-inst')?.dataset.inst ?? e.target.closest('[data-xi]')?.dataset.xi);
    if (!inst || running.has(inst.id)) return;
    e.preventDefault();
    launch(inst);
  }, true);

  const SHORTCUTS = [['Ctrl + N', 'New instance'], ['Ctrl + L', 'Logs'], ['Ctrl + F', 'Search on this page'], ['Ctrl + 1 … 9', 'Open the 1st … 9th instance (rail order, or most recent first)'],
    ['Right-click an instance', 'Play, folder, logs, settings, duplicate, delete'], ['Middle-click an instance', 'Launch it'], ['?', 'This list'], ['Esc', 'Close menus and dialogs']];
  function toggleHelp() {
    const open = document.querySelector('.x-help');
    if (open) return open.remove();
    const back = document.createElement('div');
    back.className = 'backdrop x-cf-backdrop x-help';
    back.innerHTML = `<div class="dialog panel x-cf-dialog"><h2>Shortcuts</h2><dl>${SHORTCUTS.map(([k, d]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(d)}</dd>`).join('')}</dl></div>`;
    back.addEventListener('click', () => back.remove());
    document.body.append(back);
  }

  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape') { document.querySelector('.x-help, .x-confirm')?.closest('.backdrop')?.remove(); document.querySelector('.x-menu')?.remove(); return; }
    if (typing && !(e.ctrlKey && e.key.toLowerCase() === 'f')) return;
    if (!e.ctrlKey && !e.altKey && e.key === '?') { e.preventDefault(); return toggleHelp(); }
    if (!e.ctrlKey || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { e.preventDefault(); openPage('new'); }
    else if (k === 'l') { e.preventDefault(); openPage('logs'); }
    else if (k === 'f') {
      const box = [...content().querySelectorAll('input')].find((i) => i.offsetParent && /search|filter/i.test(i.placeholder ?? ''));
      if (box) { e.preventDefault(); box.focus(); box.select(); }
    } else if (/^[1-9]$/.test(k)) {
      // the rail's order in Sidebar; the other layouts have no rail, so the most recently played first
      const btn = document.querySelectorAll('nav.sidebar .x-inst')[+k - 1];
      if (btn) { e.preventDefault(); btn.click(); }
      else if (!document.querySelector('nav.sidebar')) {
        const inst = [...instancesCache].sort((a, b) => (Date.parse(b.lastPlayed) || 0) - (Date.parse(a.lastPlayed) || 0))[+k - 1];
        if (inst) { e.preventDefault(); window.__xmcl?.openInstance(inst.name); }
      }
    }
  });

  // ---------- wiring ----------

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      mountRail();
      if (page) render();
      hydrateCards();
      runState();
      cleanupSkins();
      enhanceSkins();
    }, 150);
  }

  function start() {
    const c = content();
    if (!c) return setTimeout(start, 300);
    // log lines streaming into a <pre> don't need a re-check; the whole body, so a layout switch (new nav) is seen too
    new MutationObserver((recs) => recs.some((r) => !r.target.closest?.('.x-log')) && schedule()).observe(document.body, { childList: true, subtree: true });
    loadInstances();
    refreshRunning().then(schedule);
    schedule();
  }
  start();
})();
