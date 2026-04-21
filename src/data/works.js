// Единый источник правды для layout-метаданных портфолио.
//
// Контент кейс-стади (текст, год, role, url, stack, tags и т.д.) живёт
// в Content Collections: src/content/works/{en|ru}/{slug}.md
// Здесь — только то, что нужно галерее на главной (и что не переводится).

export const works = [
  {
    id: 'banana-bank',
    image: '/media/projects/banana-bank/main.png',
    layer: 'back',
    col: 5,
    row: 1,
    rellaxSpeed: -1.25,
  },
  {
    id: 'syrnik',
    image: '/media/projects/syrnik/main.png',
    layer: 'front',
    col: 1,
    row: 3,
    rellaxSpeed: 0.25,
  },
  {
    id: 'nuef',
    image: '/media/projects/nuef/main.png',
    layer: 'back',
    col: 8,
    row: 4,
    rellaxSpeed: 1.25,
  },
  {
    id: 'blackhole',
    image: '/media/projects/blackhole/main.png',
    layer: 'front',
    col: 2,
    row: 6,
    rellaxSpeed: -0.55,
  },
  {
    id: 'chainproxy',
    image: '/media/projects/chainproxy/main.png',
    layer: 'back',
    col: 5,
    row: 8,
    rellaxSpeed: 1.25,
  },
  {
    id: 'dotaboom',
    image: '/media/projects/dotaboom/main.png',
    layer: 'front',
    col: 8,
    row: 9,
    rellaxSpeed: 0.55,
  },
  {
    id: 'quicksms',
    image: '/media/projects/quicksms/main.png',
    layer: 'back',
    col: 2,
    row: 11,
    rellaxSpeed: 1.25,
  },
  {
    id: 'xmrcrash',
    image: '/media/projects/xmr-crash/main.png',
    layer: 'back',
    col: 7,
    row: 13,
    rellaxSpeed: 0.65,
  },
  {
    id: 'omikami',
    image: '/media/projects/omikami/main.png',
    layer: 'back',
    col: 4,
    row: 15,
    rellaxSpeed: 0.85,
  },
];

// Порядок проектов по годам (для /works editorial list и "next project"
// навигации в кейсах). Новые — сверху.
// Год живёт в frontmatter, но здесь фиксируем порядок для детерминизма.
export const worksOrderByYear = [
  'syrnik',      // 2025
  'omikami',     // 2025
  'chainproxy',  // 2023
  'quicksms',    // 2022
  'dotaboom',    // 2022
  'nuef',        // 2021
  'xmrcrash',    // 2021
  'banana-bank', // 2020
  'blackhole',   // 2018
];
