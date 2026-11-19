import "./TestEnv";
import * as assert from "assert";
import { test } from "node:test";
import {
  CadvisorSeriesCount,
  CostPrometheus,
  CostPrometheusTarget,
  FoundPrometheus,
  KubernetesReads,
  PrometheusCandidate,
  PrometheusEngine,
  cadvisorSeriesQuery,
  chooseCadvisorSeries,
  enginePrometheusCandidates,
  findEnginePrometheus,
  kubecostPrometheusServices,
  normalizePrometheusUrl,
  promqlString,
  readContainerVariable,
  redactUrl,
  toLabelSelector,
} from "../EnginePrometheus";
import {
  KubernetesConfigMap,
  KubernetesPod,
  KubernetesService,
  PodQuery,
  ServiceQuery,
} from "../KubernetesApi";
import { PrometheusVectorSample } from "../PrometheusQuery";

/*
 * #9777: when the cost agent reads the cluster's own Kubecost or OpenCost,
 * memory right-sizing reads its peaks from the Prometheus that engine reads,
 * found at run time. The Kubernetes objects below are the ones Kubecost
 * 2.8.7, Kubecost 3.3.2 and OpenCost 1.121.4 (chart 2.5.34) created from
 * their own charts on a kind cluster, cut to what the agent reads.
 */

// --- The engines, as their charts create them -------------------------------

const KUBECOST2_SERVICE: KubernetesService = {
  metadata: {
    name: "kubecost-cost-analyzer",
    namespace: "kubecost",
    labels: {
      app: "cost-analyzer",
      "app.kubernetes.io/instance": "kubecost",
      "app.kubernetes.io/name": "cost-analyzer",
    },
  },
  spec: {
    selector: {
      app: "cost-analyzer",
      "app.kubernetes.io/instance": "kubecost",
      "app.kubernetes.io/name": "cost-analyzer",
    },
    ports: [
      { name: "tcp-model", port: 9003 },
      { name: "tcp-frontend", port: 9090 },
    ],
  },
};

// The cost model reads Prometheus from the chart's ConfigMap.
const KUBECOST2_POD: KubernetesPod = {
  metadata: {
    name: "kubecost-cost-analyzer-86d48d7474-7ljpl",
    namespace: "kubecost",
  },
  spec: {
    containers: [
      {
        name: "cost-model",
        env: [
          { name: "CONTAINER_IMAGE_TAG", value: "2.8.7" },
          {
            name: "PROMETHEUS_SERVER_ENDPOINT",
            valueFrom: {
              configMapKeyRef: {
                name: "kubecost-cost-analyzer",
                key: "prometheus-server-endpoint",
              },
            },
          },
          {
            name: "CLUSTER_ID",
            valueFrom: {
              configMapKeyRef: {
                name: "kubecost-cost-analyzer",
                key: "cluster-id",
              },
            },
          },
        ],
      },
      {
        name: "cost-analyzer-frontend",
        env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
      },
    ],
  },
  status: { phase: "Running" },
};

const KUBECOST2_CONFIGMAP: KubernetesConfigMap = {
  metadata: { name: "kubecost-cost-analyzer", namespace: "kubecost" },
  data: {
    "prometheus-alertmanager-endpoint":
      "http://kubecost-prometheus-alertmanager.kubecost",
    "prometheus-server-endpoint": "http://kubecost-prometheus-server.kubecost",
  },
};

// The Prometheus Kubecost 2 bundles, as the community chart labels it.
const KUBECOST2_PROMETHEUS_SERVICE: KubernetesService = {
  metadata: {
    name: "kubecost-prometheus-server",
    namespace: "kubecost",
    labels: { app: "prometheus", component: "server", release: "kubecost" },
  },
  spec: {
    selector: { app: "prometheus", component: "server", release: "kubecost" },
    ports: [{ name: "http", port: 80 }],
  },
};

const OPENCOST_SERVICE: KubernetesService = {
  metadata: {
    name: "opencost",
    namespace: "opencost",
    labels: {
      "app.kubernetes.io/instance": "opencost",
      "app.kubernetes.io/name": "opencost",
    },
  },
  spec: {
    selector: {
      "app.kubernetes.io/instance": "opencost",
      "app.kubernetes.io/name": "opencost",
    },
    ports: [
      { name: "http", port: 9003 },
      { name: "http-ui", port: 9090 },
    ],
  },
};

// OpenCost's chart writes the address on its container.
const OPENCOST_POD: KubernetesPod = {
  metadata: { name: "opencost-56bf4b4b4c-b8nm8", namespace: "opencost" },
  spec: {
    containers: [
      {
        name: "opencost",
        env: [
          { name: "PROMETHEUS_QUERY_RESOLUTION_SECONDS", value: "300" },
          {
            name: "PROMETHEUS_SERVER_ENDPOINT",
            value:
              "http://kubecost-prometheus-server.kubecost.svc.cluster.local:80",
          },
          { name: "CLUSTER_ID", value: "default-cluster" },
        ],
      },
      { name: "opencost-ui", env: [] },
    ],
  },
  status: { phase: "Running" },
};

const KUBECOST3_SERVICE: KubernetesService = {
  metadata: {
    name: "kubecost-frontend",
    namespace: "kubecost3",
    labels: {
      app: "kubecost",
      "app.kubernetes.io/instance": "kubecost",
      "app.kubernetes.io/name": "kubecost",
    },
  },
  spec: {
    selector: {
      app: "cost-analyzer",
      "app.kubernetes.io/instance": "kubecost",
      "app.kubernetes.io/name": "frontend",
    },
    ports: [{ name: "tcp-frontend", port: 9090 }],
  },
};

// Kubecost 3 reads no Prometheus: its frontend names none.
const KUBECOST3_POD: KubernetesPod = {
  metadata: {
    name: "kubecost-frontend-d5cb5c44b-4tvxg",
    namespace: "kubecost3",
  },
  spec: {
    containers: [
      { name: "frontend", env: [{ name: "GET_HOSTS_FROM", value: "dns" }] },
    ],
  },
  status: { phase: "Running" },
};

const KUBECOST2: PrometheusEngine = {
  url: "http://kubecost-cost-analyzer.kubecost.svc:9090",
  origin: "discovered",
  kind: "Kubecost",
  service: { name: "kubecost-cost-analyzer", namespace: "kubecost" },
};

const KUBECOST3: PrometheusEngine = {
  url: "http://kubecost-frontend.kubecost3.svc:9090",
  origin: "discovered",
  kind: "Kubecost",
  service: { name: "kubecost-frontend", namespace: "kubecost3" },
};

const OPENCOST: PrometheusEngine = {
  url: "http://opencost.opencost.svc:9003",
  origin: "discovered",
  kind: "OpenCost",
  service: { name: "opencost", namespace: "opencost" },
};

const BUNDLED: PrometheusEngine = {
  url: "http://agent-kubernetes-agent-opencost.oneuptime.svc.cluster.local:9003",
  origin: "bundled",
  kind: null,
  service: { name: "agent-kubernetes-agent-opencost", namespace: "oneuptime" },
};

const BUNDLED_PROMETHEUS: string =
  "http://agent-kubernetes-agent-cost-prometheus.oneuptime.svc.cluster.local:9090";

// What a Prometheus scraping cAdvisor answers the check with.
const cadvisor: (
  job: string,
  containers: number,
  labels?: Record<string, string>,
) => PrometheusVectorSample = (
  job: string,
  containers: number,
  labels?: Record<string, string>,
): PrometheusVectorSample => {
  return { metric: { job, ...(labels || {}) }, value: containers };
};

/*
 * A cluster's Services, pods and ConfigMaps, and its Prometheus servers'
 * answers to the check, each read recorded.
 */
class Cluster {
  public services: Array<KubernetesService> = [];
  public pods: Map<string, Array<KubernetesPod>> = new Map<
    string,
    Array<KubernetesPod>
  >();
  public configMaps: Map<string, KubernetesConfigMap> = new Map<
    string,
    KubernetesConfigMap
  >();
  public prometheus: Map<string, Array<PrometheusVectorSample> | Error> =
    new Map<string, Array<PrometheusVectorSample> | Error>();
  public serviceQueries: Array<ServiceQuery> = [];
  public podQueries: Array<PodQuery> = [];
  public configMapReads: Array<string> = [];
  public queries: Array<{ url: string; promql: string }> = [];
  public listError: Error | null = null;

  public static kubecost2(): Cluster {
    const cluster: Cluster = new Cluster();
    cluster.services = [KUBECOST2_SERVICE, KUBECOST2_PROMETHEUS_SERVICE];
    cluster.pods.set("kubecost", [KUBECOST2_POD]);
    cluster.configMaps.set(
      "kubecost/kubecost-cost-analyzer",
      KUBECOST2_CONFIGMAP,
    );
    cluster.prometheus.set("http://kubecost-prometheus-server.kubecost", [
      cadvisor("kubernetes-nodes-cadvisor", 27),
    ]);
    return cluster;
  }

  public static opencost(): Cluster {
    const cluster: Cluster = new Cluster();
    cluster.services = [OPENCOST_SERVICE];
    cluster.pods.set("opencost", [OPENCOST_POD]);
    cluster.prometheus.set(
      "http://kubecost-prometheus-server.kubecost.svc.cluster.local:80",
      [cadvisor("kubernetes-nodes-cadvisor", 27)],
    );
    return cluster;
  }

  public static kubecost3(): Cluster {
    const cluster: Cluster = new Cluster();
    cluster.services = [KUBECOST3_SERVICE];
    cluster.pods.set("kubecost3", [KUBECOST3_POD]);
    return cluster;
  }

  public kubernetes(): KubernetesReads {
    return {
      listServices: async (
        query: ServiceQuery,
      ): Promise<Array<KubernetesService>> => {
        this.serviceQueries.push(query);
        if (this.listError) {
          throw this.listError;
        }
        const fields: Map<string, string> = new Map<string, string>(
          (query.fieldSelector || "")
            .split(",")
            .filter(Boolean)
            .map((field: string): [string, string] => {
              const [key, value] = field.split("=");
              return [key || "", value || ""];
            }),
        );
        const labels: Array<[string, string]> = (query.labelSelector || "")
          .split(",")
          .filter(Boolean)
          .map((label: string): [string, string] => {
            const [key, value] = label.split("=");
            return [key || "", value || ""];
          });
        return this.services.filter((service: KubernetesService): boolean => {
          return (
            (!fields.has("metadata.name") ||
              service.metadata?.name === fields.get("metadata.name")) &&
            (!fields.has("metadata.namespace") ||
              service.metadata?.namespace ===
                fields.get("metadata.namespace")) &&
            labels.every(([key, value]: [string, string]): boolean => {
              return service.metadata?.labels?.[key] === value;
            })
          );
        });
      },
      listPods: async (query: PodQuery): Promise<Array<KubernetesPod>> => {
        this.podQueries.push(query);
        return this.pods.get(query.namespace) || [];
      },
      getConfigMap: async (
        namespace: string,
        name: string,
      ): Promise<KubernetesConfigMap | null> => {
        this.configMapReads.push(`${namespace}/${name}`);
        return this.configMaps.get(`${namespace}/${name}`) || null;
      },
    };
  }

  public query = async (
    url: string,
    promql: string,
  ): Promise<Array<PrometheusVectorSample>> => {
    this.queries.push({ url, promql });
    const answer: Array<PrometheusVectorSample> | Error | undefined =
      this.prometheus.get(url);
    if (!answer) {
      throw new Error(`connect ECONNREFUSED ${url}`);
    }
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  };

  public find(
    engine: PrometheusEngine,
    configuredJob?: string,
  ): Promise<FoundPrometheus> {
    return findEnginePrometheus({
      engine,
      kubernetes: this.kubernetes(),
      configuredJob: configuredJob || null,
      query: this.query,
    });
  }
}

// --- An address the agent can query -----------------------------------------

test("an http(s) address is read as it is, without a trailing slash", (): void => {
  assert.deepStrictEqual(
    normalizePrometheusUrl("http://kubecost-prometheus-server.kubecost"),
    { url: "http://kubecost-prometheus-server.kubecost" },
  );
  assert.deepStrictEqual(
    normalizePrometheusUrl(" https://mimir.monitoring.svc:8080/prometheus/ "),
    { url: "https://mimir.monitoring.svc:8080/prometheus" },
  );
});

test("an address with credentials is refused, and the reason never repeats them", (): void => {
  const normalized: { url: string } | { reason: string } =
    normalizePrometheusUrl("http://reader:s3cret@prometheus.monitoring:9090");

  assert.ok("reason" in normalized);
  assert.match(normalized.reason, /credentials/);
  assert.ok(!normalized.reason.includes("s3cret"));
});

test("anything else is refused with what is wrong with it", (): void => {
  for (const [raw, reason] of [
    ["", /empty/],
    ["prometheus-server:9090", /not an http/],
    ["tcp://prometheus:9090", /not an http/],
    ["not a url", /not a URL/],
    ["http://prometheus:9090/?tenant=a", /query string/],
    ["http://$(PROMETHEUS_HOST):9090", /other variables/],
  ] as Array<[string, RegExp]>) {
    const normalized: { url: string } | { reason: string } =
      normalizePrometheusUrl(raw);
    assert.ok("reason" in normalized, raw);
    assert.match(normalized.reason, reason, raw);
  }
});

test("an address is shown without its credentials", (): void => {
  assert.strictEqual(
    redactUrl("https://reader:s3cret@prometheus.example.com/prom/"),
    "https://prometheus.example.com/prom",
  );
  assert.strictEqual(
    redactUrl("http://kubecost-prometheus-server.kubecost"),
    "http://kubecost-prometheus-server.kubecost",
  );
});

test("a Service's selector is asked for as a label selector, in one order", (): void => {
  assert.strictEqual(
    toLabelSelector(KUBECOST2_SERVICE.spec!.selector),
    "app=cost-analyzer,app.kubernetes.io/instance=kubecost,app.kubernetes.io/name=cost-analyzer",
  );
  assert.strictEqual(toLabelSelector(undefined), "");
});

// --- What a container's environment sets ------------------------------------

const read: (
  container: NonNullable<
    NonNullable<KubernetesPod["spec"]>["containers"]
  >[number],
  configMaps?: Record<string, KubernetesConfigMap>,
) => Promise<unknown> = (
  container: NonNullable<
    NonNullable<KubernetesPod["spec"]>["containers"]
  >[number],
  configMaps?: Record<string, KubernetesConfigMap>,
): Promise<unknown> => {
  return readContainerVariable({
    namespace: "kubecost",
    container,
    name: "PROMETHEUS_SERVER_ENDPOINT",
    getConfigMap: async (
      namespace: string,
      name: string,
    ): Promise<KubernetesConfigMap | null> => {
      return (configMaps || {})[`${namespace}/${name}`] || null;
    },
  });
};

test("a value written on the container (OpenCost's chart)", async (): Promise<void> => {
  assert.deepStrictEqual(await read(OPENCOST_POD.spec!.containers![0]!), {
    status: "set",
    value: "http://kubecost-prometheus-server.kubecost.svc.cluster.local:80",
    from: "PROMETHEUS_SERVER_ENDPOINT of container opencost",
  });
});

test("a value from a ConfigMap (Kubecost 2's cost model)", async (): Promise<void> => {
  assert.deepStrictEqual(
    await read(KUBECOST2_POD.spec!.containers![0]!, {
      "kubecost/kubecost-cost-analyzer": KUBECOST2_CONFIGMAP,
    }),
    {
      status: "set",
      value: "http://kubecost-prometheus-server.kubecost",
      from: "PROMETHEUS_SERVER_ENDPOINT of container cost-model, from ConfigMap kubecost/kubecost-cost-analyzer",
    },
  );
});

test("a ConfigMap that is not there, or holds no such key, says so", async (): Promise<void> => {
  assert.deepStrictEqual(await read(KUBECOST2_POD.spec!.containers![0]!), {
    status: "unreadable",
    reason:
      "PROMETHEUS_SERVER_ENDPOINT comes from ConfigMap kubecost/kubecost-cost-analyzer, which has no prometheus-server-endpoint",
  });
});

test("a value from a Secret is never read, and says so", async (): Promise<void> => {
  let configMapReads: number = 0;

  const result: unknown = await readContainerVariable({
    namespace: "monitoring",
    container: {
      name: "opencost",
      env: [
        {
          name: "PROMETHEUS_SERVER_ENDPOINT",
          valueFrom: { secretKeyRef: { name: "prometheus-auth", key: "url" } },
        },
      ],
    },
    name: "PROMETHEUS_SERVER_ENDPOINT",
    getConfigMap: async (): Promise<KubernetesConfigMap | null> => {
      configMapReads++;
      return null;
    },
  });

  assert.deepStrictEqual(result, {
    status: "unreadable",
    reason:
      "PROMETHEUS_SERVER_ENDPOINT comes from Secret monitoring/prometheus-auth, which the agent does not read",
  });
  assert.strictEqual(configMapReads, 0);
});

test("a value from the pod's own fields is not read", async (): Promise<void> => {
  const result: unknown = await read({
    name: "opencost",
    env: [
      {
        name: "PROMETHEUS_SERVER_ENDPOINT",
        valueFrom: {} as never,
      },
    ],
  });

  assert.deepStrictEqual(result, {
    status: "unreadable",
    reason:
      "PROMETHEUS_SERVER_ENDPOINT comes from the pod's own fields, which the agent does not read",
  });
});

test("the last entry of a name wins, and an empty one is no address", async (): Promise<void> => {
  assert.deepStrictEqual(
    await read({
      name: "opencost",
      env: [
        { name: "PROMETHEUS_SERVER_ENDPOINT", value: "http://first:9090" },
        { name: "PROMETHEUS_SERVER_ENDPOINT", value: "http://second:9090" },
      ],
    }),
    {
      status: "set",
      value: "http://second:9090",
      from: "PROMETHEUS_SERVER_ENDPOINT of container opencost",
    },
  );
  assert.deepStrictEqual(
    await read({
      name: "opencost",
      env: [{ name: "PROMETHEUS_SERVER_ENDPOINT", value: "  " }],
    }),
    { status: "unset" },
  );
  assert.deepStrictEqual(await read({ name: "frontend" }), {
    status: "unset",
  });
});

test("every key of a ConfigMap as variables (envFrom), with its prefix", async (): Promise<void> => {
  const configMaps: Record<string, KubernetesConfigMap> = {
    "kubecost/engine-env": {
      data: { PROMETHEUS_SERVER_ENDPOINT: "http://from-env-from:9090" },
    },
    "kubecost/prefixed": {
      data: { SERVER_ENDPOINT: "http://from-prefix:9090" },
    },
  };

  assert.deepStrictEqual(
    await read(
      { name: "opencost", envFrom: [{ configMapRef: { name: "engine-env" } }] },
      configMaps,
    ),
    {
      status: "set",
      value: "http://from-env-from:9090",
      from: "PROMETHEUS_SERVER_ENDPOINT of container opencost, from ConfigMap kubecost/engine-env",
    },
  );
  assert.deepStrictEqual(
    await read(
      {
        name: "opencost",
        envFrom: [
          { prefix: "PROMETHEUS_", configMapRef: { name: "prefixed" } },
        ],
      },
      configMaps,
    ),
    {
      status: "set",
      value: "http://from-prefix:9090",
      from: "PROMETHEUS_SERVER_ENDPOINT of container opencost, from ConfigMap kubecost/prefixed",
    },
  );
});

test("an env entry wins over envFrom, as Kubernetes has it", async (): Promise<void> => {
  assert.deepStrictEqual(
    await read(
      {
        name: "opencost",
        env: [{ name: "PROMETHEUS_SERVER_ENDPOINT", value: "http://env:9090" }],
        envFrom: [{ configMapRef: { name: "engine-env" } }],
      },
      {
        "kubecost/engine-env": {
          data: { PROMETHEUS_SERVER_ENDPOINT: "http://env-from:9090" },
        },
      },
    ),
    {
      status: "set",
      value: "http://env:9090",
      from: "PROMETHEUS_SERVER_ENDPOINT of container opencost",
    },
  );
});

test("variables that may come from a Secret (envFrom) are named, not read", async (): Promise<void> => {
  assert.deepStrictEqual(
    await read({
      name: "opencost",
      envFrom: [{ secretRef: { name: "engine-secrets" } }],
    }),
    {
      status: "unreadable",
      reason:
        "the variables of container opencost may come from Secret kubecost/engine-secrets, which the agent does not read",
    },
  );
});

// --- Which addresses the engine's pods read ---------------------------------

test("OpenCost: the address its chart wrote on its pod, with its cluster's name", async (): Promise<void> => {
  const cluster: Cluster = Cluster.opencost();

  assert.deepStrictEqual(
    await enginePrometheusCandidates({
      engine: OPENCOST,
      kubernetes: cluster.kubernetes(),
    }),
    {
      candidates: [
        {
          url: "http://kubecost-prometheus-server.kubecost.svc.cluster.local:80",
          source:
            "PROMETHEUS_SERVER_ENDPOINT of container opencost of pod opencost/opencost-56bf4b4b4c-b8nm8",
          clusterLabel: "cluster_id",
          clusterId: "default-cluster",
        },
      ],
      reasons: [],
    },
  );

  // Its Service by name, then its pods by the Service's selector: no more.
  assert.deepStrictEqual(cluster.serviceQueries, [
    { fieldSelector: "metadata.name=opencost,metadata.namespace=opencost" },
  ]);
  assert.deepStrictEqual(cluster.podQueries, [
    {
      namespace: "opencost",
      labelSelector:
        "app.kubernetes.io/instance=opencost,app.kubernetes.io/name=opencost",
    },
  ]);
});

test("Kubecost 2: the address in its ConfigMap", async (): Promise<void> => {
  const cluster: Cluster = Cluster.kubecost2();

  const found: {
    candidates: Array<PrometheusCandidate>;
    reasons: Array<string>;
  } = await enginePrometheusCandidates({
    engine: KUBECOST2,
    kubernetes: cluster.kubernetes(),
  });

  assert.deepStrictEqual(
    found.candidates.map((candidate: PrometheusCandidate): string => {
      return candidate.url;
    }),
    ["http://kubecost-prometheus-server.kubecost"],
  );
  assert.match(
    found.candidates[0]!.source,
    /from ConfigMap kubecost\/kubecost-cost-analyzer/,
  );
  assert.ok(cluster.configMapReads.includes("kubecost/kubecost-cost-analyzer"));
});

test("Kubecost 3 names no Prometheus, and says it reads none", async (): Promise<void> => {
  const cluster: Cluster = Cluster.kubecost3();

  assert.deepStrictEqual(
    await enginePrometheusCandidates({
      engine: KUBECOST3,
      kubernetes: cluster.kubernetes(),
    }),
    {
      candidates: [],
      reasons: [
        "the pods of kubecost3/kubecost-frontend set no PROMETHEUS_SERVER_ENDPOINT (Kubecost 3 reads no Prometheus)",
      ],
    },
  );
});

test("an engine named by an address that is no Service has no pods to read", async (): Promise<void> => {
  const cluster: Cluster = Cluster.opencost();

  const found: {
    candidates: Array<PrometheusCandidate>;
    reasons: Array<string>;
  } = await enginePrometheusCandidates({
    engine: {
      url: "https://kubecost.example.com",
      origin: "configured",
      kind: "Kubecost",
      service: null,
    },
    kubernetes: cluster.kubernetes(),
  });

  assert.deepStrictEqual(found.candidates, []);
  assert.match(found.reasons[0]!, /names no Service in this cluster/);
  assert.deepStrictEqual(cluster.serviceQueries, []);
});

test("a Service that is gone, selects nothing, or has no pods says which", async (): Promise<void> => {
  const gone: Cluster = new Cluster();
  assert.deepStrictEqual(
    (
      await enginePrometheusCandidates({
        engine: OPENCOST,
        kubernetes: gone.kubernetes(),
      })
    ).reasons,
    ["there is no Service opencost/opencost"],
  );

  const noSelector: Cluster = new Cluster();
  noSelector.services = [
    { ...OPENCOST_SERVICE, spec: { ports: OPENCOST_SERVICE.spec!.ports! } },
  ];
  assert.deepStrictEqual(
    (
      await enginePrometheusCandidates({
        engine: OPENCOST,
        kubernetes: noSelector.kubernetes(),
      })
    ).reasons,
    ["Service opencost/opencost selects no pods, so it names no Prometheus"],
  );

  const noPods: Cluster = new Cluster();
  noPods.services = [OPENCOST_SERVICE];
  assert.deepStrictEqual(
    (
      await enginePrometheusCandidates({
        engine: OPENCOST,
        kubernetes: noPods.kubernetes(),
      })
    ).reasons,
    ["Service opencost/opencost has no pods"],
  );

  const refused: Cluster = Cluster.opencost();
  refused.listError = new Error("Kubernetes API answered HTTP 403");
  assert.deepStrictEqual(
    (
      await enginePrometheusCandidates({
        engine: OPENCOST,
        kubernetes: refused.kubernetes(),
      })
    ).reasons,
    [
      "could not read Service opencost/opencost: Kubernetes API answered HTTP 403",
    ],
  );
});

test("a running pod's address comes first, and one address is one candidate", async (): Promise<void> => {
  const cluster: Cluster = new Cluster();
  cluster.services = [OPENCOST_SERVICE];
  const pod: (name: string, phase: string, url: string) => KubernetesPod = (
    name: string,
    phase: string,
    url: string,
  ): KubernetesPod => {
    return {
      metadata: { name, namespace: "opencost" },
      spec: {
        containers: [
          {
            name: "opencost",
            env: [{ name: "PROMETHEUS_SERVER_ENDPOINT", value: url }],
          },
        ],
      },
      status: { phase },
    };
  };
  cluster.pods.set("opencost", [
    pod("opencost-a", "Pending", "http://new-prometheus:9090"),
    pod("opencost-b", "Running", "http://prometheus:9090"),
    pod("opencost-c", "Running", "http://prometheus:9090/"),
  ]);

  assert.deepStrictEqual(
    (
      await enginePrometheusCandidates({
        engine: OPENCOST,
        kubernetes: cluster.kubernetes(),
      })
    ).candidates.map((candidate: PrometheusCandidate): string => {
      return candidate.url;
    }),
    ["http://prometheus:9090", "http://new-prometheus:9090"],
  );
});

test("an address the agent cannot use is a reason, never repeated with its credentials", async (): Promise<void> => {
  const cluster: Cluster = new Cluster();
  cluster.services = [OPENCOST_SERVICE];
  cluster.pods.set("opencost", [
    {
      metadata: { name: "opencost-a", namespace: "opencost" },
      spec: {
        containers: [
          {
            name: "opencost",
            env: [
              {
                name: "PROMETHEUS_SERVER_ENDPOINT",
                value: "https://reader:s3cret@prometheus.example.com",
              },
            ],
          },
        ],
      },
    },
  ]);

  const found: {
    candidates: Array<PrometheusCandidate>;
    reasons: Array<string>;
  } = await enginePrometheusCandidates({
    engine: OPENCOST,
    kubernetes: cluster.kubernetes(),
  });

  assert.deepStrictEqual(found.candidates, []);
  assert.match(
    found.reasons[0]!,
    /pod opencost\/opencost-a: PROMETHEUS_SERVER_ENDPOINT carries credentials/,
  );
  assert.ok(!found.reasons.join(" ").includes("s3cret"));
});

test("the label and ID an OpenCost filters a shared Prometheus by are kept", async (): Promise<void> => {
  const cluster: Cluster = new Cluster();
  cluster.services = [OPENCOST_SERVICE];
  cluster.pods.set("opencost", [
    {
      metadata: { name: "opencost-a", namespace: "opencost" },
      spec: {
        containers: [
          {
            name: "opencost",
            env: [
              {
                name: "PROMETHEUS_SERVER_ENDPOINT",
                value: "http://thanos-query.monitoring:9090",
              },
              { name: "CLUSTER_ID", value: "prod-eu" },
              { name: "PROM_CLUSTER_ID_LABEL", value: "cluster" },
            ],
          },
        ],
      },
    },
  ]);

  const candidate: PrometheusCandidate = (
    await enginePrometheusCandidates({
      engine: OPENCOST,
      kubernetes: cluster.kubernetes(),
    })
  ).candidates[0]!;

  assert.strictEqual(candidate.clusterLabel, "cluster");
  assert.strictEqual(candidate.clusterId, "prod-eu");
});

// --- A Kubecost's own Prometheus Service ------------------------------------

test("Kubecost's Prometheus Service beside it, at its http port", async (): Promise<void> => {
  const cluster: Cluster = Cluster.kubecost2();

  const beside: {
    candidates: Array<PrometheusCandidate>;
    reasons: Array<string>;
  } = await kubecostPrometheusServices({
    engine: KUBECOST2,
    listServices: cluster.kubernetes().listServices,
  });

  assert.deepStrictEqual(beside, {
    candidates: [
      {
        url: "http://kubecost-prometheus-server.kubecost.svc:80",
        source:
          "Kubecost's Prometheus Service kubecost/kubecost-prometheus-server",
        clusterLabel: "cluster_id",
        clusterId: "",
      },
    ],
    reasons: [],
  });
  // Only in the engine's namespace, by the community chart's labels.
  assert.deepStrictEqual(cluster.serviceQueries, [
    {
      labelSelector: "app=prometheus,component=server",
      fieldSelector: "metadata.namespace=kubecost",
    },
    {
      labelSelector:
        "app.kubernetes.io/name=prometheus,app.kubernetes.io/component=server",
      fieldSelector: "metadata.namespace=kubecost",
    },
  ]);
});

test("no Prometheus Service is looked for beside an OpenCost", async (): Promise<void> => {
  const cluster: Cluster = Cluster.kubecost2();

  assert.deepStrictEqual(
    await kubecostPrometheusServices({
      engine: OPENCOST,
      listServices: cluster.kubernetes().listServices,
    }),
    { candidates: [], reasons: [] },
  );
  assert.deepStrictEqual(cluster.serviceQueries, []);
});

// --- Which cAdvisor series the peaks are read from --------------------------

test("the check asks for cAdvisor's memory series by job and cluster", (): void => {
  assert.strictEqual(
    cadvisorSeriesQuery("cluster_id"),
    'count by (job, cluster_id) (container_memory_working_set_bytes{container!="",container!="POD"})',
  );
});

const choose: (
  counts: Array<CadvisorSeriesCount>,
  options?: { configuredJob?: string; clusterId?: string },
) => unknown = (
  counts: Array<CadvisorSeriesCount>,
  options?: { configuredJob?: string; clusterId?: string },
): unknown => {
  return chooseCadvisorSeries({
    counts,
    configuredJob: options?.configuredJob || null,
    clusterLabel: "cluster_id",
    clusterId: options?.clusterId || "",
  });
};

test("kubernetes-nodes-cadvisor, as Kubecost's and the community chart's Prometheus name it", (): void => {
  assert.deepStrictEqual(
    choose([
      { job: "kubelet", cluster: "", containers: 3 },
      { job: "kubernetes-nodes-cadvisor", cluster: "", containers: 27 },
    ]),
    {
      ok: true,
      job: "kubernetes-nodes-cadvisor",
      cluster: null,
      containers: 27,
    },
  );
});

test("kube-prometheus-stack's kubelet job, when that is the one with the series", (): void => {
  assert.deepStrictEqual(
    choose([{ job: "kubelet", cluster: "", containers: 41 }]),
    {
      ok: true,
      job: "kubelet",
      cluster: null,
      containers: 41,
    },
  );
  assert.deepStrictEqual(
    choose([
      { job: "kubelet", cluster: "", containers: 41 },
      { job: "federate", cluster: "", containers: 3 },
    ]),
    { ok: true, job: "kubelet", cluster: null, containers: 41 },
  );
});

test("the job cost.engine.prometheusCadvisorJob names, and only that one", (): void => {
  assert.deepStrictEqual(
    choose(
      [
        { job: "kubernetes-nodes-cadvisor", cluster: "", containers: 27 },
        { job: "cadvisor", cluster: "", containers: 27 },
      ],
      { configuredJob: "cadvisor" },
    ),
    { ok: true, job: "cadvisor", cluster: null, containers: 27 },
  );
  assert.deepStrictEqual(
    choose([{ job: "kubelet", cluster: "", containers: 41 }], {
      configuredJob: "cadvisor",
    }),
    {
      ok: false,
      reason:
        "has no cAdvisor memory series under job cadvisor (cost.engine.prometheusCadvisorJob), only under kubelet",
    },
  );
});

test("a Prometheus with no cAdvisor memory series is not one to read peaks from", (): void => {
  for (const counts of [
    [],
    [{ job: "kubelet", cluster: "", containers: 0 }],
    [{ job: "kubelet", cluster: "", containers: NaN }],
  ]) {
    assert.deepStrictEqual(choose(counts), {
      ok: false,
      reason:
        "has no cAdvisor memory series (container_memory_working_set_bytes) to read peaks from",
    });
  }
});

test("a Prometheus of several clusters is read for this one alone", (): void => {
  assert.deepStrictEqual(
    choose(
      [
        {
          job: "kubernetes-nodes-cadvisor",
          cluster: "prod-eu",
          containers: 120,
        },
        {
          job: "kubernetes-nodes-cadvisor",
          cluster: "prod-us",
          containers: 80,
        },
      ],
      { clusterId: "prod-us" },
    ),
    {
      ok: true,
      job: "kubernetes-nodes-cadvisor",
      cluster: { label: "cluster_id", value: "prod-us" },
      containers: 80,
    },
  );
});

test("never one whose clusters cannot be told apart", (): void => {
  assert.deepStrictEqual(
    choose(
      [
        {
          job: "kubernetes-nodes-cadvisor",
          cluster: "prod-eu",
          containers: 120,
        },
        {
          job: "kubernetes-nodes-cadvisor",
          cluster: "prod-us",
          containers: 80,
        },
      ],
      { clusterId: "default-cluster" },
    ),
    {
      ok: false,
      reason:
        "holds the cAdvisor series of 2 clusters (cluster_id: prod-eu, prod-us), and none of them is this one (default-cluster), so its peaks would mix clusters",
    },
  );
  assert.deepStrictEqual(
    choose([
      { job: "kubernetes-nodes-cadvisor", cluster: "prod-eu", containers: 120 },
      { job: "kubernetes-nodes-cadvisor", cluster: "prod-us", containers: 80 },
    ]),
    {
      ok: false,
      reason:
        "holds the cAdvisor series of 2 clusters (cluster_id: prod-eu, prod-us), and the engine does not say which is this one, so its peaks would mix clusters",
    },
  );
});

test("one cluster's name on the series, or none, needs no filter", (): void => {
  assert.deepStrictEqual(
    choose([
      { job: "kubernetes-nodes-cadvisor", cluster: "prod-eu", containers: 120 },
      { job: "kubernetes-nodes-cadvisor", cluster: "", containers: 3 },
    ]),
    {
      ok: true,
      job: "kubernetes-nodes-cadvisor",
      cluster: null,
      containers: 123,
    },
  );
});

test("a label value is quoted for PromQL", (): void => {
  assert.strictEqual(promqlString('a"b\\c'), '"a\\"b\\\\c"');
});

// --- The engine's own Prometheus, end to end --------------------------------

test("OpenCost: the Prometheus it reads, once it answers for cAdvisor", async (): Promise<void> => {
  const cluster: Cluster = Cluster.opencost();

  const found: FoundPrometheus = await cluster.find(OPENCOST);

  assert.deepStrictEqual(found, {
    prometheus: {
      url: "http://kubecost-prometheus-server.kubecost.svc.cluster.local:80",
      origin: "engine",
      source:
        "PROMETHEUS_SERVER_ENDPOINT of container opencost of pod opencost/opencost-56bf4b4b4c-b8nm8",
      cadvisorJob: "kubernetes-nodes-cadvisor",
      cluster: null,
      note: "",
    },
    reasons: [],
  });
  assert.deepStrictEqual(cluster.queries, [
    {
      url: "http://kubecost-prometheus-server.kubecost.svc.cluster.local:80",
      promql: cadvisorSeriesQuery("cluster_id"),
    },
  ]);
});

test("Kubecost 2: the Prometheus it bundles, read off its ConfigMap", async (): Promise<void> => {
  const cluster: Cluster = Cluster.kubecost2();

  const found: FoundPrometheus = await cluster.find(KUBECOST2);

  assert.strictEqual(
    found.prometheus?.url,
    "http://kubecost-prometheus-server.kubecost",
  );
  assert.strictEqual(found.prometheus?.origin, "engine");
  assert.strictEqual(
    found.prometheus?.cadvisorJob,
    "kubernetes-nodes-cadvisor",
  );
});

test("Kubecost 2 whose pods name no answering Prometheus: its Prometheus Service", async (): Promise<void> => {
  const cluster: Cluster = Cluster.kubecost2();
  cluster.prometheus.delete("http://kubecost-prometheus-server.kubecost");
  cluster.prometheus.set("http://kubecost-prometheus-server.kubecost.svc:80", [
    cadvisor("kubernetes-nodes-cadvisor", 27),
  ]);

  const found: FoundPrometheus = await cluster.find(KUBECOST2);

  assert.strictEqual(
    found.prometheus?.url,
    "http://kubecost-prometheus-server.kubecost.svc:80",
  );
  assert.strictEqual(
    found.prometheus?.source,
    "Kubecost's Prometheus Service kubecost/kubecost-prometheus-server",
  );
});

test("Kubecost 3: no Prometheus, and every reason", async (): Promise<void> => {
  const cluster: Cluster = Cluster.kubecost3();

  assert.deepStrictEqual(await cluster.find(KUBECOST3), {
    prometheus: null,
    reasons: [
      "the pods of kubecost3/kubecost-frontend set no PROMETHEUS_SERVER_ENDPOINT (Kubecost 3 reads no Prometheus)",
      "no Kubecost Prometheus Service in namespace kubecost3",
    ],
  });
  assert.deepStrictEqual(cluster.queries, []);
});

test("an engine's Prometheus that does not answer, or has no cAdvisor series, is passed over with why", async (): Promise<void> => {
  const down: Cluster = Cluster.opencost();
  down.prometheus.clear();

  const notAnswering: FoundPrometheus = await down.find(OPENCOST);
  assert.strictEqual(notAnswering.prometheus, null);
  assert.match(
    notAnswering.reasons.join("; "),
    /kubecost-prometheus-server\.kubecost\.svc\.cluster\.local:80 \(PROMETHEUS_SERVER_ENDPOINT of container opencost of pod opencost\/opencost-56bf4b4b4c-b8nm8\) connect ECONNREFUSED/,
  );

  const empty: Cluster = Cluster.opencost();
  empty.prometheus.set(
    "http://kubecost-prometheus-server.kubecost.svc.cluster.local:80",
    [],
  );

  const noSeries: FoundPrometheus = await empty.find(OPENCOST);
  assert.strictEqual(noSeries.prometheus, null);
  assert.match(noSeries.reasons.join("; "), /has no cAdvisor memory series/);
});

test("an OpenCost of a shared Prometheus reads this cluster's series alone", async (): Promise<void> => {
  const cluster: Cluster = new Cluster();
  cluster.services = [OPENCOST_SERVICE];
  cluster.pods.set("opencost", [
    {
      metadata: { name: "opencost-a", namespace: "opencost" },
      spec: {
        containers: [
          {
            name: "opencost",
            env: [
              {
                name: "PROMETHEUS_SERVER_ENDPOINT",
                value: "http://thanos-query.monitoring:9090",
              },
              { name: "CLUSTER_ID", value: "prod-eu" },
            ],
          },
        ],
      },
    },
  ]);
  cluster.prometheus.set("http://thanos-query.monitoring:9090", [
    cadvisor("kubernetes-nodes-cadvisor", 120, { cluster_id: "prod-eu" }),
    cadvisor("kubernetes-nodes-cadvisor", 80, { cluster_id: "prod-us" }),
  ]);

  const found: FoundPrometheus = await cluster.find(OPENCOST);

  assert.deepStrictEqual(found.prometheus?.cluster, {
    label: "cluster_id",
    value: "prod-eu",
  });
});

// --- Which Prometheus, as the engine in use changes -------------------------

class Agent {
  public engine: PrometheusEngine | null;
  public nowMs: number = Date.parse("2026-11-19T12:00:00Z");
  public cluster: Cluster;
  public target: CostPrometheusTarget;

  public constructor(options: {
    cluster: Cluster;
    engine: PrometheusEngine | null;
    prometheusUrl?: string;
    prometheusUrlIsBundled?: boolean;
    configuredJob?: string;
  }) {
    this.cluster = options.cluster;
    this.engine = options.engine;
    this.target = new CostPrometheusTarget({
      prometheusUrl: options.prometheusUrl || "",
      prometheusUrlIsBundled: options.prometheusUrlIsBundled || false,
      configuredJob: options.configuredJob || null,
      engine: (): PrometheusEngine | null => {
        return this.engine;
      },
      kubernetes: this.cluster.kubernetes(),
      query: this.cluster.query,
      now: (): number => {
        return this.nowMs;
      },
      retryMs: 10 * 60 * 1000,
      refreshMs: 60 * 60 * 1000,
    });
  }
}

test("the bundled engine reads the chart's bundled Prometheus, unchecked", async (): Promise<void> => {
  const agent: Agent = new Agent({
    cluster: new Cluster(),
    engine: BUNDLED,
    prometheusUrl: BUNDLED_PROMETHEUS,
    prometheusUrlIsBundled: true,
  });

  await agent.target.refreshIfDue();

  assert.deepStrictEqual(agent.target.current(), {
    url: BUNDLED_PROMETHEUS,
    origin: "bundled",
    source: "the chart's bundled Prometheus",
    cadvisorJob: "kubernetes-nodes-cadvisor",
    cluster: null,
    note: "",
  });
  assert.deepStrictEqual(agent.cluster.queries, []);
});

test("the cluster's own engine reads its own Prometheus, the bundled one standing by", async (): Promise<void> => {
  const agent: Agent = new Agent({
    cluster: Cluster.opencost(),
    engine: OPENCOST,
    prometheusUrl: BUNDLED_PROMETHEUS,
    prometheusUrlIsBundled: true,
  });

  await agent.target.refreshIfDue();

  assert.strictEqual(
    agent.target.current()?.url,
    "http://kubecost-prometheus-server.kubecost.svc.cluster.local:80",
  );
  assert.strictEqual(agent.target.current()?.origin, "engine");
});

test("a Kubecost 3 beside the bundled engine keeps its peaks from the bundled Prometheus, and says why", async (): Promise<void> => {
  const agent: Agent = new Agent({
    cluster: Cluster.kubecost3(),
    engine: KUBECOST3,
    prometheusUrl: BUNDLED_PROMETHEUS,
    prometheusUrlIsBundled: true,
  });

  await agent.target.refreshIfDue();

  const current: CostPrometheus | null = agent.target.current();
  assert.strictEqual(current?.url, BUNDLED_PROMETHEUS);
  assert.strictEqual(current?.origin, "bundled");
  assert.match(
    current?.note || "",
    /the engine's own Prometheus was not found \(.*Kubecost 3 reads no Prometheus/,
  );
});

test("with nothing bundled, a Kubecost 3 has no Prometheus, and the agent says why plainly", async (): Promise<void> => {
  const agent: Agent = new Agent({
    cluster: Cluster.kubecost3(),
    engine: KUBECOST3,
  });

  await agent.target.refreshIfDue();

  assert.strictEqual(agent.target.current(), null);
  assert.strictEqual(
    agent.target.reason(),
    "the pods of kubecost3/kubecost-frontend set no PROMETHEUS_SERVER_ENDPOINT (Kubecost 3 reads no Prometheus); no Kubecost Prometheus Service in namespace kubecost3",
  );
});

test("cost.engine.prometheusUrl is read whatever the engine, its job read off it", async (): Promise<void> => {
  const cluster: Cluster = Cluster.kubecost3();
  cluster.prometheus.set("http://prometheus.monitoring:9090", [
    cadvisor("kubelet", 41),
  ]);
  const agent: Agent = new Agent({
    cluster,
    engine: KUBECOST3,
    prometheusUrl: "http://prometheus.monitoring:9090/",
  });

  // Named, so used from the start, before any look.
  assert.strictEqual(
    agent.target.current()?.url,
    "http://prometheus.monitoring:9090",
  );

  await agent.target.refreshIfDue();

  assert.deepStrictEqual(agent.target.current(), {
    url: "http://prometheus.monitoring:9090",
    origin: "configured",
    source: "cost.engine.prometheusUrl",
    cadvisorJob: "kubelet",
    cluster: null,
    note: "",
  });
  // Nothing of the engine's own is looked for.
  assert.deepStrictEqual(cluster.podQueries, []);
});

test("cost.engine.prometheusUrl that cannot be checked is still read, at the default job, and says why", async (): Promise<void> => {
  const agent: Agent = new Agent({
    cluster: new Cluster(),
    engine: OPENCOST,
    prometheusUrl: "http://prometheus.monitoring:9090",
  });

  await agent.target.refreshIfDue();

  const current: CostPrometheus | null = agent.target.current();
  assert.strictEqual(current?.url, "http://prometheus.monitoring:9090");
  assert.strictEqual(current?.cadvisorJob, "kubernetes-nodes-cadvisor");
  assert.match(current?.note || "", /ECONNREFUSED/);
  assert.strictEqual(agent.target.reason(), "");
});

test("no engine yet (auto, before one is found): no Prometheus", async (): Promise<void> => {
  const agent: Agent = new Agent({ cluster: new Cluster(), engine: null });

  await agent.target.refreshIfDue();

  assert.strictEqual(agent.target.current(), null);
  assert.strictEqual(agent.target.reason(), "no cost engine is in use yet");
});

test("a found Prometheus is checked again hourly, a missing one every ten minutes", async (): Promise<void> => {
  const cluster: Cluster = Cluster.opencost();
  const agent: Agent = new Agent({ cluster, engine: OPENCOST });

  await agent.target.refreshIfDue();
  assert.strictEqual(cluster.queries.length, 1);

  agent.nowMs += 30 * 60 * 1000;
  await agent.target.refreshIfDue();
  assert.strictEqual(cluster.queries.length, 1);

  agent.nowMs += 31 * 60 * 1000;
  await agent.target.refreshIfDue();
  assert.strictEqual(cluster.queries.length, 2);

  const missing: Cluster = Cluster.kubecost3();
  const other: Agent = new Agent({ cluster: missing, engine: KUBECOST3 });
  await other.target.refreshIfDue();
  const reads: number = missing.podQueries.length;

  other.nowMs += 5 * 60 * 1000;
  await other.target.refreshIfDue();
  assert.strictEqual(missing.podQueries.length, reads);

  other.nowMs += 6 * 60 * 1000;
  await other.target.refreshIfDue();
  assert.strictEqual(missing.podQueries.length, reads + 1);
});

test("a new engine is looked at at once, and the old one's Prometheus is never read for it", async (): Promise<void> => {
  const cluster: Cluster = Cluster.opencost();
  cluster.services.push(KUBECOST2_SERVICE, KUBECOST2_PROMETHEUS_SERVICE);
  cluster.pods.set("kubecost", [KUBECOST2_POD]);
  cluster.configMaps.set(
    "kubecost/kubecost-cost-analyzer",
    KUBECOST2_CONFIGMAP,
  );
  cluster.prometheus.set("http://kubecost-prometheus-server.kubecost", [
    cadvisor("kubernetes-nodes-cadvisor", 27),
  ]);
  const agent: Agent = new Agent({ cluster, engine: OPENCOST });

  await agent.target.refreshIfDue();
  assert.strictEqual(
    agent.target.current()?.url,
    "http://kubecost-prometheus-server.kubecost.svc.cluster.local:80",
  );

  agent.engine = KUBECOST2;
  // Until it is looked at, nothing: not OpenCost's Prometheus.
  assert.strictEqual(agent.target.current(), null);

  await agent.target.refreshIfDue();
  assert.strictEqual(
    agent.target.current()?.url,
    "http://kubecost-prometheus-server.kubecost",
  );
});

test("the engine's Prometheus that stops answering for a moment is kept, and looked at again soon", async (): Promise<void> => {
  const cluster: Cluster = Cluster.opencost();
  const agent: Agent = new Agent({
    cluster,
    engine: OPENCOST,
    prometheusUrl: BUNDLED_PROMETHEUS,
    prometheusUrlIsBundled: true,
  });
  const url: string =
    "http://kubecost-prometheus-server.kubecost.svc.cluster.local:80";

  await agent.target.refreshIfDue();
  assert.strictEqual(agent.target.current()?.url, url);

  // An hour on, it is restarting: kept, not swapped for the bundled one.
  cluster.prometheus.set(url, new Error("connect ECONNREFUSED"));
  agent.nowMs += 61 * 60 * 1000;
  await agent.target.refreshIfDue();

  assert.strictEqual(agent.target.current()?.url, url);
  assert.strictEqual(agent.target.current()?.origin, "engine");
  assert.match(agent.target.current()?.note || "", /its last check failed/);

  // Back: looked at again within ten minutes, and the note goes.
  cluster.prometheus.set(url, [cadvisor("kubernetes-nodes-cadvisor", 27)]);
  agent.nowMs += 11 * 60 * 1000;
  await agent.target.refreshIfDue();

  assert.strictEqual(agent.target.current()?.url, url);
  assert.strictEqual(agent.target.current()?.note, "");
});

test("one look at a time, however often it is asked", async (): Promise<void> => {
  const cluster: Cluster = Cluster.opencost();
  const agent: Agent = new Agent({ cluster, engine: OPENCOST });

  await Promise.all([
    agent.target.refreshIfDue(),
    agent.target.refreshIfDue(),
    agent.target.refreshIfDue(),
  ]);

  assert.strictEqual(cluster.podQueries.length, 1);
  assert.strictEqual(cluster.queries.length, 1);
});

test("a look that throws is a reason, not a crash", async (): Promise<void> => {
  const agent: Agent = new Agent({
    cluster: new Cluster(),
    engine: OPENCOST,
  });
  // The Kubernetes reads themselves throw.
  (agent.target as unknown as { kubernetes: KubernetesReads }).kubernetes = {
    listServices: async (): Promise<Array<KubernetesService>> => {
      throw new Error("socket hang up");
    },
    listPods: async (): Promise<Array<KubernetesPod>> => {
      throw new Error("socket hang up");
    },
    getConfigMap: async (): Promise<KubernetesConfigMap | null> => {
      throw new Error("socket hang up");
    },
  };

  await agent.target.refreshIfDue();

  assert.strictEqual(agent.target.current(), null);
  assert.match(
    agent.target.reason(),
    /could not read Service opencost\/opencost: socket hang up/,
  );
});
