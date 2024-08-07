import ForgotPasswordPage from "./Pages/ForgotPassword";
import LoginPage from "./Pages/Login";
import LoginWithSSO from "./Pages/LoginWithSSO";
import NotFound from "./Pages/NotFound";
import RegisterPage from "./Pages/Register";
import ResetPasswordPage from "./Pages/ResetPassword";
import VerifyEmail from "./Pages/VerifyEmail";
import Navigation from "Common/UI/src/Utils/Navigation";
import React, { ReactElement } from "react";
import {
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

function App(): ReactElement {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <div className="m-auto h-screen">
      <Routes>
        <Route path="/accounts" element={<LoginPage />} />
        <Route path="/accounts/login" element={<LoginPage />} />

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
    </div>
  );
}

export default App;
