import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import CloudAppService, {
  CloudAppLinkSource,
  CloudAppPlatformLinkChange,
  CloudAppSiteCandidate,
  getCloudAppPlatformLinkChanges,
} from "../../../Server/Services/CloudAppService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import { CloudAppIdentity } from "../../../Server/Utils/Telemetry/CloudAppIdentity";
import logger from "../../../Server/Utils/Logger";
import { CloudAppPlatformEnvironment } from "../../../Types/Cloud/CloudAppPlatformResourceMatch";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";

/*
 * AN APP SERVICE APP KEEPS THE SITE IT IS TIED TO (#10407).
 *
 * The app's page tied an App Service app to its site in the browser, each
 * time it opened, and nothing kept the answer: a list, a monitor or the AI
 * would have to look it up again, and could answer differently. The server
 * now ties each App Service app to its site with the very rules the page
 * reads by (resolveCloudAppSite), and keeps it on the app
 * (CloudApp.platformCloudResourceId):
 *
 *   - by its cloud.resource_id's site, else one of its name in the
 *     subscription its telemetry names, its environment's region first -
 *     never one of another subscription, another slot, or a name that only
 *     starts alike;
 *   - only a live site: one deleted (archived when its subscription no
 *     longer lists it) lets the app go, and a site moved to another
 *     resource group or subscription, which gets a new id and a new row,
 *     takes its place;
 *   - when the app is discovered or names another site, after each Azure
 *     read, and once an hour - writing only the links that change, and
 *     never failing what called it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000001",
);
const ENVIRONMENT_ID: string = "7b000000-0000-4000-8000-000000000002";
const OTHER_ENVIRONMENT_ID: string = "7b000000-0000-4000-8000-000000000003";
const APP_ID: string = "7b000000-0000-4000-8000-000000000010";
const OTHER_APP_ID: string = "7b000000-0000-4000-8000-000000000011";
const SITE_ROW: string = "7b000000-0000-4000-8000-000000000020";
const MOVED_SITE_ROW: string = "7b000000-0000-4000-8000-000000000021";
const OTHER_SUBSCRIPTION_ROW: string = "7b000000-0000-4000-8000-000000000022";
const OTHER_REGION_ROW: string = "7b000000-0000-4000-8000-000000000023";
const SUBSCRIPTION: string = "d6252cc9-f01c-428b-924d-9896199f9a13";
const OTHER_SUBSCRIPTION: string = "3f1c9a52-7d4e-4b8a-9e21-6c5d0b7a2f13";
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");

function siteId(
  name: string,
  subscription: string = SUBSCRIPTION,
  group: string = "rg-web",
): string {
  return `/subscriptions/${subscription}/resourceGroups/${group}/providers/Microsoft.Web/sites/${name}`;
}

function app(fields: Partial<CloudAppLinkSource> = {}): CloudAppLinkSource {
  return {
    id: APP_ID,
    name: "checkout-api",
    groupName: "",
    cloudPlatform: "azure_app_service",
    providerResourceId: "",
    environmentId: ENVIRONMENT_ID,
    keptSiteId: "",
    ...fields,
  };
}

function site(
  id: string,
  providerResourceId: string,
  fields: Partial<CloudAppSiteCandidate> = {},
): CloudAppSiteCandidate {
  return {
    id,
    providerResourceId,
    lastSeenAt: new Date("2026-11-20T11:55:00.000Z"),
    cloudRegion: "northcentralus",
    ...fields,
  };
}

const ENVIRONMENTS: Map<string, CloudAppPlatformEnvironment> = new Map<
  string,
  CloudAppPlatformEnvironment
>([
  [
    ENVIRONMENT_ID,
    { cloudAccountId: SUBSCRIPTION, cloudRegion: "northcentralus" },
  ],
  [OTHER_ENVIRONMENT_ID, { cloudAccountId: null, cloudRegion: null }],
]);

function changesFor(data: {
  apps: Array<CloudAppLinkSource>;
  sites: Array<CloudAppSiteCandidate>;
}): Array<CloudAppPlatformLinkChange> {
  return getCloudAppPlatformLinkChanges({
    apps: data.apps,
    sites: data.sites,
    environments: ENVIRONMENTS,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which site each app keeps (getCloudAppPlatformLinkChanges)", () => {
  test("an app not yet tied is tied to the site of its name in its subscription", () => {
    expect(
      changesFor({
        apps: [app()],
        sites: [site(SITE_ROW, siteId("checkout-api"))],
      }),
    ).toEqual([{ appId: APP_ID, siteId: SITE_ROW }]);
  });

  test("by its own cloud.resource_id first, whatever its case, over a site of its name", () => {
    const ownId: string = siteId("checkout-api", SUBSCRIPTION, "rg-checkout");

    expect(
      changesFor({
        apps: [app({ providerResourceId: ownId.toUpperCase() })],
        sites: [
          site(SITE_ROW, siteId("checkout-api")),
          site(MOVED_SITE_ROW, ownId),
        ],
      }),
    ).toEqual([{ appId: APP_ID, siteId: MOVED_SITE_ROW }]);
  });

  test("nothing is written for an app that already keeps the site it should", () => {
    expect(
      changesFor({
        apps: [app({ keptSiteId: SITE_ROW })],
        sites: [site(SITE_ROW, siteId("checkout-api"))],
      }),
    ).toEqual([]);
  });

  test("a site gone from its subscription (not among the live sites) lets the app go", () => {
    expect(
      changesFor({
        apps: [app({ keptSiteId: SITE_ROW })],
        sites: [],
      }),
    ).toEqual([{ appId: APP_ID, siteId: "" }]);
  });

  test("a site moved to another resource group - a new id, a new row - takes the old one's place", () => {
    expect(
      changesFor({
        apps: [app({ keptSiteId: SITE_ROW })],
        sites: [
          site(
            MOVED_SITE_ROW,
            siteId("checkout-api", SUBSCRIPTION, "rg-moved"),
          ),
        ],
      }),
    ).toEqual([{ appId: APP_ID, siteId: MOVED_SITE_ROW }]);
  });

  test("never a site of its name in another subscription than the one its telemetry names", () => {
    expect(
      changesFor({
        apps: [app()],
        sites: [
          site(
            OTHER_SUBSCRIPTION_ROW,
            siteId("checkout-api", OTHER_SUBSCRIPTION),
          ),
        ],
      }),
    ).toEqual([]);
  });

  test("its environment's region first, when its subscription holds the name in two", () => {
    expect(
      changesFor({
        apps: [app()],
        sites: [
          site(OTHER_REGION_ROW, siteId("checkout-api", SUBSCRIPTION, "rg-a"), {
            cloudRegion: "westeurope",
            lastSeenAt: new Date("2026-11-20T11:59:00.000Z"),
          }),
          site(SITE_ROW, siteId("checkout-api", SUBSCRIPTION, "rg-b")),
        ],
      }),
    ).toEqual([{ appId: APP_ID, siteId: SITE_ROW }]);
  });

  test("never a site whose name only starts or ends alike, a slot, or a plan", () => {
    expect(
      changesFor({
        apps: [app()],
        sites: [
          site("a", siteId("checkout-api-v2")),
          site("b", siteId("my-checkout-api")),
          site("c", `${siteId("checkout-api")}/slots/staging`),
          site(
            "d",
            `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-web/providers/Microsoft.Web/serverfarms/checkout-api`,
          ),
        ],
      }),
    ).toEqual([]);
  });

  test("an app of another deployment slot keeps none: the site's numbers are production's", () => {
    expect(
      changesFor({
        apps: [app({ groupName: "staging", keptSiteId: SITE_ROW })],
        sites: [site(SITE_ROW, siteId("checkout-api"))],
      }),
    ).toEqual([{ appId: APP_ID, siteId: "" }]);
  });

  test("an app whose environment names no subscription takes the one site of its name", () => {
    expect(
      changesFor({
        apps: [app({ environmentId: OTHER_ENVIRONMENT_ID })],
        sites: [site(SITE_ROW, siteId("checkout-api", OTHER_SUBSCRIPTION))],
      }),
    ).toEqual([{ appId: APP_ID, siteId: SITE_ROW }]);
  });

  test("each app is decided alone: two apps, two sites", () => {
    expect(
      changesFor({
        apps: [
          app(),
          app({ id: OTHER_APP_ID, name: "orders-api", keptSiteId: "x" }),
        ],
        sites: [
          site(SITE_ROW, siteId("checkout-api")),
          site(MOVED_SITE_ROW, siteId("orders-api")),
        ],
      }),
    ).toEqual([
      { appId: APP_ID, siteId: SITE_ROW },
      { appId: OTHER_APP_ID, siteId: MOVED_SITE_ROW },
    ]);
  });
});

interface FindArgs {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  props: { isRoot?: boolean };
}

function appRow(fields: Partial<CloudApp> = {}): CloudApp {
  return Object.assign(new CloudApp(), {
    _id: APP_ID,
    name: "checkout-api",
    cloudPlatform: "azure_app_service",
    cloudResourceId: new ObjectID(ENVIRONMENT_ID),
    ...fields,
  });
}

function environmentRow(): CloudResource {
  return Object.assign(new CloudResource(), {
    _id: ENVIRONMENT_ID,
    cloudAccountId: SUBSCRIPTION,
    cloudRegion: "northcentralus",
  });
}

function siteRow(id: string, providerResourceId: string): CloudResource {
  return Object.assign(new CloudResource(), {
    _id: id,
    providerResourceId,
    cloudRegion: "northcentralus",
    lastSeenAt: NOW,
  });
}

interface Harness {
  appFind: SpyInstance<typeof CloudAppService.findBy>;
  resourceFind: SpyInstance<typeof CloudResourceService.findBy>;
  writes: Array<{ sql: string; parameters: Array<unknown> }>;
}

function harness(data: {
  apps: Array<CloudApp>;
  sites: Array<CloudResource>;
}): Harness {
  const writes: Array<{ sql: string; parameters: Array<unknown> }> = [];
  const appFind: SpyInstance<typeof CloudAppService.findBy> = jest
    .spyOn(CloudAppService, "findBy")
    .mockResolvedValue(data.apps as never);
  const resourceFind: SpyInstance<typeof CloudResourceService.findBy> = jest
    .spyOn(CloudResourceService, "findBy")
    .mockImplementation((async (args: FindArgs) => {
      return args.query["cloudResourceKind"] === CloudResourceKind.Resource
        ? data.sites
        : [environmentRow()];
    }) as never);

  jest.spyOn(CloudAppService, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string, parameters: Array<unknown>) => {
        writes.push({ sql, parameters });
        return [];
      },
    },
  } as never);

  return { appFind, resourceFind, writes };
}

describe("CloudAppService.linkPlatformResources", () => {
  test("reads the project's App Service apps, their environments and its live sites, as root", async () => {
    const run: Harness = harness({
      apps: [appRow()],
      sites: [siteRow(SITE_ROW, siteId("checkout-api"))],
    });

    expect(
      await CloudAppService.linkPlatformResources({ projectId: PROJECT_ID }),
    ).toBe(1);

    const apps: FindArgs = run.appFind.mock.calls[0]![0] as never;
    expect(apps.query).toEqual({
      projectId: PROJECT_ID,
      cloudPlatform: "azure_app_service",
    });
    expect(apps.props).toEqual({ isRoot: true });
    expect(apps.limit).toBe(LIMIT_MAX);
    expect(apps.select).toEqual(
      expect.objectContaining({
        providerResourceId: true,
        cloudResourceId: true,
        groupName: true,
        platformCloudResourceId: true,
      }),
    );

    const sites: FindArgs = run.resourceFind.mock.calls
      .map((call: Array<unknown>): FindArgs => {
        return call[0] as FindArgs;
      })
      .find((args: FindArgs): boolean => {
        return args.query["cloudResourceKind"] === CloudResourceKind.Resource;
      })!;
    expect(sites.query).toEqual({
      projectId: PROJECT_ID,
      cloudResourceKind: CloudResourceKind.Resource,
      cloudProvider: "azure",
      cloudResourceType: "Microsoft.Web/sites",
      // A site gone from its subscription is no app's.
      isArchived: false,
    });
    expect(sites.props).toEqual({ isRoot: true });
  });

  test("writes the link it found, pinned to the app and its project", async () => {
    const run: Harness = harness({
      apps: [appRow()],
      sites: [siteRow(SITE_ROW, siteId("checkout-api"))],
    });

    await CloudAppService.linkPlatformResources({ projectId: PROJECT_ID });

    expect(run.writes).toHaveLength(1);
    expect(run.writes[0]!.sql).toContain('SET "platformCloudResourceId" = $1');
    expect(run.writes[0]!.sql).toContain('"projectId" = $2');
    expect(run.writes[0]!.sql).toContain('"_id" = $3');
    expect(run.writes[0]!.parameters).toEqual([
      SITE_ROW,
      PROJECT_ID.toString(),
      APP_ID,
    ]);
  });

  test("unties an app whose site is gone, with NULL", async () => {
    const run: Harness = harness({
      apps: [appRow({ platformCloudResourceId: new ObjectID(SITE_ROW) })],
      sites: [],
    });

    expect(
      await CloudAppService.linkPlatformResources({ projectId: PROJECT_ID }),
    ).toBe(1);
    expect(run.writes[0]!.parameters).toEqual([
      null,
      PROJECT_ID.toString(),
      APP_ID,
    ]);
  });

  test("writes nothing when every app keeps the site it should", async () => {
    const run: Harness = harness({
      apps: [appRow({ platformCloudResourceId: new ObjectID(SITE_ROW) })],
      sites: [siteRow(SITE_ROW, siteId("checkout-api"))],
    });

    expect(
      await CloudAppService.linkPlatformResources({ projectId: PROJECT_ID }),
    ).toBe(0);
    expect(run.writes).toEqual([]);
  });

  test("named apps only, when asked for some; nothing at all for none", async () => {
    const run: Harness = harness({ apps: [], sites: [] });

    await CloudAppService.linkPlatformResources({
      projectId: PROJECT_ID,
      appIds: [new ObjectID(APP_ID)],
    });

    const query: Record<string, unknown> = (
      run.appFind.mock.calls[0]![0] as FindArgs
    ).query;
    expect(Object.keys(query).sort()).toEqual([
      "_id",
      "cloudPlatform",
      "projectId",
    ]);

    run.appFind.mockClear();
    expect(
      await CloudAppService.linkPlatformResources({
        projectId: PROJECT_ID,
        appIds: [],
      }),
    ).toBe(0);
    expect(run.appFind).not.toHaveBeenCalled();
  });

  test("with no App Service app, no site is read", async () => {
    const run: Harness = harness({ apps: [], sites: [] });

    await CloudAppService.linkPlatformResources({ projectId: PROJECT_ID });

    expect(run.resourceFind).not.toHaveBeenCalled();
    expect(run.writes).toEqual([]);
  });
});

describe("CloudAppService.linkPlatformResourcesSafely", () => {
  test("a failure is logged, never thrown: the caller's batch or read goes on", async () => {
    jest
      .spyOn(CloudAppService, "linkPlatformResources")
      .mockRejectedValue(new Error("Postgres is away"));
    const logged: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {}) as never);

    await expect(
      CloudAppService.linkPlatformResourcesSafely({ projectId: PROJECT_ID }),
    ).resolves.toBe(0);
    expect(String(logged.mock.calls[0]![0])).toContain("Postgres is away");
  });

  test("an app of another platform reads nothing", async () => {
    const link: SpyInstance<typeof CloudAppService.linkPlatformResources> = jest
      .spyOn(CloudAppService, "linkPlatformResources")
      .mockResolvedValue(1);

    await CloudAppService.linkPlatformResourcesSafely({
      projectId: PROJECT_ID,
      cloudPlatform: "aws_ecs",
    });
    expect(link).not.toHaveBeenCalled();

    await CloudAppService.linkPlatformResourcesSafely({
      projectId: PROJECT_ID,
      cloudPlatform: "azure_app_service",
    });
    expect(link).toHaveBeenCalledTimes(1);
  });
});

describe("CloudAppService.findProjectIdsWithAppServiceApps", () => {
  test("the projects that hold an App Service app, each once, valid ids only", async () => {
    const queries: Array<{ sql: string; parameters: Array<unknown> }> = [];

    jest.spyOn(CloudAppService, "getRepository").mockReturnValue({
      manager: {
        query: async (sql: string, parameters: Array<unknown>) => {
          queries.push({ sql, parameters });
          return [
            { projectId: PROJECT_ID.toString() },
            { projectId: "not-an-id" },
            {},
          ];
        },
      },
    } as never);

    const ids: Array<ObjectID> =
      await CloudAppService.findProjectIdsWithAppServiceApps();

    expect(
      ids.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([PROJECT_ID.toString()]);
    expect(queries[0]!.sql).toContain('SELECT DISTINCT "projectId"');
    expect(queries[0]!.sql).toContain('"deletedAt" IS NULL');
    expect(queries[0]!.parameters).toEqual(["azure_app_service"]);
  });
});

const IDENTITY: CloudAppIdentity = {
  name: "checkout-api",
  nameAttribute: "service.name",
  groupName: null,
  groupAttribute: null,
  telemetryAttributes: { "service.name": "checkout-api" },
  appKey: "0123456789abcdef0123456789abcdef01234567",
  serviceName: "checkout-api",
  revision: null,
  revisionAttribute: null,
  serviceVersion: null,
  image: null,
  providerResourceId: null,
};

describe("CloudAppService.recordApp ties an App Service app to its site (#10407)", () => {
  let link: SpyInstance<typeof CloudAppService.linkPlatformResources>;

  beforeEach(() => {
    link = jest
      .spyOn(CloudAppService, "linkPlatformResources")
      .mockResolvedValue(1);
  });

  function created(): void {
    jest.spyOn(CloudAppService, "findOneBy").mockResolvedValue(null);
    jest.spyOn(CloudAppService, "create").mockImplementation((async (args: {
      data: CloudApp;
    }) => {
      const row: CloudApp = args.data;
      row._id = APP_ID;
      return row;
    }) as never);
  }

  function existing(providerResourceId?: string): void {
    jest.spyOn(CloudAppService, "findOneBy").mockResolvedValue(
      Object.assign(new CloudApp(), {
        _id: APP_ID,
        providerResourceId,
      }) as never,
    );
    jest
      .spyOn(CloudAppService, "updateOneById")
      .mockResolvedValue(undefined as never);
  }

  test("a new App Service app is tied at once, alone", async () => {
    created();

    await CloudAppService.recordApp({
      projectId: PROJECT_ID,
      cloudResourceId: new ObjectID(ENVIRONMENT_ID),
      cloudPlatform: "azure_app_service",
      identity: IDENTITY,
      now: NOW,
    });

    expect(link).toHaveBeenCalledTimes(1);
    const args: { projectId: ObjectID; appIds?: Array<ObjectID> } = link.mock
      .calls[0]![0] as never;
    expect(args.projectId).toBe(PROJECT_ID);
    expect(
      (args.appIds || []).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([APP_ID]);
  });

  test("an app of another platform is never looked up", async () => {
    created();

    await CloudAppService.recordApp({
      projectId: PROJECT_ID,
      cloudResourceId: new ObjectID(ENVIRONMENT_ID),
      cloudPlatform: "aws_ecs",
      identity: IDENTITY,
      now: NOW,
    });

    expect(link).not.toHaveBeenCalled();
  });

  test("its telemetry naming another site ties it again; the same site, whatever its case, does not", async () => {
    const before: string = siteId("checkout-api", SUBSCRIPTION, "rg-old");
    const after: string = siteId("checkout-api", SUBSCRIPTION, "rg-new");

    existing(before);
    await CloudAppService.recordApp({
      projectId: PROJECT_ID,
      cloudResourceId: new ObjectID(ENVIRONMENT_ID),
      cloudPlatform: "azure_app_service",
      identity: { ...IDENTITY, providerResourceId: before.toUpperCase() },
      now: NOW,
    });
    expect(link).not.toHaveBeenCalled();

    jest.restoreAllMocks();
    link = jest
      .spyOn(CloudAppService, "linkPlatformResources")
      .mockResolvedValue(1);
    existing(before);
    await CloudAppService.recordApp({
      projectId: PROJECT_ID,
      cloudResourceId: new ObjectID(ENVIRONMENT_ID),
      cloudPlatform: "azure_app_service",
      identity: { ...IDENTITY, providerResourceId: after },
      now: NOW,
    });
    expect(link).toHaveBeenCalledTimes(1);
  });

  test("a kept app whose telemetry names no site is not looked up on every window", async () => {
    existing(undefined);

    await CloudAppService.recordApp({
      projectId: PROJECT_ID,
      cloudResourceId: new ObjectID(ENVIRONMENT_ID),
      cloudPlatform: "azure_app_service",
      identity: IDENTITY,
      now: NOW,
    });

    expect(link).not.toHaveBeenCalled();
  });

  test("a link that fails never fails the ingest that recorded the app", async () => {
    created();
    link.mockRejectedValue(new Error("Postgres is away"));
    jest.spyOn(logger, "error").mockImplementation((() => {}) as never);

    await expect(
      CloudAppService.recordApp({
        projectId: PROJECT_ID,
        cloudResourceId: new ObjectID(ENVIRONMENT_ID),
        cloudPlatform: "azure_app_service",
        identity: IDENTITY,
        now: NOW,
      }),
    ).resolves.toEqual(new ObjectID(APP_ID));
  });
});
