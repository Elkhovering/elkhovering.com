// Клиентская логика с Astro View Transitions.
//
// i18n-модель:
//   - Единый URL на страницу. EN и RU сосуществуют в HTML.
//   - Текущий язык живёт в localStorage + html[data-lang].
//   - Текстовые узлы с data-i18n подменяются из /i18n/{lang}.json.
//   - Блоки-обёртки с [data-case-lang="en|ru"] скрываются через CSS
//     (html[data-lang="en"] [data-case-lang="ru"] { display: none }).
//   - На astro:before-swap ставим data-lang на входящий документ ДО paint,
//     иначе жёстко прописанный в Layout data-lang="en" перетирает выбор.

import Lenis from '@studio-freight/lenis';
import Rellax from 'rellax';

// ──────────────── i18n ────────────────

let currentLang = localStorage.getItem('lang') || 'en';
let translations = {};

async function setLanguage(lang) {
  if (lang !== 'en' && lang !== 'ru') return;
  const res = await fetch(`/i18n/${lang}.json`);
  translations = await res.json();
  currentLang = lang;
  localStorage.setItem('lang', lang);
  document.documentElement.dataset.lang = lang;
  applyTranslations();
  markActiveLang();
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const path = el.dataset.i18n.split('.');
    let value = translations;
    path.forEach((key) => (value = value?.[key]));
    if (value) el.innerHTML = value;
  });
}

function markActiveLang() {
  document.querySelectorAll('[data-lang]').forEach((btn) => {
    btn.toggleAttribute('data-active', btn.dataset.lang === currentLang);
  });
}

// ──────────────── PERSISTENT (один раз за сессию) ────────────────

let lenisInstance = null;

function persistentInit() {
  if (lenisInstance) return;

  // Lenis Smooth Scroll
  lenisInstance = new Lenis({
    duration: 4.4,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -20 * t)),
    smoothWheel: true,
    smoothTouch: false,
  });
  const raf = (time) => {
    lenisInstance.raf(time);
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);

  // Кастомный курсор — делегирование на весь документ
  const cursor = document.getElementById('customCursor');
  if (cursor) {
    window.addEventListener('mousemove', (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
    });

    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-cursor]');
      if (!el) return;
      const type = el.dataset.cursor;
      if (type === 'see-more') cursor.textContent = translations.ui?.seeMore || 'See more';
      else if (type === 'open') cursor.textContent = translations.ui?.open || 'Open';
      else if (type === 'copy') cursor.textContent = translations.ui?.copy || 'Copy';

      document.body.classList.add('cursor-active');
      cursor.style.opacity = '1';
    });

    document.addEventListener('mouseout', (e) => {
      const el = e.target.closest('[data-cursor]');
      if (!el) return;
      cursor.style.opacity = '0';
      document.body.classList.remove('cursor-active');
    });

    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-cursor="copy"]');
      if (!el) return;
      const textToCopy = el.dataset.copy || el.textContent.trim();
      e.preventDefault();
      navigator.clipboard.writeText(textToCopy).then(() => {
        cursor.textContent = translations.ui?.copied || '✓ Copied';
        setTimeout(() => {
          cursor.textContent = translations.ui?.copy || 'Copy';
        }, 1000);
      });
    });
  }

  // Кнопки языка — один обработчик на весь документ
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lang]');
    if (!btn) return;
    setLanguage(btn.dataset.lang);
  });
}

// ──────────────── PER-PAGE (перезапуск после навигации) ────────────────

const activeStates = new Map();
let skewObserver = null;
let lastScrollY = window.scrollY;
let globalSkew = 0;

function initSkew() {
  if (!skewObserver) {
    window.addEventListener('scroll', () => {
      const newY = window.scrollY;
      const delta = newY - lastScrollY;
      lastScrollY = newY;
      globalSkew = Math.max(Math.min(delta * 0.2, 5), -5);
      activeStates.forEach((state) => (state.targetSkew = globalSkew));
    });

    const animate = () => {
      activeStates.forEach((state) => {
        state.currentSkew += (state.targetSkew - state.currentSkew) * 0.1;
        state.targetSkew *= 0.4;
        state.el.style.transform = `skewY(${state.currentSkew}deg)`;
      });
      requestAnimationFrame(animate);
    };
    animate();

    skewObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target;
          if (entry.isIntersecting) {
            if (!activeStates.has(el)) {
              activeStates.set(el, { el, currentSkew: 0, targetSkew: 0 });
            }
          } else {
            activeStates.delete(el);
            el.style.transform = '';
          }
        });
      },
      { root: null, rootMargin: '0px 0px 50% 0px' }
    );
  }

  activeStates.clear();
  document.querySelectorAll('.section').forEach((s) => skewObserver.observe(s));
}

function initWorkHovers() {
  const hoverBackground = document.querySelector('.hover-background');
  const spline = document.querySelector('.spline-wrapper');
  const overlay = document.getElementById('projectOverlay');
  const titleEl = document.getElementById('projectTitle');
  const descEl = document.getElementById('projectDesc');
  const dateEl = document.getElementById('projectDate');
  const images = document.querySelectorAll('.work-image');

  images.forEach((img) => {
    img.addEventListener('mouseenter', () => {
      if (hoverBackground) {
        hoverBackground.style.backgroundImage = `url(${img.src})`;
        hoverBackground.style.opacity = '1';
      }
      images.forEach((o) => { if (o !== img) o.classList.add('faded'); });
      spline?.classList.add('faded-spline');

      const data = translations.projects?.[img.dataset.id];
      if (data && overlay) {
        titleEl.textContent = data.title;
        descEl.textContent = data.desc;
        dateEl.textContent = data.date;
        overlay.style.opacity = '1';
      }
    });

    img.addEventListener('mouseleave', () => {
      if (hoverBackground) hoverBackground.style.opacity = '0';
      images.forEach((o) => o.classList.remove('faded'));
      spline?.classList.remove('faded-spline');
      if (overlay) overlay.style.opacity = '0';
    });
  });
}

function initRellax() {
  document.querySelectorAll('.rellax').forEach((el) => {
    new Rellax(el, {
      speed: parseFloat(el.dataset.rellaxSpeed) || -2,
      center: true,
      round: true,
    });
  });
}

function updateSplineVisibility() {
  const spline = document.querySelector('.spline-wrapper');
  if (!spline) return;
  const isHome = window.location.pathname === '/' || window.location.pathname === '';
  spline.style.visibility = isHome ? '' : 'hidden';
  spline.style.pointerEvents = isHome ? '' : 'none';
}

function pageInit() {
  updateSplineVisibility();
  const isHome = window.location.pathname === '/' || window.location.pathname === '';
  if (isHome) {
    initSkew();
    initWorkHovers();
    initRellax();
  }
}

// ──────────────── Жизненный цикл Astro View Transitions ────────────────

// КРИТИЧНО: выставляем data-lang на новый документ ДО того, как он попадёт в DOM.
// Иначе жёсткий <html data-lang="en"> из Layout на долю секунды покажет EN-блок.
document.addEventListener('astro:before-swap', (e) => {
  e.newDocument.documentElement.dataset.lang = currentLang;
});

// Первая загрузка и любая навигация через ClientRouter
document.addEventListener('astro:page-load', async () => {
  persistentInit();
  if (!translations.ui) {
    // Первый paint — подгружаем словарь.
    await setLanguage(currentLang);
  } else {
    // Повторная навигация — просто переприменяем текущий язык к новому DOM.
    document.documentElement.dataset.lang = currentLang;
    applyTranslations();
    markActiveLang();
  }
  pageInit();
});
