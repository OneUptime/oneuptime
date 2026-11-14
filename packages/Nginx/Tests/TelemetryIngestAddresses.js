/**
 * The addresses OneUptime hands out for the App's telemetry routes, read
 * against the App's own source, for the ingress tests that check nginx sends
 * every one of them to the App.
 *
 * The Telemetry feature set mounts each router it serves on "/telemetry" and
 * on "/" (TELEMETRY_PREFIXES in App/FeatureSet/Telemetry/Index.ts), so to the
 * App /opamp/v1 and /telemetry/opamp/v1 are the same route. To this ingress
 * they are not. The primary server has a /telemetry location, which always
 * reaches the App. A root path reaches the App only through a location that
 * names it; any other falls to `location /`, which is the marketing site
 * (Home) when BILLING_ENABLED=true, as it is on oneuptime.com. Such a path
 * works on every self-hosted OneUptime and answers 404 on the hosted one.
 * That is how the host collector shipped broken: its installers pointed the
 * supervisor at <OneUptime URL>/opamp/v1, which no location named, so every
 * host installed against oneuptime.com ran and never got its config. The
 * session replay recorder and the Kubernetes cost agent had the same 404
 * before them, and both now call their /telemetry address.
 *
 * So every route those routers register is listed here with each address
 * OneUptime hands out for it - in an installer, an agent, the CLI, the
 * Dashboard or the docs - and where it does, which the tests check is still
 * so. An address clients that are already out there still call is listed
 * with who they are. A route only the cluster itself calls says where.
 * A route the App gains fails the tests until it is listed here.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { NGINX_DIRECTORY } = require("./NginxConfigParser");

const REPOSITORY_ROOT = path.resolve(NGINX_DIRECTORY, "..", "..");
const TELEMETRY_DIRECTORY = "packages/App/FeatureSet/Telemetry";
const TELEMETRY_INDEX = `${TELEMETRY_DIRECTORY}/Index.ts`;

const HOST_COLLECTOR_INSTALL_SH =
  "packages/App/FeatureSet/Docs/Static/scripts/host-collector/install.sh";
const HOST_COLLECTOR_INSTALL_PS1 =
  "packages/App/FeatureSet/Docs/Static/scripts/host-collector/install.ps1";

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
}

/*
 * Each route the routers mounted on TELEMETRY_PREFIXES register, as METHOD
 * and path, with the addresses clients reach it at.
 *
 *   address     - what a client asks for, under the OneUptime URL. A ":name"
 *                 segment is a value the client fills in.
 *   handedOutBy - where OneUptime hands that address out: each file
 *                 (from the repository root) must still contain the text.
 *   calledBy    - instead of handedOutBy, for an address OneUptime no longer
 *                 hands out but that clients already installed still call.
 *   inCluster   - instead of addresses, for a route only the cluster itself
 *                 calls, never through the public ingress.
 */
const TELEMETRY_INGEST_ADDRESSES = [
  // OTLP over HTTP. Collectors and SDKs add /v1/<signal> to <URL>/otlp.
  ...["traces", "metrics", "logs"].map((signal) => {
    return {
      method: "POST",
      route: `/otlp/v1/${signal}`,
      addresses: [
        {
          address: `/otlp/v1/${signal}`,
          handedOutBy: [
            {
              file: "packages/App/FeatureSet/Docs/Content/en/telemetry/open-telemetry.md",
              contains: `https://oneuptime.com/otlp/v1/${signal}`,
            },
            {
              file: "packages/Common/Types/HostCollector/HostCollector.ts",
              contains:
                "HOST_COLLECTOR_EXPORTER_ENDPOINT: string = `${HOST_COLLECTOR_URL_REFERENCE}/otlp`",
            },
          ],
        },
      ],
    };
  }),
  {
    method: "POST",
    route: "/otlp/v1/profiles",
    addresses: [
      {
        address: "/otlp/v1/profiles",
        handedOutBy: [
          {
            file: "HelmChart/Public/kubernetes-agent/templates/configmap-profiling.yaml",
            contains:
              'profiles_endpoint: "{{ .Values.oneuptime.url }}/otlp/v1/profiles"',
          },
        ],
      },
    ],
  },
  {
    method: "GET",
    route: "/otlp/v1/validate",
    addresses: [
      {
        address: "/otlp/v1/validate",
        handedOutBy: [
          {
            file: "HelmChart/Public/kubernetes-agent/templates/NOTES.txt",
            contains: "{{ .Values.oneuptime.url }}/otlp/v1/validate",
          },
        ],
      },
    ],
  },

  // What each workload costs, from the Kubernetes agent's cost poller.
  {
    method: "POST",
    route: "/kubernetes-cost/ingest",
    addresses: [
      {
        address: "/telemetry/kubernetes-cost/ingest",
        handedOutBy: [
          {
            file: "agents/KubernetesCostAgent/Shipper.ts",
            contains: "`${ONEUPTIME_URL}/telemetry/kubernetes-cost/ingest`",
          },
        ],
      },
      {
        address: "/kubernetes-cost/ingest",
        calledBy:
          "cost pollers released before the agent posted under /telemetry",
      },
    ],
  },

  // KEDA reads the queue's backlog from each pod, by its Service name.
  {
    method: "GET",
    route: "/metrics/queue-size",
    inCluster: {
      file: "HelmChart/Public/oneuptime/templates/_helpers.tpl",
      contains:
        'url: http://{{ printf "%s-%s" $.Release.Name $.ServiceName }}:{{ .port }}{{ if .urlPath }}{{ .urlPath }}{{ else }}/metrics/queue-size{{ end }}',
    },
  },

  // Logs from syslog relays and Fluentd.
  {
    method: "POST",
    route: "/syslog/v1/logs",
    addresses: [
      {
        address: "/syslog/v1/logs",
        handedOutBy: [
          {
            file: "packages/App/FeatureSet/Docs/Content/en/telemetry/syslog.md",
            contains: "POST https://oneuptime.com/syslog/v1/logs",
          },
        ],
      },
    ],
  },
  {
    method: "POST",
    route: "/fluentd/v1/logs",
    addresses: [
      {
        // nginx rewrites it to the route.
        address: "/fluentd/logs",
        handedOutBy: [
          {
            file: "packages/App/FeatureSet/Docs/Content/en/telemetry/fluentd.md",
            contains: "endpoint https://oneuptime.com/fluentd/logs",
          },
        ],
      },
    ],
  },

  // Vercel's log drain, set up by the Vercel Marketplace integration.
  {
    method: "POST",
    route: "/vercel/v1/logs",
    addresses: [
      {
        address: "/telemetry/vercel/v1/logs",
        handedOutBy: [
          {
            file: "ee/Server/CloudMarketplace/MarketplaceConfig.ts",
            contains:
              "vercelLogDrainUrl: `${MarketplaceConfig.getPublicOrigin()}/telemetry/vercel/v1/logs`",
          },
        ],
      },
    ],
  },

  // What a cloud connection streams: Amazon Data Firehose and Pub/Sub push.
  ...[
    "/aws-firehose/v1/metrics",
    "/aws-firehose/v1/logs",
    "/gcp-pubsub/v1/logs",
  ].map((route) => {
    return {
      method: "POST",
      route,
      addresses: [
        {
          address: `/telemetry${route}`,
          handedOutBy: [
            {
              file: "packages/Common/Types/CloudConnection/CloudStream.ts",
              contains: 'CLOUD_STREAM_URL_PREFIX: string = "/telemetry"',
            },
          ],
        },
      ],
    };
  }),

  // Security events, from the setup guide's forwarders and webhooks.
  {
    method: "POST",
    route: "/security-events/v1/ingest",
    addresses: [
      {
        address: "/security-events/v1/ingest",
        handedOutBy: [
          {
            file: "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsSetupGuide.tsx",
            contains: "`${httpProtocol}://${HOST}/security-events/v1/ingest`",
          },
        ],
      },
    ],
  },

  // Deploys and other changes, from the CLI.
  {
    method: "POST",
    route: "/change-events/v1/ingest",
    addresses: [
      {
        address: "/telemetry/change-events/v1/ingest",
        handedOutBy: [
          {
            file: "packages/CLI/Commands/DeployCommands.ts",
            contains: '"/telemetry/change-events/v1/ingest"',
          },
        ],
      },
    ],
  },

  // Data pipelines: OpenLineage events, dbt artifacts, sync webhooks.
  {
    method: "POST",
    route: "/openlineage/api/v1/lineage",
    addresses: [
      {
        // OpenLineage clients add their endpoint, api/v1/lineage, to the URL.
        address: "/telemetry/openlineage/api/v1/lineage",
        handedOutBy: [
          {
            file: "packages/App/FeatureSet/Dashboard/src/Pages/DataObservability/Documentation.tsx",
            contains:
              "- **URL:** \\`https://oneuptime.com/telemetry/openlineage\\`",
          },
        ],
      },
    ],
  },
  {
    method: "POST",
    route: "/dbt/v1/artifacts",
    addresses: [
      {
        address: "/telemetry/dbt/v1/artifacts",
        handedOutBy: [
          {
            file: "packages/CLI/Commands/DbtCommands.ts",
            contains:
              'DBT_ARTIFACTS_INGEST_PATH: string = "/telemetry/dbt/v1/artifacts"',
          },
        ],
      },
    ],
  },
  {
    method: "POST",
    route: "/fivetran/v1/webhook/:ingestionKeyId",
    addresses: [
      {
        address: "/telemetry/fivetran/v1/webhook/:ingestionKeyId",
        handedOutBy: [
          {
            file: "packages/App/FeatureSet/Dashboard/src/Components/DataObservability/ConnectSyncToolModal.tsx",
            contains: "`${baseUrl}/telemetry/fivetran/v1/webhook/${keyId}`",
          },
        ],
      },
    ],
  },
  {
    method: "POST",
    route: "/airbyte/v1/webhook/:ingestionKey",
    addresses: [
      {
        address: "/telemetry/airbyte/v1/webhook/:ingestionKey",
        handedOutBy: [
          {
            file: "packages/App/FeatureSet/Dashboard/src/Components/DataObservability/ConnectSyncToolModal.tsx",
            contains: "`${baseUrl}/telemetry/airbyte/v1/webhook/${keyValue}`",
          },
        ],
      },
    ],
  },

  // Profiles: Pyroscope's SDKs add /ingest, Grafana Alloy its push path.
  ...["/pyroscope/ingest", "/pyroscope/push.v1.PusherService/Push"].map(
    (route) => {
      return {
        method: "POST",
        route,
        addresses: [
          {
            address: route,
            handedOutBy: [
              {
                file: "packages/App/FeatureSet/Docs/Content/en/telemetry/profiles.md",
                contains: 'url = "https://oneuptime.com/pyroscope"',
              },
            ],
          },
        ],
      };
    },
  ),

  // Source maps, uploaded from CI.
  {
    method: "POST",
    route: "/source-maps/v1/upload",
    addresses: [
      {
        address: "/source-maps/v1/upload",
        handedOutBy: [
          {
            file: "packages/App/FeatureSet/Docs/Content/en/telemetry/source-maps.md",
            contains:
              'curl --fail -X POST "https://oneuptime.com/source-maps/v1/upload"',
          },
        ],
      },
    ],
  },

  /*
   * The host collector: the supervisor the installers set up asks here for
   * its host's config, every 30 seconds.
   */
  {
    method: "POST",
    route: "/opamp/v1",
    addresses: [
      {
        address: "/telemetry/opamp/v1",
        handedOutBy: [
          {
            file: HOST_COLLECTOR_INSTALL_SH,
            contains: 'OPAMP_PATH="/telemetry/opamp/v1"',
          },
          {
            file: HOST_COLLECTOR_INSTALL_PS1,
            contains: '$OpAmpPath = "/telemetry/opamp/v1"',
          },
          {
            file: "packages/Common/Types/HostCollector/HostCollector.ts",
            contains:
              "HOST_COLLECTOR_OPAMP_PATH: string = `/telemetry${HOST_COLLECTOR_OPAMP_ROUTE}`",
          },
        ],
      },
      {
        address: "/opamp/v1",
        calledBy:
          "every host installed before the installers pointed the supervisor at /telemetry/opamp/v1",
      },
    ],
  },

  // Session replay and product analytics, from the browser and mobile recorders.
  ...[
    ["POST", "/session-replay/v1/chunk", "CHUNK_PATH"],
    ["GET", "/session-replay/v1/config", "CONFIG_PATH"],
  ].map(([method, route, constant]) => {
    return {
      method,
      route,
      addresses: [
        {
          address: `/telemetry${route}`,
          handedOutBy: [
            {
              file: "packages/App/FeatureSet/BrowserRecorder/src/Config.ts",
              contains: `${constant}: string = "/telemetry${route}"`,
            },
            {
              file: "packages/App/FeatureSet/MobileRecorder/src/Contract.ts",
              contains: `${constant}: string = "/telemetry${route}"`,
            },
          ],
        },
        {
          address: route,
          calledBy: "recorders built before their paths carried /telemetry",
        },
      ],
    };
  }),
  {
    method: "POST",
    route: "/session-replay/v1/events",
    addresses: [
      {
        address: "/telemetry/session-replay/v1/events",
        handedOutBy: [
          {
            file: "packages/Common/Types/Rum/ProductAnalyticsEvents.ts",
            contains:
              "PRODUCT_ANALYTICS_EVENTS_PATH: string = `/telemetry${PRODUCT_ANALYTICS_EVENTS_ROUTE}`",
          },
        ],
      },
    ],
  },
  {
    method: "GET",
    route: "/session-replay/v1/validate",
    addresses: [
      {
        address: "/session-replay/v1/validate",
        handedOutBy: [
          {
            file: "packages/App/FeatureSet/Docs/Content/en/rum/session-replay-troubleshooting.md",
            contains: "confirm it with `GET /session-replay/v1/validate`",
          },
        ],
      },
    ],
  },
  {
    method: "GET",
    route: "/session-replay/v1/recorder.js",
    addresses: [
      {
        address: "/telemetry/session-replay/v1/recorder.js",
        handedOutBy: [
          {
            file: "packages/App/FeatureSet/Docs/Content/en/telemetry/session-replay.md",
            contains:
              'src="https://oneuptime.com/telemetry/session-replay/v1/recorder.js"',
          },
        ],
      },
    ],
  },
  {
    method: "GET",
    route: "/session-replay/latest/recorder.js",
    addresses: [
      {
        address: "/telemetry/session-replay/latest/recorder.js",
        handedOutBy: [
          {
            file: "packages/App/FeatureSet/BrowserRecorder/README.md",
            contains: "`/telemetry/session-replay/latest/recorder.js`",
          },
        ],
      },
    ],
  },
];

/*
 * The text after `router.<method>(`: a quoted path on the same line, or the
 * first argument on the next line - a quoted path or a name.
 */
const REGISTRATION = /^\s*router\.(get|post|put|patch|delete|all)\(\s*(.*)$/;
const QUOTED_PATH = /^"([^"]+)"\s*,?\s*$/;
const NAME = /^([A-Za-z_][A-Za-z0-9_]*)\s*,?\s*$/;

/*
 * A name's value: a string constant this file declares or imports from
 * another module ("Common/..." or a relative path), or the names a
 * `for (const <name> of [A, B])` around the registration goes through.
 */
function resolveName(name, source, file, lineIndex) {
  const lines = source.split("\n");

  for (let index = lineIndex; index >= 0; index--) {
    const loop = lines[index].match(
      new RegExp(`for\\s*\\(\\s*const\\s+${name}\\s+of\\s+\\[([^\\]]*)\\]`),
    );

    if (loop) {
      return loop[1]
        .split(",")
        .map((item) => {
          return item.trim();
        })
        .filter(Boolean)
        .flatMap((item) => {
          return resolveName(item, source, file, index - 1);
        });
    }
  }

  const declared = (moduleSource) => {
    const match = moduleSource.match(
      new RegExp(
        `(?:export\\s+)?const\\s+${name}\\s*:\\s*string\\s*=\\s*"([^"]+)"`,
      ),
    );

    return match ? match[1] : null;
  };

  const own = declared(source);

  if (own) {
    return [own];
  }

  const importLine = source.match(
    new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`),
  );

  assert.ok(importLine, `${file}: cannot tell what ${name} is`);

  const specifier = importLine[1];
  const modulePath = specifier.startsWith("Common/")
    ? `packages/${specifier}.ts`
    : path.posix.join(path.posix.dirname(file), `${specifier}.ts`);
  const value = declared(readRepositoryFile(modulePath));

  assert.ok(value, `${modulePath} declares no string ${name}`);

  return [value];
}

/** Every route a router file registers, as { method, route, file }. */
function readRouterRoutes(file) {
  const source = readRepositoryFile(file);
  const lines = source.split("\n");
  const routes = [];

  lines.forEach((line, index) => {
    const registration = line.match(REGISTRATION);

    if (!registration) {
      return;
    }

    const method = registration[1].toUpperCase();
    let argument = registration[2].trim();
    let argumentLine = index;

    if (argument === "") {
      argumentLine = index + 1;
      argument = (lines[argumentLine] || "").trim();
    } else {
      // The first argument alone: "/x", handler... -> "/x",
      argument = argument.replace(
        /^("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*,.*$/,
        "$1,",
      );
    }

    const quoted = argument.match(QUOTED_PATH);
    const named = argument.match(NAME);

    assert.ok(
      quoted || named,
      `${file}:${index + 1}: cannot read the path of router.${registration[1]}( from ${JSON.stringify(argument)}`,
    );

    const paths = quoted
      ? [quoted[1]]
      : resolveName(named[1], source, file, argumentLine);

    for (const route of paths) {
      routes.push({ method, route, file });
    }
  });

  return routes;
}

/**
 * The mount prefixes Telemetry/Index.ts declares, and every route of every
 * router it mounts on them.
 */
function readTelemetryRoutes() {
  const index = readRepositoryFile(TELEMETRY_INDEX);

  const prefixes = index.match(
    /const TELEMETRY_PREFIXES: Array<string> = \[([^\]]*)\];/,
  );

  assert.ok(
    prefixes,
    `${TELEMETRY_INDEX} no longer declares TELEMETRY_PREFIXES`,
  );

  const mountPrefixes = Array.from(prefixes[1].matchAll(/"([^"]*)"/g), (m) => {
    return m[1];
  });

  const imports = new Map(
    Array.from(
      index.matchAll(/^import\s+(\w+)\s+from\s+"\.\/(API\/[^"]+)";/gm),
      (match) => {
        return [match[1], `${TELEMETRY_DIRECTORY}/${match[2]}.ts`];
      },
    ),
  );

  const mounted = Array.from(
    index.matchAll(/^\s*app\.use\(TELEMETRY_PREFIXES,\s*(\w+)\);/gm),
    (match) => {
      return match[1];
    },
  );

  // A list read only in part would let the tests pass with nothing checked.
  assert.ok(
    mounted.length >= 15,
    `read only ${mounted.length} routers mounted on TELEMETRY_PREFIXES`,
  );
  assert.equal(
    mounted.length,
    index.split("app.use(TELEMETRY_PREFIXES,").length - 1,
    "every app.use(TELEMETRY_PREFIXES, ...) must be read",
  );

  const routes = mounted.flatMap((name) => {
    const file = imports.get(name);

    assert.ok(file, `${TELEMETRY_INDEX} mounts ${name}, imported from nowhere`);

    return readRouterRoutes(file);
  });

  return { mountPrefixes, routes };
}

/** An address with a value in place of each ":name" segment. */
function exampleOf(address) {
  return address.replace(/:[A-Za-z]+/g, "a1b2c3d4-0000-4000-8000-00000000f00d");
}

/** Every address clients reach the routes at, one row each. */
function listPublicAddresses() {
  return TELEMETRY_INGEST_ADDRESSES.flatMap((entry) => {
    return (entry.addresses || []).map((address) => {
      return {
        method: entry.method,
        route: entry.route,
        ...address,
      };
    });
  });
}

module.exports = {
  HOST_COLLECTOR_INSTALL_PS1,
  HOST_COLLECTOR_INSTALL_SH,
  REPOSITORY_ROOT,
  TELEMETRY_INDEX,
  TELEMETRY_INGEST_ADDRESSES,
  exampleOf,
  listPublicAddresses,
  readRepositoryFile,
  readRouterRoutes,
  readTelemetryRoutes,
};
