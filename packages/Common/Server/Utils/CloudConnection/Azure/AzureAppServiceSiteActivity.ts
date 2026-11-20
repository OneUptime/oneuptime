import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  APP_SERVICE_SITE_API_VERSION,
  AppServiceSiteActivity,
  AppServiceSiteActivityPart,
  AppServiceSiteReadError,
  readAppServiceDeployments,
  readAppServiceImage,
  readAppServiceInstances,
} from "../../../../Types/Cloud/AppServiceSiteActivity";
import {
  ParsedAzureResourceId,
  parseAzureResourceId,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import CloudConnectionService from "../../../Services/CloudConnectionService";
import CloudResourceService from "../../../Services/CloudResourceService";
import DataSourceHttpFetch from "../../DataSource/HttpFetch";
import { buildQueryString } from "../../LlmObservability/LlmProviderHttp";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  CloudConnectionSettings,
  CloudConnectorCallOptions,
  CloudConnectorTransport,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";
import CloudLiveReadRateLimit from "../LiveRead/CloudLiveReadRateLimit";
import AzureArm from "./AzureArm";
import AzureCloudConnector from "./AzureCloudConnector";

/*
 * AN APP SERVICE APP'S INSTANCES AND DEPLOYMENTS, ASKED OF AZURE (#10294).
 *
 * An App Platforms app names its instances and its revision only through
 * the telemetry it sends; Azure knows both for every App Service app. When
 * an app's page shows a site its connection reads, it asks Resource
 * Manager - signed in as the connection's app, whose Monitoring Reader role
 * may read them (AppServiceSiteActivity names the three calls) - and shows
 * what Azure says beside what the telemetry says.
 *
 * Asked by a page, not by the connection's scheduled reads, so they cost a
 * subscription nothing while nobody looks: three GETs a view, kept for a
 * minute (ACTIVITY_CACHE_MS) and counted against the connection's live
 * reads (CloudLiveReadRateLimit, which OneUptime AI's reads share), so a
 * page left open, or many people on one app, never floods Azure. Each part
 * that cannot be read says why on its own (AppServiceSiteReadError) and
 * the others are still shown. Nothing it reads is stored.
 *
 * For whoever may read the site: the row is read with the caller's own
 * permissions, and its connection, as the server, only to sign in.
 */

// How long one read of a site is answered again.
export const APP_SERVICE_ACTIVITY_CACHE_MS: number = 60 * 1000;
// The most calls one read makes: three, and their next pages.
export const APP_SERVICE_ACTIVITY_MAX_REQUESTS: number = 10;
export const APP_SERVICE_ACTIVITY_MAX_DURATION_MS: number = 20 * 1000;
const REQUEST_TIMEOUT_MS: number = 15 * 1000;
// The most sites whose reads are kept at once.
const MAX_CACHED_SITES: number = 500;

const SITE_TYPE: string = "microsoft.web/sites";

export interface AppServiceSiteActivityDependencies {
  transport?: CloudConnectorTransport | undefined;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  // Whether the per-connection limit is taken: tests turn it off.
  isRateLimited?: boolean | undefined;
}

// What a failed call was, as the page says it.
export function getAppServiceSiteReadError(
  error: unknown,
): AppServiceSiteReadError {
  if (error instanceof CloudReadBudgetSpent) {
    return AppServiceSiteReadError.Busy;
  }

  if (error instanceof LlmProviderError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return AppServiceSiteReadError.NoAccess;
    }

    if (error.statusCode === 404) {
      return AppServiceSiteReadError.NotFound;
    }

    if (error.statusCode === 429) {
      return AppServiceSiteReadError.Busy;
    }
  }

  return AppServiceSiteReadError.Failed;
}

// One part of the read: what it answered, or why it could not.
async function readPart<T>(
  read: () => Promise<Array<T>>,
): Promise<AppServiceSiteActivityPart<T>> {
  try {
    return { items: await read() };
  } catch (error) {
    return { items: null, error: getAppServiceSiteReadError(error) };
  }
}

export default class AzureAppServiceSiteActivity {
  private static cache: Map<
    string,
    { readAtMs: number; activity: AppServiceSiteActivity }
  > = new Map();

  // Forget every read kept: tests start each from nothing.
  public static clearCache(): void {
    AzureAppServiceSiteActivity.cache.clear();
  }

  /*
   * The site's instances, deployments and image, as Azure says them now -
   * or as it said them in the last minute.
   */
  public static async read(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    props: DatabaseCommonInteractionProps;
    dependencies?: AppServiceSiteActivityDependencies | undefined;
  }): Promise<AppServiceSiteActivity> {
    const dependencies: AppServiceSiteActivityDependencies =
      data.dependencies || {};
    const now: Date = dependencies.now ? dependencies.now() : new Date();

    // Read with the caller's own permissions: whoever may read the site.
    const site: CloudResource | null = await CloudResourceService.findOneBy({
      query: { _id: data.cloudResourceId, projectId: data.projectId },
      select: {
        _id: true,
        cloudProvider: true,
        cloudResourceType: true,
        providerResourceId: true,
        cloudConnectionId: true,
      },
      props: data.props,
    });

    if (!site) {
      throw new BadDataException(
        "This cloud resource was not found in the project.",
      );
    }

    const siteId: string = (site.providerResourceId || "").trim();
    const parsed: ParsedAzureResourceId | null = siteId
      ? parseAzureResourceId(siteId)
      : null;

    if (
      String(site.cloudProvider || "").toLowerCase() !== CloudProvider.Azure ||
      !parsed ||
      parsed.type.toLowerCase() !== SITE_TYPE
    ) {
      throw new BadDataException(
        "Only an Azure App Service app has instances and deployments to read.",
      );
    }

    const cacheKey: string = `${data.projectId.toString()}:${site.id!.toString()}`;
    const cached:
      | { readAtMs: number; activity: AppServiceSiteActivity }
      | undefined = AzureAppServiceSiteActivity.cache.get(cacheKey);

    if (
      cached &&
      now.getTime() - cached.readAtMs < APP_SERVICE_ACTIVITY_CACHE_MS
    ) {
      return cached.activity;
    }

    const connection: CloudConnection | null = site.cloudConnectionId
      ? await CloudConnectionService.findOneBy({
          query: { _id: site.cloudConnectionId, projectId: data.projectId },
          select: {
            _id: true,
            projectId: true,
            provider: true,
            config: true,
            secrets: true,
            isEnabled: true,
          },
          props: { isRoot: true },
        })
      : null;

    if (!connection || connection.provider !== CloudProvider.Azure) {
      throw new BadDataException(
        "No cloud connection reads this App Service app, so OneUptime cannot ask Azure for its instances and deployments. Connect its subscription under Cloud > Connect.",
      );
    }

    if (!connection.isEnabled) {
      throw new BadDataException(
        "This App Service app's cloud connection is turned off. Turn it on under Cloud > Connect, and its instances and deployments can be read.",
      );
    }

    if (
      dependencies.isRateLimited !== false &&
      !(await CloudLiveReadRateLimit.take({
        cloudAccountId: `app-service-activity:${connection.id!.toString()}`,
        now,
      }))
    ) {
      throw new BadDataException(
        "Azure was asked about this connection's App Service apps many times in the last minute. Try again in a minute.",
      );
    }

    const settings: CloudConnectionSettings =
      await CloudConnectionService.getConnectorSettings(connection);
    const options: CloudConnectorCallOptions = {
      transport:
        dependencies.transport ||
        DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
      now: dependencies.now,
      sleep: dependencies.sleep,
      requestTimeoutInMs: REQUEST_TIMEOUT_MS,
    };
    const arm: AzureArm = new AzureCloudConnector().arm(
      settings,
      options,
      new CloudReadBudget({
        maxRequests: APP_SERVICE_ACTIVITY_MAX_REQUESTS,
        maxDurationMs: APP_SERVICE_ACTIVITY_MAX_DURATION_MS,
      }),
    );

    const activity: AppServiceSiteActivity =
      await AzureAppServiceSiteActivity.readSite({ arm, siteId, now });

    AzureAppServiceSiteActivity.keep(cacheKey, {
      readAtMs: now.getTime(),
      activity,
    });

    return activity;
  }

  // The three calls of one site, each failing on its own.
  public static async readSite(data: {
    arm: AzureArm;
    siteId: string;
    now: Date;
  }): Promise<AppServiceSiteActivity> {
    const url: (path: string) => string = (path: string): string => {
      return `${data.arm.getManagementBaseUrl()}${data.siteId}${path}?${buildQueryString(
        [["api-version", APP_SERVICE_SITE_API_VERSION]],
      )}`;
    };

    const [instances, deployments, config] = await Promise.all([
      readPart(async () => {
        return readAppServiceInstances(
          (
            await data.arm.listAll(
              url("/instances"),
              "App Service instances request",
            )
          ).items,
        );
      }),
      readPart(async () => {
        return readAppServiceDeployments(
          (
            await data.arm.listAll(
              url("/deployments"),
              "App Service deployments request",
            )
          ).items,
        );
      }),
      readPart(async (): Promise<Array<JSONObject>> => {
        return [
          await data.arm.getJson(
            url("/config/web"),
            "App Service configuration request",
          ),
        ];
      }),
    ]);

    return {
      readAt: data.now.toISOString(),
      instances,
      deployments,
      image: config.items ? readAppServiceImage(config.items[0]) : null,
    };
  }

  private static keep(
    key: string,
    entry: { readAtMs: number; activity: AppServiceSiteActivity },
  ): void {
    const cache: Map<
      string,
      { readAtMs: number; activity: AppServiceSiteActivity }
    > = AzureAppServiceSiteActivity.cache;

    cache.delete(key);
    cache.set(key, entry);

    // The oldest go first once there are too many.
    while (cache.size > MAX_CACHED_SITES) {
      const oldest: string | undefined = cache.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      cache.delete(oldest);
    }
  }
}
