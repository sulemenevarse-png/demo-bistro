import { loadMenu, formatPrice, esc, homeUrl, renderQR, copyText, toast, readOverrides } from './common.js';

const list = document.getElementById('menu-list');

function card(dish, currency) {
  const tag = dish.tags?.[0] ? `<span class="tag">${esc(dish.tags[0])}</span>` : '';
  return `
    <article class="card">
      <a class="card-media" href="dish.html?id=${encodeURIComponent(dish.id)}" aria-label="${esc(dish.name)} в 3D">
        <img src="${esc(dish.poster)}" alt="${esc(dish.name)}" loading="lazy" width="256" height="256">
        <span class="badge-3d">3D · AR</span>
      </a>
      <div class="card-body">
        <h3>${esc(dish.name)}</h3>
        <p>${esc(dish.description)}</p>
        <div class="card-foot">
          <span class="price">${formatPrice(dish.price, currency)}</span>
          <a class="btn btn-primary" href="dish.html?id=${encodeURIComponent(dish.id)}">Посмотреть в 3D</a>
        </div>
      </div>
      ${tag}
    </article>`;
}

function credits(dishes) {
  return dishes
    .filter((d) => d.credit)
    .map(({ credit: c, name }) => `<li>${esc(name)}: <a href="${esc(c.url)}" target="_blank" rel="noopener">«${esc(c.title)}»</a>, автор ${esc(c.author)}, лицензия <a href="${esc(c.licenseUrl)}" target="_blank" rel="noopener">${esc(c.license)}</a></li>`)
    .join('');
}

async function init() {
  try {
    const menu = await loadMenu();
    document.getElementById('cafe-name').textContent = menu.cafe.name;
    document.getElementById('cafe-tagline').textContent = menu.cafe.tagline;
    document.title = `${menu.cafe.name} — AR-меню`;
    document.getElementById('brand-mark').textContent =
      menu.cafe.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'DB';
    // Гость конкретного ресторана (пришёл по QR с таблички) — блок «для ресторана» ему не нужен
    const o = readOverrides();
    if (o.n || o.w) document.getElementById('owner-block').remove();
    list.innerHTML = menu.dishes.map((d) => card(d, menu.cafe.currency)).join('');
    document.getElementById('credits').innerHTML = credits(menu.dishes);

    renderWifi(menu.cafe);

    if (document.getElementById('owner-block')) {
      const url = homeUrl(menu);
      document.getElementById('qr-url').textContent = url;
      // qrcode.js подключён с defer — к моменту выполнения модуля он уже загружен.
      renderQR(document.getElementById('qr'), url, 224);
    }
  } catch (err) {
    console.error(err);
    list.innerHTML = `<div class="error-box">Не удалось загрузить меню. Откройте сайт через веб-сервер, а не как файл.</div>`;
  }
}

function renderWifi(cafe) {
  const w = cafe.wifi;
  if (!w?.ssid) return;
  const $ = (id) => document.getElementById(id);
  $('wifi-ssid').textContent = w.ssid;
  $('wifi-table').textContent = cafe.table ? ` · стол ${cafe.table}` : '';
  const btn = $('wifi-copy');
  if (w.password && w.security !== 'nopass') {
    $('wifi-pass').textContent = w.password;
    btn.addEventListener('click', async () => {
      const ok = await copyText(w.password);
      toast(ok ? 'Пароль скопирован — вставьте его в настройках Wi-Fi' : 'Не удалось скопировать');
      if (ok) { btn.textContent = 'Готово ✓'; setTimeout(() => { btn.textContent = 'Скопировать'; }, 2000); }
    });
  } else {
    $('wifi-pass-row').textContent = 'Без пароля';
    btn.remove();
  }
  $('wifi-card').classList.remove('hidden');
}

init();
