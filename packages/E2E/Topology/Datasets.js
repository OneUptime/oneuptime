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
 *
 *   aksNodeTraffic — the estate in issue #3972: an AKS cluster whose pods
 *     are known only by the node they run on (no deployment), with the
 *     services on those pods calling each other. Opening a node must show
 *     how its pods talk, not a grid of standalone cards.
 *
 *   largeServiceMap — the project in issue #4117, whose Service Map went
 *     blank: 171 services reporting and 102 more last seen weeks ago, 19
 *     databases and remote APIs, and 77 calls. Thirty-eight client services
 *     call fifteen domain APIs, which call one platform service, which calls
 *     every database and API. Drawn, that is 73 cards in four columns, the
 *     first of them 38 cards tall: a narrow column fitted into a wide canvas
 *     at a small zoom, so most of the canvas is empty. The shorter columns
 *     are centred on the first, which leaves the drawing's box empty above
 *     and below them; the tests zoom into those corners (top-right and
 *     bottom-right) for the out-of-view notice, and use the first column's
 *     height to move keyboard focus far up and down the map. The other 117
 *     services call nothing and are listed below the map. With 190 entries
 *     the Service Map opens on its table, so the tests ask for
 *     `serviceView=map`.
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

function buildAksNodeTraffic(api) {
  const random = seededRandom(3972);
  api.addEntity("cluster-aks", "aks-prod", "k8s.cluster");
  const nodes = {
    k: "aks-agentpool-14451756-vmss00001k",
    j: "aks-agentpool-14451756-vmss00001j",
    q: "aks-agentpool-18230412-vmss000018",
  };
  for (const name of Object.values(nodes)) {
    api.addEntity(`node-${name}`, name, "k8s.node");
    api.connect(`node-${name}`, "cluster-aks", "member-of");
  }

  const services = [
    "wb-ims-frontend",
    "wb-ims-backend",
    "wb-ims-blob",
    "wb-ims-integration-edh",
    "wb-ims-mcp-remote",
  ];
  for (const name of services) {
    const entity = api.addEntity(`service-${name}`, name, "service");
    entity.descriptiveAttributes = { "telemetry.sdk.language": "dotnet" };
  }

  /* Which workloads each node runs; cilium runs everywhere, and no service. */
  const placement = {
    k: [
      "wb-ims-backend",
      "wb-ims-blob",
      "wb-ims-integration-edh",
      "wb-ims-mcp-remote",
    ],
    j: ["wb-ims-frontend", "wb-ims-backend", "cilium"],
    q: ["wb-ims-blob", "wb-ims-integration-edh", "cilium"],
  };
  for (const [node, workloads] of Object.entries(placement)) {
    for (const workload of workloads) {
      const name = `${workload}-${k8sSuffix(random, 10)}-${k8sSuffix(random, 5)}`;
      const key = `pod-${name}`;
      const pod = api.addEntity(key, name, "k8s.pod");
      pod.lastSeenAt = new Date(NOW - Math.floor(random() * 10) * MINUTE);
      api.connect(key, `node-${nodes[node]}`, "runs-on");
      api.connect(key, "cluster-aks", "member-of");
      if (services.includes(workload)) {
        api.connect(`service-${workload}`, key, "runs-on");
      }
    }
  }

  const database = api.addEntity("db-ims", "ims-sql", "database");
  database.descriptiveAttributes = { "db.system.name": "mssql" };

  const calls = (from, to, callCount, errorCount, avgDurationMs) => {
    api.connect(
      `service-${from}`,
      to.startsWith("db-") ? to : `service-${to}`,
      "depends-on",
      {
        callCount,
        errorCount,
        avgDurationMs,
      },
    );
  };
  calls("wb-ims-frontend", "wb-ims-backend", 54000, 27, 64);
  calls("wb-ims-backend", "wb-ims-blob", 7200, 36, 45);
  calls("wb-ims-backend", "wb-ims-integration-edh", 1800, 180, 120);
  calls("wb-ims-integration-edh", "wb-ims-blob", 360, 0, 20);
  calls("wb-ims-mcp-remote", "wb-ims-backend", 540, 0, 15);
  /* A database is not infrastructure: never a line on this map. */
  calls("wb-ims-backend", "db-ims", 91000, 12, 4);
}

const LARGE_MAP_DOMAINS = [
  "accounts",
  "billing",
  "catalog",
  "checkout",
  "identity",
  "inventory",
  "ledger",
  "notifications",
  "orders",
  "payments",
  "pricing",
  "profiles",
  "search",
  "shipping",
  "subscriptions",
];
/* Databases as discovery records them: engine in db.system.name. */
const LARGE_MAP_DATABASES = [
  ["accounts-db", "postgresql"],
  ["billing-db", "mysql"],
  ["catalog-store", "mongodb"],
  ["events-warehouse", "clickhouse"],
  ["inventory-db", "mariadb"],
  ["ledger-db", "mssql"],
  ["orders-db", "postgresql"],
  ["profiles-store", "cassandra"],
  ["rate-limit-cache", "redis"],
  ["search-index", "elasticsearch"],
  ["session-cache", "redis"],
];
/* Remote APIs by server address, protocol in network.protocol.name. */
const LARGE_MAP_REMOTE_APIS = [
  ["payments-gateway.example.com", "http"],
  ["fraud-score.example.com", "grpc"],
  ["tax-rates.example.org", "http"],
  ["fx-rates.example.org", "http"],
  ["geo-lookup.example.net", "http"],
  ["sms-relay.example.net", "http"],
  ["email-relay.example.net", "http"],
  ["feature-flags.example.io", "grpc"],
];
const LARGE_MAP_LANGUAGES = ["nodejs", "java", "go", "python", "dotnet"];

/*
 * `count` names from domain × role, domain first: accounts-web,
 * billing-web, ..., subscriptions-web, accounts-worker, ...
 */
function largeMapNames(roles, count) {
  const names = [];
  for (let index = 0; index < count; index++) {
    const role = roles[Math.floor(index / LARGE_MAP_DOMAINS.length)];
    names.push(
      `${LARGE_MAP_DOMAINS[index % LARGE_MAP_DOMAINS.length]}-${role}`,
    );
  }
  return names;
}

function buildLargeServiceMap(api) {
  const random = seededRandom(4117);
  const service = (name, lastSeenAt, language) => {
    const entity = api.addEntity(`service-${name}`, name, "service");
    entity.lastSeenAt = new Date(lastSeenAt);
    entity.firstSeenAt = new Date(lastSeenAt - 60 * DAY);
    entity.descriptiveAttributes = { "telemetry.sdk.language": language };
    return `service-${name}`;
  };
  const language = (index) => {
    return LARGE_MAP_LANGUAGES[index % LARGE_MAP_LANGUAGES.length];
  };

  // 171 services reported in the last day.
  const callers = largeMapNames(["web", "worker", "scheduler"], 38).map(
    (name, index) => {
      return service(
        name,
        NOW - (index % 40) * MINUTE,
        name.endsWith("-web") ? "webjs" : language(index),
      );
    },
  );
  const domainApis = LARGE_MAP_DOMAINS.map((domain, index) => {
    return service(
      `${domain}-api`,
      NOW - (index % 7) * MINUTE,
      language(index),
    );
  });
  const platform = service("platform-core", NOW - MINUTE, "go");
  largeMapNames(
    [
      "exporter",
      "importer",
      "consumer",
      "cron",
      "reporter",
      "migrator",
      "backfill",
      "auditor",
    ],
    117,
  ).forEach((name, index) => {
    service(name, NOW - (index % 55) * MINUTE, language(index));
  });
  // 102 more stopped reporting two to five weeks ago.
  largeMapNames(
    ["legacy", "canary", "shadow", "preview", "sandbox", "blue", "green"],
    102,
  ).forEach((name, index) => {
    service(name, NOW - (14 + (index % 21)) * DAY, language(index));
  });

  // 19 dependencies: databases and remote APIs.
  const databases = LARGE_MAP_DATABASES.map(([name, system]) => {
    const entity = api.addEntity(`db-${name}`, name, "database");
    entity.identifyingAttributes = {
      "db.system.name": system,
      "db.namespace": name,
    };
    entity.descriptiveAttributes = { "db.system.name": system };
    return entity.key;
  });
  const remoteApis = LARGE_MAP_REMOTE_APIS.map(([host, protocol]) => {
    const entity = api.addEntity(`remote-${host}`, host, "remote.service");
    entity.identifyingAttributes = { "server.address": host };
    entity.descriptiveAttributes = { "network.protocol.name": protocol };
    return entity.key;
  });

  // 77 connections, each with the metrics of one aggregation window.
  const calls = (from, to, callCount, errorRate, avgDurationMs) => {
    api.connect(from, to, "depends-on", {
      callCount,
      errorCount: Math.round(callCount * errorRate),
      avgDurationMs,
    });
  };
  const between = (min, max) => {
    return Math.round(min + random() * (max - min));
  };
  callers.forEach((caller, index) => {
    // Most calls are clean; every ninth client sees errors.
    const errorRate = index % 9 === 4 ? 0.06 : index % 5 === 0 ? 0.004 : 0;
    calls(
      caller,
      domainApis[index % domainApis.length],
      between(600, 48000),
      errorRate,
      between(18, 420),
    );
    // A few clients call a second domain API as well.
    if (index < 3) {
      calls(
        caller,
        domainApis[(index + 1) % domainApis.length],
        between(300, 9000),
        0,
        between(25, 260),
      );
    }
  });
  domainApis.forEach((domainApi, index) => {
    calls(
      domainApi,
      platform,
      between(20000, 240000),
      index === 6 ? 0.012 : 0.0005,
      between(8, 90),
    );
  });
  databases.forEach((database, index) => {
    calls(
      platform,
      database,
      between(90000, 2400000),
      database === "db-ledger-db" ? 0.03 : 0,
      index % 4 === 0 ? between(12, 40) : between(1, 9),
    );
  });
  remoteApis.forEach((remoteApi) => {
    calls(platform, remoteApi, between(400, 26000), 0.002, between(90, 780));
  });
  // Two domain APIs also read a store directly.
  calls("service-search-api", "db-search-index", 64000, 0, 14);
  calls("service-checkout-api", "db-session-cache", 210000, 0, 1);
}

const DATASETS = {
  selfHostedLegacy: buildSelfHostedLegacy,
  selfHostedDiscovered: buildSelfHostedDiscovered,
  aksNodeTraffic: buildAksNodeTraffic,
  largeServiceMap: buildLargeServiceMap,
};

export function loadDataset(name, api) {
  const build = DATASETS[name];
  if (!build) {
    return false;
  }
  build(api);
  return true;
}
