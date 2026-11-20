import "./TestEnv";
import * as assert from "assert";
import { test } from "node:test";
import {
  ENGINE_SERVICE_QUERIES,
  EngineCandidate,
  discoverEngineCandidates,
  engineKindOfService,
  normalizeEngineHost,
  rankEngineCandidates,
  toEngineCandidate,
} from "../EngineDiscovery";
import { KubernetesService, ServiceQuery } from "../KubernetesApi";

/*
 * #9633: a cluster that already runs Kubecost or OpenCost is read from that
 * engine instead of a second one the chart bundles. These are the Services
 * the engines' own charts and manifests create, as the API returns them.
 */

const KUBECOST_2: KubernetesService = {
  metadata: {
    name: "kubecost-cost-analyzer",
    namespace: "kubecost",
    labels: {
      app: "cost-analyzer",
      "app.kubernetes.io/name": "cost-analyzer",
      "app.kubernetes.io/instance": "kubecost",
    },
  },
  spec: {
    selector: { app: "cost-analyzer" },
    ports: [
      { name: "tcp-model", port: 9003 },
      { name: "tcp-frontend", port: 9090 },
    ],
  },
};

const KUBECOST_3_FRONTEND: KubernetesService = {
  metadata: {
    name: "kubecost-frontend",
    namespace: "kubecost",
    labels: { app: "kubecost", "app.kubernetes.io/name": "kubecost" },
  },
  spec: {
    selector: { app: "cost-analyzer" },
    ports: [{ name: "tcp-frontend", port: 9090 }],
  },
};

// Kubecost 3's aggregator carries the same labels, and no frontend port.
const KUBECOST_3_AGGREGATOR: KubernetesService = {
  metadata: {
    name: "kubecost-aggregator",
    namespace: "kubecost",
    labels: { app: "kubecost", "app.kubernetes.io/name": "kubecost" },
  },
  spec: { ports: [{ name: "tcp-api", port: 9004 }] },
};

const OPENCOST_CHART: KubernetesService = {
  metadata: {
    name: "opencost",
    namespace: "opencost",
    labels: {
      "app.kubernetes.io/name": "opencost",
      "app.kubernetes.io/instance": "opencost",
    },
  },
  spec: {
    selector: { "app.kubernetes.io/name": "opencost" },
    ports: [
      { name: "http", port: 9003 },
      { name: "http-ui", port: 9090 },
    ],
  },
};

// OpenCost's plain manifest: no labels on the Service at all.
const OPENCOST_MANIFEST: KubernetesService = {
  metadata: { name: "opencost", namespace: "opencost" },
  spec: {
    selector: { app: "opencost" },
    ports: [
      { name: "opencost", port: 9003 },
      { name: "opencost-ui", port: 9090 },
    ],
  },
};

// This agent's own bundled OpenCost, or another OneUptime install's.
const ONEUPTIME_BUNDLED: KubernetesService = {
  metadata: {
    name: "oneuptime-agent-kubernetes-agent-opencost",
    namespace: "oneuptime",
    labels: {
      "app.kubernetes.io/name": "opencost",
      "app.kubernetes.io/part-of": "oneuptime",
      component: "opencost",
    },
  },
  spec: { ports: [{ name: "http", port: 9003 }] },
};

test("finds Kubecost 2 by its cost-analyzer labels, at its frontend port", (): void => {
  assert.deepStrictEqual(toEngineCandidate(KUBECOST_2), {
    kind: "Kubecost",
    namespace: "kubecost",
    name: "kubecost-cost-analyzer",
    url: "http://kubecost-cost-analyzer.kubecost.svc:9090",
  });
});

test("finds Kubecost 3 by its frontend Service, and not by its aggregator", (): void => {
  assert.deepStrictEqual(toEngineCandidate(KUBECOST_3_FRONTEND), {
    kind: "Kubecost",
    namespace: "kubecost",
    name: "kubecost-frontend",
    url: "http://kubecost-frontend.kubecost.svc:9090",
  });
  assert.strictEqual(toEngineCandidate(KUBECOST_3_AGGREGATOR), null);
});

test("finds OpenCost from its chart, at its API port rather than its UI's", (): void => {
  assert.deepStrictEqual(toEngineCandidate(OPENCOST_CHART), {
    kind: "OpenCost",
    namespace: "opencost",
    name: "opencost",
    url: "http://opencost.opencost.svc:9003",
  });
});

test("finds OpenCost from its plain manifest, whose Service has no labels", (): void => {
  assert.deepStrictEqual(toEngineCandidate(OPENCOST_MANIFEST), {
    kind: "OpenCost",
    namespace: "opencost",
    name: "opencost",
    url: "http://opencost.opencost.svc:9003",
  });
});

test("finds an OpenCost by its selector alone, wherever it is installed", (): void => {
  assert.deepStrictEqual(
    toEngineCandidate({
      metadata: { name: "cost-api", namespace: "monitoring" },
      spec: {
        selector: { app: "opencost" },
        ports: [{ name: "api", port: 9003 }],
      },
    }),
    {
      kind: "OpenCost",
      namespace: "monitoring",
      name: "cost-api",
      url: "http://cost-api.monitoring.svc:9003",
    },
  );
});

test("takes an OpenCost API port by its name when it is not 9003", (): void => {
  assert.strictEqual(
    toEngineCandidate({
      metadata: {
        name: "opencost",
        namespace: "opencost",
        labels: { "app.kubernetes.io/name": "opencost" },
      },
      spec: { ports: [{ name: "http", port: 8080 }] },
    })?.url,
    "http://opencost.opencost.svc:8080",
  );
});

test("never takes a OneUptime agent's bundled OpenCost for the cluster's own", (): void => {
  assert.strictEqual(toEngineCandidate(ONEUPTIME_BUNDLED), null);
});

test("passes over a Service with no API port, or a name no URL can carry", (): void => {
  assert.strictEqual(
    toEngineCandidate({
      metadata: {
        name: "opencost",
        namespace: "opencost",
        labels: { "app.kubernetes.io/name": "opencost" },
      },
      spec: { ports: [{ name: "http-ui", port: 9090 }] },
    }),
    null,
  );
  assert.strictEqual(
    toEngineCandidate({
      metadata: {
        name: "opencost/../evil",
        namespace: "opencost",
        labels: { app: "opencost" },
      },
      spec: { ports: [{ port: 9003 }] },
    }),
    null,
  );
  assert.strictEqual(toEngineCandidate({}), null);
});

test("ranks Kubecost before OpenCost, then by namespace and name", (): void => {
  const ranked: Array<EngineCandidate> = rankEngineCandidates([
    toEngineCandidate(OPENCOST_CHART)!,
    {
      kind: "OpenCost",
      namespace: "a-team",
      name: "opencost",
      url: "http://opencost.a-team.svc:9003",
    },
    toEngineCandidate(KUBECOST_2)!,
  ]);

  assert.deepStrictEqual(
    ranked.map((candidate: EngineCandidate): string => {
      return `${candidate.kind} ${candidate.namespace}/${candidate.name}`;
    }),
    [
      "Kubecost kubecost/kubecost-cost-analyzer",
      "OpenCost a-team/opencost",
      "OpenCost opencost/opencost",
    ],
  );
});

test("asks only for the engines' labels and the manifest's name, never for every Service", (): void => {
  assert.deepStrictEqual(ENGINE_SERVICE_QUERIES, [
    {
      labelSelector:
        "app.kubernetes.io/name in (opencost,cost-analyzer,kubecost)",
    },
    { labelSelector: "app in (opencost,cost-analyzer,kubecost)" },
    { fieldSelector: "metadata.name=opencost" },
  ]);

  for (const query of ENGINE_SERVICE_QUERIES) {
    assert.ok(query.labelSelector || query.fieldSelector);
  }
});

test("merges the reads, one candidate per Service, and leaves the bundled engine out", async (): Promise<void> => {
  const reads: Array<ServiceQuery> = [];

  const candidates: Array<EngineCandidate> = await discoverEngineCandidates({
    listServices: async (
      query: ServiceQuery,
    ): Promise<Array<KubernetesService>> => {
      reads.push(query);
      // Every read returns OpenCost; the label reads Kubecost too.
      return query.labelSelector
        ? [KUBECOST_2, OPENCOST_CHART, ONEUPTIME_BUNDLED]
        : [OPENCOST_MANIFEST];
    },
    excludeUrls: [
      "http://oneuptime-agent-kubernetes-agent-opencost.oneuptime.svc.cluster.local:9003",
    ],
  });

  assert.strictEqual(reads.length, 3);
  assert.deepStrictEqual(
    candidates.map((candidate: EngineCandidate): string => {
      return candidate.url;
    }),
    [
      "http://kubecost-cost-analyzer.kubecost.svc:9090",
      "http://opencost.opencost.svc:9003",
    ],
  );
});

test("leaves out an engine at the URL the agent would fall back to, however it is spelled", async (): Promise<void> => {
  const candidates: Array<EngineCandidate> = await discoverEngineCandidates({
    listServices: async (): Promise<Array<KubernetesService>> => {
      return [OPENCOST_CHART];
    },
    excludeUrls: ["http://opencost.opencost.svc.cluster.local:9003/"],
  });

  assert.deepStrictEqual(candidates, []);
});

test("a read that fails fails the discovery, for the caller to decide", async (): Promise<void> => {
  await assert.rejects(
    discoverEngineCandidates({
      listServices: async (): Promise<Array<KubernetesService>> => {
        throw new Error("Kubernetes API answered HTTP 403");
      },
    }),
    /HTTP 403/,
  );
});

test("normalizeEngineHost reads a Service's name and namespace off any spelling of its URL", (): void => {
  assert.strictEqual(
    normalizeEngineHost("http://opencost.opencost.svc:9003"),
    "opencost.opencost",
  );
  assert.strictEqual(
    normalizeEngineHost("HTTP://OpenCost.OpenCost.svc.cluster.local:9003/x"),
    "opencost.opencost",
  );
  // An address is compared whole, never as a name.
  assert.strictEqual(normalizeEngineHost("http://10.0.1.5:9003"), "10.0.1.5");
});

/*
 * #9776: which engine a URL reaches, whichever of its Services it names, so
 * a Kubecost cost model or an OpenCost UI named in cost.engine.url is called
 * what it is.
 */
test("engineKindOfService names the engine of every Service its chart labels", (): void => {
  assert.strictEqual(engineKindOfService(KUBECOST_2), "Kubecost");
  assert.strictEqual(engineKindOfService(KUBECOST_3_FRONTEND), "Kubecost");
  // Labelled as Kubecost, without a frontend port discovery would read.
  assert.strictEqual(engineKindOfService(KUBECOST_3_AGGREGATOR), "Kubecost");
  assert.strictEqual(engineKindOfService(OPENCOST_CHART), "OpenCost");
  assert.strictEqual(engineKindOfService(OPENCOST_MANIFEST), "OpenCost");
});

test("engineKindOfService does not care which port the URL names", (): void => {
  // Kubecost 2's Service with its cost model port only.
  assert.strictEqual(
    engineKindOfService({
      ...KUBECOST_2,
      spec: { ports: [{ name: "tcp-model", port: 9003 }] },
    }),
    "Kubecost",
  );
  // OpenCost's UI port, which discovery never reads allocations from.
  assert.strictEqual(
    engineKindOfService({
      ...OPENCOST_CHART,
      spec: { ports: [{ name: "http-ui", port: 9090 }] },
    }),
    "OpenCost",
  );
});

test("engineKindOfService names no engine for a Service no engine's chart labels so", (): void => {
  // Kubecost 3.3.2's aggregator, as its chart labels it on a cluster.
  assert.strictEqual(
    engineKindOfService({
      metadata: {
        name: "kubecost-aggregator",
        namespace: "kubecost",
        labels: {
          app: "aggregator",
          "app.kubernetes.io/instance": "kubecost",
          "app.kubernetes.io/name": "aggregator",
        },
      },
      spec: { ports: [{ name: "tcp-api", port: 9004 }] },
    }),
    null,
  );
  assert.strictEqual(
    engineKindOfService({
      metadata: {
        name: "kubecost-finopsagent",
        namespace: "kubecost",
        labels: {
          "app.kubernetes.io/name": "finopsagent",
          "app.kubernetes.io/part-of": "finops-agent",
        },
      },
    }),
    null,
  );
  assert.strictEqual(
    engineKindOfService({ metadata: { name: "billing", namespace: "shop" } }),
    null,
  );
});
