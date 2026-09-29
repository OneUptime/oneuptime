import KubernetesClusterAiAccessService, {
  CLUSTER_AI_ACCESS_SELECT,
} from "../../../Server/Services/KubernetesClusterAiAccessService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import MonitorService from "../../../Server/Services/MonitorService";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — KubernetesClusterAiAccessService.getClustersForSubject,
 * which decides which clusters an incident or alert investigation (and the
 * panel that explains it) may reach with kubectl:
 *
 * - the clusters linked on the subject win; the monitors are not read at all;
 * - with none linked, the cluster a Kubernetes monitor step names is the
 *   fallback, matched CASE-INSENSITIVELY (a step identifier is typed by a
 *   person and may differ in case from the ingest-stamped row, exactly as
 *   MonitorResourceContext and SeriesResourceLinker treat it);
 * - every read is scoped to the subject's project, archived clusters are
 *   never returned, and the lookups are capped;
 * - a subject with nothing to go on returns [] without a cluster query.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const CLUSTER_A: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CLUSTER_B: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const MONITOR_1: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const MONITOR_2: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

/*
 * TypeORM's Raw FindOperator, structurally. QueryHelper.any renders
 * `(<col> IN (...))` (an exact, case-sensitive match) and
 * QueryHelper.findWithSameTextAnyOf renders `(LOWER(<col>) IN (...))` with
 * the values lowercased; both bind the values as one array parameter.
 */
type FindOperatorLike = {
  type: string;
  getSql?: ((alias: string) => string) | undefined;
  objectLiteralParameters?: Record<string, unknown> | undefined;
};

function sqlOf(filter: unknown): string {
  return (filter as FindOperatorLike).getSql!('"col"');
}

function valuesOf(filter: unknown): Array<string> {
  const values: Array<unknown> = Object.values(
    (filter as FindOperatorLike).objectLiteralParameters || {},
  );
  expect(values).toHaveLength(1);
  return values[0] as Array<string>;
}

function isExactInFilter(filter: unknown): boolean {
  return sqlOf(filter) === '("col" IN (:...' + ridOf(filter) + "))";
}

function ridOf(filter: unknown): string {
  return Object.keys(
    (filter as FindOperatorLike).objectLiteralParameters || {},
  )[0]!;
}

function kubernetesMonitor(
  id: ObjectID,
  clusterIdentifiers: Array<string | undefined>,
): Monitor {
  return {
    id,
    _id: id.toString(),
    monitorSteps: {
      data: {
        monitorStepsInstanceArray: clusterIdentifiers.map(
          (clusterIdentifier: string | undefined) => {
            return {
              data: {
                kubernetesMonitor:
                  clusterIdentifier === undefined
                    ? undefined
                    : { clusterIdentifier },
              },
            };
          },
        ),
      },
    },
  } as unknown as Monitor;
}

function clusterRow(id: ObjectID, identifier: string): KubernetesCluster {
  return {
    id,
    _id: id.toString(),
    projectId: PROJECT_ID,
    clusterIdentifier: identifier,
  } as unknown as KubernetesCluster;
}

describe("KubernetesClusterAiAccessService.getClustersForSubject", () => {
  let clusterFind: jest.SpyInstance;
  let monitorFind: jest.SpyInstance;
  let incidentFind: jest.SpyInstance;
  let alertFind: jest.SpyInstance;

  function clusterQuery(): Record<string, unknown> {
    expect(clusterFind).toHaveBeenCalledTimes(1);
    return (clusterFind.mock.calls[0]![0] as { query: Record<string, unknown> })
      .query;
  }

  beforeEach(() => {
    clusterFind = jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([]);
    monitorFind = jest.spyOn(MonitorService, "findBy").mockResolvedValue([]);
    incidentFind = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(null);
    alertFind = jest.spyOn(AlertService, "findOneBy").mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("an incident whose clusters are linked", () => {
    it("returns the linked clusters, scoped to the project and not archived, without reading monitors", async () => {
      incidentFind.mockResolvedValue({
        id: INCIDENT_ID,
        monitors: [{ id: MONITOR_1 }],
        kubernetesClusters: [{ id: CLUSTER_A }, { id: CLUSTER_B }],
      } as unknown as Incident);
      clusterFind.mockResolvedValue([
        clusterRow(CLUSTER_A, "prod-us"),
        clusterRow(CLUSTER_B, "prod-eu"),
      ]);

      const clusters: Array<KubernetesCluster> =
        await KubernetesClusterAiAccessService.getClustersForSubject({
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
        });

      expect(clusters).toHaveLength(2);
      expect(monitorFind).not.toHaveBeenCalled();

      const incidentQuery: Record<string, unknown> = (
        incidentFind.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(incidentQuery["_id"]).toBe(INCIDENT_ID.toString());
      expect(incidentQuery["projectId"]).toBe(PROJECT_ID);

      const query: Record<string, unknown> = clusterQuery();
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["isArchived"]).toBe(false);
      expect(query["clusterIdentifier"]).toBeUndefined();

      expect(isExactInFilter(query["_id"])).toBe(true);
      expect(valuesOf(query["_id"])).toEqual([
        CLUSTER_A.toString(),
        CLUSTER_B.toString(),
      ]);

      // The columns the readiness computation needs.
      const findArgs: { select: Record<string, unknown>; limit: number } =
        clusterFind.mock.calls[0]![0] as {
          select: Record<string, unknown>;
          limit: number;
        };
      expect(findArgs.select).toEqual(CLUSTER_AI_ACCESS_SELECT);
      expect(findArgs.limit).toBe(10);
    });

    it("caps the linked cluster ids at 10", async () => {
      const linked: Array<{ id: ObjectID }> = [];
      for (let index: number = 0; index < 14; index++) {
        linked.push({ id: ObjectID.generate() });
      }
      incidentFind.mockResolvedValue({
        id: INCIDENT_ID,
        monitors: [],
        kubernetesClusters: linked,
      } as unknown as Incident);

      await KubernetesClusterAiAccessService.getClustersForSubject({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

      expect(valuesOf(clusterQuery()["_id"])).toHaveLength(10);
    });
  });

  describe("the monitor-step fallback when nothing is linked", () => {
    it("matches the step's identifier case-insensitively ('Prod-US' finds the 'prod-us' row)", async () => {
      incidentFind.mockResolvedValue({
        id: INCIDENT_ID,
        monitors: [{ id: MONITOR_1 }],
        kubernetesClusters: [],
      } as unknown as Incident);
      monitorFind.mockResolvedValue([
        kubernetesMonitor(MONITOR_1, [" Prod-US "]),
      ]);
      clusterFind.mockResolvedValue([clusterRow(CLUSTER_A, "prod-us")]);

      const clusters: Array<KubernetesCluster> =
        await KubernetesClusterAiAccessService.getClustersForSubject({
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
        });

      expect(
        clusters.map((cluster: KubernetesCluster) => {
          return cluster.clusterIdentifier;
        }),
      ).toEqual(["prod-us"]);

      const query: Record<string, unknown> = clusterQuery();
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["isArchived"]).toBe(false);
      expect(query["_id"]).toBeUndefined();

      /*
       * A LOWER(...) IN (...) comparison with the identifier normalized —
       * not a plain IN, which would compare 'Prod-US' to 'prod-us' as
       * different strings.
       */
      expect(sqlOf(query["clusterIdentifier"])).toContain('LOWER("col") IN');
      expect(isExactInFilter(query["clusterIdentifier"])).toBe(false);
      expect(valuesOf(query["clusterIdentifier"])).toEqual(["prod-us"]);

      // The monitors are read from this project only.
      const monitorQuery: Record<string, unknown> = (
        monitorFind.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(monitorQuery["projectId"]).toBe(PROJECT_ID);
    });

    it("collects identifiers across monitors and steps, de-duplicated regardless of case, skipping non-Kubernetes steps", async () => {
      incidentFind.mockResolvedValue({
        id: INCIDENT_ID,
        monitors: [{ id: MONITOR_1 }, { id: MONITOR_2 }],
        kubernetesClusters: [],
      } as unknown as Incident);
      monitorFind.mockResolvedValue([
        kubernetesMonitor(MONITOR_1, ["prod-us", undefined, "PROD-US"]),
        kubernetesMonitor(MONITOR_2, ["prod-eu", "   "]),
      ]);

      await KubernetesClusterAiAccessService.getClustersForSubject({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

      expect(valuesOf(clusterQuery()["clusterIdentifier"])).toEqual([
        "prod-us",
        "prod-eu",
      ]);
    });

    it("works the same for an alert, reading its one monitor", async () => {
      alertFind.mockResolvedValue({
        id: ALERT_ID,
        monitorId: MONITOR_1,
        kubernetesClusters: [],
      } as unknown as Alert);
      monitorFind.mockResolvedValue([
        kubernetesMonitor(MONITOR_1, ["Prod-US"]),
      ]);
      clusterFind.mockResolvedValue([clusterRow(CLUSTER_A, "prod-us")]);

      const clusters: Array<KubernetesCluster> =
        await KubernetesClusterAiAccessService.getClustersForSubject({
          projectId: PROJECT_ID,
          alertId: ALERT_ID,
        });

      expect(clusters).toHaveLength(1);
      expect(incidentFind).not.toHaveBeenCalled();

      const alertQuery: Record<string, unknown> = (
        alertFind.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(alertQuery["_id"]).toBe(ALERT_ID.toString());
      expect(alertQuery["projectId"]).toBe(PROJECT_ID);

      expect(
        valuesOf(
          (monitorFind.mock.calls[0]![0] as { query: Record<string, unknown> })
            .query["_id"],
        ),
      ).toEqual([MONITOR_1.toString()]);

      const identifierFilter: unknown = clusterQuery()["clusterIdentifier"];
      expect(sqlOf(identifierFilter)).toContain('LOWER("col") IN');
      expect(valuesOf(identifierFilter)).toEqual(["prod-us"]);
    });

    it("an alert's linked clusters win over its monitor, like an incident's", async () => {
      alertFind.mockResolvedValue({
        id: ALERT_ID,
        monitorId: MONITOR_1,
        kubernetesClusters: [{ id: CLUSTER_B }],
      } as unknown as Alert);

      await KubernetesClusterAiAccessService.getClustersForSubject({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
      });

      expect(monitorFind).not.toHaveBeenCalled();
      expect(isExactInFilter(clusterQuery()["_id"])).toBe(true);
      expect(valuesOf(clusterQuery()["_id"])).toEqual([CLUSTER_B.toString()]);
    });

    it("returns [] without a cluster query when no step names a cluster", async () => {
      incidentFind.mockResolvedValue({
        id: INCIDENT_ID,
        monitors: [{ id: MONITOR_1 }],
        kubernetesClusters: [],
      } as unknown as Incident);
      monitorFind.mockResolvedValue([
        kubernetesMonitor(MONITOR_1, ["  ", undefined]),
      ]);

      const clusters: Array<KubernetesCluster> =
        await KubernetesClusterAiAccessService.getClustersForSubject({
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
        });

      expect(clusters).toEqual([]);
      expect(clusterFind).not.toHaveBeenCalled();
    });

    it("reads at most 10 monitors", async () => {
      const monitors: Array<{ id: ObjectID }> = [];
      for (let index: number = 0; index < 12; index++) {
        monitors.push({ id: ObjectID.generate() });
      }
      incidentFind.mockResolvedValue({
        id: INCIDENT_ID,
        monitors,
        kubernetesClusters: [],
      } as unknown as Incident);

      await KubernetesClusterAiAccessService.getClustersForSubject({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

      const args: { query: Record<string, unknown>; limit: number } =
        monitorFind.mock.calls[0]![0] as {
          query: Record<string, unknown>;
          limit: number;
        };
      expect(valuesOf(args.query["_id"])).toHaveLength(10);
      expect(args.limit).toBe(10);
    });
  });

  it("returns [] for a subject that does not exist in the project", async () => {
    const clusters: Array<KubernetesCluster> =
      await KubernetesClusterAiAccessService.getClustersForSubject({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      });

    expect(clusters).toEqual([]);
    expect(clusterFind).not.toHaveBeenCalled();
    expect(monitorFind).not.toHaveBeenCalled();
  });

  it("returns [] when neither an incident nor an alert is named", async () => {
    const clusters: Array<KubernetesCluster> =
      await KubernetesClusterAiAccessService.getClustersForSubject({
        projectId: PROJECT_ID,
      });

    expect(clusters).toEqual([]);
    expect(incidentFind).not.toHaveBeenCalled();
    expect(alertFind).not.toHaveBeenCalled();
    expect(clusterFind).not.toHaveBeenCalled();
  });
});
