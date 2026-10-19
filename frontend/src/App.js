import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import api from './lib/api';

import SetupPage from './pages/SetupPage';
import LoginPage from './pages/LoginPage';
import ParentDashboard from './pages/ParentDashboard';
import ChildSelect from './pages/ChildSelect';
import ChildDashboard from './pages/ChildDashboard';
import ChoresPage from './pages/ChoresPage';
import ParentChores from './pages/ParentChores';
import SettingsPage from './pages/SettingsPage';
import ChildrenPage from './pages/ChildrenPage';
import AdjustTimePage from './pages/AdjustTimePage';

function AppRoutes() {
  useLocation(); // re-renders on every navigation so token/role are always fresh
  const token = localStorage.getItem('jt_token');
  const role = localStorage.getItem('jt_role');

  return (
    <Routes>
      <Route path="/" element={
        !token ? <LoginPage /> :
        role === 'parent' ? <Navigate to="/parent" replace /> :
        <Navigate to="/child-select" replace />
      } />
      <Route path="/parent" element={token && role==='parent' ? <ParentDashboard /> : <Navigate to="/" />} />
      <Route path="/parent/chores" element={token && role==='parent' ? <ParentChores /> : <Navigate to="/" />} />
      <Route path="/parent/children" element={token && role==='parent' ? <ChildrenPage /> : <Navigate to="/" />} />
      <Route path="/parent/settings" element={token && role==='parent' ? <SettingsPage /> : <Navigate to="/" />} />
      <Route path="/parent/adjust/:childId" element={token && role==='parent' ? <AdjustTimePage /> : <Navigate to="/" />} />
      <Route path="/child-select" element={<ChildSelect />} />
      <Route path="/child/:childId" element={<ChildDashboard />} />
      <Route path="/child/:childId/chores" element={<ChoresPage />} />
    </Routes>
  );
}

function App() {
  const [needsSetup, setNeedsSetup] = useState(null);
  const [jellyfinConfigured, setJellyfinConfigured] = useState(false);

  useEffect(() => {
    api.get('/auth/setup-status').then(r => {
      setJellyfinConfigured(r.data.jellyfinConfigured);
      setNeedsSetup(!r.data.jellyfinConfigured && !r.data.hasParentAccount);
    });
  }, []);

  if (needsSetup === null) return <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',fontSize:'2rem' }}>🎬</div>;

  if (needsSetup) return <SetupPage jellyfinConfigured={jellyfinConfigured} onDone={() => setNeedsSetup(false)} />;

  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
