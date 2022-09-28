import React, { ReactElement } from 'react';
import {
    Routes,
    Route,
    useNavigate,
    useLocation,
    useParams,
} from 'react-router-dom';
import LoginPage from './Pages/Login';
import NotFound from './Pages/NotFound';
import SsoLoginPage from './Pages/SsoLogin';
import ForgotPasswordPage from './Pages/ForgotPassword';
import RegisterPage from './Pages/Register';
import { DASHBOARD_URL } from 'CommonUI/src/Config';
import 'CommonUI/src/Styles/theme.scss';
import Navigation from 'CommonUI/src/Utils/Navigation';
import VerifyEmail from './Pages/VerifyEmail';
import User from 'CommonUI/src/Utils/User';

function App(): ReactElement {
    Navigation.setNavigateHook(useNavigate());
    Navigation.setLocation(useLocation());
    Navigation.setParams(useParams());

    if (User.isLoggedIn()) {
        Navigation.navigate(DASHBOARD_URL);
    }

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
                {/* 👇️ only match this when no other routes match */}
                <Route
                    path="*"
                    element={
                        <NotFound

                        />
                    }
                />
            </Routes>
        </div>
    );
}

export default App;
