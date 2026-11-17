'use strict';

/* ============================== утилиты ============================== */

const $ = (s, r = document) => r.querySelector(s);
const content = $('#content');
const searchInput = $('#searchInput');
const genresBox = $('#genres');
const sheetRoot = $('#sheetRoot');
const metaTheme = $('#metaTheme');
let readerApi = null; // подключается читалкой для пересчёта страниц

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
const enc = encodeURIComponent;
const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

async function api(url) {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = 'Не удалось загрузить данные';
    try { msg = (await r.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

const b64url = (s) =>
  btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const imgSrc = (u) => (u ? `/api/img?d=${b64url(u)}` : '');

function hashStr(s) {
  let h = 0;
  const t = String(s || 'x');
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const P = {
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  books: 'M5 4h4v16H5zM11 4h4v16h-4zM17.4 5.2l3.4 1-4 13.6-3.4-1z',
  back: 'M15 5l-7 7 7 7',
  chev: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6L6 18',
  mark: 'M7 4h10v16l-5-4-5 4z',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n]}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

/* ============================== настройки ============================== */

const THEMES = {
  night: { name: 'Ночь', bg: '#0e1214', ink: '#d5dcd8' },
  paper: { name: 'Бумага', bg: '#f4f5f1', ink: '#232a27' },
  sepia: { name: 'Сепия', bg: '#efe3ca', ink: '#3a2d1c' },
};
const DEFAULTS = { theme: 'night', size: 19, font: 'serif', lh: 1.7, justify: true, margin: 'normal' };
const S = { ...DEFAULTS, ...store.get('reader.settings.v2', {}) };
if (!THEMES[S.theme]) S.theme = 'night';

function applySettings() {
  const r = document.documentElement;
  r.dataset.theme = S.theme;
  r.dataset.font = S.font;
  r.dataset.justify = S.justify ? '1' : '0';
  r.style.setProperty('--rsize', S.size + 'px');
  r.style.setProperty('--rlh', S.lh);
  if (metaTheme) metaTheme.content = THEMES[S.theme].bg;
  store.set('reader.settings.v2', S);
  if (readerApi) readerApi.relayout();
}
applySettings();

/* ============================== прогресс и полка ============================== */

const getProgress = () => store.get('reader.progress', {});
function saveProgress(url, patch) {
  const all = getProgress();
  all[url] = { ...(all[url] || {}), ...patch, url, ts: Date.now() };
  const keys = Object.keys(all);
  if (keys.length > 60) {
    keys.sort((a, b) => all[a].ts - all[b].ts).slice(0, keys.length - 60).forEach((k) => delete all[k]);
  }
  store.set('reader.progress', all);
}
const pctOf = (p) =>
  p && p.total ? Math.min(100, Math.max(0, Math.round(((p.page - 1 + (p.scroll || 0)) / p.total) * 100))) : 0;
const recentList = () => Object.values(getProgress()).sort((a, b) => b.ts - a.ts);

const getShelf = () => store.get('reader.shelf', {});
function toggleShelf(b) {
  const all = getShelf();
  if (all[b.url]) delete all[b.url];
  else all[b.url] = { url: b.url, title: b.title, author: b.author, cover: b.cover, added: Date.now() };
  store.set('reader.shelf', all);
  return Boolean(all[b.url]);
}

const getQueries = () => store.get('reader.queries', []);
function rememberQuery(q) {
  const list = [q, ...getQueries().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  store.set('reader.queries', list);
}

/* ============================== разметка ============================== */

function coverInner(b) {
  const hue = hashStr(b.title || b.url) % 360;
  const initials = esc((b.title || '?').trim().slice(0, 2).toUpperCase());
  const img = b.cover
    ? `<img loading="lazy" decoding="async" src="${imgSrc(b.cover)}" alt="" onerror="this.remove()">`
    : '';
  return `<div class="ph" style="--h:${hue}"><span>${initials}</span></div>${img}`;
}

function cardHtml(b) {
  return `
    <a class="card" href="#/book/${enc(b.url)}">
      <div class="cover">${coverInner(b)}${b.rating ? `<span class="rate">★ ${b.rating}</span>` : ''}</div>
      <div class="t">${esc(b.title)}</div>
      <div class="a">${esc(b.author)}</div>
    </a>`;
}

function progressCardHtml(p) {
  const pc = pctOf(p);
  return `
    <a class="card" href="#/read/${enc(p.url)}/${p.page || 1}">
      <div class="cover">${coverInner(p)}</div>
      <div class="t">${esc(p.title)}</div>
      <div class="bar"><i style="width:${pc}%"></i></div>
      <div class="sub">${pc}% прочитано</div>
    </a>`;
}

const skeletonGrid = (n = 12) => `<div class="skeleton-grid">${'<div class="skel"></div>'.repeat(n)}</div>`;

function stateHtml(title, text = '', action = '') {
  return `<div class="state"><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
}
const retryBtn = `<button class="btn alt" type="button" data-retry>Повторить</button>`;

/* ============================== роутинг ============================== */

let navId = 0;
let cleanups = [];
const onLeave = (fn) => cleanups.push(fn);

function setNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

let catalogP = null;
const getCatalog = () =>
  catalogP || (catalogP = api('/api/catalog').catch((e) => { catalogP = null; throw e; }));

async function loadGenres() {
  try {
    const cats = await getCatalog();
    genresBox.innerHTML = cats
      .map((c) => `<a class="glink" data-path="${esc(c.path)}" href="#/cat/${enc(c.path)}/1">${esc(c.name)}</a>`)
      .join('');
  } catch {
    genresBox.innerHTML = `<div class="glink">Не удалось загрузить</div>`;
  }
}
const markGenre = (path) =>
  genresBox.querySelectorAll('.glink').forEach((a) => a.classList.toggle('active', a.dataset.path === path));

/* постраничная подгрузка: кнопка + автоподгрузка при прокрутке */
function paged({ id, grid, wrap, seen, load, hasNext }) {
  let n = 1, busy = false, more = hasNext;
  const btn = wrap.querySelector('button');

  async function next() {
    if (busy || !more) return;
    busy = true;
    btn.disabled = true;
    btn.textContent = 'Загрузка…';
    try {
      const d = await load(n + 1);
      if (id !== navId) return;
      n++;
      more = d.hasNext;
      const fresh = d.results.filter((b) => !seen.has(b.url));
      fresh.forEach((b) => seen.add(b.url));
      grid.insertAdjacentHTML('beforeend', fresh.map(cardHtml).join(''));
      if (!more) wrap.remove();
      else { btn.disabled = false; btn.textContent = 'Показать ещё'; }
    } catch {
      btn.disabled = false;
      btn.textContent = 'Не удалось. Повторить';
    } finally {
      busy = false;
    }
  }

  btn.onclick = next;
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) next(); }, { rootMargin: '700px' });
    io.observe(wrap);
    onLeave(() => io.disconnect());
  }
}

function route() {
  cleanups.forEach((f) => { try { f(); } catch {} });
  cleanups = [];
  closeSheet(true);

  const id = ++navId;
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const view = parts[0] || 'home';

  document.body.classList.toggle('reading', view === 'read');
  document.title = 'Читалка';
  window.scrollTo(0, 0);

  switch (view) {
    case 'search': return viewSearch(id, dec(parts[1] || ''));
    case 'cat': return viewCategory(id, dec(parts[1] || ''));
    case 'book': return viewBook(id, dec(parts[1] || ''));
    case 'read': return viewRead(id, dec(parts[1] || ''), parseInt(parts[2], 10) || 1);
    case 'shelf': return viewShelf(id);
    default: return viewHome(id);
  }
}

/* ============================== главная ============================== */

async function viewHome(id) {
  setNav('home');
  markGenre(null);

  const recent = recentList();
  let html = `<div class="head"><h1>Что почитаем?</h1><p>Выберите жанр или найдите книгу по названию и автору.</p></div>`;

  if (recent.length) {
    const r = recent[0];
    const pc = pctOf(r);
    html += `
      <a class="resume" href="#/read/${enc(r.url)}/${r.page || 1}">
        <div class="cover">${coverInner(r)}</div>
        <div class="rm">
          <div class="k">Продолжить чтение</div>
          <h3>${esc(r.title)}</h3>
          <div class="by">${esc(r.author)}</div>
          <div class="bar"><i style="width:${pc}%"></i></div>
          <div class="sub">Страница ${r.page} из ${r.total || '…'} · ${pc}%</div>
        </div>
        <span class="go">${icon('chev')}</span>
      </a>`;
    if (recent.length > 1) {
      html += `<h2 class="sec">Недавние</h2><div class="row">${recent.slice(1, 12).map(progressCardHtml).join('')}</div>`;
    }
  }

  html += `<h2 class="sec">Жанры</h2>
    <div class="tiles" id="tiles">${'<div class="skel-line" style="height:62px;border-radius:15px;margin:0"></div>'.repeat(8)}</div>`;
  content.innerHTML = html;

  try {
    const cats = await getCatalog();
    if (id !== navId) return;
    $('#tiles').innerHTML = cats
      .map((c) => `<a class="tile" href="#/cat/${enc(c.path)}/1"><span>${esc(c.name)}</span>${icon('chev')}</a>`)
      .join('');
  } catch (e) {
    if (id === navId) $('#tiles').innerHTML = stateHtml('Жанры не загрузились', e.message, retryBtn);
  }
}

/* ============================== поиск ============================== */

async function viewSearch(id, q) {
  setNav('search');
  markGenre(null);
  if (q) searchInput.value = q;

  if (!q) {
    const qs = getQueries();
    content.innerHTML = `
      <div class="head"><h1>Поиск</h1><p>Введите название книги или имя автора.</p></div>
      ${qs.length ? `<h2 class="sec">Недавние запросы</h2><div class="chips" style="flex-wrap:wrap">${qs
        .map((x) => `<a class="chip" href="#/search/${enc(x)}/1">${esc(x)}</a>`).join('')}</div>` : ''}`;
    if (matchMedia('(min-width: 900px)').matches) searchInput.focus();
    return;
  }

  document.title = q + ' — поиск';
  content.innerHTML = `<div class="head"><h1>${esc(q)}</h1><p>Ищем книги…</p></div>${skeletonGrid()}`;

  try {
    const data = await api(`/api/search?q=${enc(q)}&page=1`);
    if (id !== navId) return;
    if (!data.results.length) {
      content.innerHTML = stateHtml('Ничего не нашлось', `По запросу «${q}» книг нет. Проверьте написание или попробуйте фамилию автора.`);
      return;
    }
    content.innerHTML = `
      <div class="head"><h1>${esc(q)}</h1><p>Результаты поиска</p></div>
      <div class="grid" id="grid">${data.results.map(cardHtml).join('')}</div>
      ${data.hasNext ? `<div class="more" id="more"><button class="btn alt" type="button">Показать ещё</button></div>` : ''}`;
    if (data.hasNext) {
      paged({
        id, grid: $('#grid'), wrap: $('#more'), hasNext: true,
        seen: new Set(data.results.map((b) => b.url)),
        load: (n) => api(`/api/search?q=${enc(q)}&page=${n}`),
      });
    }
  } catch (e) {
    if (id === navId) content.innerHTML = stateHtml('Поиск не удался', e.message, retryBtn);
  }
}

/* ============================== жанр ============================== */

async function viewCategory(id, path) {
  setNav('home');
  markGenre(path);
  content.innerHTML = `<div class="head"><h1>Загрузка…</h1></div>${skeletonGrid()}`;

  try {
    const data = await api(`/api/category?path=${enc(path)}&page=1`);
    if (id !== navId) return;
    const title = data.title || 'Каталог';
    document.title = title;

    const chips = data.subs.length
      ? `<div class="chips">${data.subs.map((s) => `<a class="chip" href="#/cat/${enc(s.path)}/1">${esc(s.name)}</a>`).join('')}</div>`
      : '';

    content.innerHTML = `
      <div class="head"><h1>${esc(title)}</h1>${data.subs.length ? '<p>Поджанры и книги</p>' : ''}</div>
      ${chips}
      ${data.results.length
        ? `<div class="grid" id="grid">${data.results.map(cardHtml).join('')}</div>`
        : stateHtml('Здесь пока пусто', 'В этом разделе нет книг. Выберите другой жанр.')}
      ${data.hasNext ? `<div class="more" id="more"><button class="btn alt" type="button">Показать ещё</button></div>` : ''}`;

    if (data.hasNext && data.results.length) {
      paged({
        id, grid: $('#grid'), wrap: $('#more'), hasNext: true,
        seen: new Set(data.results.map((b) => b.url)),
        load: (n) => api(`/api/category?path=${enc(path)}&page=${n}`),
      });
    }
  } catch (e) {
    if (id === navId) content.innerHTML = stateHtml('Жанр не загрузился', e.message, retryBtn);
  }
}

/* ============================== полка ============================== */

function viewShelf(id) {
  setNav('shelf');
  markGenre(null);
  const reading = recentList();
  const shelf = Object.values(getShelf()).sort((a, b) => b.added - a.added);

  if (!reading.length && !shelf.length) {
    content.innerHTML = `
      <div class="head"><h1>Моя полка</h1><p>Здесь будут книги, которые вы читаете и сохранили.</p></div>
      ${stateHtml('Полка пуста', 'Откройте книгу и нажмите «На полку» — она появится здесь.', '<a class="btn" href="#/">Найти книгу</a>')}`;
    return;
  }

  content.innerHTML = `
    <div class="head"><h1>Моя полка</h1></div>
    ${reading.length ? `<h2 class="sec" style="margin-top:6px">Читаю</h2><div class="grid">${reading.map(progressCardHtml).join('')}</div>` : ''}
    ${shelf.length ? `<h2 class="sec">Сохранено</h2><div class="grid">${shelf.map(cardHtml).join('')}</div>` : ''}`;
}

/* ============================== книга ============================== */

async function viewBook(id, url) {
  setNav(null);
  markGenre(null);
  content.innerHTML = `<div class="head"><h1>Загрузка…</h1></div>`;

  try {
    const b = await api(`/api/book?url=${enc(url)}`);
    if (id !== navId) return;
    document.title = b.title;

    const p = getProgress()[url];
    const started = p && p.page && (p.page > 1 || (p.scroll || 0) > 0.02 || (p.block || 0) > 0);
    const pc = pctOf(p);
    let onShelf = Boolean(getShelf()[url]);
    if (onShelf) { const sh = getShelf(); sh[url] = { ...sh[url], title: b.title, author: b.author, cover: b.cover }; store.set('reader.shelf', sh); }

    const shelfLabel = () => (onShelf ? 'На полке' : 'На полку');

    content.innerHTML = `
      <div class="bhero">
        ${b.cover ? `<img class="bg" src="${imgSrc(b.cover)}" alt="" onerror="this.remove()">` : ''}
        <div class="cover">${coverInner(b)}</div>
        <div class="meta">
          <h1>${esc(b.title)}</h1>
          <div class="by">${esc(b.author || 'Автор не указан')}</div>
          <div class="facts">${b.totalPages} стр. текста</div>
          <div class="acts">
            ${started ? `<div class="bar"><i style="width:${pc}%"></i></div>` : ''}
            <a class="btn" href="#/read/${enc(url)}/${started ? p.page : 1}">${started ? `Продолжить · стр. ${p.page}` : 'Читать'}</a>
            <button class="btn alt" type="button" id="shelfBtn">${shelfLabel()}</button>
            ${started ? `<a class="hint" href="#/read/${enc(url)}/1" data-restart>Начать сначала</a>` : ''}
          </div>
        </div>
      </div>`;

    $('#shelfBtn').onclick = () => {
      onShelf = toggleShelf(b);
      $('#shelfBtn').textContent = shelfLabel();
    };
    const restart = $('[data-restart]');
    if (restart) restart.addEventListener('click', () => saveProgress(url, { page: 1, scroll: 0, block: 0 }));
  } catch (e) {
    if (id === navId) content.innerHTML = stateHtml('Книга не открылась', e.message, retryBtn);
  }
}

/* ============================== читалка ============================== */

async function viewRead(id, url, startPage) {
  startPage = Math.max(1, startPage);
  setNav(null);
  const saved = getProgress()[url] || {};
  const bookHref = `#/book/${enc(url)}`;
  let total = saved.total || 1;
  let meta = { title: saved.title, author: saved.author, cover: saved.cover };

  content.innerHTML = `
    <div class="reader" id="reader">
      <div class="rhead" id="rHead">${esc(saved.title || '')}</div>
      <div class="stage" id="stage"></div>
      <div class="rfoot"><span id="fPage"></span><span id="fPct"></span></div>
      <div class="rprog"><i id="rFill"></i></div>
      <header class="rtop">
        <a class="ibtn" href="${bookHref}" aria-label="К описанию книги">${icon('back')}</a>
        <div class="rtitle"><b id="rTitle">${esc(saved.title || '')}</b><span id="rAuthor">${esc(saved.author || '')}</span></div>
        <button class="ibtn aa" type="button" data-open-settings aria-label="Настройки чтения">Aa</button>
      </header>
      <footer class="rbot">
        <div class="rlabel" id="rLabel"></div>
        <input type="range" id="rRange" min="0" max="1000" value="0" aria-label="Положение в книге">
        <div class="rends"><span>Начало</span><span>Конец</span></div>
      </footer>
      <div class="rload on" id="rLoad"><i></i></div>
      <div class="rhint" id="rHint" hidden></div>
    </div>`;

  const reader = $('#reader');
  const stage = $('#stage');
  const range = $('#rRange');

  const chunks = new Map();   // номер части -> поток текста
  const pending = new Map();
  let cur = null;
  let dx = 0, anim = 0, animDone = null, loading = false, dead = false;
  let uiOpen = false, lastChapter = '', persistT = 0, relayT = 0, hintT = 0;
  let W = 0, H = 0, cols = 1, colW = 0, gap = 0, unit = 0, step = 0, m = 0;

  /* ---------- геометрия ---------- */
  function metrics() {
    W = stage.clientWidth;
    H = stage.clientHeight;
    cols = W >= 1000 ? 2 : 1;
    const padBase = { narrow: 14, normal: 24, wide: 40 }[S.margin] || 24;
    const pad = Math.round(padBase * (W >= 700 ? 1.6 : 1));
    unit = Math.floor(W / cols);
    const maxCol = Math.max(280, Math.round(S.size * 33));
    colW = Math.max(200, Math.min(maxCol, unit - 2 * pad));
    gap = unit - colW;
    m = Math.floor(gap / 2);
    step = unit * cols;
    reader.classList.toggle('spread', cols === 2);
  }

  const colOf = (r, fr) => Math.floor((r.left - fr.left + 2) / unit);

  function layoutFlow(f) {
    const el = f.el;
    el.style.left = m + 'px';
    el.style.width = colW + 'px';
    el.style.height = H + 'px';
    el.style.columnWidth = colW + 'px';
    el.style.columnGap = gap + 'px';
    const last = el.lastElementChild;
    const fr = el.getBoundingClientRect();
    let maxK = 0;
    if (last) for (const r of last.getClientRects()) maxK = Math.max(maxK, colOf(r, fr));
    f.n = maxK + 1;
    f.S = Math.max(1, Math.ceil(f.n / cols));
  }

  function spreadOf(f, i) {
    const k = f.el.children[Math.min(i, f.el.children.length - 1)];
    if (!k) return 0;
    const rs = k.getClientRects();
    if (!rs.length) return 0;
    return Math.max(0, Math.floor(colOf(rs[0], f.el.getBoundingClientRect()) / cols));
  }

  // первый абзац, начинающийся на текущем развороте — якорь позиции чтения
  function anchorOf(f, s) {
    const fr = f.el.getBoundingClientRect();
    const kids = f.el.children;
    let fallback = -1;
    for (let i = 0; i < kids.length; i++) {
      const rs = kids[i].getClientRects();
      if (!rs.length) continue;
      const s0 = Math.floor(colOf(rs[0], fr) / cols);
      const s1 = Math.floor(colOf(rs[rs.length - 1], fr) / cols);
      if (s0 === s) return i;
      if (s0 < s && s1 >= s && fallback < 0) fallback = i;
      if (s0 > s) break;
    }
    return fallback < 0 ? 0 : fallback;
  }

  /* ---------- загрузка частей ---------- */
  function buildFlow(p, data) {
    const el = document.createElement('div');
    el.className = 'flow';
    el.innerHTML = data.blocks.length
      ? data.blocks.map((b, i) => (b.type === 'h' ? `<h3>${esc(b.text)}</h3>` : `<p>${esc(b.text)}</p>`)).join('')
      : '<p>Здесь пусто. Листайте дальше.</p>';
    stage.appendChild(el);
    const f = { p, el, blocks: data.blocks, S: 1, n: 1, s: 0, anchor: 0 };
    layoutFlow(f);
    return f;
  }

  function ensure(p) {
    if (chunks.has(p)) return Promise.resolve(chunks.get(p));
    if (pending.has(p)) return pending.get(p);
    const pr = api(`/api/read?url=${enc(url)}&page=${p}`)
      .then((data) => {
        pending.delete(p);
        if (dead) return null;
        total = data.total || total;
        const f = buildFlow(p, data);
        chunks.set(p, f);
        return f;
      })
      .catch((e) => { pending.delete(p); throw e; });
    pending.set(p, pr);
    return pr;
  }

  function prefetch() {
    [cur.p + 1, cur.p - 1].forEach((p) => {
      if (p >= 1 && p <= total) ensure(p).catch(() => {});
    });
  }
  function evict() {
    [...chunks.keys()].forEach((p) => {
      if (Math.abs(p - cur.p) > 1) { chunks.get(p).el.remove(); chunks.delete(p); }
    });
  }

  /* ---------- позиционирование и анимация ---------- */
  const setT = (f, s, off) => { f.el.style.transform = `translate3d(${off - s * step}px,0,0)`; };

  function place(off) {
    const next = cur.s === cur.S - 1 ? chunks.get(cur.p + 1) : null;
    const prev = cur.s === 0 ? chunks.get(cur.p - 1) : null;
    chunks.forEach((f) => { f.el.style.visibility = f === cur ? 'visible' : 'hidden'; });
    setT(cur, cur.s, off);
    if (off < 0 && next) { next.el.style.visibility = 'visible'; setT(next, 0, off + step); }
    if (off > 0 && prev) { prev.el.style.visibility = 'visible'; setT(prev, prev.S - 1, off - step); }
  }

  function finishAnim() {
    if (!animDone) return;
    cancelAnimationFrame(anim);
    const d = animDone;
    animDone = null;
    d();
  }

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function animate(from, to, done) {
    cancelAnimationFrame(anim);
    const ms = reduce ? 1 : Math.max(150, Math.min(340, (Math.abs(to - from) / step) * 320));
    const t0 = performance.now();
    animDone = () => { dx = 0; done && done(); if (!done) place(0); };
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      dx = from + (to - from) * e;
      place(dx);
      if (k < 1) anim = requestAnimationFrame(tick);
      else { const d = animDone; animDone = null; d && d(); }
    };
    anim = requestAnimationFrame(tick);
  }

  function availability(dir) {
    if (dir > 0) {
      if (cur.s < cur.S - 1) return 'ok';
      if (cur.p >= total) return 'end';
      return chunks.has(cur.p + 1) ? 'ok' : 'load';
    }
    if (cur.s > 0) return 'ok';
    if (cur.p <= 1) return 'end';
    return chunks.has(cur.p - 1) ? 'ok' : 'load';
  }

  function commit(dir) {
    if (dir > 0) {
      if (cur.s < cur.S - 1) cur.s++;
      else { cur = chunks.get(cur.p + 1); cur.s = 0; }
    } else if (cur.s > 0) cur.s--;
    else { cur = chunks.get(cur.p - 1); cur.s = cur.S - 1; }
    dx = 0;
    place(0);
    afterMove();
  }

  async function turn(dir, from = 0) {
    if (!cur || loading) return;
    finishAnim();
    let a = availability(dir);
    if (a === 'load') {
      loading = true;
      showLoad(true);
      try { await ensure(cur.p + dir); }
      catch { toast('Не удалось загрузить страницу. Проверьте сеть.'); }
      loading = false;
      showLoad(false);
      if (dead) return;
      a = availability(dir);
      if (a !== 'ok') { animate(from, 0); return; }
    }
    if (a === 'end') {
      toast(dir > 0 ? 'Это конец книги' : 'Это начало книги');
      animate(from, 0);
      return;
    }
    animate(from, -dir * step, () => commit(dir));
  }

  async function jumpTo(perMille) {
    const pf = (perMille / 1000) * total;
    const p = Math.min(total, Math.floor(pf) + 1);
    const fr = Math.max(0, pf - Math.floor(pf));
    finishAnim();
    loading = true;
    showLoad(true);
    try {
      const f = await ensure(p);
      if (dead || !f) return;
      cur = f;
      cur.s = Math.min(f.S - 1, Math.floor(fr * f.S));
      dx = 0;
      place(0);
      afterMove();
    } catch { toast('Не удалось перейти. Проверьте сеть.'); }
    finally { loading = false; showLoad(false); }
  }

  /* ---------- интерфейс ---------- */
  function showLoad(v) { $('#rLoad').classList.toggle('on', v); }
  function toast(text) {
    const h = $('#rHint');
    if (!h) return;
    h.textContent = text;
    h.hidden = false;
    requestAnimationFrame(() => h.classList.add('on'));
    clearTimeout(hintT);
    hintT = setTimeout(() => { h.classList.remove('on'); setTimeout(() => { h.hidden = true; }, 260); }, 3200);
  }
  function setUI(v) {
    uiOpen = v;
    reader.classList.toggle('ui', v);
    if (v && cur) range.value = Math.round((((cur.p - 1) + cur.s / cur.S) / total) * 1000);
  }

  function paint() {
    const f = cur;
    f.anchor = anchorOf(f, f.s);
    const pos = ((f.p - 1) + (f.s + 1) / f.S) / total;
    const pc = Math.min(100, Math.round(pos * 100));
    $('#rFill').style.width = (pos * 100).toFixed(2) + '%';
    $('#fPage').textContent = `${(f.p - 1) * f.S + f.s + 1} из ~${f.S * total}`;
    $('#fPct').textContent = pc + '%';
    $('#rLabel').textContent = `Часть ${f.p} из ${total} · ${pc}%`;

    let chapter = '';
    for (let i = f.anchor; i >= 0; i--) {
      if (f.blocks[i] && f.blocks[i].type === 'h') { chapter = f.blocks[i].text; break; }
    }
    if (chapter) lastChapter = chapter;
    $('#rHead').textContent = chapter || lastChapter || meta.title || '';
  }

  function persistNow() {
    clearTimeout(persistT);
    if (!cur) return;
    saveProgress(url, {
      ...meta, page: cur.p, total,
      block: cur.anchor,
      scroll: Number((cur.s / cur.S).toFixed(4)),
    });
  }
  function afterMove() {
    paint();
    clearTimeout(persistT);
    persistT = setTimeout(persistNow, 450);
    prefetch();
    evict();
    try { history.replaceState(null, '', `#/read/${enc(url)}/${cur.p}`); } catch {}
  }

  function relayout() {
    if (!cur || dead) return;
    finishAnim();
    const a = anchorOf(cur, cur.s);
    metrics();
    chunks.forEach(layoutFlow);
    cur.s = Math.min(cur.S - 1, spreadOf(cur, a));
    dx = 0;
    place(0);
    paint();
  }
  const relayoutSoon = () => { clearTimeout(relayT); relayT = setTimeout(relayout, 120); };
  readerApi = { relayout: relayoutSoon };

  /* ---------- жесты ---------- */
  let g = null;
  const resist = (ddx) => {
    const a = availability(ddx < 0 ? 1 : -1);
    if (a === 'end') return ddx * 0.22;
    if (a === 'load') return ddx * 0.4;
    return ddx;
  };

  stage.addEventListener('pointerdown', (e) => {
    if (!cur || (e.pointerType === 'mouse' && e.button !== 0)) return;
    finishAnim();
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), drag: false, s: [[e.clientX, performance.now()]] };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!g) {
      if (e.pointerType === 'mouse') {
        const x = e.clientX;
        stage.style.cursor = x < W * 0.3 ? 'w-resize' : x > W * 0.7 ? 'e-resize' : 'default';
      }
      return;
    }
    if (e.pointerId !== g.id) return;
    const ddx = e.clientX - g.x, ddy = e.clientY - g.y;
    if (!g.drag) {
      if (Math.abs(ddx) > 9 && Math.abs(ddx) > Math.abs(ddy) * 1.3) {
        g.drag = true;
        try { stage.setPointerCapture(e.pointerId); } catch {}
        if (uiOpen) setUI(false);
        const dir = ddx < 0 ? 1 : -1;
        if (availability(dir) === 'load') ensure(cur.p + dir).catch(() => {});
      } else return;
    }
    g.s.push([e.clientX, performance.now()]);
    if (g.s.length > 5) g.s.shift();
    dx = resist(ddx);
    place(dx);
  });
  const release = (e, cancelled) => {
    if (!g || e.pointerId !== g.id) return;
    const gg = g;
    g = null;
    if (!gg.drag) {
      if (!cancelled && performance.now() - gg.t < 500 && Math.hypot(e.clientX - gg.x, e.clientY - gg.y) < 12) tap(e.clientX);
      return;
    }
    const a = gg.s[0], b = gg.s[gg.s.length - 1];
    const v = (b[0] - a[0]) / Math.max(1, b[1] - a[1]);
    const ddx = e.clientX - gg.x;
    const flick = Math.abs(v) > 0.4 && Math.sign(v) === Math.sign(ddx);
    if (!cancelled && (Math.abs(dx) > step * 0.2 || flick)) turn(ddx < 0 ? 1 : -1, dx);
    else animate(dx, 0);
  };
  stage.addEventListener('pointerup', (e) => release(e, false));
  stage.addEventListener('pointercancel', (e) => release(e, true));

  function tap(x) {
    if (uiOpen) return setUI(false);
    if (x < W * 0.3) turn(-1);
    else if (x > W * 0.7) turn(1);
    else setUI(true);
  }

  let wheelLock = false;
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (wheelLock || Math.abs(d) < 12) return;
    wheelLock = true;
    setTimeout(() => { wheelLock = false; }, 380);
    turn(d > 0 ? 1 : -1);
  }, { passive: false });

  const onKey = (e) => {
    if (e.target.matches('input, textarea') || sheetRoot.classList.contains('open')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); turn(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); turn(-1); }
    else if (e.key === 'Escape' && uiOpen) setUI(false);
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', persistNow);

  range.addEventListener('input', () => {
    $('#rLabel').textContent = `Перейти к ${Math.round(range.value / 10)}% книги`;
  });
  range.addEventListener('change', () => jumpTo(Number(range.value)));

  let lastW = 0, lastH = 0;
  const ro = new ResizeObserver(() => {
    if (stage.clientWidth !== lastW || stage.clientHeight !== lastH) {
      lastW = stage.clientWidth; lastH = stage.clientHeight;
      relayoutSoon();
    }
  });
  ro.observe(stage);

  onLeave(() => {
    dead = true;
    cancelAnimationFrame(anim);
    clearTimeout(relayT); clearTimeout(hintT);
    persistNow();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('pagehide', persistNow);
    ro.disconnect();
    readerApi = null;
  });

  /* ---------- старт ---------- */
  try {
    if (document.fonts && document.fonts.ready) {
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    }
    if (id !== navId) return;
    metrics();
    lastW = stage.clientWidth; lastH = stage.clientHeight;

    const [f, book] = await Promise.all([
      ensure(startPage),
      api(`/api/book?url=${enc(url)}`).catch(() => null),
    ]);
    if (id !== navId || !f) return;

    if (book) {
      meta = { title: book.title, author: book.author, cover: book.cover };
      $('#rTitle').textContent = book.title;
      $('#rAuthor').textContent = book.author || '';
      document.title = book.title;
    }

    cur = f;
    if (saved.page === startPage) {
      if (saved.block > 0) cur.s = Math.min(f.S - 1, spreadOf(f, saved.block));
      else if (saved.block == null && saved.scroll > 0) cur.s = Math.min(f.S - 1, Math.floor(saved.scroll * f.S));
    }
    place(0);
    showLoad(false);
    afterMove();
    document.fonts && document.fonts.ready.then(relayoutSoon);

    if (!store.get('reader.hint', false)) {
      store.set('reader.hint', true);
      toast('Листайте пальцем влево и вправо. Нажмите по центру, чтобы открыть меню.');
    }
  } catch (e) {
    if (id === navId) {
      showLoad(false);
      stage.innerHTML = stateHtml('Текст не загрузился', e.message, `${retryBtn}<p style="margin-top:14px"><a href="${bookHref}" class="chip">К описанию книги</a></p>`);
    }
  }
}

/* ============================== настройки (sheet) ============================== */

function sheetBody() {
  const themes = Object.entries(THEMES)
    .map(([k, t]) => `<button type="button" class="sw ${S.theme === k ? 'on' : ''}" data-set="theme" data-val="${k}" style="--sb:${t.bg};--si:${t.ink}"><span>Аа</span><em>${t.name}</em></button>`)
    .join('');
  const seg = (key, items) =>
    items.map(([v, label, cls]) => `<button type="button" class="${cls || ''} ${String(S[key]) === String(v) ? 'on' : ''}" data-set="${key}" data-val="${v}">${label}</button>`).join('');

  return `
    <div class="sh-row"><div class="sh-label">Тема</div><div class="seg">${themes}</div></div>
    <div class="sh-row">
      <div class="sh-label"><span>Размер текста</span><span>${S.size}</span></div>
      <div class="sizeRow">
        <button type="button" class="ibtn sm" data-step="-1" aria-label="Меньше">А</button>
        <input type="range" id="sizeRange" min="15" max="28" step="1" value="${S.size}" aria-label="Размер текста">
        <button type="button" class="ibtn lg" data-step="1" aria-label="Больше">А</button>
      </div>
    </div>
    <div class="sh-row"><div class="sh-label">Шрифт</div>
      <div class="seg">${seg('font', [['serif', 'С засечками', 'font-serif'], ['sans', 'Без засечек']])}</div></div>
    <div class="sh-row"><div class="sh-label">Межстрочный интервал</div>
      <div class="seg">${seg('lh', [[1.55, 'Плотно'], [1.75, 'Обычно'], [1.95, 'Свободно']])}</div></div>
    <div class="sh-row"><div class="sh-label">Поля</div>
      <div class="seg">${seg('margin', [['narrow', 'Узкие'], ['normal', 'Обычные'], ['wide', 'Широкие']])}</div></div>
    <div class="sh-row"><div class="sh-label">Выравнивание</div>
      <div class="seg">${seg('justify', [[false, 'По левому краю'], [true, 'По ширине']])}</div></div>`;
}

function openSheet() {
  sheetRoot.innerHTML = `
    <div class="scrim" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Оформление">
      <div class="grab"></div>
      <div class="sh-head"><h2>Оформление</h2><button class="ibtn" type="button" data-close aria-label="Закрыть">${icon('close')}</button></div>
      <div id="sheetBody">${sheetBody()}</div>
    </div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => sheetRoot.classList.add('open')));
}

function closeSheet(instant) {
  sheetRoot.classList.remove('open');
  if (instant) { sheetRoot.innerHTML = ''; return; }
  setTimeout(() => { if (!sheetRoot.classList.contains('open')) sheetRoot.innerHTML = ''; }, 300);
}

sheetRoot.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) return closeSheet();
  const step = e.target.closest('[data-step]');
  const set = e.target.closest('[data-set]');
  if (step) {
    S.size = Math.min(28, Math.max(15, S.size + Number(step.dataset.step)));
  } else if (set) {
    const k = set.dataset.set, v = set.dataset.val;
    S[k] = k === 'lh' ? Number(v) : k === 'justify' ? v === 'true' : v;
  } else return;
  applySettings();
  $('#sheetBody').innerHTML = sheetBody();
});
sheetRoot.addEventListener('input', (e) => {
  if (e.target.id !== 'sizeRange') return;
  S.size = Number(e.target.value);
  applySettings();
  const lab = sheetRoot.querySelector('.sh-label span:last-child');
  if (lab) lab.textContent = S.size;
});

/* ============================== события ============================== */

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open-settings]')) {
    sheetRoot.classList.contains('open') ? closeSheet() : openSheet();
  }
  if (e.target.closest('[data-retry]')) route();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (q) rememberQuery(q);
  searchInput.blur();
  location.hash = q ? `#/search/${enc(q)}/1` : '#/search/';
});

window.addEventListener('hashchange', route);

loadGenres();
route();
