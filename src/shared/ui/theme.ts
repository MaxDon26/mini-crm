import { createTheme, rem } from '@mantine/core';
import type { MantineColorsTuple } from '@mantine/core';

// Внешний вид «Ход работ» (Р29, раздел 3.9). Цвет говорит только о статусе, поэтому основной цвет
// интерфейса — графит, а цвета статусов заданы отдельными переменными в global.css.

const graphite: MantineColorsTuple = [
  '#F3F5F8',
  '#E5E9EE',
  '#CBD2DB',
  '#AEB8C4',
  '#8E99A8',
  '#6B7684',
  '#525D6B',
  '#3A4552',
  '#1D2733',
  '#111821',
];

// Серые оттенки Mantine заменены холодными: gray-3 — линии, gray-5 — подсказки в полях (контраст
// с белым 4,6:1), gray-6 — второстепенный текст (5,8:1).
const gray: MantineColorsTuple = [
  '#F3F5F8',
  '#EBEEF2',
  '#E2E6EC',
  '#DCE1E8',
  '#CDD4DD',
  '#6B7684',
  '#5B6776',
  '#47515E',
  '#343D49',
  '#1D2733',
];

export const theme = createTheme({
  fontFamily: "'Golos Text Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
  black: '#1D2733',
  white: '#FFFFFF',
  colors: { graphite, gray },
  primaryColor: 'graphite',
  primaryShade: 8,
  focusRing: 'auto',
  respectReducedMotion: true,
  defaultRadius: 'md',
  radius: { xs: rem(2), sm: rem(4), md: rem(6), lg: rem(8), xl: rem(12) },
  fontSizes: { xs: rem(14), sm: rem(14), md: rem(16), lg: rem(18), xl: rem(20) },
  lineHeights: { xs: '1.4', sm: '1.45', md: '1.5', lg: '1.5', xl: '1.4' },
  spacing: { xs: rem(8), sm: rem(12), md: rem(16), lg: rem(24), xl: rem(32) },
  headings: {
    fontFamily: "'Golos Text Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontWeight: '600',
    sizes: {
      h1: { fontSize: rem(30), lineHeight: '1.2' },
      h2: { fontSize: rem(30), lineHeight: '1.2' },
      h3: { fontSize: rem(20), lineHeight: '1.3' },
      h4: { fontSize: rem(16), lineHeight: '1.4' },
    },
  },
  components: {
    Button: { defaultProps: { fw: 500 } },
    Modal: {
      defaultProps: { radius: 'lg', padding: 'lg', overlayProps: { backgroundOpacity: 0.4 } },
      styles: { title: { fontSize: rem(20), fontWeight: 600 } },
    },
    Tooltip: { defaultProps: { color: 'graphite', multiline: true } },
  },
});
