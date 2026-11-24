import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * AN APP SERVICE APP, TIED TO ITS SUBSCRIPTION, CONNECTION AND SITE
 * (#10294).
 *
 * The customer's two App Service apps read "Azure Monitor: Not connected"
 * though their subscription's Azure connection was connected. #6792 looked
 * the site up by the app's name as a prefix of the row's name and called
 * any miss "Not connected". These tests reproduce each way that went wrong
 * and pin what the page now finds and says:
 *
 *   - the site is read by the end of its ARM id, so a row a person renamed,
 *     and one name shared as a prefix by more sites than a read holds, are
 *     found;
 *   - the app's subscription is the one its telemetry names, and a site of
 *     its name in another subscription is not its own;
 *   - the subscription's connection is read for itself, so a connected
 *     subscription that holds no site of the app's name says so - not "Not
 *     connected" - and an unconnected one, one no connection reads, a
 *     connection turned off, failing or still on its first read each say
 *     theirs.
 *
 * The reads go through ModelAPI, answered here as the server would: the
 * query's own filters applied to the rows held.
 */

interface ListRequest {
  modelType: { name: string };
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
}

const mockServer: {
  sites: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
  connections: Array<Record<string, unknown>>;
  requests: Array<ListRequest>;
  counts: Array<ListRequest>;
  failSites: boolean;
  failConnections: boolean;
} = {
  sites: [],
  accounts: [],
  connections: [],
  requests: [],
  counts: [],
  failSites: false,
  failConnections: false,
};

// A query operator's value, as the server reads it.
function operatorValue(value: unknown): string {
  return String((value as { value?: unknown })?.value ?? value ?? "");
}

function operatorType(value: unknown): string {
  return (
    (value as { constructor?: { name?: string } })?.constructor?.name || ""
  );
}

// Whether a row passes one filter of the query, as Postgres would read it.
function passes(
  row: Record<string, unknown>,
  key: string,
  filter: unknown,
): boolean {
  const cell: string = String(row[key] ?? "");

  switch (operatorType(filter)) {
    case "EndsWith":
      return cell.toLowerCase().endsWith(operatorValue(filter).toLowerCase());
    case "StartsWith":
      return cell.toLowerCase().startsWith(operatorValue(filter).toLowerCase());
    case "Search":
      return cell.toLowerCase().includes(operatorValue(filter).toLowerCase());
    default:
      return row[key] === filter || cell === String(filter);
  }
}

function answer(request: ListRequest): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> =
    request.modelType.name === "CloudResource"
      ? mockServer.sites
      : request.modelType.name === "CloudAccount"
        ? mockServer.accounts
        : mockServer.connections;

  return rows.filter((row: Record<string, unknown>): boolean => {
    return Object.entries(request.query).every(
      ([key, filter]: [string, unknown]): boolean => {
        return passes(row, key, filter);
      },
    );
  });
}

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: ListRequest): Promise<unknown> => {
        mockServer.requests.push(request);

        if (
          request.modelType.name === "CloudResource" &&
          mockServer.failSites
        ) {
          return Promise.reject(new Error("403"));
        }

        if (
          request.modelType.name !== "CloudResource" &&
          mockServer.failConnections
        ) {
          return Promise.reject(new Error("403"));
        }

        const rows: Array<Record<string, unknown>> = answer(request).slice(
          0,
          request.limit,
        );
        const Model: new () => Record<string, unknown> =
          request.modelType as unknown as new () => Record<string, unknown>;

        return Promise.resolve({
          data: rows.map((row: Record<string, unknown>) => {
            return Object.assign(new Model(), row);
          }),
          count: rows.length,
          skip: 0,
          limit: request.limit,
        });
      },
      count: (request: ListRequest): Promise<number> => {
        mockServer.counts.push(request);
        return Promise.resolve(answer(request).length);
      },
    },
  };
});

import {
  CloudAppAzureLink,
  CloudAppAzureMonitorState,
  fetchCloudAppAzureLink,
  findAzureConnectionOfSubscription,
  getAzureConnectionReadInterval,
  getAzureConnectionSubscriptions,
  getAzureMonitorLatestReadingAt,
  getCloudAppAzureMonitorState,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppAzureLink";
import {
  APP_SERVICE_SITE_TYPE,
  CLOUD_APP_PLATFORM_RESOURCE_READ_LIMIT,
  CloudAppSiteMatch,
  CloudAppSubscriptionSource,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/AppPlatforms/Utils/CloudAppPlatformResource";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import { ManagedCloudPlatform } from "../../../Types/Cloud/CloudPlatform";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";

const SUBSCRIPTION: string = "d6252cc9-f01c-428b-924d-9896199f9a13";
const OTHER_SUBSCRIPTION: string = "3f1c9a52-7d4e-4b8a-9e21-6c5d0b7a2f13";
const CONNECTION_ID: string = "77100000-0000-4000-8000-000000000001";
const OTHER_CONNECTION_ID: string = "77100000-0000-4000-8000-000000000002";
const APP_NAME: string = "azure-monitor-collector-northcentralus";

function siteId(
  name: string,
  subscription: string = SUBSCRIPTION,
  group: string = "rg-monitoring",
): string {
  return `/subscriptions/${subscription}/resourceGroups/${group}/providers/Microsoft.Web/sites/${name}`;
}

let rowNumber: number = 0;

function siteRow(
  name: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  rowNumber++;
  const subscription: string = String(fields["subscription"] || SUBSCRIPTION);

  return {
    _id: `78000000-0000-4000-8000-${String(rowNumber).padStart(12, "0")}`,
    name,
    cloudResourceKind: CloudResourceKind.Resource,
    cloudProvider: "azure",
    cloudResourceType: APP_SERVICE_SITE_TYPE,
    cloudAccountId: subscription,
    cloudRegion: "northcentralus",
    cloudConnectionId: CONNECTION_ID,
    providerResourceId: siteId(name, subscription),
    lastSeenAt: "2026-11-20T10:00:00.000Z",
    isArchived: false,
    ...fields,
  };
}

function connectionRow(
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _id: CONNECTION_ID,
    name: "Azure production",
    provider: "azure",
    config: { readIntervalInMinutes: 5 },
    isEnabled: true,
    lastPulledAt: "2026-11-20T11:55:00.000Z",
    lastSuccessfulPullAt: "2026-11-20T11:55:00.000Z",
    ...fields,
  };
}

function accountRow(
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _id: "79000000-0000-4000-8000-000000000001",
    name: "Production",
    provider: "azure",
    accountId: SUBSCRIPTION,
    cloudConnectionId: CONNECTION_ID,
    inventoryListedAt: "2026-11-20T11:55:00.000Z",
    ...fields,
  };
}

// The issue's app: named by hand, its subscription typed into cloud.account.id.
function issueApp(
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: APP_NAME,
    cloudPlatform: ManagedCloudPlatform.AzureAppService,
    ...fields,
  };
}

const ISSUE_ENVIRONMENT: Record<string, string> = {
  cloudAccountId: SUBSCRIPTION,
  cloudRegion: "northcentralus",
};

async function linkOf(
  app: Record<string, unknown> = issueApp(),
  environment: Record<string, string> | null = ISSUE_ENVIRONMENT,
): Promise<CloudAppAzureLink> {
  const link: CloudAppAzureLink | null = await fetchCloudAppAzureLink({
    app,
    environment,
  });

  expect(link).not.toBeNull();

  return link as CloudAppAzureLink;
}

function siteRequests(): Array<ListRequest> {
  return mockServer.requests.filter((request: ListRequest): boolean => {
    return request.modelType.name === "CloudResource";
  });
}

beforeEach(() => {
  mockServer.sites = [];
  mockServer.accounts = [accountRow()];
  mockServer.connections = [connectionRow()];
  mockServer.requests = [];
  mockServer.counts = [];
  mockServer.failSites = false;
  mockServer.failConnections = false;
});

describe("the issue's apps: a connected subscription is never 'Not connected'", () => {
  test("with no App Service app of the app's name in it, the subscription is connected and the site is what is missing", async () => {
    mockServer.sites = [
      siteRow("collector-ncus"),
      siteRow("collector-scus", { cloudRegion: "southcentralus" }),
    ];

    const link: CloudAppAzureLink = await linkOf();

    expect(link.site).toBeNull();
    expect(link.connection?.name).toBe("Azure production");
    expect(link.account?.accountId).toBe(SUBSCRIPTION);
    expect(link.sitesInSubscription).toBe(2);
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.SiteNotFound,
    );
  });

  test("named as its App Service app, it is tied to it, its subscription and its connection, with no setup of its own", async () => {
    mockServer.sites = [siteRow(APP_NAME), siteRow("collector-scus")];

    const link: CloudAppAzureLink = await linkOf();

    expect(link.site?.providerResourceId).toBe(siteId(APP_NAME));
    expect(link.matchedBy).toBe(CloudAppSiteMatch.Name);
    expect(link.subscription).toEqual({
      id: SUBSCRIPTION,
      source: CloudAppSubscriptionSource.Environment,
    });
    expect(link.connection?._id?.toString()).toBe(CONNECTION_ID);
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.Connected,
    );
  });

  test("a site row a person renamed is still found: the read goes by its ARM id, never its name", async () => {
    mockServer.sites = [
      siteRow(APP_NAME, { name: "Collector (North Central US)" }),
    ];

    const link: CloudAppAzureLink = await linkOf();

    expect(link.site?.name).toBe("Collector (North Central US)");
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.Connected,
    );

    const query: Record<string, unknown> = siteRequests()[0]!.query;

    expect(query["name"]).toBeUndefined();
    expect(operatorType(query["providerResourceId"])).toBe("EndsWith");
    expect(operatorValue(query["providerResourceId"])).toBe(
      `/providers/microsoft.web/sites/${APP_NAME}`,
    );
    expect(query["cloudResourceType"]).toBe(APP_SERVICE_SITE_TYPE);
    expect(query["cloudResourceKind"]).toBe(CloudResourceKind.Resource);
    expect(query["cloudProvider"]).toBe("azure");
  });

  test("a short name that starts more sites' names than one read holds still finds its own", async () => {
    for (
      let index: number = 0;
      index < CLOUD_APP_PLATFORM_RESOURCE_READ_LIMIT + 20;
      index++
    ) {
      mockServer.sites.push(
        siteRow(`api-${index}`, { lastSeenAt: "2026-11-20T11:59:00.000Z" }),
      );
    }
    mockServer.sites.push(
      siteRow("api", { lastSeenAt: "2026-11-19T00:00:00.000Z" }),
    );

    const link: CloudAppAzureLink = await linkOf(issueApp({ name: "api" }));

    expect(link.site?.providerResourceId).toBe(siteId("api"));
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.Connected,
    );
  });

  test("a site of the app's name in another subscription is not its own, and is named", async () => {
    mockServer.sites = [
      siteRow(APP_NAME, { subscription: OTHER_SUBSCRIPTION }),
    ];

    const link: CloudAppAzureLink = await linkOf();

    expect(link.site).toBeNull();
    expect(
      link.elsewhere.map((row: CloudResource): string | undefined => {
        return row.providerResourceId;
      }),
    ).toEqual([siteId(APP_NAME, OTHER_SUBSCRIPTION)]);
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.SiteInOtherSubscription,
    );
  });

  test("of two sites of one name, the one in the app's own subscription is its own", async () => {
    mockServer.sites = [
      siteRow(APP_NAME, {
        subscription: OTHER_SUBSCRIPTION,
        lastSeenAt: "2026-11-20T11:59:00.000Z",
      }),
      siteRow(APP_NAME, { lastSeenAt: "2026-11-01T00:00:00.000Z" }),
    ];

    const link: CloudAppAzureLink = await linkOf();

    expect(link.site?.providerResourceId).toBe(siteId(APP_NAME));
  });
});

describe("the chain's other links, each said for itself", () => {
  test("a project with no Azure connection at all", async () => {
    mockServer.accounts = [];
    mockServer.connections = [];

    const link: CloudAppAzureLink = await linkOf();

    expect(link.azureConnections).toBe(0);
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.NoConnection,
    );
  });

  test("Azure connections that read other subscriptions, not this one", async () => {
    mockServer.accounts = [accountRow({ accountId: OTHER_SUBSCRIPTION })];
    mockServer.connections = [
      connectionRow({ config: { subscriptionIds: OTHER_SUBSCRIPTION } }),
    ];

    const link: CloudAppAzureLink = await linkOf();

    expect(link.account).toBeNull();
    expect(link.connection).toBeNull();
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.SubscriptionNotRead,
    );
  });

  test("a connection whose settings name the subscription, before its first read lists it", async () => {
    mockServer.accounts = [];
    mockServer.connections = [
      connectionRow({
        config: {
          subscriptionIds: `${OTHER_SUBSCRIPTION}, ${SUBSCRIPTION.toUpperCase()}`,
        },
        lastPulledAt: undefined,
        lastSuccessfulPullAt: undefined,
      }),
    ];

    const link: CloudAppAzureLink = await linkOf();

    expect(link.connection?._id?.toString()).toBe(CONNECTION_ID);
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.FirstReadPending,
    );
  });

  test("a connection that names the subscription and reads, but never listed it: its app may not read it", async () => {
    mockServer.accounts = [];
    mockServer.connections = [
      connectionRow({ config: { subscriptionIds: SUBSCRIPTION } }),
    ];

    expect(getCloudAppAzureMonitorState(await linkOf())).toBe(
      CloudAppAzureMonitorState.SubscriptionNotRead,
    );
  });

  test("its connection turned off, or its last read failed, whether or not its site is found", async () => {
    for (const sites of [[], [siteRow(APP_NAME)]]) {
      mockServer.sites = sites;
      mockServer.connections = [connectionRow({ isEnabled: false })];

      expect(getCloudAppAzureMonitorState(await linkOf())).toBe(
        CloudAppAzureMonitorState.ConnectionOff,
      );

      mockServer.connections = [
        connectionRow({
          lastPulledAt: "2026-11-20T11:58:00.000Z",
          lastSuccessfulPullAt: "2026-11-20T09:00:00.000Z",
          lastError: "AuthorizationFailed",
        }),
      ];

      expect(getCloudAppAzureMonitorState(await linkOf())).toBe(
        CloudAppAzureMonitorState.ConnectionFailing,
      );
    }
  });

  test("the site's own connection is the one read, before the subscription's", async () => {
    mockServer.sites = [
      siteRow(APP_NAME, { cloudConnectionId: OTHER_CONNECTION_ID }),
    ];
    mockServer.connections = [
      connectionRow(),
      connectionRow({ _id: OTHER_CONNECTION_ID, name: "Azure monitoring" }),
    ];

    const link: CloudAppAzureLink = await linkOf();

    expect(link.connection?.name).toBe("Azure monitoring");
  });

  test("telemetry that names no subscription, and no site of the app's name", async () => {
    const link: CloudAppAzureLink = await linkOf(issueApp(), {
      cloudRegion: "northcentralus",
    } as Record<string, string>);

    expect(link.subscription).toBeNull();
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.NoSubscription,
    );
  });

  test("telemetry that names no subscription, and a site of the app's name: the site's says it", async () => {
    mockServer.sites = [siteRow(APP_NAME)];

    const link: CloudAppAzureLink = await linkOf(issueApp(), null);

    expect(link.subscription).toEqual({
      id: SUBSCRIPTION,
      source: CloudAppSubscriptionSource.Site,
    });
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.Connected,
    );
  });

  test("the app's own cloud.resource_id names its subscription and its site, whatever the app is called", async () => {
    mockServer.sites = [siteRow("collector-ncus")];

    const link: CloudAppAzureLink = await linkOf(
      issueApp({ providerResourceId: siteId("collector-ncus") }),
      { cloudRegion: "North Central US" } as Record<string, string>,
    );

    expect(link.matchedBy).toBe(CloudAppSiteMatch.ResourceId);
    expect(link.subscription?.source).toBe(
      CloudAppSubscriptionSource.ResourceId,
    );
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.Connected,
    );
  });

  test("an app of another deployment slot is tied to its own slot, which Azure Monitor reports apart - never the site (#6793)", async () => {
    const slot: Record<string, unknown> = siteRow(APP_NAME, {
      name: `${APP_NAME}/staging`,
      cloudResourceType: "Microsoft.Web/sites/slots",
      providerResourceId: `${siteId(APP_NAME)}/slots/staging`,
    });
    mockServer.sites = [siteRow(APP_NAME), slot];

    const link: CloudAppAzureLink = await linkOf(
      issueApp({
        groupName: "staging",
        // The detectors name the site for every slot.
        providerResourceId: siteId(APP_NAME),
      }),
    );

    expect(link.slot).toBe("staging");
    expect(link.site?.providerResourceId).toBe(
      `${siteId(APP_NAME)}/slots/staging`,
    );
    expect(link.matchedBy).toBe(CloudAppSiteMatch.ResourceId);
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.Connected,
    );

    // The slots of its site's name are read, never the site.
    const query: Record<string, unknown> = siteRequests()[0]!.query;
    expect(query["cloudResourceType"]).toBe("Microsoft.Web/sites/slots");
    expect(operatorValue(query["providerResourceId"])).toBe(
      `/providers/microsoft.web/sites/${APP_NAME}/slots/staging`,
    );
  });

  test("an app of a slot no connection reads has none, and is told the slot is what is missing", async () => {
    mockServer.sites = [siteRow(APP_NAME)];

    const link: CloudAppAzureLink = await linkOf(
      issueApp({ groupName: "staging" }),
    );

    expect(link.site).toBeNull();
    expect(link.slot).toBe("staging");
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.SiteNotFound,
    );
  });

  test("an app on another platform, or with no name, has no link", async () => {
    expect(
      await fetchCloudAppAzureLink({
        app: { name: APP_NAME, cloudPlatform: ManagedCloudPlatform.AwsEcs },
        environment: ISSUE_ENVIRONMENT,
      }),
    ).toBeNull();
    expect(
      await fetchCloudAppAzureLink({
        app: issueApp({ name: " " }),
        environment: ISSUE_ENVIRONMENT,
      }),
    ).toBeNull();
    expect(mockServer.requests).toEqual([]);
  });
});

describe("reads that fail", () => {
  test("sites that cannot be read: the link cannot be made, and the page says it could not check", async () => {
    mockServer.failSites = true;

    await expect(
      fetchCloudAppAzureLink({
        app: issueApp(),
        environment: ISSUE_ENVIRONMENT,
      }),
    ).rejects.toThrow("403");
  });

  test("connections that cannot be read: a site found is still shown; none found is unknown, never 'not connected'", async () => {
    mockServer.failConnections = true;
    mockServer.sites = [siteRow(APP_NAME)];

    const found: CloudAppAzureLink = await linkOf();

    expect(found.connectionsChecked).toBe(false);
    expect(getCloudAppAzureMonitorState(found)).toBe(
      CloudAppAzureMonitorState.Connected,
    );

    mockServer.sites = [];

    expect(getCloudAppAzureMonitorState(await linkOf())).toBe(
      CloudAppAzureMonitorState.Unknown,
    );
  });
});

describe("what the link reads off its rows", () => {
  test("a connection's subscriptions, as its settings list them", () => {
    expect(
      getAzureConnectionSubscriptions(
        Object.assign(new CloudConnection(), {
          config: {
            subscriptionIds: ` ${SUBSCRIPTION.toUpperCase()},${OTHER_SUBSCRIPTION} `,
          },
        }),
      ),
    ).toEqual([SUBSCRIPTION, OTHER_SUBSCRIPTION]);
    expect(getAzureConnectionSubscriptions(new CloudConnection())).toEqual([]);
  });

  test("the subscription's connection: its account's, else one whose settings name it", () => {
    const listed: CloudConnection = Object.assign(new CloudConnection(), {
      _id: CONNECTION_ID,
      config: {},
    });
    const naming: CloudConnection = Object.assign(new CloudConnection(), {
      _id: OTHER_CONNECTION_ID,
      config: { subscriptionIds: SUBSCRIPTION },
    });

    expect(
      findAzureConnectionOfSubscription({
        subscriptionId: SUBSCRIPTION,
        account: { cloudConnectionId: CONNECTION_ID } as never,
        connections: [naming, listed],
      })?._id?.toString(),
    ).toBe(CONNECTION_ID);
    expect(
      findAzureConnectionOfSubscription({
        subscriptionId: SUBSCRIPTION,
        account: null,
        connections: [listed, naming],
      })?._id?.toString(),
    ).toBe(OTHER_CONNECTION_ID);
    expect(
      findAzureConnectionOfSubscription({
        subscriptionId: OTHER_SUBSCRIPTION,
        account: null,
        connections: [listed, naming],
      }),
    ).toBeNull();
  });

  test("how often the connection reads: its setting, else Azure's default", () => {
    expect(
      getAzureConnectionReadInterval(
        Object.assign(new CloudConnection(), {
          provider: "azure",
          config: { readIntervalInMinutes: 30 },
        }),
      ),
    ).toBe(30);
    expect(getAzureConnectionReadInterval(null)).toBeGreaterThan(0);
  });

  test("when Azure last measured the site: its newest reading, else when its readings were written", () => {
    expect(
      getAzureMonitorLatestReadingAt({
        cloudReadings: {
          requests: { value: 10, time: "2026-11-20T11:50:00.000Z" },
          httpresponsetime: { value: 0.2, time: "2026-11-20T11:55:00.000Z" },
        },
        cloudReadingsAt: new Date("2026-11-20T11:57:00.000Z"),
      })?.toISOString(),
    ).toBe("2026-11-20T11:55:00.000Z");
    expect(
      getAzureMonitorLatestReadingAt({
        cloudReadings: {},
        cloudReadingsAt: new Date("2026-11-20T11:57:00.000Z"),
      })?.toISOString(),
    ).toBe("2026-11-20T11:57:00.000Z");
    expect(getAzureMonitorLatestReadingAt({})).toBeNull();
    expect(getAzureMonitorLatestReadingAt(null)).toBeNull();
  });
});

/*
 * #10407: the server keeps the site an App Service app is tied to
 * (CloudApp.platformCloudResourceId), with the rules above. The page reads
 * that site first - by its id, as the reader may read it - and looks the
 * site up only while none is kept, or the reader may not read it: then the
 * page and the lists read one answer, and a site the reader may not read is
 * never shown.
 */
describe("the site the server keeps on the app", () => {
  test("is read first, by its id, and no site is looked up by name", async () => {
    const kept: Record<string, unknown> = siteRow(APP_NAME, {
      name: "Collector (renamed)",
    });
    mockServer.sites = [kept, siteRow("collector-scus")];

    const link: CloudAppAzureLink = await linkOf(
      issueApp({ platformCloudResourceId: kept["_id"] }),
    );

    expect(link.site?._id?.toString()).toBe(kept["_id"]);
    expect(link.matchedBy).toBe(CloudAppSiteMatch.Name);
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.Connected,
    );
    expect(siteRequests()).toHaveLength(1);

    const query: Record<string, unknown> = siteRequests()[0]!.query;

    expect(String(query["_id"])).toBe(kept["_id"]);
    expect(query["providerResourceId"]).toBeUndefined();
    expect(query["cloudResourceType"]).toBe(APP_SERVICE_SITE_TYPE);
  });

  test("tied by the app's own cloud.resource_id, it says so", async () => {
    const kept: Record<string, unknown> = siteRow(APP_NAME);
    mockServer.sites = [kept];

    const link: CloudAppAzureLink = await linkOf(
      issueApp({
        platformCloudResourceId: kept["_id"],
        providerResourceId: siteId(APP_NAME).toUpperCase(),
      }),
    );

    expect(link.matchedBy).toBe(CloudAppSiteMatch.ResourceId);
  });

  test("one the reader may not read, or that is gone, leaves the page to look the site up and say what it finds", async () => {
    mockServer.sites = [siteRow("collector-ncus")];

    const link: CloudAppAzureLink = await linkOf(
      issueApp({
        platformCloudResourceId: "78000000-0000-4000-8000-0000000fffff",
      }),
    );

    expect(link.site).toBeNull();
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.SiteNotFound,
    );
    // The kept site's read, then the look-up by name.
    expect(siteRequests()).toHaveLength(2);
    expect(operatorType(siteRequests()[1]!.query["providerResourceId"])).toBe(
      "EndsWith",
    );
  });

  test("an app of another slot never shows a kept site: only a kept slot (#6793)", async () => {
    const keptSite: Record<string, unknown> = siteRow(APP_NAME);
    mockServer.sites = [keptSite];

    const stale: CloudAppAzureLink = await linkOf(
      issueApp({
        platformCloudResourceId: keptSite["_id"],
        groupName: "staging",
      }),
    );

    // The kept read asks for a slot, and the site is not one.
    expect(stale.site).toBeNull();
    expect(siteRequests()[0]!.query["cloudResourceType"]).toBe(
      "Microsoft.Web/sites/slots",
    );

    const keptSlot: Record<string, unknown> = siteRow(APP_NAME, {
      cloudResourceType: "Microsoft.Web/sites/slots",
      providerResourceId: `${siteId(APP_NAME)}/slots/staging`,
    });
    mockServer.sites = [keptSite, keptSlot];
    mockServer.requests = [];

    const kept: CloudAppAzureLink = await linkOf(
      issueApp({
        platformCloudResourceId: keptSlot["_id"],
        groupName: "staging",
      }),
    );

    expect(kept.site?._id?.toString()).toBe(keptSlot["_id"]);
    expect(siteRequests()).toHaveLength(1);
  });
});

describe("a site gone from its subscription", () => {
  test("is no candidate: the look-up reads live sites only, as the server's link does", async () => {
    mockServer.sites = [siteRow(APP_NAME, { isArchived: true })];

    const link: CloudAppAzureLink = await linkOf();

    expect(link.site).toBeNull();
    expect(siteRequests()[0]!.query["isArchived"]).toBe(false);
    expect(getCloudAppAzureMonitorState(link)).toBe(
      CloudAppAzureMonitorState.SiteNotFound,
    );
  });
});
