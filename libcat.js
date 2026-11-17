'use strict';

/**
 * Парсер источника libcat.ru.
 * Отдаёт нормализованные данные для читалки: поиск, каталог, книга, текст страницы.
 */

const cheerio = require('cheerio');

const BASE = 'https://libcat.ru';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* ------------------------------- утилиты --------------------------------- */

function abs(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  return BASE + (url.startsWith('/') ? url : '/' + url);
}

async function fetchHtml(pathOrUrl, attempt = 0) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : abs(pathOrUrl);
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru-RU,ru;q=0.9',
      Referer: BASE + '/',
    },
  });

  // источник иногда отвечает 429 при частых запросах — мягкий повтор с паузой
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return fetchHtml(pathOrUrl, attempt + 1);
  }

  if (!res.ok) throw new Error('Источник ответил HTTP ' + res.status);
  return res.text();
}

function clean(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

// Убираем любые упоминания источника и издательских меток из текста.
const BRAND = /(?:litres|литрес|либкат|libcat)(?:\.ru)?/gi;

function stripBrand(text) {
  if (!text) return '';
  let s = String(text);

  // сначала чистим внутри скобок/кавычек, чтобы не оставалось пустых [ ] и ( )
  s = s.replace(/\[([^\]]*)\]/g, (_, inner) => {
    const cleaned = clean(inner.replace(BRAND, ''));
    return cleaned ? `[${cleaned}]` : '';
  });
  s = s.replace(/\(([^)]*)\)/g, (_, inner) => {
    const cleaned = clean(inner.replace(BRAND, ''));
    return cleaned ? `(${cleaned})` : '';
  });

  s = s.replace(BRAND, '');
  return clean(s).replace(/\s+([,.;:!?])/g, '$1').trim();
}

// Превью-обложки источника заменяем на полноразмерные.
function bigCover(url) {
  if (!url) return null;
  return url.replace(/-thumb\.(webp|jpe?g|png)$/i, '.$1');
}

function isPlaceholderCover(url) {
  return Boolean(url && /\/images\/nocover(?:[-_.][^/]*)?\.(?:webp|jpe?g|png)$/i.test(url));
}

/* ------------------------------ карточки --------------------------------- */

function parseCards($) {
  const out = [];
  const seen = new Set();

  $('.tg-postbook').each((_, el) => {
    const $el = $(el);
    const href =
      $el.find('a.tg-featureimg').attr('href') ||
      $el.find('.tg-booktitle a').attr('href');
    if (!href || seen.has(href)) return;
    seen.add(href);

    const $img = $el.find('.tg-frontcover img').first();
    let cover = $img.attr('data-src') || $img.attr('src') || null;
    if (cover && cover.startsWith('data:')) cover = $img.attr('data-src') || null;

    const title = stripBrand($el.find('.tg-booktitle a').first().text());
    const author = stripBrand($el.find('.tg-bookwriter').first().text());

    const style = $el.find('.unit-rating .current-rating').attr('style') || '';
    const pct = (style.match(/(\d+(?:\.\d+)?)%/) || [])[1];
    const fullCover = cover ? bigCover(abs(cover)) : null;

    out.push({
      url: href,
      title,
      author,
      cover: isPlaceholderCover(fullCover) ? null : fullCover,
      rating: pct ? Math.round(Number(pct) / 20) : 0, // 0..5
    });
  });

  return out;
}

function bookPageUrl(bookUrl, page) {
  const u = abs(bookUrl);
  const n = Math.max(1, parseInt(page, 10) || 1);
  if (n === 1) return u;
  return u.replace(/(\d+)-([^/]+)\.html$/, (m, id, rest) => `${id}-${n}-${rest}.html`);
}

/* -------------------------------- API ------------------------------------ */

async function search(query, page = 1) {
  const q = clean(query);
  if (!q) return { query: q, page: 1, results: [], hasNext: false };

  const n = Math.max(1, parseInt(page, 10) || 1);
  const path =
    n > 1
      ? `/search/page/${n}/?q=${encodeURIComponent(q)}`
      : `/search/?q=${encodeURIComponent(q)}`;

  const html = await fetchHtml(path);
  const $ = cheerio.load(html);

  return {
    query: q,
    page: n,
    results: parseCards($),
    hasNext: $(`a[href*="/search/page/${n + 1}/"]`).length > 0,
  };
}

async function catalog() {
  const html = await fetchHtml('/knigi/');
  const $ = cheerio.load(html);
  const cats = [];
  $('a[href^="/knigi/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!/^\/knigi\/[^/]+\/$/.test(href)) return;
    const name = clean($(el).text());
    if (name && !cats.find((c) => c.path === href)) cats.push({ name, path: href });
  });
  return cats;
}

async function category(path, page = 1) {
  const basePath = abs(path);
  const n = Math.max(1, parseInt(page, 10) || 1);
  const url = n > 1 ? `${basePath.replace(/\/$/, '')}/page/${n}/` : basePath;

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  // относительный префикс ссылок поджанров, например /knigi/fantastika-i-fjentezi
  const base = basePath.replace(BASE, '').replace(/\/$/, '');
  const subs = [];
  $(`a[href^="${base}/"]`).each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!/^\/knigi\/[^/]+\/[^/]+\/$/.test(href)) return;
    const name = clean($(el).text());
    if (name && !subs.find((s) => s.path === href)) subs.push({ name, path: href });
  });

  const rawTitle = clean($('h1').first().text()) || clean($('title').first().text());

  return {
    title: cleanTitle(rawTitle),
    path: basePath,
    page: n,
    subs,
    results: parseCards($),
    hasNext: $(`a[href*="/page/${n + 1}/"]`).length > 0,
  };
}

function cleanTitle(text) {
  return stripBrand(text)
    .replace(/\s*[|—-]\s*читать книги онлайн.*$/i, '')
    .replace(/\s*читать книги онлайн бесплатно.*$/i, '')
    .trim();
}

async function book(bookUrl) {
  const html = await fetchHtml(bookUrl);
  const $ = cheerio.load(html);

  const readEl = $('#read');
  const totalPages = parseInt(readEl.attr('data-count'), 10) || 1;

  let author = stripBrand($('a[itemprop="author"]').first().text());
  let title = '';

  const titleBlock = $('#read div.title').first().find('p');
  if (titleBlock.length >= 2) {
    author = author || stripBrand(titleBlock.eq(0).text());
    title = stripBrand(titleBlock.eq(1).text());
  }
  if (!title) {
    const h1 = clean($('h1').first().text());
    const shortAuthor = author.split(' ')[0] + ' ' + (author.split(' ')[1] || '');
    title = h1.replace(new RegExp('^' + shortAuthor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*-\\s*'), '');
    title = stripBrand(title || h1);
  }
  if (!author) author = stripBrand($('.tg-bookwriter').first().text());

  return {
    url: abs(bookUrl),
    title: title || stripBrand($('title').first().text()),
    author,
    cover: (() => {
      const cover = bigCover(abs($('meta[property="og:image"]').attr('content')));
      return isPlaceholderCover(cover) ? null : cover;
    })(),
    totalPages,
  };
}

async function read(bookUrl, page = 1) {
  const url = bookPageUrl(bookUrl, page);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const readEl = $('#read');
  const total = parseInt(readEl.attr('data-count'), 10) || 1;
  const cur = parseInt(readEl.attr('data-cur'), 10) || (parseInt(page, 10) || 1);

  // вырезаем навигацию, рекламные блоки, скрипты и прочий мусор
  readEl
    .find(
      '.navigation, #text, script, style, ins, iframe, noscript, ' +
        '.adsbygoogle, [id^="yandex_rtb"], [class*="banner"], .mark, .marks'
    )
    .remove();

  const blocks = [];
  readEl.find('div.title, p').each((_, el) => {
    const $e = $(el);
    if ($e.parent().is('div.title')) return; // не дублируем <p> внутри заголовков

    if ($e.hasClass('title')) {
      const lines = $e.find('p');
      const items = lines.length ? lines.toArray() : [$e[0]];
      items.forEach((node) => {
        const text = stripBrand($(node).text());
        if (text) blocks.push({ type: 'h', text });
      });
    } else {
      const text = stripBrand($e.text());
      if (text) blocks.push({ type: 'p', text });
    }
  });

  return { page: cur, total, blocks };
}

module.exports = { search, catalog, category, book, read, BASE };
