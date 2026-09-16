// Нативная 3D-сцена лося на three.js — замена Spline.
//
// Ни одно число ниже не подобрано на глаз. Всё снято с живой сцены Spline,
// которая стояла на сайте до переезда:
//   - иерархия, трансформы и камера — из данных сцены в рантайме;
//   - материал — из скомпилированного фрагментного шейдера Spline;
//   - парение, поворот за курсором и оборот от скролла — замерами траекторий
//     по кадрам, потому что поля данных Spline оказались обманчивыми
//     (например, "crop [0, 2]" у анимации — это не секунды, играется весь клип).
// Меняя число, вы меняете то, как сайт выглядел раньше. Делайте это осознанно.

import {
  AnimationMixer,
  ClampToEdgeWrapping,
  ColorManagement,
  Group,
  LinearSRGBColorSpace,
  LoopRepeat,
  MathUtils,
  NoColorSpace,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import modelUrl from '../assets/elk/elk.glb?url';
import modelMeta from '../assets/elk/elk.meta.json';
// Matcap-ы встроены в модуль, а не отдельными файлами. Отдельный файл браузер
// грузит как картинку с низким приоритетом, и на медленной сети эти 11 КБ стояли
// в очереди за обложками главной: на Slow 4G сцена ждала их 16 секунд.
import matcapBodySrc from '../assets/elk/matcap-body.webp?inline';
import matcapDarkSrc from '../assets/elk/matcap-dark.webp?inline';

// ─────────────────────────── Сцена ───────────────────────────

const CAMERA = {
  fov: 74.3, // Spline хранит вертикальный fov и отдельно zoom, как three.js
  zoom: 2,
  near: 70,
  far: 100000,
  position: [380.08, 0, 0],
  rotationY: Math.PI / 2, // смотрит вдоль −X, на модель
};

// Камера держит вертикальный угол обзора, поэтому в узком портретном кадре
// широкая модель режется по бокам — на телефоне уходили морда и копыта.
// Уже этого соотношения сторон камера отдаляется пропорционально. Десктоп
// шире квадрата, там zoom остаётся ровно 2 и кадр совпадает со Spline.
// (Spline на телефоне сравнивать не с чем: в той же мобильной эмуляции он
// загружал сцену, но лося на экране не было.)
const FULL_FRAME_ASPECT = 1;

// Scene > Group (курсор) > bounce (парение) > rotate (скролл) > модель
const GROUP_POSITION = [0.1997, -13.49, 19.6603];
const BOUNCE_POSITION = [0, 0, -39.3206];
const ROTATE_POSITION = [-0.2, 5.49, 19.66];
const MODEL = {
  position: [0, -105.6682, 0],
  rotationY: Math.PI,
  scale: [273.75, 270.76, 270.76], // неравномерный масштаб — как в оригинале, не опечатка
};

// ─────────────────────────── Движение ───────────────────────────

// Spline `easing: 4`. Сверено с замерами и парения, и скролла: в четырёх точках
// кривой расхождение не больше 0.001.
const easeInOut = cubicBezier(0.42, 0, 0.58, 1);

// Парение: pingpong от y=0 до y=20, полпериода 5 с, старт снизу вверх.
const BOUNCE = { amplitude: 20, halfCycleMs: 5000 };

// Полный оборот вокруг Y за первые 10 000 px прокрутки страницы, дальше — упор.
// В Spline поворот был квантован на 100 шагов, то есть на крутом участке кривой
// прыгал по ~6° каждые 100 px. Здесь он непрерывный — это сознательное улучшение.
const SCROLL_TURN_PX = 10000;

// Поворот за курсором. Это честный look-at, не произвольный множитель:
//   угол = смещение + atan(GAIN · положение курсора · tan(½ угла обзора)),
// и коэффициент совпал по обеим осям (0.1886 и 0.1884) — поэтому модель
// правильно ведёт себя на экранах с другим соотношением сторон.
// Плавность экспоненциальная: остаток пути падает в 0.38 раза за 200 мс.
const LOOK = {
  gain: 0.1885,
  yawOffset: 0.0103, // группа стоит не на оси камеры, отсюда ненулевой центр
  rollOffset: 0.0071,
  rate: 4.8, // 1/с
};

// ─────────────────────────── Материал ───────────────────────────

// Слои материала Spline, сведённые к формуле по его шейдеру:
//   тело       — белая основа → полусферический свет, смешанный на 60 % → overlay с matcap;
//   рога/копыта — чёрная основа → свет на чёрном даёт ноль → screen с matcap = сам matcap.
// Свет — один HemisphereLight #d3d3d3 / земля #828282, интенсивность 0.75,
// в старых единицах three.js (physicallyCorrectLights: false). Числа ниже —
// уже итоговая освещённость, без зависимости от единиц текущей версии.
const HEMI = {
  sky: 0xd3 / 255 * 0.75,
  ground: 0x82 / 255 * 0.75,
};
const LIGHT_MIX = 0.6;
const BLEND = { screen: 2, overlay: 3 };

const MATERIALS = {
  body: { base: [1, 1, 1], matcap: 'body', blend: BLEND.overlay, cover: 'matcap' },
  legs: { base: [0, 0, 0], matcap: 'dark', blend: BLEND.screen, cover: 'backdrop' },
  horns: { base: [0, 0, 0], matcap: 'dark', blend: BLEND.screen, cover: 'backdrop' },
};

// ─────────────────────────── Обложка проекта ───────────────────────────

// При наведении на работу на главной лось принимает её обложку: страница шлёт
// `elk:cover { image }`.
//
// Тело: обложка работает как matcap — цвет грани берётся из картинки по направлению
// нормали — и лежит под светом и matcap тела вместо белой основы. Нормали у модели
// плоские, поэтому грань получает цвет целиком: растяжек нет, тело читается
// гранёным камнем в цветах проекта. Выбрано вживую из пяти вариантов: проекция
// обложки из камеры (растягивалась на гранях, повёрнутых ребром), matcap по плоским
// и по сглаженным нормалям — каждый чистым и под светом тела.
//
// Рога и копыта: чёрные на цветном фоне выбивались, поэтому к ним подмешивается цвет
// размытого фона страницы ровно за ними — фон и есть та же обложка.
const COVER = {
  // Как у размытого фона страницы (.hover-background в global.css): лось и фон
  // проявляются вместе.
  durationMs: 750,
  // Исходники бывают по 5000 px и 10 МБ, а грани хватает одного участка картинки.
  textureWidth: 1024,
  // Доля цвета фона в рогах и копытах. Выбрана из 0.35 / 0.55 по снимкам на трёх обложках.
  backdropTint: 0.55,
};
const easeCss = cubicBezier(0.25, 0.1, 0.25, 1); // CSS `ease`

// Обложка лежит под светом и matcap, как белая основа. Полусферический свет только
// затемняет (множитель от 0.63 до 0.77), и краски тускнели; поэтому он нормирован
// на свою среднюю величину — ту, что у грани, повёрнутой к небу и к земле поровну.
const LIGHT_AVERAGE = 1 - LIGHT_MIX + LIGHT_MIX * (HEMI.sky + HEMI.ground) / 2;

const VERTEX = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>

  varying vec3 vViewPosition;
  varying vec3 vNormal;

  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    vNormal = normalize( transformedNormal );

    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    vViewPosition = - mvPosition.xyz;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMatcap;
  uniform vec3 uBase;
  uniform vec3 uSky;
  uniform vec3 uGround;
  uniform vec3 uHemiDir;
  uniform float uLightMix;
  uniform int uBlend;

  varying vec3 vViewPosition;
  varying vec3 vNormal;

  #ifdef USE_COVER
    uniform sampler2D uCoverA;
    uniform sampler2D uCoverB;
    uniform float uCoverMix;    // 0 — обложка из слота A, 1 — из слота B
    uniform float uCoverAmount; // 0 — без обложки, 1 — обложка целиком
    uniform vec2 uCoverFitA;    // развёртка matcap квадратная — берётся центральный квадрат
    uniform vec2 uCoverFitB;
    uniform vec4 uBackdropA;    // css px канваса → uv обложки на размытом фоне: xy · px + zw
    uniform vec4 uBackdropB;
    uniform vec2 uBackdropLod;  // уровень мипмапа, равный размытию фона, для слотов A и B
    uniform float uBackdropTint;
    uniform vec2 uCanvas;       // высота буфера канваса в px и pixel ratio
  #endif

  vec3 overlay( vec3 color, vec3 m ) {
    return clamp( mix( 1.0 - 2.0 * ( 1.0 - color ) * ( 1.0 - m ), 2.0 * color * m, step( color, vec3( 0.5 ) ) ), 0.0, 1.0 );
  }

  // Слой света и matcap поверх основы.
  vec3 shade( vec3 base, vec3 normal, vec3 m ) {
    // Условие повторяет Spline буквально: на чёрной основе освещение совпадает
    // с основой, и смешивание пропускается.
    vec3 color = base;
    vec3 lit = mix( uGround, uSky, 0.5 * dot( normal, uHemiDir ) + 0.5 ) * base;
    if ( lit != base ) color = mix( base, lit, uLightMix );

    if ( uBlend == ${BLEND.screen} ) return 1.0 - ( 1.0 - color ) * ( 1.0 - m );
    return overlay( color, m );
  }

  void main() {
    vec3 normal = normalize( vNormal );

    // Spline разворачивает нормали, смотрящие от камеры, по экранным производным.
    vec3 faceNormal = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
    if ( dot( normal, faceNormal ) < 0.0 ) normal = - normal;

    // Matcap — та же развёртка, что в Spline, включая множитель 0.495.
    vec3 viewDir = normalize( vViewPosition );
    vec3 axisX = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
    vec3 axisY = cross( viewDir, axisX );
    vec2 uv = vec2( dot( axisX, normal ), dot( axisY, normal ) ) * 0.495 + 0.5;
    vec3 m = texture2D( uMatcap, uv ).rgb;

    vec3 color = shade( uBase, normal, m );

    #ifdef USE_COVER
      if ( uCoverAmount > 0.0 ) {
        #ifdef COVER_MATCAP
          // Обложка как matcap: та же развёртка по нормали. v перевёрнут — у текстуры
          // обложки v = 0 на верхнем крае. Уровень мипмапа задан явно: на рёбрах граней
          // развёртка рвётся, и автоматический выбор давал бы там размытые швы.
          vec2 q = vec2( dot( axisX, normal ), - dot( axisY, normal ) ) * 0.495;
          vec3 image = mix(
            textureLod( uCoverA, 0.5 + q * uCoverFitA, 0.0 ).rgb,
            textureLod( uCoverB, 0.5 + q * uCoverFitB, 0.0 ).rgb,
            uCoverMix
          );
          // Вместо белой основы — под тем же светом и matcap; см. LIGHT_AVERAGE.
          vec3 hemi = mix( uGround, uSky, 0.5 * dot( normal, uHemiDir ) + 0.5 );
          vec3 lit = clamp( image * mix( vec3( 1.0 ), hemi, uLightMix ) / ${LIGHT_AVERAGE.toFixed(4)}, 0.0, 1.0 );
          color = mix( color, overlay( lit, m ), uCoverAmount );
        #else
          // Цвет размытого фона страницы в этой же точке экрана.
          vec2 css = vec2( gl_FragCoord.x, uCanvas.x - gl_FragCoord.y ) / uCanvas.y;
          vec3 backdrop = mix(
            textureLod( uCoverA, css * uBackdropA.xy + uBackdropA.zw, uBackdropLod.x ).rgb,
            textureLod( uCoverB, css * uBackdropB.xy + uBackdropB.zw, uBackdropLod.y ).rgb,
            uCoverMix
          );
          color = mix( color, backdrop, uBackdropTint * uCoverAmount );
        #endif
      }
    #endif

    // Без конвертации цветового пространства: Spline выводил значения как есть
    // (linearToOutputTexel = LinearToLinear), и matcap-ы рассчитаны на это.
    gl_FragColor = vec4( color, 1.0 );
  }
`;

// ─────────────────────────── Монтирование ───────────────────────────

/**
 * Поднимает сцену в `stage` (элемент с <canvas class="elk-canvas">).
 * Сообщает о себе событиями на window, чтобы прелоадер не зависел от этого модуля:
 *   elk:engine                 — three.js загружен, WebGL поднят
 *   elk:progress { fraction }  — доля скачанных байтов модели, 0..1
 *   elk:ready    { head }      — первый кадр уже на экране; head() → [x, y] головы лося
 *                                в px вьюпорта. Если сцену не прикрывает прелоадер,
 *                                канвас дальше проявляется своим CSS-переходом.
 *   elk:lost / elk:restored    — WebGL-контекст потерян / вернулся; это обратимо
 *   elk:error    { reason }    — сцены не будет, страница должна жить без неё
 */
export function mountElk(stage) {
  const canvas = stage.querySelector('.elk-canvas');
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(`elk:${name}`, { detail }));
  const setState = (state) => { stage.dataset.state = state; };
  setState('loading');

  // Весь конвейер «значения как есть», как у Spline.
  ColorManagement.enabled = false;

  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (error) {
    setState('error');
    emit('error', { reason: 'webgl-unavailable' });
    return { setActive() {} };
  }
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  // Spline рендерил с pixelRatio 1, поэтому на ретине был мыльным. Здесь чётче,
  // но с потолком 2 — дальше GPU платит, а глаз разницы не видит.
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio());
  emit('engine');

  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  camera.zoom = CAMERA.zoom;
  camera.position.set(...CAMERA.position);
  camera.rotation.set(0, CAMERA.rotationY, 0);
  camera.updateMatrixWorld();

  const group = new Group();
  group.position.set(...GROUP_POSITION);
  const bounce = new Group();
  bounce.position.set(...BOUNCE_POSITION);
  const rotate = new Group();
  rotate.position.set(...ROTATE_POSITION);
  const model = new Group();
  model.position.set(...MODEL.position);
  model.rotation.y = MODEL.rotationY;
  model.scale.set(...MODEL.scale);
  scene.add(group);
  group.add(bounce);
  bounce.add(rotate);
  rotate.add(model);

  // Отладочный доступ для сверки с замерами Spline. В проде import.meta.env.DEV
  // заменяется на false, и Rollup вырезает ветку целиком.
  if (import.meta.env.DEV) {
    window.__elk = {
      scene, camera, group, bounce, rotate, model,
      get renderer() { return renderer; },
      get clock() { return clock; },
      get running() { return raf !== 0; },
      get lastDt() { return lastDt; },
      get cover() { return { amount: coverAmount, mix: coverMix, front: coverFront, slots: coverSlots, uniforms: coverUniforms }; },
    };
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

  let mixer = null;
  let headBone = null;

  // Общие для тела, рогов и копыт: одно присваивание меняет все три материала.
  const coverUniforms = {
    uCoverA: { value: null },
    uCoverB: { value: null },
    uCoverMix: { value: 0 },
    uCoverAmount: { value: 0 },
    uCoverFitA: { value: new Vector2(1, 1) },
    uCoverFitB: { value: new Vector2(1, 1) },
    uBackdropA: { value: new Vector4() },
    uBackdropB: { value: new Vector4() },
    uBackdropLod: { value: new Vector2() },
    uBackdropTint: { value: COVER.backdropTint },
    uCanvas: { value: new Vector2(1, 1) },
  };
  // Два разных факта, и путать их нельзя: `loaded` — модель и материалы собраны, это
  // переживает потерю WebGL-контекста; `ready` — можно рисовать прямо сейчас.
  let loaded = false;
  let loading = false;
  let ready = false;
  let active = false;
  let raf = 0;
  let lastFrame = 0;
  let clock = 0; // секунды активного времени — на паузе не идёт, парение не прыгает
  let lastDt = 0;
  let yaw = 0;
  let roll = 0;
  let pointer = null; // NDC курсора или null, если курсора над окном нет

  // ── ресайз: камера берёт соотношение сторон у самого канваса ──
  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    // Зум страницы или переезд окна на другой монитор меняют devicePixelRatio.
    if (renderer.getPixelRatio() !== pixelRatio()) renderer.setPixelRatio(pixelRatio());
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.zoom = CAMERA.zoom * Math.min(1, camera.aspect / FULL_FRAME_ASPECT);
    camera.updateProjectionMatrix();
    coverUniforms.uCanvas.value.set(canvas.height, renderer.getPixelRatio());
    fitBackdrop(0);
    fitBackdrop(1);
    // setSize очищает буфер, а ResizeObserver срабатывает уже после кадра цикла —
    // без немедленной перерисовки браузер покажет пустой канвас, лось мигнёт.
    // dt = 0: часы, анимация и сглаживание курсора не сдвигаются.
    if (ready && active && !document.hidden) renderFrame(0);
  };
  new ResizeObserver(resize).observe(canvas);
  // Смена DPR без смены CSS-размера (окно перетащили на другой экран) ресайз
  // не вызывает. Слушатель на текущее разрешение перевзводится после каждой смены.
  const watchPixelRatio = () => {
    window
      .matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      .addEventListener('change', () => { resize(); watchPixelRatio(); }, { once: true });
  };
  watchPixelRatio();

  // ── курсор ──
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    pointer = [
      (event.clientX / window.innerWidth) * 2 - 1,
      -((event.clientY / window.innerHeight) * 2 - 1),
    ];
  }, { passive: true });
  // Курсор ушёл за пределы окна — лось возвращается в покой, как в Spline.
  document.addEventListener('mouseout', (event) => { if (!event.relatedTarget) pointer = null; });
  window.addEventListener('blur', () => { pointer = null; });

  // ── скролл: на экономном пути рисуем только по событию ──
  window.addEventListener('scroll', () => {
    if (ready && active && !isAnimating()) renderFrame(0);
  }, { passive: true });

  const isAnimating = () => !reducedMotion.matches;

  function update(dt) {
    if (isAnimating()) {
      clock += dt;
      mixer?.update(dt);

      const phase = ((clock * 1000) / BOUNCE.halfCycleMs) % 2;
      bounce.position.y = BOUNCE.amplitude * easeInOut(phase < 1 ? phase : 2 - phase);

      const tanV = Math.tan(MathUtils.degToRad(CAMERA.fov / 2)) / camera.zoom;
      const tanH = tanV * camera.aspect;
      const tracking = pointer && finePointer.matches;
      const targetYaw = tracking ? LOOK.yawOffset + Math.atan(LOOK.gain * pointer[0] * tanH) : 0;
      const targetRoll = tracking ? LOOK.rollOffset + Math.atan(LOOK.gain * pointer[1] * tanV) : 0;
      const k = 1 - Math.exp(-LOOK.rate * dt);
      yaw += (targetYaw - yaw) * k;
      roll += (targetRoll - roll) * k;
      group.rotation.set(0, yaw, roll);
    }

    const progress = MathUtils.clamp(window.scrollY / SCROLL_TURN_PX, 0, 1);
    rotate.rotation.y = -Math.PI * 2 * easeInOut(progress);

    const now = performance.now();
    coverUniforms.uCoverAmount.value = tweenValue(coverAmount, now);
    coverUniforms.uCoverMix.value = tweenValue(coverMix, now);
  }

  function renderFrame(dt) {
    update(dt);
    renderer.render(scene, camera);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    // Потолок шага: после сворачивания вкладки анимация не должна «догонять» секунды.
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
    lastFrame = now;
    lastDt = dt;
    renderFrame(dt);
  }

  function start() {
    if (raf || !ready || !active || document.hidden) return;
    if (!isAnimating()) {
      renderFrame(0); // один кадр — остальное по скроллу и ресайзу
      return;
    }
    lastFrame = 0;
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  reducedMotion.addEventListener('change', () => { stop(); start(); });

  // ── потеря и возврат WebGL-контекста ──
  // Это обратимо, и отдельным событием, а не elk:error: iOS Safari отбирает контекст
  // у фоновых страниц при переключении приложений. three.js сам вызывает preventDefault
  // и при возврате пересоздаёт GL-состояние; ресурсы догружаются в видеопамять лениво,
  // на первом же кадре. Раньше здесь ставилось 'error', и лось пропадал до перезагрузки.
  canvas.addEventListener('webglcontextlost', () => {
    stop();
    ready = false;
    setState('lost');
    emit('lost');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (!loaded) return; // потерян посреди загрузки — загрузка сама закончит
    becomeReady();
    emit('restored');
  });

  function becomeReady() {
    ready = true;
    resize();
    // Прогреваем шейдеры сразу, а не на первом видимом кадре.
    renderer.compile(scene, camera);
    renderFrame(0);
    setState('ready');
    // «Готово» — только когда кадр уже на экране, иначе прелоадер откроет пустой канвас.
    requestAnimationFrame(() => emit('ready', { head: headScreenPosition }));
    start();
  }

  // Где на экране голова лося — оттуда прелоадер раскрывает страницу.
  const headWorld = new Vector3();
  function headScreenPosition() {
    if (!headBone) return null;
    headBone.getWorldPosition(headWorld).project(camera);
    const rect = canvas.getBoundingClientRect();
    return [
      rect.left + ((headWorld.x + 1) / 2) * rect.width,
      rect.top + ((1 - headWorld.y) / 2) * rect.height,
    ];
  }

  // ── обложка проекта ──
  // Два слота, чтобы при переходе с одной работы на другую обложки перетекали друг
  // в друга, а не мигали белым. Обе величины — твины с кривой и длительностью фона
  // страницы; при смене цели твин продолжается с текущего значения.
  const coverAmount = { from: 0, to: 0, start: 0, duration: 0 };
  const coverMix = { from: 0, to: 0, start: 0, duration: 0 };
  const coverSlots = [{ key: null, texture: null }, { key: null, texture: null }];
  let coverFront = 0;
  let coverRequest = 0;
  const coverTextures = new Map();

  function tweenValue(tween, now) {
    if (!tween.duration) return tween.to;
    const t = Math.min(1, (now - tween.start) / tween.duration);
    return tween.from + (tween.to - tween.from) * easeCss(t);
  }

  function retarget(tween, to, now) {
    const current = tweenValue(tween, now);
    tween.from = current;
    tween.to = to;
    tween.start = now;
    // Как у CSS-перехода, прерванного на полпути: обратный путь короче прямого.
    tween.duration = isAnimating() ? COVER.durationMs * Math.abs(to - current) : 0;
  }

  // Без цикла анимации (reduced motion) кадр сам не нарисуется.
  function redrawCover() {
    if (!raf && ready && active && !document.hidden) renderFrame(0);
  }

  function coverTexture(image) {
    const key = image.currentSrc || image.src;
    let texture = coverTextures.get(key);
    if (!texture) {
      texture = createCoverTexture(image);
      coverTextures.set(key, texture);
      texture.catch(() => coverTextures.delete(key)); // неудача не должна застрять в кеше
    }
    return texture;
  }

  async function createCoverTexture(image) {
    if (!image.complete || !image.naturalWidth) await image.decode();
    const limit = Math.min(COVER.textureWidth, renderer.capabilities.maxTextureSize);
    const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    // Сжатие и декодирование — вне главного потока, иначе первое наведение на 10-мегабайтную
    // обложку подвешивало бы страницу. Где createImageBitmap не умеет уменьшать, — через canvas.
    let source = null;
    try {
      source = await createImageBitmap(image, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    } catch {
      source = null;
    }
    if (!source || source.width > width * 1.5) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(source ?? image, 0, 0, width, height);
      source?.close?.();
      source = canvas;
    }

    const texture = new Texture(source);
    // UNPACK_FLIP_Y к ImageBitmap не применяется, поэтому не переворачиваем ни один
    // источник, а верх картинки учитываем в развёртках (v = 0 — её верхний край).
    texture.flipY = false;
    texture.colorSpace = NoColorSpace;
    texture.needsUpdate = true;
    renderer.initTexture(texture); // в видеопамять сейчас, а не посреди проявления
    return texture;
  }

  function assignCover(slot, key, texture) {
    coverSlots[slot].key = key;
    coverSlots[slot].texture = texture;
    coverUniforms[slot ? 'uCoverB' : 'uCoverA'].value = texture;
    const aspect = texture.image.width / texture.image.height;
    coverUniforms[slot ? 'uCoverFitB' : 'uCoverFitA'].value.set(aspect > 1 ? 1 / aspect : 1, aspect > 1 ? 1 : aspect);
    fitBackdrop(slot);
  }

  // Где на размытом фоне страницы оказывается каждая точка канваса. Фон — та же обложка
  // с background-size: cover по центру, поэтому связь линейная; размытие CSS
  // переводится в уровень мипмапа: у гауссианы σ ширина равного ей ящика — σ·√12.
  function fitBackdrop(slot) {
    const texture = coverSlots[slot].texture;
    if (!texture) return;
    const element = document.querySelector('.hover-background');
    const box = element?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const aspect = texture.image.width / texture.image.height;
    const height = Math.max(box.width / aspect, box.height);
    const width = height * aspect;
    const left = box.left + (box.width - width) / 2;
    const top = box.top + (box.height - height) / 2;
    const rect = canvas.getBoundingClientRect();
    coverUniforms[slot ? 'uBackdropB' : 'uBackdropA'].value.set(1 / width, 1 / height, (rect.left - left) / width, (rect.top - top) / height);

    const blur = Number(/blur\(([\d.]+)px\)/.exec(element ? getComputedStyle(element).filter : '')?.[1] ?? 0);
    const texelCss = width / texture.image.width;
    coverUniforms.uBackdropLod.value.setComponent(slot, Math.max(0, Math.log2((blur * Math.sqrt(12)) / texelCss)));
  }

  function showCover(key, texture) {
    const now = performance.now();
    const visible = tweenValue(coverAmount, now) > 0.001;

    if (visible && coverSlots[coverFront].key === key) {
      // Вернулись на ту же работу, пока обложка ещё не погасла.
      retarget(coverAmount, 1, now);
      return;
    }

    if (!visible) {
      assignCover(coverFront, key, texture);
      Object.assign(coverMix, { from: coverFront, to: coverFront, start: now, duration: 0 });
    } else {
      // Новую обложку — в менее заметный сейчас слот: так подмена почти не видна,
      // даже если посетитель пронёсся по трём работам подряд.
      const slot = tweenValue(coverMix, now) < 0.5 ? 1 : 0;
      coverFront = slot;
      assignCover(slot, key, texture);
      retarget(coverMix, slot, now);
    }
    retarget(coverAmount, 1, now);
  }

  function resetCover() {
    coverRequest++;
    Object.assign(coverAmount, { from: 0, to: 0, duration: 0 });
    // И сам uniform: цикл остановлен, и без этого до первого кадра он хранил бы старое.
    coverUniforms.uCoverAmount.value = 0;
  }

  window.addEventListener('elk:cover', (event) => {
    const image = event.detail?.image ?? null;
    const request = ++coverRequest;
    if (!loaded || !ready || !active) return;

    if (!image) {
      retarget(coverAmount, 0, performance.now());
      redrawCover();
      return;
    }
    // На тач-экранах «наведение» — это тап, за которым сразу переход на кейс.
    if (!finePointer.matches) return;

    coverTexture(image)
      .then((texture) => {
        // Пока текстура готовилась, курсор мог уйти или перейти на другую работу.
        if (request !== coverRequest || !ready || !active) return;
        showCover(image.currentSrc || image.src, texture);
        redrawCover();
      })
      .catch((error) => console.warn('[elk] cover texture failed', error));
  });

  // ── загрузка ──
  const textureLoader = new TextureLoader();
  const loadMatcap = (src) => textureLoader.loadAsync(src).then((texture) => {
    texture.colorSpace = NoColorSpace; // значения как есть — см. фрагментный шейдер
    texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
    return texture;
  });

  const hemiDir = new Vector3(0, 1, 0).transformDirection(camera.matrixWorldInverse);
  const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

  function load() {
    if (loaded || loading) return;
    loading = true;
    setState('loading');

    Promise.all([
      gltfLoader.loadAsync(modelUrl, (event) => {
        // Знаменатель — размер из манифеста, а не event.total. С gzip сервер не отдаёт
        // Content-Length, и доля не вычислима; а если заголовок есть, он про сжатые
        // байты, тогда как FileLoader считает распакованные — доля убежала бы за 1.
        emit('progress', { fraction: Math.min(1, event.loaded / modelMeta.bytes) });
      }),
      loadMatcap(matcapBodySrc),
      loadMatcap(matcapDarkSrc),
    ])
      .then(([gltf, matcapBody, matcapDark]) => {
        const matcaps = { body: matcapBody, dark: matcapDark };
        const shaded = new Map();

        gltf.scene.traverse((object) => {
          if (!object.isMesh) return;
          const spec = MATERIALS[object.material.name];
          if (!spec) throw new Error(`unknown material "${object.material.name}" in elk.glb`);
          if (!shaded.has(spec)) {
            shaded.set(spec, new ShaderMaterial({
              vertexShader: VERTEX,
              fragmentShader: FRAGMENT,
              defines: spec.cover === 'matcap' ? { USE_COVER: '', COVER_MATCAP: '' } : { USE_COVER: '' },
              uniforms: {
                uMatcap: { value: matcaps[spec.matcap] },
                uBase: { value: new Vector3(...spec.base) },
                uSky: { value: new Vector3(HEMI.sky, HEMI.sky, HEMI.sky) },
                uGround: { value: new Vector3(HEMI.ground, HEMI.ground, HEMI.ground) },
                uHemiDir: { value: hemiDir },
                uLightMix: { value: LIGHT_MIX },
                uBlend: { value: spec.blend },
                ...coverUniforms,
              },
            }));
          }
          object.material.dispose();
          object.material = shaded.get(spec);
          // Ограничивающий объём скиннированного меша считается по позе привязки;
          // анимация уводит вершины за его пределы, и меш пропадал бы на краях кадра.
          object.frustumCulled = false;
        });
        model.clear(); // повторная попытка после сбоя не должна добавить второго лося
        model.add(gltf.scene);
        headBone = gltf.scene.getObjectByName('head') ?? null;

        mixer = new AnimationMixer(gltf.scene);
        const clip = gltf.animations.find((a) => a.name === 'Action.001') ?? gltf.animations[0];
        mixer.clipAction(clip).setLoop(LoopRepeat, Infinity).play();
        // play() только ставит клип в очередь — кости пишет update(). Без этого при
        // reduced motion лось застывал в позе привязки, которой нет ни в одном кадре
        // анимации (бедро расходится с ней до 69°). dt = 0 время не двигает.
        mixer.update(0);

        loaded = true;
        loading = false;
        emit('progress', { fraction: 1 });
        // Контекст потерян, пока шла загрузка: доделает обработчик webglcontextrestored.
        if (renderer.getContext().isContextLost()) return;
        becomeReady();
      })
      .catch((error) => {
        loading = false;
        console.error('[elk] scene failed to load', error);
        setState('error');
        emit('error', { reason: 'load-failed' });
      });
  }

  load();

  return {
    setActive(next) {
      active = next;
      // Сбой загрузки — не приговор на всю сессию: при следующем заходе на главную пробуем снова.
      if (active && !loaded) load();
      if (active) start();
      else {
        stop();
        // Ушли на кейс кликом по работе — mouseleave не случится. Лось вернётся белым.
        resetCover();
      }
    },
  };
}

// cubic-bezier с тем же решателем, что у браузера: Ньютон, при неудаче — бисекция.
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;

  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-6) return sampleY(t);
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 32; i++) {
      const value = sampleX(t);
      if (Math.abs(value - x) < 1e-6) break;
      if (value < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}
