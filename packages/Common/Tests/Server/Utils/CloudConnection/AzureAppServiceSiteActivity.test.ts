import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import AzureAppServiceSiteActivity, {
  APP_SERVICE_ACTIVITY_CACHE_MS,
  getAppServiceSiteReadError,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureAppServiceSiteActivity";
import AzureCloudConnector from "../../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import {
  CloudConnectionSettings,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import CloudLiveReadRateLimit, {
  CLOUD_LIVE_READS_PER_MINUTE,
} from "../../../../Server/Utils/CloudConnection/LiveRead/CloudLiveReadRateLimit";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import {
  APP_SERVICE_SITE_API_VERSION,
  AppServiceDeploymentStatus,
  AppServiceInstanceState,
  AppServiceSiteActivity,
  AppServiceSiteReadError,
} from "../../../../Types/Cloud/AppServiceSiteActivity";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * AN APP SERVICE APP'S INSTANCES AND DEPLOYMENTS, ASKED OF AZURE (#10294).
 *
 * The app's page asks Resource Manager, through the site's connection, for
 * what its telemetry may not say: its instances, its deployments and the
 * image it runs. Against a fake Resource Manager that answers as Azure
 * does, these pin:
 *
 *   - the three GETs - the site's /instances, /deployments and
 *     /config/web, at one fixed api-version, on the management host, signed
 *     in as the connection's app - and never the app settings' list action;
 *   - each part read on its own: a refusal (403), a site gone (404), Azure
 *     throttling (429) or the read's own limit says why for that part, and
 *     the others are still shown;
 *   - who may ask: whoever may read the site, through a connection that
 *     reads it and is on, at most so often a minute, and a read kept for a
 *     minute.
 */

const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const SECRET: string = "client-secret~value";
const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const SITE_ROW: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";
const SUBSCRIPTION: string = "d6252cc9-f01c-428b-924d-9896199f9a13";
const SITE_ID: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-monitoring/providers/Microsoft.Web/sites/azure-monitor-collector-northcentralus`;
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const INSTANCE: string =
  "8f0a3d1c2b4e6f8a0c2e4a6b8d0f1e3c5a7b9d1f3e5c7a9b1d3f5e7c9a1b3d5e";

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: PROJECT.toString(),
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: TENANT,
      clientId: CLIENT,
      cloud: "public",
    },
    secrets: { clientSecret: SECRET },
  };
}

interface FakeSiteOptions {
  instances?: FakeResponse;
  deployments?: FakeResponse;
  config?: FakeResponse;
}

function fakeAzure(options: FakeSiteOptions = {}): FakeProviderApi {
  return createFakeProviderApi([
    {
      host: "login.microsoftonline.com",
      path: `/${TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond: (): FakeResponse => {
        return json({ access_token: "azure-access-token", expires_in: 3599 });
      },
    },
    {
      host: "management.azure.com",
      path: `${SITE_ID}/instances`,
      respond: (): FakeResponse => {
        return (
          options.instances ||
          json({
            value: [
              {
                id: `${SITE_ID}/instances/${INSTANCE}`,
                name: INSTANCE,
                type: "Microsoft.Web/sites/instances",
                properties: { state: "READY" },
              },
            ],
            nextLink: null,
          })
        );
      },
    },
    {
      host: "management.azure.com",
      path: `${SITE_ID}/deployments`,
      respond: (): FakeResponse => {
        return (
          options.deployments ||
          json({
            value: [
              {
                id: `${SITE_ID}/deployments/4d1c9a8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b`,
                name: "azure-monitor-collector-northcentralus/4d1c9a8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b",
                type: "Microsoft.Web/sites/deployments",
                properties: {
                  status: 4,
                  message: "Merge pull request #212",
                  author: "Ops Bot",
                  deployer: "GitHub",
                  start_time: "2026-11-20T09:31:12.6544526Z",
                  end_time: "2026-11-20T09:31:45.2321301Z",
                  active: true,
                },
              },
            ],
          })
        );
      },
    },
    {
      host: "management.azure.com",
      path: `${SITE_ID}/config/web`,
      respond: (): FakeResponse => {
        return (
          options.config ||
          json({
            id: `${SITE_ID}/config/web`,
            name: "web",
            properties: {
              linuxFxVersion:
                "DOCKER|otel/opentelemetry-collector-contrib:0.118.0",
              // Never read: the reader keeps only the image.
              publishingUsername: "$azure-monitor-collector",
            },
          })
        );
      },
    },
  ]);
}

async function readSite(
  fake: FakeProviderApi,
): Promise<AppServiceSiteActivity> {
  return await AzureAppServiceSiteActivity.readSite({
    arm: new AzureCloudConnector().arm(
      settings(),
      {
        transport: fake.transport,
        now: () => {
          return NOW;
        },
        sleep: async () => {},
      },
      new CloudReadBudget({ maxRequests: 10, maxDurationMs: 60000 }),
    ),
    siteId: SITE_ID,
    now: NOW,
  });
}

function armRequests(fake: FakeProviderApi): Array<URL> {
  return fake.requests
    .map((request: DataSourceHttpRequest): URL => {
      return new URL(request.url);
    })
    .filter((url: URL): boolean => {
      return url.host === "management.azure.com";
    });
}

describe("the three reads of one site", () => {
  test("its instances, its deployments and the image it runs, as Azure answers them", async () => {
    const fake: FakeProviderApi = fakeAzure();

    expect(await readSite(fake)).toEqual({
      readAt: NOW.toISOString(),
      instances: {
        items: [{ id: INSTANCE, state: AppServiceInstanceState.Ready }],
      },
      deployments: {
        items: [
          {
            id: "4d1c9a8b7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b",
            status: AppServiceDeploymentStatus.Succeeded,
            active: true,
            author: "Ops Bot",
            deployer: "GitHub",
            message: "Merge pull request #212",
            startTime: "2026-11-20T09:31:12.654Z",
            endTime: "2026-11-20T09:31:45.232Z",
          },
        ],
      },
      image: "otel/opentelemetry-collector-contrib:0.118.0",
    });
  });

  test("three GETs on the management host, each at the fixed api-version, signed in as the app - never the app settings", async () => {
    const fake: FakeProviderApi = fakeAzure();

    await readSite(fake);

    const urls: Array<URL> = armRequests(fake);

    expect(
      urls
        .map((url: URL): string => {
          return url.pathname;
        })
        .sort(),
    ).toEqual(
      [
        `${SITE_ID}/config/web`,
        `${SITE_ID}/deployments`,
        `${SITE_ID}/instances`,
      ].sort(),
    );

    for (const url of urls) {
      expect(url.searchParams.get("api-version")).toBe(
        APP_SERVICE_SITE_API_VERSION,
      );
      expect(url.pathname.toLowerCase()).not.toContain("appsettings");
      expect(url.pathname.toLowerCase()).not.toContain("/list");
    }

    for (const request of fake.requests.filter(
      (candidate: DataSourceHttpRequest): boolean => {
        return new URL(candidate.url).host === "management.azure.com";
      },
    )) {
      expect(request.method || "GET").toBe("GET");
      expect(request.headers?.["Authorization"]).toBe(
        "Bearer azure-access-token",
      );
    }
  });

  test("each part that cannot be read says why, and the others are still read", async () => {
    const forbidden: FakeResponse = json(
      {
        error: {
          code: "AuthorizationFailed",
          message:
            "The client does not have authorization to perform action 'Microsoft.Web/sites/deployments/read'.",
        },
      },
      403,
    );
    const gone: FakeResponse = json(
      { error: { code: "ResourceNotFound", message: "Not found." } },
      404,
    );

    const activity: AppServiceSiteActivity = await readSite(
      fakeAzure({ deployments: forbidden, config: gone }),
    );

    expect(activity.instances.items).toHaveLength(1);
    expect(activity.deployments).toEqual({
      items: null,
      error: AppServiceSiteReadError.NoAccess,
    });
    expect(activity.image).toBeNull();
  });

  test("Azure throttling every try is busy, not a failure", async () => {
    const activity: AppServiceSiteActivity = await readSite(
      fakeAzure({
        instances: json({ error: { code: "TooManyRequests" } }, 429),
      }),
    );

    expect(activity.instances).toEqual({
      items: null,
      error: AppServiceSiteReadError.Busy,
    });
    expect(activity.deployments.items).toHaveLength(1);
  });

  test("a code app names no image", async () => {
    const activity: AppServiceSiteActivity = await readSite(
      fakeAzure({
        config: json({ properties: { linuxFxVersion: "NODE|20-lts" } }),
      }),
    );

    expect(activity.image).toBeNull();
  });
});

describe("why a part could not be read", () => {
  test("a refused credential or role, a site gone, throttling, the read's own limit, anything else", () => {
    const providerError: (status: number) => LlmProviderError = (
      status: number,
    ): LlmProviderError => {
      return new LlmProviderError({
        message: `HTTP ${status}`,
        kind: LlmConnectionFailureKind.Other,
        statusCode: status,
      });
    };

    expect(getAppServiceSiteReadError(providerError(401))).toBe(
      AppServiceSiteReadError.NoAccess,
    );
    expect(getAppServiceSiteReadError(providerError(403))).toBe(
      AppServiceSiteReadError.NoAccess,
    );
    expect(getAppServiceSiteReadError(providerError(404))).toBe(
      AppServiceSiteReadError.NotFound,
    );
    expect(getAppServiceSiteReadError(providerError(429))).toBe(
      AppServiceSiteReadError.Busy,
    );
    expect(getAppServiceSiteReadError(new CloudReadBudgetSpent())).toBe(
      AppServiceSiteReadError.Busy,
    );
    expect(getAppServiceSiteReadError(providerError(500))).toBe(
      AppServiceSiteReadError.Failed,
    );
    expect(getAppServiceSiteReadError(new Error("socket hang up"))).toBe(
      AppServiceSiteReadError.Failed,
    );
  });
});

describe("who may ask, and how often", () => {
  let site: CloudResource | null = null;
  let connection: CloudConnection | null = null;
  let siteQueries: Array<JSONObject> = [];

  beforeEach(() => {
    site = Object.assign(new CloudResource(), {
      _id: SITE_ROW.toString(),
      cloudProvider: CloudProvider.Azure,
      cloudResourceType: "Microsoft.Web/sites",
      providerResourceId: SITE_ID,
      cloudConnectionId: new ObjectID(CONNECTION_ID),
    });
    connection = Object.assign(new CloudConnection(), {
      _id: CONNECTION_ID,
      projectId: PROJECT,
      provider: CloudProvider.Azure,
      isEnabled: true,
    });
    siteQueries = [];
    AzureAppServiceSiteActivity.clearCache();
    CloudLiveReadRateLimit.clearLocal();

    jest.spyOn(CloudResourceService, "findOneBy").mockImplementation((async (
      data: JSONObject,
    ) => {
      siteQueries.push(data);
      return site;
    }) as never);
    jest
      .spyOn(CloudConnectionService, "findOneBy")
      .mockImplementation((async () => {
        return connection;
      }) as never);
    jest
      .spyOn(CloudConnectionService, "getConnectorSettings")
      .mockImplementation((async () => {
        return settings();
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function read(
    fake: FakeProviderApi,
    now: Date = NOW,
  ): Promise<AppServiceSiteActivity> {
    return await AzureAppServiceSiteActivity.read({
      projectId: PROJECT,
      cloudResourceId: SITE_ROW,
      props: { userId: new ObjectID("44444444-4444-4444-8444-444444444444") },
      dependencies: {
        transport: fake.transport,
        now: () => {
          return now;
        },
        sleep: async () => {},
        isRateLimited: false,
      },
    });
  }

  async function refusalOf(action: () => Promise<unknown>): Promise<string> {
    try {
      await action();
    } catch (error) {
      expect(error).toBeInstanceOf(BadDataException);
      return (error as Error).message;
    }

    throw new Error("Expected a refusal.");
  }

  test("the site is read with the asker's own permissions, in the asker's project", async () => {
    await read(fakeAzure());

    expect(siteQueries).toHaveLength(1);
    expect(siteQueries[0]?.["props"]).toEqual({
      userId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    });
    expect(
      (siteQueries[0]?.["query"] as JSONObject)["projectId"]?.toString(),
    ).toBe(PROJECT.toString());
  });

  test("a site the asker may not read, or that is not an App Service app, is refused before Azure is asked", async () => {
    const fake: FakeProviderApi = fakeAzure();

    site = null;
    expect(
      await refusalOf(() => {
        return read(fake);
      }),
    ).toBe("This cloud resource was not found in the project.");

    site = Object.assign(new CloudResource(), {
      _id: SITE_ROW.toString(),
      cloudProvider: CloudProvider.Azure,
      cloudResourceType: "Microsoft.Web/serverfarms",
      providerResourceId: SITE_ID.replace(
        "/sites/azure-monitor-collector-northcentralus",
        "/serverfarms/plan",
      ),
    });
    expect(
      await refusalOf(() => {
        return read(fake);
      }),
    ).toBe(
      "Only an Azure App Service app has instances and deployments to read.",
    );
    expect(fake.requests).toEqual([]);
  });

  test("a site no connection reads, or whose connection is off, says how to fix it", async () => {
    const fake: FakeProviderApi = fakeAzure();

    connection = null;
    expect(
      await refusalOf(() => {
        return read(fake);
      }),
    ).toContain("No cloud connection reads this App Service app");

    connection = Object.assign(new CloudConnection(), {
      _id: CONNECTION_ID,
      provider: CloudProvider.Azure,
      isEnabled: false,
    });
    expect(
      await refusalOf(() => {
        return read(fake);
      }),
    ).toContain("turned off");
    expect(fake.requests).toEqual([]);
  });

  test("a read is kept for a minute: a page left open asks Azure once a minute at most", async () => {
    const fake: FakeProviderApi = fakeAzure();

    await read(fake);
    const asked: number = armRequests(fake).length;

    await read(
      fake,
      new Date(NOW.getTime() + APP_SERVICE_ACTIVITY_CACHE_MS - 1),
    );
    expect(armRequests(fake).length).toBe(asked);

    await read(fake, new Date(NOW.getTime() + APP_SERVICE_ACTIVITY_CACHE_MS));
    expect(armRequests(fake).length).toBe(2 * asked);
  });

  test("the connection's live reads are counted, its own key: past the limit, Azure is not asked", async () => {
    const counts: Map<string, number> = new Map<string, number>();

    jest.spyOn(GlobalCache, "incrementIfBelow").mockImplementation((async (
      _namespace: string,
      key: string,
      options: { limit: number },
    ): Promise<number | null> => {
      const count: number = counts.get(key) || 0;

      if (count >= options.limit) {
        return null;
      }

      counts.set(key, count + 1);
      return count + 1;
    }) as never);

    const fake: FakeProviderApi = fakeAzure();
    const ask: () => Promise<AppServiceSiteActivity> = () => {
      // Every read a fresh one: the minute's cache would answer otherwise.
      AzureAppServiceSiteActivity.clearCache();

      return AzureAppServiceSiteActivity.read({
        projectId: PROJECT,
        cloudResourceId: SITE_ROW,
        props: { isRoot: true },
        dependencies: {
          transport: fake.transport,
          now: () => {
            return NOW;
          },
          sleep: async () => {},
        },
      });
    };

    for (let index: number = 0; index < CLOUD_LIVE_READS_PER_MINUTE; index++) {
      await ask();
    }

    const asked: number = armRequests(fake).length;

    expect(await refusalOf(ask)).toContain("many times in the last minute");
    expect(armRequests(fake).length).toBe(asked);
    expect(Array.from(counts.keys())[0]).toContain(
      `app-service-activity:${CONNECTION_ID}`,
    );
  });
});
