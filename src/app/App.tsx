import { Container } from '@mantine/core';
import { Outlet } from 'react-router';
import { TopBar } from './TopBar';

export function App() {
  return (
    <>
      <TopBar />
      <Container component="main" size="lg" py="md">
        <Outlet />
      </Container>
    </>
  );
}
