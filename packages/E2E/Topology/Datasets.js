/*
 * Additional synthetic topology datasets for the offline fixture. Selected with
 * `?dataset=` on the fixture URL; the default dataset stays in Fixture.js.
 *
 * Every name, count and number here is generated. The shapes deliberately
 * mirror what a real self-hosted OneUptime estate reports, because those are
 * the shapes the topology views have to make sense of:
 *
 *   selfHostedLegacy — what ingest registered BEFORE service dependencies and
 *     Kubernetes identity were fixed: application pods registered as "hosts"
 *     (their SDK only reported host.name), hundreds of them long gone after
 *     redeploys, services linked to those hosts, and no service-to-service
 *     calls at all.
 *
 *   selfHostedDiscovered — the same estate after the fix: pods carry their
 *     Kubernetes namespace/node/deployment, cross-service calls are paired
 *     from traces, and the databases/APIs services call are inferred from
 *     client spans.
 */

const K8S_ALPHABET = "bcdfghjklmnpqrstvwxz2456789";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function k8sSuffix(random, length) {
  let out = "";
  for (let index = 0; index < length; index++) {
    out += K8S_ALPHABET[Math.floor(random() * K8S_ALPHABET.length)];
  }
  return out;
}

const NOW = new Date("2026-09-07T10:00:00Z").getTime();
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const WORKLOADS = [
  { name: "oneuptime-app", service: "api", live: 12, stale: 101 },
  { name: "oneuptime-worker", service: "api", live: 8, stale: 73 },
  { name: "oneuptime-probe-one", service: "probe", live: 10, stale: 113 },
  { name: "oneuptime-probe-two", service: "probe", live: 10, stale: 125 },
  { name: "oneuptime-home", service: "home", live: 3, stale: 22 },
  { name: "oneuptime-runner", service: "runner", live: 2, stale: 14 },
];

const SERVICES = [
  "accounts",
  "admin-dashboard",
  "api",
  "dashboard",
  "home",
  "probe",
  "runner",
  "status-page",
];

function podNames(random, workload, count) {
  const names = [];
  for (let index = 0; index < count; index++) {
    // A redeploy mints a new ReplicaSet hash, so stale pods vary it too.
    const hash = k8sSuffix(random, 10);
    names.push(`${workload}-${hash}-${k8sSuffix(random, 5)}`);
  }
  return names;
}

function addServices(api, lastSeenAt) {
  for (const name of SERVICES) {
    const entity = api.addEntity(`service-${name}`, name, "service");
    entity.lastSeenAt = lastSeenAt;
    entity.descriptiveAttributes = {
      "telemetry.sdk.language": [
        "accounts",
        "admin-dashboard",
        "dashboard",
        "status-page",
      ].includes(name)
        ? "webjs"
        : "nodejs",
    };
  }
}

function buildSelfHostedLegacy(api) {
  const random = seededRandom(3754);
  addServices(api, new Date(NOW - 2 * MINUTE));
  for (const workload of WORKLOADS) {
    const live = podNames(random, workload.name, workload.live);
    const stale = podNames(random, workload.name, workload.stale);
    live.concat(stale).forEach((name, index) => {
      const isLive = index < live.length;
      const lastSeenAt = new Date(
        isLive ? NOW - (index % 5) * MINUTE : NOW - (2 + (index % 25)) * DAY,
      );
      const key = `host-${name}`;
      const host = api.addEntity(key, name, "host");
      host.lastSeenAt = lastSeenAt;
      host.firstSeenAt = new Date(lastSeenAt.getTime() - 3 * DAY);
      host.descriptiveAttributes = { "host.arch": "amd64" };
      const edge = api.connect(`service-${workload.service}`, key, "hosted-on");
      edge.lastSeenAt = lastSeenAt;
    });
  }
  const device = api.addEntity(
    "network-device-core",
    "core-switch-01",
    "network.device",
  );
  device.source = "inventory";
}

function buildSelfHostedDiscovered(api) {
  const random = seededRandom(9001);
  addServices(api, new Date(NOW - MINUTE));

  api.addEntity("cluster-prod", "oneuptime-prod", "k8s.cluster");
  api.addEntity("namespace-oneuptime", "oneuptime", "k8s.namespace");
  api.connect("namespace-oneuptime", "cluster-prod", "member-of");
  const nodes = ["gke-pool-a-7x2k", "gke-pool-a-9m4q", "gke-pool-b-3h8w"];
  nodes.forEach((name) => {
    api.addEntity(`node-${name}`, name, "k8s.node");
    api.connect(`node-${name}`, "cluster-prod", "member-of");
  });

  WORKLOADS.forEach((workload, workloadIndex) => {
    const deploymentKey = `deployment-${workload.name}`;
    api.addEntity(deploymentKey, workload.name, "k8s.deployment");
    api.connect(deploymentKey, "namespace-oneuptime", "member-of");
    api.connect(deploymentKey, "cluster-prod", "member-of");
    podNames(random, workload.name, workload.live).forEach((name, index) => {
      const key = `pod-${name}`;
      const pod = api.addEntity(key, name, "k8s.pod");
      pod.lastSeenAt = new Date(NOW - (index % 4) * MINUTE);
      api.connect(key, deploymentKey, "part-of");
      api.connect(key, "namespace-oneuptime", "member-of");
      api.connect(key, "cluster-prod", "member-of");
      api.connect(key, `node-${nodes[(index + workloadIndex) % 3]}`, "runs-on");
      api.connect(`service-${workload.service}`, key, "runs-on");
    });
  });

  const database = (key, name, system) => {
    const entity = api.addEntity(key, name, "database");
    entity.descriptiveAttributes = { "db.system": system };
    return entity;
  };
  database("db-postgres", "oneuptime", "postgresql");
  database("db-clickhouse", "oneuptime-clickhouse", "clickhouse");
  database("db-redis", "oneuptime-redis", "redis");
  const remote = (key, name, protocol) => {
    const entity = api.addEntity(key, name, "remote.service");
    entity.descriptiveAttributes = { "network.protocol.name": protocol };
    return entity;
  };
  remote("remote-slack", "slack.com", "http");
  remote("remote-twilio", "api.twilio.com", "http");

  const calls = (from, to, callCount, errorCount, avgDurationMs) => {
    api.connect(from, to, "depends-on", {
      callCount,
      errorCount,
      avgDurationMs,
    });
  };
  calls("service-dashboard", "service-api", 184000, 310, 86);
  calls("service-accounts", "service-api", 5200, 48, 142);
  calls("service-admin-dashboard", "service-api", 900, 0, 97);
  calls("service-status-page", "service-api", 41000, 12, 64);
  calls("service-probe", "service-api", 96000, 1450, 212);
  calls("service-runner", "service-api", 2600, 0, 58);
  calls("service-home", "service-api", 1800, 3, 31);
  calls("service-api", "db-postgres", 910000, 120, 6);
  calls("service-api", "db-clickhouse", 240000, 2900, 38);
  calls("service-api", "db-redis", 1400000, 0, 1);
  calls("service-api", "remote-slack", 3100, 22, 310);
  calls("service-api", "remote-twilio", 420, 9, 540);
}

const DATASETS = {
  selfHostedLegacy: buildSelfHostedLegacy,
  selfHostedDiscovered: buildSelfHostedDiscovered,
};

export function loadDataset(name, api) {
  const build = DATASETS[name];
  if (!build) {
    return false;
  }
  build(api);
  return true;
}
