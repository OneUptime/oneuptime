import PageMap from "./Utils/PageMap";
import PublicDashboardSignIn from "./Utils/SignIn";
import { DashboardSignedInVisitor } from "./Pages/DashboardView/DashboardSignedIn";
import { DASHBOARD_LOGIN_CODE_PARAMETER } from "Common/Types/Dashboard/DashboardPrivateUserSignIn";
import Route from "Common/Types/API/Route";
import AuthPageSkeleton from "Common/UI/Components/AuthPage/AuthPageSkeleton";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import RouteMap from "./Utils/RouteMap";
import RouteParams from "./Utils/RouteParams";
import PublicDashboardUtil, {
  PUBLIC_DASHBOARD_FORGOT_PASSWORD_PATH,
  PUBLIC_DASHBOARD_SIGN_IN_PATH,
} from "./Utils/PublicDashboard";
import DashboardThemeUtil from "./Utils/DashboardTheme";
import { PUBLIC_DASHBOARD_API_URL } from "./Utils/Config";
import API from "./Utils/API";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Navigation from "Common/UI/Utils/Navigation";
import React, { lazy, Suspense, useState } from "react";
import {
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import BadDataException from "Common/Types/Exception/BadDataException";
import { isDashboardMasterPasswordRequired } from "Common/Types/Dashboard/DashboardAccess";
import {
  DASHBOARD_THEME_COLUMN,
  UNKNOWN_DASHBOARD_THEME,
  parseDashboardTheme,
} from "Common/Types/Dashboard/DashboardTheme";
import useAsyncEffect from "use-async-effect";

// Lazy load page components
type AllPagesModule = typeof import("./Pages/AllPages");

const DashboardViewPage: React.LazyExoticComponent<
  AllPagesModule["DashboardViewPage"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return { default: m.DashboardViewPage };
  });
});

const MasterPassword: React.LazyExoticComponent<
  AllPagesModule["MasterPassword"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return { default: m.MasterPassword };
  });
});

const NotFoundPage: React.LazyExoticComponent<AllPagesModule["NotFoundPage"]> =
  lazy(() => {
    return import("./Pages/AllPages").then((m: AllPagesModule) => {
      return { default: m.NotFoundPage };
    });
  });

const ForbiddenPage: React.LazyExoticComponent<
  AllPagesModule["ForbiddenPage"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return { default: m.ForbiddenPage };
  });
});

const SignInPage: React.LazyExoticComponent<AllPagesModule["SignInPage"]> =
  lazy(() => {
    return import("./Pages/AllPages").then((m: AllPagesModule) => {
      return { default: m.SignInPage };
    });
  });

const ForgotPasswordPage: React.LazyExoticComponent<
  AllPagesModule["ForgotPasswordPage"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return { default: m.ForgotPasswordPage };
  });
});

const ResetPasswordPage: React.LazyExoticComponent<
  AllPagesModule["ResetPasswordPage"]
> = lazy(() => {
  return import("./Pages/AllPages").then((m: AllPagesModule) => {
    return { default: m.ResetPasswordPage };
  });
});

/*
 * The code single sign-on hands a dashboard's page back in its address
 * (#10250), exchanged for the session on this host, then taken out of the
 * address - with history.replaceState, so neither Back nor a bookmark keeps
 * it. Answers what went wrong, or null once it is exchanged or there is
 * none.
 */
const exchangeLoginCodeInAddress: (
  dashboardId: ObjectID,
) => Promise<string | null> = async (
  dashboardId: ObjectID,
): Promise<string | null> => {
  const loginCode: string | null = Navigation.getQueryStringByName(
    DASHBOARD_LOGIN_CODE_PARAMETER,
  );

  if (!loginCode) {
    return null;
  }

  try {
    const address: globalThis.URL = new globalThis.URL(window.location.href);
    address.searchParams.delete(DASHBOARD_LOGIN_CODE_PARAMETER);
    window.history.replaceState(
      window.history.state,
      "",
      `${address.pathname}${address.search}${address.hash}`,
    );
  } catch {
    // The code is spent once either way: the address is only tidied.
  }

  try {
    await PublicDashboardSignIn.exchangeLoginCode({ dashboardId, loginCode });
    return null;
  } catch (err) {
    return API.getFriendlyMessage(err);
  }
};

const App: () => JSX.Element = () => {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardId, setDashboardId] = useState<ObjectID | null>(null);
  const [dashboardName, setDashboardName] = useState<string>("Dashboard");
  const [isPublicDashboard, setIsPublicDashboard] = useState<boolean>(false);
  const [isForbidden, setIsForbidden] = useState<boolean>(false);
  /*
   * A dashboard that asks its visitors to sign in (#10250): whether it
   * does, who is signed in - the metadata's answer, from the session's
   * HttpOnly cookie - and what went wrong exchanging a single sign-on
   * code, for the sign-in page to say.
   */
  const [isSignInRequired, setIsSignInRequired] = useState<boolean>(false);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  // The dashboard this address shows, or null when it shows none.
  type GetIdFunction = () => Promise<ObjectID | null>;

  const getId: GetIdFunction = async (): Promise<ObjectID | null> => {
    if (PublicDashboardUtil.isPreviewPage()) {
      const id: string | null = Navigation.getParamByName(
        RouteParams.DashboardId,
        RouteMap[PageMap.PREVIEW_OVERVIEW]!,
      );
      if (id) {
        return new ObjectID(id);
      }
    }

    // Get dashboard ID by hostname (custom domain)
    const response: HTTPResponse<JSONObject> = await API.post<JSONObject>({
      url: URL.fromString(PUBLIC_DASHBOARD_API_URL.toString()).addRoute(
        `/domain`,
      ),
      data: {
        domain: Navigation.getHostname().toString(),
      },
      headers: {},
    });

    /*
     * 404: no dashboard shows on this domain - none was added, or its
     * dashboard is shared only with its project or archived. Any other
     * failure is an error to show.
     */
    if (response.isFailure()) {
      if (response.statusCode === 404) {
        return null;
      }

      throw response;
    }

    if (response.data && response.data["dashboardId"]) {
      return new ObjectID(response.data["dashboardId"] as string);
    }

    throw new BadDataException("Dashboard not found for this domain");
  };

  useAsyncEffect(async () => {
    try {
      setIsLoading(true);

      const id: ObjectID | null = await getId();

      // Nothing to show here: the not-found page, which follows the visitor.
      if (!id) {
        DashboardThemeUtil.setDashboardTheme(UNKNOWN_DASHBOARD_THEME);
        setIsLoading(false);
        return;
      }

      setDashboardId(id);
      PublicDashboardUtil.setDashboardId(id);

      // Back from single sign-on: the session first, so the metadata knows it.
      setSignInError(await exchangeLoginCodeInAddress(id));

      // Fetch dashboard metadata
      const response: HTTPResponse<JSONObject> = await API.post<JSONObject>({
        url: URL.fromString(PUBLIC_DASHBOARD_API_URL.toString()).addRoute(
          `/metadata/${id.toString()}`,
        ),
        data: {},
        headers: {},
      });

      /*
       * The metadata answers only for a dashboard this visitor may see:
       *
       *   404  a dashboard that is not here - one shared only with its
       *        project, an archived one and a missing one answer alike
       *   403  its IP allowlist refuses this address. The client has
       *        already sent the browser to the forbidden page for it
       *        (API.getForbiddenRoute); there the metadata answers 403
       *        again, and this shows the Access Denied page
       *
       * Anything else (a rate limit, a server error) is an error to show,
       * not a dashboard that is missing.
       */
      if (response.isFailure()) {
        PublicDashboardUtil.setRequiresMasterPassword(false);

        /*
         * Access Denied and not found show nothing of the dashboard, its
         * theme included: they follow the visitor - their own pick, else
         * their device. An error keeps the theme the page was sent in.
         */
        if (response.statusCode === 403 || response.statusCode === 404) {
          DashboardThemeUtil.setDashboardTheme(UNKNOWN_DASHBOARD_THEME);
        }

        if (response.statusCode === 403) {
          setIsForbidden(true);
        } else if (response.statusCode !== 404) {
          setError(API.getFriendlyMessage(response));
        }

        setIsLoading(false);
        return;
      }

      if (response.data) {
        /*
         * How the dashboard looks to visitors, its password prompt included:
         * the theme its page was sent in, read again here, so the page is
         * drawn in it even when its server could not read it.
         */
        DashboardThemeUtil.setDashboardTheme(
          parseDashboardTheme(response.data[DASHBOARD_THEME_COLUMN]),
        );

        const name: string = (response.data["name"] as string) || "Dashboard";
        const pageTitle: string =
          (response.data["pageTitle"] as string) || name;
        setDashboardName(name);
        document.title = pageTitle;

        // Set favicon if available
        const faviconData: JSONObject | null =
          (response.data["faviconFile"] as JSONObject) || null;
        if (faviconData && faviconData["file"]) {
          const fileData: string = faviconData["file"] as string;
          const fileType: string =
            (faviconData["fileType"] as string) || "image/png";
          const faviconUrl: string = `data:${fileType};base64,${fileData}`;

          let linkElement: HTMLLinkElement | null =
            document.querySelector('link[rel="icon"]');

          if (!linkElement) {
            linkElement = document.createElement("link");
            linkElement.rel = "icon";
            document.head.appendChild(linkElement);
          }

          linkElement.href = faviconUrl;
        }

        const enableMasterPassword: boolean = Boolean(
          response.data["enableMasterPassword"],
        );
        const isPublic: boolean = Boolean(response.data["isPublicDashboard"]);

        setIsPublicDashboard(isPublic);

        /*
         * Whether visitors sign in first, by the rule the server enforces
         * (DashboardAccess), and who has - asked of the server every load,
         * never kept in the browser.
         */
        const requireSignIn: boolean = Boolean(response.data["requireSignIn"]);
        const signedInEmail: unknown = response.data["signedInAs"];

        PublicDashboardUtil.setRequiresSignIn(requireSignIn);
        setIsSignInRequired(requireSignIn);
        setSignedInAs(
          requireSignIn && typeof signedInEmail === "string" && signedInEmail
            ? signedInEmail
            : null,
        );

        /*
         * Whether visitors enter the password first, by the rule the server
         * enforces and the Sharing page writes (DashboardAccess).
         */
        PublicDashboardUtil.setRequiresMasterPassword(
          isDashboardMasterPasswordRequired({
            isPublicDashboard: isPublic,
            enableMasterPassword: enableMasterPassword,
          }),
        );
      }

      setIsLoading(false);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  }, []);

  if (isLoading) {
    return <PageSkeleton />;
  }

  /*
   * On the page's own ground (the body's), so it is the darkest tone on the
   * dark page, as the dashboard is.
   */
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <ErrorMessage message={error} />
      </div>
    );
  }

  // The dashboard's IP allowlist does not let this visitor in.
  if (isForbidden) {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <ForbiddenPage />
      </Suspense>
    );
  }

  // If dashboard is not public, show 404
  if (!isPublicDashboard) {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <NotFoundPage />
      </Suspense>
    );
  }

  // Check if master password is required and not validated
  if (
    dashboardId &&
    PublicDashboardUtil.requiresMasterPassword() &&
    !PublicDashboardUtil.isMasterPasswordValidated() &&
    !Navigation.getCurrentRoute().toString().includes("master-password")
  ) {
    PublicDashboardUtil.navigateToMasterPasswordPage();
    return <AuthPageSkeleton fields={1} />;
  }

  /*
   * A dashboard that asks its visitors to sign in (#10250): until one of its
   * private users has, every page but the sign-in pages sends them to Sign
   * In - the server answers nothing of the dashboard before - and once they
   * have, Sign In and Forgot password send them on to the dashboard. A
   * reset link's page stays: somebody signed in may still choose a password.
   */
  const currentPath: string = Navigation.getCurrentPath().toString();

  if (
    dashboardId &&
    isSignInRequired &&
    !signedInAs &&
    !PublicDashboardUtil.isAuthPath(currentPath)
  ) {
    PublicDashboardUtil.navigateToSignInPage();
    return <AuthPageSkeleton fields={2} />;
  }

  if (
    dashboardId &&
    isSignInRequired &&
    signedInAs &&
    (currentPath.endsWith(PUBLIC_DASHBOARD_SIGN_IN_PATH) ||
      currentPath.endsWith(PUBLIC_DASHBOARD_FORGOT_PASSWORD_PATH))
  ) {
    PublicDashboardUtil.navigateAfterSignIn();
    return <PageSkeleton />;
  }

  // Who is signed in, for the dashboard's Sign Out.
  const signedIn: DashboardSignedInVisitor | null =
    dashboardId && isSignInRequired && signedInAs
      ? {
          email: signedInAs,
          onSignOut: async (): Promise<void> => {
            await PublicDashboardSignIn.signOut(dashboardId);
            Navigation.navigate(
              new Route(
                PublicDashboardUtil.withLinkTheme(
                  PublicDashboardUtil.getPagePath(
                    PUBLIC_DASHBOARD_SIGN_IN_PATH,
                  ),
                ),
              ),
              { forceNavigate: true },
            );
          },
        }
      : null;

  const signInPage: JSX.Element = (
    <SignInPage dashboardName={dashboardName} initialError={signInError} />
  );

  const forgotPasswordPage: JSX.Element = (
    <ForgotPasswordPage dashboardName={dashboardName} />
  );

  const resetPasswordPage: JSX.Element = (
    <ResetPasswordPage dashboardName={dashboardName} />
  );

  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        {/* Live routes (custom domain) */}
        <PageRoute
          path={RouteMap[PageMap.OVERVIEW]?.toString() || ""}
          element={
            dashboardId ? (
              <DashboardViewPage
                dashboardId={dashboardId}
                signedIn={signedIn}
              />
            ) : (
              <NotFoundPage />
            )
          }
        />

        <PageRoute
          path={RouteMap[PageMap.SIGN_IN]?.toString() || ""}
          element={signInPage}
        />

        <PageRoute
          path={RouteMap[PageMap.FORGOT_PASSWORD]?.toString() || ""}
          element={forgotPasswordPage}
        />

        <PageRoute
          path={RouteMap[PageMap.RESET_PASSWORD]?.toString() || ""}
          element={resetPasswordPage}
        />

        <PageRoute
          path={RouteMap[PageMap.MASTER_PASSWORD]?.toString() || ""}
          element={<MasterPassword dashboardName={dashboardName} />}
        />

        <PageRoute
          path={RouteMap[PageMap.FORBIDDEN]?.toString() || ""}
          element={<ForbiddenPage />}
        />

        {/* Preview routes (via /public-dashboard/:dashboardId) */}
        <PageRoute
          path={RouteMap[PageMap.PREVIEW_OVERVIEW]?.toString() || ""}
          element={
            dashboardId ? (
              <DashboardViewPage
                dashboardId={dashboardId}
                signedIn={signedIn}
              />
            ) : (
              <NotFoundPage />
            )
          }
        />

        <PageRoute
          path={RouteMap[PageMap.PREVIEW_SIGN_IN]?.toString() || ""}
          element={signInPage}
        />

        <PageRoute
          path={RouteMap[PageMap.PREVIEW_FORGOT_PASSWORD]?.toString() || ""}
          element={forgotPasswordPage}
        />

        <PageRoute
          path={RouteMap[PageMap.PREVIEW_RESET_PASSWORD]?.toString() || ""}
          element={resetPasswordPage}
        />

        <PageRoute
          path={RouteMap[PageMap.PREVIEW_MASTER_PASSWORD]?.toString() || ""}
          element={<MasterPassword dashboardName={dashboardName} />}
        />

        <PageRoute
          path={RouteMap[PageMap.PREVIEW_FORBIDDEN]?.toString() || ""}
          element={<ForbiddenPage />}
        />

        {/* Catch-all */}
        <PageRoute path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
};

export default App;
