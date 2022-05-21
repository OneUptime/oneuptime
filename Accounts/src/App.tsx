import React, { ReactElement } from 'react';
import './App.scss';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LoginPage from './Pages/Login';
import SsoLoginPage from './Pages/SsoLogin';
import ForgotPasswordPage from './Pages/ForgotPassword';
import RegisterPage from './Pages/Register';

function App(): ReactElement {
    return (
        <div className="App">
            <div className="brand">
                <img alt="OneUpTime" src="/assets/img/OneUptimeSVG/3.svg" />
            </div>
            <Router>
                <Routes>
                    <Route path="/" element={<LoginPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route
                        path="/forgot-password"
                        element={<ForgotPasswordPage />}
                    />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/login/sso" element={<SsoLoginPage />} />
                    <Route path="/verify-email" element={<LoginPage />} />
                </Routes>
            </Router>
        </div>
    );
}

export default App;
