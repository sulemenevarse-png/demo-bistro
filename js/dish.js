import { getDish, param, formatPrice, esc, renderQR, toast, prefersReducedMotion } from './common.js';

const mv = document.getElementById('mv');
const $ = (id) => document.getElementById(id);

// ---------- easing ----------
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const setScale = (x, y = x, z = x) => mv.setAttribute('scale', `${x} ${y} ${z}`);
const setYaw = (deg) => mv.setAttribute('orientation', `0deg 0deg ${deg}deg`);

/**
 * Анимация появления через атрибуты model-viewer (scale + orientation) и requestAnimationFrame:
 *   0–1.0 с — блюдо вырастает из 0 в 1 и делает пол-оборота (180° → 0°), слегка вытягиваясь вверх;
 *   1.0–1.8 с — «приземление»: затухающее сплющивание-растяжение (squash & stretch).
 * Точка опоры модели — центр дна (модели нормализованы так), поэтому блюдо растёт со стола.
 */
function playIntro() {
  return new Promise((resolve) => {
    if (prefersReducedMotion()) { setScale(1); setYaw(0); resolve(); return; }
    const GROW = 1000, LAND = 800;
    setScale(0.0001);
    setYaw(180);
    // Время копим с ограничением шага: если первый кадр подвиснет (компиляция шейдеров
    // на телефоне), анимация не «проскочит», а продолжится с того же места.
    let t = 0, prev = null;
    function frame(now) {
      t += prev === null ? 0 : Math.min(now - prev, 1000 / 30);
      prev = now;
      if (t < GROW) {
        const g = t / GROW;
        const s = Math.max(0.0001, easeOutCubic(g));
        const stretch = 1 + 0.18 * Math.sin(Math.PI * g); // в полёте немного вытягивается
        setScale(s / Math.sqrt(stretch), s * stretch, s / Math.sqrt(stretch));
        setYaw(180 * (1 - easeInOutCubic(g)));
      } else if (t < GROW + LAND) {
        const k = (t - GROW) / LAND;
        const squash = 0.14 * Math.sin(Math.PI * 2.2 * k) * Math.exp(-4 * k);
        setScale(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);
        setYaw(0);
      } else {
        setScale(1);
        setYaw(0);
        resolve();
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

/** Камера под размер блюда: цель — центр блюда, дистанция — по габаритам. */
function frameCamera() {
  const { x, y, z } = mv.getDimensions();
  const size = Math.max(x, y, z);
  const flat = y < Math.max(x, z) * 0.25; // пицца, тарелка — смотрим сверху и ближе
  const r = size * (flat ? 2.0 : 2.6);
  mv.cameraTarget = `0m ${(y / 2).toFixed(4)}m 0m`;
  mv.cameraOrbit = `-25deg ${flat ? 55 : 68}deg ${r.toFixed(3)}m`;
  mv.minCameraOrbit = `auto 15deg ${(r * 0.45).toFixed(3)}m`;
  mv.maxCameraOrbit = `auto 95deg ${(r * 2).toFixed(3)}m`;
  mv.jumpCameraToGoal();
  const cm = (v) => Math.round(v * 100);
  $('dish-size').textContent = `${cm(Math.max(x, z))} см`;
  $('size-hint').textContent = `${cm(x)}×${cm(z)}×${cm(y)} см`;
}

async function urlExists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch { return false; }
}

function renderInfo(menu, dish) {
  document.title = `${dish.name} — ${menu.cafe.name}`;
  $('cafe-name').textContent = menu.cafe.name;
  $('dish-name').textContent = dish.name;
  $('dish-price').textContent = formatPrice(dish.price, menu.cafe.currency);
  $('dish-desc').textContent = dish.description;
  $('dish-weight').textContent = dish.weight || '—';
  $('dish-kcal').textContent = dish.calories ? `${dish.calories} ккал` : '—';
  $('dish-ingredients').innerHTML = (dish.ingredients || []).map((i) => `<span class="chip">${esc(i)}</span>`).join('');
  const cookBtn = $('cook-btn');
  if (dish.cook?.length) cookBtn.href = `cook.html?id=${encodeURIComponent(dish.id)}`;
  else cookBtn.classList.add('hidden');
  const c = dish.credit;
  if (c) {
    $('dish-credit').innerHTML = `3D-модель: <a href="${esc(c.url)}" target="_blank" rel="noopener">«${esc(c.title)}»</a> — ${esc(c.author)}, ${esc(c.license)}`;
  }
  $('order-btn').addEventListener('click', () => toast(`«${dish.name}» добавлен в заказ (демо)`));
}

async function init() {
  const id = param('id');
  let menu, dish;
  try {
    ({ menu, dish } = await getDish(id));
  } catch (err) {
    console.error(err);
  }
  if (!dish) {
    $('dish-root').innerHTML = `<div class="error-box">Блюдо не найдено. <a href="./">Вернуться в меню</a></div>`;
    return;
  }
  renderInfo(menu, dish);

  await customElements.whenDefined('model-viewer');
  mv.alt = `3D-модель: ${dish.name}`;
  // poster не задаём: иначе он перекрывает анимацию появления (превью есть на карточке меню).
  // .usdz для iPhone (Quick Look). Если файла нет — model-viewer сгенерирует USDZ сам на лету.
  if (dish.usdz && (await urlExists(dish.usdz))) mv.iosSrc = dish.usdz;

  mv.addEventListener('load', async () => {
    frameCamera();
    setScale(0.0001);
    mv.dismissPoster();
    await playIntro();
    mv.autoRotate = true;
    mv.interactionPrompt = 'auto';
  }, { once: true });

  mv.addEventListener('error', (e) => console.error('model-viewer error', e.detail));
  mv.src = dish.glb;

  // На десктопе AR недоступен — показываем QR на эту страницу, чтобы открыть с телефона.
  mv.addEventListener('load', () => {
    if (!mv.canActivateAR) {
      $('desktop-ar').classList.add('show');
      renderQR($('dish-qr'), location.href, 192);
    }
  }, { once: true });
}

init();
