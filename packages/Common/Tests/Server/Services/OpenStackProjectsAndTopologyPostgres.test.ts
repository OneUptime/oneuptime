import { DataSource } from "typeorm";
import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import OpenStackResourceService, {
  OpenStackAttentionRows,
  OpenStackDomainSummary,
  OpenStackProjectOverview,
  OpenStackProjectSummary,
  OpenStackTopologyRead,
  ParsedOpenStackResource,
} from "../../../Server/Services/OpenStackResourceService";
import logger from "../../../Server/Utils/Logger";
import OpenStackAlertContext from "../../../Server/Utils/OpenStack/OpenStackAlertContext";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { OpenStackBlastRadius } from "../../../Types/OpenStack/OpenStackBlastRadius";
import {
  OPENSTACK_QUOTA_STALE_MINUTES,
  OpenStackQuotaResource,
  getOpenStackQuotaFactKey,
} from "../../../Types/OpenStack/OpenStackQuota";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import { OPENSTACK_TOPOLOGY_FULL_PART_LIMIT } from "../../../Types/OpenStack/OpenStackTopology";

/*
 * The reads the Projects, Domains and Topology pages stand on, on Postgres: hand-written
 * SQL over the facts column, which only a real database can prove. Opt in the way
 * OpenStackResourcePostgres.test.ts does (RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS=true and
 * OPENSTACK_INVENTORY_TEST_DATABASE_*), against a database with the migrations applied.
 *
 * What it pins:
 *   - a project at a quota is what Needs attention picks, on both sides of the line, and
 *     what was read too long ago or has no limit is not;
 *   - a quota fact from each service survives the others', as the upsert merges them;
 *   - a page of projects reads what each runs, and one project's own page reads the
 *     hosts down under it and its labels;
 *   - a blast radius reaches the instances a pool's volumes are attached to, and every
 *     project in a region when its API is down;
 *   - the map reads everything of a small cloud, and past the stated size only what has
 *     failed and what that affects: 5,000 hypervisors and 100,000 instances within a
 *     stated budget.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "OpenStackResource";
const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

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

function project(
  id: string,
  facts: JSONObject = {},
  name: string = id,
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.Project,
    externalId: id,
    name,
    regionName: null,
    openStackProjectId: id,
    status: "enabled",
    facts: { domainId: "default", ...facts },
  });
}

function quota(data: {
  used: number;
  limit: number;
  resource?: OpenStackQuotaResource;
  minutesAgo?: number;
}): JSONObject {
  return {
    [getOpenStackQuotaFactKey(
      data.resource || OpenStackQuotaResource.Instances,
      "RegionOne",
    )]: {
      used: data.used,
      limit: data.limit,
      observedAt: new Date(
        NOW.getTime() - (data.minutesAgo || 0) * 60 * 1000,
      ).toISOString(),
    },
  };
}

function instance(
  id: string,
  owner: string,
  host: string,
  fields: Partial<ParsedOpenStackResource> = {},
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.Instance,
    externalId: id,
    name: id,
    openStackProjectId: owner,
    hypervisorName: host,
    status: "ACTIVE",
    ...fields,
  });
}

function hypervisor(
  name: string,
  fields: Partial<ParsedOpenStackResource> = {},
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.Hypervisor,
    externalId: `RegionOne/${name}`,
    name,
    hypervisorName: name,
    status: "up",
    adminState: "enabled",
    ...fields,
  });
}

describePostgres(
  "what the Projects and Topology pages read, on Postgres",
  () => {
    const schema: string = `openstack_projects_${Date.now()}`;
    let database: DataSource;

    const write = async (
      resources: Array<ParsedOpenStackResource>,
    ): Promise<void> => {
      await OpenStackResourceService.bulkUpsert({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        resources,
      });
    };

    const attention = async (): Promise<OpenStackAttentionRows> => {
      return await OpenStackResourceService.getAttentionRows({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        now: NOW,
      });
    };

    const projectsOnAttention = async (): Promise<Array<string>> => {
      return (await attention()).rows
        .filter((row: JSONObject): boolean => {
          return row["kind"] === OpenStackResourceKind.Project;
        })
        .map((row: JSONObject): string => {
          return String(row["externalId"]);
        })
        .sort();
    };

    const scope: { projectId: ObjectID; openStackCloudId: ObjectID } = {
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
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
    }, 600000);

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      await database.query(`DELETE FROM "${schema}"."${TABLE}"`);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    afterAll(async () => {
      await database.query(`DROP SCHEMA "${schema}" CASCADE`);
      await database.destroy();
    });

    describe("a project at a quota, as Needs attention picks it", () => {
      test("on both sides of the line, the same way the rules read it", async () => {
        await write([
          project("under", quota({ used: 89, limit: 100 })),
          project("on", quota({ used: 9, limit: 10 })),
          project("past", quota({ used: 101, limit: 100 })),
          project("no-data"),
        ]);

        expect(await projectsOnAttention()).toEqual(["on", "past"]);
      });

      test("no limit, or a limit of none, is never at anything", async () => {
        await write([
          project("unlimited", quota({ used: 100000, limit: -1 })),
          project("none-allowed", quota({ used: 0, limit: 0 })),
        ]);

        expect(await projectsOnAttention()).toEqual([]);
      });

      test("a reading nobody has taken for a while says nothing", async () => {
        await write([
          project(
            "old",
            quota({
              used: 10,
              limit: 10,
              minutesAgo: OPENSTACK_QUOTA_STALE_MINUTES + 1,
            }),
          ),
          project(
            "fresh",
            quota({
              used: 10,
              limit: 10,
              minutesAgo: OPENSTACK_QUOTA_STALE_MINUTES - 1,
            }),
          ),
        ]);

        expect(await projectsOnAttention()).toEqual(["fresh"]);
      });

      test("any quota of several at the line is enough", async () => {
        await write([
          project("mixed", {
            ...quota({ used: 1, limit: 100 }),
            ...quota({
              used: 99,
              limit: 100,
              resource: OpenStackQuotaResource.Ports,
            }),
          }),
        ]);

        expect(await projectsOnAttention()).toEqual(["mixed"]);
      });

      test("one bad fact does not fail the read, and is not a quota", async () => {
        await write([
          project("odd", {
            "quota:instances:RegionOne": { used: "a lot", limit: "many" },
            "quota:cores:RegionOne": 5,
            "quota:ports:RegionOne": { used: 1 },
          }),
          project("on", quota({ used: 10, limit: 10 })),
        ]);

        expect(await projectsOnAttention()).toEqual(["on"]);
      });

      test("each service's reading survives the next one's", async () => {
        await write([project("p", quota({ used: 10, limit: 10 }))]);
        await write([
          resource({
            kind: OpenStackResourceKind.Project,
            externalId: "p",
            regionName: null,
            openStackProjectId: "p",
            lastSeenAt: new Date(NOW.getTime() + 1000),
            facts: quota({
              used: 1,
              limit: 100,
              resource: OpenStackQuotaResource.Ports,
            }),
          }),
        ]);

        const rows: Array<{ facts: JSONObject; status: string; name: string }> =
          await database.query(
            `SELECT "facts", "status", "name" FROM "${schema}"."${TABLE}"
           WHERE "externalId" = 'p'`,
          );

        expect(Object.keys(rows[0]!.facts).sort()).toEqual([
          "domainId",
          "quota:instances:RegionOne",
          "quota:ports:RegionOne",
        ]);
        // A quota read says nothing about Keystone's own words for the row.
        expect(rows[0]!.status).toBe("enabled");
        expect(rows[0]!.name).toBe("p");
        expect(await projectsOnAttention()).toEqual(["p"]);
      });
    });

    describe("a page of projects", () => {
      beforeEach(async () => {
        await write([
          project("p-payments"),
          project("p-research"),
          project("p-empty"),
          instance("i-1", "p-payments", "h-1"),
          instance("i-2", "p-payments", "h-1", { status: "SHUTOFF" }),
          instance("i-3", "p-research", "h-1"),
          resource({
            kind: OpenStackResourceKind.Volume,
            externalId: "v-1",
            openStackProjectId: "p-payments",
            status: "in-use",
          }),
          resource({
            kind: OpenStackResourceKind.Network,
            externalId: "n-1",
            openStackProjectId: "p-payments",
          }),
          resource({
            kind: OpenStackResourceKind.Router,
            externalId: "r-1",
            openStackProjectId: "p-payments",
          }),
          resource({
            kind: OpenStackResourceKind.FloatingIp,
            externalId: "f-1",
            openStackProjectId: "p-payments",
          }),
        ]);
      });

      test("reads what each runs, and a project running nothing reads as that", async () => {
        const summaries: Array<OpenStackProjectSummary> =
          await OpenStackResourceService.getProjectSummaries({
            ...scope,
            openStackProjectIds: ["p-payments", "p-empty"],
          });

        expect(summaries).toEqual([
          {
            projectId: "p-payments",
            instanceCount: 2,
            activeInstanceCount: 1,
            volumeCount: 1,
            networkCount: 1,
            routerCount: 1,
            floatingIpCount: 1,
          },
          {
            projectId: "p-empty",
            instanceCount: 0,
            activeInstanceCount: 0,
            volumeCount: 0,
            networkCount: 0,
            routerCount: 0,
            floatingIpCount: 0,
          },
        ]);
      });

      test("asks for nothing when there is nothing to ask", async () => {
        expect(
          await OpenStackResourceService.getProjectSummaries({
            ...scope,
            openStackProjectIds: [],
          }),
        ).toEqual([]);
      });

      test("what needs someone is only theirs, and no service or host is", async () => {
        await write([
          instance("i-bad", "p-payments", "h-1", { status: "ERROR" }),
          instance("i-other-bad", "p-research", "h-1", { status: "ERROR" }),
          resource({
            kind: OpenStackResourceKind.Service,
            externalId: "RegionOne/compute/h-1/nova-compute",
            name: "nova-compute",
            status: "down",
            facts: { family: "compute", host: "h-1" },
          }),
        ]);

        const rows: OpenStackAttentionRows =
          await OpenStackResourceService.getAttentionRows({
            ...scope,
            now: NOW,
            openStackProjectIds: ["p-payments"],
          });

        expect(
          rows.rows.map((row: JSONObject) => {
            return row["externalId"];
          }),
        ).toEqual(["i-bad"]);
      });
    });

    describe("one project's page", () => {
      test("says which hosts are down under it, and how many of its instances", async () => {
        await write([
          project("p-payments"),
          hypervisor("h-down", { status: "down" }),
          hypervisor("h-up"),
          hypervisor("h-disabled", { status: "down", adminState: "disabled" }),
          instance("i-1", "p-payments", "h-down"),
          instance("i-2", "p-payments", "h-down"),
          instance("i-3", "p-payments", "h-up"),
          instance("i-4", "p-payments", "h-disabled"),
          instance("i-5", "p-research", "h-down"),
        ]);

        const overview: OpenStackProjectOverview =
          await OpenStackResourceService.getProjectOverview({
            ...scope,
            openStackProjectId: "p-payments",
            now: NOW,
          });

        expect(overview.hostsDown).toEqual([
          {
            hypervisorName: "h-down",
            regionName: "RegionOne",
            externalId: "RegionOne/h-down",
            instanceCount: 2,
          },
        ]);
        expect(overview.summary.instanceCount).toBe(4);
      });

      test("gathers the labels its instances carry", async () => {
        await write([
          project("p-payments"),
          instance("i-1", "p-payments", "h-1", {
            facts: { labels: { team: "payments" } },
          }),
          instance("i-2", "p-payments", "h-1", {
            facts: { labels: { team: "payments", tier: "gold" } },
          }),
          instance("i-3", "p-payments", "h-1", { facts: { labels: {} } }),
          instance("i-4", "p-payments", "h-1", { facts: { labels: "odd" } }),
          instance("i-5", "p-payments", "h-1"),
        ]);

        const overview: OpenStackProjectOverview =
          await OpenStackResourceService.getProjectOverview({
            ...scope,
            openStackProjectId: "p-payments",
            now: NOW,
          });

        expect(overview.labels).toEqual([
          { key: "team", value: "payments", instanceCount: 2 },
          { key: "tier", value: "gold", instanceCount: 1 },
        ]);
      });
    });

    describe("domains", () => {
      beforeEach(async () => {
        await write([
          project("p-1"),
          project("p-2", { domainId: "default" }),
          project("p-3", { domainId: "acme" }),
          resource({
            kind: OpenStackResourceKind.Project,
            externalId: "p-off",
            regionName: null,
            status: "disabled",
            facts: { domainId: "acme" },
          }),
        ]);
      });

      test("say how many projects each holds", async () => {
        const summaries: Array<OpenStackDomainSummary> =
          await OpenStackResourceService.getDomainSummaries(scope);

        expect(
          summaries.sort(
            (a: OpenStackDomainSummary, b: OpenStackDomainSummary) => {
              return a.domainId.localeCompare(b.domainId);
            },
          ),
        ).toEqual([
          { domainId: "acme", projectCount: 2, enabledProjectCount: 1 },
          { domainId: "default", projectCount: 2, enabledProjectCount: 2 },
        ]);
      });

      test("narrow a list to their projects' IDs", async () => {
        expect(
          await OpenStackResourceService.getProjectIdsOfDomain({
            ...scope,
            domainId: "acme",
          }),
        ).toEqual({ projectIds: ["p-3", "p-off"], isPartial: false });
      });
    });

    describe("a blast radius", () => {
      const pool = (): ParsedOpenStackResource => {
        return resource({
          kind: OpenStackResourceKind.StoragePool,
          externalId: "RegionOne/host@lvm#lvm",
          name: "host@lvm#lvm",
        });
      };

      test("reaches what a pool's volumes are attached to, once each", async () => {
        await write([
          pool(),
          project("p-a"),
          project("p-b"),
          instance("i-1", "p-a", "h-1"),
          instance("i-2", "p-b", "h-1"),
          resource({
            kind: OpenStackResourceKind.Volume,
            externalId: "v-1",
            openStackProjectId: "p-a",
            facts: { pool: "host@lvm#lvm", attachedToInstance: "i-1" },
          }),
          resource({
            kind: OpenStackResourceKind.Volume,
            externalId: "v-2",
            openStackProjectId: "p-a",
            facts: { pool: "host@lvm#lvm", attachedToInstance: "i-1" },
          }),
          resource({
            kind: OpenStackResourceKind.Volume,
            externalId: "v-3",
            openStackProjectId: "p-b",
            facts: { pool: "host@lvm#lvm", attachedToInstance: "i-2" },
          }),
          resource({
            kind: OpenStackResourceKind.Volume,
            externalId: "v-4",
            openStackProjectId: "p-b",
            facts: { pool: "other", attachedToInstance: "i-2" },
          }),
        ]);

        const radius: OpenStackBlastRadius =
          await OpenStackResourceService.getBlastRadius({
            ...scope,
            part: {
              kind: OpenStackResourceKind.StoragePool,
              name: "host@lvm#lvm",
            },
          });

        expect(radius.isKnown).toBe(true);
        expect(radius.volumeCount).toBe(3);
        expect(radius.instanceCount).toBe(2);
        expect(radius.projectCount).toBe(2);
      });

      test("a pool nothing says anything about still says it cannot tell", async () => {
        await write([
          pool(),
          resource({
            kind: OpenStackResourceKind.Volume,
            externalId: "v-1",
            openStackProjectId: "p-a",
          }),
        ]);

        const radius: OpenStackBlastRadius =
          await OpenStackResourceService.getBlastRadius({
            ...scope,
            part: {
              kind: OpenStackResourceKind.StoragePool,
              name: "host@lvm#lvm",
            },
          });

        expect(radius.isKnown).toBe(false);
      });

      test.each([
        OpenStackServiceType.Compute,
        OpenStackServiceType.Placement,
        OpenStackServiceType.Image,
      ])(
        "the %s API down reaches every project in its region",
        async (name) => {
          await write([
            project("p-a"),
            project("p-b"),
            instance("i-1", "p-a", "h-1"),
            instance("i-2", "p-b", "h-1"),
            instance("i-3", "p-c", "h-2", { regionName: "RegionTwo" }),
          ]);

          const radius: OpenStackBlastRadius =
            await OpenStackResourceService.getBlastRadius({
              ...scope,
              part: {
                kind: OpenStackResourceKind.Api,
                name,
                regionName: "RegionOne",
              },
            });

          expect(radius.instanceCount).toBe(2);
          expect(radius.projectCount).toBe(2);
        },
      );

      test("a project's domain comes with its name, for what reaches its owners", async () => {
        await write([
          project("p-a", { domainId: "acme" }, "ou-payments"),
          instance("i-1", "p-a", "h-1"),
        ]);

        const radius: OpenStackBlastRadius =
          await OpenStackResourceService.getBlastRadius({
            ...scope,
            part: {
              kind: OpenStackResourceKind.Hypervisor,
              hypervisorName: "h-1",
              regionName: "RegionOne",
            },
          });

        expect(radius.projects[0]).toMatchObject({
          projectId: "p-a",
          name: "ou-payments",
          domainId: "acme",
        });
      });
    });

    describe("what an alert says, from the rows", () => {
    test("the stopped nova-compute drill: how many instances, in which projects", async () => {
      const full: string = "compute-1.example.internal";
      await write([
        project("p-payments", { domainId: "default" }, "ou-payments"),
        project("p-research", { domainId: "default" }, "ou-research"),
        hypervisor(full, { status: "down" }),
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: "RegionOne/compute/compute-1/nova-compute",
          name: "nova-compute",
          status: "down",
          adminState: "enabled",
          facts: { family: "compute", host: "compute-1" },
        }),
        instance("i-1", "p-payments", full),
        instance("i-2", "p-payments", full),
        instance("i-3", "p-research", full),
      ]);

      const text: string = OpenStackAlertContext.toMarkdown(
        await OpenStackAlertContext.read({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
          seriesLabels: {
            hostname: "compute-1",
            service: "nova-compute",
            "openstack.region.name": "RegionOne",
          },
        }),
      );

      expect(text).toContain("3 instances in 2 projects");
      expect(text).toContain("ou-payments");
      expect(text).toContain("OpenStack project `p-payments`");
      expect(text).toContain("OpenStack project `p-research`");
      expect(text).toContain("OpenStack domain `default`");
    });

    test("an instance's series reaches its project, though it names only itself", async () => {
      await write([
        project("p-payments", { domainId: "acme" }, "ou-payments"),
        instance("i-1", "p-payments", "h-1"),
      ]);

      const text: string = OpenStackAlertContext.toMarkdown(
        await OpenStackAlertContext.read({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
          seriesLabels: { id: "i-1" },
        }),
      );

      expect(text).toContain("OpenStack project `p-payments`");
      expect(text).toContain("OpenStack domain `acme`");
    });

    test("a region's API down reaches every project in the region, by the metric", async () => {
      await write([
        project("p-payments", {}, "ou-payments"),
        resource({
          kind: OpenStackResourceKind.Api,
          externalId: "RegionOne/compute",
          name: "compute",
          status: "down",
        }),
        instance("i-1", "p-payments", "h-1"),
      ]);

      const text: string = OpenStackAlertContext.toMarkdown(
        await OpenStackAlertContext.read({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
          seriesLabels: { "openstack.region.name": "RegionOne" },
          metricNames: ["openstack_nova_up"],
        }),
      );

      expect(text).toContain("1 instance in 1 project");
    });
  });

  describe("the map", () => {
      test("reads everything of a small cloud, and numbers as numbers", async () => {
        await write([
          hypervisor("h-1", { memoryCapacityBytes: 2048 }),
          instance("i-1", "p-a", "h-1"),
          project("p-a", {}, "ou-payments"),
          resource({
            kind: OpenStackResourceKind.Flavor,
            externalId: "RegionOne/f-1",
          }),
        ]);

        const read: OpenStackTopologyRead =
          await OpenStackResourceService.getTopologyRead({
            ...scope,
            now: NOW,
          });

        expect(read.isSummarized).toBe(false);
        expect(
          read.rows
            .map((row: JSONObject) => {
              return row["kind"];
            })
            .sort(),
        ).toEqual(["Hypervisor", "Instance"]);
        expect(
          read.rows.find((row: JSONObject) => {
            return row["kind"] === "Hypervisor";
          })?.["memoryCapacityBytes"],
        ).toBe(2048);
        expect(read.instancesByHost).toEqual([
          { regionName: "RegionOne", hypervisorName: "h-1", instanceCount: 1 },
        ]);
        expect(read.projectNames).toEqual({ "p-a": "ou-payments" });
        expect(read.totalsByKind["Flavor"]).toBe(1);
      });

      test("a cloud of 5,000 hypervisors and 100,000 instances reads what failed, within its budget", async () => {
        const hypervisors: Array<ParsedOpenStackResource> = [];
        for (let index: number = 0; index < 5000; index++) {
          hypervisors.push(
            hypervisor(`h-${index}`, {
              // Five hosts are down.
              status: index < 5 ? "down" : "up",
            }),
          );
        }
        await write(hypervisors);

        const instances: Array<ParsedOpenStackResource> = [];
        for (let index: number = 0; index < 100000; index++) {
          instances.push(
            instance(`i-${index}`, `p-${index % 500}`, `h-${index % 5000}`, {
              // One in a thousand is in ERROR.
              status: index % 1000 === 500 ? "ERROR" : "ACTIVE",
              lastSeenAt: NOW,
            }),
          );
        }
        await write(instances);
        await write([
          resource({
            kind: OpenStackResourceKind.Volume,
            externalId: "v-on-a-down-host",
            openStackProjectId: "p-0",
            facts: { attachedToInstance: "i-0" },
          }),
          resource({
            kind: OpenStackResourceKind.Volume,
            externalId: "v-elsewhere",
            openStackProjectId: "p-0",
            facts: { attachedToInstance: "i-4999" },
          }),
        ]);

        const startedAt: number = Date.now();
        const read: OpenStackTopologyRead =
          await OpenStackResourceService.getTopologyRead({
            ...scope,
            now: NOW,
          });
        const tookMs: number = Date.now() - startedAt;

        expect(read.isSummarized).toBe(true);
        expect(read.totalsByKind["Instance"]).toBe(100000);

        const of = (kind: OpenStackResourceKind): Array<JSONObject> => {
          return read.rows.filter((row: JSONObject) => {
            return row["kind"] === kind;
          });
        };

        expect(of(OpenStackResourceKind.Hypervisor)).toHaveLength(5000);
        // 100 in ERROR, and the 100 on the five hosts that are down, with no overlap here.
        const drawn: Array<JSONObject> = of(OpenStackResourceKind.Instance);
        expect(drawn.length).toBeGreaterThanOrEqual(100);
        expect(drawn.length).toBeLessThan(300);
        expect(
          of(OpenStackResourceKind.Volume).map((row: JSONObject) => {
            return row["externalId"];
          }),
        ).toEqual(["v-on-a-down-host"]);
        // Every host still says what it holds.
        expect(read.instancesByHost).toHaveLength(5000);
        expect(read.rows.length).toBeLessThan(
          OPENSTACK_TOPOLOGY_FULL_PART_LIMIT + 1000,
        );
        expect(tookMs).toBeLessThan(5000);
      }, 600000);
    });
  },
);
