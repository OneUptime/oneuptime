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
                    <Route path="/accounts" element={<LoginPage />} />
                    <Route path="/accounts/login" element={<LoginPage />} />
                    <Route
                        path="/accounts/forgot-password"
                        element={<ForgotPasswordPage />}
                    />
                    <Route
                        path="/accounts/register"
                        element={<RegisterPage />}
                    />
                    <Route
                        path="/accounts/login/sso"
                        element={<SsoLoginPage />}
                    />
                    <Route
                        path="/accounts/verify-email"
                        element={<LoginPage />}
                    />
                </Routes>
            </Router>
        </div>
    );
}

export default App;
