/* Искажение секций */

const sections = document.querySelectorAll(".section");
let lastScrollY = window.scrollY;
let globalSkew = 0;

const activeStates = new Map(); // Активные блоки и их состояния

// Обрабатываем только видимые элементы
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      const el = entry.target;

      if (entry.isIntersecting) {
        if (!activeStates.has(el)) {
          activeStates.set(el, {
            el: el,
            currentSkew: 0,
            targetSkew: 0,
          });
        }
      } else {
        activeStates.delete(el);
        el.style.transform = ""; // сбрасываем искажение
      }
    });
  },
  {
    root: null,
    rootMargin: "0px 0px 50% 0px",
  }
);

// Наблюдаем за всеми section
sections.forEach((section) => observer.observe(section));

// Скролл → меняем targetSkew
window.addEventListener("scroll", () => {
  const newY = window.scrollY;
  const delta = newY - lastScrollY;
  lastScrollY = newY;

  globalSkew = Math.max(Math.min(delta * 0.2, 5), -5);

  activeStates.forEach((state) => {
    state.targetSkew = globalSkew;
  });
});

// Анимация только активных секций
function animate() {
  activeStates.forEach((state) => {
    state.currentSkew += (state.targetSkew - state.currentSkew) * 0.1;
    state.targetSkew *= 0.4;

    state.el.style.transform = `skewY(${state.currentSkew}deg)`;
  });

  requestAnimationFrame(animate);
}

animate();

/* Секция с работами */

// Смена фона по ховеру

const hoverBackground = document.querySelector(".hover-background");
const workImages = document.querySelectorAll(".work-image");

workImages.forEach((img) => {
  img.addEventListener("mouseenter", () => {
    hoverBackground.style.backgroundImage = `url(${img.src})`;
    hoverBackground.style.opacity = "1";
  });

  img.addEventListener("mouseleave", () => {
    hoverBackground.style.opacity = "0";
  });
});

// Полупрозрачность работ, кроме наведенной

const spline = document.querySelector(".spline-wrapper");

workImages.forEach((img) => {
  img.addEventListener("mouseenter", () => {
    workImages.forEach((other) => {
      if (other !== img) {
        other.classList.add("faded");
      }
    });
    spline.classList.add("faded-spline");
  });

  img.addEventListener("mouseleave", () => {
    workImages.forEach((other) => {
      other.classList.remove("faded");
    });
    spline.classList.remove("faded-spline");
  });
});

// Показ текста при наведении

const overlay = document.getElementById("projectOverlay");
const title = document.getElementById("projectTitle");
const desc = document.getElementById("projectDesc");
const date = document.getElementById("projectDate");

document.querySelectorAll(".work-image").forEach((img) => {
  img.addEventListener("mouseenter", () => {
    title.textContent = img.dataset.title;
    desc.textContent = img.dataset.desc;
    date.textContent = img.dataset.date;
    overlay.style.opacity = "1";
  });

  img.addEventListener("mouseleave", () => {
    overlay.style.opacity = "0";
  });
});

/* Скролл */

// Lenis Smooth Scroll

const lenis = new Lenis({
  duration: 4.4,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -20 * t)), // easeOutExpo
  smoothWheel: true,
  smoothTouch: false,
});

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}

requestAnimationFrame(raf);

// Навигация nav

fetch("/nav.html")
  .then((res) => res.text())
  .then((html) => {
    document.querySelector(".nav-placeholder").innerHTML = html;
  });

/* Курсор */

const cursor = document.getElementById("customCursor");

window.addEventListener("mousemove", (e) => {
  cursor.style.left = `${e.clientX}px`;
  cursor.style.top = `${e.clientY}px`;
});

// Делегируем события на весь документ
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest("[data-cursor]");
  if (!el) return;

  const type = el.dataset.cursor;
  if (type === "see-more") cursor.textContent = translations.ui?.seeMore || "See more";
  else if (type === "open") cursor.textContent = translations.ui?.open || "Open";
  else if (type === "copy") cursor.textContent = translations.ui?.copy || "Copy";

  document.body.classList.add("cursor-active");
  cursor.style.opacity = "1";
});

document.addEventListener("mouseout", (e) => {
  const el = e.target.closest("[data-cursor]");
  if (!el) return;

  cursor.style.opacity = "0";
  document.body.classList.remove("cursor-active");
});

// Обработка клика для data-cursor="copy"
document.addEventListener("click", (e) => {
  const el = e.target.closest('[data-cursor="copy"]');
  if (!el) return;

  const textToCopy = el.dataset.copy;
  if (textToCopy) {
    e.preventDefault();
    navigator.clipboard.writeText(textToCopy).then(() => {
      cursor.textContent = translations.ui?.copied || "✓ Copied";
      setTimeout(() => {
        cursor.textContent = translations.ui?.copy || "Copy";
      }, 1000);
    });
  }
});

// Перевод сайта

let currentLang = "en";
let translations = {};

function loadLanguage(lang) {
  fetch(`${lang}.json`)
    .then((res) => res.json())
    .then((data) => {
      translations = data;
      currentLang = lang;
      applyTranslations();
    });
}

function applyTranslations() {
  // Переводим весь сайт
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const path = el.dataset.i18n.split(".");
    let value = translations;
    path.forEach((key) => (value = value?.[key]));
    if (value) el.innerHTML = value;
  });
}

// Наведение на изображение проекта
document.querySelectorAll(".work-image").forEach((img) => {
  img.addEventListener("mouseenter", () => {
    const id = img.dataset.id;
    const data = translations.projects?.[id];

    if (data) {
      document.getElementById("projectTitle").textContent = data.title;
      document.getElementById("projectDesc").textContent = data.desc;
      document.getElementById("projectDate").textContent = data.date;
      document.getElementById("projectOverlay").style.opacity = "1";
    }
  });

  img.addEventListener("mouseleave", () => {
    document.getElementById("projectOverlay").style.opacity = "0";
  });
});

// Обработка кнопок языка
document.querySelectorAll("[data-lang]").forEach((btn) => {
  btn.addEventListener("click", () => {
    loadLanguage(btn.dataset.lang);
  });
});

// Начальная загрузка
loadLanguage(currentLang);

/* Параллакс */

document.addEventListener("DOMContentLoaded", () => {
  new Rellax(".rellax", {
    speed: -2, // default, если не указано на элементе
    center: true,
    wrapper: null,
    round: true,
    vertical: true,
    horizontal: false,
  });
});

const rellaxObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        new Rellax(entry.target, {
          speed: parseFloat(entry.target.dataset.rellaxSpeed) || -2,
          center: true,
          round: true,
        });
        observer.unobserve(entry.target); // один раз на элемент
      }
    });
  },
  {
    rootMargin: "0px 0px 20% 0px", // заранее, пока элемент ещё не полностью вошёл
  }
);

// Подключаем наблюдение ко всем .rellax
document
  .querySelectorAll(".rellax")
  .forEach((el) => rellaxObserver.observe(el));
