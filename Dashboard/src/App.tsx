import React, { FunctionComponent } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import TopBar from './Components/TopBar/TopBar';
import NavBar from './Components/NavBar/NavBar';
import './App.scss';

// Pages
import Monitors from './Pages/Monitors/Monitors';
import Home from './Pages/Home/Home';
import Settings from './Pages/Settings/Settings';
import StatusPages from './Pages/StatusPages/StatusPages';
import Incidents from './Pages/Incidents/Incidents';
import Logs from './Pages/Logs/Logs';

const App: FunctionComponent = () => {
    return (
        <div className="App">
            <TopBar />
            <NavBar />
            <Router>
                <Routes>
                    <Route path="/:projectId/home" element={<Home />} />
                    <Route path="/:projectId/monitors" element={<Monitors />} />
                    <Route path="/:projectId/settings" element={<Settings />} />
                    <Route
                        path="/:projectId/status-pages"
                        element={<StatusPages />}
                    />
                    <Route
                        path="/:projectId/incidents"
                        element={<Incidents />}
                    />
                    <Route path="/:projectId/logs" element={<Logs />} />
                </Routes>
            </Router>
        </div>
    );
};

export default App;
