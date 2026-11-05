// Общие утилиты для всех страниц.

let menuPromise;

/** Загружает data/menu.json (один раз за страницу). */
export function loadMenu() {
  menuPromise ??= fetch(new URL('../data/menu.json', import.meta.url))
    .then((r) => {
      if (!r.ok) throw new Error(`menu.json: HTTP ${r.status}`);
      return r.json();
    })
    .then(applyOverrides);
  return menuPromise;
}

/* ---------- Персонализация под конкретный ресторан ----------
   Табличка с QR (setup.html) кодирует в ссылку на меню параметры:
   n — название, t — слоган, w — Wi-Fi сеть, p — пароль, s — защита (WPA/WEP/nopass), tb — номер стола.
   Параметры запоминаются на время визита, чтобы не терялись при переходах по страницам. */
const OV_KEYS = ['n', 't', 'w', 'p', 's', 'tb'];
const OV_STORE = 'db-overrides';

export function readOverrides() {
  const q = new URLSearchParams(location.search);
  const fromUrl = {};
  OV_KEYS.forEach((k) => { if (q.has(k)) fromUrl[k] = q.get(k); });
  try {
    if (Object.keys(fromUrl).length) sessionStorage.setItem(OV_STORE, JSON.stringify(fromUrl));
    else return JSON.parse(sessionStorage.getItem(OV_STORE) || '{}');
  } catch { /* приватный режим — живём без памяти */ }
  return fromUrl;
}

function applyOverrides(menu) {
  const o = readOverrides();
  const cafe = menu.cafe;
  if (o.n) cafe.name = o.n;
  if (o.t) cafe.tagline = o.t;
  if (o.tb) cafe.table = o.tb;
  if (o.w) cafe.wifi = { ssid: o.w, password: o.p || '', security: o.s || (o.p ? 'WPA' : 'nopass') };
  return menu;
}

/** Строка для QR-кода Wi-Fi (стандарт ZXing, понимают камеры iPhone и Android). */
export function wifiQRString({ ssid = '', password = '', security = 'WPA' } = {}) {
  const e = (v) => String(v).replace(/([\\;,:"])/g, '\\$1');
  const t = security === 'nopass' || !password ? 'nopass' : security;
  return `WIFI:T:${t};S:${e(ssid)};${t === 'nopass' ? '' : `P:${e(password)};`};`;
}

/** Ссылка на меню с персональными параметрами ресторана. */
export function personalUrl(base, cfg) {
  const u = new URL(base);
  const map = { n: cfg.name, t: cfg.tagline, w: cfg.ssid, p: cfg.password, s: cfg.security, tb: cfg.table };
  Object.entries(map).forEach(([k, v]) => { if (v) u.searchParams.set(k, v); });
  return u.href;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

export async function getDish(id) {
  const menu = await loadMenu();
  return { menu, dish: menu.dishes.find((d) => d.id === id) || null };
}

export const param = (name) => new URLSearchParams(location.search).get(name);

export const formatPrice = (value, currency = '₽') =>
  `${new Intl.NumberFormat('ru-RU').format(value)} ${currency}`;

export function esc(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Адрес главной страницы: cafe.siteUrl из menu.json или текущий адрес сайта. */
export function homeUrl(menu) {
  if (menu?.cafe?.siteUrl) return menu.cafe.siteUrl;
  return new URL('./', location.href).href.split('?')[0];
}

/** Рисует QR-код (библиотека qrcode.js, глобальный QRCode). */
export function renderQR(el, text, size = 256) {
  el.innerHTML = '';
  if (typeof QRCode === 'undefined') {
    el.textContent = 'QR недоступен';
    return;
  }
  // eslint-disable-next-line no-undef
  new QRCode(el, { text, width: size, height: size, colorDark: '#0f0d0b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  el.title = text;
}

let toastTimer;
export function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
