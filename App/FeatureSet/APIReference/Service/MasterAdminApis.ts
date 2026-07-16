import {
  Host,
  HttpProtocol,
  IsBillingEnabled,
} from "Common/Server/EnvironmentConfig";
import { ViewsPath } from "../Utils/Config";
import ResourceUtil, { ModelDocumentation } from "../Utils/Resources";
import DataTypeUtil, { DataTypeDocumentation } from "../Utils/DataTypes";
import { buildRenderContext } from "../Utils/RenderContext";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";

const Resources: Array<ModelDocumentation> = ResourceUtil.getResources();
const DataTypes: Array<DataTypeDocumentation> = DataTypeUtil.getDataTypes();

export interface MasterAdminApiDocumentation {
  // Path relative to the /api/admin/health mount point.
  path: string;
  /*
   * Suffix of the `pages.masterAdminApis.<endpoint>Desc` translation key that
   * describes this endpoint.
   */
  key: string;
  /*
   * True when the handler throws PaymentRequiredException unless
   * IS_ENTERPRISE_EDITION is set. /migrations and /support-bundle are
   * deliberately available on every edition so Community operators can debug an
   * upgrade and raise a support request.
   */
  isEnterpriseEdition: boolean;
}

/*
 * The master-admin health endpoints that accept the instance master API key —
 * i.e. every route in App/API/AdminHealth.ts guarded by
 * MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware.
 *
 * The read/write query console routes (POST /query/postgres, /query/clickhouse,
 * /query/redis) are deliberately absent: they stay on the JWT-only middleware so
 * a leaked static key cannot execute arbitrary queries headlessly.
 */
const MasterAdminApis: Array<MasterAdminApiDocumentation> = [
  { path: "/overview", key: "overview", isEnterpriseEdition: true },
  { path: "/queues", key: "queues", isEnterpriseEdition: true },
  {
    path: "/queues/{queueName}/failed-jobs",
    key: "failedJobs",
    isEnterpriseEdition: true,
  },
  {
    path: "/clickhouse-capacity",
    key: "clickhouseCapacity",
    isEnterpriseEdition: true,
  },
  {
    path: "/clickhouse-cluster",
    key: "clickhouseCluster",
    isEnterpriseEdition: true,
  },
  {
    path: "/clickhouse-telemetry-ingestion",
    key: "clickhouseTelemetryIngestion",
    isEnterpriseEdition: true,
  },
  {
    path: "/postgres-cluster",
    key: "postgresCluster",
    isEnterpriseEdition: true,
  },
  { path: "/redis", key: "redis", isEnterpriseEdition: true },
  {
    path: "/instance-health-logs",
    key: "instanceHealthLogs",
    isEnterpriseEdition: true,
  },
  { path: "/logs", key: "logs", isEnterpriseEdition: true },
  { path: "/migrations", key: "migrations", isEnterpriseEdition: false },
  { path: "/support-bundle", key: "supportBundle", isEnterpriseEdition: false },
];

export default class ServiceHandler {
  public static async executeResponse(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const ctx: ReturnType<typeof buildRenderContext> = buildRenderContext(req);

    const pageData: Dictionary<unknown> = {
      hostUrl: new URL(HttpProtocol, Host).toString(),
      basePath: "/api/admin/health",
      endpoints: MasterAdminApis,
    };

    res.status(200);

    return res.render(`${ViewsPath}/pages/index`, {
      page: "master-admin-apis",
      resources: Resources,
      dataTypes: DataTypes,
      pageTitle: ctx.t("pages.masterAdminApis.metaTitle"),
      enableGoogleTagManager: IsBillingEnabled,
      pageDescription: ctx.t("pages.masterAdminApis.metaDescription"),
      pageData: pageData,
      lang: ctx.lang,
      t: ctx.t,
      supportedLanguages: ctx.supportedLanguages,
      currentPath: ctx.currentPath,
      showMasterAdminApis: ctx.showMasterAdminApis,
    });
  }
}
