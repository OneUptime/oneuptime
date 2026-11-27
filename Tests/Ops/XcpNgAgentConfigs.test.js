"use strict";

/**
 * The XCP-ng Agent (agents/XcpNgAgent): a stock collector scraping Xen
 * Orchestra's OpenMetrics plugin, the compose file that runs it, and the
 * scripts and unit that install it.
 *
 * OneUptime registers each XCP-ng pool, and reads every series of it, from
 * what this config sends, so its shape is part of the product:
 *
 *  - one scrape of https://<XO>/openmetrics/metrics a minute, with the
 *    plugin's secret as a Bearer token and Xen Orchestra's certificate
 *    checked against xo-ca.pem (never skipped), keeping Xen Orchestra's
 *    timestamps;
 *  - only xcp_* series leave the collector (xo_* and the receiver's scrape
 *    series belong to no pool);
 *  - THE TRAP: the eight series Xen Orchestra types `counter` but fills with
 *    XAPI's per-second rates become gauges - exactly those eight, which are
 *    exactly the counters Xen Orchestra serves, and exactly the list
 *    OneUptime's ingest knows (XCP_NG_RATE_TYPED_AS_COUNTER_SERIES);
 *  - one OTLP resource per pool, stamped xcp_ng.pool.id / xcp_ng.pool.name
 *    (the pool_id / pool_name labels, moved), xen_orchestra.name and
 *    oneuptime.agent.version (the compose pin), with service.name and
 *    service.instance.id deleted, and what has no pool (the IPMI host power
 *    the plugin labels without pool_id) dropped;
 *  - the batch processor never splits a scrape.
 *
 * `otelcol validate` (validate-collector-configs.sh) proves the config
 * starts, xcp-ng-agent-scrape-behaviour.sh proves what it sends against a
 * stand-in Xen Orchestra, and XcpNgAgentScripts.test.js runs the scripts;
 * this proves the files say the right thing.
 */

const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");
const {
  buildXenOrchestraScrape,
  RATE_TYPED_AS_COUNTER,
} = require("./Fixtures/XcpNg/XenOrchestraScrape");
const { entryForAgentDirectory } = require("./Utils/InstallScriptsCatalog");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = "agents/XcpNgAgent";
const SERVICE = "oneuptime-xcp-ng-agent";
const INSTALL_DIR = "/opt/oneuptime-xcp-ng-agent";
const CA_FILE_IN_CONTAINER = "/etc/oneuptime/xo-ca.pem";
const PROCESSORS = [
  "memory_limiter",
  "filter/xcp-ng-only",
  "transform/xcp-ng-rates",
  "groupbyattrs/xcp-ng-pool",
  "resource",
  "transform/xen-orchestra",
  "filter/xcp-ng-pool-only",
  "batch",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function configText() {
  return read(`${AGENT_DIR}/otel-collector-config.yaml`);
}

function config() {
  return yaml.load(configText());
}

function compose() {
  return yaml.load(read(`${AGENT_DIR}/docker-compose.yml`));
}

function composePin() {
  const image = compose().services[SERVICE].image;
  return image.substring(image.lastIndexOf(":") + 1);
}

/*
 * packages/Common/Types/XcpNg/XcpNgTelemetry.ts, loaded as the module it is
 * (it imports nothing): the names OneUptime's ingest reads, so the agent is
 * held to them rather than to a copy.
 */
function loadTelemetryContract() {
  const file = path.join(
    REPO_ROOT,
    "packages/Common/Types/XcpNg/XcpNgTelemetry.ts",
  );
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
    fileName: file,
  });
  const loaded = new Module(file);
  loaded.filename = file;
  loaded.paths = [];
  loaded._compile(outputText, file);
  return loaded.exports;
}

const CONTRACT = loadTelemetryContract();

// Every ${VAR} docker-compose.yml interpolates ($$ is a literal $).
function composeVariables() {
  const text = JSON.stringify(compose()).replace(/\$\$/g, "");
  return [
    ...new Set(
      Array.from(text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)).map(
        (match) => {
          return match[1];
        },
      ),
    ),
  ].sort();
}

function shellFunction(script, name) {
  const start = script.indexOf(`\n${name}() {\n`);
  expect({ name, found: start > -1 }).toEqual({ name, found: true });
  const end = script.indexOf("\n}\n", start);
  return script.slice(start + 1, end + 2);
}

function envNames(script) {
  const match = script.match(/^ENV_NAMES="([^"]+)"$/m);
  expect(match).not.toBeNull();
  return match[1].replace(/\\\n/g, " ").split(/\s+/).filter(Boolean);
}

function heredoc(script) {
  const match = script.match(/cat > "\$ENV_FILE" <<ENVEOF\n([\s\S]*?)\nENVEOF/);
  expect(match).not.toBeNull();
  return match[1].split("\n");
}

// The sample lines of the recorded scrape: name, labels and value.
function scrapeSamples(scrape) {
  return buildXenOrchestraScrape({ scrape, nowSeconds: 1795000000 })
    .split("\n")
    .filter((line) => {
      return line && !line.startsWith("#");
    })
    .map((line) => {
      const match = /^([a-z_]+)(?:\{(.*)\})? (\S+)(?: (\d+))?$/.exec(line);
      expect({ line, parsed: Boolean(match) }).toEqual({ line, parsed: true });
      const labels = {};
      for (const pair of (match[2] || "").matchAll(/([a-z_]+)="([^"]*)"/g)) {
        labels[pair[1]] = pair[2];
      }
      return { name: match[1], labels, value: Number(match[3]) };
    });
}

// What each # TYPE line of the recorded scrape types its series.
function scrapeTypes() {
  const types = {};
  const body = buildXenOrchestraScrape({ scrape: 1, nowSeconds: 1795000000 });
  for (const match of body.matchAll(/^# TYPE (\S+) (\S+)$/gm)) {
    types[match[1]] = match[2];
  }
  return types;
}

describe("agents/XcpNgAgent/otel-collector-config.yaml", () => {
  const scrape = () => {
    const jobs = config().receivers.prometheus.config.scrape_configs;
    expect(jobs).toHaveLength(1);
    return jobs[0];
  };

  test("scrapes Xen Orchestra's OpenMetrics endpoint once a minute, as one job", () => {
    const job = scrape();
    expect(job).toEqual({
      job_name: "oneuptime-xcp-ng",
      scheme: "${env:XO_SCHEME}",
      metrics_path: "/openmetrics/metrics",
      scrape_interval: "60s",
      scrape_timeout: "50s",
      honor_timestamps: true,
      authorization: {
        type: "Bearer",
        credentials: "${env:XO_OPENMETRICS_SECRET} ",
      },
      tls_config: {
        ca_file: CA_FILE_IN_CONTAINER,
        server_name: "${env:XO_TLS_SERVER_NAME}",
      },
      static_configs: [{ targets: ["xo=${env:XO_ADDRESS}"] }],
      relabel_configs: [
        {
          source_labels: ["__address__"],
          regex: "xo=(.+)",
          target_label: "__address__",
        },
      ],
    });
    expect(Object.keys(config().receivers)).toEqual(["prometheus"]);
  });

  test("waits long enough for a slow pool, and never past the next scrape", () => {
    const seconds = (value) => {
      return Number(/^(\d+)s$/.exec(value)[1]);
    };
    const job = scrape();
    // The plugin waits up to 10 s for each host's RRDs, five hosts at a time.
    expect(seconds(job.scrape_timeout)).toBeGreaterThanOrEqual(30);
    expect(seconds(job.scrape_timeout)).toBeLessThan(
      seconds(job.scrape_interval),
    );
  });

  test("never skips the certificate check, anywhere", () => {
    expect(configText()).not.toMatch(/insecure_skip_verify/);
    expect(configText()).not.toMatch(/\binsecure\b/);
    expect(scrape().tls_config).not.toHaveProperty("insecure_skip_verify");
  });

  test("keeps the pools' series and nothing else", () => {
    expect(config().processors["filter/xcp-ng-only"]).toEqual({
      error_mode: "ignore",
      metrics: { metric: ['not IsMatch(metric.name, "^xcp_")'] },
    });
    // What it drops of a recorded scrape: Xen Orchestra's own series only.
    const dropped = new Set(
      scrapeSamples(1)
        .map((sample) => {
          return sample.name;
        })
        .filter((name) => {
          return !/^xcp_/.test(name);
        }),
    );
    expect([...dropped].every((name) => name.startsWith("xo_"))).toBe(true);
    expect(dropped.size).toBeGreaterThan(5);
  });

  test("turns exactly the eight rate series Xen Orchestra types counter into gauges, by name", () => {
    const transform = config().processors["transform/xcp-ng-rates"];
    expect(transform.error_mode).toBe("ignore");
    expect(transform.metric_statements).toHaveLength(1);
    expect(transform.metric_statements[0].context).toBe("metric");
    const names = transform.metric_statements[0].statements.map((statement) => {
      const match =
        /^convert_sum_to_gauge\(\) where metric\.name == "([a-z_]+)"$/.exec(
          statement,
        );
      expect({ statement, isConvert: Boolean(match) }).toEqual({
        statement,
        isConvert: true,
      });
      return match[1];
    });
    expect(names).toHaveLength(8);
    expect([...names].sort()).toEqual(
      [...CONTRACT.XCP_NG_RATE_TYPED_AS_COUNTER_SERIES].sort(),
    );
    expect([...names].sort()).toEqual([...RATE_TYPED_AS_COUNTER].sort());
  });

  test("the eight are every counter Xen Orchestra serves, and no gauge is touched", () => {
    const types = scrapeTypes();
    const counters = Object.keys(types).filter((name) => {
      return types[name] === "counter";
    });
    expect(counters.sort()).toEqual(
      [...CONTRACT.XCP_NG_RATE_TYPED_AS_COUNTER_SERIES].sort(),
    );
    // Rates: they go down between two scrapes, which a counter never does.
    const first = scrapeSamples(1);
    const second = scrapeSamples(2);
    const wentDown = counters.filter((name) => {
      const sum = (samples) => {
        return samples
          .filter((sample) => {
            return sample.name === name;
          })
          .reduce((total, sample) => {
            return total + sample.value;
          }, 0);
      };
      return sum(second) < sum(first);
    });
    expect(wentDown.length).toBeGreaterThan(0);
  });

  test("groups the series into one resource per pool, by the pool's labels", () => {
    expect(config().processors["groupbyattrs/xcp-ng-pool"]).toEqual({
      keys: [CONTRACT.XcpNgLabel.PoolId, CONTRACT.XcpNgLabel.PoolName],
    });
  });

  test("stamps each pool's identity, the Xen Orchestra and the agent version, and drops the job's", () => {
    expect(config().processors.resource).toEqual({
      attributes: [
        {
          key: CONTRACT.XCP_NG_POOL_ID_ATTRIBUTE,
          from_attribute: "pool_id",
          action: "upsert",
        },
        {
          key: CONTRACT.XCP_NG_POOL_NAME_ATTRIBUTE,
          from_attribute: "pool_name",
          action: "upsert",
        },
        { key: "pool_id", action: "delete" },
        { key: "pool_name", action: "delete" },
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
    expect(configText()).toContain(
      `      - key: oneuptime.agent.version\n        value: "${composePin()}"\n        action: upsert\n`,
    );
    // The Xen Orchestra's name, from inside an OTTL string (the next test).
    expect(config().processors["transform/xen-orchestra"]).toEqual({
      error_mode: "ignore",
      metric_statements: [
        {
          context: "resource",
          statements: [
            `set(resource.attributes["${CONTRACT.XEN_ORCHESTRA_NAME_ATTRIBUTE}"], "\${env:XO_NAME}")`,
            `delete_key(resource.attributes, "${CONTRACT.XEN_ORCHESTRA_NAME_ATTRIBUTE}") where resource.attributes["${CONTRACT.XEN_ORCHESTRA_NAME_ATTRIBUTE}"] == ""`,
          ],
        },
      ],
    });
  });

  /*
   * A value that is one ${env:...} and nothing else, collector 0.165.0 reads
   * as YAML (measured): an IPv6 XO_ADDRESS ([fd00::5]:443) or a secret like
   * `[x]` or `a: b` stopped the config loading, a secret like `TRUE`, `+12`,
   * `1e3`, `0x1F` or `null` reached Xen Orchestra as another value, and an
   * XO_NAME like `XO: lab` arrived as a map, `2026` as a number. So none of
   * the values a person types is one on its own.
   */
  test("reads every value a person types as text: none is a ${env:...} on its own", () => {
    const wholeValue = /^\$\{env:([A-Z_]+)\}$/;
    const wholeValues = [];
    const walk = (node, where) => {
      if (typeof node === "string") {
        const match = wholeValue.exec(node);
        if (match) {
          wholeValues.push(`${where}: ${match[1]}`);
        }
      } else if (Array.isArray(node)) {
        node.forEach((item, index) => {
          walk(item, `${where}[${index}]`);
        });
      } else if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          walk(value, `${where}.${key}`);
        }
      }
    };
    walk(config(), "config");
    // What remains whole: the scheme and the name the certificate is checked
    // against (install.sh writes only https or http, and a host name), and
    // the ingestion key (a UUID, read by a string field of the exporter).
    expect(wholeValues.sort()).toEqual(
      [
        "config.exporters.otlp_http.headers.x-oneuptime-token: ONEUPTIME_TELEMETRY_INGESTION_KEY",
        "config.receivers.prometheus.config.scrape_configs[0].scheme: XO_SCHEME",
        "config.receivers.prometheus.config.scrape_configs[0].tls_config.server_name: XO_TLS_SERVER_NAME",
      ].sort(),
    );
    // The secret, followed by a space HTTP drops (and Xen Orchestra trims).
    expect(configText()).toContain(
      'credentials: "${env:XO_OPENMETRICS_SECRET} "',
    );
    // The name is the only value inside an OTTL string: install.sh refuses
    // the quote and the backslash that would end or escape it.
    expect(read(`${AGENT_DIR}/install.sh`)).toContain(
      'echo "Error: XO_NAME must not contain a double quote or a backslash."',
    );
  });

  test("drops what is left without a pool, which in a recorded scrape is the IPMI host power alone", () => {
    expect(config().processors["filter/xcp-ng-pool-only"]).toEqual({
      error_mode: "ignore",
      metrics: {
        metric: [
          `resource.attributes["${CONTRACT.XCP_NG_POOL_ID_ATTRIBUTE}"] == nil`,
        ],
      },
    });
    for (const scrapeIndex of [1, 2]) {
      const withoutPool = scrapeSamples(scrapeIndex).filter((sample) => {
        return sample.name.startsWith("xcp_") && !sample.labels.pool_id;
      });
      expect(withoutPool.length).toBeGreaterThan(0);
      for (const sample of withoutPool) {
        expect({ name: sample.name, source: sample.labels.source }).toEqual({
          name: CONTRACT.XcpNgSeries.HostPowerConsumptionWatts,
          source: "ipmi",
        });
      }
    }
  });

  test("never splits a scrape across exports", () => {
    const { batch } = config().processors;
    expect(batch).toEqual({ timeout: "10s", send_batch_size: 8192 });
    expect(configText()).toContain("deliberately NO send_batch_max_size");
  });

  test("runs one metrics pipeline, in the order each step needs, into OneUptime", () => {
    const parsed = config();
    expect(Object.keys(parsed.processors).sort()).toEqual(
      [...PROCESSORS].sort(),
    );
    expect(parsed.service.pipelines).toEqual({
      metrics: {
        receivers: ["prometheus"],
        processors: PROCESSORS,
        exporters: ["otlp_http"],
      },
    });
    // By its type, not the otlphttp alias collector 0.165.0 warns about.
    expect(parsed.exporters).toEqual({
      otlp_http: {
        endpoint: "${env:ONEUPTIME_URL}/otlp",
        headers: {
          "x-oneuptime-token": "${env:ONEUPTIME_TELEMETRY_INGESTION_KEY}",
        },
      },
    });
    expect(parsed.processors.memory_limiter).toEqual({
      check_interval: "5s",
      limit_mib: 512,
      spike_limit_mib: 128,
    });
  });

  test("reads only variables the compose file passes it", () => {
    const referenced = [
      ...new Set(
        Array.from(configText().matchAll(/\$\{env:([A-Z_]+)\}/g)).map(
          (match) => {
            return match[1];
          },
        ),
      ),
    ].sort();
    const passed = compose().services[SERVICE].environment.map((line) => {
      return line.split("=")[0];
    });
    expect(referenced).toEqual([
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
      "ONEUPTIME_URL",
      "XO_ADDRESS",
      "XO_NAME",
      "XO_OPENMETRICS_SECRET",
      "XO_SCHEME",
      "XO_TLS_SERVER_NAME",
    ]);
    for (const name of referenced) {
      expect({ name, passed: passed.includes(name) }).toEqual({
        name,
        passed: true,
      });
    }
  });
});

describe("agents/XcpNgAgent/docker-compose.yml", () => {
  test("runs the pinned stock collector and nothing else, hardened", () => {
    const parsed = compose();
    expect(Object.keys(parsed.services)).toEqual([SERVICE]);
    const service = parsed.services[SERVICE];
    expect(service.image).toBe(
      `otel/opentelemetry-collector-contrib:${composePin()}`,
    );
    expect(service.container_name).toBe(SERVICE);
    expect(service.read_only).toBe(true);
    expect(service.cap_drop).toEqual(["ALL"]);
    expect(service.security_opt).toEqual(["no-new-privileges:true"]);
    expect(service.restart).toBe("unless-stopped");
    expect(service.logging).toEqual({
      driver: "json-file",
      options: { "max-size": "10m", "max-file": "3" },
    });
    expect(service).not.toHaveProperty("ports");
    expect(service).not.toHaveProperty("env_file");
    expect(service).not.toHaveProperty("profiles");
  });

  test("mounts the config, and xo-ca.pem where the config reads it, never creating it", () => {
    const { volumes } = compose().services[SERVICE];
    expect(volumes).toEqual([
      "./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro",
      {
        type: "bind",
        source: "./xo-ca.pem",
        target: CA_FILE_IN_CONTAINER,
        read_only: true,
        bind: { create_host_path: false },
      },
    ]);
    expect(
      config().receivers.prometheus.config.scrape_configs[0].tls_config.ca_file,
    ).toBe(volumes[1].target);
  });

  test("passes exactly what the config reads, with defaults for the optional ones", () => {
    expect(compose().services[SERVICE].environment).toEqual([
      "ONEUPTIME_URL=${ONEUPTIME_URL}",
      "ONEUPTIME_TELEMETRY_INGESTION_KEY=${ONEUPTIME_TELEMETRY_INGESTION_KEY}",
      "XO_SCHEME=${XO_SCHEME:-https}",
      "XO_ADDRESS=${XO_ADDRESS}",
      "XO_OPENMETRICS_SECRET=${XO_OPENMETRICS_SECRET}",
      // Its address when unset, with no second "not set" warning (ComposeQuietStart).
      "XO_NAME=${XO_NAME:-${XO_ADDRESS:-}}",
      "XO_TLS_SERVER_NAME=${XO_TLS_SERVER_NAME:-}",
    ]);
  });
});

describe("agents/XcpNgAgent/install.sh, statically", () => {
  const script = read(`${AGENT_DIR}/install.sh`);

  test("keeps every variable docker-compose.yml reads, and the three it reads again itself", () => {
    const names = envNames(script);
    expect([...names].sort()).toEqual(
      [
        ...composeVariables(),
        "XO_URL",
        "XO_TLS_FINGERPRINT",
        "XO_CA_FILE",
      ].sort(),
    );
    const lines = heredoc(script);
    // The marker that says the secret is escaped for the collector comes first.
    expect(lines[0]).toBe("$COLLECTOR_ESCAPE_MARKER");
    expect(
      lines.slice(1).map((line) => {
        return line.split("=")[0];
      }),
    ).toEqual(names);
  });

  test("quotes every value for Compose but the validated scheme, and escapes the secret for the collector", () => {
    const lines = heredoc(script);
    for (const name of envNames(script)) {
      let expected = `${name}=$(compose_env_quote "$${name}")`;
      if (name === "XO_SCHEME") {
        expected = `${name}=$${name}`;
      }
      if (name === "XO_OPENMETRICS_SECRET") {
        expected = `${name}=$(compose_env_quote "$(collector_env_escape "$${name}")")`;
      }
      expect(lines).toContain(expected);
    }
    expect(script).toContain(
      'printf -v "$name" \'%s\' "$(collector_env_unescape "${!name}")"',
    );
  });

  test("reads an existing .env back, and keeps edited files, with the other installers' own helpers", () => {
    const vmware = read("agents/VMwareAgent/install.sh");
    const database = read("agents/DatabaseAgent/install.sh");
    for (const name of ["compose_env_quote", "dotenv_get"]) {
      expect(shellFunction(script, name)).toBe(shellFunction(vmware, name));
    }
    for (const name of [
      "file_sha256",
      "download_agent_file",
      "collector_env_escape",
      "collector_env_unescape",
    ]) {
      expect(shellFunction(script, name)).toBe(shellFunction(database, name));
    }
    expect(script).toContain(
      'printf -v "$name" \'%s\' "$(dotenv_get "$name" "$ENV_FILE")"',
    );
  });

  test("downloads the compose file and the config, and never a certificate", () => {
    const downloads = Array.from(
      script.matchAll(/^download_agent_file "([^"]+)"/gm),
    ).map((match) => {
      return match[1];
    });
    expect(downloads).toEqual([
      "docker-compose.yml",
      "otel-collector-config.yaml",
    ]);
    expect(script).toContain('CA_PEM="$INSTALL_DIR/xo-ca.pem"');
  });

  test("never turns certificate checking off", () => {
    expect(script).not.toMatch(/(^|\s)(-k|--insecure)(\s|$)/m);
    expect(script).not.toMatch(/insecure_skip_verify/);
    expect(script).not.toMatch(/-verify_return_error|NO_VERIFY/);
  });

  test("asks for the secret without echoing it, and prints it nowhere", () => {
    expect(script).toContain(
      'read -rsp "OpenMetrics plugin secret (Xen Orchestra: Settings → Plugins → openmetrics): " XO_OPENMETRICS_SECRET',
    );
    for (const line of script.split("\n")) {
      if (/\becho\b/.test(line)) {
        expect(line).not.toContain('XO_OPENMETRICS_SECRET"');
        expect(line).not.toMatch(/\$\{?XO_OPENMETRICS_SECRET/);
      }
    }
    // It reaches curl on stdin.
    expect(script).toContain(
      "printf 'Authorization: Bearer %s\\n' \"$XO_OPENMETRICS_SECRET\"",
    );
  });

  test("pulls, then starts the agent once, recreating it, so a re-run runs the files it downloaded", () => {
    const starts = script.split("\n").filter((line) => {
      return /docker compose up\b/.test(line) && !/^\s*(echo|#)/.test(line);
    });
    expect(starts).toEqual([
      "if ! docker compose up -d --force-recreate; then",
    ]);
    expect(script.indexOf("docker compose pull")).toBeLessThan(
      script.indexOf("docker compose up -d --force-recreate"),
    );
  });

  test("installs where the systemd unit and the doctor script look", () => {
    expect(script).toContain(`INSTALL_DIR="\${INSTALL_DIR:-${INSTALL_DIR}}"`);
    expect(
      read(`${AGENT_DIR}/systemd/oneuptime-xcp-ng-agent.service`),
    ).toContain(`WorkingDirectory=${INSTALL_DIR}\n`);
    expect(read(`${AGENT_DIR}/troubleshoot.sh`)).toContain(
      `DIR="${INSTALL_DIR}"`,
    );
  });

  test("passes bash -n", () => {
    for (const file of ["install.sh", "troubleshoot.sh"]) {
      const result = spawnSync(
        "bash",
        ["-n", path.join(REPO_ROOT, AGENT_DIR, file)],
        { encoding: "utf8" },
      );
      expect({ file, stderr: result.stderr, status: result.status }).toEqual({
        file,
        stderr: "",
        status: 0,
      });
    }
  });
});

describe("agents/XcpNgAgent/troubleshoot.sh, statically", () => {
  const doctor = read(`${AGENT_DIR}/troubleshoot.sh`);

  test("reads a quoted .env the way install.sh writes it", () => {
    const vmware = read("agents/VMwareAgent/troubleshoot.sh");
    expect(shellFunction(doctor, "dotenv_get")).toBe(
      shellFunction(vmware, "dotenv_get"),
    );
    expect(doctor).toContain('v=$(dotenv_get "$1" "$ENV_FILE")');
  });

  test("hands the secret and the ingestion key to a digest-pinned curl image on stdin", () => {
    const openstack = read("agents/OpenStackAgent/troubleshoot.sh");
    const pin = /^CURL_IMAGE="([^"]+)"$/m;
    expect(doctor.match(pin)[1]).toBe(openstack.match(pin)[1]);
    expect(doctor.match(pin)[1]).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(doctor).toContain(
      "printf 'Authorization: Bearer %s\\n' \"$XO_SECRET\" | agent_netns_curl --stdin -H @-",
    );
    expect(doctor).toContain(
      "printf 'x-oneuptime-token: %s\\n' \"$token\" | agent_netns_curl --stdin",
    );
    // Neither is ever an argument of docker or curl.
    expect(doctor).not.toMatch(/-H "Authorization/);
    expect(doctor).not.toMatch(/-H "x-oneuptime-token/);
  });

  test("checks the chain in the order data travels it, naming each step", () => {
    const sections = Array.from(doctor.matchAll(/^section "([^"]+)"$/gm)).map(
      (match) => {
        return match[1];
      },
    );
    expect(sections).toEqual([
      "1. Runtime",
      "2. Xen Orchestra reachable",
      "3. OpenMetrics plugin (/openmetrics/health)",
      "4. Xen Orchestra's certificate",
      "5. OpenMetrics secret",
      "6. Pools Xen Orchestra reports",
      "7. Ingestion token (shape)",
      "8. Collector health & self-metrics",
      "9. Egress + DEFINITIVE token check",
      "10. Recent collector errors",
      "11. VERDICT",
    ]);
  });
});

describe("agents/XcpNgAgent/systemd/oneuptime-xcp-ng-agent.service", () => {
  const unit = read(`${AGENT_DIR}/systemd/oneuptime-xcp-ng-agent.service`);

  test("wraps docker compose in the install directory", () => {
    for (const line of [
      "Requires=docker.service",
      `WorkingDirectory=${INSTALL_DIR}`,
      "ExecStartPre=/usr/bin/docker compose pull",
      "ExecStart=/usr/bin/docker compose up --remove-orphans",
      "ExecStop=/usr/bin/docker compose down",
      "Restart=on-failure",
      "Documentation=https://oneuptime.com/docs/telemetry/xcp-ng",
      "WantedBy=multi-user.target",
    ]) {
      expect(unit.split("\n")).toContain(line);
    }
  });
});

describe("what OneUptime serves at /install/xcp-ng-agent", () => {
  test("every file of the agent but its README, and the README is not one of them", () => {
    const entry = entryForAgentDirectory("XcpNgAgent");
    expect(entry).toEqual(
      expect.objectContaining({
        name: "xcp-ng-agent",
        title: "XCP-ng agent",
        sourceDirectory: AGENT_DIR,
        script: "install.sh",
      }),
    );
    const onDisk = [];
    const walk = (dir, prefix) => {
      for (const name of fs.readdirSync(path.join(REPO_ROOT, dir))) {
        const relative = prefix ? `${prefix}/${name}` : name;
        if (fs.statSync(path.join(REPO_ROOT, dir, name)).isDirectory()) {
          walk(`${dir}/${name}`, relative);
        } else {
          onDisk.push(relative);
        }
      }
    };
    walk(AGENT_DIR, "");
    expect([...entry.files].sort()).toEqual(
      onDisk
        .filter((file) => {
          return file !== "README.md";
        })
        .sort(),
    );
  });
});
