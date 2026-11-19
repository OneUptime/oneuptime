import "./TestEnv";
import * as assert from "assert";
import * as http from "http";
import { AddressInfo } from "net";
import { after, before, test } from "node:test";
import { serviceOfUrl } from "../EngineDiscovery";
import {
  EngineMetricsTarget,
  FINOPS_AGENT_SELECTOR,
  FoundMetricsEndpoint,
  MetricsEngine,
  MetricsProbe,
  engineMetricsCandidates,
  findEngineMetricsEndpoint,
  finopsAgentMetricsUrls,
  hasPriceSeries,
  probeMetricsEndpoint,
  toScrapeTargetGroups,
} from "../EngineMetrics";
import { KubernetesService, ServiceQuery } from "../KubernetesApi";

/*
 * #9776: the collector scraped <cost.engine.url>/metrics, and a Kubecost
 * named by its frontend - the URL the docs gave - answers that with its web
 * UI. The agent now finds where the engine in use serves its price series.
 *
 * The engines' answers below are the ones Kubecost 2.8.7, Kubecost 3.3.2
 * and OpenCost 1.121.4 gave from their own charts on a kind cluster:
 *
 *   Kubecost 2 frontend :9090  /metrics -> 200 text/html (the UI)
 *                              /model/metrics -> the cost model's metrics
 *   Kubecost 2 cost model :9003 /metrics -> metrics
 *   Kubecost 3 frontend :9090  /metrics -> 200 text/html (the UI)
 *                              /model/metrics -> 404 (the aggregator's)
 *   Kubecost 3 finops agent :80 /metrics -> metrics
 *   OpenCost API :9003         /metrics -> metrics
 *   OpenCost UI :9090          /metrics -> 200 text/html (the UI)
 *                              /model/metrics -> the API's metrics
 */

// The start of what each served, cut down.
const KUBECOST_UI_PAGE: string =
  '<!DOCTYPE html>\n<html lang="en">\n  <head>\n\t<meta charset="UTF-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n';

const ENGINE_METRICS: string = [
  "# HELP container_cpu_allocation container_cpu_allocation Percent of a single CPU used in a minute",
  "# TYPE container_cpu_allocation gauge",
  'container_cpu_allocation{container="api",namespace="shop",node="kind-control-plane",pod="api-1"} 0.1',
  "# HELP node_total_hourly_cost node_total_hourly_cost Total node cost per hour",
  "# TYPE node_total_hourly_cost gauge",
  'node_total_hourly_cost{arch="amd64",instance="kind-control-plane",instance_type="",node="kind-control-plane",provider_id="kind://docker/kind/kind-control-plane",region=""} 1.5444796728401184',
  "",
].join("\n");

const RUNTIME_METRICS_ONLY: string = [
  "# HELP go_goroutines Number of goroutines that currently exist.",
  "# TYPE go_goroutines gauge",
  "go_goroutines 42",
  "",
].join("\n");

// --- What counts as the engine's price metrics ------------------------------

test("a sample of each price series the chart forwards counts", (): void => {
  for (const line of [
    'node_cpu_hourly_cost{node="a"} 0.031611',
    'node_gpu_hourly_cost{node="a"} 0',
    'node_ram_hourly_cost{node="a"} 0.004237',
    'node_total_hourly_cost{node="a"} 1.5',
    'pv_hourly_cost{persistentvolume="pvc-1"} 5.479452e-05',
    'kubecost_cluster_management_cost{provisioner_name=""} 0',
    'kubecost_load_balancer_cost{namespace="a"} 0.025',
    "kubecost_network_zone_egress_cost 0.01",
    "kubecost_network_region_egress_cost 0.01",
    "kubecost_network_internet_egress_cost 0.12",
  ]) {
    assert.ok(hasPriceSeries(`go_goroutines 1\n${line}\n`), line);
  }
});

test("a web page, a 404 or runtime metrics are not price metrics", (): void => {
  assert.strictEqual(hasPriceSeries(KUBECOST_UI_PAGE), false);
  assert.strictEqual(hasPriceSeries("404 page not found\n"), false);
  assert.strictEqual(hasPriceSeries(RUNTIME_METRICS_ONLY), false);
});

test("a family declared with no sample yet is not price metrics", (): void => {
  assert.strictEqual(
    hasPriceSeries(
      "# HELP node_total_hourly_cost Total node cost per hour\n# TYPE node_total_hourly_cost gauge\n",
    ),
    false,
  );
});

test("a series whose name only starts like a price series does not count", (): void => {
  assert.strictEqual(hasPriceSeries("node_total_hourly_cost_total 1\n"), false);
  assert.strictEqual(hasPriceSeries("xnode_total_hourly_cost 1\n"), false);
});

// --- Which in-cluster Service a URL names -----------------------------------

test("reads the Service and namespace however the URL spells them", (): void => {
  assert.deepStrictEqual(
    serviceOfUrl(
      "http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090",
    ),
    { name: "kubecost-cost-analyzer", namespace: "kubecost" },
  );
  assert.deepStrictEqual(
    serviceOfUrl("http://kubecost-frontend.kubecost3.svc:9090/"),
    { name: "kubecost-frontend", namespace: "kubecost3" },
  );
  assert.deepStrictEqual(serviceOfUrl("http://opencost.opencost:9003"), {
    name: "opencost",
    namespace: "opencost",
  });
  assert.deepStrictEqual(
    serviceOfUrl("http://OpenCost.OpenCost.svc.cluster.local.:9003"),
    { name: "opencost", namespace: "opencost" },
  );
});

test("an ingress host, an address or a bare name is no Service", (): void => {
  assert.strictEqual(serviceOfUrl("https://kubecost.example.com"), null);
  assert.strictEqual(serviceOfUrl("http://10.96.12.4:9090"), null);
  assert.strictEqual(serviceOfUrl("http://[fd00::12]:9090"), null);
  assert.strictEqual(serviceOfUrl("http://kubecost:9090"), null);
  assert.strictEqual(serviceOfUrl("not a url"), null);
});

// --- Where to look ----------------------------------------------------------

test("tries the engine's /metrics, then the /model/metrics a frontend proxies", (): void => {
  assert.deepStrictEqual(
    engineMetricsCandidates("http://kubecost-cost-analyzer.kubecost:9090/"),
    [
      "http://kubecost-cost-analyzer.kubecost:9090/metrics",
      "http://kubecost-cost-analyzer.kubecost:9090/model/metrics",
    ],
  );
});

test("keeps a path the engine URL has, and adds no second /metrics", (): void => {
  assert.deepStrictEqual(
    engineMetricsCandidates("https://kubecost.example.com/model"),
    [
      "https://kubecost.example.com/model/metrics",
      "https://kubecost.example.com/model/model/metrics",
    ],
  );
  assert.deepStrictEqual(
    engineMetricsCandidates("http://opencost.opencost:9003/metrics"),
    [
      "http://opencost.opencost:9003/metrics",
      "http://opencost.opencost:9003/model/metrics",
    ],
  );
});

// The finops agent Service of Kubecost 3.3.2, as the cluster served it.
const KUBECOST3_FINOPS_AGENT: KubernetesService = {
  metadata: {
    name: "kubecost-finopsagent",
    namespace: "kubecost3",
    labels: {
      "app.kubernetes.io/component": "service",
      "app.kubernetes.io/instance": "kubecost",
      "app.kubernetes.io/name": "finopsagent",
      "app.kubernetes.io/part-of": "finops-agent",
    },
  },
  spec: { ports: [{ name: "http", port: 80 }] },
};

test("reaches a Kubecost 3 finops agent at its http port", (): void => {
  assert.deepStrictEqual(
    finopsAgentMetricsUrls([KUBECOST3_FINOPS_AGENT], "kubecost3"),
    ["http://kubecost-finopsagent.kubecost3.svc:80/metrics"],
  );
});

test("takes the port named http before any other, else the first", (): void => {
  const service: (
    name: string,
    ports: Array<{ name?: string; port?: number }>,
  ) => KubernetesService = (
    name: string,
    ports: Array<{ name?: string; port?: number }>,
  ): KubernetesService => {
    return {
      metadata: { name, namespace: "kubecost" },
      spec: { ports },
    };
  };

  assert.deepStrictEqual(
    finopsAgentMetricsUrls(
      [
        service("b-agent", [
          { name: "grpc", port: 9000 },
          { name: "http", port: 8080 },
        ]),
        service("a-agent", [{ name: "metrics", port: 9100 }]),
        service("c-agent", []),
        service("d-agent", [{ name: "http", port: 70000 }]),
      ],
      "kubecost",
    ),
    [
      "http://a-agent.kubecost.svc:9100/metrics",
      "http://b-agent.kubecost.svc:8080/metrics",
    ],
  );
});

test("never takes a finops agent of another namespace", (): void => {
  assert.deepStrictEqual(
    finopsAgentMetricsUrls([KUBECOST3_FINOPS_AGENT], "kubecost"),
    [],
  );
});

// --- What the collector is told ---------------------------------------------

test("tells the collector the target, scheme and path to scrape", (): void => {
  assert.deepStrictEqual(
    toScrapeTargetGroups(
      "http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090/model/metrics",
    ),
    [
      {
        targets: ["kubecost-cost-analyzer.kubecost.svc.cluster.local:9090"],
        labels: { __scheme__: "http", __metrics_path__: "/model/metrics" },
      },
    ],
  );
  assert.deepStrictEqual(
    toScrapeTargetGroups("https://kubecost.example.com/model/metrics"),
    [
      {
        targets: ["kubecost.example.com:443"],
        labels: { __scheme__: "https", __metrics_path__: "/model/metrics" },
      },
    ],
  );
  // A URL drops a scheme's own port; the target keeps it.
  assert.deepStrictEqual(
    toScrapeTargetGroups(
      "http://kubecost-finopsagent.kubecost3.svc:80/metrics",
    ),
    [
      {
        targets: ["kubecost-finopsagent.kubecost3.svc:80"],
        labels: { __scheme__: "http", __metrics_path__: "/metrics" },
      },
    ],
  );
  assert.deepStrictEqual(
    toScrapeTargetGroups("http://[fd00::12]:9003/metrics"),
    [
      {
        targets: ["[fd00::12]:9003"],
        labels: { __scheme__: "http", __metrics_path__: "/metrics" },
      },
    ],
  );
});

test("tells the collector nothing to scrape when there is no endpoint", (): void => {
  assert.deepStrictEqual(toScrapeTargetGroups(null), []);
  assert.deepStrictEqual(toScrapeTargetGroups("not a url"), []);
  assert.deepStrictEqual(
    toScrapeTargetGroups("tcp://opencost:9003/metrics"),
    [],
  );
});

// --- Asking an address, against a stand-in server ---------------------------

let stub: http.Server;
let base: string = "";

before(async (): Promise<void> => {
  stub = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse): void => {
      const send: (status: number, type: string, body: string) => void = (
        status: number,
        type: string,
        body: string,
      ): void => {
        res.writeHead(status, { "Content-Type": type });
        res.end(body);
      };

      switch (req.url) {
        case "/metrics":
          send(200, "text/plain; version=0.0.4; charset=utf-8", ENGINE_METRICS);
          return;
        case "/ui/metrics":
          // nginx's try_files: any path the UI does not know is its page.
          send(200, "text/html", KUBECOST_UI_PAGE);
          return;
        case "/missing/metrics":
          send(404, "text/plain; charset=utf-8", "404 page not found\n");
          return;
        case "/runtime/metrics":
          send(
            200,
            "text/plain; version=0.0.4; charset=utf-8",
            RUNTIME_METRICS_ONLY,
          );
          return;
        case "/moved/metrics":
          res.writeHead(302, { Location: "/login" });
          res.end();
          return;
        case "/big/metrics": {
          /*
           * A big cluster: megabytes of per-container series first, and the
           * price series' name split across two writes.
           */
          res.writeHead(200, {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          });
          const line: string =
            'container_memory_allocation_bytes{container="c",namespace="n",node="k",pod="p"} 1.2e+08\n';
          const block: string = line.repeat(2000);
          for (let i: number = 0; i < 20; i++) {
            res.write(block);
          }
          res.write("node_total_hou");
          setTimeout((): void => {
            res.end('rly_cost{node="k"} 1.5\n');
          }, 20);
          return;
        }
        default:
          send(404, "text/plain", "404 page not found\n");
      }
    },
  );

  await new Promise<void>((resolve: () => void): void => {
    stub.listen(0, "127.0.0.1", resolve);
  });

  base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});

after(async (): Promise<void> => {
  await new Promise<void>((resolve: () => void): void => {
    stub.close((): void => {
      resolve();
    });
  });
});

test("an engine's own metrics with prices are the endpoint", async (): Promise<void> => {
  assert.deepStrictEqual(await probeMetricsEndpoint(`${base}/metrics`), {
    ok: true,
    reason: "",
  });
});

test("a frontend's web page is never taken for metrics", async (): Promise<void> => {
  const probe: MetricsProbe = await probeMetricsEndpoint(`${base}/ui/metrics`);

  assert.strictEqual(probe.ok, false);
  assert.match(probe.reason, /web page \(text\/html\)/);
});

test("a 404, a redirect and metrics without prices are not the endpoint", async (): Promise<void> => {
  assert.deepStrictEqual(
    await probeMetricsEndpoint(`${base}/missing/metrics`),
    { ok: false, reason: "HTTP 404" },
  );
  assert.deepStrictEqual(await probeMetricsEndpoint(`${base}/moved/metrics`), {
    ok: false,
    reason: "HTTP 302",
  });
  assert.deepStrictEqual(
    await probeMetricsEndpoint(`${base}/runtime/metrics`),
    {
      ok: false,
      reason: "answers, but with none of the engine's price series",
    },
  );
});

test("finds a price series after megabytes of others, split across reads", async (): Promise<void> => {
  assert.deepStrictEqual(await probeMetricsEndpoint(`${base}/big/metrics`), {
    ok: true,
    reason: "",
  });
});

test("an address that does not answer is not the endpoint, and says why", async (): Promise<void> => {
  const closed: http.Server = http.createServer();
  await new Promise<void>((resolve: () => void): void => {
    closed.listen(0, "127.0.0.1", resolve);
  });
  const port: number = (closed.address() as AddressInfo).port;
  await new Promise<void>((resolve: () => void): void => {
    closed.close((): void => {
      resolve();
    });
  });

  const probe: MetricsProbe = await probeMetricsEndpoint(
    `http://127.0.0.1:${port}/metrics`,
  );

  assert.strictEqual(probe.ok, false);
  assert.match(probe.reason, /ECONNREFUSED/);
});

// --- Each engine's shape, as the real ones answered -------------------------

/*
 * The addresses that serve price series, by what the real engines answered;
 * everything else answers what the stand-in says (a web page for a frontend's
 * /metrics, 404 otherwise).
 */
class Cluster {
  public metrics: Set<string> = new Set<string>();
  public webPages: Set<string> = new Set<string>();
  public services: Array<KubernetesService> = [];
  public listError: Error | null = null;
  public probed: Array<string> = [];
  public queries: Array<ServiceQuery> = [];

  public probe = async (url: string): Promise<MetricsProbe> => {
    this.probed.push(url);
    if (this.metrics.has(url)) {
      return { ok: true, reason: "" };
    }
    if (this.webPages.has(url)) {
      return { ok: false, reason: "a web page (text/html), not metrics" };
    }
    return { ok: false, reason: "HTTP 404" };
  };

  public listServices = async (
    query: ServiceQuery,
  ): Promise<Array<KubernetesService>> => {
    this.queries.push(query);
    if (this.listError) {
      throw this.listError;
    }
    return this.services;
  };

  public find(engine: MetricsEngine): Promise<FoundMetricsEndpoint> {
    return findEngineMetricsEndpoint({
      engine,
      listServices: this.listServices,
      probe: this.probe,
    });
  }
}

const KUBECOST2: string =
  "http://kubecost-cost-analyzer.kubecost.svc.cluster.local";
const KUBECOST3: string =
  "http://kubecost-frontend.kubecost3.svc.cluster.local";
const OPENCOST: string = "http://opencost.opencost.svc.cluster.local";

const kubecost2: () => Cluster = (): Cluster => {
  const cluster: Cluster = new Cluster();
  cluster.webPages.add(`${KUBECOST2}:9090/metrics`);
  cluster.metrics.add(`${KUBECOST2}:9090/model/metrics`);
  cluster.metrics.add(`${KUBECOST2}:9003/metrics`);
  return cluster;
};

const kubecost3: () => Cluster = (): Cluster => {
  const cluster: Cluster = new Cluster();
  cluster.webPages.add(`${KUBECOST3}:9090/metrics`);
  cluster.metrics.add("http://kubecost-finopsagent.kubecost3.svc:80/metrics");
  cluster.services = [KUBECOST3_FINOPS_AGENT];
  return cluster;
};

const opencost: () => Cluster = (): Cluster => {
  const cluster: Cluster = new Cluster();
  cluster.metrics.add(`${OPENCOST}:9003/metrics`);
  cluster.webPages.add(`${OPENCOST}:9090/metrics`);
  cluster.metrics.add(`${OPENCOST}:9090/model/metrics`);
  return cluster;
};

test("Kubecost 2 named by its frontend: the cost model behind /model/metrics, never the UI's page", async (): Promise<void> => {
  // The regression: this URL is the one the docs gave, and /metrics is the UI.
  const cluster: Cluster = kubecost2();

  const found: FoundMetricsEndpoint = await cluster.find({
    url: `${KUBECOST2}:9090`,
    namespace: "kubecost",
  });

  assert.deepStrictEqual(found, {
    url: `${KUBECOST2}:9090/model/metrics`,
    reasons: [],
  });
  // Found without asking the Kubernetes API.
  assert.deepStrictEqual(cluster.queries, []);
});

test("Kubecost 2 named by its cost model: its own /metrics", async (): Promise<void> => {
  const cluster: Cluster = kubecost2();

  assert.deepStrictEqual(
    await cluster.find({ url: `${KUBECOST2}:9003`, namespace: "kubecost" }),
    { url: `${KUBECOST2}:9003/metrics`, reasons: [] },
  );
  assert.deepStrictEqual(cluster.probed, [`${KUBECOST2}:9003/metrics`]);
});

test("Kubecost 3 named by its frontend: its finops agent, which has the prices", async (): Promise<void> => {
  const cluster: Cluster = kubecost3();

  assert.deepStrictEqual(
    await cluster.find({ url: `${KUBECOST3}:9090`, namespace: "kubecost3" }),
    {
      url: "http://kubecost-finopsagent.kubecost3.svc:80/metrics",
      reasons: [],
    },
  );
  // Only the engine's own namespace, narrowed by the API server.
  assert.deepStrictEqual(cluster.queries, [
    {
      labelSelector: FINOPS_AGENT_SELECTOR,
      fieldSelector: "metadata.namespace=kubecost3",
    },
  ]);
  assert.deepStrictEqual(cluster.probed, [
    `${KUBECOST3}:9090/metrics`,
    `${KUBECOST3}:9090/model/metrics`,
    "http://kubecost-finopsagent.kubecost3.svc:80/metrics",
  ]);
});

test("Kubecost 3 named by its aggregator: its finops agent too", async (): Promise<void> => {
  const cluster: Cluster = kubecost3();

  assert.strictEqual(
    (
      await cluster.find({
        url: "http://kubecost-aggregator.kubecost3.svc:9004",
        namespace: "kubecost3",
      })
    ).url,
    "http://kubecost-finopsagent.kubecost3.svc:80/metrics",
  );
});

test("OpenCost named by its API: /metrics", async (): Promise<void> => {
  const cluster: Cluster = opencost();

  assert.deepStrictEqual(
    await cluster.find({ url: `${OPENCOST}:9003`, namespace: "opencost" }),
    { url: `${OPENCOST}:9003/metrics`, reasons: [] },
  );
});

test("OpenCost named by its UI: the API behind /model/metrics, never the UI's page", async (): Promise<void> => {
  const cluster: Cluster = opencost();

  assert.deepStrictEqual(
    await cluster.find({ url: `${OPENCOST}:9090`, namespace: "opencost" }),
    { url: `${OPENCOST}:9090/model/metrics`, reasons: [] },
  );
});

test("Kubecost 2.9, which runs a finops agent beside the cost model: the cost model, once", async (): Promise<void> => {
  // Both carry the same series: scraping both would count every node twice.
  const cluster: Cluster = kubecost2();
  cluster.services = [{ ...KUBECOST3_FINOPS_AGENT }];
  cluster.services[0]!.metadata = {
    ...KUBECOST3_FINOPS_AGENT.metadata,
    namespace: "kubecost",
  };
  cluster.metrics.add("http://kubecost-finopsagent.kubecost.svc:80/metrics");

  assert.strictEqual(
    (await cluster.find({ url: `${KUBECOST2}:9090`, namespace: "kubecost" }))
      .url,
    `${KUBECOST2}:9090/model/metrics`,
  );
  assert.deepStrictEqual(cluster.queries, []);
});

test("a Kubecost 3 behind an ingress: nothing found, and every address tried says why", async (): Promise<void> => {
  const cluster: Cluster = kubecost3();
  cluster.webPages.add("https://kubecost.example.com/metrics");

  const found: FoundMetricsEndpoint = await cluster.find({
    url: "https://kubecost.example.com",
    namespace: null,
  });

  assert.strictEqual(found.url, null);
  assert.deepStrictEqual(found.reasons, [
    "https://kubecost.example.com/metrics: a web page (text/html), not metrics",
    "https://kubecost.example.com/model/metrics: HTTP 404",
  ]);
  // No namespace to look for a finops agent in.
  assert.deepStrictEqual(cluster.queries, []);
});

test("a Kubecost 3 with no finops agent left: nothing found, and it says so", async (): Promise<void> => {
  const cluster: Cluster = kubecost3();
  cluster.services = [];

  const found: FoundMetricsEndpoint = await cluster.find({
    url: `${KUBECOST3}:9090`,
    namespace: "kubecost3",
  });

  assert.strictEqual(found.url, null);
  assert.deepStrictEqual(found.reasons.slice(2), [
    "no Kubecost 3 finops agent Service in namespace kubecost3",
  ]);
});

test("a finops agent without price series is not taken either", async (): Promise<void> => {
  const cluster: Cluster = kubecost3();
  cluster.metrics.clear();

  const found: FoundMetricsEndpoint = await cluster.find({
    url: `${KUBECOST3}:9090`,
    namespace: "kubecost3",
  });

  assert.strictEqual(found.url, null);
  assert.strictEqual(
    found.reasons[2],
    "http://kubecost-finopsagent.kubecost3.svc:80/metrics: HTTP 404",
  );
});

test("a Kubernetes API that does not answer is named among the reasons", async (): Promise<void> => {
  const cluster: Cluster = kubecost3();
  cluster.listError = new Error("Kubernetes API answered HTTP 403");

  const found: FoundMetricsEndpoint = await cluster.find({
    url: `${KUBECOST3}:9090`,
    namespace: "kubecost3",
  });

  assert.strictEqual(found.url, null);
  assert.strictEqual(
    found.reasons[2],
    "could not look for a Kubecost 3 finops agent in namespace kubecost3: Kubernetes API answered HTTP 403",
  );
});

// --- Keeping the answer current ---------------------------------------------

class Clock {
  public nowMs: number = Date.parse("2026-11-19T12:00:00Z");
  public now = (): number => {
    return this.nowMs;
  };
}

const target: (
  cluster: Cluster,
  clock: Clock,
  engine: { current: MetricsEngine | null },
) => EngineMetricsTarget = (
  cluster: Cluster,
  clock: Clock,
  engine: { current: MetricsEngine | null },
): EngineMetricsTarget => {
  return new EngineMetricsTarget({
    engine: (): MetricsEngine | null => {
      return engine.current;
    },
    listServices: cluster.listServices,
    probe: cluster.probe,
    now: clock.now,
    retryMs: 60 * 1000,
    refreshMs: 60 * 60 * 1000,
  });
};

test("serves the endpoint once found, and looks again only after an hour", async (): Promise<void> => {
  const cluster: Cluster = kubecost2();
  const clock: Clock = new Clock();
  const engine: { current: MetricsEngine | null } = {
    current: { url: `${KUBECOST2}:9090`, namespace: "kubecost" },
  };
  const metrics: EngineMetricsTarget = target(cluster, clock, engine);

  assert.deepStrictEqual(metrics.targetGroups(), []);

  await metrics.refreshIfDue();
  assert.deepStrictEqual(metrics.targetGroups(), [
    {
      targets: ["kubecost-cost-analyzer.kubecost.svc.cluster.local:9090"],
      labels: { __scheme__: "http", __metrics_path__: "/model/metrics" },
    },
  ]);
  assert.strictEqual(metrics.reason(), "");

  const probes: number = cluster.probed.length;
  clock.nowMs += 59 * 60 * 1000;
  await metrics.refreshIfDue();
  assert.strictEqual(cluster.probed.length, probes);

  clock.nowMs += 60 * 1000;
  await metrics.refreshIfDue();
  assert.ok(cluster.probed.length > probes);
});

test("looks again every minute while nothing is found, and says why meanwhile", async (): Promise<void> => {
  const cluster: Cluster = kubecost3();
  cluster.services = [];
  const clock: Clock = new Clock();
  const engine: { current: MetricsEngine | null } = {
    current: { url: `${KUBECOST3}:9090`, namespace: "kubecost3" },
  };
  const metrics: EngineMetricsTarget = target(cluster, clock, engine);

  await metrics.refreshIfDue();
  assert.deepStrictEqual(metrics.targetGroups(), []);
  assert.match(metrics.reason(), /no Kubecost 3 finops agent Service/);

  const lists: number = cluster.queries.length;
  clock.nowMs += 30 * 1000;
  await metrics.refreshIfDue();
  assert.strictEqual(cluster.queries.length, lists);

  // The finops agent comes up.
  cluster.services = [KUBECOST3_FINOPS_AGENT];
  clock.nowMs += 30 * 1000;
  await metrics.refreshIfDue();
  assert.strictEqual(
    metrics.url(),
    "http://kubecost-finopsagent.kubecost3.svc:80/metrics",
  );
  assert.strictEqual(metrics.reason(), "");
});

test("a new engine is looked at at once, and the old one's endpoint is never served for it", async (): Promise<void> => {
  const cluster: Cluster = kubecost2();
  cluster.metrics.add(`${OPENCOST}:9003/metrics`);
  const clock: Clock = new Clock();
  const engine: { current: MetricsEngine | null } = {
    current: { url: `${KUBECOST2}:9090`, namespace: "kubecost" },
  };
  const metrics: EngineMetricsTarget = target(cluster, clock, engine);

  await metrics.refreshIfDue();
  assert.strictEqual(metrics.url(), `${KUBECOST2}:9090/model/metrics`);

  engine.current = { url: `${OPENCOST}:9003`, namespace: "opencost" };
  // Before the look: nothing, not the Kubecost endpoint.
  assert.strictEqual(metrics.url(), null);
  assert.deepStrictEqual(metrics.targetGroups(), []);

  await metrics.refreshIfDue();
  assert.strictEqual(metrics.url(), `${OPENCOST}:9003/metrics`);
});

test("an engine that stops answering keeps its endpoint, and is asked again every minute", async (): Promise<void> => {
  const cluster: Cluster = kubecost2();
  const clock: Clock = new Clock();
  const engine: { current: MetricsEngine | null } = {
    current: { url: `${KUBECOST2}:9090`, namespace: "kubecost" },
  };
  const metrics: EngineMetricsTarget = target(cluster, clock, engine);

  await metrics.refreshIfDue();
  const found: string | null = metrics.url();

  // Down for a moment, an hour later.
  cluster.metrics.clear();
  clock.nowMs += 60 * 60 * 1000;
  await metrics.refreshIfDue();
  assert.strictEqual(metrics.url(), found);

  const probes: number = cluster.probed.length;
  cluster.metrics.add(`${KUBECOST2}:9090/model/metrics`);
  clock.nowMs += 60 * 1000;
  await metrics.refreshIfDue();
  assert.ok(cluster.probed.length > probes);
  assert.strictEqual(metrics.url(), found);
});

test("serves nothing while there is no engine, and asks nothing", async (): Promise<void> => {
  const cluster: Cluster = kubecost2();
  const clock: Clock = new Clock();
  const engine: { current: MetricsEngine | null } = { current: null };
  const metrics: EngineMetricsTarget = target(cluster, clock, engine);

  await metrics.refreshIfDue();

  assert.deepStrictEqual(metrics.targetGroups(), []);
  assert.deepStrictEqual(cluster.probed, []);

  // An engine found, then lost again (auto, after it kept failing).
  engine.current = { url: `${KUBECOST2}:9090`, namespace: "kubecost" };
  await metrics.refreshIfDue();
  assert.ok(metrics.url());

  engine.current = null;
  assert.deepStrictEqual(metrics.targetGroups(), []);
});

test("one look at a time, however often it is asked", async (): Promise<void> => {
  const cluster: Cluster = kubecost2();
  const clock: Clock = new Clock();
  const engine: { current: MetricsEngine | null } = {
    current: { url: `${KUBECOST2}:9003`, namespace: "kubecost" },
  };
  const metrics: EngineMetricsTarget = target(cluster, clock, engine);

  await Promise.all([
    metrics.refreshIfDue(),
    metrics.refreshIfDue(),
    metrics.refreshIfDue(),
  ]);

  assert.deepStrictEqual(cluster.probed, [`${KUBECOST2}:9003/metrics`]);
});

test("a look that throws is a reason, not a crash", async (): Promise<void> => {
  const clock: Clock = new Clock();
  const metrics: EngineMetricsTarget = new EngineMetricsTarget({
    engine: (): MetricsEngine | null => {
      return { url: `${KUBECOST3}:9090`, namespace: "kubecost3" };
    },
    listServices: async (): Promise<Array<KubernetesService>> => {
      return [];
    },
    probe: async (): Promise<MetricsProbe> => {
      throw new Error("socket hang up");
    },
    now: clock.now,
  });

  await metrics.refreshIfDue();

  assert.strictEqual(metrics.url(), null);
  assert.strictEqual(metrics.reason(), "socket hang up");
});
