'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const libcat = require('./libcat');

const app = express();
const PORT = process.env.PORT || 8099;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '16kb' }));

/* --------------------- авторизация через Telegram ------------------------ */

// Токен вшит по просьбе владельца. Переменная окружения BOT_TOKEN имеет приоритет.
const BOT_TOKEN = process.env.BOT_TOKEN || ';
const INITDATA_MAX_AGE = 24 * 60 * 60; // сек: initData старше суток не принимаем
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // сессия живёт 30 дней

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data);
const SESSION_KEY = hmac('booklife-session', BOT_TOKEN).digest();

// Проверка подписи initData по документации Telegram Mini Apps
function verifyInitData(initData) {
  if (typeof initData !== 'string' || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = hmac('WebAppData', BOT_TOKEN).digest();
  const calc = hmac(secret, checkString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== calc.length || !crypto.timingSafeEqual(given, calc)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > INITDATA_MAX_AGE) return null;

  try { return JSON.parse(params.get('user')); } catch (e) { return null; }
}

function signSession(user) {
  const body = Buffer.from(
    JSON.stringify({
      id: user.id,
      fn: user.first_name || '',
      ln: user.last_name || '',
      un: user.username || '',
      ph: user.photo_url || '',
      exp: Date.now() + SESSION_TTL,
    })
  ).toString('base64url');
  return body + '.' + hmac(SESSION_KEY, body).digest('base64url');
}

function readSession(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const good = hmac(SESSION_KEY, body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== good.length || !crypto.timingSafeEqual(got, good)) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return d.exp > Date.now() ? d : null;
  } catch (e) { return null; }
}

const publicUser = (d) => ({
  id: d.id,
  firstName: d.fn,
  lastName: d.ln,
  username: d.un,
  photo: d.ph,
});

app.post('/api/auth/telegram', (req, res) => {
  const user = verifyInitData(req.body && req.body.initData);
  if (!user || !user.id) return res.status(401).json({ error: 'Не удалось подтвердить вход через Telegram' });
  const token = signSession(user);
  res.json({ token, user: publicUser(readSession(token)) });
});

// Все остальные /api/* (кроме картинок) требуют сессию
app.use('/api', (req, res, next) => {
  if (req.path === '/img') return next();
  const m = /^Bearer (.+)$/.exec(req.get('Authorization') || '');
  const sess = m && readSession(m[1]);
  if (!sess) return res.status(401).json({ error: 'Требуется вход через Telegram' });
  req.user = sess;
  next();
});

app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user) }));

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
