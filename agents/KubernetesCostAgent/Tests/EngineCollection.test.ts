import "./TestEnv";
import * as assert from "assert";
import { test } from "node:test";
import { CostEngineClient } from "../CostEngineClient";
import {
  kubecostCollectedThrough,
  readKubecostCollectedThrough,
} from "../EngineCollection";

/*
 * A Kubecost answers the Allocation API from its aggregator, which collects
 * in batches ten minutes or more apart: an hour read two minutes after it
 * closed was partly there, and shipped once. Each Kubecost says how far it
 * has collected each cluster (/model/clusters/status, lastCollectedTime),
 * which is what the agent waits for. The answers below are Kubecost 3.3.2's
 * and Kubecost 2.8.7's on a kind cluster.
 */

const KUBECOST3_CLUSTERS: unknown = [
  {
    id: "cost-metrics-3",
    accountID: "",
    cloudId: "",
    provider: "custom",
    name: "",
    lastCollectedTime: "2026-11-19T16:05:00Z",
    cost: 0.2218044419050948,
    monitoringStatus: "active",
  },
];

test("reads how far Kubecost has collected the cluster", (): void => {
  assert.deepStrictEqual(
    kubecostCollectedThrough(KUBECOST3_CLUSTERS, "cost-metrics-3"),
    new Date("2026-11-19T16:05:00Z"),
  );
  // Its only cluster, before the agent knows its name.
  assert.deepStrictEqual(
    kubecostCollectedThrough(KUBECOST3_CLUSTERS, ""),
    new Date("2026-11-19T16:05:00Z"),
  );
});

test("of a Kubecost that answers for several clusters, this one's", (): void => {
  const clusters: unknown = [
    { id: "prod-us", lastCollectedTime: "2026-11-19T15:50:00Z" },
    { id: "prod-eu", lastCollectedTime: "2026-11-19T16:10:00Z" },
  ];

  assert.deepStrictEqual(
    kubecostCollectedThrough(clusters, "prod-eu"),
    new Date("2026-11-19T16:10:00Z"),
  );
  // Which one is this cluster is not known yet: no answer, not a guess.
  assert.strictEqual(kubecostCollectedThrough(clusters, ""), null);
  assert.strictEqual(kubecostCollectedThrough(clusters, "staging"), null);
});

test("says nothing when Kubecost says nothing usable", (): void => {
  for (const clusters of [
    null,
    [],
    "404 page not found",
    [{ id: "cost-metrics-3" }],
    [{ id: "cost-metrics-3", lastCollectedTime: "" }],
    [{ id: "cost-metrics-3", lastCollectedTime: "yesterday" }],
    [{ id: "cost-metrics-3", lastCollectedTime: 1795104000 }],
    // Go's zero time.
    [{ id: "cost-metrics-3", lastCollectedTime: "0001-01-01T00:00:00Z" }],
  ]) {
    assert.strictEqual(
      kubecostCollectedThrough(clusters, "cost-metrics-3"),
      null,
      JSON.stringify(clusters),
    );
  }
});

test("asks Kubecost's aggregator about yesterday and today", async (): Promise<void> => {
  const asked: Array<{ name: string; params?: Record<string, string> }> = [];
  const client: CostEngineClient = {
    fetchApiData: async (
      name: string,
      params?: Record<string, string>,
    ): Promise<unknown> => {
      asked.push({ name, params });
      return KUBECOST3_CLUSTERS;
    },
  } as unknown as CostEngineClient;

  assert.deepStrictEqual(
    await readKubecostCollectedThrough({ client, clusterId: "cost-metrics-3" }),
    new Date("2026-11-19T16:05:00Z"),
  );
  assert.deepStrictEqual(asked, [
    { name: "clusters/status", params: { window: "2d" } },
  ]);
});
