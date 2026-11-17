'use strict';

const path = require('path');
const express = require('express');
const libcat = require('./libcat');

const app = express();
const PORT = process.env.PORT || 8099;

app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------- простой кэш ответов --------------------------- */

const cache = new Map();
const TTL = 10 * 60 * 1000; // 10 минут

function cached(key, producer) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return Promise.resolve(hit.v);
  return producer().then((v) => {
    cache.set(key, { t: Date.now(), v });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return v;
  });
}

function api(fn) {
  return (req, res) => {
    Promise.resolve(fn(req))
      .then((data) => res.json(data))
      .catch((err) => {
        console.error('[api]', req.originalUrl, '-', err.message);
        res.status(502).json({ error: err.message });
      });
  };
}

/* --------------------------------- API ----------------------------------- */

app.get('/api/catalog', api(() => cached('catalog', () => libcat.catalog())));

app.get(
  '/api/category',
  api((req) =>
    cached(`cat:${req.query.path}:${req.query.page || 1}`, () =>
      libcat.category(req.query.path, req.query.page)
    )
  )
);

app.get(
  '/api/search',
  api((req) =>
    cached(`q:${req.query.q}:${req.query.page || 1}`, () =>
      libcat.search(req.query.q, req.query.page)
    )
  )
);

app.get(
  '/api/book',
  api((req) => cached(`b:${req.query.url}`, () => libcat.book(req.query.url)))
);

app.get(
  '/api/read',
  api((req) =>
    cached(`r:${req.query.url}:${req.query.page || 1}`, () =>
      libcat.read(req.query.url, req.query.page)
    )
  )
);

/* ------------------------- прокси обложек (кэш) -------------------------- */

const imgCache = new Map();

app.get('/api/img', async (req, res) => {
  let target = '';
  try {
    target = Buffer.from(String(req.query.d || ''), 'base64url').toString('utf8');
  } catch (e) {
    target = '';
  }
  if (!/^https?:\/\//.test(target)) return res.status(400).end();

  const hit = imgCache.get(target);
  if (hit) {
    res.set('Content-Type', hit.type).set('Cache-Control', 'public, max-age=86400');
    return res.end(hit.body);
  }

  try {
    const up = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: libcat.BASE + '/' },
    });
    if (!up.ok) return res.status(up.status).end();
    const type = up.headers.get('content-type') || 'image/webp';
    const body = Buffer.from(await up.arrayBuffer());
    imgCache.set(target, { type, body });
    if (imgCache.size > 400) imgCache.delete(imgCache.keys().next().value);
    res.set('Content-Type', type).set('Cache-Control', 'public, max-age=86400');
    res.end(body);
  } catch (err) {
    res.status(502).end();
  }
});

app.listen(PORT, () => {
  console.log(`Читалка запущена: http://localhost:${PORT}`);
});
