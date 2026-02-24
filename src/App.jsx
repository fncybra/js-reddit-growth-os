import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Models } from './pages/Models';
import { Accounts } from './pages/Accounts';
import { Subreddits } from './pages/Subreddits';
import { Library } from './pages/Library';
import { Tasks } from './pages/Tasks';
import { Settings } from './pages/Settings';
import { Discovery } from './pages/Discovery';
import { ModelDetail } from './pages/ModelDetail';
import { VADashboard } from './pages/VADashboard';
import { CloudSyncHandler } from './components/CloudSyncHandler';
import { SOP } from './pages/SOP';

function App() {
  return (
    <BrowserRouter>
      <CloudSyncHandler />
      <Routes>
        {/* VA Mode: No Internal sidebars, pure robot mode */}
        <Route path="/va" element={<VADashboard />} />

        {/* Admin/Agency Mode: Full dashboard */}
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="discovery" element={<Discovery />} />
          <Route path="models" element={<Models />} />
          <Route path="model/:id" element={<ModelDetail />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="subreddits" element={<Subreddits />} />
          <Route path="library" element={<Library />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="settings" element={<Settings />} />
          <Route path="sop" element={<SOP />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
