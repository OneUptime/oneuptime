"use strict";

/**
 * The Storage Array Agent (agents/StorageArrayAgent): its collector configs
 * — a FlashArray's native OpenMetrics endpoint, Pure's FlashArray exporter
 * for an older Purity//FA, Pure's FlashBlade exporter, Dell's PowerStore
 * exporter (with its syslog collector beside it) — the compose file that
 * runs one of them, and the scripts and unit that install it.
 *
 * OneUptime registers and inventories an array from what these configs
 * stamp and how they scrape, so their shape is part of the product:
 *
 *  - the `resource` processor UPSERTS `storage.array.name` (the join key),
 *    `storage.system` and `oneuptime.agent.version` — exactly the collector
 *    image docker-compose.yml pins, the version the array's page shows and
 *    compares with the newest — and DELETES `service.name` /
 *    `service.instance.id`, which the prometheus receiver synthesizes from
 *    the job name — left in, the batch routes to a phantom Service;
 *  - every scrape job labels its series `scrape_endpoint: <endpoint>`: ingest
 *    (StorageArraySnapshotScan) reads it to know which inventory families a
 *    batch is the complete list of, so a deleted volume leaves the inventory;
 *  - the `batch` processor has no `send_batch_max_size`, so a scrape is never
 *    split across exports (ingest rebuilds the inventory per request);
 *  - the native config scrapes https://<array>/metrics/<endpoint> with
 *    `namespace=purefa`, Pure's exporter configs scrape the compose service
 *    with `endpoint=<array>`, all with the read-only user's API token as a
 *    Bearer token; the PowerStore config scrapes Dell's exporter at
 *    /metrics/<cluster>/<part> with no credential, since Dell's exporter
 *    logs in to the cluster itself;
 *  - docker-compose.yml mounts the config STORAGE_ARRAY_COLLECTOR_CONFIG
 *    names and starts the exporter that config scrapes only under its
 *    profile, and install.sh writes the two consistently and recreates the
 *    containers, so a re-run starts the config it just downloaded.
 *
 * `otelcol validate` (validate-collector-configs.sh) proves the configs
 * start; this proves they say the right thing.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = "agents/StorageArrayAgent";
const COLLECTOR_SERVICE = "oneuptime-storage-array-agent";
const INSTALL_DIR = "/opt/oneuptime-storage-array-agent";

/*
 * Each shipped config: the platform it reads, the compose profile that
 * starts what it scrapes (none for the native endpoint), and its scrape jobs
 * — job name, endpoint (the metrics path's last segment, and the
 * scrape_endpoint label) and interval.
 */
const CONFIGS = {
  "otel-collector-config.yaml": {
    system: "purestorage.flasharray",
    profile: "",
    scheme: "https",
    target: "${env:PURE_FA_ENDPOINT}",
    token: "${env:PURE_FA_API_TOKEN}",
    jobs: [
      ["purefa-array", "array", "60s"],
      ["purefa-volumes", "volumes", "120s"],
      ["purefa-hosts", "hosts", "120s"],
      ["purefa-pods", "pods", "120s"],
      ["purefa-directories", "directories", "30m"],
    ],
  },
  "otel-collector-config.flasharray-exporter.yaml": {
    system: "purestorage.flasharray",
    profile: "flasharray-exporter",
    exporterService: "pure-fa-exporter",
    scheme: "http",
    target: "pure-fa-exporter:9490",
    endpointParam: "${env:PURE_FA_ENDPOINT}",
    token: "${env:PURE_FA_API_TOKEN}",
    jobs: [
      ["purefa-array", "array", "60s"],
      ["purefa-volumes", "volumes", "120s"],
      ["purefa-hosts", "hosts", "120s"],
      ["purefa-pods", "pods", "120s"],
      ["purefa-directories", "directories", "30m"],
    ],
  },
  "otel-collector-config.flashblade.yaml": {
    system: "purestorage.flashblade",
    profile: "flashblade",
    exporterService: "pure-fb-exporter",
    scheme: "http",
    target: "pure-fb-exporter:9491",
    endpointParam: "${env:PURE_FB_ENDPOINT}",
    token: "${env:PURE_FB_API_TOKEN}",
    jobs: [
      ["purefb-array", "array", "60s"],
      ["purefb-filesystems", "filesystems", "300s"],
      ["purefb-objectstore", "objectstore", "300s"],
    ],
  },
  "otel-collector-config.powerstore.yaml": {
    system: "dell.powerstore",
    profile: "powerstore",
    exporterService: "powerstore-exporter",
    scheme: "http",
    target: "powerstore-exporter:9010",
    /*
     * Dell's exporter logs in to the cluster itself, with the user and
     * password only it is given, and serves each part of the cluster at
     * /metrics/<cluster>/<part>: the collector sends no credential.
     */
    exporterLogsIn: true,
    pathPrefix: "/metrics/${env:POWERSTORE_ENDPOINT}/",
    // Its syslog has a collector of its own, which publishes the port.
    syslogService: "powerstore-syslog",
    processors: [
      "batch",
      "filter/powerstore-space-operands",
      "filter/powerstore-space-used-percent",
      "groupbyattrs/powerstore-space-object",
      "memory_limiter",
      "metricsgeneration/powerstore-space-used-percent",
      "resource",
      "transform/powerstore-node-state",
      "transform/powerstore-space-object-labels",
    ],
    pipelines: {
      metrics: {
        receivers: ["prometheus"],
        processors: [
          "memory_limiter",
          "transform/powerstore-node-state",
          "resource",
          "batch",
        ],
        exporters: ["otlphttp"],
      },
      "metrics/space-used-percent": {
        receivers: ["prometheus"],
        processors: [
          "memory_limiter",
          "filter/powerstore-space-operands",
          "groupbyattrs/powerstore-space-object",
          "metricsgeneration/powerstore-space-used-percent",
          "filter/powerstore-space-used-percent",
          "transform/powerstore-space-object-labels",
          "resource",
          "batch",
        ],
        exporters: ["otlphttp"],
      },
    },
    jobs: [
      ["powerstore-cluster", "cluster", "60s"],
      ["powerstore-appliance", "appliance", "300s"],
      ["powerstore-capacity", "capacity", "300s"],
      ["powerstore-hardware", "hardware", "300s"],
      ["powerstore-port", "port", "300s"],
      ["powerstore-volume", "volume", "300s"],
      ["powerstore-volume-group", "volumeGroup", "300s"],
      ["powerstore-nas", "nas", "300s"],
      ["powerstore-file", "file", "300s"],
    ],
  },
};
const CONFIG_NAMES = Object.keys(CONFIGS);

/*
 * The files a platform runs with besides its collector config (install.sh's
 * table, field 11), and the .env settings only the compose file reads (the
 * PowerStore exporter's login and options, the syslog port).
 */
const OTHER_FILES = ["powerstore-exporter.Dockerfile", "powerstore-syslog.yaml"];
const PLATFORM_COMPOSE_ENV = [
  "POWERSTORE_USERNAME",
  "POWERSTORE_PASSWORD",
  "POWERSTORE_BULK_METRICS",
  "POWERSTORE_API_VERSION",
  "POWERSTORE_REQUEST_LIMIT",
  "POWERSTORE_SYSLOG_PORT",
];

/* A job's path after its config's prefix: the part it scrapes. */
function endpointOf(name, job) {
  const prefix = CONFIGS[name].pathPrefix || "/metrics/";
  expect({ path: job.metrics_path, prefixed: job.metrics_path.startsWith(prefix) }).toEqual({
    path: job.metrics_path,
    prefixed: true,
  });
  return job.metrics_path.slice(prefix.length);
}

/* The per-volume / per-host latency breakdown the volumes and hosts jobs drop. */
const LATENCY_BREAKDOWN_DROP = {
  source_labels: ["__name__", "dimension"],
  regex:
    "purefa_(volume|host)_performance_latency_usec;(qos_rate_limit|queue|san|service)_usec_per_.*",
  action: "drop",
};

/* Every variable the configs read with ${env:...}. */
const CONFIG_ENV = [
  "ONEUPTIME_URL",
  "ONEUPTIME_TELEMETRY_INGESTION_KEY",
  "STORAGE_ARRAY_NAME",
  "STORAGE_SYSTEM",
  "PURE_FA_ENDPOINT",
  "PURE_FA_API_TOKEN",
  "PURE_FB_ENDPOINT",
  "PURE_FB_API_TOKEN",
  "POWERSTORE_ENDPOINT",
  "STORAGE_ARRAY_INSECURE_SKIP_VERIFY",
];
/* The compose-level variables .env carries besides those. */
const COMPOSE_ENV = ["STORAGE_ARRAY_COLLECTOR_CONFIG", "COMPOSE_PROFILES"];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function configText(name) {
  return read(`${AGENT_DIR}/${name}`);
}

function config(name) {
  return yaml.load(configText(name));
}

function compose() {
  return yaml.load(read(`${AGENT_DIR}/docker-compose.yml`));
}

const COLLECTOR = /otel\/opentelemetry-collector-contrib:(\d+\.\d+\.\d+)/g;

/* The collector image docker-compose.yml pins — the one collector it runs. */
function composePin() {
  const pins = [...read(`${AGENT_DIR}/docker-compose.yml`).matchAll(COLLECTOR)];
  expect(pins).toHaveLength(1);
  return pins[0][1];
}

/* A Prometheus duration ("60s", "2m", "30m") in seconds. */
function seconds(duration) {
  const match = /^(\d+)(s|m|h)$/.exec(duration);
  expect({ duration, valid: Boolean(match) }).toEqual({
    duration,
    valid: true,
  });
  return Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2]];
}

function scrapeConfigs(name) {
  return config(name).receivers.prometheus.config.scrape_configs;
}

/* The body of a shell function `name() { ... }` in a script. */
function shellFunction(script, name) {
  const match = script.match(
    new RegExp(`\\n${name}\\(\\) \\{([\\s\\S]*?)\\n\\}`),
  );
  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });
  return match[1];
}

/*
 * install.sh's PLATFORMS table (#11000): one line per collector config, its
 * fields separated by |, in the order the script reads them.
 */
function installPlatforms() {
  const script = read(`${AGENT_DIR}/install.sh`);
  const table = script.match(/^PLATFORMS="\n([\s\S]*?)\n"$/m);
  expect(table).not.toBeNull();
  return table[1]
    .split("\n")
    .filter((line) => {
      return line.trim() !== "";
    })
    .map((line) => {
      const fields = line.split("|");
      expect({ line, fields: fields.length }).toEqual({ line, fields: 12 });
      const list = (field) => {
        return field === "-" ? [] : field.split(" ");
      };
      return {
        config: fields[0],
        system: fields[1],
        profile: fields[2] === "-" ? "" : fields[2],
        endpointVariable: fields[3],
        tokenVariable: fields[4],
        tlsToArray: fields[5],
        noun: fields[6],
        menu: fields[7],
        readHow: fields[8],
        userVariable: fields[9] === "-" ? "" : fields[9],
        otherFiles: list(fields[10]),
        optionalVariables: list(fields[11]),
      };
    });
}

/* The table's config → the STORAGE_SYSTEM and COMPOSE_PROFILES it sets. */
function installMapping() {
  const mapping = {};
  for (const platform of installPlatforms()) {
    mapping[platform.config] = {
      system: platform.system,
      profile: platform.profile,
    };
  }
  return mapping;
}

/*
 * Every address, token, user and optional variable of the table, each once,
 * in the order install.sh writes them (its fields 4, 5, 10 and 12).
 */
function installPlatformVariables() {
  const names = [];
  for (const platform of installPlatforms()) {
    for (const name of [
      platform.endpointVariable,
      platform.tokenVariable,
      ...(platform.userVariable ? [platform.userVariable] : []),
      ...platform.optionalVariables,
    ]) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

describe("agents/StorageArrayAgent collector configs", () => {
  describe.each(CONFIG_NAMES)("%s", (name) => {
    const expected = CONFIGS[name];

    test("scrapes exactly the endpoints of its platform, each at its interval", () => {
      expect(
        scrapeConfigs(name).map((job) => {
          return [job.job_name, endpointOf(name, job), job.scrape_interval];
        }),
      ).toEqual(expected.jobs);
    });

    test("labels every job's series with its scrape_endpoint", () => {
      for (const job of scrapeConfigs(name)) {
        expect(job.static_configs).toHaveLength(1);
        expect({
          job: job.job_name,
          labels: job.static_configs[0].labels,
        }).toEqual({
          job: job.job_name,
          // In lower case, as ingest reads it (markScrapedEndpoint).
          labels: {
            scrape_endpoint: endpointOf(name, job).toLowerCase(),
          },
        });
      }
    });

    test("never lets a scrape run longer than its interval", () => {
      for (const job of scrapeConfigs(name)) {
        expect(job.scrape_timeout).toBeDefined();
        expect(seconds(job.scrape_timeout)).toBeLessThanOrEqual(
          seconds(job.scrape_interval),
        );
      }
    });

    test("reaches the array the way its platform serves metrics, with the credential it needs", () => {
      for (const job of scrapeConfigs(name)) {
        expect(job.scheme).toBe(expected.scheme);
        expect(job.static_configs[0].targets).toEqual([expected.target]);
        if (expected.exporterLogsIn) {
          // The exporter holds the credential and names the array in the path.
          expect(job).not.toHaveProperty("authorization");
          expect(job).not.toHaveProperty("params");
          expect(job).not.toHaveProperty("tls_config");
          continue;
        }
        expect(job.authorization).toEqual({
          type: "Bearer",
          credentials: expected.token,
        });
        if (expected.endpointParam) {
          // Pure's exporter: which array to read travels as `endpoint`.
          expect(job.params).toEqual({ endpoint: [expected.endpointParam] });
          expect(job.tls_config).toBeUndefined();
        } else {
          // The array itself: `namespace=purefa` is required, and the only
          // value it accepts.
          expect(job.params).toEqual({ namespace: ["purefa"] });
          expect(job.metrics_path).toMatch(/^\/metrics\/[a-z]+$/);
          expect(Object.keys(job.tls_config)).toEqual(["insecure_skip_verify"]);
        }
      }
    });

    test("keeps the TLS switch an unquoted boolean placeholder", () => {
      const text = configText(name);
      const lines = text.split("\n").filter((line) => {
        return /insecure_skip_verify:/.test(line) && !/^\s*#/.test(line);
      });
      if (expected.endpointParam || expected.exporterLogsIn) {
        expect(lines).toEqual([]);
      } else {
        expect(lines.length).toBe(expected.jobs.length);
        for (const line of lines) {
          expect(line.trim()).toBe(
            "insecure_skip_verify: ${env:STORAGE_ARRAY_INSECURE_SKIP_VERIFY}",
          );
        }
      }
    });

    test("drops only the per-volume and per-host latency breakdown", () => {
      for (const job of scrapeConfigs(name)) {
        const endpoint = endpointOf(name, job);
        if (
          expected.system === "purestorage.flasharray" &&
          (endpoint === "volumes" || endpoint === "hosts")
        ) {
          expect(job.metric_relabel_configs).toEqual([LATENCY_BREAKDOWN_DROP]);
        } else {
          expect(job.metric_relabel_configs).toBeUndefined();
        }
      }
    });

    test("stamps the array identity and the agent's version, and deletes the receiver's service identity", () => {
      expect(config(name).processors.resource).toEqual({
        attributes: [
          {
            key: "storage.array.name",
            value: "${env:STORAGE_ARRAY_NAME}",
            action: "upsert",
          },
          {
            key: "storage.system",
            value: "${env:STORAGE_SYSTEM}",
            action: "upsert",
          },
          {
            key: "oneuptime.agent.version",
            value: composePin(),
            action: "upsert",
          },
          { key: "service.name", action: "delete" },
          { key: "service.instance.id", action: "delete" },
        ],
      });
      // Quoted, so YAML keeps it the version string the page compares.
      expect(configText(name)).toContain(
        `      - key: oneuptime.agent.version\n        value: "${composePin()}"\n        action: upsert\n`,
      );
    });

    test("never splits a scrape across exports", () => {
      const { batch } = config(name).processors;
      expect(batch.send_batch_size).toBe(8192);
      expect(batch).not.toHaveProperty("send_batch_max_size");
      expect(configText(name)).toContain("deliberately NO send_batch_max_size");
    });

    test("runs its metrics pipelines into OneUptime, and nothing that would re-identify the batch", () => {
      const parsed = config(name);
      expect(Object.keys(parsed.receivers)).toEqual(["prometheus"]);
      expect(Object.keys(parsed.processors).sort()).toEqual(
        expected.processors || ["batch", "memory_limiter", "resource"],
      );
      expect(parsed.exporters).toEqual({
        otlphttp: {
          endpoint: "${env:ONEUPTIME_URL}/otlp",
          headers: {
            "x-oneuptime-token": "${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}",
          },
        },
      });
      expect(parsed.service.pipelines).toEqual(
        expected.pipelines || {
          metrics: {
            receivers: ["prometheus"],
            processors: ["memory_limiter", "resource", "batch"],
            exporters: ["otlphttp"],
          },
        },
      );
      // Every pipeline stamps the array and keeps a scrape whole.
      for (const pipeline of Object.values(parsed.service.pipelines)) {
        expect(pipeline.processors[0]).toBe("memory_limiter");
        expect(pipeline.processors.slice(-2)).toEqual(["resource", "batch"]);
      }
    });

    test("ships the syslog option commented out, on the port the compose file publishes", () => {
      const text = configText(name);
      if (expected.syslogService) {
        // Its syslog collector publishes the port; this container publishes none.
        expect(text).not.toContain("syslog/");
        expect(text).toContain(`\`${expected.syslogService}\` service`);
        return;
      }
      for (const line of [
        "  # syslog/tcp:",
        "  # syslog/udp:",
        '  #     listen_address: "0.0.0.0:5514"',
        "  #   protocol: rfc3164",
        "    # logs:",
        "    #   receivers: [syslog/tcp, syslog/udp]",
      ]) {
        expect(text).toContain(`${line}\n`);
      }
      const composeText = read(`${AGENT_DIR}/docker-compose.yml`);
      expect(composeText).toContain('#   - "5514:5514/tcp"');
      expect(composeText).toContain('#   - "5514:5514/udp"');
    });

    test("reads only variables .env provides", () => {
      const referenced = new Set(
        [...configText(name).matchAll(/\$\{env:([A-Z0-9_]+)\}/g)].map(
          (match) => {
            return match[1];
          },
        ),
      );
      for (const variable of referenced) {
        expect({ variable, known: CONFIG_ENV.includes(variable) }).toEqual({
          variable,
          known: true,
        });
      }
    });
  });

  test("label every endpoint ingest knows to read as a complete list", () => {
    /*
     * The extractors' markScrapedEndpoint turns a batch's scrape_endpoint
     * into "this batch is the complete list of these objects": `array` (the
     * array's own endpoint: its open alerts) for every platform, and each
     * other endpoint as its platform's StorageArrayPlatform.scrapeEndpoints
     * names it (#11000).
     */
    const extractor = read(
      "packages/Common/Server/Utils/Telemetry/StorageArray/StorageArrayExtractor.ts",
    );
    expect(extractor).toContain(
      'SCRAPE_ENDPOINT_LABEL: string = "scrape_endpoint"',
    );
    expect(extractor).toContain('value === "array"');
    // Every platform's folder: Platforms/<Vendor>/<Product>/<Product>Platform.ts.
    const platformsDir = "packages/Common/Types/StorageArray/Platforms";
    const platforms = fs
      .readdirSync(path.join(REPO_ROOT, platformsDir), { recursive: true })
      .filter((file) => {
        return /[\\/][A-Za-z]+Platform\.ts$/.test(file);
      })
      .map((file) => {
        return read(`${platformsDir}/${file}`);
      });
    expect(platforms.length).toBeGreaterThanOrEqual(3);
    const endpoints = new Set();
    for (const name of CONFIG_NAMES) {
      for (const job of scrapeConfigs(name)) {
        endpoints.add(job.static_configs[0].labels.scrape_endpoint);
      }
    }
    endpoints.delete("array");
    for (const endpoint of endpoints) {
      // `<endpoint>: [<kinds>]` in scrapeEndpoints (`[]` for an endpoint
      // that lists no object of a kind), its kinds on the line or, as
      // prettier wraps a long list, on the lines after it.
      expect({
        endpoint,
        known: platforms.some((platform) => {
          return new RegExp(
            `\\n    ${endpoint}: \\[\\s*(\\]|[A-Za-z_]+\\.)`,
          ).test(platform);
        }),
      }).toEqual({ endpoint, known: true });
    }
  });
});

describe("agents/StorageArrayAgent/docker-compose.yml", () => {
  test("runs the collector, Pure's two exporters, and Dell's exporter with PowerStore's syslog collector, nothing else", () => {
    expect(Object.keys(compose().services)).toEqual([
      COLLECTOR_SERVICE,
      "pure-fa-exporter",
      "pure-fb-exporter",
      "powerstore-exporter",
      "powerstore-syslog",
    ]);
  });

  test("reads only variables .env provides", () => {
    // ${NAME...} is Compose's; $${NAME} is a $ Compose leaves for a shell.
    const referenced = new Set(
      [
        ...read(`${AGENT_DIR}/docker-compose.yml`).matchAll(
          /(?<!\$)\$\{([A-Z0-9_]+)/g,
        ),
      ].map((match) => {
        return match[1];
      }),
    );
    for (const variable of referenced) {
      expect({
        variable,
        known: [...CONFIG_ENV, ...COMPOSE_ENV, ...PLATFORM_COMPOSE_ENV].includes(
          variable,
        ),
      }).toEqual({ variable, known: true });
    }
  });

  test("mounts the config .env names, and the default is the native FlashArray config", () => {
    const collector = compose().services[COLLECTOR_SERVICE];
    expect(collector.container_name).toBe(COLLECTOR_SERVICE);
    expect(collector.volumes).toEqual([
      "./${STORAGE_ARRAY_COLLECTOR_CONFIG:-otel-collector-config.yaml}:/etc/otelcol-contrib/config.yaml:ro",
    ]);
    expect(collector.env_file).toEqual([".env"]);
    expect(collector.restart).toBe("unless-stopped");
    expect(collector).not.toHaveProperty("profiles");
    // Syslog is opt-in: the port mapping ships commented out.
    expect(collector).not.toHaveProperty("ports");
  });

  test("defaults the two optional settings so an empty .env value cannot stop the collector", () => {
    expect(compose().services[COLLECTOR_SERVICE].environment).toEqual([
      "STORAGE_SYSTEM=${STORAGE_SYSTEM:-purestorage.flasharray}",
      "STORAGE_ARRAY_INSECURE_SKIP_VERIFY=${STORAGE_ARRAY_INSECURE_SKIP_VERIFY:-true}",
    ]);
  });

  /*
   * Dell's exporter logs in itself: StorageArrayAgentPowerStore.test.js holds
   * its service, its image and what it is given.
   */
  test.each(
    CONFIG_NAMES.filter((name) => {
      return CONFIGS[name].exporterService && !CONFIGS[name].exporterLogsIn;
    }),
  )(
    "starts the exporter %s scrapes, pinned, unpublished and credential-free, only under its profile",
    (name) => {
      const expected = CONFIGS[name];
      const service = compose().services[expected.exporterService];
      const port = expected.target.split(":")[1];

      expect(service.profiles).toEqual([expected.profile]);
      expect(service.image).toMatch(
        /^quay\.io\/purestorage\/pure-f[ab]-om-exporter:v\d+\.\d+\.\d+$/,
      );
      expect(service.expose).toEqual([port]);
      expect(service).not.toHaveProperty("ports");
      // The collector sends the address and token with every scrape.
      expect(service).not.toHaveProperty("env_file");
      expect(service).not.toHaveProperty("environment");
      expect(service.read_only).toBe(true);
      expect(service.cap_drop).toEqual(["ALL"]);
      expect(service.security_opt).toEqual(["no-new-privileges:true"]);
    },
  );

  test("names every shipped config where it explains the choice", () => {
    const text = read(`${AGENT_DIR}/docker-compose.yml`);
    for (const name of CONFIG_NAMES) {
      expect(text).toContain(name);
    }
  });
});

describe("agents/StorageArrayAgent/install.sh", () => {
  const script = read(`${AGENT_DIR}/install.sh`);

  test("gives each config the platform it reads and the profile that starts what it scrapes", () => {
    const mapping = installMapping();
    expect(Object.keys(mapping).sort()).toEqual([...CONFIG_NAMES].sort());
    for (const name of CONFIG_NAMES) {
      expect({ name, ...mapping[name] }).toEqual({
        name,
        system: CONFIGS[name].system,
        profile: CONFIGS[name].profile,
      });
    }
  });

  test("asks for each platform of its table, one line per config", () => {
    const platforms = installPlatforms();
    expect(
      platforms.map((platform) => {
        return platform.config;
      }),
    ).toEqual(CONFIG_NAMES);
    const services = compose().services;
    for (const platform of platforms) {
      const expected = CONFIGS[platform.config];
      if (expected.exporterLogsIn) {
        /*
         * The exporter logs in with a user and a password: they are the
         * exporter's alone, and the collector reads neither. The address is
         * the exporter's too, and names the array in every path.
         */
        expect(platform.userVariable).not.toBe("");
        const exporter = services[expected.exporterService].environment;
        for (const variable of [
          platform.endpointVariable,
          platform.userVariable,
          platform.tokenVariable,
        ]) {
          expect(exporter).toContain(`${variable}=\${${variable}:-}`);
        }
        expect(configText(platform.config)).not.toContain(
          `\${env:${platform.tokenVariable}}`,
        );
        expect(configText(platform.config)).not.toContain(
          `\${env:${platform.userVariable}}`,
        );
        expect(expected.pathPrefix).toContain(
          `\${env:${platform.endpointVariable}}`,
        );
      } else {
        // The variables the config itself reads its address and token from.
        expect(platform.userVariable).toBe("");
        expect(expected.token).toBe(`\${env:${platform.tokenVariable}}`);
        expect([expected.target, expected.endpointParam]).toContain(
          `\${env:${platform.endpointVariable}}`,
        );
      }
      // Only a config whose collector talks TLS to the array asks about it.
      expect(platform.tlsToArray).toBe(expected.exporterService ? "no" : "yes");
      expect(platform.menu).not.toBe("");
      expect(platform.readHow).not.toBe("");
      // Its other files ship next to install.sh, and its optional settings
      // are ones the compose file reads.
      for (const file of platform.otherFiles) {
        expect(fs.existsSync(path.join(REPO_ROOT, AGENT_DIR, file))).toBe(true);
      }
      for (const variable of platform.optionalVariables) {
        expect(read(`${AGENT_DIR}/docker-compose.yml`)).toContain(
          `\${${variable}:-`,
        );
      }
    }
  });

  test("downloads the compose file, the table's configs and their other files, each once", () => {
    expect(script).toMatch(
      /^AGENT_FILES="docker-compose.yml \$PLATFORM_CONFIGS \$PLATFORM_FILES"$/m,
    );
    expect(script).toContain(
      `PLATFORM_CONFIGS="$(platform_lines | cut -d '|' -f 1 | awk '!seen[$0]++' | tr '\\n' ' ')"`,
    );
    expect(script).toContain(
      `PLATFORM_FILES="$(platform_lines | cut -d '|' -f 11 | tr ' ' '\\n' | grep -v '^-$' | grep -v '^$' | awk '!seen[$0]++' | tr '\\n' ' ')"`,
    );
  });

  test("downloads the compose file and every config from this directory", () => {
    // From the OneUptime the agent reports to, or this folder on GitHub for an older one.
    expect(script).toContain('AGENT_FILES_PATH="install/storage-array-agent"');
    expect(script).toContain(
      'AGENT_FILES_ON_GITHUB="https://raw.githubusercontent.com/OneUptime/oneuptime/main/agents/StorageArrayAgent"',
    );
    const files = script.match(/^AGENT_FILES="([^"]+)"$/m);
    expect(files).not.toBeNull();
    // The table's configs and other files stand in their places.
    const downloaded = files[1]
      .split(" ")
      .flatMap((file) => {
        if (file === "$PLATFORM_CONFIGS") {
          return installPlatforms().map((platform) => {
            return platform.config;
          });
        }
        if (file === "$PLATFORM_FILES") {
          return [
            ...new Set(
              installPlatforms().flatMap((platform) => {
                return platform.otherFiles;
              }),
            ),
          ];
        }
        return [file];
      });
    expect([...downloaded].sort()).toEqual(
      ["docker-compose.yml", ...CONFIG_NAMES, ...OTHER_FILES].sort(),
    );
    for (const file of downloaded) {
      expect(fs.existsSync(path.join(REPO_ROOT, AGENT_DIR, file))).toBe(true);
    }
  });

  test("writes exactly the variables the configs and the compose file read, the user's ones quoted", () => {
    const heredoc = script.match(
      /cat > "\$ENV_FILE" <<ENVEOF\n([\s\S]*?)\nENVEOF/,
    );
    expect(heredoc).not.toBeNull();
    // The table's address and token variables are written by a function.
    expect(heredoc[1]).toContain("\n$(platform_env_lines)\n");
    const platformLines = shellFunction(script, "platform_env_lines");
    expect(platformLines).toContain("for name in $PLATFORM_VARIABLES; do");
    expect(platformLines).toContain(
      `printf '%s=%s\\n' "$name" "$(compose_env_quote "\${!name}")"`,
    );
    const written = heredoc[1]
      .split("\n")
      .filter((line) => {
        return line !== "$(platform_env_lines)";
      })
      .map((line) => {
        return line.split("=")[0];
      });
    expect([...written, ...installPlatformVariables()].sort()).toEqual(
      [...CONFIG_ENV, ...COMPOSE_ENV, ...PLATFORM_COMPOSE_ENV].sort(),
    );

    for (const name of [
      "ONEUPTIME_URL",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "STORAGE_ARRAY_NAME",
    ]) {
      expect(heredoc[1]).toContain(`${name}=$(compose_env_quote "$${name}")`);
    }
    // Validated shapes stay bare.
    for (const name of [
      "STORAGE_SYSTEM",
      "STORAGE_ARRAY_COLLECTOR_CONFIG",
      "COMPOSE_PROFILES",
      "STORAGE_ARRAY_INSECURE_SKIP_VERIFY",
    ]) {
      expect(heredoc[1]).toContain(`${name}=$${name}\n`.trimEnd());
    }
  });

  test("reuses an existing .env, and reads every value it writes back", () => {
    expect(shellFunction(script, "dotenv_get")).toContain(
      'raw=$(grep "^[[:space:]]*$name=" "$file" 2>/dev/null | tail -1) || true',
    );
    const reused = script.match(/for name in ([\s\S]*?); do\n/);
    expect(reused).not.toBeNull();
    const names = reused[1]
      .replace(/\\\n/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((name) => {
        // The table's address, token, user and optional variables, by name.
        return name === "$PLATFORM_VARIABLES"
          ? installPlatformVariables()
          : [name];
      });
    // COMPOSE_PROFILES always follows from the config, so it is never reused.
    expect(names.sort()).toEqual(
      [
        ...CONFIG_ENV,
        "STORAGE_ARRAY_COLLECTOR_CONFIG",
        ...PLATFORM_COMPOSE_ENV,
      ].sort(),
    );
  });

  /*
   * A re-run is the upgrade. Compose recreates a running container only when
   * its service definition or environment changed, never for a new config
   * file (a bind mount), and the collector reads its config only when it
   * starts: the script forces it, so the collector starts on the config just
   * downloaded and reports the oneuptime.agent.version that config stamps.
   */
  test("recreates the containers it starts, so a re-run runs the config it downloaded", () => {
    const starts = script.split("\n").filter((line) => {
      return /^\s*(if ! )?docker compose up\b/.test(line);
    });
    expect(starts).toEqual([
      "if ! docker compose up -d --force-recreate; then",
    ]);
  });

  test("installs where the systemd unit and the doctor script look", () => {
    expect(script).toContain(`INSTALL_DIR="\${INSTALL_DIR:-${INSTALL_DIR}}"`);
    expect(
      read(`${AGENT_DIR}/systemd/oneuptime-storage-array-agent.service`),
    ).toContain(`WorkingDirectory=${INSTALL_DIR}\n`);
    expect(read(`${AGENT_DIR}/troubleshoot.sh`)).toContain(
      `DIR="${INSTALL_DIR}"`,
    );
  });
});

describe("agents/StorageArrayAgent/troubleshoot.sh", () => {
  const script = read(`${AGENT_DIR}/troubleshoot.sh`);

  test("looks for the container the compose file names", () => {
    expect(script).toContain(`AGENT_CONTAINER="${COLLECTOR_SERVICE}"`);
  });

  test("knows every shipped config and probes each the way its config scrapes", () => {
    const arms = script.match(/case "\$CONFIG_NAME" in\n([\s\S]*?)\nesac/);
    expect(arms).not.toBeNull();
    for (const name of CONFIG_NAMES) {
      expect({ name, arm: arms[1].includes(`  ${name})\n`) }).toEqual({
        name,
        arm: true,
      });
    }
    expect(script).toContain(
      'PROBE_URL="https://$ENDPOINT/metrics/array?namespace=purefa"',
    );
    expect(script).toContain(
      'PROBE_URL="http://pure-fa-exporter:9490/metrics/array?endpoint=$ENDPOINT"',
    );
    expect(script).toContain(
      'PROBE_URL="http://pure-fb-exporter:9491/metrics/array?endpoint=$ENDPOINT"',
    );
    // Dell's exporter: the cluster in the path, as the powerstore-cluster job.
    const cluster = scrapeConfigs("otel-collector-config.powerstore.yaml")[0];
    expect(cluster.job_name).toBe("powerstore-cluster");
    expect(script).toContain(
      `PROBE_URL="http://${cluster.static_configs[0].targets[0]}${cluster.metrics_path.replace("${env:POWERSTORE_ENDPOINT}", "$ENDPOINT")}"`,
    );
  });

  test("never prints an array's token or password, nor hands it to a probe that does not need it", () => {
    // Read once, tested for being set and for its shape, and sent once: to
    // curl's stdin, for Pure's probes. Dell's exporter holds the password.
    const uses = script
      .split("\n")
      .filter((line) => {
        return /\$\{?ARRAY_TOKEN\b|\bARRAY_TOKEN=/.test(line);
      })
      .map((line) => {
        return line.trim();
      });
    expect(uses).toEqual([
      'ARRAY_TOKEN=$(agent_env "$TOKEN_VAR")',
      'if [ -z "$(agent_env POWERSTORE_USERNAME)" ] || [ -z "$ARRAY_TOKEN" ]; then',
      'elif [ -z "$ARRAY_TOKEN" ]; then',
      'if [[ "$ARRAY_TOKEN" =~ ^T-$TOKEN_UUID$ ]]; then',
      'if [[ "$ARRAY_TOKEN" =~ ^$TOKEN_UUID$ ]]; then',
      "PROBE_OUT=$(printf 'Authorization: Bearer %s\\n' \"$ARRAY_TOKEN\" \\",
    ]);
    // The PowerStore probe comes before Pure's and carries no credential.
    const powerstoreProbe = script.slice(
      script.indexOf('if [ "$ARRAY_VERDICT" = "UNKNOWN" ] && [ "$MODE" = "powerstore" ]; then'),
      script.indexOf("declare -a PROBE_ARGS=()"),
    );
    expect(powerstoreProbe).toContain(
      `PROBE_OUT=$(agent_netns_curl -sS -m 120 -w $'\\nOUSTATUS:%{http_code}' "$PROBE_URL")`,
    );
    expect(powerstoreProbe).not.toMatch(/\$\{?ARRAY_TOKEN|-H |DOCKER_RUN_EXTRA/);
  });

  test("hands the array's API token to curl on stdin, never on a command line", () => {
    expect(script).toContain(
      "printf 'Authorization: Bearer %s\\n' \"$ARRAY_TOKEN\"",
    );
    expect(script).toContain("-H @-");
    expect(script).not.toMatch(/-H "Authorization: Bearer \$ARRAY_TOKEN"/);
  });
});

describe("agents/StorageArrayAgent/systemd/oneuptime-storage-array-agent.service", () => {
  test("links the install guide the docs ship", () => {
    const unit = read(
      `${AGENT_DIR}/systemd/oneuptime-storage-array-agent.service`,
    );
    const docs = unit.match(
      /^Documentation=https:\/\/oneuptime\.com\/docs\/(.+)$/m,
    );
    expect(docs).not.toBeNull();
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "packages/App/FeatureSet/Docs/Content/en",
          `${docs[1]}.md`,
        ),
      ),
    ).toBe(true);
  });
});
