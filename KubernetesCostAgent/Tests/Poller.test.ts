import * as assert from "assert";
import { test } from "node:test";
import { floorToWindow, mapAllocationToRow } from "../AllocationMapper";
import { EngineAllocation, KubernetesCostAllocationIngestRow } from "../Types";

process.env["TZ"] = "UTC";

test("floorToWindow floors to the hourly grid", (): void => {
  const t: number = Date.parse("2026-07-24T10:42:13Z");
  assert.strictEqual(
    floorToWindow(t, 3600),
    Date.parse("2026-07-24T10:00:00Z"),
  );
  assert.strictEqual(
    floorToWindow(Date.parse("2026-07-24T10:00:00Z"), 3600),
    Date.parse("2026-07-24T10:00:00Z"),
  );
});

test("mapAllocationToRow maps properties and sums adjustments", (): void => {
  const allocation: EngineAllocation = {
    name: "prod/deployment/api/api-abc/api",
    properties: {
      cluster: "prod-cluster",
      node: "node-1",
      container: "api",
      controller: "api",
      controllerKind: "deployment",
      namespace: "prod",
      pod: "api-abc",
      providerID: "i-0123456789",
      labels: { team: "payments" },
    },
    window: {
      start: "2026-07-24T10:00:00Z",
      end: "2026-07-24T11:00:00Z",
    },
    cpuCoreHours: 1.5,
    cpuCost: 0.05,
    cpuCostAdjustment: -0.01,
    ramByteHours: 1073741824,
    ramCost: 0.02,
    totalCost: 0.06,
    cpuEfficiency: 0.4,
    ramEfficiency: 0.8,
    totalEfficiency: 0.5,
  };

  const row: KubernetesCostAllocationIngestRow = mapAllocationToRow({
    allocation,
    windowStart: new Date("2026-07-24T10:00:00Z"),
    windowEnd: new Date("2026-07-24T11:00:00Z"),
  });

  assert.strictEqual(row.namespace, "prod");
  assert.strictEqual(row.controllerKind, "deployment");
  assert.strictEqual(row.controllerName, "api");
  assert.strictEqual(row.podName, "api-abc");
  assert.strictEqual(row.containerName, "api");
  assert.strictEqual(row.nodeName, "node-1");
  assert.strictEqual(row.providerId, "i-0123456789");
  assert.deepStrictEqual(row.labels, { team: "payments" });
  assert.strictEqual(row.windowStart, "2026-07-24T10:00:00Z");
  assert.strictEqual(row.windowEnd, "2026-07-24T11:00:00Z");
  // cpuCost + cpuCostAdjustment
  assert.ok(Math.abs((row.cpuCost || 0) - 0.04) < 1e-9);
  assert.strictEqual(row.totalCost, 0.06);
  assert.strictEqual(row.cpuEfficiency, 0.4);
});

test("mapAllocationToRow marks idle allocations with the sentinel namespace", (): void => {
  const allocation: EngineAllocation = {
    name: "__idle__",
    window: {
      start: "2026-07-24T10:00:00Z",
      end: "2026-07-24T11:00:00Z",
    },
    totalCost: 1.23,
  };

  const row: KubernetesCostAllocationIngestRow = mapAllocationToRow({
    allocation,
    windowStart: new Date("2026-07-24T10:00:00Z"),
    windowEnd: new Date("2026-07-24T11:00:00Z"),
  });

  assert.strictEqual(row.namespace, "__idle__");
  assert.strictEqual(row.totalCost, 1.23);
});

test("mapAllocationToRow falls back to the requested window", (): void => {
  const row: KubernetesCostAllocationIngestRow = mapAllocationToRow({
    allocation: { totalCost: 1 },
    windowStart: new Date("2026-07-24T10:00:00Z"),
    windowEnd: new Date("2026-07-24T11:00:00Z"),
  });

  assert.strictEqual(row.windowStart, "2026-07-24T10:00:00.000Z");
  assert.strictEqual(row.windowEnd, "2026-07-24T11:00:00.000Z");
});

test("mapAllocationToRow marks unallocated capacity with its sentinel", (): void => {
  const row: KubernetesCostAllocationIngestRow = mapAllocationToRow({
    allocation: {
      name: "__unallocated__",
      totalCost: 0.4,
    },
    windowStart: new Date("2026-07-24T10:00:00Z"),
    windowEnd: new Date("2026-07-24T11:00:00Z"),
  });

  assert.strictEqual(row.namespace, "__unallocated__");
});

test("mapAllocationToRow keeps a real namespace even when the name contains a sentinel", (): void => {
  const row: KubernetesCostAllocationIngestRow = mapAllocationToRow({
    allocation: {
      name: "cluster/__idle__",
      properties: { namespace: "prod" },
      totalCost: 1,
    },
    windowStart: new Date("2026-07-24T10:00:00Z"),
    windowEnd: new Date("2026-07-24T11:00:00Z"),
  });

  assert.strictEqual(row.namespace, "prod");
});

test("mapAllocationToRow sums adjustments for every cost component", (): void => {
  const row: KubernetesCostAllocationIngestRow = mapAllocationToRow({
    allocation: {
      cpuCost: 1,
      cpuCostAdjustment: 0.1,
      gpuCost: 2,
      gpuCostAdjustment: 0.2,
      ramCost: 3,
      ramCostAdjustment: 0.3,
      pvCost: 4,
      pvCostAdjustment: 0.4,
      networkCost: 5,
      networkCostAdjustment: 0.5,
      loadBalancerCost: 6,
      loadBalancerCostAdjustment: 0.6,
    },
    windowStart: new Date("2026-07-24T10:00:00Z"),
    windowEnd: new Date("2026-07-24T11:00:00Z"),
  });

  assert.ok(Math.abs((row.cpuCost || 0) - 1.1) < 1e-9);
  assert.ok(Math.abs((row.gpuCost || 0) - 2.2) < 1e-9);
  assert.ok(Math.abs((row.ramCost || 0) - 3.3) < 1e-9);
  assert.ok(Math.abs((row.pvCost || 0) - 4.4) < 1e-9);
  assert.ok(Math.abs((row.networkCost || 0) - 5.5) < 1e-9);
  assert.ok(Math.abs((row.loadBalancerCost || 0) - 6.6) < 1e-9);
});

test("mapAllocationToRow treats adjustment-only components as the component cost", (): void => {
  const row: KubernetesCostAllocationIngestRow = mapAllocationToRow({
    allocation: {
      cpuCostAdjustment: -0.25,
    },
    windowStart: new Date("2026-07-24T10:00:00Z"),
    windowEnd: new Date("2026-07-24T11:00:00Z"),
  });

  assert.strictEqual(row.cpuCost, -0.25);
});

test("mapAllocationToRow prefers the allocation's own window over the requested one", (): void => {
  const row: KubernetesCostAllocationIngestRow = mapAllocationToRow({
    allocation: {
      start: "2026-07-24T10:15:00Z",
      end: "2026-07-24T10:45:00Z",
      totalCost: 1,
    },
    windowStart: new Date("2026-07-24T10:00:00Z"),
    windowEnd: new Date("2026-07-24T11:00:00Z"),
  });

  assert.strictEqual(row.windowStart, "2026-07-24T10:15:00Z");
  assert.strictEqual(row.windowEnd, "2026-07-24T10:45:00Z");
});

test("floorToWindow supports non-hour grids", (): void => {
  const t: number = Date.parse("2026-07-24T10:42:13Z");
  assert.strictEqual(floorToWindow(t, 60), Date.parse("2026-07-24T10:42:00Z"));
  assert.strictEqual(
    floorToWindow(t, 86400),
    Date.parse("2026-07-24T00:00:00Z"),
  );
});
