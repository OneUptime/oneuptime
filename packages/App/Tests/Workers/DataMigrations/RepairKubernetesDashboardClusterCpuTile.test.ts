import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardService from "Common/Server/Services/DashboardService";
import logger from "Common/Server/Utils/Logger";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import KubernetesClusterCpuTileRepair, {
  BUSIEST_NODE_CPU_TILE_TITLE,
  KUBERNETES_NODE_CPU_USAGE_METRIC,
  LEGACY_CLUSTER_CPU_TILE_TITLE,
} from "Common/Utils/Dashboard/KubernetesClusterCpuTileRepair";
import RepairKubernetesDashboardClusterCpuTile from "../../../FeatureSet/Workers/DataMigrations/RepairKubernetesDashboardClusterCpuTile";
import fs from "fs";
import path from "path";

/*
 * The upgrade half of fixing the Kubernetes template's summed CPU tile.
 *
 * Templates are copied into a dashboard when it is created, so dashboards
 * that already exist keep "Cluster CPU (cores in use)" summing
 * k8s.node.cpu.usage over every node, scrape and bucket. Which tiles are
 * rewritten, and to what, is pinned in Common's
 * KubernetesClusterCpuTileRepair tests; what is pinned here is the walk:
 * Postgres picks the dashboards by containment, every matching id is found
 * before anything is written (a repaired row leaves the match, so paging
 * while writing would skip rows), each write is a compare-and-set on the
 * config it read, and one bad dashboard cannot take the rest — or the
 * migrations queued behind this one — down with it.
 */
jest.mock("Common/Server/Services/DashboardService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneById: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "RepairKubernetesDashboardClusterCpuTile";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const dashboardService: {
  findBy: jest.Mock;
  findOneById: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
} = DashboardService as unknown as {
  findBy: jest.Mock;
  findOneById: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
};

const mockedLogger: { error: jest.Mock; info: jest.Mock } =
  logger as unknown as { error: jest.Mock; info: jest.Mock };

interface RawOperator {
  type: string;
  objectLiteralParameters: Record<string, unknown>;
  getSql: (aliasPath: string) => string;
}

function makeConfig(data: {
  title: string;
  aggregation: string;
}): DashboardViewConfig {
  return {
    _type: "DashboardViewConfig",
    heightInDashboardUnits: 21,
    components: [
      {
        _type: "DashboardComponent",
        componentType: "Value",
        componentId: { _type: "ObjectID", value: "cpu-tile" },
        topInDashboardUnits: 11,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 4,
        heightInDashboardUnits: 1,
        arguments: {
          title: data.title,
          metricQueryConfig: {
            metricQueryData: {
              filterData: {
                metricName: KUBERNETES_NODE_CPU_USAGE_METRIC,
                aggegationType: data.aggregation,
              },
            },
          },
          trendDirection: "HigherIsWorse",
        },
      },
    ],
  } as unknown as DashboardViewConfig;
}

function legacyConfig(): DashboardViewConfig {
  return makeConfig({
    title: LEGACY_CLUSTER_CPU_TILE_TITLE,
    aggregation: AggregationType.Sum,
  });
}

function repairedConfig(): DashboardViewConfig {
  return makeConfig({
    title: BUSIEST_NODE_CPU_TILE_TITLE,
    aggregation: AggregationType.Max,
  });
}

function makeDashboard(
  id: ObjectID,
  dashboardViewConfig?: DashboardViewConfig,
): Dashboard {
  const dashboard: Dashboard = new Dashboard(id);
  if (dashboardViewConfig) {
    dashboard.dashboardViewConfig = dashboardViewConfig;
  }
  return dashboard;
}

/*
 * A findBy that serves the matching ids in pages, the way Postgres would:
 * honours skip and limit, so a migration that forgets to page sees only the
 * first LIMIT_MAX of them.
 */
function serveMatchingIdsInPages(ids: Array<ObjectID>): void {
  dashboardService.findBy.mockImplementation((...callArgs: Array<unknown>) => {
    const input: JSONObject = callArgs[0] as JSONObject;
    const skip: number = input["skip"] as number;
    const limit: number = input["limit"] as number;
    return Promise.resolve(
      ids.slice(skip, skip + limit).map((id: ObjectID) => {
        return makeDashboard(id);
      }),
    );
  });
}

// findOneById serves each id's stored config; ids not listed are gone.
function serveStoredConfigs(configs: Map<string, DashboardViewConfig>): void {
  dashboardService.findOneById.mockImplementation(
    (...callArgs: Array<unknown>) => {
      const id: ObjectID = (callArgs[0] as JSONObject)["id"] as ObjectID;
      const config: DashboardViewConfig | undefined = configs.get(
        id.toString(),
      );
      return Promise.resolve(config ? makeDashboard(id, config) : null);
    },
  );
}

interface ConfigWrite {
  id: string;
  data: JSONObject;
  expectedData: JSONObject;
}

function configWrites(): Array<ConfigWrite> {
  return dashboardService.updateColumnsByIdWithoutHooks.mock.calls.map(
    (callArgs: Array<unknown>) => {
      const input: JSONObject = callArgs[0] as JSONObject;
      return {
        id: (input["id"] as ObjectID).toString(),
        data: input["data"] as JSONObject,
        expectedData: input["expectedData"] as JSONObject,
      };
    },
  );
}

describe("RepairKubernetesDashboardClusterCpuTile", () => {
  const migration: RepairKubernetesDashboardClusterCpuTile =
    new RepairKubernetesDashboardClusterCpuTile();

  beforeEach(() => {
    jest.clearAllMocks();
    dashboardService.findBy.mockResolvedValue([] as never);
    dashboardService.findOneById.mockResolvedValue(null as never);
    dashboardService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined as never,
    );
  });

  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    test("is imported and instantiated in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(indexSource).toContain(`new ${MIGRATION_NAME}()`);
    });

    function registeredMigrations(): Array<string> {
      return Array.from(indexSource.matchAll(/new\s+(\w+)\(\)/g)).map(
        (match: RegExpMatchArray) => {
          return match[1]!;
        },
      );
    }

    /*
     * The runner records each migration by name once it has run, and
     * decides what to run from its position in this list. Inserting a
     * migration ahead of one that has already shipped renumbers everything
     * after it. So what is pinned is this migration's INDEX — the end of
     * the list as of this change — not that it sits last forever.
     */
    const REGISTERED_POSITION: number = 116;

    test("was appended at the end of the list, and keeps that position", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations.indexOf(MIGRATION_NAME)).toBe(REGISTERED_POSITION);
      expect(instantiations.length).toBeGreaterThan(REGISTERED_POSITION);
    });

    test("is registered exactly once", () => {
      expect(
        registeredMigrations().filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }).length,
      ).toBe(1);
    });

    test("is recorded under its class name", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("finding the dashboards", () => {
    test("asks Postgres for the legacy tile by jsonb containment, ids only", async () => {
      await migration.migrate();

      expect(dashboardService.findBy).toHaveBeenCalledTimes(1);

      const input: JSONObject = dashboardService.findBy.mock
        .calls[0]![0] as JSONObject;
      const query: JSONObject = input["query"] as JSONObject;
      const operator: RawOperator = query[
        "dashboardViewConfig"
      ] as unknown as RawOperator;

      expect(Object.keys(query)).toEqual(["dashboardViewConfig"]);
      expect(operator.type).toBe("raw");
      expect(operator.getSql('"Dashboard"."dashboardViewConfig"')).toContain(
        '"Dashboard"."dashboardViewConfig" @> CAST(',
      );
      expect(
        Object.values(operator.objectLiteralParameters).map(
          (value: unknown) => {
            return JSON.parse(value as string);
          },
        ),
      ).toEqual([KubernetesClusterCpuTileRepair.getLegacyTileContainment()]);

      expect(input["select"]).toEqual({ _id: true });
      expect(input["sort"]).toEqual({ _id: SortOrder.Ascending });
      expect(input["props"]).toEqual({ isRoot: true });
    });

    test("pages past LIMIT_MAX so the tail of a large table is not skipped", async () => {
      const ids: Array<ObjectID> = Array.from({ length: LIMIT_MAX + 1 }, () => {
        return ObjectID.generate();
      });
      serveMatchingIdsInPages(ids);

      await migration.migrate();

      expect(dashboardService.findBy).toHaveBeenCalledTimes(2);
      expect(
        (dashboardService.findBy.mock.calls[1]![0] as JSONObject)["skip"],
      ).toBe(LIMIT_MAX);
      expect(dashboardService.findOneById).toHaveBeenCalledTimes(LIMIT_MAX + 1);
    });

    test("finds every id before writing anything", async () => {
      const ids: Array<ObjectID> = [ObjectID.generate(), ObjectID.generate()];
      serveMatchingIdsInPages(ids);
      serveStoredConfigs(
        new Map([
          [ids[0]!.toString(), legacyConfig()],
          [ids[1]!.toString(), legacyConfig()],
        ]),
      );

      await migration.migrate();

      const lastLookup: number = Math.max(
        ...dashboardService.findBy.mock.invocationCallOrder,
      );
      const firstWrite: number = Math.min(
        ...dashboardService.updateColumnsByIdWithoutHooks.mock
          .invocationCallOrder,
      );

      expect(configWrites()).toHaveLength(2);
      expect(lastLookup).toBeLessThan(firstWrite);
    });
  });

  describe("writing", () => {
    test("writes the repaired config, guarded by the config it read", async () => {
      const id: ObjectID = ObjectID.generate();
      serveMatchingIdsInPages([id]);
      serveStoredConfigs(new Map([[id.toString(), legacyConfig()]]));

      await migration.migrate();

      expect(configWrites()).toEqual([
        {
          id: id.toString(),
          data: { dashboardViewConfig: repairedConfig() },
          expectedData: { dashboardViewConfig: legacyConfig() },
        },
      ]);
      expect(mockedLogger.info).toHaveBeenCalledTimes(1);
    });

    test("reads the config it writes, not just the id", async () => {
      const id: ObjectID = ObjectID.generate();
      serveMatchingIdsInPages([id]);
      serveStoredConfigs(new Map([[id.toString(), legacyConfig()]]));

      await migration.migrate();

      const input: JSONObject = dashboardService.findOneById.mock
        .calls[0]![0] as JSONObject;
      expect((input["id"] as ObjectID).toString()).toBe(id.toString());
      expect(input["select"]).toEqual({ _id: true, dashboardViewConfig: true });
      expect(input["props"]).toEqual({ isRoot: true });
    });

    /*
     * Between the id lookup and the read, a user may have fixed the tile
     * themselves, or deleted the dashboard. Neither gets a write.
     */
    test("writes nothing when the tile was already changed or the dashboard is gone", async () => {
      const editedId: ObjectID = ObjectID.generate();
      const deletedId: ObjectID = ObjectID.generate();
      serveMatchingIdsInPages([editedId, deletedId]);
      serveStoredConfigs(new Map([[editedId.toString(), repairedConfig()]]));

      await migration.migrate();

      expect(dashboardService.findOneById).toHaveBeenCalledTimes(2);
      expect(configWrites()).toEqual([]);
      expect(mockedLogger.info).not.toHaveBeenCalled();
    });

    test("does nothing on a table with no legacy tile", async () => {
      await migration.migrate();

      expect(dashboardService.findOneById).not.toHaveBeenCalled();
      expect(configWrites()).toEqual([]);
      expect(mockedLogger.info).not.toHaveBeenCalled();
    });

    test("one failing dashboard does not stop the rest", async () => {
      const unreadableId: ObjectID = ObjectID.generate();
      const unwritableId: ObjectID = ObjectID.generate();
      const healthyId: ObjectID = ObjectID.generate();
      serveMatchingIdsInPages([unreadableId, unwritableId, healthyId]);
      serveStoredConfigs(
        new Map([
          [unwritableId.toString(), legacyConfig()],
          [healthyId.toString(), legacyConfig()],
        ]),
      );

      const findOneById: jest.Mock = dashboardService.findOneById;
      const serveStored: (...args: Array<unknown>) => unknown =
        findOneById.getMockImplementation() as (
          ...args: Array<unknown>
        ) => unknown;
      findOneById.mockImplementation((...callArgs: Array<unknown>) => {
        const id: ObjectID = (callArgs[0] as JSONObject)["id"] as ObjectID;
        if (id.toString() === unreadableId.toString()) {
          return Promise.reject(new Error("read failed"));
        }
        return serveStored(...callArgs);
      });

      dashboardService.updateColumnsByIdWithoutHooks.mockImplementation(
        (...callArgs: Array<unknown>) => {
          const id: ObjectID = (callArgs[0] as JSONObject)["id"] as ObjectID;
          if (id.toString() === unwritableId.toString()) {
            return Promise.reject(new Error("write failed"));
          }
          return Promise.resolve(undefined);
        },
      );

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(
        configWrites().map((write: ConfigWrite) => {
          return write.id;
        }),
      ).toEqual([unwritableId.toString(), healthyId.toString()]);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(unreadableId.toString()),
      );
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(unwritableId.toString()),
      );
      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("on 1 dashboard(s)"),
      );
    });
  });

  test("rollback is a no-op", async () => {
    await expect(migration.rollback()).resolves.toBeUndefined();
  });
});
