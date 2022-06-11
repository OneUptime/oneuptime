import React, { FunctionComponent } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
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
import Navigation from 'CommonUI/src/Utils/Navigation';

const App: FunctionComponent = () => {
    // set navigate hook for the app.
    Navigation.setNavigateHook(useNavigate());
    Navigation.setLocation(useLocation());

    return (

        <div className="App">
            <TopBar />
            <NavBar />
            <Routes>
                <Route path="/" element={<Home />} />
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

        </div>
    );
};

export default App;
