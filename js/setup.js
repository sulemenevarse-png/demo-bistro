import { loadMenu, homeUrl, renderQR, wifiQRString, personalUrl, copyText, toast } from './common.js';

const $ = (id) => document.getElementById(id);
const form = $('setup-form');
const STORE = 'db-setup';
let base = null; // демо-данные из menu.json
let menuHome = '';

const initials = (name) =>
  (name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || 'DB').toUpperCase();

function readForm() {
  const fd = new FormData(form);
  return {
    name: (fd.get('name') || '').trim(),
    tagline: (fd.get('tagline') || '').trim(),
    table: (fd.get('table') || '').trim(),
    ssid: (fd.get('ssid') || '').trim(),
    password: fd.get('password') || '',
    security: fd.get('security') || 'WPA',
    showPass: $('f-showpass').checked,
  };
}

function fillForm(cfg) {
  $('f-name').value = cfg.name || '';
  $('f-tagline').value = cfg.tagline || '';
  $('f-table').value = cfg.table || '';
  $('f-ssid').value = cfg.ssid || '';
  $('f-pass').value = cfg.password || '';
  form.querySelector(`input[name="security"][value="${cfg.security || 'WPA'}"]`).checked = true;
  $('f-showpass').checked = cfg.showPass !== false;
}

function defaults() {
  const c = base.cafe;
  return {
    name: c.name, tagline: c.tagline, table: c.table || '',
    ssid: c.wifi?.ssid || '', password: c.wifi?.password || '', security: c.wifi?.security || 'WPA', showPass: true,
  };
}

/** Ссылка на меню: в неё попадают только поля, отличные от демо-данных — чтобы QR был проще. */
function menuLink(cfg) {
  const d = defaults();
  const diff = {};
  if (cfg.name && cfg.name !== d.name) diff.name = cfg.name;
  if (cfg.tagline && cfg.tagline !== d.tagline) diff.tagline = cfg.tagline;
  if (cfg.table) diff.table = cfg.table;
  if (cfg.ssid !== d.ssid || cfg.password !== d.password || cfg.security !== d.security) {
    diff.ssid = cfg.ssid;
    if (cfg.security !== 'nopass') diff.password = cfg.password;
    diff.security = cfg.security;
  }
  return Object.keys(diff).length ? personalUrl(menuHome, diff) : menuHome;
}

function validate(cfg) {
  let err = '';
  if (cfg.security === 'WPA' && cfg.password && cfg.password.length < 8) err = 'У WPA пароль минимум 8 символов';
  if (cfg.security !== 'nopass' && !cfg.password) err = 'Введите пароль или выберите «Без пароля»';
  $('pass-error').textContent = err;
  return !err;
}

let qrTimer;
function render() {
  const cfg = readForm();
  const nopass = cfg.security === 'nopass';
  $('pass-field').classList.toggle('hidden', nopass);
  validate(cfg);

  $('t-name').textContent = cfg.name || 'Ваше заведение';
  $('t-tagline').textContent = cfg.tagline;
  $('t-tagline').classList.toggle('hidden', !cfg.tagline);
  $('t-mark').textContent = initials(cfg.name || 'DB');
  $('t-table').textContent = cfg.table ? `Стол № ${cfg.table}` : '';
  $('t-table').classList.toggle('hidden', !cfg.table);
  $('t-ssid').textContent = cfg.ssid || '—';
  $('t-pass').textContent = cfg.password;
  $('t-pass-row').classList.toggle('hidden', nopass || !cfg.showPass);

  const link = menuLink(cfg);
  $('open-menu').href = link;

  // QR перерисовываем с небольшой задержкой, чтобы не дёргать на каждую букву
  clearTimeout(qrTimer);
  qrTimer = setTimeout(() => {
    renderQR($('t-wifi-qr'), wifiQRString(cfg), 480);
    renderQR($('t-menu-qr'), link, 480);
  }, 120);

  try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch { /* без памяти */ }
}

async function init() {
  // на странице настройки берём чистые демо-данные, без параметров гостевой ссылки
  try { sessionStorage.removeItem('db-overrides'); } catch { /* ignore */ }
  base = await loadMenu();
  menuHome = homeUrl(base);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { /* ignore */ }
  fillForm(saved || defaults());
  render();

  form.addEventListener('input', render);
  form.addEventListener('submit', (e) => e.preventDefault());

  $('pass-eye').addEventListener('click', () => {
    const inp = $('f-pass');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    $('pass-eye').setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    $('pass-eye').classList.toggle('on', show);
  });

  $('print-btn').addEventListener('click', () => {
    const cfg = readForm();
    if (!cfg.ssid) { toast('Укажите название Wi-Fi сети'); $('f-ssid').focus(); return; }
    if (!validate(cfg)) { $('f-pass').focus(); return; }
    window.print();
  });

  $('copy-link').addEventListener('click', async () => {
    const ok = await copyText(menuLink(readForm()));
    toast(ok ? 'Ссылка на меню скопирована' : 'Не удалось скопировать');
  });

  $('reset-btn').addEventListener('click', () => {
    try { localStorage.removeItem(STORE); } catch { /* ignore */ }
    fillForm(defaults());
    render();
    toast('Вернули демо-данные');
  });
}

init().catch((err) => {
  console.error(err);
  form.insertAdjacentHTML('afterbegin', '<div class="error-box">Не удалось загрузить данные. Откройте сайт через веб-сервер.</div>');
});
