import PageMap from "./Utils/PageMap";
import RouteMap from "./Utils/RouteMap";
import RouteParams from "./Utils/RouteParams";
import PublicDashboardUtil from "./Utils/PublicDashboard";
import { PUBLIC_DASHBOARD_API_URL } from "./Utils/Config";
import API from "./Utils/API";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
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

const App: () => JSX.Element = () => {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardId, setDashboardId] = useState<ObjectID | null>(null);
  const [dashboardName, setDashboardName] = useState<string>("Dashboard");
  const [isPublicDashboard, setIsPublicDashboard] = useState<boolean>(false);
  type GetIdFunction = () => Promise<ObjectID>;

  const getId: GetIdFunction = async (): Promise<ObjectID> => {
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

    if (response.data && response.data["dashboardId"]) {
      return new ObjectID(response.data["dashboardId"] as string);
    }

    throw new BadDataException("Dashboard not found for this domain");
  };

  useAsyncEffect(async () => {
    try {
      setIsLoading(true);

      const id: ObjectID = await getId();
      setDashboardId(id);
      PublicDashboardUtil.setDashboardId(id);

      // Fetch dashboard metadata
      const response: HTTPResponse<JSONObject> = await API.post<JSONObject>({
        url: URL.fromString(PUBLIC_DASHBOARD_API_URL.toString()).addRoute(
          `/metadata/${id.toString()}`,
        ),
        data: {},
        headers: {},
      });

      if (response.data) {
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
        const isPublic: boolean = Boolean(
          response.data["isPublicDashboard"],
        );

        setIsPublicDashboard(isPublic);

        if (isPublic && enableMasterPassword) {
          PublicDashboardUtil.setRequiresMasterPassword(true);
        } else {
          PublicDashboardUtil.setRequiresMasterPassword(false);
        }
      }

      setIsLoading(false);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    }
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <ErrorMessage message={error} />
      </div>
    );
  }

  // If dashboard is not public, show 404
  if (!isPublicDashboard) {
    return (
      <Suspense fallback={<PageLoader isVisible={true} />}>
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
    return <PageLoader isVisible={true} />;
  }

  return (
    <Suspense fallback={<PageLoader isVisible={true} />}>
      <Routes>
        {/* Live routes (custom domain) */}
        <PageRoute
          path={RouteMap[PageMap.OVERVIEW]?.toString() || ""}
          element={
            dashboardId ? (
              <DashboardViewPage dashboardId={dashboardId} />
            ) : (
              <NotFoundPage />
            )
          }
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
              <DashboardViewPage dashboardId={dashboardId} />
            ) : (
              <NotFoundPage />
            )
          }
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
