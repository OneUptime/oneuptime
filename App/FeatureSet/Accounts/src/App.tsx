import React, { ReactElement, lazy, Suspense } from "react";
import {
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import Navigation from "Common/UI/Utils/Navigation";
import PageLoader from "Common/UI/Components/Loader/PageLoader";

// Lazy load page components
const ForbiddenPage: React.LazyExoticComponent<() => JSX.Element> = lazy(() => {
  return import("./Pages/Forbidden");
});
const ForgotPasswordPage: React.LazyExoticComponent<() => JSX.Element> = lazy(
  () => {
    return import("./Pages/ForgotPassword");
  },
);
const LoginPage: React.LazyExoticComponent<() => JSX.Element> = lazy(() => {
  return import("./Pages/Login");
});
const LoginWithSSO: React.LazyExoticComponent<() => JSX.Element> = lazy(() => {
  return import("./Pages/LoginWithSSO");
});
const NotFound: React.LazyExoticComponent<() => JSX.Element> = lazy(() => {
  return import("./Pages/NotFound");
});
const RegisterPage: React.LazyExoticComponent<() => JSX.Element> = lazy(() => {
  return import("./Pages/Register");
});
const ResetPasswordPage: React.LazyExoticComponent<() => JSX.Element> = lazy(
  () => {
    return import("./Pages/ResetPassword");
  },
);
const VerifyEmail: React.LazyExoticComponent<() => JSX.Element> = lazy(() => {
  return import("./Pages/VerifyEmail");
});

function App(): ReactElement {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <div className="m-auto h-screen">
      <Suspense fallback={<PageLoader isVisible={true} />}>
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
          <Route
            path="/accounts/verify-email/:token"
            element={<VerifyEmail />}
          />
          {/* 👇️ only match this when no other routes match */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </div>
  );
}

export default App;
