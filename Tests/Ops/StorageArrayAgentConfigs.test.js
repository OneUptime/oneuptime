"use strict";

/**
 * The Storage Array Agent (agents/StorageArrayAgent): three collector
 * configs — a FlashArray's native OpenMetrics endpoint, Pure's FlashArray
 * exporter for an older Purity//FA, Pure's FlashBlade exporter — the compose
 * file that runs one of them, and the scripts and unit that install it.
 *
 * OneUptime registers and inventories an array from what these configs
 * stamp and how they scrape, so their shape is part of the product:
 *
 *  - the `resource` processor UPSERTS `storage.array.name` (the join key)
 *    and `storage.system`, and DELETES `service.name` /
 *    `service.instance.id`, which the prometheus receiver synthesizes from
 *    the job name — left in, the batch routes to a phantom Service;
 *  - every scrape job labels its series `scrape_endpoint: <endpoint>`: ingest
 *    (StorageArraySnapshotScan) reads it to know which inventory families a
 *    batch is the complete list of, so a deleted volume leaves the inventory;
 *  - the `batch` processor has no `send_batch_max_size`, so a scrape is never
 *    split across exports (ingest rebuilds the inventory per request);
 *  - the native config scrapes https://<array>/metrics/<endpoint> with
 *    `namespace=purefa`, the exporter configs scrape the compose service with
 *    `endpoint=<array>`, all with the read-only user's API token as a Bearer
 *    token;
 *  - docker-compose.yml mounts the config STORAGE_ARRAY_COLLECTOR_CONFIG
 *    names and starts the exporter that config scrapes only under its
 *    profile, and install.sh writes the two consistently.
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
};
const CONFIG_NAMES = Object.keys(CONFIGS);

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
 * install.sh's `case "$STORAGE_ARRAY_COLLECTOR_CONFIG" in` table: config →
 * the STORAGE_SYSTEM and COMPOSE_PROFILES it sets.
 */
function installMapping() {
  const script = read(`${AGENT_DIR}/install.sh`);
  const table = script.match(
    /case "\$STORAGE_ARRAY_COLLECTOR_CONFIG" in\n([\s\S]*?)\nesac/,
  );
  expect(table).not.toBeNull();
  const mapping = {};
  for (const arm of table[1].matchAll(
    /^\s{4}(otel-collector-config[a-z.-]*\.yaml)\)\n\s+STORAGE_SYSTEM="([^"]*)"\n\s+COMPOSE_PROFILES="([^"]*)"/gm,
  )) {
    mapping[arm[1]] = { system: arm[2], profile: arm[3] };
  }
  return mapping;
}

describe("agents/StorageArrayAgent collector configs", () => {
  describe.each(CONFIG_NAMES)("%s", (name) => {
    const expected = CONFIGS[name];

    test("scrapes exactly the endpoints of its platform, each at its interval", () => {
      expect(
        scrapeConfigs(name).map((job) => {
          return [
            job.job_name,
            job.metrics_path.replace("/metrics/", ""),
            job.scrape_interval,
          ];
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
          labels: {
            scrape_endpoint: job.metrics_path.replace("/metrics/", ""),
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

    test("reaches the array the way its platform serves metrics, with the read-only user's API token", () => {
      for (const job of scrapeConfigs(name)) {
        expect(job.scheme).toBe(expected.scheme);
        expect(job.static_configs[0].targets).toEqual([expected.target]);
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
      if (expected.endpointParam) {
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
        const endpoint = job.metrics_path.replace("/metrics/", "");
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

    test("stamps the array identity and deletes the receiver's service identity", () => {
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
          { key: "service.name", action: "delete" },
          { key: "service.instance.id", action: "delete" },
        ],
      });
    });

    test("never splits a scrape across exports", () => {
      const { batch } = config(name).processors;
      expect(batch.send_batch_size).toBe(8192);
      expect(batch).not.toHaveProperty("send_batch_max_size");
      expect(configText(name)).toContain("deliberately NO send_batch_max_size");
    });

    test("runs one metrics pipeline into OneUptime, and nothing that would re-identify the batch", () => {
      const parsed = config(name);
      expect(Object.keys(parsed.receivers)).toEqual(["prometheus"]);
      expect(Object.keys(parsed.processors).sort()).toEqual([
        "batch",
        "memory_limiter",
        "resource",
      ]);
      expect(parsed.exporters).toEqual({
        otlphttp: {
          endpoint: "${env:ONEUPTIME_URL}/otlp",
          headers: {
            "x-oneuptime-token": "${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}",
          },
        },
      });
      expect(parsed.service.pipelines).toEqual({
        metrics: {
          receivers: ["prometheus"],
          processors: ["memory_limiter", "resource", "batch"],
          exporters: ["otlphttp"],
        },
      });
    });

    test("ships the syslog option commented out, on the port the compose file publishes", () => {
      const text = configText(name);
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
     * StorageArraySnapshotScan.markScrapedEndpoint turns a batch's
     * scrape_endpoint into "this batch is the complete list of these
     * objects". Directories have no count of their own, so they are the one
     * endpoint ingest does not need to know.
     */
    const scan = read(
      "packages/Common/Server/Utils/Telemetry/StorageArraySnapshotScan.ts",
    );
    expect(scan).toContain('SCRAPE_ENDPOINT_LABEL: string = "scrape_endpoint"');
    const endpoints = new Set();
    for (const name of CONFIG_NAMES) {
      for (const job of scrapeConfigs(name)) {
        endpoints.add(job.static_configs[0].labels.scrape_endpoint);
      }
    }
    endpoints.delete("directories");
    for (const endpoint of endpoints) {
      expect({
        endpoint,
        known: scan.includes(`value === "${endpoint}"`),
      }).toEqual({ endpoint, known: true });
    }
  });
});

describe("agents/StorageArrayAgent/docker-compose.yml", () => {
  test("runs the collector and Pure's two exporters, nothing else", () => {
    expect(Object.keys(compose().services)).toEqual([
      COLLECTOR_SERVICE,
      "pure-fa-exporter",
      "pure-fb-exporter",
    ]);
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

  test.each(
    CONFIG_NAMES.filter((name) => {
      return CONFIGS[name].exporterService;
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

  test("downloads the compose file and every config from this directory", () => {
    expect(script).toContain(
      'REPO_BASE="https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent"',
    );
    const files = script.match(/^AGENT_FILES="([^"]+)"$/m);
    expect(files).not.toBeNull();
    expect(files[1].split(" ").sort()).toEqual(
      ["docker-compose.yml", ...CONFIG_NAMES].sort(),
    );
    for (const file of files[1].split(" ")) {
      expect(fs.existsSync(path.join(REPO_ROOT, AGENT_DIR, file))).toBe(true);
    }
  });

  test("writes exactly the variables the configs and the compose file read, the user's ones quoted", () => {
    const heredoc = script.match(
      /cat > "\$ENV_FILE" <<ENVEOF\n([\s\S]*?)\nENVEOF/,
    );
    expect(heredoc).not.toBeNull();
    const written = heredoc[1].split("\n").map((line) => {
      return line.split("=")[0];
    });
    expect([...written].sort()).toEqual([...CONFIG_ENV, ...COMPOSE_ENV].sort());

    for (const name of [
      "ONEUPTIME_URL",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "STORAGE_ARRAY_NAME",
      "PURE_FA_ENDPOINT",
      "PURE_FA_API_TOKEN",
      "PURE_FB_ENDPOINT",
      "PURE_FB_API_TOKEN",
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
    const names = reused[1].replace(/\\\n/g, " ").split(/\s+/).filter(Boolean);
    // COMPOSE_PROFILES always follows from the config, so it is never reused.
    expect(names.sort()).toEqual(
      [...CONFIG_ENV, "STORAGE_ARRAY_COLLECTOR_CONFIG"].sort(),
    );
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
