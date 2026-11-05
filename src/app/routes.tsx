import { createBrowserRouter, Navigate } from 'react-router';
import { App } from './App';
import { RedirectByRole, RequireExecutor, RequireProfile } from './guards';
import { LoginPage } from './pages/LoginPage';
import { MyTasksPage } from './pages/MyTasksPage';
import { ObjectPage } from './pages/ObjectPage';
import { ObjectsPage } from './pages/ObjectsPage';
import { TaskPage } from './pages/TaskPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireProfile />,
    children: [
      { path: '/', element: <RedirectByRole /> },
      {
        element: <App />,
        children: [
          { path: '/objects', element: <ObjectsPage /> },
          { path: '/objects/:objectId', element: <ObjectPage /> },
          { path: '/tasks/:taskId', element: <TaskPage /> },
          {
            element: <RequireExecutor />,
            children: [{ path: '/my-tasks', element: <MyTasksPage /> }],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
