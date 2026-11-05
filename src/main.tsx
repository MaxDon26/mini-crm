import '@fontsource-variable/golos-text';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
// После стилей Mantine: общие значения внешнего вида должны их перекрывать.
import '@/shared/ui/global.css';

import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from '@/app/routes';
import { CurrentUserProvider } from '@/shared/currentUser';
import { queryClient } from '@/shared/queryClient';
import { theme } from '@/shared/ui';

const root = document.getElementById('root');
if (!root) throw new Error('Не найден корневой элемент страницы');

createRoot(root).render(
  <StrictMode>
    <MantineProvider theme={theme}>
      <Notifications />
      <ModalsProvider>
        <QueryClientProvider client={queryClient}>
          <CurrentUserProvider>
            <RouterProvider router={router} />
          </CurrentUserProvider>
        </QueryClientProvider>
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>,
);
