import { useMediaQuery } from '@mantine/hooks';

// Та же граница, что в CSS (раздел 3.9): на 768 пикселях и шире таблица, уже — карточки.
export const PHONE_MEDIA_QUERY = '(max-width: 47.99em)';

/**
 * Ширина читается сразу при первой отрисовке: иначе телефон на мгновение получал бы таблицу и
 * прокрутку вбок.
 */
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_MEDIA_QUERY, false, { getInitialValueInEffect: false });
}
