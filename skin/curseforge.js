// CurseForge for Alloy, injected by ~/.local/lib/alloy-skin/alloyskin.so (after xmcl.js).
// Talks to CurseForge through the loader's bridge (bridge.c), which adds the API key and only allows
// api.curseforge.com calls and CDN downloads into an instance's mods/resourcepacks/shaderpacks folder.
//  - Browse: a "CurseForge" source chip next to Modrinth/Cytra: Prism-style results list (endless scroll)
//    with a details pane (description, version picker, install); modpacks become new instances
//  - installs pick the right file for the instance's Minecraft version and loader, plus required dependencies
//  - updates: mods Alloy doesn't track are matched by CurseForge fingerprint and can be updated in place
(() => {
  const T = window.__TAURI_INTERNALS__;
  const bridge = window.webkit?.messageHandlers?.alloyskin;
  if (!T || !bridge) return;

  const GAME = 432;
  const CLASS = { mods: 6, resourcepacks: 12, shaders: 6552, modpacks: 4471 };
  const FOLDER = { 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks' };
  const LOADER = { forge: 1, fabric: 4, quilt: 5, neo_forge: 6, neoforge: 6 };
  const RELEASE = { 1: 'Release', 2: 'Beta', 3: 'Alpha' };

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

  // ---------- bridge ----------

  const api = async (method, path, body) => {
    const raw = await bridge.postMessage(['CF', method, path, body ? JSON.stringify(body) : ''].join('\n'));
    return JSON.parse(raw);
  };
  const get = (path) => api('GET', path);
  const post = (path, body) => api('POST', path, body);

  async function instanceInfo(id) {
    const list = await T.invoke('list_instances');
    const inst = list.find((i) => i.id === id);
    if (!inst) throw new Error('Pick an instance to install into');
    const dir = await T.invoke('instance_dir', { id });
    return { ...inst, dir };
  }

  // ---------- install ----------

  // newest file for this Minecraft version (and loader, for mods); releases beat betas beat alphas
  async function pickFile(modId, classId, inst) {
    const loader = classId === CLASS.mods ? LOADER[inst.loader] : null;
    const q = `gameVersion=${encodeURIComponent(inst.mcVersion)}${loader ? `&modLoaderType=${loader}` : ''}&pageSize=50`;
    const files = (await get(`/v1/mods/${modId}/files?${q}`)).data ?? [];
    files.sort((a, b) => a.releaseType - b.releaseType || new Date(b.fileDate) - new Date(a.fileDate));
    return files[0] ?? null;
  }

  async function installProject(modId, instId, onStep, seen = new Set(), depth = 0, chosen = null) {
    if (seen.has(modId)) return [];
    seen.add(modId);
    const inst = await instanceInfo(instId);
    const mod = (await get(`/v1/mods/${modId}`)).data;
    const folder = FOLDER[mod.classId];
    if (!folder) throw new Error(`${mod.name} is a ${mod.classId === CLASS.modpacks ? 'modpack' : 'type of project'} Alloy can't install this way`);
    if (mod.allowModDistribution === false) throw Object.assign(new Error(`${mod.name}'s author only allows downloads on the CurseForge website`), { url: mod.links?.websiteUrl });
    const file = chosen ?? (await pickFile(modId, mod.classId, inst));
    if (!file) throw new Error(`${mod.name} has no file for Minecraft ${inst.mcVersion}${mod.classId === CLASS.mods ? ` (${inst.loader})` : ''}`);
    if (!file.downloadUrl) throw Object.assign(new Error(`${mod.name}'s author only allows downloads on the CurseForge website`), { url: mod.links?.websiteUrl });
    onStep?.(`Downloading ${mod.name}…`);
    await bridge.postMessage(['DL', file.downloadUrl, `${inst.dir}/${folder}`, file.fileName].join('\n'));
    installedIds.get(instId)?.add(modId);
    const done = [mod.name];
    // required dependencies (relationType 3), skipping ones the instance already has from CurseForge
    if (depth < 3) {
      for (const dep of file.dependencies ?? []) {
        if (dep.relationType !== 3 || installedIds.get(instId)?.has(dep.modId)) continue;
        done.push(...(await installProject(dep.modId, instId, onStep, seen, depth + 1)));
      }
    }
    return done;
  }

  // ---------- what's already installed (by CurseForge fingerprint) ----------

  const installedIds = new Map(); // instance id -> Set of CurseForge mod ids
  const scans = new Map(); // instance id -> Promise<scan>

  // returns { matches: [{modId, fileId, fileName}], managed: Set(fileName) } for the instance's mods folder
  function scanInstance(instId, force = false) {
    if (!force && scans.has(instId)) return scans.get(instId);
    const job = (async () => {
      const inst = await instanceInfo(instId);
      const lines = (await bridge.postMessage(`FP\n${inst.dir}/mods`)).trim().split('\n').filter(Boolean);
      const byFp = new Map(lines.map((l) => { const [name, fp] = l.split('\t'); return [Number(fp), name]; }));
      const res = byFp.size ? (await post(`/v1/fingerprints/${GAME}`, { fingerprints: [...byFp.keys()] })).data : { exactMatches: [] };
      const matches = (res.exactMatches ?? []).map((m) => ({ modId: m.id, fileId: m.file.id, fileName: m.file.fileName, release: m.file.releaseType ?? 1 }));
      installedIds.set(instId, new Set(matches.map((m) => m.modId)));
      // files Alloy itself manages (installed from Modrinth/Cytra) keep their updates in Alloy
      const items = (await T.invoke('content_list', { instanceId: instId, contentType: 'mod', lookup: false }))?.items ?? [];
      const managed = new Set(items.filter((i) => i.origin).map((i) => i.fileName));
      return { inst, matches, managed };
    })();
    job.catch(() => scans.delete(instId));
    scans.set(instId, job);
    return job;
  }

  // ---------- updates ----------

  const updateCache = new Map(); // instance id -> { at, list }

  async function findUpdates(instId, force = false) {
    const cached = updateCache.get(instId);
    if (!force && cached && Date.now() - cached.at < 10 * 60000) return cached.list;
    const { inst, matches, managed } = await scanInstance(instId, force);
    const mine = matches.filter((m) => !managed.has(m.fileName));
    const list = [];
    if (mine.length) {
      const mods = (await post('/v1/mods', { modIds: mine.map((m) => m.modId) })).data ?? [];
      const loader = LOADER[inst.loader];
      for (const m of mine) {
        const mod = mods.find((x) => x.id === m.modId);
        if (!mod) continue;
        // latestFilesIndexes is newest-first per version/loader
        const best = (mod.latestFilesIndexes ?? [])
          // same game version + loader, and never less stable than what's installed (release stays on releases)
          .filter((f) => f.gameVersion === inst.mcVersion && (!loader || !f.modLoader || f.modLoader === loader) && f.releaseType <= m.release)
          .sort((a, b) => a.releaseType - b.releaseType || b.fileId - a.fileId)[0];
        if (best && best.fileId > m.fileId) {
          list.push({ modId: m.modId, name: mod.name, icon: mod.logo?.thumbnailUrl, from: m.fileName, to: best.filename, fileId: best.fileId, release: best.releaseType });
        }
      }
    }
    updateCache.set(instId, { at: Date.now(), list });
    window.dispatchEvent(new CustomEvent('x-cf-updates', { detail: { instId, count: list.length } }));
    return list;
  }

  async function applyUpdate(instId, u) {
    const running = await T.invoke('running_instances').catch(() => []);
    if ((running || []).some((r) => (typeof r === 'string' ? r : r.id ?? r.instanceId) === instId)) throw new Error('Close Minecraft before updating mods');
    const inst = await instanceInfo(instId);
    const file = (await get(`/v1/mods/${u.modId}/files/${u.fileId}`)).data;
    if (!file?.downloadUrl) throw new Error(`${u.name}: the author only allows downloads on the CurseForge website`);
    const dir = `${inst.dir}/mods`;
    // new file first; the old one only goes once the download succeeded
    await bridge.postMessage(['DL', file.downloadUrl, dir, file.fileName].join('\n'));
    if (file.fileName !== u.from) await bridge.postMessage(['RM', dir, u.from].join('\n'));
  }

  // ---------- dialogs & toasts (Alloy's own .backdrop/.dialog classes) ----------

  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = `x-cf-toast ${kind}`;
    t.textContent = msg;
    document.body.append(t);
    setTimeout(() => t.remove(), 5000);
  }

  function showError(e) {
    toast(e.message || String(e), 'err');
    if (e.url) T.invoke('open_link', { url: e.url }).catch(() => {});
  }

  async function openUpdates(instId, name) {
    const back = document.createElement('div');
    back.className = 'backdrop x-cf-backdrop';
    back.innerHTML = `<div class="dialog panel x-cf-dialog" role="dialog" aria-modal="true"><h2>CurseForge updates · ${esc(name)}</h2><div class="x-cf-dlg-body"><p class="muted">Checking…</p></div><div class="actions"><button class="btn" data-close>Close</button><button class="btn btn-primary" data-all disabled>Update all</button></div></div>`;
    document.body.append(back);
    const body = back.querySelector('.x-cf-dlg-body');
    const close = () => back.remove();
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-close]')) close(); });
    let list = [];
    const render = () => {
      body.innerHTML = list.length
        ? `<p class="muted small">Mods in this instance that came from CurseForge and aren't tracked by Alloy. Updating swaps the jar; the old one is removed after the new one downloads.</p><ul class="x-cf-upd">${list
            .map((u, i) => `<li data-i="${i}">${u.icon ? `<img src="${esc(u.icon)}" alt="">` : '<span class="x-cf-noicon"></span>'}<span><strong>${esc(u.name)}</strong><small>${esc(u.from)} → ${esc(u.to)}${u.release !== 1 ? ` · ${RELEASE[u.release]}` : ''}</small></span><button class="btn" data-one="${i}">${u.done ? 'Updated' : 'Update'}</button></li>`)
            .join('')}</ul>`
        : '<p class="muted">Every CurseForge mod in this instance is up to date.</p>';
      back.querySelector('[data-all]').disabled = !list.some((u) => !u.done);
    };
    const run = async (u, btn) => {
      if (u.done) return;
      if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
      try {
        await applyUpdate(instId, u);
        u.done = true;
      } catch (e) {
        showError(e);
      }
      render();
    };
    back.addEventListener('click', async (e) => {
      const one = e.target.closest('[data-one]');
      if (one) return run(list[+one.dataset.one], one);
      if (e.target.closest('[data-all]')) {
        for (const u of list) await run(u);
        updateCache.delete(instId);
        scans.delete(instId);
        toast('CurseForge mods updated — reopen the Mods tab to see them', 'ok');
      }
    });
    try {
      list = await findUpdates(instId, true);
      render();
    } catch (e) {
      body.innerHTML = `<p class="error">${esc(e.message || e)}</p>`;
    }
  }

  // ---------- modpacks: Alloy imports the pack (instance + configs), we fetch its CurseForge files ----------

  const PACKS = window.__XMCL_ENV?.packs;

  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }));
  }

  async function installModpack(mod, file, onStep) {
    if (!PACKS) throw new Error('Restart Alloy to finish setting up modpack installs');
    if (!file.downloadUrl) throw Object.assign(new Error(`${mod.name}'s author only allows downloads on the CurseForge website`), { url: mod.links?.websiteUrl });
    const zip = `${PACKS}/cf-${mod.id}-${file.id}.zip`;
    onStep('Downloading pack…');
    await bridge.postMessage(['DL', file.downloadUrl, PACKS, `cf-${mod.id}-${file.id}.zip`].join('\n'));
    try {
      const manifest = JSON.parse(await bridge.postMessage(`MF\n${zip}`));
      const before = new Set((await T.invoke('list_instances')).map((i) => i.id));
      onStep('Creating the instance…');
      await T.invoke('import_pack', { path: zip });
      const inst = (await T.invoke('list_instances')).find((i) => !before.has(i.id));
      if (!inst) throw new Error('Alloy did not create the instance');
      const dir = await T.invoke('instance_dir', { id: inst.id });

      const wanted = (manifest.files ?? []).filter((f) => f.required !== false);
      const files = [];
      for (let i = 0; i < wanted.length; i += 500) files.push(...((await post('/v1/mods/files', { fileIds: wanted.slice(i, i + 500).map((f) => f.fileID) })).data ?? []));
      const projects = new Map();
      const ids = [...new Set(files.map((f) => f.modId))];
      for (let i = 0; i < ids.length; i += 500) for (const m of (await post('/v1/mods', { modIds: ids.slice(i, i + 500) })).data ?? []) projects.set(m.id, m);

      const manual = [];
      let done = 0;
      onStep(`Downloading files 0/${files.length}…`);
      await pool(files, 6, async (f) => {
        const p = projects.get(f.modId);
        if (!f.downloadUrl) manual.push({ name: p?.name ?? f.displayName, url: `${p?.links?.websiteUrl ?? 'https://www.curseforge.com'}/files/${f.id}` });
        else await bridge.postMessage(['DL', f.downloadUrl, `${dir}/${FOLDER[p?.classId] ?? 'mods'}`, f.fileName].join('\n')).catch(() => manual.push({ name: p?.name ?? f.displayName, url: `${p?.links?.websiteUrl ?? ''}/files/${f.id}` }));
        onStep(`Downloading files ${++done}/${files.length}…`);
      });
      return { inst, count: files.length - manual.length, manual };
    } finally {
      bridge.postMessage(['RM', PACKS, `cf-${mod.id}-${file.id}.zip`].join('\n')).catch(() => {});
    }
  }

  // ---------- Browse: CurseForge as a source, Prism-style list + details ----------

  let cfOn = false;
  const content = () => document.querySelector('main.content');
  const isBrowse = () => !!content()?.querySelector(':scope .chips') && !!content()?.querySelector(':scope .filters .search');
  const targetId = () => content()?.querySelector('.head select')?.value || null;

  function typeClass() {
    const chips = [...content().querySelectorAll('.chips .chip:not(.x-cf-chip)')];
    const seps = [...content().querySelectorAll('.chips > .sep')];
    const typeChip = chips.find((c) => c.classList.contains('active') && (!seps[0] || c.compareDocumentPosition(seps[0]) & Node.DOCUMENT_POSITION_FOLLOWING));
    const t = (typeChip?.textContent || '').toLowerCase();
    if (t.startsWith('resource')) return CLASS.resourcepacks;
    if (t.startsWith('shader')) return CLASS.shaders;
    if (t.startsWith('modpack')) return CLASS.modpacks;
    return CLASS.mods;
  }

  // Alloy's sort box: relevance, downloads, updated, newest -> CurseForge sortField
  const SORT = [2, 6, 3, 11];
  const sortField = () => SORT[content()?.querySelector('.filters select')?.selectedIndex ?? 0] ?? 2;
  const compatOnly = () => content()?.querySelector('.chips input[type=checkbox]')?.checked ?? true;

  function mountChip() {
    const chips = content().querySelector('.chips');
    if (!chips || chips.querySelector('.x-cf-chip')) return;
    const seps = chips.querySelectorAll(':scope > .sep');
    const chip = document.createElement('button');
    // borrow a sibling chip's classes so Alloy's scoped chip styles apply to ours too
    const like = chips.querySelector('.chip:not(.active)') ?? chips.querySelector('.chip');
    chip.className = `${like ? [...like.classList].filter((k) => k !== 'active' && k !== 'x-src').join(' ') : 'chip'} x-cf-chip`;
    chip.textContent = 'CurseForge';
    chip.addEventListener('click', () => setMode(!cfOn));
    for (let n = seps[0]?.nextElementSibling; n && n !== seps[1]; n = n.nextElementSibling) n.classList.add('x-src');
    // Modrinth, CurseForge, Cytra
    const modrinth = [...chips.querySelectorAll('.chip.x-src')].find((c) => /modrinth/i.test(c.textContent));
    if (modrinth) modrinth.after(chip);
    else if (seps[1]) seps[1].before(chip);
    else chips.append(chip);
    chips.addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (c && !c.classList.contains('x-cf-chip') && c.classList.contains('x-src')) setMode(false);
      else if (c && !c.classList.contains('x-cf-chip')) setTimeout(renderBrowse, 50); // type chip changed
    });
  }

  function setMode(on) {
    cfOn = on;
    view = null;
    renderBrowse();
  }

  // one search session: the filters it was made for, the pages loaded so far, and what's selected
  let view = null;

  function searchPath(v, index) {
    const q = [`gameId=${GAME}`, `classId=${v.classId}`, `index=${index}`, 'pageSize=50', `sortField=${v.sort}`, 'sortOrder=desc'];
    if (v.query) q.push(`searchFilter=${encodeURIComponent(v.query)}`);
    if (v.compat && v.inst && v.classId !== CLASS.modpacks) {
      q.push(`gameVersion=${encodeURIComponent(v.inst.mcVersion)}`);
      if (v.classId === CLASS.mods && LOADER[v.inst.loader]) q.push(`modLoaderType=${LOADER[v.inst.loader]}`);
    }
    return `/v1/mods/search?${q.join('&')}`;
  }

  async function loadMore(v) {
    if (v.loading || v.done) return;
    v.loading = true;
    try {
      const r = await get(searchPath(v, v.items.length));
      if (view !== v) return;
      v.items.push(...(r.data ?? []));
      v.total = Math.min(r.pagination?.totalCount ?? v.items.length, 10000);
      // CurseForge stops paging at 10,000 results
      v.done = !r.data?.length || v.items.length >= v.total || v.items.length + 50 > 10000;
    } catch (e) {
      v.error = e.message || String(e);
      v.done = true;
    } finally {
      v.loading = false;
    }
    if (view === v) drawList(v);
  }

  const has = (v, id) => installedIds.get(v.instId)?.has(id);

  function rowMarkup(v, m) {
    const author = m.authors?.[0]?.name;
    const tag = v.classId !== CLASS.modpacks && has(v, m.id) ? '<span class="x-cf-tag">Installed</span>' : '';
    return `<li class="x-cf-item${v.sel === m.id ? ' sel' : ''}" data-mod="${m.id}">
      ${m.logo?.thumbnailUrl ? `<img src="${esc(m.logo.thumbnailUrl)}" alt="" loading="lazy" decoding="async">` : '<span class="x-cf-noicon"></span>'}
      <span class="x-cf-main"><span class="x-cf-name"><strong>${esc(m.name)}</strong>${author ? `<span>by ${esc(author)}</span>` : ''}</span><span class="x-cf-sum">${esc(m.summary)}</span></span>
      <span class="x-cf-side">${tag}<span>${fmt(m.downloadCount)}</span></span></li>`;
  }

  function drawList(v) {
    const box = content()?.querySelector('.x-cf');
    if (!box) return;
    const ul = box.querySelector('.x-cf-list');
    const have = ul.children.length;
    if (have > v.items.length) ul.innerHTML = '';
    ul.insertAdjacentHTML('beforeend', v.items.slice(ul.children.length).map((m) => rowMarkup(v, m)).join(''));
    box.querySelector('.x-cf-count').textContent = v.error ? '' : v.items.length ? `${v.total.toLocaleString()} result${v.total === 1 ? '' : 's'} on CurseForge` : v.loading ? 'Searching…' : 'Nothing found';
    const more = box.querySelector('.x-cf-more');
    more.textContent = v.error ? `CurseForge: ${v.error}` : v.done ? '' : 'Loading more…';
    more.classList.toggle('error', !!v.error);
    if (!v.sel && v.items[0]) select(v, v.items[0].id);
  }

  // CurseForge descriptions are HTML from mod authors: keep text formatting, https images and links, nothing else
  const KEEP = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'IMG', 'BLOCKQUOTE', 'CODE', 'PRE', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SPAN', 'DIV', 'CENTER']);
  function cleanHTML(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const walk = (node) => {
      for (const el of [...node.children]) {
        if (!KEEP.has(el.tagName)) {
          if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|FORM|INPUT|BUTTON|TEXTAREA|SELECT|SVG|MATH|LINK|META|VIDEO|AUDIO)$/.test(el.tagName)) el.remove();
          else { walk(el); el.replaceWith(...el.childNodes); }
          continue;
        }
        const href = el.getAttribute('href'), src = el.getAttribute('src');
        for (const a of [...el.attributes]) el.removeAttribute(a.name);
        if (el.tagName === 'A' && href && /^https:\/\//i.test(href)) el.setAttribute('data-href', href);
        if (el.tagName === 'IMG') {
          if (src && /^https:\/\//i.test(src)) { el.setAttribute('src', src); el.setAttribute('loading', 'lazy'); el.setAttribute('alt', ''); }
          else { el.remove(); continue; }
        }
        walk(el);
      }
    };
    walk(doc.body);
    return doc.body.innerHTML;
  }

  const fileLabel = (f) => `${f.displayName || f.fileName}${f.releaseType !== 1 ? ` (${RELEASE[f.releaseType]})` : ''}`;
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '');

  async function select(v, id) {
    v.sel = id;
    const box = content()?.querySelector('.x-cf');
    if (!box) return;
    box.querySelectorAll('.x-cf-item.sel').forEach((li) => li.classList.remove('sel'));
    box.querySelector(`.x-cf-item[data-mod="${id}"]`)?.classList.add('sel');
    const pane = box.querySelector('.x-cf-detail');
    const m = v.items.find((x) => x.id === id) ?? (await get(`/v1/mods/${id}`)).data;
    if (v.sel !== id) return;
    const pack = v.classId === CLASS.modpacks;
    const cats = (m.categories ?? []).map((c) => `<span class="x-cf-cat">${esc(c.name)}</span>`).join('');
    pane.innerHTML = `<div class="x-cf-dhead">
        ${m.logo?.thumbnailUrl ? `<img src="${esc(m.logo.thumbnailUrl)}" alt="">` : '<span class="x-cf-noicon"></span>'}
        <div><h2>${esc(m.name)}</h2><span class="faint small">${m.authors?.[0]?.name ? `by ${esc(m.authors[0].name)} · ` : ''}${fmt(m.downloadCount)} downloads · updated ${day(m.dateModified)}</span></div>
      </div>
      ${cats ? `<div class="x-cf-cats">${cats}</div>` : ''}
      <div class="x-cf-install">
        <select class="select" disabled><option>Loading versions…</option></select>
        <button class="btn btn-primary" data-go disabled>${pack ? 'Create instance' : 'Install'}</button>
        <button class="btn btn-ghost" data-open title="Open on CurseForge">CurseForge ↗</button>
      </div>
      <p class="x-cf-status faint small"></p>
      <div class="x-cf-desc"><p class="faint">Loading description…</p></div>`;
    pane.scrollTop = 0;

    const sel = pane.querySelector('select');
    const go = pane.querySelector('[data-go]');
    const status = pane.querySelector('.x-cf-status');
    pane.querySelector('[data-open]').onclick = () => m.links?.websiteUrl && T.invoke('open_link', { url: m.links.websiteUrl }).catch(() => {});

    // versions: this instance's version/loader unless it's a modpack or the filter is off
    const q = ['pageSize=50'];
    if (!pack && v.compat && v.inst) {
      q.push(`gameVersion=${encodeURIComponent(v.inst.mcVersion)}`);
      if (v.classId === CLASS.mods && LOADER[v.inst.loader]) q.push(`modLoaderType=${LOADER[v.inst.loader]}`);
    }
    get(`/v1/mods/${id}/files?${q.join('&')}`).then((r) => {
      if (v.sel !== id) return;
      const files = (r.data ?? []).sort((a, b) => new Date(b.fileDate) - new Date(a.fileDate));
      const best = [...files].sort((a, b) => a.releaseType - b.releaseType || new Date(b.fileDate) - new Date(a.fileDate))[0];
      sel.innerHTML = files.length ? files.map((f) => `<option value="${f.id}"${f === best ? ' selected' : ''}>${esc(fileLabel(f))} · ${esc((f.gameVersions ?? []).filter((g) => /^\d/.test(g)).slice(0, 3).join(', '))}</option>`).join('') : '<option>No compatible versions</option>';
      sel.disabled = !files.length;
      const installed = !pack && has(v, id);
      go.disabled = !files.length || installed || busy.has(id);
      if (installed) go.textContent = 'Installed';
      if (busy.has(id)) go.textContent = 'Installing…';
      go.onclick = async () => {
        const file = files.find((f) => String(f.id) === sel.value);
        if (!file) return;
        busy.add(id);
        go.disabled = true;
        const step = (t) => { if (v.sel === id) status.textContent = t; };
        try {
          if (pack) {
            const r = await installModpack(m, file, step);
            step(`Created “${r.inst.name}” with ${r.count} files.${r.manual.length ? ` ${r.manual.length} can only be downloaded on CurseForge's website:` : ''}`);
            if (r.manual.length && v.sel === id) status.insertAdjacentHTML('beforeend', `<span class="x-cf-manual">${r.manual.map((x) => `<a data-href="${esc(x.url)}">${esc(x.name)}</a>`).join('')}</span>`);
            toast(`Created ${r.inst.name}`, 'ok');
          } else {
            const names = await installProject(id, v.instId, step, new Set(), 0, file);
            step(`Installed ${names[0]}${names.length > 1 ? ` + ${names.length - 1} required dependenc${names.length === 2 ? 'y' : 'ies'}: ${names.slice(1).join(', ')}` : ''}`);
            go.textContent = 'Installed';
            content()?.querySelector(`.x-cf-item[data-mod="${id}"] .x-cf-side`)?.insertAdjacentHTML('afterbegin', '<span class="x-cf-tag">Installed</span>');
          }
        } catch (e) {
          step('');
          showError(e);
          go.disabled = false;
        } finally {
          busy.delete(id);
        }
      };
    }).catch((e) => { if (v.sel === id) sel.innerHTML = `<option>${esc(e.message || e)}</option>`; });

    get(`/v1/mods/${id}/description`).then((r) => {
      if (v.sel === id) pane.querySelector('.x-cf-desc').innerHTML = cleanHTML(r.data ?? '') || `<p>${esc(m.summary)}</p>`;
    }).catch(() => { if (v.sel === id) pane.querySelector('.x-cf-desc').innerHTML = `<p>${esc(m.summary)}</p>`; });
  }

  let busy = new Set();
  let observer = null;

  async function renderBrowse() {
    const c = content();
    if (!c || !isBrowse()) return;
    mountChip();
    c.classList.toggle('x-cf-on', cfOn);
    c.querySelector('.x-cf-chip')?.classList.toggle('active', cfOn);
    let box = c.querySelector('.x-cf');
    if (!cfOn) { view = null; return box?.remove(); }

    const instId = targetId();
    const classId = typeClass();
    const raw = c.querySelector('.filters .search input')?.value.trim() ?? '';
    // a pasted project link or ID opens that project directly
    const direct = /^\d{3,}$/.test(raw) ? +raw : +(raw.match(/curseforge\.com\/(?:projects|minecraft\/[a-z-]+)\/(\d+)\b/i)?.[1] ?? 0) || null;
    const key = [instId, classId, raw, sortField(), compatOnly()].join('|');
    if (view?.key === key && box) return;

    if (!box) {
      box = document.createElement('div');
      box.className = 'x-cf';
      box.innerHTML = '<div class="x-cf-col"><p class="x-cf-count faint small"></p><ul class="x-cf-list"></ul><p class="x-cf-more faint small"></p></div><aside class="x-cf-detail panel"></aside>';
      box.addEventListener('click', onBrowseClick);
      c.querySelector('.chips').after(box);
      observer?.disconnect();
      observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && view && loadMore(view), { rootMargin: '600px' });
      observer.observe(box.querySelector('.x-cf-more'));
    }
    box.querySelector('.x-cf-list').innerHTML = '';
    box.querySelector('.x-cf-detail').innerHTML = '';
    const v = (view = { key, instId, classId, query: direct ? '' : raw, sort: sortField(), compat: compatOnly(), items: [], total: 0, sel: null });
    try {
      v.inst = instId ? await instanceInfo(instId) : null;
    } catch {
      v.inst = null;
    }
    if (view !== v) return;
    if (v.inst && classId !== CLASS.modpacks) scanInstance(instId).then(() => view === v && box.querySelectorAll('.x-cf-item').forEach((li) => {
      if (has(v, +li.dataset.mod) && !li.querySelector('.x-cf-tag')) li.querySelector('.x-cf-side').insertAdjacentHTML('afterbegin', '<span class="x-cf-tag">Installed</span>');
    })).catch(() => {});
    if (direct) {
      try {
        v.items = [(await get(`/v1/mods/${direct}`)).data];
        v.total = 1;
      } catch (e) {
        v.error = e.message || String(e);
      }
      v.done = true;
      return drawList(v);
    }
    drawList(v);
    loadMore(v);
  }

  function onBrowseClick(e) {
    const link = e.target.closest('[data-href]');
    if (link) {
      e.preventDefault();
      return T.invoke('open_link', { url: link.dataset.href }).catch(() => {});
    }
    const li = e.target.closest('.x-cf-item');
    if (li && view) select(view, +li.dataset.mod);
  }

  // ---------- update counts on Home and the instance page ----------

  function injectUpdateRows() {
    const c = content();
    if (!c) return;
    // the Mods card (xmcl.js) on Home and on the instance page gets a CurseForge row
    const homeInst = c.querySelector('.x-home-view')?.dataset.inst;
    const instName = homeInst || c.querySelector('header.head h1')?.textContent.trim();
    const target = instName ? { el: c.querySelector('.x-cards .x-card-mods .x-card-text'), name: instName } : null;
    if (!target?.el || !target.name) return;
    T.invoke('list_instances').then((list) => {
      const inst = list.find((i) => i.name === target.name);
      if (!inst || inst.loader === 'vanilla') return;
      const cached = updateCache.get(inst.id);
      if (!cached) return void findUpdates(inst.id).catch(() => {});
      let row = target.el.querySelector('.x-cf-row');
      if (!cached.list.length) return row?.remove();
      if (!row) {
        row = document.createElement('div');
        row.className = 'x-cf-row';
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          openUpdates(inst.id, inst.name);
        });
        target.el.append(row);
      }
      const html = `<span>CurseForge</span><em>${cached.list.length}</em><span class="x-cf-review">Review</span>`;
      if (row.innerHTML !== html) row.innerHTML = html;
    });
  }

  // pages.js (Modpacks page) reuses the CurseForge plumbing
  window.__xcf = { get, post, installModpack, cleanHTML, fmt, esc, toast, showError, CLASS, RELEASE };

  // ---------- wiring ----------

  let queued = false;
  function update() {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      if (isBrowse()) renderBrowse();
      else cfOn && content() && (cfOn = false);
      injectUpdateRows();
    }, 120);
  }

  function start() {
    const c = content();
    if (!c) return setTimeout(start, 300);
    new MutationObserver(update).observe(c, { childList: true });
    document.addEventListener('click', () => setTimeout(update, 60), true);
    document.addEventListener('change', (e) => e.target.closest?.('.head select, .filters select, .chips') && setTimeout(update, 30), true);
    // Alloy's search box drives the CurseForge search too
    let typing;
    document.addEventListener('input', (e) => {
      if (!cfOn || !e.target.closest?.('.filters .search')) return;
      clearTimeout(typing);
      typing = setTimeout(renderBrowse, 400);
    }, true);
    window.addEventListener('x-cf-updates', update);
    update();
  }
  start();
})();
