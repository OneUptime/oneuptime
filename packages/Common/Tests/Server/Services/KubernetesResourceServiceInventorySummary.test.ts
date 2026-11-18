import KubernetesResourceService, {
  InventorySummary,
  POD_CANNOT_RUN_REASON_SQL,
} from "../../../Server/Services/KubernetesResourceService";
import { KUBERNETES_FAILING_WAIT_REASONS } from "../../../Types/Kubernetes/KubernetesHealth";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * A Kubernetes cluster's hero counts its pods the way kubectl's STATUS
 * column says them (#9537): a pod whose container cannot run - flagged
 * critical by ingest - is counted under kubectl's word for it,
 * CrashLoopBackOff or ImagePullBackOff, never as Running or Pending, which
 * its phase still says. These pin the one query that counts both the
 * phases and those words, and how its rows become podPhaseCounts (the
 * phases, as before) and podStatusCounts (each pod once).
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const CLUSTER: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");

type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

interface PodRow {
  phase: string | null;
  cannotRunReason: string | null;
  count: string;
}

describe("KubernetesResourceService.getInventorySummary counts each pod once", () => {
  let query: Mock<QueryFunction>;
  let podRows: Array<PodRow>;

  beforeEach(() => {
    podRows = [];
    query = jest.fn<QueryFunction>().mockImplementation(
      async (sql: string): Promise<unknown> => {
        if (sql.includes(`"cannotRunReason"`)) {
          return podRows;
        }
        if (sql.includes(`GROUP BY "kind"`)) {
          return [
            { kind: "Pod", count: "74" },
            { kind: "Node", count: "4" },
          ];
        }
        if (sql.includes(`"notReady"`)) {
          return [
            {
              ready: "3",
              notReady: "1",
              memoryPressure: "0",
              diskPressure: "0",
              pidPressure: "0",
            },
          ];
        }
        return [{ total: "90" }];
      },
    );
    jest.spyOn(KubernetesResourceService, "getRepository").mockReturnValue({
      manager: { query },
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function summarize(): Promise<InventorySummary> {
    return KubernetesResourceService.getInventorySummary({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
    });
  }

  function podQuery(): [string, Array<unknown>] {
    const call: [string, Array<unknown>] | undefined = query.mock.calls.find(
      (args: [string, Array<unknown>]): boolean => {
        return args[0].includes(`"cannotRunReason"`);
      },
    ) as [string, Array<unknown>] | undefined;
    expect(call).toBeDefined();
    return call as [string, Array<unknown>];
  }

  test("reads the phases and each critical pod's word in one query, scoped to the cluster's live pods", async () => {
    await summarize();
    const [sql, parameters] = podQuery();

    expect(sql).toContain(`"kind" = 'Pod'`);
    expect(sql).toContain(`"deletedAt" IS NULL`);
    expect(sql).toContain(`WHEN "healthSeverity" = 'critical'`);
    expect(sql).toContain(POD_CANNOT_RUN_REASON_SQL);
    expect(sql).toContain("GROUP BY 1, 2");
    expect(parameters[0]).toBe(PROJECT.toString());
    expect(parameters[1]).toBe(CLUSTER.toString());
    // The words that mean a container cannot run: the rules' own list.
    expect(JSON.parse(parameters[2] as string)).toEqual({
      reasons: Array.from(KUBERNETES_FAILING_WAIT_REASONS),
    });
  });

  test("names a pod's word as the rules do: a waiting container first, then an init container's, as Init:", () => {
    expect(POD_CANNOT_RUN_REASON_SQL).toContain(
      `'$.containerStatuses[*] ? (@.state == "waiting" && @.reason == $reasons[*]).reason'`,
    );
    expect(POD_CANNOT_RUN_REASON_SQL).toContain(
      `'Init:' || (jsonb_path_query_first(`,
    );
    expect(POD_CANNOT_RUN_REASON_SQL).toContain(
      `(@.state == "terminated" && @.reason != "" && @.reason != "Completed")`,
    );
    // A pod whose word could not be read still counts, under "".
    expect(POD_CANNOT_RUN_REASON_SQL.trim().endsWith(`''\n)`)).toBe(true);
  });

  test("counts a crash-looping pod under its word, not as Running", async () => {
    podRows = [
      { phase: "Running", cannotRunReason: null, count: "69" },
      { phase: "Running", cannotRunReason: "CrashLoopBackOff", count: "2" },
      { phase: "Failed", cannotRunReason: null, count: "3" },
    ];

    const summary: InventorySummary = await summarize();

    expect(summary.podStatusCounts).toEqual({
      running: 69,
      pending: 0,
      failed: 3,
      succeeded: 0,
      unknown: 0,
      cannotRun: [{ reason: "CrashLoopBackOff", count: 2 }],
    });
    // The phases stay the phases: 71 pods are in phase Running.
    expect(summary.podPhaseCounts).toEqual({
      running: 71,
      pending: 0,
      failed: 3,
      succeeded: 0,
      unknown: 0,
    });
  });

  test("counts a pending pod whose image will not pull under its word, not as Pending, and adds the same word across phases", async () => {
    podRows = [
      { phase: "Pending", cannotRunReason: null, count: "1" },
      { phase: "Pending", cannotRunReason: "ImagePullBackOff", count: "2" },
      { phase: "Running", cannotRunReason: "ImagePullBackOff", count: "1" },
      { phase: "Pending", cannotRunReason: "Init:CrashLoopBackOff", count: "1" },
    ];

    const summary: InventorySummary = await summarize();

    expect(summary.podStatusCounts.pending).toBe(1);
    expect(summary.podStatusCounts.running).toBe(0);
    expect(summary.podStatusCounts.cannotRun).toEqual([
      { reason: "ImagePullBackOff", count: 3 },
      { reason: "Init:CrashLoopBackOff", count: 1 },
    ]);
    expect(summary.podPhaseCounts.pending).toBe(4);
    expect(summary.podPhaseCounts.running).toBe(1);
  });

  test("lists the words the most first, then by name", async () => {
    podRows = [
      { phase: "Running", cannotRunReason: "RunContainerError", count: "1" },
      { phase: "Running", cannotRunReason: "CrashLoopBackOff", count: "4" },
      { phase: "Pending", cannotRunReason: "CreateContainerConfigError", count: "1" },
    ];

    const summary: InventorySummary = await summarize();

    expect(summary.podStatusCounts.cannotRun).toEqual([
      { reason: "CrashLoopBackOff", count: 4 },
      { reason: "CreateContainerConfigError", count: 1 },
      { reason: "RunContainerError", count: 1 },
    ]);
  });

  test("keeps a pod whose word could not be read, under no word", async () => {
    podRows = [{ phase: "Running", cannotRunReason: "", count: "1" }];

    const summary: InventorySummary = await summarize();

    expect(summary.podStatusCounts.cannotRun).toEqual([
      { reason: "", count: 1 },
    ]);
    expect(summary.podStatusCounts.running).toBe(0);
  });

  test("counts a Failed or Succeeded pod by its phase, even with a critical verdict older rules stored", async () => {
    podRows = [
      { phase: "Failed", cannotRunReason: "CrashLoopBackOff", count: "1" },
      { phase: "Succeeded", cannotRunReason: "Init:Error", count: "1" },
    ];

    const summary: InventorySummary = await summarize();

    expect(summary.podStatusCounts.failed).toBe(1);
    expect(summary.podStatusCounts.succeeded).toBe(1);
    expect(summary.podStatusCounts.cannotRun).toEqual([]);
  });

  test("counts only Kubernetes' own Unknown phase as Unknown: a pod with no phase yet is no problem", async () => {
    podRows = [
      { phase: "Unknown", cannotRunReason: null, count: "2" },
      { phase: null, cannotRunReason: null, count: "5" },
    ];

    const summary: InventorySummary = await summarize();

    expect(summary.podStatusCounts.unknown).toBe(2);
    // The phases count both, as they always did.
    expect(summary.podPhaseCounts.unknown).toBe(7);
  });

  test("an empty cluster counts nothing", async () => {
    const summary: InventorySummary = await summarize();

    expect(summary.podStatusCounts).toEqual({
      running: 0,
      pending: 0,
      failed: 0,
      succeeded: 0,
      unknown: 0,
      cannotRun: [],
    });
  });

  test("still counts every kind, the nodes and the containers", async () => {
    const summary: InventorySummary = await summarize();

    expect(summary.countsByKind).toEqual({ Pod: 74, Node: 4 });
    expect(summary.nodeReadyCounts).toEqual({ ready: 3, notReady: 1 });
    expect(summary.containerCount).toBe(90);
  });
});
