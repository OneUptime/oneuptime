/**
 * What a probe sends, under a Host the primary ingress does not name (#10024).
 *
 * The primary ingress answers localhost, ingress and HOST; every other Host
 * lands in the two status-page default servers (7849 and 7850), which
 * forward every path to the App and keep nginx's 1M body limit on all but
 * their own raised locations. A probe sends no Host header of its own: it
 * names the ingress by the address in its ONEUPTIME_URL. The bundled probes
 * use the server's own network, and when ONEUPTIME_HTTP_PORT publishes the
 * ingress on one address other than 127.0.0.1 ([::1]:8080, 10.0.0.5:8080),
 * FollowIngressPort points them at that address, the only one they can reach
 * it at; a probe set up with the server's IP address does the same. The App
 * serves its probe API whatever the Host, so their reports went through, on
 * the 1M default: a synthetic monitor's screenshots or a packet capture got
 * a bare 413, where under HOST the primary takes 50M.
 *
 * So both default servers take what a probe calls - /probe-ingest, the
 * /ingestor that probes deployed before it call, and the
 * /incoming-request-ingest a probe forwards heartbeats to - with the limit
 * the primary gives the same path, and otherwise forward it as their own
 * `location /` does. The paths are read from the Probe's source, so the test
 * breaks when it calls another.
 *
 * Read twice: in the template, and in the config the real
 * envsubst-on-templates.sh generates from it, with billing on and off
 * (skipped without sh and envsubst on PATH). Tests/Ops/StatusCheckIngress
 * sends such a report through the real nginx.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const {
  NGINX_DIRECTORY,
  getDirectives,
  getLocationBlocks,
  getServerBlocks,
  readTemplate,
  resolveLocation,
} = require("./NginxConfigParser");

const MIB = 1024 * 1024;

const REPOSITORY_ROOT = path.resolve(NGINX_DIRECTORY, "..", "..");
const SCRIPT_PATH = path.join(NGINX_DIRECTORY, "envsubst-on-templates.sh");

const PROBE_CONFIG_SOURCE = path.join(
  REPOSITORY_ROOT,
  "packages",
  "Probe",
  "Config.ts",
);
const PROBE_INCOMING_REQUEST_SOURCE = path.join(
  REPOSITORY_ROOT,
  "packages",
  "Probe",
  "API",
  "IncomingRequestIngress.ts",
);

// The three paths, as the locations name them.
const PROBE_SPECS = ["/probe-ingest", "/ingestor", "/incoming-request-ingest"];

// What a location that sets nothing gets: nginx's compiled-in default.
const NGINX_DEFAULT_BODY_LIMIT_BYTES = 1 * MIB;

const FORWARDING_HEADERS = [
  "proxy_set_header Host $host;",
  "proxy_set_header X-Real-IP $remote_addr;",
  "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
  "proxy_set_header X-Forwarded-Proto $visitor_scheme;",
];

const BILLING_REDIRECT = "return 301 https://$host$request_uri;";

/** "50M" -> bytes. nginx sizes are bytes, or k/m/g suffixed in either case. */
function parseNginxSize(size) {
  const match = /^(\d+)([kKmMgG]?)$/.exec(size);
  assert.ok(match, `unparseable nginx size ${size}`);
  const multiplier = { "": 1, k: 1024, m: MIB, g: 1024 * MIB }[
    match[2].toLowerCase()
  ];
  return Number(match[1]) * multiplier;
}

/** The body limit a location sets itself, or nginx's default without one. */
function bodyLimitOf(location) {
  const directives = getDirectives(location.body, "client_max_body_size");

  if (directives.length === 0) {
    return NGINX_DEFAULT_BODY_LIMIT_BYTES;
  }

  assert.equal(directives.length, 1, directives.join(" "));

  const match = /^client_max_body_size (\S+);$/.exec(directives[0]);
  assert.ok(match, directives[0]);

  return parseNginxSize(match[1]);
}

/** A label for assertion messages: the block's first listen directive. */
function serverLabel(serverBlock) {
  return getDirectives(serverBlock.body, "listen")[0] || "(no listen)";
}

/*
 * The servers of a config: the primary ingress, named "localhost ingress"
 * and HOST, and the two default servers every other Host lands in - the
 * plain-HTTP one and the TLS one.
 */
function readServers(source) {
  const serverBlocks = getServerBlocks(source);
  const primary = serverBlocks.find((block) => {
    return getDirectives(block.body, "server_name").some((directive) => {
      return directive.startsWith("server_name localhost ingress");
    });
  });

  assert.ok(primary, "the primary ingress server block is gone");

  const defaults = serverBlocks.filter((block) => {
    return block !== primary;
  });

  assert.equal(defaults.length, 2, "expected two default servers");

  const tls = defaults.find((block) => {
    return getDirectives(block.body, "listen").some((directive) => {
      return /7850 ssl/.test(directive);
    });
  });
  const plain = defaults.find((block) => {
    return block !== tls;
  });

  assert.ok(tls, "the TLS default server is gone");
  assert.ok(plain, "the plain-HTTP default server is gone");

  return { primary, plain, tls };
}

function isOnPath(binary, args = ["--version"]) {
  const probe = spawnSync(binary, args, { encoding: "utf8" });

  return !probe.error && probe.status === 0;
}

const scriptSkipReason =
  isOnPath("sh", ["-c", "exit 0"]) && isOnPath("envsubst")
    ? false
    : "sh or envsubst not on PATH";

/**
 * Run the real envsubst-on-templates.sh over the real template, the way the
 * container runs it, and return the config it generates.
 */
function generateConfig(environment) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-probe-"));

  try {
    const templateDirectory = path.join(directory, "templates");
    const outputDirectory = path.join(directory, "out");

    fs.mkdirSync(templateDirectory);
    fs.mkdirSync(outputDirectory);
    fs.writeFileSync(
      path.join(templateDirectory, "default.conf.template"),
      readTemplate(),
    );

    const result = spawnSync("sh", [SCRIPT_PATH], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NGINX_ENVSUBST_TEMPLATE_DIR: templateDirectory,
        NGINX_ENVSUBST_OUTPUT_DIR: outputDirectory,
        APP_PORT: "3002",
        HOME_PORT: "1444",
        HOST: "oneuptime.example.com",
        NGINX_RESOLVER: "127.0.0.11",
        SERVER_APP_HOSTNAME: "app",
        SERVER_HOME_HOSTNAME: "home",
        NGINX_LISTEN_ADDRESS: "",
        NGINX_LISTEN_OPTIONS: "",
        NGINX_IPV6_SUPPORT_FILE: path.join(directory, "no-ipv6-absent"),
        ...environment,
      },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    return fs.readFileSync(path.join(outputDirectory, "default.conf"), "utf8");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// What the Probe calls
// ---------------------------------------------------------------------------

/*
 * The paths a probe sends to, from its source: PROBE_INGEST_URL, its
 * ONEUPTIME_URL with /probe-ingest added, and the incoming request
 * forwarder's address.
 */
function probePaths() {
  const config = fs.readFileSync(PROBE_CONFIG_SOURCE, "utf8");
  const incoming = fs.readFileSync(PROBE_INCOMING_REQUEST_SOURCE, "utf8");

  assert.ok(
    config.includes('PROBE_INGEST_URL.addRoute("/probe-ingest")'),
    "the Probe no longer sends its reports to /probe-ingest",
  );
  assert.ok(
    /\.addRoute\("\/incoming-request-ingest"\)/.test(incoming),
    "the Probe no longer forwards heartbeats to /incoming-request-ingest",
  );

  return ["/probe-ingest", "/incoming-request-ingest"];
}

// Requests of each kind a probe sends, by path.
const PROBE_REQUESTS = [
  "/probe-ingest/probe/response/ingest",
  "/probe-ingest/register",
  "/ingestor/probe/response/ingest",
  "/incoming-request-ingest/incoming-request/0123456789abcdef",
];

function checkConfig(source, label, { billingEnabled }) {
  const { primary, plain, tls } = readServers(source);

  for (const server of [plain, tls]) {
    const locations = getLocationBlocks(server.body);
    const where = `${label}, ${serverLabel(server)}`;
    const rootLocation = locations.find((location) => {
      return location.spec === "/";
    });

    assert.ok(rootLocation, `${where}: location / is gone`);

    for (const spec of PROBE_SPECS) {
      const matching = locations.filter((location) => {
        return location.spec === spec;
      });

      assert.equal(matching.length, 1, `${where}: location ${spec}`);
    }

    for (const uri of PROBE_REQUESTS) {
      const location = resolveLocation(locations, uri);
      const primaryLocation = resolveLocation(
        getLocationBlocks(primary.body),
        uri,
      );

      // Its own location, with the primary's limit for the same path.
      assert.ok(PROBE_SPECS.includes(location.spec), `${where}: ${uri}`);
      assert.equal(location.spec, primaryLocation.spec, `${where}: ${uri}`);
      assert.equal(
        bodyLimitOf(location),
        bodyLimitOf(primaryLocation),
        `${where}: ${uri}`,
      );
      assert.equal(bodyLimitOf(location), 50 * MIB, `${where}: ${uri}`);

      // To the App with the request's own Host, as location / sends it, and no rewrite.
      for (const header of FORWARDING_HEADERS) {
        assert.ok(
          getDirectives(location.body, "proxy_set_header").includes(header),
          `${where}: ${location.spec} must send "${header}"`,
        );
        assert.ok(
          getDirectives(rootLocation.body, "proxy_set_header").includes(header),
          `${where}: premise - location / sends "${header}"`,
        );
      }

      assert.deepEqual(getDirectives(location.body, "rewrite"), [], where);
      assert.deepEqual(
        getDirectives(location.body, "proxy_pass"),
        getDirectives(primaryLocation.body, "proxy_pass"),
        `${where}: ${location.spec} must forward to the App as the primary does`,
      );
      assert.deepEqual(
        getDirectives(location.body, "proxy_http_version"),
        ["proxy_http_version 1.1;"],
        `${where}: ${location.spec}`,
      );

      /*
       * And as the server's location / does about billing: over plain HTTP
       * on to HTTPS with billing on, to the App without; over TLS always to
       * the App.
       */
      assert.deepEqual(
        getDirectives(location.body, "return"),
        getDirectives(rootLocation.body, "return"),
        `${where}: ${location.spec} redirects as location / does`,
      );
    }

    // What a status page's visitors send stays out of them, on nginx's 1M.
    for (const otherPath of [
      "/",
      "/incidents/0123456789abcdef",
      "/status-page-api/subscribe/email",
      "/api/probe/response/ingest",
      "/incoming-request/0123456789abcdef",
    ]) {
      const location = resolveLocation(locations, otherPath);

      assert.ok(
        !PROBE_SPECS.includes(location.spec),
        `${where}: ${otherPath} landed in ${location.spec}`,
      );
    }

    assert.equal(
      bodyLimitOf(rootLocation),
      NGINX_DEFAULT_BODY_LIMIT_BYTES,
      where,
    );
  }

  if (billingEnabled !== undefined) {
    const plainProbe = resolveLocation(
      getLocationBlocks(plain.body),
      "/probe-ingest/probe/response/ingest",
    );

    assert.equal(
      getDirectives(plainProbe.body, "return").includes(BILLING_REDIRECT),
      true,
      `${label}: the plain-HTTP server keeps its billing redirect`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("a probe calls /probe-ingest and /incoming-request-ingest, which the default servers take", () => {
  for (const pathname of probePaths()) {
    assert.ok(PROBE_SPECS.includes(pathname), pathname);
  }
});

test("the default servers take a probe's reports with the primary's limit, and forward them as location / does", () => {
  checkConfig(readTemplate(), "the template", {});
});

test("the plain-HTTP default server's probe locations keep its billing redirect, and the TLS one's proxy unconditionally", () => {
  const { plain, tls } = readServers(readTemplate());

  for (const spec of PROBE_SPECS) {
    const plainLocation = getLocationBlocks(plain.body).find((location) => {
      return location.spec === spec;
    });
    const tlsLocation = getLocationBlocks(tls.body).find((location) => {
      return location.spec === spec;
    });

    assert.ok(
      plainLocation.body.includes("if ($billing_enabled = true)"),
      `plain ${spec}`,
    );
    assert.ok(
      getDirectives(plainLocation.body, "return").includes(BILLING_REDIRECT),
      `plain ${spec}`,
    );
    assert.ok(!tlsLocation.body.includes("$billing_enabled"), `TLS ${spec}`);
    assert.deepEqual(getDirectives(tlsLocation.body, "return"), [], spec);
  }
});

test(
  "the config the container generates, with billing on and off, takes them so",
  { skip: scriptSkipReason },
  () => {
    for (const billingEnabled of [true, false]) {
      checkConfig(
        generateConfig({ BILLING_ENABLED: String(billingEnabled) }),
        `generated, BILLING_ENABLED=${billingEnabled}`,
        { billingEnabled },
      );
    }
  },
);
