import { NavLink } from 'react-router';
import { SignOutButton } from '@/features/auth';
import { ROLE_LABELS, useReadyUser } from '@/shared/currentUser';
import type { Role } from '@/shared/currentUser';
import classes from './layout.module.css';

const SECTIONS_BY_ROLE: Record<Role, { to: string; label: string }[]> = {
  manager: [{ to: '/objects', label: 'Объекты' }],
  executor: [
    { to: '/my-tasks', label: 'Мои задачи' },
    { to: '/objects', label: 'Объекты' },
  ],
};

export function TopBar() {
  const { fullName, role } = useReadyUser();
  return (
    <header className={classes.header}>
      <div className={`${classes.content} ${classes.bar}`}>
        {/* Не ссылка: имя «Объекты и задачи» совпало бы по началу с разделом «Объекты». */}
        <span className={classes.title}>Объекты и задачи</span>
        <nav className={classes.nav} aria-label="Разделы">
          {SECTIONS_BY_ROLE[role].map((section) => (
            <NavLink key={section.to} to={section.to} className={classes.navLink}>
              {section.label}
            </NavLink>
          ))}
        </nav>
        <div className={classes.user}>
          <span className={classes.userName}>{fullName}</span>
          <span className={classes.userRole}>{ROLE_LABELS[role]}</span>
        </div>
        <div className={classes.signOut}>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
