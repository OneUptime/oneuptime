import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import {
  IsBillingEnabled,
  getFrontendEnvVars,
} from "Common/Server/EnvironmentConfig";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressStatic,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import JSONWebTokenData from "Common/Types/JsonWebTokenData";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import applyStatusPageContentSecurityPolicy from "Common/Server/Utils/StatusPageContentSecurityPolicy";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
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
import { handlePublicDashboardLlmsTxt } from "./Utils/PublicDashboard";
import DashboardDomainService from "Common/Server/Services/DashboardDomainService";
import DashboardDomain from "Common/Models/DatabaseModels/DashboardDomain";

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

/*
 * Ingest and internal service prefixes. These must never be answered with
 * SPA HTML, on ANY host, which is why both fallbacks below spread this in
 * rather than keeping two hand-synced copies.
 *
 * Why the reservation is needed at all: App/Index.ts runs
 * FrontendRoutes.init() BEFORE the Docs/Workers/Telemetry/Workflow/Runbook
 * feature sets, and several of those mount their routers on "/" as well as
 * on a named prefix. Express matches in registration order, so the two
 * app.get("*") fallbacks below are already registered by the time those
 * routers mount, and every GET they would have answered comes back as the
 * SPA's index page at HTTP 200 instead. That failure is silent - the caller
 * gets a valid-looking page rather than an error - which is how #2986 (the
 * heartbeat GET) survived to a release.
 *
 * Why BOTH lists and not just the dashboard one: the custom-domain fallback
 * fires whenever the Host is not a primary host, and cluster-internal
 * service-to-service traffic is addressed by Kubernetes service name, so it
 * lands there too. KEDA polling
 * http://<release>-telemetry-writer:<port>/metrics/telemetry-writer-shed-rate
 * is exactly that shape - a non-primary Host on an ingest-only path - and
 * the dashboard list alone would not have covered it.
 *
 * Reserving costs nothing: a prefix with no matching route falls through to
 * the 404 handler in StartServer.addDefaultRoutes, so the worst case is an
 * honest 404 rather than a misleading 200.
 *
 * App/Tests/FeatureSet/RootMountedRouteReservation.test.ts derives the
 * required set from the mounts themselves and fails when a newly
 * root-mounted GET route is not covered here.
 */
const IngestRoutePrefixesToSkip: Array<string> = [
  "/telemetry",
  "/otlp",
  "/opentelemetry.proto.collector",
  /*
   * Session replay ingest is mounted on both "/telemetry" and "/", so
   * without this entry a root-level /session-replay/v1/chunk would be
   * answered with SPA HTML instead of reaching the ingest router.
   */
  "/session-replay",
  /*
   * Queue-depth and shed-rate endpoints polled by the KEDA metrics-api
   * scaler (HelmChart/.../keda-scaledobjects.yaml). The worker and api tiers
   * only kept working because App/Index.ts mounts AppMetricsAPI on "/"
   * BEFORE the feature sets; telemetry-writer's shed-rate route has no such
   * head start and is registered by the Telemetry feature set.
   */
  "/metrics",
  "/probe-ingest",
  "/ingestor",
  /*
   * ProbeIngest's routers are mounted on "/" as well as "/probe-ingest" and
   * "/ingestor", so their own route prefixes are reachable at the root too.
   */
  "/probe",
  "/monitor",
  /*
   * Both spellings are needed: the predicate matches a prefix exactly or
   * followed by "/", so "/server-monitor" does NOT cover
   * "/server-monitor-ingest/...".
   */
  "/server-monitor-ingest",
  "/server-monitor",
  "/incoming-request-ingest",
  "/incoming-request",
  /*
   * Nginx rewrites /heartbeat/<key> to the /incoming-request route above, so
   * the App normally never sees this prefix - it is reserved for the case
   * where a request reaches the App without passing through that rewrite.
   */
  "/heartbeat",
  "/incoming-email",
  "/worker",
];

const DashboardFallbackRoutePrefixesToSkip: Array<string> = [
  "/status-page",
  "/status-page-api",
  "/status-page-sso-api",
  "/status-page-oidc-api",
  "/status-page-identity-api",
  "/public-dashboard",
  "/public-dashboard-api",
  "/api",
  "/identity",
  "/notification",
  ...IngestRoutePrefixesToSkip,
  "/realtime",
  "/workflow",
  "/workers",
  "/mcp",
  "/analytics-api",
  "/file",
  "/docs",
  "/reference",
  /*
   * The vendored browser libraries (Common/Server/Utils/VendorAssets.ts).
   * That mount terminates its own prefix with a 404, so this is belt and
   * braces - but a stylesheet answered with the dashboard's index page at
   * HTTP 200 is a failure nothing logs, and this list is where that class of
   * mistake is meant to be caught.
   */
  "/oneuptime-assets",
  "/.well-known",
  "/l",
  "/manifest.json",
  "/service-worker.js",
  "/sw.js",
  "/browserconfig.xml",
  "/rss",
  "/llms.txt",
];

const StatusPageDomainFallbackRoutePrefixesToSkip: Array<string> = [
  "/status-page-api",
  "/status-page-sso-api",
  "/status-page-oidc-api",
  "/status-page-identity-api",
  "/public-dashboard-api",
  /*
   * Ingest is reserved here as well as on the dashboard list, deliberately.
   * "Not a primary host" covers two very different callers: a customer's
   * status-page custom domain, and any cluster-internal client addressing a
   * pod by its Kubernetes service name. The second is why this matters - see
   * the KEDA note on IngestRoutePrefixesToSkip.
   *
   * The cost to the first caller is nil: none of these prefixes is a
   * StatusPage or PublicDashboard client route (their root-level routes are
   * /incidents, /announcements, /scheduled-events, /subscribe, /login and
   * friends), so no status page deep link is shadowed by this.
   */
  ...IngestRoutePrefixesToSkip,
  /* Same reservation as the dashboard list above. */
  "/oneuptime-assets",
  "/.well-known",
  "/rss",
  "/llms.txt",
];

const StatusPageFrontendConfig: FrontendConfig = {
  routePrefix: "/status-page",
  publicPath: StatusPagePublicPath,
  indexViewPath: StatusPageViewPath,
  getVariablesToRenderIndexPage: async (
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<JSONObject> => {
    applyStatusPageContentSecurityPolicy(req, res);

    const statusPageData: StatusPageData | null = await getStatusPageData(req);

    /*
     * RSS feed path for the autodiscovery <link> tag. Status pages are
     * hosted either on a custom domain (feed at /rss) or on a subpath
     * at /status-page/:statusPageId (feed at /status-page/:statusPageId/rss).
     */
    const isPreviewPage: boolean = req.path.includes("/status-page/");
    const previewStatusPageId: string = isPreviewPage
      ? req.path.split("/status-page/")[1]?.split("/")[0] || ""
      : "";
    const rssFeedPath: string =
      isPreviewPage && previewStatusPageId
        ? `/status-page/${previewStatusPageId}/rss`
        : "/rss";

    if (statusPageData) {
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
      };
    }

    return {
      title: "Status Page",
      description:
        "Status Page lets you see real-time information about the status of our services.",
      faviconUrl:
        "/status-page-api/favicon/" + ObjectID.getZeroObjectID().toString(),
      rssFeedPath: rssFeedPath,
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

const shouldSkipDashboardFallbackRoute: (path: string) => boolean = (
  path: string,
): boolean => {
  return DashboardFallbackRoutePrefixesToSkip.some((prefix: string) => {
    if (path === prefix) {
      return true;
    }

    return path.startsWith(`${prefix}/`);
  });
};

const shouldSkipStatusPageDomainFallbackRoute: (path: string) => boolean = (
  path: string,
): boolean => {
  return StatusPageDomainFallbackRoutePrefixesToSkip.some((prefix: string) => {
    if (path === prefix) {
      return true;
    }

    return path.startsWith(`${prefix}/`);
  });
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
    const env: JSONObject = getFrontendEnvVars();

    const script: string = `
if(!window.process){
  window.process = {}
}

if(!window.process.env){
  window.process.env = {}
}
window.process.env = ${JSON.stringify(env)};
`;

    Response.sendJavaScriptResponse(req, res, script);
  } catch (err) {
    next(err);
  }
};

const renderFrontendIndexPage: (
  options: RenderFrontendOptions,
) => Promise<void> = async (options: RenderFrontendOptions): Promise<void> => {
  const { req, res, next, frontendConfig } = options;

  try {
    let variables: JSONObject = {};

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
      enableGoogleTagManager: IsBillingEnabled || false,
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
  try {
    const accessToken: string | undefined =
      UserMiddleware.getAccessTokenFromExpressRequest(req);

    if (!accessToken) {
      Response.sendErrorResponse(
        req,
        res,
        new NotAuthorizedException(
          "Unauthorized: Only master admins can access the admin dashboard.",
        ),
      );
      return {};
    }

    const authData: JSONWebTokenData = JSONWebToken.decode(accessToken);

    if (!authData.isMasterAdmin) {
      Response.sendErrorResponse(
        req,
        res,
        new NotAuthorizedException(
          "Unauthorized: Only master admins can access the admin dashboard.",
        ),
      );
      return {};
    }

    return {};
  } catch (error) {
    logger.error(error, { service: "frontend" });
    Response.sendErrorResponse(
      req,
      res,
      new NotAuthorizedException(
        "Unauthorized: Only master admins can access the admin dashboard.",
      ),
    );
    return {};
  }
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
