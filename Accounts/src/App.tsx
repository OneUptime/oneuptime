import React, { ReactElement } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LoginPage from './Pages/Login';
import SsoLoginPage from './Pages/SsoLogin';
import ForgotPasswordPage from './Pages/ForgotPassword';
import RegisterPage from './Pages/Register';

import 'CommonUI/src/Styles/theme.scss';

function App(): ReactElement {
    return (
        <div className="App">
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
