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
import Navigation from 'CommonUI/src/Utils/Navigation';
import VerifyEmail from './Pages/VerifyEmail';
import ResetPasswordPage from './Pages/ResetPassword';

function App(): ReactElement {
    Navigation.setNavigateHook(useNavigate());
    Navigation.setLocation(useLocation());
    Navigation.setParams(useParams());

    return (
        <div className="m-auto h-screen">
            <Routes>
                <Route path="/accounts" element={<LoginPage />} />
                <Route path="/accounts/login" element={<LoginPage />} />
                <Route
                    path="/accounts/forgot-password"
                    element={<ForgotPasswordPage />}
                />
                <Route
                    path="/accounts/reset-password/:token"
                    element={<ResetPasswordPage />}
                />
                <Route path="/accounts/register" element={<RegisterPage />} />
                <Route path="/accounts/login/sso" element={<SsoLoginPage />} />
                <Route
                    path="/accounts/verify-email/:token"
                    element={<VerifyEmail />}
                />
                {/* 👇️ only match this when no other routes match */}
                <Route path="*" element={<NotFound />} />
            </Routes>
        </div>
    );
}

export default App;
