import React, { ReactElement, lazy, Suspense } from "react";
import {
  Navigate,
  Params,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import Navigation from "Common/UI/Utils/Navigation";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Footer from "./Components/Footer/Footer";

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
const MobilePasskeyPage: React.LazyExoticComponent<() => JSX.Element> = lazy(
  () => {
    return import("./Pages/MobilePasskey");
  },
);
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
const FormPage: React.LazyExoticComponent<() => JSX.Element> = lazy(() => {
  return import("./Pages/Form");
});
const McpAuthorizePage: React.LazyExoticComponent<() => JSX.Element> = lazy(
  () => {
    return import("./Pages/McpAuthorize");
  },
);

/*
 * Incident forms became forms (the Forms product), and kept their link keys,
 * so a link shared before - /accounts/incident-form/<key> - is sent on to
 * the same form's page. Replaced, not pushed: Back leaves the form rather
 * than bouncing through the old address.
 */
export function LegacyIncidentFormRedirect(): ReactElement {
  const params: Readonly<Params<string>> = useParams();
  const shareKey: string = params["shareKey"] || "";

  return (
    <Navigate
      replace={true}
      to={`/accounts/form/${encodeURIComponent(shareKey)}`}
    />
  );
}

function App(): ReactElement {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <div className="m-auto flex min-h-screen flex-col">
      <Suspense fallback={<PageLoader isVisible={true} />}>
        <div className="flex flex-grow flex-col justify-center">
          <Routes>
            <Route path="/accounts" element={<LoginPage />} />
            <Route path="/accounts/login" element={<LoginPage />} />
            <Route
              path="/accounts/mobile-passkey"
              element={<MobilePasskeyPage />}
            />
            <Route path="/accounts/forbidden" element={<ForbiddenPage />} />
            <Route path="/accounts/sso" element={<LoginWithSSO />} />
            <Route
              path="/accounts/forgot-password"
              element={<ForgotPasswordPage />}
            />
            {/*
             * Both forms of each token-bearing route are registered. The head
             * bootstrap in Common/Server/Views/Partials/SensitiveUrlToken.ejs
             * normally takes the token out of the path before the router ever
             * sees it, which lands the visitor on the token-free form; the
             * :token form is what remains when that bootstrap could not run.
             * Either way the page reads the token through SensitiveUrlToken.
             */}
            <Route
              path="/accounts/reset-password"
              element={<ResetPasswordPage />}
            />
            <Route
              path="/accounts/reset-password/:token"
              element={<ResetPasswordPage />}
            />
            <Route path="/accounts/register" element={<RegisterPage />} />
            <Route path="/accounts/verify-email" element={<VerifyEmail />} />
            <Route
              path="/accounts/verify-email/:token"
              element={<VerifyEmail />}
            />
            {/*
             * A public form, for anybody holding its link - signed in or not,
             * and nothing on the page redirects either. One form only: the
             * share key is a link identifier, not a single-use secret, so the
             * SensitiveUrlToken bootstrap leaves it in the path (it is not
             * one of its TOKEN_ROUTES) and there is no token-free form to
             * land on.
             */}
            <Route path="/accounts/form/:shareKey" element={<FormPage />} />
            <Route
              path="/accounts/incident-form/:shareKey"
              element={<LegacyIncidentFormRedirect />}
            />
            {/*
             * The consent screen an MCP client sends its user to when it
             * signs in with OAuth. It needs a session; a visitor without one
             * is sent to sign in and brought back (see the page).
             */}
            <Route
              path="/accounts/mcp-authorize"
              element={<McpAuthorizePage />}
            />
            {/* 👇️ only match this when no other routes match */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
        <Footer />
      </Suspense>
    </div>
  );
}

export default App;
