import "./TestEnv";
import * as assert from "assert";
import { test } from "node:test";
import { CostEngineClient } from "../CostEngineClient";
import {
  CostEngineMode,
  CostEngineResolver,
  clusterOfAllocations,
  latestAllocationEnd,
} from "../CostEngineResolver";
import { KubernetesService, ServiceQuery } from "../KubernetesApi";
import { EngineAllocation, KubernetesCostEngineInfo } from "../Types";

/*
 * #9633: which engine the agent reads. The Kubernetes API and the engines
 * are stand-ins, so every mode's choices are checked without a cluster:
 *
 *   configured - cost.engine.url: that engine, nothing looked for;
 *   bundled    - the chart's OpenCost, unless the cluster runs its own;
 *   auto       - the cluster's own, nothing bundled.
 */

const BUNDLED_URL: string =
  "http://oneuptime-agent-kubernetes-agent-opencost.oneuptime.svc.cluster.local:9003";
const KUBECOST_URL: string = "http://kubecost-cost-analyzer.kubecost.svc:9090";
const OPENCOST_URL: string = "http://opencost.opencost.svc:9003";

const KUBECOST: KubernetesService = {
  metadata: {
    name: "kubecost-cost-analyzer",
    namespace: "kubecost",
    labels: { app: "cost-analyzer" },
  },
  spec: { ports: [{ name: "tcp-frontend", port: 9090 }] },
};

const OPENCOST: KubernetesService = {
  metadata: {
    name: "opencost",
    namespace: "opencost",
    labels: { "app.kubernetes.io/name": "opencost" },
  },
  spec: { ports: [{ name: "http", port: 9003 }] },
};

const HOUR_MS: number = 60 * 60 * 1000;

interface FakeEngine {
  // Answers per fetch: allocations, or an error to throw.
  answer: Array<EngineAllocation> | Error;
  kind: "Kubecost" | "OpenCost";
  clusterInfo: unknown;
  nodePricing?: unknown;
  // Its other APIs' answers, by name (Kubecost 3's aggregator's).
  api?: Record<string, unknown>;
  // What it was asked besides allocations, with the query.
  asked?: Array<{ name: string; params: Record<string, string> }>;
  fetches: number;
}

class World {
  public services: Array<KubernetesService> = [];
  public listError: Error | null = null;
  public lists: number = 0;
  public queries: Array<ServiceQuery> = [];
  public engines: Map<string, FakeEngine> = new Map<string, FakeEngine>();
  public nowMs: number = Date.parse("2026-11-18T12:30:00Z");
  public clientsCreated: Array<string> = [];

  public engine(url: string, engine: Partial<FakeEngine>): FakeEngine {
    const full: FakeEngine = {
      answer: [{ name: "a", properties: { cluster: "prod-eu" }, totalCost: 1 }],
      kind: "OpenCost",
      clusterInfo: { provider: "AWS" },
      fetches: 0,
      ...engine,
    };
    this.engines.set(url, full);
    return full;
  }

  public resolver(
    mode: CostEngineMode,
    overrides?: { rateCardHint?: string; engineUrl?: string },
  ): CostEngineResolver {
    return new CostEngineResolver({
      mode: mode,
      engineUrl: overrides?.engineUrl ?? (mode === "auto" ? "" : BUNDLED_URL),
      rateCardHint: overrides?.rateCardHint || "",
      listServices: async (
        query: ServiceQuery,
      ): Promise<Array<KubernetesService>> => {
        this.lists++;
        this.queries.push(query);
        if (this.listError) {
          throw this.listError;
        }
        /*
         * The label reads see labelled Services; a field read, the Services
         * of that name (and namespace, when it names one).
         */
        const fields: Map<string, string> = new Map<string, string>(
          (query.fieldSelector || "")
            .split(",")
            .filter(Boolean)
            .map((field: string): [string, string] => {
              const [key, value] = field.split("=");
              return [key || "", value || ""];
            }),
        );
        return this.services.filter((service: KubernetesService): boolean => {
          if (!query.fieldSelector) {
            return Boolean(service.metadata?.labels);
          }
          return (
            service.metadata?.name === fields.get("metadata.name") &&
            (!fields.has("metadata.namespace") ||
              service.metadata?.namespace === fields.get("metadata.namespace"))
          );
        });
      },
      rediscoveryMs: HOUR_MS,
      failuresBeforeRediscovery: 3,
      windowSeconds: 3600,
      now: (): number => {
        return this.nowMs;
      },
      createClient: (url: string): CostEngineClient => {
        this.clientsCreated.push(url);
        return this.client(url);
      },
    });
  }

  private client(url: string): CostEngineClient {
    const engines: Map<string, FakeEngine> = this.engines;
    let detected: boolean = false;

    return {
      baseUrl: url,
      engineKind(): "Kubecost" | "OpenCost" | null {
        return detected ? engines.get(url)?.kind || null : null;
      },
      async fetchAllocations(): Promise<Array<EngineAllocation>> {
        const engine: FakeEngine | undefined = engines.get(url);
        if (!engine) {
          throw new Error(`connect ECONNREFUSED ${url}`);
        }
        engine.fetches++;
        if (engine.answer instanceof Error) {
          throw engine.answer;
        }
        detected = true;
        return engine.answer;
      },
      async fetchApiData(
        name: string,
        params?: Record<string, string>,
      ): Promise<unknown> {
        const engine: FakeEngine | undefined = engines.get(url);
        if (!engine) {
          return null;
        }
        engine.asked = [
          ...(engine.asked || []),
          { name, params: params || {} },
        ];
        if (engine.api && name in engine.api) {
          return engine.api[name];
        }
        return name === "clusterInfo" ? engine.clusterInfo : engine.nodePricing;
      },
    } as unknown as CostEngineClient;
  }
}

const WINDOW: { windowStart: Date; windowEnd: Date } = {
  windowStart: new Date("2026-11-18T10:00:00Z"),
  windowEnd: new Date("2026-11-18T11:00:00Z"),
};

// --- configured ------------------------------------------------------------

test("an engine of your own is read as set, and nothing is looked for", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST];
  world.engine(BUNDLED_URL, { kind: "OpenCost" });

  const resolver: CostEngineResolver = world.resolver("configured");
  await resolver.fetchAllocations(WINDOW);
  await resolver.fetchAllocations(WINDOW);

  // Only the Service the URL names, once, to say which engine it is.
  assert.deepStrictEqual(world.queries, [
    {
      fieldSelector:
        "metadata.name=oneuptime-agent-kubernetes-agent-opencost,metadata.namespace=oneuptime",
    },
  ]);
  assert.deepStrictEqual(resolver.describe(), {
    engine: "OpenCost",
    service: "",
    bundledEngineUnused: false,
    pricingSource: "list-prices",
    pricingProvider: "AWS",
  });
});

test("an engine of your own that fails is never swapped for another", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST];
  world.engine(KUBECOST_URL, {});
  world.engine(BUNDLED_URL, { answer: new Error("HTTP 500") });

  const resolver: CostEngineResolver = world.resolver("configured");

  for (let i: number = 0; i < 5; i++) {
    await assert.rejects(resolver.fetchAllocations(WINDOW), /HTTP 500/);
  }

  // No discovery: at most the one read of the Service the URL names.
  assert.ok(
    world.queries.every((query: ServiceQuery): boolean => {
      return !query.labelSelector;
    }),
  );
  assert.strictEqual(world.lists, 1);
});

/*
 * #9776: the path the Allocation API answers on says whether the URL serves
 * the API under /model, not which engine it is. Kubecost's cost model
 * answers /allocation/compute like OpenCost, and OpenCost's UI passes
 * /model/allocation to its API like a Kubecost frontend (both seen on kind,
 * from the engines' own charts). The Service the URL names says.
 */
test("Kubecost named by its cost model is still called Kubecost", async (): Promise<void> => {
  const world: World = new World();
  world.services = [
    {
      ...KUBECOST,
      spec: {
        ports: [
          { name: "tcp-model", port: 9003 },
          { name: "tcp-frontend", port: 9090 },
        ],
      },
    },
  ];
  const url: string = "http://kubecost-cost-analyzer.kubecost.svc:9003";
  // The path read alone says OpenCost: /allocation/compute.
  world.engine(url, { kind: "OpenCost" });

  const resolver: CostEngineResolver = world.resolver("configured", {
    engineUrl: url,
  });
  await resolver.fetchAllocations(WINDOW);

  assert.strictEqual(resolver.describe()?.engine, "Kubecost");
  // Named, not found: the pages draw no "your own engine" line for it.
  assert.strictEqual(resolver.describe()?.service, "");
});

test("OpenCost named by its UI is still called OpenCost", async (): Promise<void> => {
  const world: World = new World();
  world.services = [
    {
      ...OPENCOST,
      spec: {
        ports: [
          { name: "http", port: 9003 },
          { name: "http-ui", port: 9090 },
        ],
      },
    },
  ];
  const url: string = "http://opencost.opencost.svc.cluster.local:9090";
  // The path read alone says Kubecost: /model/allocation.
  world.engine(url, { kind: "Kubecost" });

  const resolver: CostEngineResolver = world.resolver("configured", {
    engineUrl: url,
  });
  await resolver.fetchAllocations(WINDOW);

  assert.strictEqual(resolver.describe()?.engine, "OpenCost");
});

test("an engine named by an address that is no Service is named by its API's path, with nothing read", async (): Promise<void> => {
  const world: World = new World();
  const url: string = "https://kubecost.example.com";
  world.engine(url, { kind: "Kubecost" });

  const resolver: CostEngineResolver = world.resolver("configured", {
    engineUrl: url,
  });
  await resolver.fetchAllocations(WINDOW);

  assert.strictEqual(world.lists, 0);
  assert.strictEqual(resolver.describe()?.engine, "Kubecost");
});

test("a Service read that fails leaves the path to say, and is tried again", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST];
  world.listError = new Error("Kubernetes API answered HTTP 403");
  const url: string = "http://kubecost-cost-analyzer.kubecost.svc:9003";
  world.engine(url, { kind: "OpenCost" });

  const resolver: CostEngineResolver = world.resolver("configured", {
    engineUrl: url,
  });
  await resolver.fetchAllocations(WINDOW);

  assert.strictEqual(resolver.describe()?.engine, "OpenCost");

  world.listError = null;
  await resolver.fetchAllocations(WINDOW);

  assert.strictEqual(resolver.describe()?.engine, "Kubecost");
  assert.strictEqual(world.lists, 2);

  // Read once it answered: never again.
  await resolver.fetchAllocations(WINDOW);
  assert.strictEqual(world.lists, 2);
});

// --- bundled ---------------------------------------------------------------

test("with no engine of the cluster's own, the bundled OpenCost is read", async (): Promise<void> => {
  const world: World = new World();
  world.engine(BUNDLED_URL, {
    kind: "OpenCost",
    clusterInfo: { provider: "custom" },
    nodePricing: { default: { CPU: "0.031611", RAM: "0.004237" } },
  });

  const resolver: CostEngineResolver = world.resolver("bundled");
  await resolver.fetchAllocations(WINDOW);

  assert.ok(world.lists > 0);
  assert.deepStrictEqual(resolver.describe(), {
    engine: "OpenCost",
    service: "",
    bundledEngineUnused: false,
    pricingSource: "default-rates",
    pricingProvider: "",
  });
});

test("the cluster's own Kubecost is read instead of the bundled OpenCost, which the pages then call unneeded", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST, OPENCOST];
  const kubecost: FakeEngine = world.engine(KUBECOST_URL, {
    kind: "Kubecost",
    clusterInfo: { provider: "GCP" },
  });
  const bundled: FakeEngine = world.engine(BUNDLED_URL, {});

  const resolver: CostEngineResolver = world.resolver("bundled");
  await resolver.fetchAllocations(WINDOW);

  // Verified once, read once.
  assert.strictEqual(kubecost.fetches, 2);
  assert.strictEqual(bundled.fetches, 0);
  assert.deepStrictEqual(resolver.describe(), {
    engine: "Kubecost",
    service: "kubecost/kubecost-cost-analyzer",
    bundledEngineUnused: true,
    pricingSource: "list-prices",
    pricingProvider: "GCP",
  });
});

test("an engine that will not answer is passed over for the next, then for the bundled one", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST, OPENCOST];
  world.engine(KUBECOST_URL, { answer: new Error("HTTP 401 sign in") });
  world.engine(OPENCOST_URL, { answer: new Error("ECONNREFUSED") });
  world.engine(BUNDLED_URL, {});

  const resolver: CostEngineResolver = world.resolver("bundled");
  await resolver.fetchAllocations(WINDOW);

  const info: KubernetesCostEngineInfo | undefined = resolver.describe();
  assert.strictEqual(info?.service, "");
  assert.strictEqual(info?.bundledEngineUnused, false);
});

test("a Kubecost that answers for several clusters is never read automatically", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST];
  world.engine(KUBECOST_URL, {
    kind: "Kubecost",
    answer: [
      { name: "a", properties: { cluster: "prod-eu" } },
      { name: "b", properties: { cluster: "prod-us" } },
    ],
  });
  const bundled: FakeEngine = world.engine(BUNDLED_URL, {});

  const resolver: CostEngineResolver = world.resolver("bundled");
  await resolver.fetchAllocations(WINDOW);

  assert.strictEqual(bundled.fetches, 1);
  assert.strictEqual(resolver.describe()?.service, "");
});

/*
 * Asked per container, a Kubecost writes "__idle__" as its idle row's
 * cluster, as Kubecost 2.8.7 did on kind: that is one cluster, not two, or
 * every Kubecost would be passed over as a primary that federates others.
 */
test("a Kubecost's idle row is no second cluster", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST];
  world.engine(KUBECOST_URL, {
    kind: "Kubecost",
    answer: [
      {
        name: "cost-metrics/cost-9852-control-plane/kubecost/deployment/kubecost-cost-analyzer/kubecost-cost-analyzer-86d48d7474-7ljpl/cost-model",
        properties: {
          cluster: "cost-metrics",
          node: "cost-9852-control-plane",
          namespace: "kubecost",
          pod: "kubecost-cost-analyzer-86d48d7474-7ljpl",
          container: "cost-model",
        },
        totalCost: 0.01,
      },
      {
        name: "__idle__/__idle__/__idle__/__idle__/__idle__/__idle__/__idle__",
        properties: {
          cluster: "__idle__",
          node: "__idle__",
          namespace: "__idle__",
          pod: "__idle__",
          container: "__idle__",
        },
        totalCost: 0.12238,
      },
      {
        name: "__unmounted__",
        properties: { cluster: "__unmounted__", namespace: "__unmounted__" },
      },
    ],
  });
  const bundled: FakeEngine = world.engine(BUNDLED_URL, {});

  const resolver: CostEngineResolver = world.resolver("bundled");
  await resolver.fetchAllocations(WINDOW);

  assert.strictEqual(bundled.fetches, 0);
  assert.strictEqual(
    resolver.describe()?.service,
    "kubecost/kubecost-cost-analyzer",
  );
  assert.strictEqual(
    clusterOfAllocations([
      { properties: { cluster: "cost-metrics" } },
      { properties: { cluster: "__idle__" } },
    ]),
    "cost-metrics",
  );
});

test("an engine installed later is found at the next hourly look, not before", async (): Promise<void> => {
  const world: World = new World();
  world.engine(BUNDLED_URL, {});
  const resolver: CostEngineResolver = world.resolver("bundled");

  await resolver.fetchAllocations(WINDOW);
  const listsAfterStart: number = world.lists;

  world.services = [OPENCOST];
  world.engine(OPENCOST_URL, { clusterInfo: { provider: "Azure" } });

  world.nowMs += 10 * 60 * 1000;
  await resolver.fetchAllocations(WINDOW);
  assert.strictEqual(world.lists, listsAfterStart);
  assert.strictEqual(resolver.describe()?.service, "");

  world.nowMs += HOUR_MS;
  await resolver.fetchAllocations(WINDOW);
  assert.strictEqual(resolver.describe()?.service, "opencost/opencost");
  assert.strictEqual(resolver.describe()?.pricingProvider, "Azure");
});

test("a found engine that keeps failing is dropped for the bundled one", async (): Promise<void> => {
  const world: World = new World();
  world.services = [OPENCOST];
  const opencost: FakeEngine = world.engine(OPENCOST_URL, {});
  world.engine(BUNDLED_URL, {});

  const resolver: CostEngineResolver = world.resolver("bundled");
  await resolver.fetchAllocations(WINDOW);
  assert.strictEqual(resolver.describe()?.service, "opencost/opencost");

  // It is uninstalled: three failing ticks, then the next tick looks again.
  world.services = [];
  opencost.answer = new Error("ECONNREFUSED");

  for (let i: number = 0; i < 3; i++) {
    await assert.rejects(resolver.fetchAllocations(WINDOW), /ECONNREFUSED/);
  }

  await resolver.fetchAllocations(WINDOW);
  assert.strictEqual(resolver.describe()?.service, "");
  assert.strictEqual(resolver.describe()?.bundledEngineUnused, false);
});

test("a Kubernetes API that will not answer leaves the bundled engine in use", async (): Promise<void> => {
  const world: World = new World();
  world.listError = new Error("Kubernetes API answered HTTP 403");
  const bundled: FakeEngine = world.engine(BUNDLED_URL, {});

  const resolver: CostEngineResolver = world.resolver("bundled");
  await resolver.fetchAllocations(WINDOW);

  assert.strictEqual(bundled.fetches, 1);
});

test("the chart's rate card counts only for its bundled engine", async (): Promise<void> => {
  const world: World = new World();
  world.engine(BUNDLED_URL, { clusterInfo: null });

  const bundled: CostEngineResolver = world.resolver("bundled", {
    rateCardHint: "true",
  });
  await bundled.fetchAllocations(WINDOW);
  assert.strictEqual(bundled.describe()?.pricingSource, "rate-card");

  const other: World = new World();
  other.services = [OPENCOST];
  other.engine(OPENCOST_URL, { clusterInfo: null });
  other.engine(BUNDLED_URL, {});

  const found: CostEngineResolver = other.resolver("bundled", {
    rateCardHint: "true",
  });
  await found.fetchAllocations(WINDOW);
  assert.strictEqual(found.describe()?.pricingSource, "unknown");
});

test("prices the engine could not say are asked about again at the next window, known ones hourly", async (): Promise<void> => {
  const world: World = new World();
  world.services = [OPENCOST];
  // A Kubecost 3 that has not collected the cluster yet says nothing.
  const engine: FakeEngine = world.engine(OPENCOST_URL, { clusterInfo: null });

  const resolver: CostEngineResolver = world.resolver("auto");
  await resolver.fetchAllocations(WINDOW);
  assert.strictEqual(resolver.describe()?.pricingSource, "unknown");

  // Minutes later it can say: the next window reads it.
  engine.clusterInfo = { provider: "Azure" };
  world.nowMs += 5 * 60 * 1000;
  await resolver.fetchAllocations(WINDOW);
  assert.strictEqual(resolver.describe()?.pricingSource, "list-prices");
  assert.strictEqual(resolver.describe()?.pricingProvider, "Azure");

  // Known: not asked again within the hour.
  const asked: number = (engine.asked || []).length;
  world.nowMs += 5 * 60 * 1000;
  await resolver.fetchAllocations(WINDOW);
  assert.strictEqual((engine.asked || []).length, asked);
});

// --- auto ------------------------------------------------------------------

test("auto reads the cluster's own engine", async (): Promise<void> => {
  const world: World = new World();
  world.services = [OPENCOST];
  world.engine(OPENCOST_URL, {});

  const resolver: CostEngineResolver = world.resolver("auto");
  await resolver.fetchAllocations(WINDOW);

  assert.deepStrictEqual(resolver.describe(), {
    engine: "OpenCost",
    service: "opencost/opencost",
    bundledEngineUnused: false,
    pricingSource: "list-prices",
    pricingProvider: "AWS",
  });
});

test("auto with no engine says how to get one, and looks again every tick", async (): Promise<void> => {
  const world: World = new World();
  const resolver: CostEngineResolver = world.resolver("auto");

  await assert.rejects(
    resolver.fetchAllocations(WINDOW),
    /No OpenCost or Kubecost answers in this cluster.*leave cost\.engine\.url empty to bundle OpenCost/,
  );
  assert.strictEqual(resolver.describe(), undefined);

  const lists: number = world.lists;
  world.services = [OPENCOST];
  world.engine(OPENCOST_URL, {});

  await resolver.fetchAllocations(WINDOW);
  assert.ok(world.lists > lists);
  assert.strictEqual(resolver.describe()?.service, "opencost/opencost");
});

test("auto names why each engine it found was passed over", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST];
  world.engine(KUBECOST_URL, { answer: new Error("HTTP 401") });

  await assert.rejects(
    world.resolver("auto").fetchAllocations(WINDOW),
    /kubecost\/kubecost-cost-analyzer did not answer: HTTP 401/,
  );
});

test("auto never looks at the URL the chart would have bundled", async (): Promise<void> => {
  const world: World = new World();
  world.services = [OPENCOST];
  world.engine(OPENCOST_URL, {});

  await world.resolver("auto").fetchAllocations(WINDOW);

  assert.ok(!world.clientsCreated.includes(""));
  assert.ok(!world.clientsCreated.includes(BUNDLED_URL));
});

test("the same engine found again keeps its client, so its detected API path stays", async (): Promise<void> => {
  const world: World = new World();
  world.services = [OPENCOST];
  world.engine(OPENCOST_URL, {});

  const resolver: CostEngineResolver = world.resolver("auto");
  await resolver.fetchAllocations(WINDOW);
  const clients: number = world.clientsCreated.length;

  world.nowMs += 2 * HOUR_MS;
  await resolver.fetchAllocations(WINDOW);

  // One more client to verify it again, but the one in use is the same.
  assert.strictEqual(world.clientsCreated.length, clients + 1);
  assert.strictEqual(resolver.describe()?.service, "opencost/opencost");
});

// --- whose price metrics the collector scrapes (#9776) ---------------------

test("the price metrics are those of the engine cost.engine.url names, from the start", (): void => {
  const world: World = new World();

  assert.deepStrictEqual(
    world
      .resolver("configured", {
        engineUrl: "http://kubecost-frontend.kubecost.svc.cluster.local:9090",
      })
      .metricsEngine(),
    {
      url: "http://kubecost-frontend.kubecost.svc.cluster.local:9090",
      namespace: "kubecost",
    },
  );
  // Not a Service: no namespace to find a finops agent in.
  assert.deepStrictEqual(
    world
      .resolver("configured", { engineUrl: "https://kubecost.example.com/" })
      .metricsEngine(),
    { url: "https://kubecost.example.com", namespace: null },
  );
  assert.strictEqual(world.lists, 0);
});

test("the price metrics follow the engine the allocations are read from", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST];
  world.engine(KUBECOST_URL, { kind: "Kubecost" });
  world.engine(BUNDLED_URL, {});

  const resolver: CostEngineResolver = world.resolver("bundled");

  /*
   * #9852: before the first look, none - not the bundled engine, whose
   * prices are not the cluster's when it runs its own engine.
   */
  assert.strictEqual(resolver.metricsEngine(), null);

  await resolver.fetchAllocations(WINDOW);

  assert.deepStrictEqual(resolver.metricsEngine(), {
    url: KUBECOST_URL,
    namespace: "kubecost",
  });
});

test("the bundled engine's price metrics are scraped once the agent knows it reads it, and again after a fallback", async (): Promise<void> => {
  const world: World = new World();
  world.services = [OPENCOST];
  const opencost: FakeEngine = world.engine(OPENCOST_URL, {});
  world.engine(BUNDLED_URL, {});

  const nothing: World = new World();
  nothing.engine(BUNDLED_URL, {});
  const alone: CostEngineResolver = nothing.resolver("bundled");
  await alone.fetchAllocations(WINDOW);

  // No engine of the cluster's own: the bundled one's.
  assert.deepStrictEqual(alone.metricsEngine(), {
    url: BUNDLED_URL,
    namespace: "oneuptime",
  });

  const resolver: CostEngineResolver = world.resolver("bundled");
  await resolver.fetchAllocations(WINDOW);
  assert.strictEqual(resolver.metricsEngine()?.url, OPENCOST_URL);

  // The cluster's own engine goes: back to the bundled one's prices.
  world.services = [];
  opencost.answer = new Error("ECONNREFUSED");
  for (let i: number = 0; i < 3; i++) {
    await assert.rejects(resolver.fetchAllocations(WINDOW));
  }
  await resolver.fetchAllocations(WINDOW);

  assert.strictEqual(resolver.metricsEngine()?.url, BUNDLED_URL);
});

test("auto has no price metrics to scrape until it has an engine, nor after losing it", async (): Promise<void> => {
  const world: World = new World();
  const resolver: CostEngineResolver = world.resolver("auto");

  assert.strictEqual(resolver.metricsEngine(), null);

  world.services = [OPENCOST];
  const engine: FakeEngine = world.engine(OPENCOST_URL, {});
  await resolver.fetchAllocations(WINDOW);

  assert.deepStrictEqual(resolver.metricsEngine(), {
    url: OPENCOST_URL,
    namespace: "opencost",
  });

  // It keeps failing, and is dropped.
  engine.answer = new Error("ECONNREFUSED");
  for (let i: number = 0; i < 3; i++) {
    await assert.rejects(resolver.fetchAllocations(WINDOW));
  }

  assert.strictEqual(resolver.metricsEngine(), null);
});

// --- whether a window's rows hold all of it yet --------------------------------

/*
 * A Kubecost answers from what its aggregator has collected, in batches
 * behind the clock: on kind, at 17:02, Kubecost 2.8.7 had 16:00-16:20 of the
 * hour that had just closed, and Kubecost 3.3.2 16:00-16:15. Each row's own
 * end says how far the data reached, so an hour is shipped once its rows
 * reach its end. OpenCost, which works an hour out when asked, ends its rows
 * at the hour's end at once.
 */
const COLLECTED: {
  windowStart: Date;
  windowEnd: Date;
} = {
  windowStart: new Date("2026-11-18T11:00:00Z"),
  windowEnd: new Date("2026-11-18T12:00:00Z"),
};

// A window's rows, the latest ending at `end`.
const rowsEndingAt: (end: string) => Array<EngineAllocation> = (
  end: string,
): Array<EngineAllocation> => {
  return [
    {
      name: "prod-eu/kind/kube-system/deployment/coredns/coredns-1/coredns",
      properties: { cluster: "prod-eu", namespace: "kube-system" },
      start: "2026-11-18T11:00:00Z",
      end: end,
      window: { start: "2026-11-18T11:00:00Z", end: "2026-11-18T12:00:00Z" },
      totalCost: 0.1,
    },
    {
      // A pod that ended mid-window: its own end is earlier, and does not count.
      name: "prod-eu/kind/batch/job/report/report-1/report",
      properties: { cluster: "prod-eu", namespace: "batch" },
      start: "2026-11-18T11:00:00Z",
      end: "2026-11-18T11:05:00Z",
      window: { start: "2026-11-18T11:00:00Z", end: "2026-11-18T12:00:00Z" },
      totalCost: 0.01,
    },
  ];
};

test("a Kubecost's hour waits until its rows reach the hour's end", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST];
  world.engine(KUBECOST_URL, { kind: "Kubecost" });
  const resolver: CostEngineResolver = world.resolver("auto");
  await resolver.fetchAllocations(WINDOW);

  // 12:30: the rows reach 11:20, as Kubecost 2.8.7's did two minutes in.
  assert.strictEqual(
    await resolver.isWindowComplete({
      ...COLLECTED,
      allocations: rowsEndingAt("2026-11-18T11:20:00Z"),
    }),
    false,
  );
  // The asked-for window is no measure: only each row's own end.
  assert.strictEqual(
    latestAllocationEnd(rowsEndingAt("2026-11-18T11:20:00Z")),
    Date.parse("2026-11-18T11:20:00Z"),
  );

  assert.strictEqual(
    await resolver.isWindowComplete({
      ...COLLECTED,
      allocations: rowsEndingAt("2026-11-18T12:00:00Z"),
    }),
    true,
  );
  // A minute short is the engine's rounding, not a missing quarter hour.
  assert.strictEqual(
    await resolver.isWindowComplete({
      ...COLLECTED,
      allocations: rowsEndingAt("2026-11-18T11:59:30Z"),
    }),
    true,
  );
});

test("OpenCost's rows reach the hour's end when it closes: shipped at once, nothing asked", async (): Promise<void> => {
  const world: World = new World();
  world.services = [OPENCOST];
  const opencost: FakeEngine = world.engine(OPENCOST_URL, { kind: "OpenCost" });
  const resolver: CostEngineResolver = world.resolver("auto");
  await resolver.fetchAllocations(WINDOW);
  const asked: number = (opencost.asked || []).length;

  assert.strictEqual(
    await resolver.isWindowComplete({
      ...COLLECTED,
      allocations: rowsEndingAt("2026-11-18T12:00:00Z"),
    }),
    true,
  );
  // An empty window of an engine that works it out when asked is empty.
  assert.strictEqual(
    await resolver.isWindowComplete({ ...COLLECTED, allocations: [] }),
    true,
  );
  assert.strictEqual((opencost.asked || []).length, asked);
});

test("a Kubecost's empty hour waits while it says it has not collected it", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST];
  const kubecost: FakeEngine = world.engine(KUBECOST_URL, {
    kind: "Kubecost",
    api: {
      "clusters/status": [
        { id: "prod-eu", lastCollectedTime: "2026-11-18T10:50:00Z" },
      ],
    },
  });
  const resolver: CostEngineResolver = world.resolver("auto");
  await resolver.fetchAllocations(WINDOW);

  assert.strictEqual(
    await resolver.isWindowComplete({ ...COLLECTED, allocations: [] }),
    false,
  );
  assert.deepStrictEqual(kubecost.asked?.pop(), {
    name: "clusters/status",
    params: { window: "2d" },
  });

  // Collected past it, and still empty: the hour had nothing.
  kubecost.api = {
    "clusters/status": [
      { id: "prod-eu", lastCollectedTime: "2026-11-18T12:05:00Z" },
    ],
  };
  assert.strictEqual(
    await resolver.isWindowComplete({ ...COLLECTED, allocations: [] }),
    true,
  );
});

test("a Kubecost that answers for several clusters is asked about the one its rows name", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST];
  world.engine(KUBECOST_URL, {
    kind: "Kubecost",
    answer: [{ name: "a", properties: { cluster: "prod-eu" }, totalCost: 1 }],
    api: {
      "clusters/status": [
        { id: "prod-us", lastCollectedTime: "2026-11-18T12:10:00Z" },
        { id: "prod-eu", lastCollectedTime: "2026-11-18T11:40:00Z" },
      ],
    },
  });

  const resolver: CostEngineResolver = world.resolver("auto");
  await resolver.fetchAllocations(WINDOW);

  assert.strictEqual(
    await resolver.isWindowComplete({ ...COLLECTED, allocations: [] }),
    false,
  );
});

test("a Kubecost that cannot say how far it has collected an empty hour leaves it empty", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST];
  world.engine(KUBECOST_URL, {
    kind: "Kubecost",
    api: { "clusters/status": null },
  });
  const resolver: CostEngineResolver = world.resolver("auto");
  await resolver.fetchAllocations(WINDOW);

  assert.strictEqual(
    await resolver.isWindowComplete({ ...COLLECTED, allocations: [] }),
    true,
  );
  // Rows that say no end are taken as they are too.
  assert.strictEqual(
    await resolver.isWindowComplete({
      ...COLLECTED,
      allocations: [{ name: "a", properties: { namespace: "prod" } }],
    }),
    true,
  );
});

test("three hours after it closed, an hour is shipped however much of it there is", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST];
  const kubecost: FakeEngine = world.engine(KUBECOST_URL, {
    kind: "Kubecost",
    api: {
      "clusters/status": [
        { id: "prod-eu", lastCollectedTime: "2026-11-18T09:00:00Z" },
      ],
    },
  });
  const resolver: CostEngineResolver = world.resolver("auto");
  await resolver.fetchAllocations(WINDOW);
  const asked: number = (kubecost.asked || []).length;

  world.nowMs = Date.parse("2026-11-18T15:00:00Z");

  assert.strictEqual(
    await resolver.isWindowComplete({
      ...COLLECTED,
      allocations: rowsEndingAt("2026-11-18T11:20:00Z"),
    }),
    true,
  );
  assert.strictEqual(
    await resolver.isWindowComplete({ ...COLLECTED, allocations: [] }),
    true,
  );
  assert.strictEqual((kubecost.asked || []).length, asked);
});

test("with no engine read yet, an empty window is the read's to judge, not this check's", async (): Promise<void> => {
  const world: World = new World();

  assert.strictEqual(
    await world
      .resolver("auto")
      .isWindowComplete({ ...COLLECTED, allocations: [] }),
    true,
  );
});

// --- where a Kubecost 3's prices come from (#9851) ---------------------------

test("a Kubecost 3 the agent reads says where its prices come from, for the cluster its rows name", async (): Promise<void> => {
  const world: World = new World();
  world.services = [
    {
      metadata: {
        name: "kubecost-frontend",
        namespace: "kubecost3",
        labels: { app: "kubecost", "app.kubernetes.io/name": "kubecost" },
      },
      spec: { ports: [{ name: "tcp-frontend", port: 9090 }] },
    },
  ];
  const kubecost3: FakeEngine = world.engine(
    "http://kubecost-frontend.kubecost3.svc:9090",
    {
      kind: "Kubecost",
      // Kubecost 3 answers no /clusterInfo.
      clusterInfo: null,
      answer: [
        { name: "a", properties: { cluster: "cost-metrics-3" }, totalCost: 1 },
        { name: "__idle__", properties: { cluster: "cost-metrics-3" } },
      ],
      api: {
        "pricing/status": { enabled: false, authorized: false, source: "" },
        "clusters/status": [
          { id: "cost-metrics-3", provider: "GCP" },
          { id: "staging", provider: "AWS" },
        ],
        "cloudCost/status": null,
        assets: [null],
      },
    },
  );
  world.engine(BUNDLED_URL, {});

  const resolver: CostEngineResolver = world.resolver("bundled");
  await resolver.fetchAllocations(WINDOW);

  // The cluster the rows name, among the two it answers for.
  assert.deepStrictEqual(resolver.describe(), {
    engine: "Kubecost",
    service: "kubecost3/kubecost-frontend",
    bundledEngineUnused: true,
    pricingSource: "list-prices",
    pricingProvider: "GCP",
  });
  assert.deepStrictEqual(
    (kubecost3.asked || []).map(
      (asked: { name: string; params: Record<string, string> }): string => {
        return asked.name;
      },
    ),
    [
      "clusterInfo",
      "pricing/status",
      "clusters/status",
      "cloudCost/status",
      "assets",
    ],
  );
});

// --- whose Prometheus the memory peaks are read from (#9777) ----------------

test("the bundled engine's Prometheus is asked for until another engine is found", async (): Promise<void> => {
  const world: World = new World();
  world.services = [KUBECOST];
  world.engine(KUBECOST_URL, { kind: "Kubecost" });
  world.engine(BUNDLED_URL, {});

  const resolver: CostEngineResolver = world.resolver("bundled");

  // Before the first look: the bundled engine, created for nothing.
  assert.deepStrictEqual(resolver.prometheusEngine(), {
    url: BUNDLED_URL,
    origin: "bundled",
    kind: null,
    service: {
      name: "oneuptime-agent-kubernetes-agent-opencost",
      namespace: "oneuptime",
    },
  });
  assert.deepStrictEqual(world.clientsCreated, []);

  await resolver.fetchAllocations(WINDOW);

  // The cluster's own Kubecost: its Service is where its pods are found.
  assert.deepStrictEqual(resolver.prometheusEngine(), {
    url: KUBECOST_URL,
    origin: "discovered",
    kind: "Kubecost",
    service: { name: "kubecost-cost-analyzer", namespace: "kubecost" },
  });
});

test("the engine cost.engine.url names is asked for from the start, as the Service it names", async (): Promise<void> => {
  const world: World = new World();
  world.services = [OPENCOST];
  world.engine(OPENCOST_URL, { kind: "OpenCost" });

  const resolver: CostEngineResolver = world.resolver("configured", {
    engineUrl: OPENCOST_URL,
  });

  assert.deepStrictEqual(resolver.prometheusEngine(), {
    url: OPENCOST_URL,
    origin: "configured",
    kind: null,
    service: { name: "opencost", namespace: "opencost" },
  });

  // Once its Service is read, which engine it is.
  await resolver.fetchAllocations(WINDOW);
  assert.strictEqual(resolver.prometheusEngine()?.kind, "OpenCost");

  // An address that is no Service names none.
  assert.deepStrictEqual(
    world
      .resolver("configured", { engineUrl: "https://kubecost.example.com" })
      .prometheusEngine(),
    {
      url: "https://kubecost.example.com",
      origin: "configured",
      kind: null,
      service: null,
    },
  );
});

test("auto has no engine's Prometheus to ask for until it has an engine", async (): Promise<void> => {
  const world: World = new World();
  const resolver: CostEngineResolver = world.resolver("auto");

  assert.strictEqual(resolver.prometheusEngine(), null);

  world.services = [OPENCOST];
  world.engine(OPENCOST_URL, {});
  await resolver.fetchAllocations(WINDOW);

  assert.deepStrictEqual(resolver.prometheusEngine(), {
    url: OPENCOST_URL,
    origin: "discovered",
    kind: "OpenCost",
    service: { name: "opencost", namespace: "opencost" },
  });
});
