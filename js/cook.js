// «Как готовят»: блюдо собирается из примитивов three.js — слои падают сверху и складываются в стопку.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { getDish, param, toast, prefersReducedMotion } from './common.js';

const STEP = 0.4;          // интервал между слоями, с
const FALL = 0.9;          // длительность падения одного слоя, с
const DROP = 1.8;          // с какой высоты падают слои
const SPIN_SPEED = 0.35;   // рад/с — вращение готового блюда

// ---------------------------------------------------------------- easing
const clamp01 = (v) => Math.min(1, Math.max(0, v));
function easeOutBounce(x) {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}
const FIRST_CONTACT = 1 / 2.75; // момент первого касания в easeOutBounce

// ---------------------------------------------------------------- helpers
const rand = mulberry32(7);
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o });

function mesh(geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speckles(ctx, s, base, colors, n, rMax) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.globalAlpha = 0.25 + rand() * 0.5;
    ctx.beginPath(); ctx.arc(rand() * s, rand() * s, 1 + rand() * rMax, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Тело вращения из профиля [[r, y], ...] с «неровным» краем. */
function lathe(profile, segments = 64, wobble = 0) {
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  if (wobble) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + wobble * (Math.sin(a * 5) * 0.6 + Math.sin(a * 11 + 1.3) * 0.4);
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    geo.computeVertexNormals();
  }
  return geo;
}

/** Вершинный цвет по высоте: снизу colorA, сверху colorB. */
function gradientY(geo, colorA, colorB) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const p = geo.attributes.position, colors = [];
  const a = new THREE.Color(colorA), b = new THREE.Color(colorB), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.copy(a).lerp(b, (p.getY(i) - min.y) / (max.y - min.y || 1));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/** Мелкие объекты, разбросанные по кругу без сильных пересечений. */
function scatter(count, radius, minDist) {
  const pts = [];
  for (let tries = 0; pts.length < count && tries < count * 200; tries++) {
    const r = Math.sqrt(rand()) * radius, a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (pts.every((q) => Math.hypot(q.x - x, q.z - z) > minDist)) pts.push({ x, z });
  }
  return pts;
}

// ---------------------------------------------------------------- layers
// Каждый строитель возвращает { obj, h, r, y? }: obj стоит низом в y=0,
// h — на сколько слой поднимает стопку, r — радиус (для подписи), y — явная высота (для жидкостей в чашке).
const BUN = '#d9934a', BUN_LIGHT = '#f0c27d', CRUMB = '#f6dcaa';

const builders = {
  bunBottom() {
    const g = new THREE.Group();
    const geo = gradientY(lathe([[0, 0], [0.5, 0], [0.56, 0.05], [0.57, 0.11], [0.54, 0.16], [0.5, 0.17], [0, 0.17]]), BUN, BUN_LIGHT);
    g.add(mesh(geo, mat('#ffffff', { vertexColors: true, roughness: 0.75 })));
    const crumb = mesh(new THREE.CircleGeometry(0.5, 48), mat(CRUMB, { roughness: 0.95 }));
    crumb.rotation.x = -Math.PI / 2; crumb.position.y = 0.171;
    g.add(crumb);
    return { obj: g, h: 0.17, r: 0.57 };
  },

  patty() {
    const tex = canvasTexture(256, (ctx, s) => speckles(ctx, s, '#5d3521', ['#3b1f12', '#7a4a2c', '#2a140a', '#8c5a35'], 900, 3));
    const geo = lathe([[0, 0], [0.55, 0], [0.6, 0.03], [0.61, 0.09], [0.59, 0.14], [0.54, 0.165], [0, 0.165]], 72, 0.025);
    const g = new THREE.Group();
    g.add(mesh(geo, mat('#ffffff', { map: tex, roughness: 0.9 })));
    // следы гриля
    for (let i = -2; i <= 2; i++) {
      const line = mesh(new THREE.BoxGeometry(0.035, 0.004, 1.0 - Math.abs(i) * 0.18), mat('#2a140a', { roughness: 1 }));
      line.position.set(i * 0.2, 0.166, 0); line.rotation.y = 0.5;
      g.add(line);
    }
    return { obj: g, h: 0.165, r: 0.61 };
  },

  cheese() {
    const geo = new THREE.BoxGeometry(1.12, 0.03, 1.12, 28, 1, 28);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z);
      if (d > 0.52) p.setY(i, p.getY(i) - (d - 0.52) ** 2 * 1.4); // углы свисают
    }
    geo.computeVertexNormals();
    const m = mesh(geo, mat('#f5b417', { roughness: 0.45 }));
    m.rotation.y = Math.PI / 4;
    m.position.y = 0.015;
    const g = new THREE.Group(); g.add(m);
    return { obj: g, h: 0.03, r: 0.75 };
  },

  lettuce() {
    const geo = new THREE.RingGeometry(0.001, 0.68, 120, 10);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z), a = Math.atan2(z, x);
      const k = 1 + 0.07 * Math.sin(a * 13) * (r / 0.68);
      p.setX(i, x * k); p.setZ(i, z * k);
      p.setY(i, 0.03 + 0.045 * Math.sin(a * 9 + r * 6) * (r / 0.68) ** 2 - 0.02 * (r / 0.68) ** 3);
    }
    geo.computeVertexNormals();
    const g = new THREE.Group();
    g.add(mesh(geo, mat('#72c04a', { roughness: 0.55, side: THREE.DoubleSide })));
    return { obj: g, h: 0.05, r: 0.72 };
  },

  tomato() {
    const face = canvasTexture(256, (ctx, s) => {
      const c = s / 2;
      ctx.fillStyle = '#d93a26'; ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#f0614a'; ctx.beginPath(); ctx.arc(c, c, s * 0.42, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 4; i++) { // камеры с семечками
        const a = (i / 4) * Math.PI * 2 + 0.4;
        ctx.fillStyle = '#ff8a6a';
        ctx.beginPath(); ctx.ellipse(c + Math.cos(a) * s * 0.22, c + Math.sin(a) * s * 0.22, s * 0.13, s * 0.08, a, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffe29a';
        for (let j = 0; j < 5; j++) { ctx.beginPath(); ctx.arc(c + Math.cos(a) * s * (0.17 + j * 0.025), c + Math.sin(a) * s * (0.17 + j * 0.025), 3, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.fillStyle = '#f7a08a'; ctx.beginPath(); ctx.arc(c, c, s * 0.06, 0, Math.PI * 2); ctx.fill();
    });
    const side = mat('#c92f1d', { roughness: 0.35 });
    const top = mat('#ffffff', { map: face, roughness: 0.3 });
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 40), [side, top, top]);
      const a = (i / 3) * Math.PI * 2 + 0.3;
      s.position.set(Math.cos(a) * 0.27, 0.025 + i * 0.006, Math.sin(a) * 0.27);
      s.rotation.y = rand() * Math.PI;
      g.add(s);
    }
    return { obj: g, h: 0.06, r: 0.55 };
  },

  bunTop() {
    const R = 0.58, SY = 0.62;
    const dome = new THREE.SphereGeometry(R, 64, 28, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, SY, 1);
    gradientY(dome, BUN_LIGHT, '#c27630');
    const g = new THREE.Group();
    g.add(mesh(dome, mat('#ffffff', { vertexColors: true, roughness: 0.55 })));
    const base = mesh(new THREE.CircleGeometry(R, 64), mat(CRUMB, { roughness: 0.95 }));
    base.rotation.x = Math.PI / 2;
    g.add(base);
    // кунжут
    const seeds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat('#fbefd2', { roughness: 0.6 }), 70);
    seeds.castShadow = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), twist = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const n = new THREE.Vector3(), pos = new THREE.Vector3(), scl = new THREE.Vector3(0.026, 0.009, 0.012);
    for (let i = 0; i < seeds.count; i++) {
      const phi = Math.acos(1 - rand() * 0.55), th = rand() * Math.PI * 2;
      pos.set(Math.sin(phi) * Math.cos(th) * R, Math.cos(phi) * R * SY, Math.sin(phi) * Math.sin(th) * R);
      n.set(pos.x / (R * R), pos.y / (R * SY * R * SY), pos.z / (R * R)).normalize();
      q.setFromUnitVectors(up, n).multiply(twist.setFromAxisAngle(up, rand() * Math.PI));
      seeds.setMatrixAt(i, m4.compose(pos, q, scl));
    }
    g.add(seeds);
    return { obj: g, h: R * SY, r: R };
  },

  // ---------- пицца
  dough() {
    const geo = gradientY(lathe([[0, 0], [0.92, 0], [0.99, 0.03], [1.0, 0.07], [0.96, 0.1], [0.9, 0.09], [0.86, 0.045], [0, 0.04]], 96, 0.008), '#e9be7c', '#c98640');
    const g = new THREE.Group();
    g.add(mesh(geo, mat('#ffffff', { vertexColors: true, roughness: 0.85 })));
    return { obj: g, h: 0.04, r: 1.0 };
  },
  sauce() {
    const g = new THREE.Group();
    g.add(mesh(lathe([[0, 0], [0.86, 0], [0.87, 0.006], [0.85, 0.012], [0, 0.012]], 96, 0.012), mat('#b52a16', { roughness: 0.35 })));
    return { obj: g, h: 0.012, r: 0.87 };
  },
  mozzarella() {
    const tex = canvasTexture(256, (ctx, s) => speckles(ctx, s, '#f8e2a0', ['#f2c96a', '#fff3cf', '#e8b04e'], 500, 6));
    const g = new THREE.Group();
    g.add(mesh(lathe([[0, 0], [0.8, 0], [0.82, 0.01], [0.79, 0.022], [0, 0.024]], 96, 0.04), mat('#ffffff', { map: tex, roughness: 0.45 })));
    return { obj: g, h: 0.022, r: 0.82 };
  },
  pepperoni() {
    const g = new THREE.Group();
    const side = mat('#8f1f14', { roughness: 0.5 });
    const top = mat('#b8321f', { roughness: 0.4 });
    for (const { x, z } of scatter(15, 0.66, 0.25)) {
      const s = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.016, 28), [side, top, top]);
      s.position.set(x, 0.008, z);
      s.rotation.set((rand() - 0.5) * 0.08, 0, (rand() - 0.5) * 0.08);
      g.add(s);
    }
    return { obj: g, h: 0.016, r: 0.78 };
  },
  basil() {
    const g = new THREE.Group();
    const leaf = mat('#2f8f3c', { roughness: 0.5 });
    for (const { x, z } of scatter(9, 0.62, 0.25)) {
      const l = mesh(new THREE.SphereGeometry(1, 16, 8), leaf);
      l.scale.set(0.09, 0.01, 0.045);
      l.position.set(x, 0.01, z);
      l.rotation.y = rand() * Math.PI;
      g.add(l);
    }
    const oregano = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.004, 0.012), mat('#3d5a2a'), 160);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < oregano.count; i++) {
      const r = Math.sqrt(rand()) * 0.78, a = rand() * Math.PI * 2;
      oregano.setMatrixAt(i, m4.makeRotationY(rand() * 3).setPosition(Math.cos(a) * r, 0.004, Math.sin(a) * r));
    }
    g.add(oregano);
    return { obj: g, h: 0.01, r: 0.7 };
  },

  // ---------- капучино (жидкости «наливаются» внутрь чашки)
  saucer(_, state) {
    const g = new THREE.Group();
    g.add(mesh(lathe([[0, 0], [0.42, 0], [0.45, 0.02], [0.4, 0.04], [0.62, 0.06], [0.82, 0.1], [0.85, 0.12], [0.83, 0.13], [0.6, 0.09], [0.38, 0.07], [0, 0.07]], 96), mat('#f3efe7', { roughness: 0.22 })));
    state.noPlate = true;
    return { obj: g, h: 0.07, r: 0.85 };
  },
  cup(_, state) {
    const ceramic = mat('#f6f3ec', { roughness: 0.2, side: THREE.DoubleSide });
    const g = new THREE.Group();
    g.add(mesh(lathe([[0, 0], [0.26, 0], [0.29, 0.02], [0.3, 0.06], [0.48, 0.62], [0.5, 0.66], [0.47, 0.665], [0.455, 0.63], [0.285, 0.08], [0, 0.08]], 72), ceramic));
    const handle = mesh(new THREE.TorusGeometry(0.15, 0.035, 14, 32, Math.PI * 1.25), ceramic);
    handle.position.set(0.46, 0.36, 0);
    handle.rotation.z = -Math.PI * 0.62;
    g.add(handle);
    state.cupBase = state.top;
    state.cupInner = (y) => 0.285 + ((y - 0.08) / (0.63 - 0.08)) * (0.455 - 0.285); // внутренний радиус на высоте y
    return { obj: g, h: 0.665, r: 0.62 };
  },
  espresso: (_, s) => liquid(s, 0.08, 0.3, '#3a1c0e', 0.25),
  milk: (_, s) => liquid(s, 0.3, 0.52, '#c9925e', 0.4),
  foam(_, s) {
    const art = canvasTexture(256, (ctx, sz) => {
      const c = sz / 2;
      const grd = ctx.createRadialGradient(c, c, sz * 0.1, c, c, sz * 0.5);
      grd.addColorStop(0, '#f6ead7'); grd.addColorStop(0.75, '#ead2b0'); grd.addColorStop(1, '#a8703f');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, sz, sz);
      ctx.fillStyle = '#fbf3e6'; // латте-арт «сердце»
      ctx.beginPath();
      ctx.moveTo(c, c + sz * 0.22);
      ctx.bezierCurveTo(c - sz * 0.38, c - sz * 0.02, c - sz * 0.16, c - sz * 0.3, c, c - sz * 0.1);
      ctx.bezierCurveTo(c + sz * 0.16, c - sz * 0.3, c + sz * 0.38, c - sz * 0.02, c, c + sz * 0.22);
      ctx.fill();
    });
    return liquid(s, 0.52, 0.6, '#efe0c8', 0.8, art);
  },
  cocoa(_, s) {
    const y = s.cupBase + 0.601, r = s.cupInner(0.6) * 0.92;
    const specks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.014, 0.003, 0.014), mat('#5a3016', { roughness: 1 }), 220);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < specks.count; i++) {
      const rr = Math.sqrt(rand()) * r, a = rand() * Math.PI * 2;
      specks.setMatrixAt(i, m4.makeRotationY(rand() * 3).setPosition(Math.cos(a) * rr, 0.0015, Math.sin(a) * rr));
    }
    const g = new THREE.Group(); g.add(specks);
    return { obj: g, h: 0, y, r };
  },

  // ---------- универсальный слой для новых блюд: { "type": "disc", "color": "#...", "radius": 0.5, "height": 0.1 }
  disc(layer) {
    const r = layer.radius ?? 0.55, h = layer.height ?? 0.08;
    const g = new THREE.Group();
    g.add(mesh(lathe([[0, 0], [r * 0.96, 0], [r, h * 0.3], [r, h * 0.7], [r * 0.96, h], [0, h]], 64, layer.wobble ?? 0.01), mat(layer.color || '#c98b4f', { roughness: layer.roughness ?? 0.7 })));
    return { obj: g, h, r };
  },
};

/** Жидкость внутри чашки: усечённый конус от y0 до y1 (в координатах чашки). */
function liquid(state, y0, y1, color, roughness, topMap) {
  const r0 = state.cupInner(y0) - 0.004, r1 = state.cupInner(y1) - 0.004;
  const side = mat(color, { roughness });
  const top = topMap ? mat('#ffffff', { map: topMap, roughness }) : side;
  const m = mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, 64), [side, top, side]);
  m.position.y = (y1 - y0) / 2;
  const g = new THREE.Group(); g.add(m);
  return { obj: g, h: 0, y: state.cupBase + y0, r: r1 };
}

// ---------------------------------------------------------------- scene
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color('#14100d');
scene.background = BG;
scene.fog = new THREE.Fog(BG, 8, 20); // пересчитывается в fitCamera()
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.maxPolarAngle = Math.PI * 0.47;

// мягкий свет: небо/пол + тёплый ключевой с мягкой тенью + холодный контровой
scene.add(new THREE.HemisphereLight('#fff1dc', '#3a2a1e', 0.9));
const key = new THREE.DirectionalLight('#ffe2bf', 2.4);
key.position.set(2.2, 5, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -2.2;
key.shadow.camera.right = key.shadow.camera.top = 2.2;
key.shadow.camera.near = 1; key.shadow.camera.far = 14;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.shadow.radius = 5;
scene.add(key);
const rim = new THREE.DirectionalLight('#9fc4ff', 0.6);
rim.position.set(-3, 2.5, -2.5);
scene.add(rim);

// стол
const table = new THREE.Mesh(new THREE.CircleGeometry(60, 64), mat('#2b2119', { roughness: 0.85 }));
table.rotation.x = -Math.PI / 2;
table.receiveShadow = true;
scene.add(table);

function makePlate(radius, kind) {
  if (kind === 'board') {
    const wood = canvasTexture(512, (ctx, s) => {
      ctx.fillStyle = '#8a5a34'; ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 90; i++) {
        ctx.strokeStyle = rand() > 0.5 ? 'rgba(60,35,18,0.25)' : 'rgba(190,140,90,0.18)';
        ctx.lineWidth = 1 + rand() * 3;
        const y = rand() * s;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(s * 0.3, y + rand() * 12 - 6, s * 0.7, y + rand() * 12 - 6, s, y); ctx.stroke();
      }
    });
    const board = mesh(new THREE.CylinderGeometry(radius, radius, 0.06, 96), mat('#ffffff', { map: wood, roughness: 0.75 }));
    board.position.y = 0.03;
    const g = new THREE.Group(); g.add(board);
    return { obj: g, top: 0.06 };
  }
  const R = radius;
  const geo = lathe([[0, 0], [R * 0.62, 0], [R * 0.66, 0.015], [R * 0.7, 0.035], [R * 0.93, 0.08], [R, 0.1], [R * 0.985, 0.112], [R * 0.92, 0.095], [R * 0.7, 0.05], [0, 0.045]], 96);
  return { obj: mesh(geo, mat('#f4f0e8', { roughness: 0.3 })), top: 0.045 };
}

// ---------------------------------------------------------------- labels (HTML поверх canvas)
const labelsEl = document.getElementById('labels');
const linesSvg = document.getElementById('label-lines');
const SVG_NS = 'http://www.w3.org/2000/svg';

function createLabel(text, index, total) {
  const el = document.createElement('div');
  el.className = 'label';
  el.innerHTML = `<small>Шаг ${index + 1}/${total}</small>`;
  el.append(text);
  labelsEl.appendChild(el);
  const line = document.createElementNS(SVG_NS, 'line');
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('r', '3');
  linesSvg.append(line, dot);
  line.style.opacity = dot.style.opacity = '0';
  return { el, line, dot };
}

// ---------------------------------------------------------------- app state
const dishGroup = new THREE.Group();
scene.add(dishGroup);
let layers = [];        // { obj, y, h, r, label, side, start, landed }
let clockStart = null;  // время старта анимации (с)
let phase = 'idle';     // idle | dropping | done
let doneAt = 0;
const ui = {
  start: document.getElementById('start-btn'),
  replay: document.getElementById('replay-btn'),
  order: document.getElementById('order-btn'),
  caption: document.getElementById('caption'),
};

function build(dish) {
  const state = { top: 0, noPlate: false };
  const types = dish.cook.map((l) => l.type);
  const plateKind = types.includes('dough') ? 'board' : 'plate';

  // сначала строим слои (часть строителей меняет state, например блюдце отключает тарелку)
  const built = dish.cook.map((layer) => {
    const make = builders[layer.type] || builders.disc;
    const res = make(layer, state);
    const y = res.y ?? state.top;
    if (res.y === undefined) state.top += res.h;
    return { ...res, y, label: layer.label };
  });

  const maxR = Math.max(...built.map((b) => b.r));
  let base = 0;
  if (!state.noPlate) {
    const plate = makePlate(maxR * (plateKind === 'board' ? 1.12 : 1.4), plateKind);
    scene.add(plate.obj);
    base = plate.top;
  }

  layers = built.map((b, i) => {
    b.obj.position.y = base + b.y;
    b.obj.visible = false;
    dishGroup.add(b.obj);
    return { ...b, y: base + b.y, side: i % 2 ? 1 : -1, ui: createLabel(b.label, i, built.length) };
  });

  // кадрирование камеры по готовому блюду (с тарелкой)
  const H = base + Math.max(...layers.map((l) => l.y + l.h), state.top);
  fit.dish = 2 * maxR;
  fit.width = 2 * (state.noPlate ? maxR : maxR * (plateKind === 'board' ? 1.12 : 1.4));
  fit.height = H;
  controls.target.set(0, H * 0.4, 0);
  camera.position.set(0, 0.55, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5); // направление взгляда
  fitCamera();
}

function reset() {
  for (const l of layers) {
    l.obj.visible = false;
    l.landed = false;
    l.ui.el.classList.remove('on');
    l.ui.line.style.opacity = l.ui.dot.style.opacity = '0';
  }
  dishGroup.rotation.y = 0;
  ui.caption.innerHTML = '';
}

function play() {
  reset();
  phase = 'dropping';
  clockStart = performance.now() / 1000;
  ui.start.classList.add('hidden');
  ui.replay.classList.add('hidden');
  ui.order.classList.add('hidden');
  if (prefersReducedMotion()) clockStart -= layers.length * STEP + FALL; // сразу итог
}

function setCaption(i) {
  ui.caption.innerHTML = `<span class="step">Шаг ${i + 1} из ${layers.length}</span>${escapeText(layers[i].label)}`;
}
const escapeText = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function updateLayers(now) {
  const t = now - clockStart;
  let allDone = true;
  layers.forEach((l, i) => {
    const local = t - i * STEP;
    if (local < 0) { allDone = false; return; }
    const p = clamp01(local / FALL);
    l.obj.visible = true;
    l.obj.position.y = l.y + DROP * (1 - easeOutBounce(p));
    l.obj.rotation.y = (1 - p) * 0.9 * l.side;
    if (!l.landed && p >= FIRST_CONTACT) {
      l.landed = true;
      l.ui.el.classList.add('on');
      l.ui.line.style.opacity = l.ui.dot.style.opacity = '1';
      setCaption(i);
    }
    if (p < 1) allDone = false;
  });
  if (allDone) {
    phase = 'done';
    doneAt = now;
    ui.caption.innerHTML = '<span class="step">Готово</span>Приятного аппетита!';
    ui.order.classList.remove('hidden'); ui.order.classList.add('pop');
    ui.replay.classList.remove('hidden'); ui.replay.classList.add('pop');
  }
}

// позиции подписей: точка на краю слоя → выноска к колонке слева/справа
const tmpV = new THREE.Vector3(), right = new THREE.Vector3();
function updateLabels() {
  const w = innerWidth, h = innerHeight;
  right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
  const items = [];
  layers.forEach((l, i) => {
    if (!l.landed) return;
    const side = sideOf(i);
    tmpV.copy(right).multiplyScalar(side * l.r * 0.92);
    tmpV.y = l.obj.position.y + Math.max(l.h, 0.02) * 0.5;
    tmpV.project(camera);
    items.push({ l, i, side, px: (tmpV.x * 0.5 + 0.5) * w, py: (-tmpV.y * 0.5 + 0.5) * h });
  });
  const margin = 12, gap = 48;
  for (const side of [-1, 1]) {
    const col = items.filter((it) => it.side === side).sort((a, b) => (portrait ? b.i - a.i : a.py - b.py)); // в колонке — по порядку шагов
    // разводим подписи по вертикали, чтобы не налезали
    let prev = -Infinity;
    for (const it of col) { it.ly = Math.max(it.py, prev + gap); prev = it.ly; }
    // центрируем колонку по блюду, чтобы она не «уезжала» вниз
    if (col.length > 1) {
      const shift = col.reduce((a, it) => a + it.py - it.ly, 0) / col.length;
      for (const it of col) it.ly += shift;
    }
    for (const it of col) {
      const { el, line, dot } = it.l.ui;
      const lw = el.offsetWidth, lh = el.offsetHeight;
      const lx = side < 0 ? margin : w - margin - lw;
      el.style.transform = `translate(${lx}px, ${it.ly - lh / 2}px)`;
      const ex = side < 0 ? lx + lw : lx;
      line.setAttribute('x1', ex); line.setAttribute('y1', it.ly);
      line.setAttribute('x2', it.px); line.setAttribute('y2', it.py);
      dot.setAttribute('cx', it.px); dot.setAttribute('cy', it.py);
    }
  }
}

const fit = { width: 2, dish: 1.5, height: 1 };
let portrait = false; // узкий экран: блюдо слева, все подписи колонкой справа
const sideOf = (i) => (portrait ? 1 : i % 2 ? 1 : -1);
/** Отодвигает камеру так, чтобы блюдо заняло ~60% ширины экрана (по бокам — место для подписей). */
function fitCamera() {
  const aspect = innerWidth / innerHeight;
  const vf = THREE.MathUtils.degToRad(camera.fov);
  const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
  const wantW = portrait ? fit.dish / 0.46 : fit.width / 0.45;
  const wantH = Math.max(fit.height, fit.width * 0.5) * 1.8;
  const dist = Math.max(wantW / 2 / Math.tan(hf / 2), wantH / 2 / Math.tan(vf / 2));
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, dist);
  controls.minDistance = dist * 0.35;
  controls.maxDistance = dist * 1.8;
  scene.fog.near = dist * 1.3;
  scene.fog.far = dist * 3.2;
  controls.update();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // на узком экране отодвигаем камеру, чтобы блюдо и подписи поместились
  portrait = w < h * 0.85;
  camera.fov = portrait ? 40 : 35;
  // сдвигаем картинку чуть вверх (снизу — подпись шага и кнопки), а на узком экране ещё и влево
  camera.setViewOffset(w, h, portrait ? w * 0.18 : 0, h * 0.06, w, h);
  camera.updateProjectionMatrix();
  if (layers.length) fitCamera();
}
addEventListener('resize', resize);
resize();

let last = performance.now() / 1000;
renderer.setAnimationLoop(() => {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  if (phase === 'dropping') updateLayers(now);
  if (phase === 'done') dishGroup.rotation.y += dt * SPIN_SPEED * Math.min(1, (now - doneAt) / 1.5);
  controls.update();
  renderer.render(scene, camera);
  updateLabels();
});

// ---------------------------------------------------------------- init
async function init() {
  const id = param('id') || 'burger';
  let dish = null;
  try { ({ dish } = await getDish(id)); } catch (err) { console.error(err); }
  if (!dish?.cook?.length) {
    ui.caption.textContent = 'Для этого блюда пока нет анимации.';
    ui.start.classList.add('hidden');
    return;
  }
  document.title = `Как готовят: ${dish.name} — Demo Bistro`;
  document.getElementById('cook-title').textContent = dish.name;
  document.getElementById('cook-sub').textContent = `Как готовят · ${dish.cook.length} шагов`;
  document.getElementById('back-btn').href = `dish.html?id=${encodeURIComponent(dish.id)}`;
  build(dish);
  ui.caption.innerHTML = '<span class="step">Готовы?</span>Нажмите «Собрать»';
  ui.start.addEventListener('click', play);
  ui.replay.addEventListener('click', play);
  ui.order.addEventListener('click', () => toast(`«${dish.name}» добавлен в заказ (демо)`));
  if (param('autoplay') !== null) play();
}
init();
