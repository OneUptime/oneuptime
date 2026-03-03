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
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  handleRSS,
  StatusPageData,
  getStatusPageData,
} from "./Utils/StatusPage";

const app: ExpressApplication = Express.getExpressApp();

const AccountsPublicPath: string = "/usr/src/app/FeatureSet/Accounts/public";
const AccountsViewPath: string = "/usr/src/app/FeatureSet/Accounts/views/index.ejs";

const DashboardPublicPath: string = "/usr/src/app/FeatureSet/Dashboard/public";
const DashboardViewPath: string = "/usr/src/app/FeatureSet/Dashboard/views/index.ejs";

const AdminPublicPath: string = "/usr/src/app/FeatureSet/AdminDashboard/public";
const AdminViewPath: string = "/usr/src/app/FeatureSet/AdminDashboard/views/index.ejs";

const StatusPagePublicPath: string = "/usr/src/app/FeatureSet/StatusPage/public";
const StatusPageViewPath: string = "/usr/src/app/FeatureSet/StatusPage/views/index.ejs";

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

const DashboardFallbackRoutePrefixesToSkip: Array<string> = [
  "/status-page",
  "/status-page-api",
  "/status-page-sso-api",
  "/status-page-identity-api",
  "/api",
  "/identity",
  "/notification",
  "/telemetry",
  "/incoming-request-ingest",
  "/otlp",
  "/opentelemetry.proto.collector",
  "/probe-ingest",
  "/ingestor",
  "/server-monitor",
  "/realtime",
  "/workflow",
  "/workers",
  "/mcp",
  "/analytics-api",
  "/heartbeat",
  "/incoming-email",
  "/file",
  "/docs",
  "/reference",
  "/worker",
  "/.well-known",
  "/l",
  "/manifest.json",
  "/service-worker.js",
  "/sw.js",
  "/browserconfig.xml",
  "/rss",
];

const StatusPageDomainFallbackRoutePrefixesToSkip: Array<string> = [
  "/status-page-api",
  "/status-page-sso-api",
  "/status-page-identity-api",
  "/.well-known",
  "/rss",
];

const StatusPageFrontendConfig: FrontendConfig = {
  routePrefix: "/status-page",
  publicPath: StatusPagePublicPath,
  indexViewPath: StatusPageViewPath,
  getVariablesToRenderIndexPage: async (
    req: ExpressRequest,
    _res: ExpressResponse,
  ): Promise<JSONObject> => {
    const statusPageData: StatusPageData | null = await getStatusPageData(req);

    if (statusPageData) {
      return {
        title: statusPageData.title,
        description: statusPageData.description,
        faviconUrl: statusPageData.faviconUrl,
      };
    }

    return {
      title: "Status Page",
      description:
        "Status Page lets you see real-time information about the status of our services.",
      faviconUrl:
        "/status-page-api/favicon/" + ObjectID.getZeroObjectID().toString(),
    };
  },
};

const DashboardFrontendConfig: FrontendConfig = {
  routePrefix: "/dashboard",
  publicPath: DashboardPublicPath,
  indexViewPath: DashboardViewPath,
  primaryHostOnly: true,
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
        logger.error(err);
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
    logger.error(error);
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

const registerStatusPageCustomDomainFallback: () => void = (): void => {
  app.get(
    "*",
    async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      if (isPrimaryHostRequest(req)) {
        return next();
      }

      if (shouldSkipStatusPageDomainFallbackRoute(req.path)) {
        return next();
      }

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

  registerDashboardRootPwaFiles();
  registerStatusPageCustomDomainFallback();
  registerDashboardFallbackForPrimaryHost();
};

export default {
  init,
};
