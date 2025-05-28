import React, { ReactElement, lazy, Suspense } from "react";
import {
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import Navigation from "Common/UI/Utils/Navigation";

// Lazy load page components
const ForbiddenPage = lazy(() => import("./Pages/Forbidden"));
const ForgotPasswordPage = lazy(() => import("./Pages/ForgotPassword"));
const LoginPage = lazy(() => import("./Pages/Login"));
const LoginWithSSO = lazy(() => import("./Pages/LoginWithSSO"));
const NotFound = lazy(() => import("./Pages/NotFound"));
const RegisterPage = lazy(() => import("./Pages/Register"));
const ResetPasswordPage = lazy(() => import("./Pages/ResetPassword"));
const VerifyEmail = lazy(() => import("./Pages/VerifyEmail"));

function App(): ReactElement {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <div className="m-auto h-screen">
      <Suspense fallback={<div>Loading...</div>}>
        <Routes>
          <Route path="/accounts" element={<LoginPage />} />
          <Route path="/accounts/login" element={<LoginPage />} />
          <Route path="/accounts/forbidden" element={<ForbiddenPage />} />
          <Route path="/accounts/sso" element={<LoginWithSSO />} />
          <Route
            path="/accounts/forgot-password"
            element={<ForgotPasswordPage />}
          />
          <Route
            path="/accounts/reset-password/:token"
            element={<ResetPasswordPage />}
          />
          <Route path="/accounts/register" element={<RegisterPage />} />
          <Route path="/accounts/verify-email/:token" element={<VerifyEmail />} />
          {/* 👇️ only match this when no other routes match */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </div>
  );
}

export default App;
