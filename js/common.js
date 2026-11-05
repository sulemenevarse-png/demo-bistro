// Общие утилиты для всех страниц.

let menuPromise;

/** Загружает data/menu.json (один раз за страницу). */
export function loadMenu() {
  menuPromise ??= fetch(new URL('../data/menu.json', import.meta.url))
    .then((r) => {
      if (!r.ok) throw new Error(`menu.json: HTTP ${r.status}`);
      return r.json();
    });
  return menuPromise;
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
  return new URL('./', location.href).href;
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
