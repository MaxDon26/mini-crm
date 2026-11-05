import { Outlet } from 'react-router';
import classes from './layout.module.css';
import { TopBar } from './TopBar';

export function App() {
  return (
    <>
      <TopBar />
      <main className={`${classes.content} ${classes.main}`}>
        <Outlet />
      </main>
    </>
  );
}
