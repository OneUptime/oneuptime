import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import OpenStackResourceService, {
  OpenStackAttentionRows,
  OpenStackInventorySummary,
  ParsedOpenStackResource,
} from "../../../Server/Services/OpenStackResourceService";
import logger from "../../../Server/Utils/Logger";
import {
  OpenStackOptionalServiceScrape,
  bufferOpenStackOptionalServiceScrape,
  isOpenStackOptionalServiceScrapeDatapoint,
} from "../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { OpenStackBlastRadius } from "../../../Types/OpenStack/OpenStackBlastRadius";
import {
  OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES,
  OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES,
  OPENSTACK_GNOCCHI_BACKLOG_WARNING_MEASURES,
  OPENSTACK_DNS_ZONE_PENDING_STUCK_MINUTES,
  OPENSTACK_SHARE_STUCK_MINUTES,
  OPENSTACK_STACK_STUCK_MINUTES,
} from "../../../Types/OpenStack/OpenStackHealthRules";
import {
  OPENSTACK_EMPTY_ANSWER_SINCE_FACT,
  getOpenStackOptionalServicesOf,
} from "../../../Types/OpenStack/OpenStackOptionalServices";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_FIXTURES_FOLDER,
  readRecordedSeries,
  scanRecordedSeries,
  toParsedOpenStackResource,
} from "../../Helpers/OpenStackRecordedRows";
import { DataSource } from "typeorm";
import fs from "fs";
import path from "path";

/*
 * How a service a cloud may not run comes and goes, in the SQL that does it, on Postgres against the
 * migrated table. Opt in as OpenStackResourcePostgres.test.ts says: RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS.
 *
 * What it pins:
 *   - an empty scrape, and an exporter that is down, can never give a cloud a row for a service it
 *     does not run, on a real cloud's real OTLP;
 *   - on a row that is there, a failed scrape reads down, and the next good read brings it back;
 *   - a service's rows go once its scrape has answered with nothing while the rest of the cloud has
 *     gone on answering, in that region, and only then: a Keystone outage takes nothing;
 *   - a service's own kinds and workers answer to its own API, as every other service's do;
 *   - a cluster's project comes from its stack, on what a real cloud recorded;
 *   - what needs someone, what a region's summary counts and what a stack and a cluster name of each
 *     other are read by the statements the pages use.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "OpenStackResource";
const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const OTHER_CLOUD_ID: ObjectID = ObjectID.generate();

const MINUTE_MS: number = 60 * 1000;
const NOW: Date = new Date("2026-11-05T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE_MS);
}

function resource(
  overrides: Partial<ParsedOpenStackResource> & {
    kind: OpenStackResourceKind;
    externalId: string;
  },
): ParsedOpenStackResource {
  return {
    name: null,
    regionName: "RegionOne",
    availabilityZone: null,
    hypervisorName: null,
    openStackProjectId: null,
    status: null,
    adminState: null,
    disabledReason: null,
    vcpuCapacity: null,
    vcpuAllocated: null,
    memoryCapacityBytes: null,
    memoryAllocatedBytes: null,
    diskCapacityBytes: null,
    diskAllocatedBytes: null,
    instanceCount: null,
    facts: {},
    lastSeenAt: NOW,
    ...overrides,
  };
}

// What the menu and Recommendations read: the services a summary says, of those a cloud may not run.
async function optionalServicesOf(
  openStackCloudId: ObjectID,
  regionName?: string | undefined,
): Promise<Array<string>> {
  return getOpenStackOptionalServicesOf(
    (
      await OpenStackResourceService.getInventorySummary({
        projectId: PROJECT_ID,
        openStackCloudId,
        regionName,
      })
    ).services,
  );
}

function api(
  service: string,
  overrides: Partial<ParsedOpenStackResource> & { vouchedAt?: Date } = {},
): ParsedOpenStackResource {
  const { vouchedAt, ...rest } = overrides;
  return resource({
    kind: OpenStackResourceKind.Api,
    externalId: `${rest.regionName || "RegionOne"}/${service}`,
    name: service,
    status: "up",
    facts: {
      vouchedAt: (vouchedAt || NOW).toISOString(),
      // The stale rule measures from the read before the latest.
      previousVouchedAt: (vouchedAt || NOW).toISOString(),
    },
    ...rest,
  });
}

function stack(
  id: string,
  overrides: Partial<ParsedOpenStackResource> = {},
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.Stack,
    externalId: id,
    name: id,
    status: "CREATE_COMPLETE",
    ...overrides,
  });
}

function cluster(
  id: string,
  overrides: Partial<ParsedOpenStackResource> = {},
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.ContainerCluster,
    externalId: id,
    name: id,
    status: "CREATE_COMPLETE",
    ...overrides,
  });
}

function share(
  id: string,
  overrides: Partial<ParsedOpenStackResource> = {},
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.Share,
    externalId: id,
    name: id,
    status: "available",
    ...overrides,
  });
}

function troveInstance(
  id: string,
  overrides: Partial<ParsedOpenStackResource> = {},
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.DatabaseInstance,
    externalId: id,
    name: id,
    status: "ACTIVE",
    ...overrides,
  });
}

function dnsZone(
  id: string,
  overrides: Partial<ParsedOpenStackResource> = {},
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.DnsZone,
    externalId: id,
    name: id,
    status: "ACTIVE",
    ...overrides,
  });
}

function dnsRecordset(
  id: string,
  overrides: Partial<ParsedOpenStackResource> = {},
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.DnsRecordset,
    externalId: id,
    name: id,
    status: "ERROR",
    ...overrides,
  });
}

function scrape(
  service: string,
  overrides: Partial<OpenStackOptionalServiceScrape> = {},
): OpenStackOptionalServiceScrape {
  return {
    service,
    regionName: "RegionOne",
    answered: true,
    samples: 8,
    seconds: 0.5,
    observedAt: NOW,
    ...overrides,
  };
}

describePostgres("a service a cloud may not run, on Postgres", () => {
  const schema: string = `openstack_optional_${Date.now()}`;
  let database: DataSource;

  type Row = Record<string, any>;

  const write: (
    resources: Array<ParsedOpenStackResource>,
    cloudId?: ObjectID,
  ) => Promise<void> = async (
    resources: Array<ParsedOpenStackResource>,
    cloudId: ObjectID = CLOUD_ID,
  ): Promise<void> => {
    await OpenStackResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      openStackCloudId: cloudId,
      resources,
    });
  };

  const record: (
    scrapes: Array<OpenStackOptionalServiceScrape>,
  ) => Promise<void> = async (
    scrapes: Array<OpenStackOptionalServiceScrape>,
  ): Promise<void> => {
    await OpenStackResourceService.recordOptionalServiceScrapes({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      scrapes,
    });
  };

  const sweep: () => Promise<number> = async (): Promise<number> => {
    return await OpenStackResourceService.deleteStaleForCloud({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
    });
  };

  const rows: (
    kind?: OpenStackResourceKind,
    cloudId?: ObjectID,
  ) => Promise<Array<Row>> = async (
    kind?: OpenStackResourceKind,
    cloudId: ObjectID = CLOUD_ID,
  ): Promise<Array<Row>> => {
    return await database.query(
      `SELECT * FROM "${schema}"."${TABLE}"
       WHERE "openStackCloudId" = $1 AND ($2::text IS NULL OR "kind" = $2)
       ORDER BY "kind", "externalId"`,
      [cloudId.toString(), kind || null],
    );
  };

  const apiRow: (service: string) => Promise<Row> = async (
    service: string,
  ): Promise<Row> => {
    const found: Array<Row> = (await rows(OpenStackResourceKind.Api)).filter(
      (row: Row): boolean => {
        return row["name"] === service;
      },
    );
    expect(found).toHaveLength(1);
    return found[0] as Row;
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["OPENSTACK_INVENTORY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["OPENSTACK_INVENTORY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["OPENSTACK_INVENTORY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},pg_catalog` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
    );
  });

  beforeEach(async () => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    await database.query(`DELETE FROM "${schema}"."${TABLE}"`);
  });

  afterEach(() => {
    delete process.env["OPENSTACK_INVENTORY_STALE_MINUTES"];
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      try {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await database.destroy();
      }
    }
  });

  describe("a scrape can never give a cloud a service it does not run", () => {
    test("an empty answer and a failed one find no row, and make none", async () => {
      await record([
        scrape("orchestration", { samples: 0 }),
        scrape("container-infra", { answered: false, samples: 0 }),
      ]);
      expect(await rows()).toEqual([]);
    });

    test("on a real cloud's real OTLP: what it sent for a service it doesn't run changes nothing", async () => {
      const otlp: JSONObject = JSON.parse(
        fs.readFileSync(
          path.join(
            OPENSTACK_FIXTURES_FOLDER,
            "services-heat-magnum",
            "otlp.json",
          ),
          "utf8",
        ),
      ) as JSONObject;
      const buffer: Map<string, OpenStackOptionalServiceScrape> = new Map();
      for (const resourceMetrics of otlp["resourceMetrics"] as JSONArray) {
        for (const scope of (resourceMetrics as JSONObject)[
          "scopeMetrics"
        ] as JSONArray) {
          for (const metric of (scope as JSONObject)["metrics"] as JSONArray) {
            const name: string = (metric as JSONObject)["name"] as string;
            const gauge: JSONObject = ((metric as JSONObject)["gauge"] ||
              (metric as JSONObject)["sum"]) as JSONObject;
            for (const datapoint of gauge["dataPoints"] as JSONArray) {
              if (
                isOpenStackOptionalServiceScrapeDatapoint({
                  metricName: name,
                  datapoint: datapoint as JSONObject,
                })
              ) {
                bufferOpenStackOptionalServiceScrape({
                  metricName: name,
                  datapoint: datapoint as JSONObject,
                  buffer,
                });
              }
            }
          }
        }
      }
      expect(buffer.size).toBeGreaterThan(0);
      await record(Array.from(buffer.values()));
      expect(await rows()).toEqual([]);
    });
  });

  describe("on a row that is there", () => {
    test("a failed scrape reads down, and says the read failed", async () => {
      await write([api("orchestration", { lastSeenAt: minutesAgo(5) })]);
      await record([scrape("orchestration", { answered: false, samples: 0 })]);
      const row: Row = await apiRow("orchestration");
      expect(row["status"]).toBe("down");
      expect(row["facts"]["scrapeFailed"]).toBe(true);
      expect(new Date(row["stateChangedAt"]).getTime()).toBe(NOW.getTime());
    });

    test("the next good read brings it back", async () => {
      await write([api("orchestration", { lastSeenAt: minutesAgo(10) })]);
      await record([
        scrape("orchestration", {
          answered: false,
          samples: 0,
          observedAt: minutesAgo(5),
        }),
      ]);
      await write([api("orchestration")]);
      await record([scrape("orchestration")]);
      const row: Row = await apiRow("orchestration");
      expect(row["status"]).toBe("up");
      expect(row["facts"]["scrapeFailed"]).toBe(false);
    });

    test("a good read says how long it took, and leaves its state alone", async () => {
      await write([api("container-infra")]);
      const before: Row = await apiRow("container-infra");
      await record([scrape("container-infra", { seconds: 1.5 })]);
      const row: Row = await apiRow("container-infra");
      expect(row["facts"]["collectionSeconds"]).toBe(1.5);
      expect(row["status"]).toBe("up");
      expect(row["stateChangedAt"]).toEqual(before["stateChangedAt"]);
    });

    test("an empty answer writes when it started, once, and leaves its state alone", async () => {
      await write([api("orchestration")]);
      await record([
        scrape("orchestration", { samples: 0, observedAt: minutesAgo(10) }),
      ]);
      await record([scrape("orchestration", { samples: 0 })]);
      const row: Row = await apiRow("orchestration");
      expect(row["facts"][OPENSTACK_EMPTY_ANSWER_SINCE_FACT]).toBe(
        minutesAgo(10).toISOString(),
      );
      expect(row["status"]).toBe("up");
    });

    test("an answer with something in it forgets that", async () => {
      await write([api("orchestration")]);
      await record([scrape("orchestration", { samples: 0 })]);
      await record([scrape("orchestration", { samples: 38 })]);
      expect(
        (await apiRow("orchestration"))["facts"][
          OPENSTACK_EMPTY_ANSWER_SINCE_FACT
        ],
      ).toBeNull();
    });

    test("a failed scrape's zero is no empty answer: the two are different things", async () => {
      await write([api("orchestration")]);
      await record([scrape("orchestration", { answered: false, samples: 0 })]);
      expect(
        (await apiRow("orchestration"))["facts"][
          OPENSTACK_EMPTY_ANSWER_SINCE_FACT
        ],
      ).toBeUndefined();
    });

    test("another region's and another cloud's are left alone", async () => {
      await write([
        api("orchestration"),
        api("orchestration", { regionName: "RegionTwo" }),
      ]);
      await write([api("orchestration")], OTHER_CLOUD_ID);
      await record([scrape("orchestration", { answered: false, samples: 0 })]);

      const here: Array<Row> = await rows(OpenStackResourceKind.Api);
      expect(
        here
          .map((row: Row): Array<string> => {
            return [row["regionName"], row["status"]];
          })
          .sort(),
      ).toEqual([
        ["RegionOne", "down"],
        ["RegionTwo", "up"],
      ]);
      expect(
        (await rows(OpenStackResourceKind.Api, OTHER_CLOUD_ID))[0]!["status"],
      ).toBe("up");
    });
  });

  describe("a service that left the cloud", () => {
    const estate: () => Promise<void> = async (): Promise<void> => {
      await write([
        api(OpenStackServiceType.Identity, { vouchedAt: NOW }),
        api(OpenStackServiceType.Compute, { vouchedAt: NOW }),
        api("orchestration", {
          lastSeenAt: minutesAgo(30),
          vouchedAt: minutesAgo(30),
        }),
        stack("stack-a", { lastSeenAt: minutesAgo(30) }),
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: "RegionOne/orchestration/compute-01/heat-engine",
          name: "heat-engine",
          status: "up",
          facts: { family: "orchestration", host: "compute-01" },
          lastSeenAt: minutesAgo(30),
        }),
        resource({
          kind: OpenStackResourceKind.Instance,
          externalId: "an-instance",
          status: "ACTIVE",
          lastSeenAt: NOW,
        }),
      ]);
    };

    test("goes, whole, once the rest of the cloud has answered for the wait", async () => {
      await estate();
      await record([
        scrape("orchestration", { samples: 0, observedAt: minutesAgo(16) }),
      ]);
      await sweep();
      expect(
        (await rows(OpenStackResourceKind.Api)).map((row: Row): string => {
          return row["name"];
        }),
      ).toEqual(["compute", "identity"]);
      expect(await rows(OpenStackResourceKind.Stack)).toEqual([]);
      expect(await rows(OpenStackResourceKind.Service)).toEqual([]);
      expect(await rows(OpenStackResourceKind.Instance)).toHaveLength(1);
    });

    test("Manila's shares and services go with it, as Heat's do", async () => {
      await write([
        api(OpenStackServiceType.Compute),
        api(OpenStackServiceType.SharedFileSystems),
        share("a"),
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: "RegionOne/sharev2/compute-01/manila-share",
          name: "manila-share",
          status: "up",
          facts: { family: "sharev2" },
        }),
      ]);
      await record([
        scrape(OpenStackServiceType.SharedFileSystems, {
          samples: 0,
          observedAt: minutesAgo(16),
        }),
      ]);
      await sweep();
      expect(await rows(OpenStackResourceKind.Share)).toEqual([]);
      expect(await rows(OpenStackResourceKind.Service)).toEqual([]);
      expect(
        (await rows(OpenStackResourceKind.Api)).map((row: Row): string => {
          return row["name"];
        }),
      ).toEqual(["compute"]);
    });

    test("Manila stopped takes no shares: its _up reads 0, and that's no empty answer", async () => {
      await write([
        api(OpenStackServiceType.Compute),
        api(OpenStackServiceType.SharedFileSystems, {
          status: "down",
          vouchedAt: minutesAgo(90),
          lastSeenAt: NOW,
        }),
        share("a", { lastSeenAt: minutesAgo(90) }),
      ]);
      await record([
        scrape(OpenStackServiceType.SharedFileSystems, {
          samples: 1,
          observedAt: minutesAgo(1),
        }),
      ]);
      await sweep();
      expect(await rows(OpenStackResourceKind.Share)).toHaveLength(1);
    });

    test("waits while the rest of the cloud has answered for less than that", async () => {
      await estate();
      await record([
        scrape("orchestration", { samples: 0, observedAt: minutesAgo(10) }),
      ]);
      await sweep();
      expect(await rows(OpenStackResourceKind.Stack)).toHaveLength(1);
      expect((await apiRow("orchestration"))["name"]).toBe("orchestration");
    });

    test("a Keystone outage reads empty everywhere, and takes nothing", async () => {
      await write([
        api(OpenStackServiceType.Identity, {
          status: "down",
          vouchedAt: minutesAgo(90),
          lastSeenAt: minutesAgo(90),
        }),
        api(OpenStackServiceType.Compute, {
          vouchedAt: minutesAgo(90),
          lastSeenAt: minutesAgo(90),
        }),
        api("orchestration", {
          vouchedAt: minutesAgo(90),
          lastSeenAt: minutesAgo(90),
        }),
        stack("stack-a", { lastSeenAt: minutesAgo(90) }),
      ]);
      await record([
        scrape("orchestration", { samples: 0, observedAt: minutesAgo(60) }),
      ]);
      await sweep();
      expect(await rows(OpenStackResourceKind.Stack)).toHaveLength(1);
      expect(await rows(OpenStackResourceKind.Api)).toHaveLength(3);
    });

    test("a service that came back keeps everything", async () => {
      await estate();
      await record([
        scrape("orchestration", { samples: 0, observedAt: minutesAgo(16) }),
      ]);
      await record([scrape("orchestration", { samples: 38 })]);
      await sweep();
      expect(await rows(OpenStackResourceKind.Stack)).toHaveLength(1);
    });

    test("a failing scrape takes nothing, however long it lasts", async () => {
      await estate();
      await record([
        scrape("orchestration", {
          answered: false,
          samples: 0,
          observedAt: minutesAgo(600),
        }),
      ]);
      await sweep();
      expect(await rows(OpenStackResourceKind.Stack)).toHaveLength(1);
      expect((await apiRow("orchestration"))["status"]).toBe("down");
    });

    test("each region answers for itself", async () => {
      await write([
        api(OpenStackServiceType.Compute),
        api(OpenStackServiceType.Compute, { regionName: "RegionTwo" }),
        api("orchestration"),
        api("orchestration", { regionName: "RegionTwo" }),
        stack("in-one"),
        stack("in-two", { regionName: "RegionTwo" }),
      ]);
      await record([
        scrape("orchestration", { samples: 0, observedAt: minutesAgo(20) }),
      ]);
      await sweep();
      expect(
        (await rows(OpenStackResourceKind.Stack)).map((row: Row): string => {
          return row["externalId"];
        }),
      ).toEqual(["in-two"]);
    });

    test("its row in the summary and the menu's list goes with it", async () => {
      await estate();
      expect(await optionalServicesOf(CLOUD_ID)).toEqual(["orchestration"]);
      await record([
        scrape("orchestration", { samples: 0, observedAt: minutesAgo(16) }),
      ]);
      await sweep();
      expect(await optionalServicesOf(CLOUD_ID)).toEqual([]);
    });
  });

  describe("a service whose stopped API reads as an empty answer", () => {
    test("an empty answer writes nothing, however long, so its rows go only with forgetQuietServices", async () => {
      await write([
        api("identity"),
        api("baremetal", {
          lastSeenAt: minutesAgo(60),
          vouchedAt: minutesAgo(60),
        }),
      ]);
      await record([
        scrape("baremetal", { samples: 0, observedAt: minutesAgo(600) }),
        scrape("baremetal", { samples: 0, observedAt: NOW }),
      ]);
      await sweep();

      expect(
        (await apiRow("baremetal"))["facts"][OPENSTACK_EMPTY_ANSWER_SINCE_FACT],
      ).toBeUndefined();
    });
  });

  describe("a service's parts answer to its own API, as every other's do", () => {
    test("a stack it stopped listing goes once Heat has answered without it", async () => {
      await write([
        api("orchestration"),
        stack("gone", { lastSeenAt: minutesAgo(20) }),
        stack("still-here"),
      ]);
      await sweep();
      expect(
        (await rows(OpenStackResourceKind.Stack)).map((row: Row): string => {
          return row["externalId"];
        }),
      ).toEqual(["still-here"]);
    });

    test("Heat down takes no stacks, however long", async () => {
      await write([
        api("orchestration", {
          status: "down",
          vouchedAt: minutesAgo(600),
        }),
        stack("kept", { lastSeenAt: minutesAgo(600) }),
      ]);
      await sweep();
      expect(await rows(OpenStackResourceKind.Stack)).toHaveLength(1);
    });

    test("Magnum answers for its clusters and its conductors, and Heat for neither", async () => {
      await write([
        api("orchestration"),
        cluster("a-cluster", { lastSeenAt: minutesAgo(20) }),
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: "RegionOne/container-infra/compute-01/magnum-conductor",
          name: "magnum-conductor",
          status: "up",
          facts: { family: "container-infra" },
          lastSeenAt: minutesAgo(20),
        }),
      ]);
      await sweep();
      expect(await rows(OpenStackResourceKind.ContainerCluster)).toHaveLength(
        1,
      );
      expect(await rows(OpenStackResourceKind.Service)).toHaveLength(1);

      await write([api("container-infra")]);
      await sweep();
      expect(await rows(OpenStackResourceKind.ContainerCluster)).toEqual([]);
      expect(await rows(OpenStackResourceKind.Service)).toEqual([]);
    });
  });

  describe("a cluster's project", () => {
    test("is its stack's, on what a real cloud recorded", async () => {
      const series: ReturnType<typeof readRecordedSeries> = readRecordedSeries(
        path.join(
          OPENSTACK_FIXTURES_FOLDER,
          "services-heat-magnum",
          "access-check",
          "exporter",
          "admin",
        ),
      );
      await write(
        scanRecordedSeries(series, NOW.getTime()).map(
          toParsedOpenStackResource,
        ),
      );
      await OpenStackResourceService.reconcileContainerClusterProjects({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
      });
      const [row]: Array<Row> = await rows(
        OpenStackResourceKind.ContainerCluster,
      );
      expect(row!["name"]).toBe("ou-cluster-real");
      expect(row!["openStackProjectId"]).toBe(
        "5d1838ef05294dd9a804e284b9f21617",
      );
    });

    test("whichever arrives first, since they are separate batches", async () => {
      await write([cluster("c", { facts: { stackId: "s" } })]);
      await OpenStackResourceService.reconcileContainerClusterProjects({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
      });
      expect(
        (await rows(OpenStackResourceKind.ContainerCluster))[0]![
          "openStackProjectId"
        ],
      ).toBeNull();

      await write([stack("s", { openStackProjectId: "p1" })]);
      await OpenStackResourceService.reconcileContainerClusterProjects({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
      });
      expect(
        (await rows(OpenStackResourceKind.ContainerCluster))[0]![
          "openStackProjectId"
        ],
      ).toBe("p1");
    });

    test("what a probe read from Magnum itself is left alone", async () => {
      await write([
        cluster("c", {
          openStackProjectId: "from-magnum",
          facts: { stackId: "s" },
        }),
        stack("s", { openStackProjectId: "from-heat" }),
      ]);
      await OpenStackResourceService.reconcileContainerClusterProjects({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
      });
      expect(
        (await rows(OpenStackResourceKind.ContainerCluster))[0]![
          "openStackProjectId"
        ],
      ).toBe("from-magnum");
    });

    test("a stack with no project says nothing, and neither does a cluster with no stack", async () => {
      await write([
        cluster("no-stack"),
        cluster("no-project", { facts: { stackId: "s" } }),
        stack("s"),
      ]);
      await OpenStackResourceService.reconcileContainerClusterProjects({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
      });
      for (const row of await rows(OpenStackResourceKind.ContainerCluster)) {
        expect(row["openStackProjectId"]).toBeNull();
      }
    });

    test("never from another cloud's stack of the same ID", async () => {
      await write([cluster("c", { facts: { stackId: "s" } })]);
      await write(
        [stack("s", { openStackProjectId: "theirs" })],
        OTHER_CLOUD_ID,
      );
      await OpenStackResourceService.reconcileContainerClusterProjects({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
      });
      expect(
        (await rows(OpenStackResourceKind.ContainerCluster))[0]![
          "openStackProjectId"
        ],
      ).toBeNull();
    });
  });

  describe("what needs someone", () => {
    const attention: () => Promise<OpenStackAttentionRows> =
      async (): Promise<OpenStackAttentionRows> => {
        return await OpenStackResourceService.getAttentionRows({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
          now: NOW,
        });
      };

    const namesOf: (
      read: OpenStackAttentionRows,
      kind: OpenStackResourceKind,
    ) => Array<string> = (
      read: OpenStackAttentionRows,
      kind: OpenStackResourceKind,
    ): Array<string> => {
      return read.rows
        .filter((row: JSONObject): boolean => {
          return row["kind"] === kind;
        })
        .map((row: JSONObject): string => {
          return row["name"] as string;
        })
        .sort();
    };

    test("a failed stack, whatever it failed at, and one stuck past the line", async () => {
      const longAgo: Date = minutesAgo(OPENSTACK_STACK_STUCK_MINUTES);
      await write([
        stack("ok"),
        stack("create-failed", { status: "CREATE_FAILED" }),
        stack("update-failed", { status: "UPDATE_FAILED" }),
        stack("delete-failed", { status: "DELETE_FAILED" }),
        stack("just-started", { status: "CREATE_IN_PROGRESS" }),
        stack("stuck", {
          status: "UPDATE_IN_PROGRESS",
          lastSeenAt: longAgo,
        }),
      ]);
      expect(namesOf(await attention(), OpenStackResourceKind.Stack)).toEqual([
        "create-failed",
        "delete-failed",
        "stuck",
        "update-failed",
      ]);
    });

    test("a failed cluster, one stuck past the line, and one Magnum calls unhealthy", async () => {
      const longAgo: Date = minutesAgo(
        OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES,
      );
      await write([
        cluster("ok"),
        cluster("unknown-health", { facts: { healthStatus: "UNKNOWN" } }),
        cluster("failed", { status: "CREATE_FAILED" }),
        cluster("just-started", { status: "CREATE_IN_PROGRESS" }),
        cluster("stuck", {
          status: "CREATE_IN_PROGRESS",
          lastSeenAt: longAgo,
        }),
        cluster("unhealthy", { facts: { healthStatus: "UNHEALTHY" } }),
      ]);
      expect(
        namesOf(await attention(), OpenStackResourceKind.ContainerCluster),
      ).toEqual(["failed", "stuck", "unhealthy"]);
    });

    test("a share in error, and one stuck past the line, and none that is on its way or migrating", async () => {
      const longAgo: Date = minutesAgo(OPENSTACK_SHARE_STUCK_MINUTES);
      await write([
        share("ok"),
        share("in-error", { status: "error" }),
        share("extend-failed", { status: "extending_error" }),
        share("just-started", { status: "creating" }),
        share("stuck", { status: "creating", lastSeenAt: longAgo }),
        share("migrating", { status: "migrating", lastSeenAt: longAgo }),
        share("off", { status: "inactive", lastSeenAt: longAgo }),
      ]);
      expect(namesOf(await attention(), OpenStackResourceKind.Share)).toEqual([
        "extend-failed",
        "in-error",
        "stuck",
      ]);
    });

    test("a database in error, one stuck past the line, one nearly full, and no other", async () => {
      const longAgo: Date = minutesAgo(
        OPENSTACK_DATABASE_INSTANCE_STUCK_MINUTES,
      );
      const size: number = 10 * 1024 * 1024 * 1024;
      await write([
        troveInstance("ok", {
          diskCapacityBytes: size,
          diskAllocatedBytes: size / 2,
        }),
        troveInstance("in-error", { status: "ERROR" }),
        troveInstance("failed", { status: "FAILED" }),
        troveInstance("just-started", { status: "BUILD" }),
        troveInstance("stuck", { status: "BUILD", lastSeenAt: longAgo }),
        troveInstance("backing-up", { status: "BACKUP", lastSeenAt: longAgo }),
        troveInstance("nearly-full", {
          diskCapacityBytes: size,
          diskAllocatedBytes: size * 0.9,
        }),
        troveInstance("not-running", {
          status: "SHUTDOWN",
          diskCapacityBytes: size,
          diskAllocatedBytes: 0,
        }),
      ]);
      expect(
        namesOf(await attention(), OpenStackResourceKind.DatabaseInstance),
      ).toEqual(["failed", "in-error", "nearly-full", "stuck"]);
    });

    test("a zone in error, one pending past the line, and no other; and a recordset in error", async () => {
      const longAgo: Date = minutesAgo(
        OPENSTACK_DNS_ZONE_PENDING_STUCK_MINUTES,
      );
      await write([
        dnsZone("ok"),
        dnsZone("in-error", { status: "ERROR" }),
        dnsZone("just-changed", { status: "PENDING" }),
        dnsZone("stuck", { status: "PENDING", lastSeenAt: longAgo }),
        dnsRecordset("broken"),
        dnsRecordset("on-its-way", { status: "PENDING" }),
      ]);
      const read: OpenStackAttentionRows = await attention();
      expect(namesOf(read, OpenStackResourceKind.DnsZone)).toEqual([
        "in-error",
        "stuck",
      ]);
      expect(namesOf(read, OpenStackResourceKind.DnsRecordset)).toEqual([
        "broken",
      ]);
    });

    test("Gnocchi with no processors, or a backlog past the line, though its API reads up", async () => {
      await write([
        api(OpenStackServiceType.Metric, {
          facts: {
            metricdProcessors: 0,
            measuresToProcess: 5,
            vouchedAt: minutesAgo(1),
          },
        }),
        api(OpenStackServiceType.Metric, {
          regionName: "RegionTwo",
          facts: {
            metricdProcessors: 4,
            measuresToProcess: OPENSTACK_GNOCCHI_BACKLOG_WARNING_MEASURES + 1,
            vouchedAt: minutesAgo(1),
          },
        }),
        api(OpenStackServiceType.Metric, {
          regionName: "RegionThree",
          facts: {
            metricdProcessors: 4,
            measuresToProcess: OPENSTACK_GNOCCHI_BACKLOG_WARNING_MEASURES,
            vouchedAt: minutesAgo(1),
          },
        }),
        // A number of another service's facts says nothing.
        api(OpenStackServiceType.Orchestration, {
          facts: { metricdProcessors: 0, vouchedAt: minutesAgo(1) },
        }),
      ]);
      expect(
        (await attention()).rows
          .filter((row: JSONObject): boolean => {
            return row["kind"] === OpenStackResourceKind.Api;
          })
          .map((row: JSONObject): string => {
            return `${row["name"]} ${row["regionName"]}`;
          })
          .sort(),
      ).toEqual(["gnocchi RegionOne", "gnocchi RegionTwo"]);
    });

    test("a project's own page reads its stacks and clusters too", async () => {
      await write([
        stack("mine", { status: "CREATE_FAILED", openStackProjectId: "p1" }),
        stack("theirs", { status: "CREATE_FAILED", openStackProjectId: "p2" }),
        cluster("my-cluster", {
          status: "CREATE_FAILED",
          openStackProjectId: "p1",
        }),
      ]);
      const read: OpenStackAttentionRows =
        await OpenStackResourceService.getAttentionRows({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
          now: NOW,
          openStackProjectIds: ["p1"],
        });
      expect(namesOf(read, OpenStackResourceKind.Stack)).toEqual(["mine"]);
      expect(namesOf(read, OpenStackResourceKind.ContainerCluster)).toEqual([
        "my-cluster",
      ]);
    });
  });

  describe("what a cloud holds", () => {
    test("the summary counts them, in each region, and a cloud without them reads 0", async () => {
      await write([
        api("orchestration"),
        stack("one"),
        stack("two", { regionName: "RegionTwo" }),
        cluster("c"),
      ]);
      const whole: OpenStackInventorySummary =
        await OpenStackResourceService.getInventorySummary({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
        });
      expect(whole.stackCount).toBe(2);
      expect(whole.containerClusterCount).toBe(1);

      const region: OpenStackInventorySummary =
        await OpenStackResourceService.getInventorySummary({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
          regionName: "RegionTwo",
        });
      expect(region.stackCount).toBe(1);
      expect(region.containerClusterCount).toBe(0);

      const other: OpenStackInventorySummary =
        await OpenStackResourceService.getInventorySummary({
          projectId: PROJECT_ID,
          openStackCloudId: OTHER_CLOUD_ID,
        });
      expect(other.stackCount).toBe(0);
    });

    test("a cloud runs what its API rows say, in the region being read, and nothing core counts", async () => {
      await write([
        api(OpenStackServiceType.Compute),
        api(OpenStackServiceType.Compute, { regionName: "RegionTwo" }),
        api("orchestration"),
        api("container-infra", { regionName: "RegionTwo" }),
      ]);
      expect((await optionalServicesOf(CLOUD_ID)).sort()).toEqual([
        "container-infra",
        "orchestration",
      ]);
      expect(await optionalServicesOf(CLOUD_ID, "RegionTwo")).toEqual([
        "container-infra",
      ]);
      expect(await optionalServicesOf(OTHER_CLOUD_ID)).toEqual([]);
    });

    test("the summary counts Trove's databases, and says which services have never let this credential in", async () => {
      await write([
        api(OpenStackServiceType.Database, {
          status: "down",
          facts: {},
        }),
        api(OpenStackServiceType.SharedFileSystems, {
          status: "down",
          facts: {},
        }),
        api(OpenStackServiceType.Orchestration),
        troveInstance("one"),
      ]);
      const summary: OpenStackInventorySummary =
        await OpenStackResourceService.getInventorySummary({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
        });
      expect(summary.databaseInstanceCount).toBe(1);
      // Manila reads 1 for every credential that can log in, so down is down there.
      expect(summary.closedServices).toEqual([OpenStackServiceType.Database]);
    });

    test("the summary counts Designate's zones, and a refusal never read up is closed, as Trove's is", async () => {
      await write([
        api(OpenStackServiceType.Dns, { status: "down", facts: {} }),
        dnsZone("one"),
        dnsRecordset("not-counted"),
      ]);
      const summary: OpenStackInventorySummary =
        await OpenStackResourceService.getInventorySummary({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
        });
      expect(summary.dnsZoneCount).toBe(1);
      expect(summary.closedServices).toEqual([OpenStackServiceType.Dns]);
    });

    test("one that has read up once is down, and not closed", async () => {
      await write([
        api(OpenStackServiceType.Database, {
          status: "down",
          vouchedAt: minutesAgo(30),
        }),
      ]);
      expect(
        (
          await OpenStackResourceService.getInventorySummary({
            projectId: PROJECT_ID,
            openStackCloudId: CLOUD_ID,
          })
        ).closedServices,
      ).toEqual([]);
    });

    test("a project's summary counts its databases", async () => {
      await write([
        troveInstance("one", { openStackProjectId: "p1" }),
        troveInstance("theirs", { openStackProjectId: "p2" }),
      ]);
      const [summary] = await OpenStackResourceService.getProjectSummaries({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        openStackProjectIds: ["p1"],
      });
      expect(summary).toMatchObject({ databaseInstanceCount: 1 });
    });

    test("the summary counts Manila's shares, and a cloud without Manila reads 0", async () => {
      await write([
        api(OpenStackServiceType.SharedFileSystems),
        share("one"),
        share("two", { regionName: "RegionTwo" }),
      ]);
      const whole: OpenStackInventorySummary =
        await OpenStackResourceService.getInventorySummary({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
        });
      expect(whole.shareCount).toBe(2);
      expect(await optionalServicesOf(CLOUD_ID)).toEqual([
        OpenStackServiceType.SharedFileSystems,
      ]);

      const region: OpenStackInventorySummary =
        await OpenStackResourceService.getInventorySummary({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
          regionName: "RegionTwo",
        });
      expect(region.shareCount).toBe(1);

      expect(
        (
          await OpenStackResourceService.getInventorySummary({
            projectId: PROJECT_ID,
            openStackCloudId: OTHER_CLOUD_ID,
          })
        ).shareCount,
      ).toBe(0);
    });

    test("a project's summary counts its shares", async () => {
      await write([
        share("one", { openStackProjectId: "p1" }),
        share("two", { openStackProjectId: "p1" }),
        share("theirs", { openStackProjectId: "p2" }),
      ]);
      const [summary] = await OpenStackResourceService.getProjectSummaries({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        openStackProjectIds: ["p1"],
      });
      expect(summary).toMatchObject({ shareCount: 2 });
    });

    test("a project's summary counts its stacks and clusters", async () => {
      await write([
        stack("one", { openStackProjectId: "p1" }),
        stack("two", { openStackProjectId: "p1" }),
        cluster("c", { openStackProjectId: "p1" }),
        cluster("nobodys"),
      ]);
      const [summary] = await OpenStackResourceService.getProjectSummaries({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        openStackProjectIds: ["p1"],
      });
      expect(summary).toMatchObject({
        stackCount: 2,
        containerClusterCount: 1,
      });
    });
  });

  describe("what a failure takes with it", () => {
    const radiusOf: (part: {
      kind: OpenStackResourceKind;
      name?: string | undefined;
      externalId?: string | undefined;
      facts?: JSONObject | undefined;
    }) => Promise<OpenStackBlastRadius> = async (part: {
      kind: OpenStackResourceKind;
      name?: string | undefined;
      externalId?: string | undefined;
      facts?: JSONObject | undefined;
    }): Promise<OpenStackBlastRadius> => {
      return await OpenStackResourceService.getBlastRadius({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        part: { ...part, regionName: "RegionOne" },
      });
    };

    test("Heat's API reaches its stacks, by project", async () => {
      await write([
        stack("a", { openStackProjectId: "p1" }),
        stack("b", { openStackProjectId: "p1" }),
        stack("c", { openStackProjectId: "p2" }),
        stack("elsewhere", { regionName: "RegionTwo" }),
      ]);
      const radius: OpenStackBlastRadius = await radiusOf({
        kind: OpenStackResourceKind.Api,
        name: "orchestration",
      });
      expect(radius.stackCount).toBe(3);
      expect(radius.projectCount).toBe(2);
      expect(radius.projects[0]).toMatchObject({
        projectId: "p1",
        stackCount: 2,
      });
    });

    test("Manila's API reaches its shares, by project, in its own region", async () => {
      await write([
        share("a", { openStackProjectId: "p1" }),
        share("b", { openStackProjectId: "p1" }),
        share("c", { openStackProjectId: "p2" }),
        share("elsewhere", { regionName: "RegionTwo" }),
      ]);
      const radius: OpenStackBlastRadius = await radiusOf({
        kind: OpenStackResourceKind.Api,
        name: OpenStackServiceType.SharedFileSystems,
      });
      expect(radius.shareCount).toBe(3);
      expect(radius.projectCount).toBe(2);
      expect(radius.projects[0]).toMatchObject({
        projectId: "p1",
        shareCount: 2,
      });
    });

    test("Designate's API reaches its zones, by project", async () => {
      await write([
        dnsZone("a", { openStackProjectId: "p1" }),
        dnsZone("b", { openStackProjectId: "p2" }),
        dnsZone("elsewhere", { regionName: "RegionTwo" }),
      ]);
      const radius: OpenStackBlastRadius = await radiusOf({
        kind: OpenStackResourceKind.Api,
        name: OpenStackServiceType.Dns,
      });
      expect(radius.dnsZoneCount).toBe(2);
      expect(radius.projectCount).toBe(2);
    });

    test("Trove's API reaches its databases, by project", async () => {
      await write([
        troveInstance("a", { openStackProjectId: "p1" }),
        troveInstance("b", { openStackProjectId: "p2" }),
      ]);
      const radius: OpenStackBlastRadius = await radiusOf({
        kind: OpenStackResourceKind.Api,
        name: OpenStackServiceType.Database,
      });
      expect(radius.databaseInstanceCount).toBe(2);
      expect(radius.projectCount).toBe(2);
    });

    test("Magnum's API reaches its clusters", async () => {
      await write([cluster("a"), cluster("b")]);
      expect(
        (
          await radiusOf({
            kind: OpenStackResourceKind.Api,
            name: "container-infra",
          })
        ).containerClusterCount,
      ).toBe(2);
    });

    test("a stack names the cluster it was built for, and a cluster its stack", async () => {
      await write([
        cluster("the-cluster", { facts: { stackId: "the-stack" } }),
        stack("the-stack", { status: "CREATE_FAILED" }),
        stack("anothers"),
      ]);
      expect(
        (
          await radiusOf({
            kind: OpenStackResourceKind.Stack,
            externalId: "the-stack",
          })
        ).belongsTo,
      ).toEqual([
        {
          kind: OpenStackResourceKind.ContainerCluster,
          externalId: "the-cluster",
          name: "the-cluster",
          status: "CREATE_COMPLETE",
        },
      ]);
      expect(
        (
          await radiusOf({
            kind: OpenStackResourceKind.ContainerCluster,
            externalId: "the-cluster",
            facts: { stackId: "the-stack" },
          })
        ).belongsTo,
      ).toEqual([
        {
          kind: OpenStackResourceKind.Stack,
          externalId: "the-stack",
          name: "the-stack",
          status: "CREATE_FAILED",
        },
      ]);
    });

    test("a stack nobody's cluster names belongs to nothing", async () => {
      await write([stack("alone")]);
      const radius: OpenStackBlastRadius = await radiusOf({
        kind: OpenStackResourceKind.Stack,
        externalId: "alone",
      });
      expect(radius.belongsTo).toEqual([]);
      expect(radius.isKnown).toBe(true);
    });

    test("two clusters naming one stack is two guesses, so it names neither", async () => {
      await write([
        cluster("one", { facts: { stackId: "s" } }),
        cluster("two", { facts: { stackId: "s" } }),
        stack("s"),
      ]);
      expect(
        (
          await radiusOf({
            kind: OpenStackResourceKind.Stack,
            externalId: "s",
          })
        ).belongsTo,
      ).toEqual([]);
    });
  });
});
