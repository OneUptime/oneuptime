import React, { FunctionComponent } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import TopBar from './Components/TopBar/TopBar';
import NavBar from './Components/NavBar/NavBar';
import './App.scss';
import Monitors from './Pages/Monitors';

const App: FunctionComponent = () => {
    return (
        <div className="App">
            <TopBar />
            <NavBar />
            <Router>
                <Routes>
                    <Route path="/" element={<Monitors />} />
                </Routes>
            </Router>
        </div>
    );
};

export default App;
