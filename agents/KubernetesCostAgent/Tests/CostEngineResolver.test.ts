import "./TestEnv";
import * as assert from "assert";
import { test } from "node:test";
import { CostEngineClient } from "../CostEngineClient";
import { CostEngineMode, CostEngineResolver } from "../CostEngineResolver";
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
  fetches: number;
}

class World {
  public services: Array<KubernetesService> = [];
  public listError: Error | null = null;
  public lists: number = 0;
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
    overrides?: { rateCardHint?: string },
  ): CostEngineResolver {
    return new CostEngineResolver({
      mode: mode,
      engineUrl: mode === "auto" ? "" : BUNDLED_URL,
      rateCardHint: overrides?.rateCardHint || "",
      listServices: async (
        query: ServiceQuery,
      ): Promise<Array<KubernetesService>> => {
        this.lists++;
        if (this.listError) {
          throw this.listError;
        }
        // The label reads see labelled Services; the name read, "opencost".
        return this.services.filter((service: KubernetesService): boolean => {
          return query.fieldSelector
            ? service.metadata?.name === "opencost"
            : Boolean(service.metadata?.labels);
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
      async fetchApiData(name: string): Promise<unknown> {
        const engine: FakeEngine | undefined = engines.get(url);
        if (!engine) {
          return null;
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

  assert.strictEqual(world.lists, 0);
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

  assert.strictEqual(world.lists, 0);
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
