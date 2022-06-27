import React, { ReactElement } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import LoginPage from './Pages/Login';
import SsoLoginPage from './Pages/SsoLogin';
import ForgotPasswordPage from './Pages/ForgotPassword';
import RegisterPage from './Pages/Register';

import 'CommonUI/src/Styles/theme.scss';
import Navigation from 'CommonUI/src/Utils/Navigation';
import VerifyEmail from './Pages/VerifyEmail';

function App(): ReactElement {
    Navigation.setNavigateHook(useNavigate());
    Navigation.setLocation(useLocation());
    return (
        <div className="App">
            <Routes>
                <Route path="/accounts" element={<LoginPage />} />
                <Route path="/accounts/login" element={<LoginPage />} />
                <Route
                    path="/accounts/forgot-password"
                    element={<ForgotPasswordPage />}
                />
                <Route path="/accounts/register" element={<RegisterPage />} />
                <Route path="/accounts/login/sso" element={<SsoLoginPage />} />
                <Route
                    path="/accounts/verify-email/:token"
                    element={<VerifyEmail />}
                />
            </Routes>
        </div>
    );
}

export default App;
