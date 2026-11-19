import "./TestEnv";
import * as assert from "assert";
import * as http from "http";
import { AddressInfo } from "net";
import { after, before, beforeEach, test } from "node:test";
import { CostEngineClient } from "../CostEngineClient";
import {
  EnginePricing,
  LIST_PRICE_PROVIDERS,
  OPENCOST_DEFAULT_CPU_RATE,
  OPENCOST_DEFAULT_RAM_RATE,
  describeEnginePricing,
  describeKubecost3Pricing,
  hasBillingIntegration,
  isOpenCostDefaultRates,
  kubecostClusterStatus,
  kubecostNodeRates,
  readEnginePricing,
} from "../EnginePricing";

/*
 * #9634: the Costs page and the overview say where a cluster's prices come
 * from. The engine is asked: /clusterInfo for the provider it priced the
 * nodes by, and for a cluster no cloud's list prices cover, /allNodePricing
 * for the rates in force.
 */

const DEFAULT_RATES: unknown = {
  default: { CPU: "0.031611", RAM: "0.004237", GPU: "" },
  "default,spot": { CPU: "0.006655", RAM: "0.000892", GPU: "" },
};

const OWN_RATES: unknown = {
  default: { CPU: "0.02", RAM: "0.003", GPU: "" },
};

test("a cloud OpenCost recognises is priced at that cloud's list prices", (): void => {
  for (const provider of LIST_PRICE_PROVIDERS) {
    assert.deepStrictEqual(
      describeEnginePricing({ clusterInfo: { provider, region: "x" } }),
      { source: "list-prices", provider },
    );
  }
});

test("names the provider as OpenCost does, whatever case the engine wrote it in", (): void => {
  assert.deepStrictEqual(
    describeEnginePricing({ clusterInfo: { provider: "aws" } }),
    { source: "list-prices", provider: "AWS" },
  );
});

test("a cloud keeps its list prices even with a rate card the chart set", (): void => {
  /*
   * OpenCost prices a known instance type at the cloud's price whatever the
   * rate card says; the rate card only prices what the list lacks.
   */
  assert.deepStrictEqual(
    describeEnginePricing({
      clusterInfo: { provider: "Azure" },
      rateCardHint: "true",
    }),
    { source: "list-prices", provider: "Azure" },
  );
});

test("no cloud and OpenCost's own rates: its default rates", (): void => {
  assert.deepStrictEqual(
    describeEnginePricing({
      clusterInfo: { provider: "custom" },
      nodePricing: DEFAULT_RATES,
    }),
    { source: "default-rates", provider: "" },
  );
});

test("no cloud and rates of someone's own: a rate card", (): void => {
  assert.deepStrictEqual(
    describeEnginePricing({
      clusterInfo: { provider: "custom" },
      nodePricing: OWN_RATES,
    }),
    { source: "rate-card", provider: "" },
  );
});

test("the engine's rates win over the chart's word about them", (): void => {
  // A rate card enabled with the defaults left in is still the defaults.
  assert.strictEqual(
    describeEnginePricing({
      clusterInfo: { provider: "custom" },
      nodePricing: DEFAULT_RATES,
      rateCardHint: "true",
    }).source,
    "default-rates",
  );
});

test("a CSV price list is a rate card", (): void => {
  assert.deepStrictEqual(
    describeEnginePricing({ clusterInfo: { provider: "CSV" } }),
    { source: "rate-card", provider: "" },
  );
});

test("when the engine cannot say, the chart's word about its bundled engine decides", (): void => {
  assert.strictEqual(
    describeEnginePricing({ clusterInfo: null, rateCardHint: "true" }).source,
    "rate-card",
  );
  assert.strictEqual(
    describeEnginePricing({ clusterInfo: null, rateCardHint: "false" }).source,
    "default-rates",
  );
  assert.strictEqual(
    describeEnginePricing({
      clusterInfo: { provider: "custom" },
      nodePricing: null,
      rateCardHint: "false",
    }).source,
    "default-rates",
  );
});

test("an engine that says nothing, with no word from the chart, is unknown rather than guessed", (): void => {
  assert.deepStrictEqual(describeEnginePricing({ clusterInfo: null }), {
    source: "unknown",
    provider: "",
  });
  assert.strictEqual(
    describeEnginePricing({ clusterInfo: { provider: "-" } }).source,
    "unknown",
  );
  // A provider OpenCost does not price at list prices is not taken for one.
  assert.strictEqual(
    describeEnginePricing({
      clusterInfo: { provider: "SomeNewCloud" },
      rateCardHint: "false",
    }).source,
    "unknown",
  );
});

test("isOpenCostDefaultRates compares the default CPU and RAM rates as numbers", (): void => {
  assert.strictEqual(OPENCOST_DEFAULT_CPU_RATE, 0.031611);
  assert.strictEqual(OPENCOST_DEFAULT_RAM_RATE, 0.004237);
  assert.strictEqual(isOpenCostDefaultRates(DEFAULT_RATES), true);
  assert.strictEqual(
    isOpenCostDefaultRates({ default: { CPU: 0.031611, RAM: "0.0042370" } }),
    true,
  );
  assert.strictEqual(isOpenCostDefaultRates(OWN_RATES), false);
  assert.strictEqual(
    isOpenCostDefaultRates({ default: { CPU: "0.031611", RAM: "0.005" } }),
    false,
  );
  assert.strictEqual(isOpenCostDefaultRates({}), null);
  assert.strictEqual(isOpenCostDefaultRates({ default: {} }), null);
  assert.strictEqual(isOpenCostDefaultRates("nope"), null);
});

// --- Asking a real (stub) engine ---------------------------------------------

let server: http.Server;
let baseUrl: string = "";
let requested: Array<string> = [];
// The same requests with their query strings, decoded.
let requestedUrls: Array<string> = [];
let routes: Record<string, { status: number; body: unknown }> = {};

before(async (): Promise<void> => {
  server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse): void => {
      const path: string = (req.url || "").split("?")[0] || "";
      requested.push(path);
      requestedUrls.push(decodeURIComponent(req.url || ""));
      const route: { status: number; body: unknown } | undefined = routes[path];
      res.writeHead(route ? route.status : 404, {
        "Content-Type": "application/json",
      });
      res.end(
        !route
          ? ""
          : typeof route.body === "string"
            ? route.body
            : JSON.stringify(route.body),
      );
    },
  );
  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async (): Promise<void> => {
  await new Promise<void>((resolve: () => void): void => {
    server.close((): void => {
      resolve();
    });
  });
});

beforeEach((): void => {
  requested = [];
  requestedUrls = [];
  routes = {};
});

const ALLOCATIONS: { status: number; body: unknown } = {
  status: 200,
  body: { code: 200, data: [{}] },
};

const WINDOW: { windowStart: Date; windowEnd: Date } = {
  windowStart: new Date("2026-11-18T10:00:00Z"),
  windowEnd: new Date("2026-11-18T11:00:00Z"),
};

test("asks OpenCost at the root, and only its cluster info for a cloud", async (): Promise<void> => {
  routes = {
    "/allocation/compute": ALLOCATIONS,
    "/clusterInfo": {
      status: 200,
      body: { code: 200, data: { provider: "GCP", id: "prod-eu" } },
    },
  };

  const client: CostEngineClient = new CostEngineClient({ baseUrl });
  await client.fetchAllocations(WINDOW);

  const pricing: EnginePricing = await readEnginePricing({ client });

  assert.deepStrictEqual(pricing, { source: "list-prices", provider: "GCP" });
  // The cloud's whole price list is never asked for.
  assert.ok(!requested.includes("/allNodePricing"));
});

test("asks Kubecost under /model, where its frontend serves the cost model", async (): Promise<void> => {
  routes = {
    "/model/allocation": ALLOCATIONS,
    "/model/clusterInfo": {
      status: 200,
      body: { code: 200, data: { provider: "custom" } },
    },
    "/model/allNodePricing": {
      status: 200,
      body: { code: 200, data: OWN_RATES },
    },
  };

  const client: CostEngineClient = new CostEngineClient({ baseUrl });
  await client.fetchAllocations(WINDOW);

  assert.strictEqual(client.engineKind(), "Kubecost");
  assert.deepStrictEqual(await readEnginePricing({ client }), {
    source: "rate-card",
    provider: "",
  });
  assert.ok(requested.includes("/model/clusterInfo"));
  assert.ok(requested.includes("/model/allNodePricing"));
});

test("an engine whose cluster info will not answer is unknown, and nothing throws", async (): Promise<void> => {
  routes = {
    "/allocation/compute": ALLOCATIONS,
    "/clusterInfo": { status: 500, body: { code: 500, message: "boom" } },
  };

  const client: CostEngineClient = new CostEngineClient({ baseUrl });
  await client.fetchAllocations(WINDOW);

  assert.strictEqual(client.engineKind(), "OpenCost");
  assert.deepStrictEqual(await readEnginePricing({ client }), {
    source: "unknown",
    provider: "",
  });
  // ...unless the chart says what it gave its own engine.
  assert.strictEqual(
    (await readEnginePricing({ client, rateCardHint: "false" })).source,
    "default-rates",
  );
});

test("an answer that is not JSON is no answer", async (): Promise<void> => {
  routes = {
    "/allocation/compute": ALLOCATIONS,
    // A frontend that serves its single-page app for any path it does not know.
    "/clusterInfo": { status: 200, body: "<!doctype html><html></html>" },
  };

  const client: CostEngineClient = new CostEngineClient({ baseUrl });
  await client.fetchAllocations(WINDOW);

  assert.strictEqual(await client.fetchApiData("clusterInfo"), null);
});

/*
 * #9851: Kubecost 3 answers neither /clusterInfo nor /allNodePricing (its
 * frontend sends /model/ to its aggregator), so a cluster it priced showed no
 * prices line. Its aggregator's own APIs say instead. The answers below are
 * the ones Kubecost 3.3.2 gave on a kind cluster, from its own chart.
 */

const KUBECOST3_CLUSTER: Record<string, unknown> = {
  id: "cost-metrics-3",
  accountID: "",
  cloudId: "",
  provider: "custom",
  name: "",
  lastCollectedTime: "2026-11-19T16:05:00Z",
  cost: 0.2218044419050948,
  monitoringStatus: "active",
};

// A node asset of a day, and the other assets the window holds beside it.
const nodeAsset: (overrides?: Record<string, unknown>) => unknown = (
  overrides?: Record<string, unknown>,
): unknown => {
  return {
    type: "Node",
    properties: {
      category: "Compute",
      provider: "custom",
      service: "Kubernetes",
      cluster: "cost-metrics-3",
      name: "cost-9852-control-plane",
      providerID: "kind://docker/cost-9852/cost-9852-control-plane",
    },
    minutes: 8.616667,
    cpuCores: 32,
    ramBytes: 135054692351.999985,
    cpuCoreHours: 4.595556,
    ramByteHours: 19395354429.439999,
    preemptible: 0,
    discount: 0,
    cpuCost: 0.14527,
    gpuCost: 0,
    ramCost: 0.076534,
    adjustment: 0,
    totalCost: 0.221804,
    ...(overrides || {}),
  };
};

const KUBECOST3_ASSETS: unknown = [
  {
    "custom/__undefined__/Compute/cost-metrics-3/Node/Kubernetes/kind://docker/cost-9852/cost-9852-control-plane/cost-9852-control-plane":
      nodeAsset(),
    "custom/__undefined__/Management/cost-metrics-3/ClusterManagement/Kubernetes/__undefined__/__undefined__":
      {
        type: "ClusterManagement",
        properties: {
          category: "Management",
          provider: "custom",
          cluster: "cost-metrics-3",
        },
        totalCost: 0,
      },
  },
];

const AWS_INTEGRATION: Record<string, unknown> = {
  active: true,
  key: "aws-cur",
  provider: "AWS",
  source: "athena",
  connectionStatus: "Connection Successful",
};

const kubecost3: (overrides?: {
  pricingStatus?: unknown;
  clusters?: unknown;
  integrations?: unknown;
  nodeAssets?: unknown;
  clusterId?: string;
}) => EnginePricing = (overrides?: {
  pricingStatus?: unknown;
  clusters?: unknown;
  integrations?: unknown;
  nodeAssets?: unknown;
  clusterId?: string;
}): EnginePricing => {
  return describeKubecost3Pricing({
    pricingStatus:
      overrides && "pricingStatus" in overrides
        ? overrides.pricingStatus
        : { enabled: false, authorized: false, source: "" },
    clusters:
      overrides && "clusters" in overrides
        ? overrides.clusters
        : [KUBECOST3_CLUSTER],
    integrations:
      overrides && "integrations" in overrides ? overrides.integrations : null,
    nodeAssets:
      overrides && "nodeAssets" in overrides
        ? overrides.nodeAssets
        : KUBECOST3_ASSETS,
    clusterId:
      overrides && "clusterId" in overrides
        ? overrides.clusterId!
        : "cost-metrics-3",
  });
};

test("Kubecost 3 on kind: the finops agent's default rates, read off what its nodes cost", (): void => {
  assert.deepStrictEqual(kubecost3(), {
    source: "default-rates",
    provider: "",
  });
});

test("Kubecost 3 with the finops agent's customPrices: a rate card", (): void => {
  assert.deepStrictEqual(
    kubecost3({
      nodeAssets: [
        {
          node: nodeAsset({
            // 0.02 per core-hour and 0.003 per GiB-hour.
            cpuCost: 0.02 * 4.595556,
            ramCost: (0.003 * 19395354429.44) / (1024 * 1024 * 1024),
          }),
        },
      ],
    }),
    { source: "rate-card", provider: "" },
  );
});

test("Kubecost 3's Enterprise custom pricing is a rate card, on any cloud", (): void => {
  assert.deepStrictEqual(
    kubecost3({
      pricingStatus: { enabled: true, authorized: true, source: "configmap" },
      clusters: [{ ...KUBECOST3_CLUSTER, provider: "AWS" }],
    }),
    { source: "rate-card", provider: "" },
  );
});

test("Kubecost 3 on a cloud: that cloud's list prices", (): void => {
  for (const [provider, named] of [
    ["AWS", "AWS"],
    ["GCP", "GCP"],
    ["Azure", "Azure"],
    ["azure", "Azure"],
  ]) {
    assert.deepStrictEqual(
      kubecost3({ clusters: [{ ...KUBECOST3_CLUSTER, provider }] }),
      { source: "list-prices", provider: named },
    );
  }
});

test("Kubecost 3 that reads its cloud's bill: list prices it reconciles with the bill", (): void => {
  assert.deepStrictEqual(
    kubecost3({
      clusters: [{ ...KUBECOST3_CLUSTER, provider: "AWS" }],
      integrations: [AWS_INTEGRATION],
    }),
    { source: "billing-integration", provider: "AWS" },
  );
  // Kubecost writes Azure's integration in capitals.
  assert.deepStrictEqual(
    kubecost3({
      clusters: [{ ...KUBECOST3_CLUSTER, provider: "Azure" }],
      integrations: [
        { ...AWS_INTEGRATION, provider: "AZURE", connectionStatus: "synced" },
      ],
    }),
    { source: "billing-integration", provider: "Azure" },
  );
});

test("a cloud integration counts only when it is active, connected, and this cloud's", (): void => {
  for (const integration of [
    { ...AWS_INTEGRATION, active: false },
    { ...AWS_INTEGRATION, connectionStatus: "Failed Connection" },
    { ...AWS_INTEGRATION, connectionStatus: "No Connection" },
    { ...AWS_INTEGRATION, connectionStatus: "Data Missing" },
    { ...AWS_INTEGRATION, provider: "GCP" },
  ]) {
    assert.deepStrictEqual(
      kubecost3({
        clusters: [{ ...KUBECOST3_CLUSTER, provider: "AWS" }],
        integrations: [integration],
      }),
      { source: "list-prices", provider: "AWS" },
      JSON.stringify(integration),
    );
  }

  assert.strictEqual(hasBillingIntegration(null, "AWS"), false);
  assert.strictEqual(hasBillingIntegration({ data: [] }, "AWS"), false);
  assert.strictEqual(hasBillingIntegration([AWS_INTEGRATION], ""), false);
  assert.strictEqual(hasBillingIntegration(["AWS", 1, null], "AWS"), false);
});

test("Kubecost 3 that answers for several clusters is read for this one", (): void => {
  const clusters: Array<Record<string, unknown>> = [
    { ...KUBECOST3_CLUSTER, id: "prod-us", provider: "AWS" },
    { ...KUBECOST3_CLUSTER, id: "prod-eu", provider: "GCP" },
  ];

  assert.deepStrictEqual(kubecost3({ clusters, clusterId: "prod-eu" }), {
    source: "list-prices",
    provider: "GCP",
  });
  // Without knowing which is this one: nothing is guessed.
  assert.deepStrictEqual(kubecost3({ clusters, clusterId: "" }), {
    source: "unknown",
    provider: "",
  });
  assert.strictEqual(kubecostClusterStatus(clusters, "staging"), null);
  assert.deepStrictEqual(
    kubecostClusterStatus([KUBECOST3_CLUSTER], ""),
    KUBECOST3_CLUSTER,
  );
});

test("a Kubecost 3 that cannot say yet says nothing rather than guess", (): void => {
  // Nothing collected yet: no node has run long enough to read a rate off.
  assert.deepStrictEqual(kubecost3({ nodeAssets: [null] }), {
    source: "unknown",
    provider: "",
  });
  // The aggregator has no cluster yet.
  assert.deepStrictEqual(kubecost3({ clusters: [] }), {
    source: "unknown",
    provider: "",
  });
  // Nothing answered at all.
  assert.deepStrictEqual(
    kubecost3({
      pricingStatus: null,
      clusters: null,
      integrations: null,
      nodeAssets: null,
    }),
    { source: "unknown", provider: "" },
  );
  // A provider it does not price at list prices is not taken for one.
  assert.deepStrictEqual(
    kubecost3({
      clusters: [{ ...KUBECOST3_CLUSTER, provider: "SomeNewCloud" }],
    }),
    { source: "unknown", provider: "" },
  );
});

test("a CSV price list is a rate card in Kubecost 3 too", (): void => {
  assert.deepStrictEqual(
    kubecost3({ clusters: [{ ...KUBECOST3_CLUSTER, provider: "CSV" }] }),
    { source: "rate-card", provider: "" },
  );
});

test("the rates are read off on-demand nodes of this cluster alone", (): void => {
  const rates: { cpu: number; ram: number } | null = kubecostNodeRates(
    KUBECOST3_ASSETS,
    "cost-metrics-3",
  );
  assert.ok(rates);
  assert.ok(Math.abs(rates.cpu - OPENCOST_DEFAULT_CPU_RATE) < 1e-6);
  assert.ok(Math.abs(rates.ram - OPENCOST_DEFAULT_RAM_RATE) < 1e-6);

  const mixed: unknown = [
    {
      node: nodeAsset(),
      // Spot rates, and another cluster's rate card: neither counts.
      spot: nodeAsset({ preemptible: 1, cpuCost: 0.006655 * 4.595556 }),
      other: nodeAsset({
        properties: { cluster: "prod-us" },
        cpuCost: 99,
        ramCost: 99,
      }),
    },
  ];
  assert.deepStrictEqual(kubecost3({ nodeAssets: mixed }), {
    source: "default-rates",
    provider: "",
  });

  // Only spot nodes: nothing to compare.
  assert.strictEqual(
    kubecostNodeRates(
      [{ spot: nodeAsset({ preemptible: 1 }) }],
      "cost-metrics-3",
    ),
    null,
  );
});

const KUBECOST3_ROUTES: Record<string, { status: number; body: unknown }> = {
  "/model/allocation": ALLOCATIONS,
  // Kubecost 3's aggregator has neither API.
  "/model/clusterInfo": { status: 404, body: "404 page not found\n" },
  "/model/allNodePricing": { status: 404, body: "404 page not found\n" },
  "/model/pricing/status": {
    status: 200,
    body: {
      code: 200,
      data: { enabled: false, authorized: false, source: "" },
    },
  },
  "/model/clusters/status": {
    status: 200,
    body: { code: 200, data: [KUBECOST3_CLUSTER] },
  },
  // Off in its chart's values: 404, as the aggregator answers it.
  "/model/cloudCost/status": { status: 404, body: "404 page not found\n" },
  "/model/assets": { status: 200, body: { code: 200, data: KUBECOST3_ASSETS } },
};

test("asks a Kubecost 3's aggregator, as its own UI does", async (): Promise<void> => {
  routes = { ...KUBECOST3_ROUTES };

  const client: CostEngineClient = new CostEngineClient({ baseUrl });
  await client.fetchAllocations(WINDOW);

  assert.deepStrictEqual(
    await readEnginePricing({ client, clusterId: "cost-metrics-3" }),
    { source: "default-rates", provider: "" },
  );
  assert.ok(requestedUrls.includes("/model/pricing/status"));
  assert.ok(requestedUrls.includes("/model/clusters/status?window=2d"));
  assert.ok(requestedUrls.includes("/model/cloudCost/status"));
  assert.ok(
    requestedUrls.includes(
      '/model/assets?window=2d&accumulate=true&filter=assetType:"node"',
    ),
  );
});

test("a Kubecost 3 on AWS that reads its bill, end to end", async (): Promise<void> => {
  routes = {
    ...KUBECOST3_ROUTES,
    "/model/clusters/status": {
      status: 200,
      body: { code: 200, data: [{ ...KUBECOST3_CLUSTER, provider: "AWS" }] },
    },
    "/model/cloudCost/status": {
      status: 200,
      body: { code: 200, data: [AWS_INTEGRATION] },
    },
  };

  const client: CostEngineClient = new CostEngineClient({ baseUrl });
  await client.fetchAllocations(WINDOW);

  assert.deepStrictEqual(await readEnginePricing({ client }), {
    source: "billing-integration",
    provider: "AWS",
  });
});

test("a Kubecost 2 that reads its cloud's bill says so too", async (): Promise<void> => {
  routes = {
    "/model/allocation": ALLOCATIONS,
    "/model/clusterInfo": {
      status: 200,
      body: { code: 200, data: { provider: "GCP" } },
    },
    "/model/cloudCost/status": {
      status: 200,
      body: {
        code: 200,
        data: [
          { ...AWS_INTEGRATION, provider: "GCP", connectionStatus: "synced" },
        ],
      },
    },
  };

  const client: CostEngineClient = new CostEngineClient({ baseUrl });
  await client.fetchAllocations(WINDOW);

  assert.deepStrictEqual(await readEnginePricing({ client }), {
    source: "billing-integration",
    provider: "GCP",
  });
  // Kubecost 2 answers /clusterInfo: none of Kubecost 3's reads.
  assert.ok(!requested.includes("/model/clusters/status"));
  assert.ok(!requested.includes("/model/assets"));
});

test("a Kubecost 2 with no cloud integration (its answer on kind) keeps its list prices", async (): Promise<void> => {
  routes = {
    "/model/allocation": ALLOCATIONS,
    "/model/clusterInfo": {
      status: 200,
      body: { code: 200, data: { provider: "AWS" } },
    },
    "/model/cloudCost/status": { status: 200, body: { code: 200, data: [] } },
  };

  const client: CostEngineClient = new CostEngineClient({ baseUrl });
  await client.fetchAllocations(WINDOW);

  assert.deepStrictEqual(await readEnginePricing({ client }), {
    source: "list-prices",
    provider: "AWS",
  });
});

test("OpenCost is never asked about a cloud integration, nor Kubecost on no cloud", async (): Promise<void> => {
  routes = {
    "/allocation/compute": ALLOCATIONS,
    "/clusterInfo": {
      status: 200,
      body: { code: 200, data: { provider: "AWS" } },
    },
  };

  const opencost: CostEngineClient = new CostEngineClient({ baseUrl });
  await opencost.fetchAllocations(WINDOW);
  await readEnginePricing({ client: opencost });

  assert.ok(
    !requested.some((path: string): boolean => {
      return path.includes("cloudCost");
    }),
  );

  requested = [];
  routes = {
    "/model/allocation": ALLOCATIONS,
    "/model/clusterInfo": {
      status: 200,
      body: { code: 200, data: { provider: "custom" } },
    },
    "/model/allNodePricing": {
      status: 200,
      body: { code: 200, data: DEFAULT_RATES },
    },
  };

  const kubecost: CostEngineClient = new CostEngineClient({ baseUrl });
  await kubecost.fetchAllocations(WINDOW);

  assert.deepStrictEqual(await readEnginePricing({ client: kubecost }), {
    source: "default-rates",
    provider: "",
  });
  assert.ok(!requested.includes("/model/cloudCost/status"));
});

test("an OpenCost that does not answer /clusterInfo is never asked Kubecost 3's questions", async (): Promise<void> => {
  routes = { "/allocation/compute": ALLOCATIONS };

  const client: CostEngineClient = new CostEngineClient({ baseUrl });
  await client.fetchAllocations(WINDOW);

  assert.deepStrictEqual(await readEnginePricing({ client }), {
    source: "unknown",
    provider: "",
  });
  // Past the Allocation API's paths, probed first: /clusterInfo, and no more.
  assert.deepStrictEqual(
    requested.filter((path: string): boolean => {
      return !path.includes("allocation");
    }),
    ["/clusterInfo"],
  );
});
