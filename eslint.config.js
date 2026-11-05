import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const FEATURES = ['auth', 'objects', 'tasks'];
const SUPABASE_CLIENT = '@/shared/supabaseClient';

/**
 * Импорт идёт только в одну сторону: shared → features → app (решение Р16).
 * Подключение к Supabase доступно только файлам api.ts разделов и shared.
 * Базовое правило заменяется целиком, поэтому запреты собираются для каждой папки.
 */
function restrict(group, allowSupabaseClient = false) {
  const options = {};
  if (group.length > 0) {
    options.patterns = [
      { group, message: 'Импорт идёт только в сторону shared → features → app (Р16).' },
    ];
  }
  if (!allowSupabaseClient) {
    options.paths = [
      { name: SUPABASE_CLIENT, message: 'Запросы к базе только в файлах api.ts (Р16).' },
    ];
  }
  return { 'no-restricted-imports': ['error', options] };
}

const featureRules = FEATURES.flatMap((feature) => {
  const others = FEATURES.filter((other) => other !== feature);
  const group = [
    '@/app/*',
    '../../*',
    ...others.flatMap((other) => [`@/features/${other}/*`, `@/features/${other}`, `../${other}/*`]),
  ];
  return [
    { files: [`src/features/${feature}/**/*.{ts,tsx}`], rules: restrict(group) },
    { files: [`src/features/${feature}/**/api.ts`], rules: restrict(group, true) },
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
  { files: ['src/shared/**/*.{ts,tsx}'], rules: restrict(['@/features/*', '@/app/*'], true) },
  { files: ['src/app/**/*.{ts,tsx}'], rules: restrict([]) },
  ...featureRules,
  { files: ['postcss.config.cjs'], languageOptions: { globals: { module: 'writable' } } },
  { files: ['postcss.config.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  prettier,
);
