import React, { ComponentType, ReactElement, lazy, Suspense } from "react";
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
import { MASTER_ADMIN_SIGN_IN_PATH } from "Common/Types/SSO/SignInMethods";
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
/*
 * What the routes below hand the sign-in pages, written here rather than
 * imported from them: a page module is only ever loaded lazily
 * (McpAuthorizeWiring holds this file to that).
 */
const LoginPage: React.LazyExoticComponent<
  ComponentType<{ isMasterAdminSignIn?: boolean | undefined }>
> = lazy(() => {
  return import("./Pages/Login");
});
const MobilePasskeyPage: React.LazyExoticComponent<() => JSX.Element> = lazy(
  () => {
    return import("./Pages/MobilePasskey");
  },
);
// Drawn on its own here, with none of the props the sign-in page hands it.
const LoginWithSSO: React.LazyExoticComponent<
  ComponentType<{ showEditionLabel?: boolean | undefined }>
> = lazy(() => {
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
const MarketplacePurchasePage: React.LazyExoticComponent<() => JSX.Element> =
  lazy(() => {
    return import("./Pages/MarketplacePurchase");
  });

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
            {/*
             * The master admins' way in while the server requires single
             * sign-on: the password form alone (Pages/Login). The sign-in
             * page does not link to it; the Admin Dashboard sends a
             * signed-out visitor here, and its Require SSO card names it.
             */}
            <Route
              path={MASTER_ADMIN_SIGN_IN_PATH}
              element={<LoginPage isMasterAdminSignIn={true} />}
            />
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
            {/*
             * Where a buyer from AWS, Microsoft or Google Cloud Marketplace
             * chooses the project their purchase pays for. It needs a
             * session; a visitor without one is sent to sign in and brought
             * back (see the page).
             */}
            <Route
              path="/accounts/marketplace"
              element={<MarketplacePurchasePage />}
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
