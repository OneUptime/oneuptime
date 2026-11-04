import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import { DataSource } from "typeorm";
import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import OpenStackResourceService, {
  OpenStackAttentionRows,
  OpenStackInventorySummary,
  OpenStackTopologyRead,
  ParsedOpenStackResource,
} from "../../../Server/Services/OpenStackResourceService";
import logger from "../../../Server/Utils/Logger";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../Types/OpenStack/OpenStackResourceKind";
import { OPENSTACK_LARGE_CLOUD } from "../../../Types/OpenStack/OpenStackScale";
import { FastestRun, fastestRunAsync } from "../../Helpers/FastestRun";

/*
 * What keeps the inventory table standing up at OpenStack's largest clouds, on Postgres: writes
 * that only write what changed, deletes and statements of a stated size, reads that do not slow
 * down as the table grows.
 *
 * Opt in as OpenStackResourcePostgres.test.ts does, against a database the registered migrations
 * have been applied to:
 *
 *   RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS=true \
 *   OPENSTACK_INVENTORY_TEST_DATABASE_HOST=127.0.0.1 \
 *   OPENSTACK_INVENTORY_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/OpenStackScalePostgres.test.ts --forceExit
 *
 * It works on a structure-only clone in a schema of its own, dropped afterwards. Set
 * OPENSTACK_SCALE_MEASURES to a path to have what it measured written there.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "OpenStackResource";
const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const MINUTE_MS: number = 60 * 1000;
const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * MINUTE_MS);
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

function instance(
  externalId: string,
  overrides: Partial<ParsedOpenStackResource> = {},
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.Instance,
    externalId: externalId,
    name: externalId,
    status: "ACTIVE",
    ...overrides,
  });
}

function computeApi(
  vouchedAt: Date,
  refreshCycleMinutes?: number,
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.Api,
    externalId: `RegionOne/${OpenStackServiceType.Compute}`,
    name: OpenStackServiceType.Compute,
    status: "up",
    facts: {
      vouchedAt: vouchedAt.toISOString(),
      refreshCycleMinutes: refreshCycleMinutes ?? null,
    },
    lastSeenAt: vouchedAt,
  });
}

describePostgres("the OpenStack inventory at scale, on Postgres", () => {
  const schema: string = `openstack_scale_${Date.now()}`;
  let database: DataSource;

  type Row = Record<string, unknown>;

  const write: (
    resources: Array<ParsedOpenStackResource>,
  ) => Promise<void> = async (
    resources: Array<ParsedOpenStackResource>,
  ): Promise<void> => {
    await OpenStackResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      resources,
    });
  };

  const rowOf: (
    kind: OpenStackResourceKind,
    externalId: string,
  ) => Promise<Row | undefined> = async (
    kind: OpenStackResourceKind,
    externalId: string,
  ): Promise<Row | undefined> => {
    const rows: Array<Row> = await database.query(
      `SELECT * FROM "${schema}"."${TABLE}"
       WHERE "openStackCloudId" = $1 AND "kind" = $2 AND "externalId" = $3`,
      [CLOUD_ID.toString(), kind, externalId],
    );
    return rows[0];
  };

  const lastSeenOf: (
    externalId: string,
  ) => Promise<number | undefined> = async (
    externalId: string,
  ): Promise<number | undefined> => {
    const row: Row | undefined = await rowOf(
      OpenStackResourceKind.Instance,
      externalId,
    );
    return row ? new Date(row["lastSeenAt"] as string).getTime() : undefined;
  };

  const sweep: () => Promise<number> = async (): Promise<number> => {
    return await OpenStackResourceService.deleteStaleForCloud({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
    });
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

  describe("a scrape that changes nothing writes nothing", () => {
    test("an unchanged row seen lately is left as it stands, and one past the interval is touched", async () => {
      await write([instance("i-1", { lastSeenAt: at(0) })]);
      const before: Row = (await rowOf(
        OpenStackResourceKind.Instance,
        "i-1",
      )) as Row;

      await write([instance("i-1", { lastSeenAt: at(2) })]);
      expect(await lastSeenOf("i-1")).toBe(at(0).getTime());
      expect(
        (await rowOf(OpenStackResourceKind.Instance, "i-1"))?.["updatedAt"],
      ).toEqual(before["updatedAt"]);

      // Five minutes is a third of the default window.
      await write([instance("i-1", { lastSeenAt: at(5) })]);
      expect(await lastSeenOf("i-1")).toBe(at(0).getTime());

      await write([instance("i-1", { lastSeenAt: at(6) })]);
      expect(await lastSeenOf("i-1")).toBe(at(6).getTime());
    });

    test.each([
      ["its status", { status: "ERROR" }, "status", "ERROR"],
      ["its name", { name: "renamed" }, "name", "renamed"],
      ["where it runs", { hypervisorName: "h-9" }, "hypervisorName", "h-9"],
      ["its zone", { availabilityZone: "az-9" }, "availabilityZone", "az-9"],
      ["its admin state", { adminState: "disabled" }, "adminState", "disabled"],
      [
        "its project",
        { openStackProjectId: "p-9" },
        "openStackProjectId",
        "p-9",
      ],
      ["a number", { vcpuAllocated: 9 }, "vcpuAllocated", 9],
      [
        "a large number",
        { diskCapacityBytes: 2 ** 40 },
        "diskCapacityBytes",
        String(2 ** 40),
      ],
    ] as Array<[string, Partial<ParsedOpenStackResource>, string, unknown]>)(
      "a change to %s is written at once",
      async (
        _what: string,
        change: Partial<ParsedOpenStackResource>,
        column: string,
        expected: unknown,
      ) => {
        await write([instance("i-1", { lastSeenAt: at(0) })]);
        await write([instance("i-1", { ...change, lastSeenAt: at(1) })]);

        const row: Row = (await rowOf(
          OpenStackResourceKind.Instance,
          "i-1",
        )) as Row;

        expect(row[column]).toEqual(expected);
        expect(new Date(row["lastSeenAt"] as string).getTime()).toBe(
          at(1).getTime(),
        );
      },
    );

    test("a null says nothing, as it always did: the row is not rewritten for one", async () => {
      await write([instance("i-1", { name: "kept", lastSeenAt: at(0) })]);
      await write([instance("i-1", { name: null, lastSeenAt: at(1) })]);

      const row: Row = (await rowOf(
        OpenStackResourceKind.Instance,
        "i-1",
      )) as Row;

      expect(row["name"]).toBe("kept");
      expect(await lastSeenOf("i-1")).toBe(at(0).getTime());
    });

    test("a fact that differs is written, and only that key moves", async () => {
      await write([
        instance("i-1", {
          facts: { flavorId: "a", userId: "u" },
          lastSeenAt: at(0),
        }),
      ]);
      await write([
        instance("i-1", { facts: { flavorId: "b" }, lastSeenAt: at(1) }),
      ]);

      const row: Row = (await rowOf(
        OpenStackResourceKind.Instance,
        "i-1",
      )) as Row;

      expect(row["facts"]).toEqual({ flavorId: "b", userId: "u" });
      expect(await lastSeenOf("i-1")).toBe(at(1).getTime());
    });

    test("a key set to null is a change: a floating IP that lost its router says so at once", async () => {
      const address: (
        routerId: string | null,
        minutes: number,
      ) => ParsedOpenStackResource = (
        routerId: string | null,
        minutes: number,
      ): ParsedOpenStackResource => {
        return resource({
          kind: OpenStackResourceKind.FloatingIp,
          externalId: "fip-1",
          status: "ACTIVE",
          facts: { routerId: routerId },
          lastSeenAt: at(minutes),
        });
      };

      await write([address("router-1", 0)]);
      await write([address(null, 1)]);

      expect(
        (await rowOf(OpenStackResourceKind.FloatingIp, "fip-1"))?.["facts"],
      ).toEqual({ routerId: null });

      // Written down, and then there is nothing new to say.
      await write([address(null, 2)]);

      expect(
        new Date(
          (await rowOf(OpenStackResourceKind.FloatingIp, "fip-1"))?.[
            "lastSeenAt"
          ] as string,
        ).getTime(),
      ).toBe(at(1).getTime());

      // A key the row never had, set to null, is written once too: nothing downstream differs.
      await write([
        resource({
          kind: OpenStackResourceKind.FloatingIp,
          externalId: "fip-2",
          facts: { floatingNetworkId: "n" },
          lastSeenAt: at(0),
        }),
      ]);
      await write([
        resource({
          kind: OpenStackResourceKind.FloatingIp,
          externalId: "fip-2",
          facts: { routerId: null },
          lastSeenAt: at(1),
        }),
      ]);
      expect(
        (await rowOf(OpenStackResourceKind.FloatingIp, "fip-2"))?.["facts"],
      ).toEqual({ floatingNetworkId: "n", routerId: null });
    });

    test("a fact that held more than the new one replaces it, so an L3 agent that left goes", async () => {
      const router: (
        agents: JSONObject,
        minutes: number,
      ) => ParsedOpenStackResource = (
        agents: JSONObject,
        minutes: number,
      ): ParsedOpenStackResource => {
        return resource({
          kind: OpenStackResourceKind.Router,
          externalId: "r-1",
          facts: { l3Agents: agents },
          lastSeenAt: at(minutes),
        });
      };

      await write([router({ a: { isAlive: true }, b: { isAlive: true } }, 0)]);
      await write([router({ a: { isAlive: true } }, 1)]);

      expect(
        (await rowOf(OpenStackResourceKind.Router, "r-1"))?.["facts"],
      ).toEqual({ l3Agents: { a: { isAlive: true } } });
    });

    test("a disabled service re-enabled loses its reason at once, though its state reads the same on the row", async () => {
      const service: (
        reason: string | null,
        minutes: number,
      ) => ParsedOpenStackResource = (
        reason: string | null,
        minutes: number,
      ): ParsedOpenStackResource => {
        return resource({
          kind: OpenStackResourceKind.Service,
          externalId: "svc-1",
          status: "up",
          adminState: "disabled",
          disabledReason: reason,
          lastSeenAt: at(minutes),
        });
      };

      await write([service("maintenance", 0)]);
      await write([service(null, 1)]);

      expect(
        (await rowOf(OpenStackResourceKind.Service, "svc-1"))?.[
          "disabledReason"
        ],
      ).toBeNull();
    });

    test("what a page reads is never what the skip left stale: the summary counts what is there", async () => {
      await write([
        instance("i-1", { lastSeenAt: at(0) }),
        instance("i-2", { lastSeenAt: at(0) }),
      ]);

      const scope: { projectId: ObjectID; openStackCloudId: ObjectID } = {
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
      };

      await write([
        instance("i-1", { lastSeenAt: at(1) }),
        instance("i-2", { status: "ERROR", lastSeenAt: at(1) }),
      ]);

      const summary: OpenStackInventorySummary =
        await OpenStackResourceService.getInventorySummary(scope);

      expect(summary.instanceCount).toBe(2);
      expect(summary.activeInstanceCount).toBe(1);
      // One row skipped, one written.
      expect(await lastSeenOf("i-1")).toBe(at(0).getTime());
      expect(await lastSeenOf("i-2")).toBe(at(1).getTime());
    });

    test("an event's date survives the skip, and the next real change is dated by its own scrape", async () => {
      await write([instance("i-1", { lastSeenAt: at(0) })]);
      await write([instance("i-1", { lastSeenAt: at(2) })]);
      expect(await lastSeenOf("i-1")).toBe(at(0).getTime());

      await OpenStackResourceService.recordStateChanges({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        changes: [
          {
            kind: OpenStackResourceKind.Instance,
            externalId: "i-1",
            binary: "",
            host: "",
            at: at(3),
          },
        ],
      });

      // The scrape after the event closes the gap, as it would have had nothing been skipped.
      await write([instance("i-1", { lastSeenAt: at(4) })]);
      expect(await lastSeenOf("i-1")).toBe(at(4).getTime());
      expect(
        new Date(
          (await rowOf(OpenStackResourceKind.Instance, "i-1"))?.[
            "stateChangedAt"
          ] as string,
        ).getTime(),
      ).toBe(at(3).getTime());

      await write([instance("i-1", { status: "ERROR", lastSeenAt: at(6) })]);
      expect(
        new Date(
          (await rowOf(OpenStackResourceKind.Instance, "i-1"))?.[
            "stateChangedAt"
          ] as string,
        ).getTime(),
      ).toBe(at(6).getTime());
    });
  });

  describe("the skip stays well inside the stale window", () => {
    test.each([
      [5, 100],
      [6, 120],
      [9, 180],
      [15, 300],
      [60, 300],
    ])(
      "a window of %d minutes lets an unchanged row go %d seconds without a write",
      (window: number, seconds: number) => {
        process.env["OPENSTACK_INVENTORY_STALE_MINUTES"] = String(window);
        expect(OpenStackResourceService.getRowTouchIntervalInSeconds()).toBe(
          seconds,
        );
      },
    );

    /*
     * The worst order there is: a scrape's `up` lands, and the sweep runs, before that same
     * scrape's rows. Every window the setting allows, against scrape intervals shorter than it.
     * A row that is there on every scrape is never deleted, whatever the skip did to it.
     */
    test.each(
      [5, 6, 10, 15, 30].flatMap((window: number) => {
        return [1, 2, 3, 4, 5, 10, 20]
          .filter((interval: number) => {
            return interval < window;
          })
          .map((interval: number): [number, number] => {
            return [window, interval];
          });
      }),
    )(
      "with a window of %d minutes and a scrape every %d, a live part is never swept away",
      async (window: number, interval: number) => {
        process.env["OPENSTACK_INVENTORY_STALE_MINUTES"] = String(window);

        for (let scrape: number = 0; scrape < 40; scrape++) {
          const when: Date = at(scrape * interval);

          await write([computeApi(when)]);
          await sweep();
          expect(
            await rowOf(OpenStackResourceKind.Api, `RegionOne/compute`),
          ).toBeDefined();

          if (scrape > 0) {
            // Still there after a sweep measured against a read its rows have not caught up with.
            expect(await lastSeenOf("i-live")).toBeDefined();
          }

          await write([instance("i-live", { lastSeenAt: when })]);
          await sweep();
          expect(await lastSeenOf("i-live")).toBeDefined();
        }
      },
      120000,
    );

    test("a part that really went is gone within the window, the interval and one touch", async () => {
      for (let scrape: number = 0; scrape <= 3; scrape++) {
        await write([
          computeApi(at(scrape * 2)),
          instance("i-goes", { lastSeenAt: at(scrape * 2) }),
        ]);
      }

      let goneAt: number | null = null;

      // It stopped being reported at minute 6.
      for (let minute: number = 8; minute <= 40; minute += 2) {
        await write([computeApi(at(minute))]);
        await sweep();

        if ((await lastSeenOf("i-goes")) === undefined) {
          goneAt = minute;
          break;
        }
      }

      // lastSeenAt can be up to five minutes behind minute 6, so a sweep can go from minute 16.
      expect(goneAt).not.toBeNull();
      expect(goneAt as number).toBeLessThanOrEqual(6 + 15 + 2);
      expect(goneAt as number).toBeGreaterThanOrEqual(6 + 15 - 5);
    });

    test("a service sending rows in turns gives them as long as a turn takes", async () => {
      await write([instance("i-turn", { lastSeenAt: at(0) })]);

      await write([computeApi(at(40), 30)]);
      await sweep();
      expect(await lastSeenOf("i-turn")).toBeDefined();

      await write([computeApi(at(46), 30)]);
      await sweep();
      expect(await lastSeenOf("i-turn")).toBeUndefined();

      // A cloud that left summary mode stops waiting.
      await write([instance("i-next", { lastSeenAt: at(46) })]);
      await write([computeApi(at(62))]);
      await sweep();
      expect(await lastSeenOf("i-next")).toBeUndefined();
    });
  });

  describe("batches and transactions have a stated size", () => {
    test("a sweep of many rows goes in small deletes, and takes them all", async () => {
      const rows: Array<ParsedOpenStackResource> = [];

      for (let index: number = 0; index < 12000; index++) {
        rows.push(instance(`i-${index}`, { lastSeenAt: at(0) }));
      }

      await write(rows);

      const query: jest.SpiedFunction<typeof database.manager.query> =
        jest.spyOn(database.manager, "query");

      await write([computeApi(at(120))]);

      expect(await sweep()).toBe(12000);

      const deletes: number = query.mock.calls.filter(
        (call: Array<unknown>): boolean => {
          return String(call[0]).includes("DELETE FROM");
        },
      ).length;

      // Three of 5,000 or fewer, then the one that finds nothing more of this kind.
      expect(deletes).toBeGreaterThanOrEqual(3);
      expect(await lastSeenOf("i-1")).toBeUndefined();
    }, 300000);

    test("a statement holds at most 500 rows, each a transaction of its own", async () => {
      const query: jest.SpiedFunction<typeof database.manager.query> =
        jest.spyOn(database.manager, "query");
      const rows: Array<ParsedOpenStackResource> = [];

      for (let index: number = 0; index < 1250; index++) {
        rows.push(instance(`i-${index}`));
      }

      await write(rows);

      expect(query).toHaveBeenCalledTimes(3);
      expect((query.mock.calls[0]![1] as Array<unknown>).length / 24).toBe(500);
    }, 120000);

    test("two batches over the same rows, in opposite orders, wait for each other rather than deadlock", async () => {
      const rows: Array<ParsedOpenStackResource> = [];

      for (let index: number = 0; index < 1500; index++) {
        rows.push(instance(`i-${index}`, { lastSeenAt: at(0) }));
      }

      await write(rows);

      for (let round: number = 1; round <= 3; round++) {
        const when: Date = at(round * 10);
        const forward: Array<ParsedOpenStackResource> = rows.map(
          (row: ParsedOpenStackResource) => {
            return { ...row, status: "ERROR", lastSeenAt: when };
          },
        );
        const backward: Array<ParsedOpenStackResource> = [...forward]
          .reverse()
          .map((row: ParsedOpenStackResource) => {
            return { ...row, status: "SHUTOFF" };
          });

        await Promise.all([write(forward), write(backward)]);
      }

      const summary: OpenStackInventorySummary =
        await OpenStackResourceService.getInventorySummary({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
        });

      expect(summary.instanceCount).toBe(1500);
    }, 300000);
  });

  describe("a host parted by a collector's batches", () => {
    const service: (
      host: string,
      overrides?: Partial<ParsedOpenStackResource>,
    ) => ParsedOpenStackResource = (
      host: string,
      overrides: Partial<ParsedOpenStackResource> = {},
    ): ParsedOpenStackResource => {
      return resource({
        kind: OpenStackResourceKind.Service,
        externalId: `RegionOne/compute/${host}/nova-compute`,
        name: "nova-compute",
        status: "down",
        adminState: "enabled",
        availabilityZone: "az-1",
        facts: { family: "compute", host: host },
        ...overrides,
      });
    };

    const hypervisor: (name: string) => ParsedOpenStackResource = (
      name: string,
    ): ParsedOpenStackResource => {
      return resource({
        kind: OpenStackResourceKind.Hypervisor,
        externalId: `RegionOne/${name}`,
        name: name,
        hypervisorName: name,
      });
    };

    test("reads its nova-compute's state, by its short name, whichever batch came first", async () => {
      await write([
        service("compute-01"),
        service("compute-02", { status: "up" }),
      ]);
      await write([
        hypervisor("compute-01.example.org"),
        hypervisor("compute-02.example.org"),
      ]);

      await OpenStackResourceService.reconcileHypervisorStates({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        shortHostNames: ["compute-01"],
      });

      const first: Row = (await rowOf(
        OpenStackResourceKind.Hypervisor,
        "RegionOne/compute-01.example.org",
      )) as Row;
      const second: Row = (await rowOf(
        OpenStackResourceKind.Hypervisor,
        "RegionOne/compute-02.example.org",
      )) as Row;

      expect(first["status"]).toBe("down");
      expect(first["adminState"]).toBe("enabled");
      expect(first["availabilityZone"]).toBe("az-1");
      // Only the hosts it was asked about.
      expect(second["status"]).toBeNull();
    });

    test("a host in another region of the same name is its own", async () => {
      await write([
        service("compute-01"),
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: "RegionTwo/compute-01",
          hypervisorName: "compute-01",
          regionName: "RegionTwo",
        }),
      ]);

      await OpenStackResourceService.reconcileHypervisorStates({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        shortHostNames: ["compute-01"],
      });

      expect(
        (
          await rowOf(OpenStackResourceKind.Hypervisor, "RegionTwo/compute-01")
        )?.["status"],
      ).toBeNull();
    });
  });

  describe("walking a whole kind", () => {
    test("reads each row exactly once, in order, whatever it is filtered by", async () => {
      const rows: Array<ParsedOpenStackResource> = [];

      for (let index: number = 0; index < 2500; index++) {
        rows.push(
          instance(`i-${String(index).padStart(5, "0")}`, {
            status: index % 10 === 0 ? "ERROR" : "ACTIVE",
          }),
        );
      }

      await write(rows);

      const scope: { projectId: ObjectID; openStackCloudId: ObjectID } = {
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
      };
      const seen: Array<string> = [];
      let after: string | null = null;

      do {
        const page: { rows: Array<JSONObject>; nextExternalId: string | null } =
          await OpenStackResourceService.getRowsAfter({
            ...scope,
            kind: OpenStackResourceKind.Instance,
            afterExternalId: after,
            limit: 1000,
          });

        seen.push(
          ...page.rows.map((row: JSONObject): string => {
            return row["externalId"] as string;
          }),
        );
        after = page.nextExternalId;
      } while (after);

      expect(seen).toEqual(
        rows.map((row: ParsedOpenStackResource): string => {
          return row.externalId;
        }),
      );

      const errors: { rows: Array<JSONObject> } =
        await OpenStackResourceService.getRowsAfter({
          ...scope,
          kind: OpenStackResourceKind.Instance,
          status: "ERROR",
          limit: 1000,
        });

      expect(errors.rows).toHaveLength(250);

      // It never answers more than a read's worth, whatever it is asked for.
      expect(
        (
          await OpenStackResourceService.getRowsAfter({
            ...scope,
            kind: OpenStackResourceKind.Instance,
            limit: 100000,
          })
        ).rows,
      ).toHaveLength(1000);
    }, 120000);

    test("counts instances by status and by project, in each region", async () => {
      await write([
        instance("i-1", { openStackProjectId: "p-a" }),
        instance("i-2", { openStackProjectId: "p-a", status: "ERROR" }),
        instance("i-3", { openStackProjectId: "p-b", regionName: "RegionTwo" }),
      ]);

      const counts: Awaited<
        ReturnType<typeof OpenStackResourceService.getInstanceCounts>
      > = await OpenStackResourceService.getInstanceCounts({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
      });

      expect(counts.byStatus).toEqual(
        expect.arrayContaining([
          { regionName: "RegionOne", status: "ACTIVE", count: 1 },
          { regionName: "RegionOne", status: "ERROR", count: 1 },
          { regionName: "RegionTwo", status: "ACTIVE", count: 1 },
        ]),
      );
      expect(counts.byProject).toEqual(
        expect.arrayContaining([
          { regionName: "RegionOne", openStackProjectId: "p-a", count: 2 },
          { regionName: "RegionTwo", openStackProjectId: "p-b", count: 1 },
        ]),
      );
    });
  });

  describe("at the largest size tested", () => {
    const measures: Record<string, unknown> = {};

    afterAll(() => {
      const file: string | undefined = process.env["OPENSTACK_SCALE_MEASURES"];

      if (file) {
        fs.writeFileSync(path.resolve(file), JSON.stringify(measures, null, 2));
      }
    });

    const seed: () => Promise<void> = async (): Promise<void> => {
      const insert: (data: {
        kind: OpenStackResourceKind;
        count: number;
        id: string;
        status: string;
        extra?: string;
        extraValues?: string;
      }) => Promise<void> = async (data: {
        kind: OpenStackResourceKind;
        count: number;
        id: string;
        status: string;
        extra?: string;
        extraValues?: string;
      }): Promise<void> => {
        await database.query(
          `INSERT INTO "${schema}"."${TABLE}"
            ("projectId", "openStackCloudId", "kind", "externalId", "name", "regionName",
             "openStackProjectId", "status", "stateChangedAt", "lastSeenAt", "version", "facts"
             ${data.extra || ""})
           SELECT $1, $2, $3::text, ${data.id}, $3::text || '-' || (g * 7919 % $4::int), 'RegionOne',
                  'project-' || (g % 10000), ${data.status}, $5, $5, 0,
                  jsonb_build_object('family', 'compute', 'host', 'compute-' || g, 'flavorId', 'f' || (g % 40))
                  ${data.extraValues || ""}
           FROM generate_series(1, $4::int) AS g`,
          [
            PROJECT_ID.toString(),
            CLOUD_ID.toString(),
            data.kind,
            data.count,
            at(0),
          ],
        );
      };

      await insert({
        kind: OpenStackResourceKind.Instance,
        count: OPENSTACK_LARGE_CLOUD.instances,
        id: `'00000000-0000-4000-8000-' || lpad(g::text, 12, '0')`,
        status: `CASE WHEN g % 1000 = 0 THEN 'ERROR' ELSE 'ACTIVE' END`,
        extra: `, "hypervisorName"`,
        extraValues: `, 'compute-' || (g % ${OPENSTACK_LARGE_CLOUD.hypervisors}) || '.example.org'`,
      });
      await insert({
        kind: OpenStackResourceKind.Volume,
        count: OPENSTACK_LARGE_CLOUD.volumes,
        id: `'v-' || g`,
        status: `'in-use'`,
      });
      await insert({
        kind: OpenStackResourceKind.Hypervisor,
        count: OPENSTACK_LARGE_CLOUD.hypervisors,
        id: `'RegionOne/compute-' || g`,
        status: `CASE WHEN g < 5 THEN 'down' ELSE 'up' END`,
        extra: `, "hypervisorName", "vcpuCapacity", "vcpuAllocated"`,
        extraValues: `, 'compute-' || g || '.example.org', 1536, 800`,
      });
      await insert({
        kind: OpenStackResourceKind.Service,
        count:
          OPENSTACK_LARGE_CLOUD.hypervisors +
          OPENSTACK_LARGE_CLOUD.networkAgents,
        id: `'RegionOne/s-' || g`,
        status: `'up'`,
      });
      await insert({
        kind: OpenStackResourceKind.Project,
        count: OPENSTACK_LARGE_CLOUD.projects,
        id: `'project-' || g`,
        status: `'enabled'`,
      });

      for (const [kind, count] of [
        [OpenStackResourceKind.Network, OPENSTACK_LARGE_CLOUD.networks],
        [OpenStackResourceKind.Subnet, OPENSTACK_LARGE_CLOUD.subnets],
        [OpenStackResourceKind.Router, OPENSTACK_LARGE_CLOUD.routers],
        [OpenStackResourceKind.FloatingIp, OPENSTACK_LARGE_CLOUD.floatingIps],
        [OpenStackResourceKind.Snapshot, OPENSTACK_LARGE_CLOUD.snapshots],
        [OpenStackResourceKind.Backup, OPENSTACK_LARGE_CLOUD.backups],
        [OpenStackResourceKind.Image, OPENSTACK_LARGE_CLOUD.images],
      ] as Array<[OpenStackResourceKind, number]>) {
        await insert({
          kind: kind,
          count: count,
          id: `'${kind}-' || g`,
          status: `'ACTIVE'`,
        });
      }

      await database.query(`ANALYZE "${schema}"."${TABLE}"`);
    };

    const scope: { projectId: ObjectID; openStackCloudId: ObjectID } = {
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
    };

    const walBytesOf: (work: () => Promise<void>) => Promise<number> = async (
      work: () => Promise<void>,
    ): Promise<number> => {
      const before: Array<{ lsn: string }> = await database.query(
        `SELECT pg_current_wal_lsn() AS "lsn"`,
      );
      await work();
      const after: Array<{ bytes: string }> = await database.query(
        `SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1) AS "bytes"`,
        [before[0]!.lsn],
      );
      return Number(after[0]!.bytes);
    };

    test("reads what it reads within budget, and a scrape that changes nothing writes next to nothing", async () => {
      await seed();

      const instances: (minutes: number) => Array<ParsedOpenStackResource> = (
        minutes: number,
      ): Array<ParsedOpenStackResource> => {
        const rows: Array<ParsedOpenStackResource> = [];

        for (let g: number = 1; g <= 20000; g++) {
          rows.push({
            ...instance(
              `00000000-0000-4000-8000-${String(g).padStart(12, "0")}`,
              {
                name: `Instance-${(g * 7919) % OPENSTACK_LARGE_CLOUD.instances}`,
                status: g % 1000 === 0 ? "ERROR" : "ACTIVE",
                openStackProjectId: `project-${g % 10000}`,
                hypervisorName: `compute-${g % OPENSTACK_LARGE_CLOUD.hypervisors}.example.org`,
                facts: {
                  family: "compute",
                  host: `compute-${g}`,
                  flavorId: `f${g % 40}`,
                },
              },
            ),
            lastSeenAt: at(minutes),
          });
        }

        return rows;
      };

      // Touched: past the interval, so every row is rewritten.
      const touchedBytes: number = await walBytesOf(async () => {
        await write(instances(10));
      });
      // The next scrape, two minutes on, with nothing new to say.
      const unchangedBytes: number = await walBytesOf(async () => {
        await write(instances(12));
      });

      measures["walBytesPer20000RowsRewritten"] = touchedBytes;
      measures["walBytesPer20000RowsUnchanged"] = unchangedBytes;

      expect(touchedBytes).toBeGreaterThan(1024 * 1024);
      // A tenth is generous: it was a twenty-eighth on 200,000 rows.
      expect(unchangedBytes).toBeLessThan(touchedBytes / 10);

      const time: <T>(
        run: () => Promise<T>,
        limit: number,
      ) => Promise<FastestRun<T>> = async <T>(
        run: () => Promise<T>,
        limit: number,
      ): Promise<FastestRun<T>> => {
        return await fastestRunAsync({ run: run, limitInMs: limit });
      };

      const summary: FastestRun<OpenStackInventorySummary> = await time(() => {
        return OpenStackResourceService.getInventorySummary(scope);
      }, 3000);
      expect(summary.result.instanceCount).toBe(
        OPENSTACK_LARGE_CLOUD.instances,
      );
      expect(summary.inMs).toBeLessThan(3000);

      const attention: FastestRun<OpenStackAttentionRows> = await time(() => {
        return OpenStackResourceService.getAttentionRows({
          ...scope,
          now: at(20),
        });
      }, 3000);
      expect(attention.inMs).toBeLessThan(3000);
      expect(attention.result.totalsByKind["Instance"]).toBe(
        Math.floor(OPENSTACK_LARGE_CLOUD.instances / 1000),
      );

      const regions: FastestRun<unknown> = await time(() => {
        return OpenStackResourceService.getRegionSummaries(scope);
      }, 3000);
      expect(regions.inMs).toBeLessThan(3000);

      const consumers: FastestRun<unknown> = await time(() => {
        return OpenStackResourceService.getTopConsumers(scope);
      }, 3000);
      expect(consumers.inMs).toBeLessThan(3000);

      // Everything the Overview asks of this table when it opens, which it asks at once.
      const overview: FastestRun<unknown> = await time(() => {
        return Promise.all([
          OpenStackResourceService.getInventorySummary(scope),
          OpenStackResourceService.getAttentionRows({ ...scope, now: at(20) }),
          OpenStackResourceService.getRegionSummaries(scope),
          OpenStackResourceService.getTopConsumers(scope),
        ]);
      }, 6000);

      expect(overview.inMs).toBeLessThan(6000);

      const topology: FastestRun<OpenStackTopologyRead> = await time(() => {
        return OpenStackResourceService.getTopologyRead({
          ...scope,
          now: at(20),
        });
      }, 5000);
      expect(topology.result.isSummarized).toBe(true);
      expect(topology.inMs).toBeLessThan(5000);

      const keyset: FastestRun<unknown> = await time(() => {
        return OpenStackResourceService.getRowsAfter({
          ...scope,
          kind: OpenStackResourceKind.Instance,
          afterExternalId: `00000000-0000-4000-8000-${String(199000).padStart(12, "0")}`,
          limit: 100,
        });
      }, 500);
      expect(keyset.inMs).toBeLessThan(500);

      Object.assign(measures, {
        inventorySummaryMs: summary.measuredInMs,
        attentionMs: attention.measuredInMs,
        attentionRows: attention.result.rows.length,
        attentionBytes: Buffer.byteLength(
          JSON.stringify(attention.result.rows),
        ),
        regionSummariesMs: regions.measuredInMs,
        topConsumersMs: consumers.measuredInMs,
        overviewMs: overview.measuredInMs,
        overviewMsAdjusted: overview.inMs,
        topologyMs: topology.measuredInMs,
        topologyRows: topology.result.rows.length,
        topologyBytes: Buffer.byteLength(JSON.stringify(topology.result.rows)),
        keysetPageMs: keyset.measuredInMs,
        slowdowns: {
          summary: summary.slowdown,
          attention: attention.slowdown,
          topology: topology.slowdown,
        },
      });
    }, 1200000);
  });
});
