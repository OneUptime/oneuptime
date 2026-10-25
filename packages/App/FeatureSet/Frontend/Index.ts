import {
  GoogleTagManagerEnabled,
  IsBillingEnabled,
} from "Common/Server/EnvironmentConfig";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressStatic,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import { ensureMasterAdminPageAccess } from "Common/Server/Utils/MasterAdminPageAccess";
import logger from "Common/Server/Utils/Logger";
import applyStatusPageContentSecurityPolicy from "Common/Server/Utils/StatusPageContentSecurityPolicy";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  handleRSS,
  handleLlmsTxt,
  StatusPageData,
  getStatusPageData,
} from "./Utils/StatusPage";
import applyStatusPageRobotsHeader from "Common/Server/Utils/StatusPageSearchEngineIndexing";
import applyPublicPageNotFound, {
  PUBLIC_PAGE_NOT_FOUND,
  PublicPageNotFound,
} from "Common/Server/Utils/PublicPageNotFound";
import {
  isSearchEngineIndexingAllowed,
  isStatusPagePreviewPath,
} from "Common/Types/StatusPage/SearchEngineIndexing";
import {
  getStatusPageThemeHead,
  STATUS_PAGE_THEME_FALLBACK,
} from "Common/Types/StatusPage/StatusPageTheme";
import {
  getPublicDashboardData,
  handlePublicDashboardLlmsTxt,
  PublicDashboardData,
} from "./Utils/PublicDashboard";
import { getDashboardThemeHead } from "Common/Types/Dashboard/DashboardTheme";
import DashboardDomainService from "Common/Server/Services/DashboardDomainService";
import DashboardDomain from "Common/Models/DatabaseModels/DashboardDomain";
import {
  getFrontendStaticFileRoutes,
  shouldSkipDashboardFallbackRoute,
  shouldSkipStatusPageDomainFallbackRoute,
} from "./RouteReservations";
import { sendFrontendEnvironmentResponse } from "Common/Server/Utils/FrontendEnvironment";
import { getProductBrandingViewVariables } from "Common/Server/Utils/ProductBrandingViewVariables";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import { getBrandedDashboardManifest } from "./BrandedManifest";
import StatusPageMaintenanceCalendarFeed from "Common/Server/Utils/StatusPage/StatusPageMaintenanceCalendarFeed";
import fsp from "fs/promises";

const app: ExpressApplication = Express.getExpressApp();

const AccountsPublicPath: string = "/usr/src/app/FeatureSet/Accounts/public";
const AccountsViewPath: string =
  "/usr/src/app/FeatureSet/Accounts/views/index.ejs";

const DashboardPublicPath: string = "/usr/src/app/FeatureSet/Dashboard/public";
const DashboardViewPath: string =
  "/usr/src/app/FeatureSet/Dashboard/views/index.ejs";

const AdminPublicPath: string = "/usr/src/app/FeatureSet/AdminDashboard/public";
const AdminViewPath: string =
  "/usr/src/app/FeatureSet/AdminDashboard/views/index.ejs";

const StatusPagePublicPath: string =
  "/usr/src/app/FeatureSet/StatusPage/public";
const StatusPageViewPath: string =
  "/usr/src/app/FeatureSet/StatusPage/views/index.ejs";

const PublicDashboardPublicPath: string =
  "/usr/src/app/FeatureSet/PublicDashboard/public";
const PublicDashboardViewPath: string =
  "/usr/src/app/FeatureSet/PublicDashboard/views/index.ejs";

interface FrontendConfig {
  routePrefix: string;
  publicPath: string;
  indexViewPath: string;
  primaryHostOnly?: boolean;
  getVariablesToRenderIndexPage?: (
    req: ExpressRequest,
    res: ExpressResponse,
  ) => Promise<JSONObject>;
}

interface RenderFrontendOptions {
  req: ExpressRequest;
  res: ExpressResponse;
  next: NextFunction;
  frontendConfig: FrontendConfig;
}

const StatusPageFrontendConfig: FrontendConfig = {
  routePrefix: "/status-page",
  publicPath: StatusPagePublicPath,
  indexViewPath: StatusPageViewPath,
  getVariablesToRenderIndexPage: async (
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<JSONObject> => {
    applyStatusPageContentSecurityPolicy(req, res);

    const statusPageData: StatusPageData | PublicPageNotFound | null =
      await getStatusPageData(req);

    /*
     * RSS feed path for the autodiscovery <link> tag. Status pages are
     * hosted either on a custom domain (feed at /rss) or on a subpath
     * at /status-page/:statusPageId (feed at /status-page/:statusPageId/rss).
     */
    const isPreviewPage: boolean = isStatusPagePreviewPath(req.path);
    const previewStatusPageId: string = isPreviewPage
      ? req.path.split("/status-page/")[1]?.split("/")[0] || ""
      : "";
    const rssFeedPath: string =
      isPreviewPage && previewStatusPageId
        ? `/status-page/${previewStatusPageId}/rss`
        : "/rss";

    if (statusPageData === PUBLIC_PAGE_NOT_FOUND) {
      /*
       * There is no such page: none was made, it is archived, or a master
       * admin blocked its project. The app still loads and says so, from the
       * placeholder below, which carries nothing of the page - but as a 404
       * kept out of search results, so search engines drop the URL rather
       * than keep what it served before (PublicPageNotFound).
       */
      applyPublicPageNotFound(res);
    } else if (statusPageData) {
      /*
       * Belt and braces with the <meta name="robots"> the template renders
       * from isSearchEngineIndexingEnabled below: the header is honoured even
       * if a crawler gives up on the HTML.
       */
      applyStatusPageRobotsHeader(
        res,
        statusPageData.isSearchEngineIndexingEnabled,
      );

      return {
        title: statusPageData.title,
        description: statusPageData.description,
        faviconUrl: statusPageData.faviconUrl,
        rssFeedPath: rssFeedPath,
        isSearchEngineIndexingEnabled:
          statusPageData.isSearchEngineIndexingEnabled,
        // The page's theme, applied before its first paint.
        statusPageTheme: getStatusPageThemeHead(statusPageData.theme),
      };
    }

    /*
     * No page data: the page does not exist, the lookup failed, or the URL
     * named no page. A page that does not exist is never indexed, and a
     * preview URL is kept out of search results all the same; otherwise a
     * custom domain fails open, as it does whenever the owner's setting
     * cannot be read.
     */
    const isSearchEngineIndexingEnabled: boolean =
      statusPageData !== PUBLIC_PAGE_NOT_FOUND &&
      isSearchEngineIndexingAllowed({
        path: req.path,
        indexingFlag: undefined,
      });

    applyStatusPageRobotsHeader(res, isSearchEngineIndexingEnabled);

    return {
      title: "Status Page",
      description:
        "Status Page lets you see real-time information about the status of our services.",
      faviconUrl:
        "/status-page-api/favicon/" + ObjectID.getZeroObjectID().toString(),
      rssFeedPath: rssFeedPath,
      isSearchEngineIndexingEnabled: isSearchEngineIndexingEnabled,
      /*
       * No page to read a theme from: the light page every status page
       * starts from. The app reads the page's own theme once it loads.
       */
      statusPageTheme: getStatusPageThemeHead(STATUS_PAGE_THEME_FALLBACK),
    };
  },
};

const DashboardFrontendConfig: FrontendConfig = {
  routePrefix: "/dashboard",
  publicPath: DashboardPublicPath,
  indexViewPath: DashboardViewPath,
  primaryHostOnly: true,
};

const PublicDashboardFrontendConfig: FrontendConfig = {
  routePrefix: "/public-dashboard",
  publicPath: PublicDashboardPublicPath,
  indexViewPath: PublicDashboardViewPath,
  getVariablesToRenderIndexPage: async (
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<JSONObject> => {
    const dashboardData: PublicDashboardData | PublicPageNotFound | null =
      await getPublicDashboardData(req);

    if (dashboardData === PUBLIC_PAGE_NOT_FOUND) {
      /*
       * No dashboard answers on this link: none was made, it is archived or
       * shared only with its project, or a master admin blocked its project.
       * The app still loads and says so, from the placeholder below, as a
       * 404 kept out of search results (PublicPageNotFound).
       */
      applyPublicPageNotFound(res);

      return {
        title: "Dashboard",
        description: "View dashboard metrics and insights.",
        isSearchEngineIndexingEnabled: false,
        // No dashboard to read a theme from: the page follows the visitor.
        dashboardTheme: getDashboardThemeHead(null),
      };
    }

    if (dashboardData) {
      return {
        title: dashboardData.title,
        description: dashboardData.description,
        // The dashboard's theme, applied before its first paint.
        dashboardTheme: getDashboardThemeHead(dashboardData.theme),
      };
    }

    return {
      title: "Dashboard",
      description: "View dashboard metrics and insights.",
      /*
       * No dashboard to read a theme from: the page follows the visitor
       * until the app reads the dashboard's own.
       */
      dashboardTheme: getDashboardThemeHead(null),
    };
  },
};

const DashboardRootPwaFileMap: Array<{ route: string; file: string }> = [
  { route: "/manifest.json", file: "manifest.json" },
  { route: "/sw.js", file: "sw.js" },
  { route: "/service-worker.js", file: "sw.js" },
  { route: "/browserconfig.xml", file: "browserconfig.xml" },
];

const normalizeHostname: (host: string) => string = (host: string): string => {
  const hostParts: Array<string> = host.split(":");
  const hostPart: string | undefined = hostParts[0];

  if (!hostPart) {
    return "";
  }

  return hostPart.trim().toLowerCase();
};

const getPrimaryHosts: () => Set<string> = (): Set<string> => {
  const hostSet: Set<string> = new Set<string>();

  const hostCandidates: Array<string> = [
    process.env["HOST"] || "",
    "localhost",
    "ingress",
  ];

  for (const hostCandidate of hostCandidates) {
    const normalizedHost: string = normalizeHostname(hostCandidate);
    if (normalizedHost) {
      hostSet.add(normalizedHost);
    }
  }

  return hostSet;
};

const PrimaryHosts: Set<string> = getPrimaryHosts();

const getRequestHostname: (req: ExpressRequest) => string = (
  req: ExpressRequest,
): string => {
  if (req.hostname) {
    return normalizeHostname(req.hostname.toString());
  }

  const hostHeader: string | Array<string> | undefined = req.headers["host"];
  if (typeof hostHeader === "string") {
    return normalizeHostname(hostHeader);
  }

  if (Array.isArray(hostHeader)) {
    const firstHostHeader: string | undefined = hostHeader[0];
    if (!firstHostHeader) {
      return "";
    }

    return normalizeHostname(firstHostHeader);
  }

  return "";
};

const isPrimaryHostRequest: (req: ExpressRequest) => boolean = (
  req: ExpressRequest,
): boolean => {
  const requestHost: string = getRequestHostname(req);
  if (!requestHost) {
    return true;
  }

  return PrimaryHosts.has(requestHost);
};

const sendFrontendEnvScript: (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> = async (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> => {
  try {
    sendFrontendEnvironmentResponse(req, res);
  } catch (err) {
    next(err);
  }
};

const renderFrontendIndexPage: (
  options: RenderFrontendOptions,
) => Promise<void> = async (options: RenderFrontendOptions): Promise<void> => {
  const { req, res, next, frontendConfig } = options;

  try {
    // The installation's name and tab icon, for the page title and icons.
    let variables: JSONObject = getProductBrandingViewVariables();

    if (frontendConfig.getVariablesToRenderIndexPage) {
      try {
        const variablesToRenderIndexPage: JSONObject =
          await frontendConfig.getVariablesToRenderIndexPage(req, res);

        variables = {
          ...variables,
          ...variablesToRenderIndexPage,
        };
      } catch (err) {
        logger.error(err, { service: "frontend" });
      }
    }

    if (res.headersSent) {
      return;
    }

    res.render(frontendConfig.indexViewPath, {
      enableGoogleTagManager: GoogleTagManagerEnabled,
      ...variables,
    });
  } catch (err) {
    next(err);
  }
};

const ensureMasterAdminAccess: (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<JSONObject> = async (
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<JSONObject> => {
  return await ensureMasterAdminPageAccess({
    req,
    res,
    service: "frontend",
  });
};

const registerFrontendApp: (frontendConfig: FrontendConfig) => void = (
  frontendConfig: FrontendConfig,
): void => {
  const staticHandler: RequestHandler = ExpressStatic(
    frontendConfig.publicPath,
  ) as RequestHandler;

  app.use(
    frontendConfig.routePrefix,
    (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      if (frontendConfig.primaryHostOnly && !isPrimaryHostRequest(req)) {
        return next();
      }

      return staticHandler(req, res, next);
    },
  );

  app.get(
    `${frontendConfig.routePrefix}/env.js`,
    (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      if (frontendConfig.primaryHostOnly && !isPrimaryHostRequest(req)) {
        return next();
      }

      return sendFrontendEnvScript(req, res, next);
    },
  );

  /*
   * A bundle chunk or an asset the static files above do not have - one a
   * deploy removed - is a 404, not the frontend's page (see
   * getFrontendStaticFileRoutes). Never stored: during a rolling deploy one
   * server may not have a chunk the next one serves.
   */
  app.get(
    getFrontendStaticFileRoutes(frontendConfig.routePrefix),
    (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      if (frontendConfig.primaryHostOnly && !isPrimaryHostRequest(req)) {
        return next();
      }

      res.setHeader("Cache-Control", "no-store");
      res.status(404).type("text/plain").send("Not found");
    },
  );

  app.get(
    [frontendConfig.routePrefix, `${frontendConfig.routePrefix}/*`],
    async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      if (frontendConfig.primaryHostOnly && !isPrimaryHostRequest(req)) {
        return next();
      }

      return renderFrontendIndexPage({
        req,
        res,
        next,
        frontendConfig,
      });
    },
  );
};

const isDashboardDomain: (hostname: string) => Promise<boolean> = async (
  hostname: string,
): Promise<boolean> => {
  try {
    const dashboardDomain: DashboardDomain | null =
      await DashboardDomainService.findOneBy({
        query: {
          fullDomain: hostname,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    return dashboardDomain !== null;
  } catch (err) {
    logger.error("Error checking if domain is a dashboard domain:", {
      service: "frontend",
    });
    logger.error(err, { service: "frontend" });
    return false;
  }
};

const registerCustomDomainFallback: () => void = (): void => {
  app.get(
    "*",
    async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      if (isPrimaryHostRequest(req)) {
        return next();
      }

      if (shouldSkipStatusPageDomainFallbackRoute(req.path)) {
        return next();
      }

      /*
       * Check if this custom domain belongs to a PublicDashboard.
       * If so, serve the PublicDashboard SPA instead of StatusPage.
       */
      const requestHostname: string = getRequestHostname(req);

      if (requestHostname && (await isDashboardDomain(requestHostname))) {
        return renderFrontendIndexPage({
          req,
          res,
          next,
          frontendConfig: PublicDashboardFrontendConfig,
        });
      }

      // Default: serve StatusPage for custom domains
      return renderFrontendIndexPage({
        req,
        res,
        next,
        frontendConfig: StatusPageFrontendConfig,
      });
    },
  );
};

const registerDashboardFallbackForPrimaryHost: () => void = (): void => {
  app.get(
    "*",
    async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      if (IsBillingEnabled) {
        return next();
      }

      if (!isPrimaryHostRequest(req)) {
        return next();
      }

      if (shouldSkipDashboardFallbackRoute(req.path)) {
        return next();
      }

      return renderFrontendIndexPage({
        req,
        res,
        next,
        frontendConfig: DashboardFrontendConfig,
      });
    },
  );
};

/*
 * The Dashboard's web app manifest, for an installation that names or shows
 * itself its own way (BrandedManifest.ts): its name and icon, in place of
 * OneUptime's, when the Dashboard is installed as an app. Registered ahead of
 * the static files; an installation that shows OneUptime's own branding gets
 * the static file, exactly as before.
 */
const registerBrandedDashboardManifest: () => void = (): void => {
  app.get(
    ["/dashboard/manifest.json", "/manifest.json"],
    async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      try {
        if (!isPrimaryHostRequest(req)) {
          return next();
        }

        // The root copy is the Dashboard's only where the root serves the Dashboard.
        if (req.path === "/manifest.json" && IsBillingEnabled) {
          return next();
        }

        const branding: ProductBranding | null =
          EnterpriseEdition.getProductBranding();

        if (!branding) {
          return next();
        }

        const manifest: JSONObject = JSON.parse(
          await fsp.readFile(`${DashboardPublicPath}/manifest.json`, "utf8"),
        ) as JSONObject;

        const branded: JSONObject | null = getBrandedDashboardManifest(
          manifest,
          branding,
        );

        if (!branded) {
          return next();
        }

        res.set("Content-Type", "application/manifest+json; charset=utf-8");
        res.set("Cache-Control", "no-cache");
        res.send(JSON.stringify(branded));
      } catch (err) {
        logger.error(err, { service: "frontend" });
        next();
      }
    },
  );
};

const registerDashboardRootPwaFiles: () => void = (): void => {
  for (const pwaFileRoute of DashboardRootPwaFileMap) {
    app.get(
      pwaFileRoute.route,
      (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        if (IsBillingEnabled || !isPrimaryHostRequest(req)) {
          return next();
        }

        return res.sendFile(`${DashboardPublicPath}/${pwaFileRoute.file}`);
      },
    );
  }
};

const init: PromiseVoidFunction = async (): Promise<void> => {
  app.get("/rss", handleRSS);
  app.get("/status-page/:statusPageId/rss", handleRSS);

  /*
   * A status page's maintenance calendar, beside its RSS feed: on the page's
   * own domain and on its address under OneUptime, ?event=<id> for one
   * event as a file. Served in this process, with the request's own
   * cookies and address, so who may read it is decided exactly as for the
   * page (StatusPageMaintenanceCalendarFeed).
   */
  app.get(
    ["/maintenance.ics", "/status-page/:statusPageId/maintenance.ics"],
    StatusPageMaintenanceCalendarFeed.getRateLimitMiddleware(),
    StatusPageMaintenanceCalendarFeed.getHandler(),
  );

  /*
   * llms.txt routes (machine-readable entry point for AI agents). The root
   * route serves custom domains, which may belong to either a status page
   * or a public dashboard — dispatch on the domain type, same as the
   * custom-domain SPA fallback below.
   */
  app.get(
    "/llms.txt",
    async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
      const requestHostname: string = getRequestHostname(req);

      if (
        requestHostname &&
        !isPrimaryHostRequest(req) &&
        (await isDashboardDomain(requestHostname))
      ) {
        return handlePublicDashboardLlmsTxt(req, res);
      }

      return handleLlmsTxt(req, res);
    },
  );
  app.get("/status-page/:statusPageId/llms.txt", handleLlmsTxt);
  app.get(
    "/public-dashboard/:dashboardId/llms.txt",
    handlePublicDashboardLlmsTxt,
  );

  // Ahead of the Dashboard's static files and its root PWA files.
  registerBrandedDashboardManifest();

  registerFrontendApp({
    routePrefix: "/accounts",
    publicPath: AccountsPublicPath,
    indexViewPath: AccountsViewPath,
    primaryHostOnly: true,
  });

  registerFrontendApp(DashboardFrontendConfig);

  registerFrontendApp({
    routePrefix: "/admin",
    publicPath: AdminPublicPath,
    indexViewPath: AdminViewPath,
    primaryHostOnly: true,
    getVariablesToRenderIndexPage: ensureMasterAdminAccess,
  });

  registerFrontendApp(StatusPageFrontendConfig);

  registerFrontendApp(PublicDashboardFrontendConfig);

  registerDashboardRootPwaFiles();
  registerCustomDomainFallback();
  registerDashboardFallbackForPrimaryHost();
};

export default {
  init,
};
