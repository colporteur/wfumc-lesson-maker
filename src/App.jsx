import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import Dashboard from './pages/Dashboard.jsx';
import LessonList from './pages/LessonList.jsx';
import LessonDetail from './pages/LessonDetail.jsx';
import LessonWorkspace from './pages/LessonWorkspace.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="lessons" element={<LessonList />} />
        <Route path="lessons/new" element={<LessonDetail mode="new" />} />
        <Route path="lessons/:id" element={<LessonDetail mode="edit" />} />
        <Route path="lessons/:id/workspace" element={<LessonWorkspace />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
