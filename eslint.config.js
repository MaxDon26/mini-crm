import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const FEATURES = ['auth', 'objects', 'tasks'];

const LAYER_MESSAGE = 'Импорт идёт только в сторону shared → features → app (Р16).';
const CLIENT_MESSAGE = 'Запросы к базе только в файлах api.ts разделов и в shared (Р16).';

// Пути сравниваются как строки, поэтому каждое правило ловит и `@/`, и относительный путь любой
// глубины, и импорт папки целиком, и путь с расширением. Точка записана как [.], чтобы не возиться
// с экранированием.
const UP = '([.][.]/)+';
const END = '([/.]|$)';

/** Путь к папке src/<folder>: через `@/` или относительный. */
function folderPath(folder) {
  return [`^@/${folder}${END}`, `^${UP}${folder}${END}`];
}

/** Подключение к Supabase в любом виде: `@/shared/supabaseClient`, `../shared/supabaseClient.ts`, … */
const SUPABASE_CLIENT = { regex: '(^|/)supabaseClient([.][jt]sx?)?$', message: CLIENT_MESSAGE };

/**
 * Базовое правило заменяется целиком, поэтому запреты собираются для каждой папки.
 * Регистр учитывается: имена папок и файлов в нём различаются.
 */
function restrict(layerRegexes, allowSupabaseClient = false) {
  const patterns = layerRegexes.map((regex) => ({
    regex,
    message: LAYER_MESSAGE,
    caseSensitive: true,
  }));
  if (!allowSupabaseClient) patterns.push({ ...SUPABASE_CLIENT, caseSensitive: true });
  return { 'no-restricted-imports': ['error', patterns.length > 0 ? { patterns } : {}] };
}

const featureRules = FEATURES.flatMap((feature) => {
  const others = FEATURES.filter((other) => other !== feature).join('|');
  const layers = [
    ...folderPath('app'),
    // Другой раздел через `@/features` или `../../features`: свой раздел разрешён.
    `^@/features(/(?!${feature}${END})|[.]|$)`,
    `^${UP}features(/(?!${feature}${END})|[.]|$)`,
    // Другой раздел соседней папкой: `../objects`, `../objects/x`.
    `^${UP}(${others})${END}`,
  ];
  return [
    { files: [`src/features/${feature}/**/*.{ts,tsx}`], rules: restrict(layers) },
    { files: [`src/features/${feature}/**/api.ts`], rules: restrict(layers, true) },
  ];
});

export default tseslint.config(
  { ignores: ['dist', 'playwright-report', 'test-results', 'src/shared/database.types.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  // Всё остальное в src (main.tsx и будущие папки) к базе напрямую не обращается.
  { files: ['src/**/*.{ts,tsx}'], rules: restrict([]) },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: restrict([...folderPath('features'), ...folderPath('app')], true),
  },
  { files: ['src/app/**/*.{ts,tsx}'], rules: restrict([]) },
  ...featureRules,
  { files: ['postcss.config.cjs'], languageOptions: { globals: { module: 'writable' } } },
  { files: ['postcss.config.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  prettier,
);
