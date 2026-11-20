import React, {
  ComponentType,
  ReactElement,
  lazy,
  Suspense,
  useEffect,
} from "react";
import AuthPageSkeleton from "Common/UI/Components/AuthPage/AuthPageSkeleton";
import {
  Location,
  Navigate,
  Params,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import Navigation from "Common/UI/Utils/Navigation";
import AccountsTheme from "./Utils/AccountsTheme";
import { isFormDomainPage } from "./Utils/FormDomainPage";
import {
  MASTER_ADMIN_SIGN_IN_PATH,
  PROJECT_SSO_SIGN_IN_PATH,
} from "Common/Types/SSO/SignInMethods";
import { MOBILE_PASSKEY_ENROLMENT_PAGE_PATH } from "Common/Types/Accounts/SecondStepEnrolment";
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
  ComponentType<{
    isMasterAdminSignIn?: boolean | undefined;
    isMagicLinkSignIn?: boolean | undefined;
  }>
> = lazy(() => {
  return import("./Pages/Login");
});
const MagicLinkPage: React.LazyExoticComponent<() => JSX.Element> = lazy(() => {
  return import("./Pages/MagicLink");
});
const MobilePasskeyPage: React.LazyExoticComponent<() => JSX.Element> = lazy(
  () => {
    return import("./Pages/MobilePasskey");
  },
);
// A passkey the mobile app sets up when sign-in requires a second step (#9817).
const MobilePasskeyEnrolmentPage: React.LazyExoticComponent<() => JSX.Element> =
  lazy(() => {
    return import("./Pages/MobilePasskeyEnrolment");
  });
// Drawn on its own here, with none of the props the sign-in page hands it.
const LoginWithSSO: React.LazyExoticComponent<
  ComponentType<{ showEditionLabel?: boolean | undefined }>
> = lazy(() => {
  return import("./Pages/LoginWithSSO");
});
// A project's SSO sign-in link: its providers, by the project's id alone.
const LoginWithProjectSso: React.LazyExoticComponent<ComponentType> = lazy(
  () => {
    return import("./Pages/LoginWithProjectSso");
  },
);
const NotFound: React.LazyExoticComponent<() => JSX.Element> = lazy(() => {
  return import("./Pages/NotFound");
});
const RegisterPage: React.LazyExoticComponent<() => JSX.Element> = lazy(() => {
  return import("./Pages/Register");
});
// Also the set-password page of an account made for someone, by its prop.
const ResetPasswordPage: React.LazyExoticComponent<
  ComponentType<{ isSettingFirstPassword?: boolean | undefined }>
> = lazy(() => {
  return import("./Pages/ResetPassword");
});
const VerifyEmail: React.LazyExoticComponent<() => JSX.Element> = lazy(() => {
  return import("./Pages/VerifyEmail");
});
// On a form's own domain, the page is drawn with isOnCustomDomain.
const FormPage: React.LazyExoticComponent<
  ComponentType<{ isOnCustomDomain?: boolean | undefined }>
> = lazy(() => {
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
  const location: Location = useLocation();

  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);
  Navigation.setParams(useParams());

  /*
   * Each page in its theme: a public form is always light, every other page
   * the person's (Utils/AccountsTheme.ts).
   */
  useEffect(() => {
    AccountsTheme.followPage();
  }, [location.pathname]);

  /*
   * A form on its owner's own domain (Utils/FormDomainPage): the form, and
   * nothing else, whatever the address - the server sends every other
   * address there to the root anyway. No sign-in page, no other route, and
   * none of OneUptime's links in the footer: the page is its owner's.
   */
  if (isFormDomainPage()) {
    return (
      <div className="m-auto flex min-h-screen flex-col">
        <Suspense fallback={<AuthPageSkeleton fields={3} />}>
          <div className="flex flex-grow flex-col justify-center">
            <FormPage isOnCustomDomain={true} />
          </div>
          <Footer isOnFormDomain={true} />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="m-auto flex min-h-screen flex-col">
      <Suspense fallback={<AuthPageSkeleton />}>
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
            <Route
              path={MOBILE_PASSKEY_ENROLMENT_PAGE_PATH}
              element={<MobilePasskeyEnrolmentPage />}
            />
            <Route path="/accounts/forbidden" element={<ForbiddenPage />} />
            <Route path="/accounts/sso" element={<LoginWithSSO />} />
            {/*
             * A project's SSO sign-in link (Common/Types/SSO/SignInMethods,
             * #9918): the providers that sign people in to one project, for
             * people whose address "Sign in with SSO" cannot find them by -
             * an address on another domain, a domain not verified yet.
             */}
            <Route
              path={PROJECT_SSO_SIGN_IN_PATH}
              element={<LoginWithProjectSso />}
            />
            <Route
              path="/accounts/forgot-password"
              element={<ForgotPasswordPage />}
            />
            {/*
             * Signing in with a link emailed to the account
             * (Common/Types/Accounts/MagicLink): asked for here, and opened
             * at /accounts/magic-link-login/<token> - the sign-in page,
             * drawing one button that signs in with the link in place of
             * the password form. Keyed apart from the sign-in page's other
             * routes, so it always starts from the link the tab opened.
             */}
            <Route path="/accounts/magic-link" element={<MagicLinkPage />} />
            <Route
              path="/accounts/magic-link-login"
              element={
                <LoginPage key="magic-link-login" isMagicLinkSignIn={true} />
              }
            />
            <Route
              path="/accounts/magic-link-login/:token"
              element={
                <LoginPage key="magic-link-login" isMagicLinkSignIn={true} />
              }
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
            {/*
             * The first password of an account a master admin created
             * (Common/Types/Accounts/SetPasswordLink): the reset page, in
             * its own words.
             */}
            <Route
              path="/accounts/set-password"
              element={<ResetPasswordPage isSettingFirstPassword={true} />}
            />
            <Route
              path="/accounts/set-password/:token"
              element={<ResetPasswordPage isSettingFirstPassword={true} />}
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
