import KubernetesResourceService from "../../../Server/Services/KubernetesResourceService";
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
import fs from "fs";
import path from "path";

/*
 * A DeploymentConfig's list row sums its pods' latest CPU and memory. Those
 * pods belong to the ReplicationController of a rollout (frontend-7), so
 * ownerReferences never name the DeploymentConfig, and metrics ingest fills
 * no controller column for it. OpenShift labels each of them
 * deploymentconfig=<name>, whichever rollout made it, so the rows are grouped
 * on that label.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const CLUSTER: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");
const STALE_AFTER: Date = new Date("2026-11-01T10:00:00.000Z");

type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

describe("getLatestMetricsByOwner for a DeploymentConfig", () => {
  let query: Mock<QueryFunction>;

  beforeEach(() => {
    query = jest.fn<QueryFunction>();
    jest.spyOn(KubernetesResourceService, "getRepository").mockReturnValue({
      manager: { query },
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function read(): Promise<
    Map<
      string,
      { cpuPercent: number; memoryBytes: number; memoryPercent: number }
    >
  > {
    return KubernetesResourceService.getLatestMetricsByOwner({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      ownerKind: "DeploymentConfig",
      staleAfter: STALE_AFTER,
    });
  }

  test("groups the pods by the label OpenShift sets, not by ownerReferences", async () => {
    query.mockResolvedValue([]);

    await read();

    expect(query).toHaveBeenCalledTimes(1);
    const sql: string = query.mock.calls[0]![0];

    expect(sql).toContain(`"labels"->>'deploymentconfig' AS "ownerName"`);
    expect(sql).toContain(`GROUP BY "labels"->>'deploymentconfig'`);
    expect(sql).not.toContain("ownerReferences");
    expect(sql).not.toContain("controllerDeploymentName");
  });

  test("reads only this cluster's live pods with recent metrics, every value bound", async () => {
    query.mockResolvedValue([]);

    await read();

    const sql: string = query.mock.calls[0]![0];
    const parameters: Array<unknown> = query.mock.calls[0]![1];

    expect(sql).toContain(`"kind" = 'Pod'`);
    expect(sql).toContain(`"deletedAt" IS NULL`);
    expect(sql).toContain(`"metricsUpdatedAt" >= $3`);
    expect(sql).toContain(`"labels"->>'deploymentconfig' IS NOT NULL`);
    expect(parameters).toEqual([
      PROJECT.toString(),
      CLUSTER.toString(),
      STALE_AFTER,
    ]);
  });

  test("adds up each DeploymentConfig's pods, and skips a row with no name", async () => {
    query.mockResolvedValue([
      { ownerName: "frontend", cpu: "12.5", mem: "4096", memPct: "1.5" },
      { ownerName: "worker", cpu: null, mem: null, memPct: null },
      { ownerName: "", cpu: "1", mem: "1", memPct: "1" },
    ]);

    const metrics: Awaited<ReturnType<typeof read>> = await read();

    expect(Array.from(metrics.keys())).toEqual(["frontend", "worker"]);
    expect(metrics.get("frontend")).toEqual({
      cpuPercent: 12.5,
      memoryBytes: 4096,
      memoryPercent: 1.5,
    });
    expect(metrics.get("worker")).toEqual({
      cpuPercent: 0,
      memoryBytes: 0,
      memoryPercent: 0,
    });
  });

  test("leaves the other owner kinds on the paths they always took", async () => {
    query.mockResolvedValue([]);

    await KubernetesResourceService.getLatestMetricsByOwner({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      ownerKind: "Deployment",
      staleAfter: STALE_AFTER,
    });
    await KubernetesResourceService.getLatestMetricsByOwner({
      projectId: PROJECT,
      kubernetesClusterId: CLUSTER,
      ownerKind: "StatefulSet",
      staleAfter: STALE_AFTER,
    });

    expect(query.mock.calls[0]![0]).toContain("controllerDeploymentName");
    expect(query.mock.calls[0]![0]).not.toContain("deploymentconfig");
    expect(query.mock.calls[1]![0]).toContain("ownerReferences");
    expect(query.mock.calls[1]![0]).not.toContain("deploymentconfig");
  });
});

describe("the API", () => {
  const code: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Server",
      "API",
      "KubernetesResourceAPI.ts",
    ),
    "utf8",
  );

  test("lets the DeploymentConfigs list ask for its pods' metrics", () => {
    const allowList: string = code.slice(
      code.indexOf("const allowed: Set<string>"),
      code.indexOf("if (!allowed.has(ownerKind))"),
    );

    expect(allowList).toContain('"DeploymentConfig"');
  });

  test.each([
    ["deploymentConfigCount", "DeploymentConfig"],
    ["routeCount", "Route"],
    ["serviceCount", "Service"],
    ["clusterOperatorCount", "ClusterOperator"],
  ])(
    "the summary counts %s from the %s rows",
    (field: string, kind: string) => {
      expect(code).toContain(`${field}: summary.countsByKind["${kind}"] || 0`);
    },
  );
});
