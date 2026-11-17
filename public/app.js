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

const known = new Map(); // книги, показанные на экране
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
  filter: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M9 14v6',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  growth: 'M5 20V12M10 20V8M15 20v-6M20 20V4',
  mask: 'M3 8c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0v3c0 4-3 6.5-6 6.5-1.5 0-2.5-.8-3-1.5-.5.7-1.5 1.5-3 1.5-3 0-6-2.5-6-6.5z',
  door: 'M7 3h10v18H7zM14 12h1',
  prev: 'M6 5v14M19 5l-9 7 9 7z',
  next: 'M18 5v14M5 5l9 7-9 7z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.5 3.6-6 8-6s8 2.5 8 6',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10.5 11v6M13.5 11v6',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n]}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

/* ============================== настройки ============================== */

const THEMES = {
  paper: { name: 'День', bg: '#f4f5f1', ink: '#232a27', sw: '#f4f5f1', ck: '#1d7560' },
  sepia: { name: 'Сепия', bg: '#efe3ca', ink: '#3a2d1c', sw: '#e6cc9c', ck: '#8a5a1f' },
  night: { name: 'Ночь', bg: '#0e1214', ink: '#d5dcd8', sw: '#101315', ck: '#6fd0b4' },
  violet: { name: 'Фиолет', bg: '#0b0912', ink: '#dedaee', sw: 'linear-gradient(135deg,#5b3df0,#c13bd8)', ck: '#ffffff' },
  green: { name: 'Зелёная', bg: '#0c1511', ink: '#d3e2d9', sw: 'linear-gradient(135deg,#2f6b4a,#7cc79c)', ck: '#ffffff' },
};
const DEFAULTS = { theme: 'violet', size: 19, font: 'serif', lh: 1.7, justify: true, margin: 'normal', bright: 100, safe: true };
const S = { ...DEFAULTS, ...store.get('reader.settings.v3', {}) };
if (!THEMES[S.theme]) S.theme = 'night';

function applySettings() {
  const r = document.documentElement;
  r.dataset.theme = S.theme;
  r.dataset.font = S.font;
  r.dataset.justify = S.justify ? '1' : '0';
  r.style.setProperty('--rsize', S.size + 'px');
  r.style.setProperty('--rlh', S.lh);
  r.style.setProperty('--bright', Math.max(40, Math.min(100, S.bright || 100)) / 100);
  if (metaTheme) metaTheme.content = THEMES[S.theme].bg;
  store.set('reader.settings.v3', S);
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
  known.set(b.url, b);
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

/* ============================== удаление с полок ============================== */

let snackT = 0;
function snack(text, undo) {
  let el = $('#snack');
  if (!el) {
    el = document.createElement('div');
    el.id = 'snack';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button" data-undo>Отменить</button>' : ''}`;
  requestAnimationFrame(() => el.classList.add('on'));
  const u = el.querySelector('[data-undo]');
  if (u) u.onclick = () => { clearTimeout(snackT); el.classList.remove('on'); undo(); };
  clearTimeout(snackT);
  snackT = setTimeout(() => el.classList.remove('on'), 5000);
}

function removeBook(kind, url, row) {
  const key = kind === 'shelf' ? 'reader.shelf' : 'reader.progress';
  const all = store.get(key, {});
  const backup = all[url];
  if (!backup) return;
  delete all[url];
  store.set(key, all);
  if (row) row.remove();
  const list = $('.llist');
  if (list && !list.children.length) route();
  snack(kind === 'shelf' ? 'Убрано из избранного' : 'Убрано из «Читаю»', () => {
    const cur = store.get(key, {});
    cur[url] = backup;
    store.set(key, cur);
    route();
  });
}

/* ============================== роутинг ============================== */

let navId = 0;
let cleanups = [];
const onLeave = (fn) => cleanups.push(fn);

function setNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

/* ---------- фильтр «18+» ---------- */
const ADULT_RE = /эроти[кч]|порн|(^|[^а-яёa-z])секс|сексуал|18\s?\+|nc-?17|интимн|бдсм|bdsm|доминирован|фетиш|хентай|hentai|оргия|минет|нимфоман|проститут|шлюх|развратн|разврат|похотлив|гарем|для взрослых|откровенн|erotic|porn|xxx|слэш|яой/i;

/* на главную берём книги только из «спокойных» жанров */
const HOME_OK = /классик|фантаст|фэнтез|фентез|детектив|приключен|истори|научн|познават|психолог|саморазвит|бизнес|юмор|поэз|стих|детск|сказк|проза|биограф|мемуар|философ|боевик|триллер/i;
const HOME_NO = /самиздат|фанфик|любов|романт|new ?adult|слэш|яой|женск|дамск|эроти|секс/i;
const homeCats = (cats) => {
  const ok = cats.filter((c) => HOME_OK.test(c.name) && !HOME_NO.test(c.name));
  return ok.length >= 2 ? ok : cats.filter((c) => !HOME_NO.test(c.name));
};

/* книги и авторы, которые пользователь скрыл вручную */
const getHidden = () => { const h = store.get('reader.hidden', {}); return { urls: h.urls || {}, authors: h.authors || {} }; };
const authorKey = (s) => String(s || '').trim().toLowerCase();
function hideBook(b) {
  const h = getHidden();
  h.urls[b.url] = 1;
  if (b.author) h.authors[authorKey(b.author)] = 1;
  store.set('reader.hidden', h);
}
function unhideBook(b) {
  const h = getHidden();
  delete h.urls[b.url];
  if (b.author) delete h.authors[authorKey(b.author)];
  store.set('reader.hidden', h);
}
const adultText = (b) => [b.title, b.genre, b.name, b.path].filter(Boolean).join(' ');
const visibleCats = (list) => (S.safe ? (list || []).filter((c) => !ADULT_RE.test(`${c.name} ${c.path}`)) : list || []);
const safeList = (list) => {
  const hid = getHidden();
  return (list || []).filter((b) =>
    !hid.urls[b.url] &&
    !(b.author && hid.authors[authorKey(b.author)]) &&
    !(S.safe && ADULT_RE.test(adultText(b))));
};

let catalogP = null;
const getCatalog = () =>
  catalogP || (catalogP = api('/api/catalog').catch((e) => { catalogP = null; throw e; }));

async function loadGenres() {
  try {
    const cats = visibleCats(await getCatalog());
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
      const fresh = safeList(d.results).filter((b) => !seen.has(b.url));
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
  document.body.dataset.view = view;
  document.title = 'BookLife';
  window.scrollTo(0, 0);

  switch (view) {
    case 'search': return viewSearch(id, dec(parts[1] || ''));
    case 'cat': return viewCategory(id, dec(parts[1] || ''));
    case 'book': return viewBook(id, dec(parts[1] || ''));
    case 'read': return viewRead(id, dec(parts[1] || ''), parseInt(parts[2], 10) || 1);
    case 'shelf': return viewShelf(id);
    case 'fav': return viewFav(id);
    case 'profile': return viewProfile(id);
    default: return viewHome(id);
  }
}

/* ============================== главная ============================== */

const CAT_ICONS = ['star', 'growth', 'heart', 'mask', 'door'];
const ratingHtml = (b) => (b.rating ? `<span class="rt">${icon('star')}${esc(b.rating)}</span>` : '');

function heroSlide(b) {
  const w = String(b.title || '').trim().split(/\s+/);
  const k = Math.ceil(w.length / 2);
  const first = esc(w.slice(0, k).join(' '));
  const rest = esc(w.slice(k).join(' '));
  return `
    <a class="slide" href="#/book/${enc(b.url)}">
      ${b.cover ? `<img class="sbg" src="${imgSrc(b.cover)}" alt="" onerror="this.remove()">` : ''}
      <div class="stext">
        <span class="badge">${esc(b.cat || 'Подборка')}</span>
        <h2>${first}${rest ? ` <em>${rest}</em>` : ''}</h2>
        <p>${esc(b.author)}</p>
        <span class="sbtn">Читать книгу ${icon('arrow')}</span>
      </div>
      <div class="cover">${coverInner(b)}</div>
    </a>`;
}
function heroHtml(list) {
  return `<div class="hero"><div class="hero-track" id="heroTrack">${list.map(heroSlide).join('')}</div>
    <div class="hero-count" id="heroCount">1 / ${list.length}</div></div>
    <div class="dots" id="dots">${list.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>`;
}
function rcardHtml(b) {
  known.set(b.url, b);
  const on = Boolean(getShelf()[b.url]);
  return `
    <div class="rcard">
      <a href="#/book/${enc(b.url)}">
        <div class="cover">${coverInner(b)}</div>
        <div class="t">${esc(b.title)}</div>
        <div class="a">${esc(b.author)}</div>
      </a>
      <button class="xhide" type="button" data-hide="${esc(b.url)}" aria-label="Не показывать эту книгу и автора">${icon('close')}</button>
      <div class="rcf">${ratingHtml(b)}<button class="fav ${on ? 'on' : ''}" type="button" data-fav="${esc(b.url)}" aria-pressed="${on}" aria-label="В избранное">${icon('heart')}</button></div>
    </div>`;
}
function popHtml(b, i) {
  known.set(b.url, b);
  return `
    <a class="pop" href="#/book/${enc(b.url)}">
      <span class="num">${i + 1}</span>
      <div class="cover">${coverInner(b)}</div>
      <div class="pm"><div class="t">${esc(b.title)}</div><div class="a">${esc(b.author)}</div>${ratingHtml(b)}</div>
      <span class="rbtn">Читать</span>
    </a>`;
}

async function fillTiles(id) {
  const box = $('#tiles');
  if (!box) return;
  try {
    const cats = visibleCats(await getCatalog());
    if (id !== navId) return;
    box.innerHTML = cats
      .map((c, i) => `<a class="gcard" style="--h:${hashStr(c.name) % 360}" href="#/cat/${enc(c.path)}/1"><div><b>${esc(c.name)}</b>${Number(c.count) ? `<small>${Number(c.count).toLocaleString('ru-RU')} книг</small>` : ''}</div>${icon(CAT_ICONS[i % CAT_ICONS.length])}</a>`)
      .join('');
  } catch (e) {
    if (id === navId) box.innerHTML = stateHtml('Жанры не загрузились', e.message, retryBtn);
  }
}

async function viewHome(id) {
  setNav('home');
  markGenre(null);

  const recent = recentList();
  let html = `<div id="heroBox"><div class="skel-line" style="height:236px;border-radius:28px;margin:4px 0"></div></div><div id="chipsBox"></div>`;

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
      html += `<div class="sech"><h2>Недавние</h2></div><div class="row">${recent.slice(1, 12).map(progressCardHtml).join('')}</div>`;
    }
  }
  html += `<div id="listsBox"></div>`;
  content.innerHTML = html;

  try {
    const cats = visibleCats(await getCatalog());
    if (id !== navId) return;
    $('#chipsBox').innerHTML = `<div class="chips cats">${cats.slice(0, 7)
      .map((c, i) => `<a class="cat" href="#/cat/${enc(c.path)}/1">${icon(CAT_ICONS[i % CAT_ICONS.length])}<span>${esc(c.name)}</span></a>`)
      .join('')}<a class="cat" href="#/search/">${icon('compass')}<span>Все жанры</span></a></div>`;

    const src = S.safe ? homeCats(cats) : cats;
    const load = (c) => (c ? api(`/api/category?path=${enc(c.path)}&page=1`).catch(() => null) : Promise.resolve(null));
    const [da, db] = await Promise.all([load(src[0]), load(src[1])]);
    if (id !== navId) return;

    const A = safeList(da && da.results);
    if (!A.length) {
      $('#heroBox').innerHTML = stateHtml('Подборка не загрузилась', 'Проверьте соединение и попробуйте ещё раз.', retryBtn);
      return;
    }
    const tag = (da && da.title) || src[0].name;
    const withCover = A.filter((x) => x.cover);
    const heroList = (withCover.length >= 3 ? withCover : A).slice(0, 5).map((x) => ({ ...x, cat: tag }));
    $('#heroBox').innerHTML = heroHtml(heroList);

    const track = $('#heroTrack'), cnt = $('#heroCount'), dots = [...$('#dots').children];
    track.addEventListener('scroll', () => {
      const i = Math.min(heroList.length - 1, Math.round(track.scrollLeft / Math.max(1, track.clientWidth)));
      cnt.textContent = `${i + 1} / ${heroList.length}`;
      dots.forEach((d, k) => d.classList.toggle('on', k === i));
    }, { passive: true });

    const inHero = new Set(heroList.map((x) => x.url));
    let recs = A.filter((x) => !inHero.has(x.url)).slice(0, 10);
    if (recs.length < 4) recs = A.slice(0, 10);

    const B = safeList(db && db.results);
    const pops = (B.length ? B : A.slice().reverse()).slice(0, 5);
    const popCat = B.length ? src[1] : src[0];

    $('#listsBox').innerHTML = `
      <div class="sech"><h2>Рекомендуем</h2><a href="#/cat/${enc(src[0].path)}/1">Все книги ${icon('arrow')}</a></div>
      <div class="rrow">${recs.map(rcardHtml).join('')}</div>
      <div class="sech"><h2>Популярное 🔥</h2><a href="#/cat/${enc(popCat.path)}/1">Все книги ${icon('arrow')}</a></div>
      <div class="pops">${pops.map(popHtml).join('')}</div>`;
  } catch (e) {
    if (id === navId) $('#heroBox').innerHTML = stateHtml('Не удалось загрузить', e.message, retryBtn);
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
      <div class="head"><h1>Каталог</h1><p>Найдите книгу или автора, либо выберите жанр.</p></div>
      ${qs.length ? `<h2 class="sec">Недавние запросы</h2><div class="chips" style="flex-wrap:wrap">${qs
        .map((x) => `<a class="chip" href="#/search/${enc(x)}/1">${esc(x)}</a>`).join('')}</div>` : ''}`;
    content.insertAdjacentHTML('beforeend', `<h2 class="sec">Жанры</h2><div class="gcards" id="tiles">${'<div class="skel-line" style="height:88px;border-radius:20px;margin:0"></div>'.repeat(8)}</div>`);
    fillTiles(id);
    if (matchMedia('(min-width: 900px)').matches) searchInput.focus();
    return;
  }

  document.title = q + ' — поиск';
  content.innerHTML = `<div class="head"><h1>${esc(q)}</h1><p>Ищем книги…</p></div>${skeletonGrid()}`;

  try {
    const data = await api(`/api/search?q=${enc(q)}&page=1`);
    if (id !== navId) return;
    data.results = safeList(data.results);
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
    if (S.safe && ADULT_RE.test(`${data.title || ''} ${path}`)) {
      content.innerHTML = stateHtml('Раздел скрыт', 'Вы скрыли книги 18+. Их можно показать в настройках оформления.', '<button class="btn alt" type="button" data-show-adult>Показать 18+</button>');
      return;
    }
    data.subs = visibleCats(data.subs);
    data.results = safeList(data.results);
    const title = data.title || 'Каталог';
    document.title = title;

    const chips = data.subs.length
      ? `<div class="chips">${data.subs.map((s) => `<a class="chip" href="#/cat/${enc(s.path)}/1">${esc(s.name)}</a>`).join('')}</div>`
      : '';

    content.innerHTML = `
      <div class="pagebar"><button class="ibtn rnd" type="button" data-back aria-label="Назад">${icon('back')}</button></div>
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

const libTabs = (on) =>
  `<div class="segtabs"><a class="${on === 'shelf' ? 'on' : ''}" href="#/shelf">Читаю</a><a class="${on === 'fav' ? 'on' : ''}" href="#/fav">Избранное</a></div>`;

const delBtn = (kind, url, label) =>
  `<button class="del" type="button" data-del="${kind}" data-url="${esc(url)}" aria-label="${label}">${icon('trash')}</button>`;

function viewShelf(id) {
  setNav('shelf');
  markGenre(null);
  const reading = recentList();
  const rows = reading.map((p) => {
    const pc = pctOf(p);
    return `
      <div class="lrow">
        <a class="lmain" href="#/read/${enc(p.url)}/${p.page || 1}">
          <div class="cover">${coverInner(p)}</div>
          <div class="lm"><div class="t">${esc(p.title)}</div><div class="a">${esc(p.author)}</div><div class="bar"><i style="width:${pc}%"></i></div></div>
          <span class="lpct">${pc}%</span>
        </a>
        ${delBtn('progress', p.url, 'Убрать из «Читаю»')}
      </div>`;
  }).join('');
  content.innerHTML = `<div class="head"><h1>Моя библиотека</h1></div>${libTabs('shelf')}` + (reading.length
    ? `<div class="llist">${rows}</div>`
    : stateHtml('Пока ничего не читаете', 'Откройте любую книгу — она появится здесь вместе с вашим прогрессом.', '<a class="btn" href="#/search/">Найти книгу</a>'));
}

function viewFav(id) {
  setNav('fav');
  markGenre(null);
  const shelf = Object.values(getShelf()).sort((a, b) => b.added - a.added);
  const rows = shelf.map((b) => `
    <div class="lrow">
      <a class="lmain" href="#/book/${enc(b.url)}">
        <div class="cover">${coverInner(b)}</div>
        <div class="lm"><div class="t">${esc(b.title)}</div><div class="a">${esc(b.author)}</div></div>
      </a>
      ${delBtn('shelf', b.url, 'Убрать из избранного')}
    </div>`).join('');
  content.innerHTML = `<div class="head"><h1>Моя библиотека</h1></div>${libTabs('fav')}` + (shelf.length
    ? `<div class="llist">${rows}</div>`
    : stateHtml('Здесь пусто', 'Нажмите на закладку или сердечко у книги — она сохранится здесь.', '<a class="btn" href="#/">Выбрать книгу</a>'));
}

function viewProfile(id) {
  setNav('profile');
  markGenre(null);
  const prog = Object.values(getProgress());
  const done = prog.filter((p) => pctOf(p) >= 97).length;
  const favs = Object.keys(getShelf()).length;
  const hiddenN = Object.keys(getHidden().urls).length;
  content.innerHTML = `
    <div class="prof">
      <div class="avatar">${icon('user')}</div>
      <h1>Мой профиль</h1>
      <p>Всё хранится на этом устройстве</p>
    </div>
    <div class="stats">
      <div><b>${prog.length - done}</b><span>В процессе</span></div>
      <div><b>${done}</b><span>Прочитано</span></div>
      <div><b>${favs}</b><span>Избранное</span></div>
    </div>
    <div class="menu">
      <a href="#/shelf">${icon('books')}<span>Моя библиотека</span>${icon('chev')}</a>
      <a href="#/fav">${icon('heart')}<span>Избранное</span>${icon('chev')}</a>
      <button type="button" data-open-settings>${icon('gear')}<span>Оформление и чтение</span>${icon('chev')}</button>
      ${hiddenN ? `<button type="button" data-unhide>${icon('close')}<span>Показать скрытые книги (${hiddenN})</span></button>` : ''}
      <button type="button" data-clear>${icon('close')}<span>Очистить историю чтения</span></button>
    </div>`;
}

/* ============================== книга ============================== */

async function viewBook(id, url) {
  setNav(null);
  markGenre(null);
  content.innerHTML = `<div class="bpage"><div class="skel-line" style="height:240px;border-radius:24px;margin-top:60px"></div></div>`;

  try {
    const b = await api(`/api/book?url=${enc(url)}`);
    if (id !== navId) return;
    document.title = b.title;

    const p = getProgress()[url];
    const started = p && p.page && (p.page > 1 || (p.scroll || 0) > 0.02 || (p.block || 0) > 0);
    const pc = pctOf(p);
    let onShelf = Boolean(getShelf()[url]);
    if (onShelf) { const sh = getShelf(); sh[url] = { ...sh[url], title: b.title, author: b.author, cover: b.cover }; store.set('reader.shelf', sh); }

    const desc = b.description || b.annotation || b.about || '';
    const rawTags = Array.isArray(b.genres) ? b.genres : b.genre ? [b.genre] : [];
    const tags = rawTags.map((t) => (typeof t === 'string' ? t : t && t.name)).filter(Boolean).slice(0, 4);

    content.innerHTML = `
      <div class="bpage">
        <div class="pagebar"><button class="ibtn rnd" type="button" data-back aria-label="Назад">${icon('back')}</button></div>
        <div class="btop">
          <div class="cover">${coverInner(b)}</div>
          <div class="bmeta">
            <h1>${esc(b.title)}</h1>
            <div class="by">${esc(b.author || 'Автор не указан')}</div>
            ${ratingHtml(b)}
            <div class="facts">${b.totalPages} стр. текста</div>
          </div>
        </div>
        ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        ${desc ? `<h2 class="sec">О книге</h2><p class="bdesc">${esc(desc)}</p>` : ''}
        ${started ? `<div class="bar"><i style="width:${pc}%"></i></div>` : ''}
        <div class="bacts">
          <a class="btn" href="#/read/${enc(url)}/${started ? p.page : 1}">${started ? `Продолжить · стр. ${p.page}` : 'Читать книгу'}</a>
          <button class="fbtn ${onShelf ? 'on' : ''}" type="button" id="shelfBtn" aria-pressed="${onShelf}" aria-label="В избранное">${icon('mark')}</button>
        </div>
        ${started ? `<a class="brestart" href="#/read/${enc(url)}/1" data-restart>Начать сначала</a>` : ''}
        <button class="bhide" type="button" id="hideBtn">Не показывать эту книгу и автора</button>
      </div>`;

    $('#shelfBtn').onclick = () => {
      onShelf = toggleShelf(b);
      $('#shelfBtn').classList.toggle('on', onShelf);
      $('#shelfBtn').setAttribute('aria-pressed', String(onShelf));
    };
    $('#hideBtn').onclick = () => {
      hideBook(b);
      snack('Книга и автор скрыты', () => unhideBook(b));
      if (history.length > 1) history.back(); else location.hash = '#/';
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
        <div class="rrow1">
          <a class="ibtn rnd" href="${bookHref}" aria-label="К описанию книги">${icon('back')}</a>
          <div class="rcov"><div class="cover" id="rCov">${saved.title ? coverInner(saved) : ''}</div></div>
          <div class="rtitle"><b id="rTitle">${esc(saved.title || '')}</b><span id="rAuthor">${esc(saved.author || '')}</span></div>
          <button class="ibtn rnd" type="button" id="rFav" aria-label="В избранное">${icon('mark')}</button>
        </div>
        <div class="rrow2"><span class="pill" id="rPill"></span><span id="rMeta"></span></div>
      </header>
      <footer class="rbot">
        <div class="rlabel" id="rLabel"></div>
        <input type="range" id="rRange" min="0" max="1000" value="0" aria-label="Положение в книге">
        <div class="rends"><span>Начало</span><span>Конец</span></div>
        <div class="rctl">
          <button type="button" class="side" id="rPrev" aria-label="Предыдущая часть">${icon('prev')}</button>
          <button type="button" class="rmain" data-open-settings><span class="aa">Aa</span>Оформление</button>
          <button type="button" class="side" id="rNext" aria-label="Следующая часть">${icon('next')}</button>
        </div>
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
    try { navigator.vibrate && navigator.vibrate(5); } catch {}
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
    $('#rPill').textContent = `Часть ${f.p} из ${total}`;
    $('#rMeta').textContent = `${pc}% прочитано`;

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

  const goPart = (d) => {
    if (!cur) return;
    const p = Math.min(total, Math.max(1, cur.p + d));
    if (p === cur.p) return toast(d > 0 ? 'Это последняя часть' : 'Это первая часть');
    jumpTo(((p - 1) / total) * 1000 + 0.01);
  };
  $('#rPrev').onclick = () => goPart(-1);
  $('#rNext').onclick = () => goPart(1);

  const favBtn = $('#rFav');
  const syncFav = () => favBtn.classList.toggle('on', Boolean(getShelf()[url]));
  syncFav();
  favBtn.onclick = () => {
    toggleShelf({ url, title: meta.title || '', author: meta.author || '', cover: meta.cover });
    syncFav();
  };

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
      $('#rCov').innerHTML = coverInner(meta);
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
    .map(([k, t]) => `<button type="button" class="sws ${S.theme === k ? 'on' : ''}" data-set="theme" data-val="${k}"><i style="background:${t.sw};color:${t.ck}">${S.theme === k ? icon('check') : ''}</i><span>${t.name}</span></button>`)
    .join('');
  const seg = (key, items) =>
    items.map(([v, label, cls]) => `<button type="button" class="${cls || ''} ${String(S[key]) === String(v) ? 'on' : ''}" data-set="${key}" data-val="${v}">${label}</button>`).join('');

  return `
    <div class="sh-row"><div class="sh-label">Тема</div><div class="swrow">${themes}</div></div>
    <div class="sh-row">
      <div class="sh-label"><span>Яркость</span><span id="brPct">${S.bright}%</span></div>
      <div class="sizeRow"><span class="sunI">${icon('sun')}</span><input type="range" id="brightRange" min="40" max="100" step="1" value="${S.bright}" aria-label="Яркость"></div>
    </div>
    <div class="sh-row">
      <div class="sh-label"><span>Размер текста</span><span id="szVal">${S.size}</span></div>
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
      <div class="seg">${seg('justify', [[false, 'По левому краю'], [true, 'По ширине']])}</div></div>
    <div class="sh-row"><div class="sh-label">Эротика 18+</div>
      <div class="seg">${seg('safe', [[true, 'Скрывать'], [false, 'Показывать']])}</div></div>`;
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

  const sh = sheetRoot.querySelector('.sheet');
  if (sh && matchMedia('(max-width: 899px)').matches) {
    let y0 = null, dy = 0;
    const start = (e) => {
      if (e.target.closest('button')) return;
      y0 = e.clientY; dy = 0; sh.style.transition = 'none';
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    };
    const move = (e) => {
      if (y0 == null) return;
      dy = Math.max(0, e.clientY - y0);
      sh.style.transform = `translateY(${dy}px)`;
    };
    const end = () => {
      if (y0 == null) return;
      y0 = null; sh.style.transition = ''; sh.style.transform = '';
      if (dy > 100) closeSheet();
    };
    sh.querySelectorAll('.grab, .sh-head').forEach((el) => {
      el.addEventListener('pointerdown', start);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    });
  }
}

let refreshOnClose = false; // после смены фильтра 18+ обновляем экран, когда шторка закрыта
function closeSheet(instant) {
  if (refreshOnClose) {
    refreshOnClose = false;
    if (!document.body.classList.contains('reading')) setTimeout(route, 150);
  }
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
    S[k] = k === 'lh' ? Number(v) : (k === 'justify' || k === 'safe') ? v === 'true' : v;
  } else return;
  applySettings();
  if (set && set.dataset.set === 'safe') { refreshOnClose = true; loadGenres(); }
  $('#sheetBody').innerHTML = sheetBody();
});
sheetRoot.addEventListener('input', (e) => {
  if (e.target.id === 'sizeRange') {
    S.size = Number(e.target.value);
    applySettings();
    const v = $('#szVal');
    if (v) v.textContent = S.size;
  } else if (e.target.id === 'brightRange') {
    S.bright = Number(e.target.value);
    document.documentElement.style.setProperty('--bright', S.bright / 100);
    store.set('reader.settings.v3', S);
    const v = $('#brPct');
    if (v) v.textContent = S.bright + '%';
  }
});

/* ============================== события ============================== */

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open-settings]')) {
    sheetRoot.classList.contains('open') ? closeSheet() : openSheet();
  }
  if (e.target.closest('[data-retry]')) route();
  if (e.target.closest('[data-back]')) {
    if (history.length > 1) history.back(); else location.hash = '#/';
  }
  if (e.target.closest('[data-clear]') && confirm('Удалить прогресс чтения всех книг?')) {
    store.set('reader.progress', {});
    route();
  }
  const hid = e.target.closest('[data-hide]');
  if (hid) {
    e.preventDefault();
    const b = known.get(hid.dataset.hide);
    if (b) {
      hideBook(b);
      const card = hid.closest('.rcard');
      if (card) card.remove();
      snack('Книга и автор скрыты', () => { unhideBook(b); route(); });
    }
  }
  if (e.target.closest('[data-unhide]') && confirm('Показывать все скрытые книги и авторов снова?')) {
    store.set('reader.hidden', { urls: {}, authors: {} });
    route();
  }
  const del = e.target.closest('[data-del]');
  if (del) {
    e.preventDefault();
    removeBook(del.dataset.del, del.dataset.url, del.closest('.lrow'));
  }
  if (e.target.closest('[data-show-adult]')) {
    S.safe = false;
    applySettings();
    loadGenres();
    route();
  }
  const fav = e.target.closest('[data-fav]');
  if (fav) {
    e.preventDefault();
    const b = known.get(fav.dataset.fav);
    if (b) {
      const on = toggleShelf(b);
      fav.classList.toggle('on', on);
      fav.setAttribute('aria-pressed', String(on));
    }
  }
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
