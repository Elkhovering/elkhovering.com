// Content Collections для кейс-стади. Файлы лежат по локалям:
//   src/content/works/en/*.md  — английские версии
//   src/content/works/ru/*.md  — русские версии
//
// id = "en/banana-bank" / "ru/banana-bank" (путь от base без расширения).
// Сам слаг проекта (banana-bank) берём из frontmatter.slug, чтобы он
// совпадал с id в src/data/works.js и с URL-роутом.

import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const works = defineCollection({
  loader: glob({
    pattern: '**/*.{md,mdx}',
    base: './src/content/works',
    // ID должен включать префикс локали (en/banana-bank, ru/banana-bank),
    // иначе glob схлопывает файлы с одним именем из разных папок в один id.
    generateId: ({ entry }) => entry.replace(/\.(md|mdx)$/, ''),
  }),
  schema: z.object({
    slug: z.string(),                       // 'banana-bank' — ключ, совпадает с works.js
    title: z.string(),                      // 'Banana Bank'
    summary: z.string(),                    // одна строка для editorial list
    year: z.number(),                       // 2020
    role: z.string(),                       // 'Designer & developer'
    url: z.string().nullable().optional(),  // живая ссылка; допускаем null (пустое YAML-значение)
    client: z.string().nullable().optional(),
    stack: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),  // designer / developer / visionary / ...
    cover: z.string(),                      // путь до обложки в /public
    gallery: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { works };
