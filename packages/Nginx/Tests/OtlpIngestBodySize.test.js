/**
 * OTLP ingest body size at the ingress (GH#3978).
 *
 * An OTel pipeline repointed from Datadog at OneUptime keeps sending the
 * batches it always sent, and a full collector batch is well over a
 * megabyte. /telemetry allowed 4M, but /otlp -- the path the docs hand out --
 * and the OTLP/gRPC location were left on nginx's 1M default, so those
 * batches got a bare nginx 413 that no App log ever saw. All three now take
 * 4M. So do /otlp and /telemetry in the two status-page default servers,
 * which answer every request whose Host the primary ingress does not name
 * (an IP, an in-cluster Service name, any name while HOST is "localhost")
 * and forward it to the same App.
 *
 * Two halves:
 *
 *   - Static: read default.conf.template and the App source and pin the
 *     limit, its agreement across the entry points and server blocks, and its
 *     place under every cap the App applies after it. The App caps are read
 *     from source at test time, so the test breaks when either side drifts.
 *   - Live: render the template the way the container does, run it under a
 *     real nginx in front of stub upstreams that record what actually
 *     arrives, and send real batches at and around the limit over HTTP/1.1,
 *     HTTP/2 and gRPC, under the names the primary answers to and under
 *     names only the default servers catch. Skipped without nginx >= 1.25.1
 *     and envsubst on PATH; the TLS suites also need openssl.
 *
 * Tests named "KNOWN BUG" document gaps the fix leaves; see expectKnownBug().
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const http2 = require("node:http2");
const https = require("node:https");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");
const { spawn, spawnSync } = require("node:child_process");

const {
  NGINX_DIRECTORY,
  findBlocks,
  getDirectives,
  getLocationBlocks,
  getServerBlocks,
  readNginxConf,
  readTemplate,
  resolveLocation,
  stripComments,
} = require("./NginxConfigParser");

const { after, before, describe } = test;

const template = readTemplate();
const nginxConf = readNginxConf();
const serverBlocks = getServerBlocks(template);

// The primary ingress ("localhost ingress $HOST"); the other two server
// blocks are the status-page servers.
const primaryServerBlock = serverBlocks.find((block) => {
  return /server_name\s+localhost\s+ingress/.test(block.body);
});

const MIB = 1024 * 1024;

const OTLP_BATCH_LIMIT_DIRECTIVE = "client_max_body_size 4M;";
const OTLP_BATCH_LIMIT_BYTES = 4 * MIB;

// What a location that sets nothing gets: nginx's compiled-in default.
const NGINX_DEFAULT_BODY_LIMIT_BYTES = 1 * MIB;

/*
 * The upper end of the gzip ratio the /otlp comment and OtelPayloadDecoder
 * both quote for OTLP protobuf ("about 5-15x"). A compressed batch at the
 * nginx cap has to inflate inside the worker's post-gunzip cap at that ratio,
 * or a legitimate batch dies in the worker instead of at the ingress.
 */
const TYPICAL_MAX_OTLP_GZIP_RATIO = 15;

const OTLP_HTTP_LOCATION = "/otlp";
const TELEMETRY_LOCATION = "/telemetry";
const OTLP_GRPC_LOCATION = "~ /opentelemetry.proto.collector*";
const OTLP_LOCATIONS = [
  OTLP_HTTP_LOCATION,
  TELEMETRY_LOCATION,
  OTLP_GRPC_LOCATION,
];

const OTLP_HTTP_SPECS = [OTLP_HTTP_LOCATION, TELEMETRY_LOCATION];

const INGRESS_PORT = "7849";
const TLS_INGRESS_PORT = "7850";

/*
 * What the status-page servers' `location /` and the OTLP locations that
 * pre-empt it must both send upstream.
 */
const FORWARDING_HEADERS = [
  "proxy_set_header Host $host;",
  "proxy_set_header X-Real-IP $remote_addr;",
  "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
  "proxy_set_header X-Forwarded-Proto $scheme;",
];

const REPOSITORY_ROOT = path.resolve(NGINX_DIRECTORY, "..", "..");
const TELEMETRY_SOURCE_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Telemetry",
);

// ---------------------------------------------------------------------------
// Helpers: config reading
// ---------------------------------------------------------------------------

/** "4M" -> bytes. nginx sizes are bytes, or k/m/g suffixed in either case. */
function parseNginxSize(size) {
  const match = /^(\d+)([kKmMgG]?)$/.exec(size);
  assert.ok(match, `unparseable nginx size ${size}`);
  const multiplier = { "": 1, k: 1024, m: MIB, g: 1024 * MIB }[
    match[2].toLowerCase()
  ];
  return Number(match[1]) * multiplier;
}

function sizeOfDirective(directive) {
  const match = /^client_max_body_size (\S+);$/.exec(directive);
  assert.ok(match, `unexpected directive ${directive}`);
  return parseNginxSize(match[1]);
}

function locationsWithSpec(serverBlock, spec) {
  return getLocationBlocks(serverBlock.body).filter((location) => {
    return location.spec === spec;
  });
}

function onlyLocation(serverBlock, spec) {
  const locations = locationsWithSpec(serverBlock, spec);
  assert.equal(locations.length, 1, `expected exactly one location ${spec}`);
  return locations[0];
}

/**
 * The directives written directly in a block, not inside any block nested in
 * it -- i.e. what a server block sets for itself, as opposed to what its
 * locations set. Brace counting is safe here for the same reason it is in
 * NginxConfigParser: the only braces inside these files' tokens are the
 * balanced `{8,}` of one quoted location regex.
 */
function ownDirectives(blockBody, directiveName) {
  const ownLines = [];
  let depth = 0;

  for (const line of stripComments(blockBody).split("\n")) {
    if (depth === 0) {
      ownLines.push(line);
    }

    for (const character of line) {
      if (character === "{") {
        depth++;
      } else if (character === "}") {
        depth--;
      }
    }
  }

  return getDirectives(ownLines.join("\n"), directiveName);
}

/**
 * The client_max_body_size nginx actually applies in `location` of
 * `serverBlock`: the location's own value, else the server's, else the
 * http{} block's in nginx.conf, else nginx's 1M default.
 */
function effectiveBodyLimit(serverBlock, location) {
  for (const directives of [
    getDirectives(location.body, "client_max_body_size"),
    ownDirectives(serverBlock.body, "client_max_body_size"),
    ownDirectives(nginxHttpBlock().body, "client_max_body_size"),
  ]) {
    if (directives.length > 0) {
      assert.equal(directives.length, 1, directives.join(" "));
      return sizeOfDirective(directives[0]);
    }
  }

  return NGINX_DEFAULT_BODY_LIMIT_BYTES;
}

function nginxHttpBlock() {
  const [httpBlock] = findBlocks(
    stripComments(nginxConf),
    /^http\s*\{[^\S\n]*$/,
  );
  assert.ok(httpBlock, "expected an http {} block in nginx.conf");
  return httpBlock;
}

/** This server's plaintext (non-ssl) `listen` on the ingress port, if any. */
function plaintextIngressListen(serverBlock) {
  return getDirectives(serverBlock.body, "listen").find((listen) => {
    return (
      new RegExp(`\\b${INGRESS_PORT}\\b`).test(listen) &&
      !/\bssl\b/.test(listen)
    );
  });
}

/**
 * The server nginx treats as the default for the plaintext ingress port: the
 * one whose listen says default_server, else the first one listening there.
 * It answers every request whose Host no server_name claims, and it alone
 * decides whether a plaintext connection may speak HTTP/2 (h2c).
 */
function plaintextIngressDefaultServer() {
  const listening = serverBlocks.filter((serverBlock) => {
    return plaintextIngressListen(serverBlock) !== undefined;
  });

  assert.ok(listening.length > 0, "nothing listens on the ingress port");

  const explicit = listening.filter((serverBlock) => {
    return /\bdefault_server\b/.test(plaintextIngressListen(serverBlock));
  });

  assert.ok(explicit.length <= 1, "two default servers on the ingress port");

  return explicit[0] || listening[0];
}

/**
 * The server nginx treats as the default for the TLS port: the one with
 * `listen ...7850 ssl default_server`. The primary only listens on 7850 at
 * all when PROVISION_SSL is on (${PROVISION_SSL_LISTEN_DIRECTIVE}).
 */
function tlsIngressDefaultServer() {
  const servers = serverBlocks.filter((serverBlock) => {
    return getDirectives(serverBlock.body, "listen").some((listen) => {
      return new RegExp(
        `\\b${TLS_INGRESS_PORT}\\s+ssl\\s+default_server\\b`,
      ).test(listen);
    });
  });

  assert.equal(servers.length, 1, "expected one default server on 7850");

  return servers[0];
}

/** Every server block other than the primary ingress. */
function statusPageServers() {
  const servers = serverBlocks.filter((serverBlock) => {
    return serverBlock !== primaryServerBlock;
  });

  assert.equal(servers.length, 2, "expected two status-page server blocks");

  return servers;
}

/** A label for assertion messages: the block's first listen directive. */
function serverLabel(serverBlock) {
  return getDirectives(serverBlock.body, "listen")[0];
}

/** Whether a location hands the request to the App's HTTP port (in any branch). */
function forwardsToApp(location) {
  return getDirectives(location.body, "proxy_pass").includes(
    "proxy_pass ${BACKEND_APP_TARGET};",
  );
}

/** Whether HTTP/2 is on for `serverBlock`: its own setting, else http{}'s. */
function http2Enabled(serverBlock) {
  if (/\shttp2\b/.test(plaintextIngressListen(serverBlock) || "")) {
    // The pre-1.25.1 spelling, `listen ... http2`.
    return true;
  }

  for (const directives of [
    ownDirectives(serverBlock.body, "http2"),
    ownDirectives(nginxHttpBlock().body, "http2"),
  ]) {
    if (directives.length > 0) {
      return directives[directives.length - 1] === "http2 on;";
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Helpers: App source
// ---------------------------------------------------------------------------

function readTelemetrySource(relativePath) {
  return fs.readFileSync(
    path.join(TELEMETRY_SOURCE_DIRECTORY, relativePath),
    "utf8",
  );
}

/**
 * Read a byte count such as `50 * 1024 * 1024` out of App source. Only a
 * product of integer literals is accepted: anything else (a call, an env
 * lookup) means the constant changed shape, and this test has to be looked
 * at rather than silently mis-evaluate it.
 */
function readByteConstant(relativePath, pattern) {
  const match = pattern.exec(readTelemetrySource(relativePath));

  assert.ok(
    match,
    `${pattern} no longer matches ${relativePath}; update this test if the constant moved`,
  );

  const expression = match[1].trim();

  assert.match(
    expression,
    /^\d+(?:\s*\*\s*\d+)*$/,
    `${relativePath}: "${expression}" is not a product of integer literals`,
  );

  return expression.split("*").reduce((product, factor) => {
    return product * Number(factor.trim());
  }, 1);
}

/** The byte cap the App's OTLP/HTTP middleware enforces on the wire. */
function appOtlpHttpCapBytes() {
  return readByteConstant(
    path.join("Middleware", "OtelRequestMiddleware.ts"),
    /export const MAX_OTLP_REQUEST_BYTES:\s*number\s*=\s*([^;]+);/,
  );
}

/** grpc.max_receive_message_length the App's OTLP gRPC server is built with. */
function appGrpcMaxReceiveBytes() {
  return readByteConstant(
    "GrpcServer.ts",
    /new grpc\.Server\(\{\s*"grpc\.max_receive_message_length":\s*([^,}\n]+)/,
  );
}

/** The worker's cap on one OTLP body AFTER gunzip. */
function appPostGunzipCapBytes() {
  return readByteConstant(
    path.join("Utils", "OtelPayloadDecoder.ts"),
    /export const MAX_DECOMPRESSED_OTLP_BODY_BYTES:\s*number\s*=\s*([^;]+);/,
  );
}

/** The port the App's OTLP gRPC server binds. */
function appGrpcPort() {
  const source = readTelemetrySource("GrpcServer.ts");
  const match = /const GRPC_PORT:\s*number\s*=\s*(\d+);/.exec(source);

  assert.ok(match, "GRPC_PORT not found in GrpcServer.ts");
  assert.ok(
    /bindAsync\(\s*`0\.0\.0\.0:\$\{GRPC_PORT\}`/.test(source),
    "GrpcServer.ts no longer binds GRPC_PORT",
  );

  return match[1];
}

/** Every OTLP/HTTP POST route the App's OTLP router serves. */
function appOtlpHttpRoutes() {
  const source = readTelemetrySource(path.join("API", "OTelIngest.ts"));

  return [...source.matchAll(/router\.post\(\s*"(\/otlp\/[^"]+)"/g)].map(
    (match) => {
      return match[1];
    },
  );
}

/** "/<package>.<Service>/Export" for every OTLP gRPC service the App serves. */
function appGrpcExportPaths() {
  const source = readTelemetrySource("GrpcServer.ts");
  const pattern = /getServiceDefinition\(\s*\w+,((?:\s*"[^"]+",?)+)\s*\)/g;

  return [...source.matchAll(pattern)].map((match) => {
    const parts = [...match[1].matchAll(/"([^"]+)"/g)].map((part) => {
      return part[1];
    });

    return `/${parts.join(".")}/Export`;
  });
}

/** The path prefixes the App mounts its OTLP router under. */
function appOtlpRouterPrefixes() {
  const source = readTelemetrySource("Index.ts");

  assert.ok(
    /import OTelIngestAPI from "\.\/API\/OTelIngest";/.test(source),
    "Index.ts no longer imports the OTLP router as OTelIngestAPI",
  );
  assert.ok(
    /app\.use\(TELEMETRY_PREFIXES,\s*OTelIngestAPI\)/.test(source),
    "Index.ts no longer mounts OTelIngestAPI under TELEMETRY_PREFIXES",
  );

  const match =
    /const TELEMETRY_PREFIXES:\s*Array<string>\s*=\s*\[([^\]]*)\]/.exec(source);

  assert.ok(match, "TELEMETRY_PREFIXES not found in Index.ts");

  return [...match[1].matchAll(/"([^"]*)"/g)].map((prefix) => {
    return prefix[1];
  });
}

// ---------------------------------------------------------------------------
// Helpers: environment probes and rendering (as NginxTemplateRender.test.js)
// ---------------------------------------------------------------------------

function isOnPath(binary, versionArguments) {
  const probe = spawnSync(binary, versionArguments, { encoding: "utf8" });
  return !probe.error && probe.status === 0;
}

const hasEnvsubst = isOnPath("envsubst", ["--version"]);
const hasOpenssl = isOnPath("openssl", ["version"]);

/*
 * The config uses `http2 on;`, which nginx added in 1.25.1 and older builds
 * reject outright (Ubuntu runners carry 1.24), so a live run needs at least
 * this. The shipped image is nginx 1.30.5 (Nginx/Dockerfile.tpl).
 */
const MINIMUM_NGINX_VERSION = [1, 25, 1];

function localNginxVersion() {
  const probe = spawnSync("nginx", ["-v"], { encoding: "utf8" });

  if (probe.error) {
    return null;
  }

  // nginx writes "nginx version: nginx/1.30.5" to stderr.
  const match = /nginx\/(\d+)\.(\d+)\.(\d+)/.exec(
    `${probe.stderr || ""}${probe.stdout || ""}`,
  );

  return match ? match.slice(1, 4).map(Number) : null;
}

const envsubstSkipReason = hasEnvsubst ? false : "envsubst not on PATH";

/** Reason to skip the live suites, or false to run them. */
const liveSkipReason = (() => {
  const version = localNginxVersion();

  if (!version) {
    return "nginx binary not on PATH";
  }

  // The first component that differs decides (2.0.0 is newer than 1.25.1).
  const decidingIndex = MINIMUM_NGINX_VERSION.findIndex((floor, index) => {
    return version[index] !== floor;
  });

  if (
    decidingIndex !== -1 &&
    version[decidingIndex] < MINIMUM_NGINX_VERSION[decidingIndex]
  ) {
    return `nginx ${version.join(".")} predates ${MINIMUM_NGINX_VERSION.join(".")}, which the shipped config requires`;
  }

  return envsubstSkipReason;
})();

/*
 * OTLP/gRPC can only reach the gRPC location over TLS (see the h2c KNOWN BUG
 * below), and the 7850 status-page suites need a certificate for the custom
 * domain they send; nginx needs a certificate file for either.
 */
const tlsSkipReason =
  liveSkipReason ||
  (hasOpenssl ? false : "openssl not on PATH (needed for a test certificate)");

/** Every ${NAME} placeholder the template contains. */
function templateVariables(source) {
  const names = new Set();
  const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    names.add(match[1]);
  }

  return names;
}

/**
 * Reproduce envsubst-on-templates.sh: the two sed line removals, the
 * upstream-keepalive block removal, then envsubst with a shell-format list
 * built from the environment we hand it.
 */
function render(environment) {
  const env = { PATH: process.env.PATH, ...environment };
  let source = template;

  if (!env.SERVER_NAMES_HASH_BUCKET_SIZE) {
    source = source.replace(
      /^[ \t]*server_names_hash_bucket_size[ \t].*\n/gm,
      "",
    );
  }

  if (!env.SERVER_NAMES_HASH_MAX_SIZE) {
    source = source.replace(/^[ \t]*server_names_hash_max_size[ \t].*\n/gm, "");
  }

  if (env.NGINX_UPSTREAM_KEEPALIVE !== "true") {
    source = source.replace(
      /# BEGIN upstream-keepalive[\s\S]*?# END upstream-keepalive\n/,
      "",
    );
  }

  const shellFormat = Object.keys(env)
    .map((name) => {
      return `\${${name}}`;
    })
    .join(" ");

  const result = spawnSync("envsubst", [shellFormat], {
    input: source,
    encoding: "utf8",
    env,
  });

  assert.equal(result.status, 0, result.stderr);

  return result.stdout;
}

/**
 * The BACKEND_APP_TARGET / BACKEND_APP_GRPC_TARGET pair
 * envsubst-on-templates.sh exports for each upstream mode, read from the
 * script so a change there is exercised here.
 */
function upstreamTargets() {
  const script = fs.readFileSync(
    path.join(NGINX_DIRECTORY, "envsubst-on-templates.sh"),
    "utf8",
  );
  const branches =
    /if \[ "\$\{NGINX_UPSTREAM_KEEPALIVE\}" = "true" \]; then\n([\s\S]*?)\nelse\n([\s\S]*?)\nfi/.exec(
      script,
    );

  assert.ok(
    branches,
    "the upstream-mode branch moved in envsubst-on-templates.sh",
  );

  function exported(branch, name) {
    const match = new RegExp(`export ${name}="([^"]*)"`).exec(branch);
    assert.ok(match, `${name} is no longer exported in one upstream mode`);
    return match[1].replace(/\\\$/g, "$");
  }

  return [branches[1], branches[2]].map((branch) => {
    return {
      BACKEND_APP_TARGET: exported(branch, "BACKEND_APP_TARGET"),
      BACKEND_APP_GRPC_TARGET: exported(branch, "BACKEND_APP_GRPC_TARGET"),
    };
  });
}

const [KEEPALIVE_TARGETS, PER_REQUEST_TARGETS] = upstreamTargets();

const UPSTREAM_MODES = [
  {
    name: "per-request resolver (docker-compose)",
    environment: { ...PER_REQUEST_TARGETS },
  },
  {
    name: "upstream keepalive pools (Kubernetes)",
    environment: {
      ...KEEPALIVE_TARGETS,
      NGINX_UPSTREAM_KEEPALIVE: "true",
      NGINX_UPSTREAM_KEEPALIVE_CONNECTIONS: "8",
    },
  },
];

const INGRESS_HOST = "oneuptime.example.com";

/**
 * A full container environment, so a render is representative of a real
 * deployment, with `overrides` on top.
 */
function baseEnvironment(overrides = {}) {
  const environment = {};

  for (const name of templateVariables(template)) {
    environment[name] = `dummy-${name.toLowerCase()}`;
  }

  Object.assign(environment, {
    APP_PORT: "3002",
    HOME_PORT: "1444",
    HOST: INGRESS_HOST,
    BILLING_ENABLED: "false",
    NGINX_LISTEN_ADDRESS: "",
    NGINX_LISTEN_OPTIONS: "",
    NGINX_RESOLVER: "127.0.0.11",
    PROVISION_SSL_LISTEN_DIRECTIVE: "",
    PROVISION_SSL_CERTIFICATE_DIRECTIVE: "",
    PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE: "",
    SERVER_APP_HOSTNAME: "app",
    SERVER_HOME_HOSTNAME: "home",
    ...PER_REQUEST_TARGETS,
  });

  delete environment.SERVER_NAMES_HASH_BUCKET_SIZE;
  delete environment.SERVER_NAMES_HASH_MAX_SIZE;
  delete environment.NGINX_UPSTREAM_KEEPALIVE_CONNECTIONS;
  delete environment.NGINX_INGEST_ACCESS_LOG;

  return { ...environment, ...overrides };
}

/**
 * node:test has no test.failing, so this is the same contract by hand.
 * `expectation` states the behaviour we want. While the bug is there it
 * throws an assertion error, which is reported as a diagnostic and passes;
 * once the bug is fixed it passes, and this fails -- so the fix cannot land
 * without someone promoting the test to a plain one. Anything other than an
 * assertion error is a broken harness and fails as usual.
 */
async function expectKnownBug(context, expectation) {
  try {
    await expectation();
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) {
      throw error;
    }

    context.diagnostic(`still broken: ${error.message.split("\n")[0]}`);
    return;
  }

  assert.fail(
    "This known bug is fixed: turn this test into a plain one that asserts the fixed behaviour.",
  );
}

// ---------------------------------------------------------------------------
// Static: the directive
// ---------------------------------------------------------------------------

test("the primary ingress defines each OTLP entry point exactly once", () => {
  assert.ok(primaryServerBlock, "expected a 'localhost ingress' server block");

  for (const spec of OTLP_LOCATIONS) {
    onlyLocation(primaryServerBlock, spec);
  }
});

test("every server block defining an OTLP location sets client_max_body_size 4M there, once", () => {
  /*
   * Not only the primary ingress: the status-page default servers carry
   * /otlp and /telemetry too (see "every server block that forwards OTLP/HTTP
   * to the App" below), and every copy has to take the same batch.
   */
  let checked = 0;

  for (const serverBlock of serverBlocks) {
    for (const location of getLocationBlocks(serverBlock.body)) {
      if (!OTLP_LOCATIONS.includes(location.spec)) {
        continue;
      }

      assert.equal(
        locationsWithSpec(serverBlock, location.spec).length,
        1,
        `${location.spec} is defined twice in one server block`,
      );
      assert.deepEqual(
        getDirectives(location.body, "client_max_body_size"),
        [OTLP_BATCH_LIMIT_DIRECTIVE],
        `${location.spec} must set "${OTLP_BATCH_LIMIT_DIRECTIVE}" exactly once`,
      );
      assert.equal(
        effectiveBodyLimit(serverBlock, location),
        OTLP_BATCH_LIMIT_BYTES,
      );

      checked++;
    }
  }

  // Three in the primary, two in each status-page server.
  assert.equal(
    checked,
    OTLP_LOCATIONS.length + 2 * OTLP_HTTP_SPECS.length,
    `expected ${OTLP_LOCATIONS.length + 2 * OTLP_HTTP_SPECS.length} OTLP locations, found ${checked}`,
  );
});

test("/otlp, /telemetry and OTLP/gRPC take the same batch", () => {
  /*
   * The App mounts ONE OTLP router under both "/" and "/telemetry", so
   * /otlp/v1/metrics and /telemetry/otlp/v1/metrics are the same endpoint and
   * an exporter can be pointed at either. gRPC carries the same
   * Export*ServiceRequest payload. A batch that fits one must fit all three.
   */
  const prefixes = appOtlpRouterPrefixes();

  assert.ok(prefixes.includes("/"), `OTLP router prefixes: ${prefixes}`);
  assert.ok(
    prefixes.includes("/telemetry"),
    `OTLP router prefixes: ${prefixes}`,
  );

  const limits = OTLP_LOCATIONS.map((spec) => {
    return effectiveBodyLimit(
      primaryServerBlock,
      onlyLocation(primaryServerBlock, spec),
    );
  });

  assert.deepEqual(limits, [
    OTLP_BATCH_LIMIT_BYTES,
    OTLP_BATCH_LIMIT_BYTES,
    OTLP_BATCH_LIMIT_BYTES,
  ]);
  assert.ok(OTLP_BATCH_LIMIT_BYTES > NGINX_DEFAULT_BODY_LIMIT_BYTES);
});

test("every OTLP/HTTP route the App serves lands in a 4M location, on both prefixes", () => {
  const routes = appOtlpHttpRoutes();

  for (const signal of ["traces", "metrics", "logs", "profiles"]) {
    assert.ok(
      routes.includes(`/otlp/v1/${signal}`),
      `the App no longer serves /otlp/v1/${signal}: ${routes}`,
    );
  }

  const locations = getLocationBlocks(primaryServerBlock.body);

  for (const route of routes) {
    for (const [uri, expectedSpec] of [
      [route, OTLP_HTTP_LOCATION],
      [`/telemetry${route}`, TELEMETRY_LOCATION],
    ]) {
      const location = resolveLocation(locations, uri);

      assert.ok(location, `${uri} matches no location`);
      assert.equal(location.spec, expectedSpec, `${uri} is routed elsewhere`);
      assert.equal(
        effectiveBodyLimit(primaryServerBlock, location),
        OTLP_BATCH_LIMIT_BYTES,
        uri,
      );
    }
  }
});

test("every OTLP/gRPC service the App serves lands in the 4M gRPC location", () => {
  const exportPaths = appGrpcExportPaths();

  assert.deepEqual(
    [
      "/opentelemetry.proto.collector.trace.v1.TraceService/Export",
      "/opentelemetry.proto.collector.logs.v1.LogsService/Export",
      "/opentelemetry.proto.collector.metrics.v1.MetricsService/Export",
      "/opentelemetry.proto.collector.profiles.v1development.ProfilesService/Export",
    ].filter((exportPath) => {
      return !exportPaths.includes(exportPath);
    }),
    [],
    `the App's gRPC services changed: ${exportPaths}`,
  );

  const locations = getLocationBlocks(primaryServerBlock.body);

  for (const exportPath of exportPaths) {
    const location = resolveLocation(locations, exportPath);

    assert.ok(location, `${exportPath} matches no location`);
    assert.equal(location.spec, OTLP_GRPC_LOCATION, exportPath);
    assert.equal(
      effectiveBodyLimit(primaryServerBlock, location),
      OTLP_BATCH_LIMIT_BYTES,
    );
  }
});

// ---------------------------------------------------------------------------
// Static: the limit against the App's own caps
// ---------------------------------------------------------------------------

test("the ingress limit is no higher than the App's OTLP/HTTP wire cap", () => {
  /*
   * Anything nginx admits past the App's cap is buffered, forwarded and then
   * refused -- all cost, no batch.
   */
  const appCap = appOtlpHttpCapBytes();

  assert.ok(appCap > 0);
  assert.ok(
    OTLP_BATCH_LIMIT_BYTES <= appCap,
    `nginx admits ${OTLP_BATCH_LIMIT_BYTES} bytes but the App refuses above ${appCap}`,
  );
});

test("the ingress limit is no higher than the App's gRPC max receive size", () => {
  /*
   * nginx counts DATA bytes, which include the 5-byte gRPC length prefix, so
   * the largest message it admits is 5 bytes under the limit: at or under the
   * limit is always inside the gRPC server's max_receive_message_length.
   */
  const grpcCap = appGrpcMaxReceiveBytes();

  assert.ok(grpcCap > 0);
  assert.ok(
    OTLP_BATCH_LIMIT_BYTES <= grpcCap,
    `nginx admits ${OTLP_BATCH_LIMIT_BYTES} bytes but the gRPC server refuses messages above ${grpcCap}`,
  );
});

test("a compressed batch at the ingress limit inflates inside the worker's post-gunzip cap", () => {
  const postGunzipCap = appPostGunzipCapBytes();

  // An uncompressed batch at the limit trivially fits...
  assert.ok(OTLP_BATCH_LIMIT_BYTES <= postGunzipCap);

  // ...and so must a gzipped one at the ratio both comments quote.
  assert.ok(
    OTLP_BATCH_LIMIT_BYTES * TYPICAL_MAX_OTLP_GZIP_RATIO <= postGunzipCap,
    `a ${OTLP_BATCH_LIMIT_BYTES}-byte gzipped batch at ${TYPICAL_MAX_OTLP_GZIP_RATIO}x inflates past the ${postGunzipCap}-byte cap`,
  );
});

test("the /otlp rationale still quotes the App's real caps", () => {
  /*
   * The comment is the only place an operator reads why 4M and not more. It
   * sits on the primary's /otlp (the status-page servers' copies refer back
   * to it), so take the /otlp that follows the primary's server_name.
   */
  const primaryStart = template.indexOf("server_name localhost ingress");
  const otlpBlock = findBlocks(
    template,
    /^[^\S\n]*location[^\S\n]+(\/otlp)[^\S\n]*\{[^\S\n]*$/,
  ).find((block) => {
    return block.startIndex > primaryStart;
  });

  assert.notEqual(primaryStart, -1, "primary ingress server_name not found");
  assert.ok(otlpBlock, "the primary's location /otlp not found");
  assert.ok(
    otlpBlock.body.includes(`parses up to ${appOtlpHttpCapBytes() / MIB}M`),
    "the /otlp comment misquotes the App's OTLP/HTTP cap",
  );
  assert.ok(
    otlpBlock.body.includes(
      `${appPostGunzipCapBytes() / MIB} MiB AFTER gunzip`,
    ),
    "the /otlp comment misquotes the worker's post-gunzip cap",
  );
});

// ---------------------------------------------------------------------------
// Static: still pointed at the App
// ---------------------------------------------------------------------------

test("/otlp and /telemetry still proxy, buffered, to the App's HTTP port", () => {
  for (const spec of [OTLP_HTTP_LOCATION, TELEMETRY_LOCATION]) {
    const location = onlyLocation(primaryServerBlock, spec);

    assert.deepEqual(getDirectives(location.body, "set"), [
      "set $backend_app http://${SERVER_APP_HOSTNAME}:${APP_PORT};",
    ]);
    assert.deepEqual(getDirectives(location.body, "proxy_pass"), [
      "proxy_pass ${BACKEND_APP_TARGET};",
    ]);
    assert.deepEqual(getDirectives(location.body, "return"), []);

    // Request buffering is what lets nginx refuse an oversized CHUNKED batch
    // before a byte of it reaches the App (see the live chunked tests).
    assert.deepEqual(
      getDirectives(location.body, "proxy_request_buffering"),
      [],
      `${spec} must keep nginx's default request buffering`,
    );
  }
});

test("the OTLP/gRPC location still passes to the port the App's gRPC server binds", () => {
  const grpcPort = appGrpcPort();
  const location = onlyLocation(primaryServerBlock, OTLP_GRPC_LOCATION);

  assert.deepEqual(getDirectives(location.body, "set"), [
    `set $backend_app_grpc grpc://\${SERVER_APP_HOSTNAME}:${grpcPort};`,
  ]);
  assert.deepEqual(getDirectives(location.body, "grpc_pass"), [
    "grpc_pass ${BACKEND_APP_GRPC_TARGET};",
  ]);

  // ...and so do the Kubernetes-mode keepalive pools both targets can name.
  const source = stripComments(template);
  const [grpcPool] = findBlocks(source, /^upstream\s+backend_app_grpc\s*\{/);
  const [httpPool] = findBlocks(source, /^upstream\s+backend_app\s*\{/);

  assert.ok(grpcPool && httpPool, "expected both upstream keepalive pools");
  assert.deepEqual(getDirectives(grpcPool.body, "server"), [
    `server \${SERVER_APP_HOSTNAME}:${grpcPort};`,
  ]);
  assert.deepEqual(getDirectives(httpPool.body, "server"), [
    "server ${SERVER_APP_HOSTNAME}:${APP_PORT};",
  ]);
});

test(
  "the limit and the App upstreams survive rendering in both upstream modes",
  { skip: envsubstSkipReason },
  () => {
    for (const mode of UPSTREAM_MODES) {
      const rendered = render(baseEnvironment(mode.environment));
      const renderedServers = getServerBlocks(rendered);
      const renderedPrimary = renderedServers.find((block) => {
        return /server_name\s+localhost\s+ingress/.test(block.body);
      });

      assert.ok(renderedPrimary, `${mode.name}: primary ingress lost`);

      for (const spec of OTLP_LOCATIONS) {
        assert.deepEqual(
          getDirectives(
            onlyLocation(renderedPrimary, spec).body,
            "client_max_body_size",
          ),
          [OTLP_BATCH_LIMIT_DIRECTIVE],
          `${mode.name}: ${spec}`,
        );
      }

      for (const spec of [OTLP_HTTP_LOCATION, TELEMETRY_LOCATION]) {
        assert.deepEqual(
          getDirectives(onlyLocation(renderedPrimary, spec).body, "proxy_pass"),
          [`proxy_pass ${mode.environment.BACKEND_APP_TARGET};`],
          `${mode.name}: ${spec}`,
        );
      }

      assert.deepEqual(
        getDirectives(
          onlyLocation(renderedPrimary, OTLP_GRPC_LOCATION).body,
          "grpc_pass",
        ),
        [`grpc_pass ${mode.environment.BACKEND_APP_GRPC_TARGET};`],
        mode.name,
      );

      // The status-page servers' copies, which pass from inside an `if` in
      // the plaintext one.
      const renderedStatusPageServers = renderedServers.filter((block) => {
        return block !== renderedPrimary;
      });

      assert.equal(renderedStatusPageServers.length, 2, mode.name);

      for (const serverBlock of renderedStatusPageServers) {
        for (const spec of OTLP_HTTP_SPECS) {
          const location = onlyLocation(serverBlock, spec);

          assert.deepEqual(
            getDirectives(location.body, "client_max_body_size"),
            [OTLP_BATCH_LIMIT_DIRECTIVE],
            `${mode.name}: ${spec} in ${serverLabel(serverBlock)}`,
          );
          assert.deepEqual(
            getDirectives(location.body, "proxy_pass"),
            [`proxy_pass ${mode.environment.BACKEND_APP_TARGET};`],
            `${mode.name}: ${spec} in ${serverLabel(serverBlock)}`,
          );
        }
      }

      // The pools exist exactly when the targets name them.
      assert.equal(
        rendered.includes("upstream backend_app_grpc {"),
        mode.environment.NGINX_UPSTREAM_KEEPALIVE === "true",
        mode.name,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Static: OTLP under a Host the primary ingress does not name
// ---------------------------------------------------------------------------

/*
 * nginx picks the server block by Host. The primary ingress only answers to
 * "localhost ingress $HOST"; anything else -- the ingress's IP, an in-cluster
 * Service name, a second DNS name, or any name at all while HOST is left at
 * its "localhost" default -- lands in the default server of the port, which
 * is a status-page server on both 7849 and 7850. Each of those forwards
 * OTLP to the same App, which serves it under "/" and "/telemetry" whatever
 * the Host, so before they carried their own /otlp and /telemetry the batch
 * went through their `location /` on nginx's 1M default and still got
 * GH#3978's bare 413.
 */

/*
 * Hosts the primary ingress does not name, as an exporter really sends them:
 * the ingress's own address, and the Helm chart's in-cluster Service name
 * ("<release>-nginx", HelmChart/Public/oneuptime/templates/nginx.yaml), fully
 * qualified, and short with a port.
 */
const UNNAMED_HOSTS = [
  "10.0.0.5",
  "oneuptime-nginx.oneuptime.svc.cluster.local",
  "oneuptime-nginx:80",
];

// A status page's custom domain, which only the status-page servers serve.
const STATUS_PAGE_DOMAIN = "status.customer.example";

/** $host for a Host header: the name, lowercased, without its port. */
function hostName(host) {
  return host.replace(/:\d+$/, "").toLowerCase();
}

test("the unnamed hosts are not names the primary ingress answers to", () => {
  // The live tests below rely on these reaching a default server.
  const [serverName] = getDirectives(primaryServerBlock.body, "server_name");
  const names = serverName
    .replace(/^server_name\s+/, "")
    .replace(/;$/, "")
    .split(/\s+/)
    .map((name) => {
      return name === "${HOST}" ? INGRESS_HOST : name;
    });

  assert.deepEqual(names, ["localhost", "ingress", INGRESS_HOST]);

  for (const host of [...UNNAMED_HOSTS, STATUS_PAGE_DOMAIN]) {
    assert.ok(!names.includes(hostName(host)), host);
  }
});

test("the plaintext default server routes every OTLP/HTTP route to a 4M location, on both prefixes", () => {
  const defaultServer = plaintextIngressDefaultServer();
  const locations = getLocationBlocks(defaultServer.body);

  for (const route of appOtlpHttpRoutes()) {
    for (const [uri, expectedSpec] of [
      [route, OTLP_HTTP_LOCATION],
      [`/telemetry${route}`, TELEMETRY_LOCATION],
    ]) {
      const location = resolveLocation(locations, uri);

      assert.ok(location, `${uri} matches no location`);
      assert.equal(location.spec, expectedSpec, `${uri} is routed elsewhere`);
      assert.equal(
        effectiveBodyLimit(defaultServer, location),
        OTLP_BATCH_LIMIT_BYTES,
        uri,
      );
    }
  }
});

test("every server block that forwards OTLP/HTTP to the App gives it the same 4M", () => {
  /*
   * Whichever server a batch lands in, if that server hands it to the App it
   * has to take the batch the primary takes. Today all three do: the primary,
   * and both status-page default servers (the plaintext one only while
   * billing is off; see the billing test below).
   */
  const routes = appOtlpHttpRoutes();
  let forwardingServers = 0;

  for (const serverBlock of serverBlocks) {
    const locations = getLocationBlocks(serverBlock.body);
    let forwards = false;

    for (const route of routes) {
      for (const uri of [route, `/telemetry${route}`]) {
        const location = resolveLocation(locations, uri);

        if (!location || !forwardsToApp(location)) {
          continue;
        }

        forwards = true;

        assert.equal(
          effectiveBodyLimit(serverBlock, location),
          OTLP_BATCH_LIMIT_BYTES,
          `${uri} in the server with "${serverLabel(serverBlock)}" lands in "location ${location.spec}"`,
        );
      }
    }

    if (forwards) {
      forwardingServers++;
    }
  }

  assert.equal(forwardingServers, serverBlocks.length);
});

test("the plaintext default server's OTLP locations keep its billing redirect", () => {
  /*
   * Its `location /` sends plain-HTTP traffic to https when billing is on
   * (the hosted product) and proxies otherwise. /otlp and /telemetry pre-empt
   * it for their prefixes, so a copy without that split would start
   * proxying plain-HTTP ingest on the hosted product.
   */
  const BILLING_REDIRECT =
    /if\s*\(\$billing_enabled\s*=\s*true\)\s*\{\s*return 301 https:\/\/\$host\$request_uri;\s*\}/;
  const BILLING_OFF_PROXY =
    /if\s*\(\$billing_enabled\s*!=\s*true\)\s*\{\s*proxy_pass \$\{BACKEND_APP_TARGET\};\s*\}/;

  const defaultServer = plaintextIngressDefaultServer();
  const rootLocation = onlyLocation(defaultServer, "/");

  assert.deepEqual(
    ownDirectives(defaultServer.body, "set"),
    ["set $billing_enabled ${BILLING_ENABLED};"],
    "premise: the server sets $billing_enabled for its locations",
  );
  assert.match(stripComments(rootLocation.body), BILLING_REDIRECT, "premise");
  assert.match(stripComments(rootLocation.body), BILLING_OFF_PROXY, "premise");

  for (const spec of OTLP_HTTP_SPECS) {
    const location = onlyLocation(defaultServer, spec);
    const body = stripComments(location.body);

    assert.match(body, BILLING_REDIRECT, spec);
    assert.match(body, BILLING_OFF_PROXY, spec);

    // Nothing else decides where the request goes...
    for (const directive of ["return", "proxy_pass", "rewrite"]) {
      assert.deepEqual(
        getDirectives(location.body, directive),
        getDirectives(rootLocation.body, directive),
        `${spec}: ${directive}`,
      );
    }

    // ...and the App sees the same forwarding headers either way.
    for (const header of FORWARDING_HEADERS) {
      assert.ok(
        getDirectives(rootLocation.body, "proxy_set_header").includes(header),
        `premise: location / sends "${header}"`,
      );
      assert.ok(
        getDirectives(location.body, "proxy_set_header").includes(header),
        `${spec} must send "${header}" like location /`,
      );
    }
  }
});

test("the TLS default server's OTLP locations proxy unconditionally, like its location /", () => {
  const tlsDefaultServer = tlsIngressDefaultServer();
  const rootLocation = onlyLocation(tlsDefaultServer, "/");

  assert.deepEqual(getDirectives(rootLocation.body, "proxy_pass"), [
    "proxy_pass ${BACKEND_APP_TARGET};",
  ]);

  for (const spec of OTLP_HTTP_SPECS) {
    const location = onlyLocation(tlsDefaultServer, spec);

    assert.deepEqual(getDirectives(location.body, "proxy_pass"), [
      "proxy_pass ${BACKEND_APP_TARGET};",
    ]);
    assert.deepEqual(getDirectives(location.body, "return"), [], spec);
    assert.deepEqual(getDirectives(location.body, "rewrite"), [], spec);
    assert.ok(!/\bif\s*\(/.test(stripComments(location.body)), spec);

    for (const header of FORWARDING_HEADERS) {
      assert.ok(
        getDirectives(rootLocation.body, "proxy_set_header").includes(header),
        `premise: location / sends "${header}"`,
      );
      assert.ok(
        getDirectives(location.body, "proxy_set_header").includes(header),
        `${spec} must send "${header}" like location /`,
      );
    }
  }
});

test("the status-page servers raise only their two OTLP prefixes", () => {
  /*
   * They exist to serve status pages to anonymous visitors on custom
   * domains. The raise is scoped to /otlp and /telemetry rather than put on
   * the server or its `location /`, so everything else there keeps nginx's
   * 1M default.
   */
  for (const serverBlock of statusPageServers()) {
    assert.deepEqual(
      ownDirectives(serverBlock.body, "client_max_body_size"),
      [],
      serverLabel(serverBlock),
    );

    for (const location of getLocationBlocks(serverBlock.body)) {
      if (OTLP_HTTP_SPECS.includes(location.spec)) {
        continue;
      }

      assert.equal(
        effectiveBodyLimit(serverBlock, location),
        NGINX_DEFAULT_BODY_LIMIT_BYTES,
        `location ${location.spec} in ${serverLabel(serverBlock)}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Static: gaps the fix leaves
// ---------------------------------------------------------------------------

test("KNOWN BUG: the plaintext ingress port speaks h2c, so OTLP/gRPC can reach its location", async (t) => {
  /*
   * nginx decides whether a plaintext connection may be HTTP/2 before it has
   * read a Host, from the DEFAULT server of that address:port. The primary
   * ingress sets `http2 on`, but the default server on the ingress port is
   * the status-page block, which does not -- so an OTLP/gRPC exporter with
   * `insecure: true` gets its HTTP/2 preface answered as an HTTP/1.x request
   * ("PRI * HTTP/2.0" 400) and never reaches the gRPC location this fix
   * raised. Over TLS, SNI picks the primary first and h2 works.
   */
  assert.ok(
    http2Enabled(primaryServerBlock),
    "premise: the primary ingress asks for HTTP/2",
  );

  await expectKnownBug(t, () => {
    assert.ok(
      http2Enabled(plaintextIngressDefaultServer()),
      "the plaintext ingress port's default server does not enable http2",
    );
  });
});

// ---------------------------------------------------------------------------
// Live harness
// ---------------------------------------------------------------------------

const REQUEST_ID_HEADER = "x-oneuptime-test-request-id";
const UPSTREAM_HEADER = "x-oneuptime-test-upstream";

// Every nginx this file starts, so none can outlive a crashed run.
const liveNginxProcesses = new Set();

process.on("exit", () => {
  for (const child of liveNginxProcesses) {
    child.kill("SIGKILL");
  }
});

function newRequestId() {
  return crypto.randomUUID();
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** A gRPC length-prefixed message: flag byte 0, 4-byte big-endian length. */
function grpcFrame(message) {
  const prefix = Buffer.alloc(5);
  prefix.writeUInt32BE(message.length, 1);
  return Buffer.concat([prefix, message]);
}

function listenOnLoopback(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

async function freePort() {
  const probe = net.createServer();
  const port = await listenOnLoopback(probe);
  await new Promise((resolve) => {
    probe.close(resolve);
  });
  return port;
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    server.close(() => {
      resolve();
    });
  });
}

async function waitUntil(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) {
      return true;
    }
    await delay(25);
  }

  return condition();
}

function recordUnder(recordsById, id, record) {
  if (!recordsById.has(id)) {
    recordsById.set(id, []);
  }
  recordsById.get(id).push(record);
}

/**
 * Stands in for the App's HTTP port. Records every request the moment its
 * headers arrive, keyed by the test's request id, so "never reached the App"
 * means not one byte of it did -- a body nginx starts streaming and then
 * abandons still shows up, as incomplete. Answers 200 so the client can tell
 * an App reply from an nginx one.
 */
async function startAppStub() {
  const recordsById = new Map();

  const server = http.createServer((request, response) => {
    const hash = crypto.createHash("sha256");
    const record = {
      method: request.method,
      url: request.url,
      host: request.headers.host,
      contentLength: request.headers["content-length"],
      transferEncoding: request.headers["transfer-encoding"],
      bytes: 0,
      complete: false,
      sha256: null,
    };

    recordUnder(recordsById, request.headers[REQUEST_ID_HEADER], record);

    request.on("data", (chunk) => {
      record.bytes += chunk.length;
      hash.update(chunk);
    });

    // An upstream connection nginx gives up on is not a stub failure.
    request.on("error", () => {});

    request.on("end", () => {
      record.complete = true;
      record.sha256 = hash.digest("hex");

      response.writeHead(200, {
        "content-type": "application/json",
        [UPSTREAM_HEADER]: "app",
      });
      response.end("{}");
    });
  });

  const port = await listenOnLoopback(server);

  return {
    port,
    requestsFor: (id) => {
      return recordsById.get(id) || [];
    },
    close: () => {
      return closeServer(server);
    },
  };
}

/**
 * Stands in for the App's OTLP gRPC server (h2c, as grpc_pass speaks it).
 * Records each stream and whether the whole length-prefixed message arrived,
 * then answers grpc-status 0 with an empty Export*ServiceResponse.
 */
async function startGrpcStub() {
  const recordsById = new Map();
  const server = http2.createServer();

  server.on("stream", (stream, headers) => {
    const hash = crypto.createHash("sha256");
    const record = {
      path: headers[":path"],
      contentType: headers["content-type"],
      bytes: 0,
      prefix: Buffer.alloc(0),
      aborted: false,
      closed: false,
      sha256: null,
    };

    recordUnder(recordsById, headers[REQUEST_ID_HEADER], record);

    stream.on("data", (chunk) => {
      if (record.prefix.length < 5) {
        record.prefix = Buffer.concat([record.prefix, chunk]).subarray(0, 5);
      }
      record.bytes += chunk.length;
      hash.update(chunk);
    });

    stream.on("aborted", () => {
      record.aborted = true;
    });

    // nginx resetting an oversized stream is expected, not a stub failure.
    stream.on("error", () => {});

    stream.on("close", () => {
      record.closed = true;
    });

    stream.on("end", () => {
      record.sha256 = hash.digest("hex");

      if (stream.destroyed || stream.closed) {
        return;
      }

      stream.respond(
        {
          ":status": 200,
          "content-type": "application/grpc",
          [UPSTREAM_HEADER]: "app-grpc",
        },
        { waitForTrailers: true },
      );
      stream.on("wantTrailers", () => {
        stream.sendTrailers({ "grpc-status": "0" });
      });
      stream.end(grpcFrame(Buffer.alloc(0)));
    });
  });

  server.on("sessionError", () => {});

  const port = await listenOnLoopback(server);

  return {
    port,
    requestsFor: (id) => {
      return recordsById.get(id) || [];
    },
    /** True once every stream for `id` has closed, however it ended. */
    settled: (id) => {
      return (recordsById.get(id) || []).every((record) => {
        return record.closed;
      });
    },
    close: () => {
      return closeServer(server);
    },
  };
}

/** Whether a recorded gRPC stream delivered its whole message, and only it. */
function deliveredWholeMessage(record) {
  return (
    !record.aborted &&
    record.prefix.length === 5 &&
    record.bytes === 5 + record.prefix.readUInt32BE(1)
  );
}

function replaceEveryOccurrence(source, from, to) {
  const count = source.split(from).length - 1;
  assert.ok(count > 0, `"${from}" no longer appears in the rendered config`);
  return source.split(from).join(to);
}

/*
 * Which server blocks of a rendered, comment-stripped config an edit applies
 * to, told apart by their server_name.
 */
const RENDERED_SERVERS = {
  primary: (serverBody) => {
    return /server_name\s+localhost\s+ingress\b/.test(serverBody);
  },
  statusPage: (serverBody) => {
    return /server_name\s+_\s*;/.test(serverBody);
  },
};

/**
 * Delete a location's client_max_body_size from a rendered config, in every
 * server block `server` selects: the config as it was before the fix, for
 * the control suites. Works on the config with its comments stripped (nginx
 * does not care), because prose in the comments carries unbalanced braces.
 */
function withoutBodyLimitIn(rendered, { location: locationHeader, server }) {
  const source = stripComments(rendered);
  const header = `\n    ${locationHeader} {`;
  const spans = [];

  for (const serverBlock of findBlocks(source, /^server\s*\{[^\S\n]*$/)) {
    if (!server(serverBlock.body)) {
      continue;
    }

    const bodyStart = source.indexOf("{", serverBlock.startIndex) + 1;
    const start = serverBlock.body.indexOf(header);

    assert.notEqual(start, -1, `${locationHeader} missing from a server block`);
    assert.equal(
      serverBlock.body.indexOf(header, start + 1),
      -1,
      `${locationHeader} appears twice in one server block`,
    );

    spans.push({
      start: bodyStart + start,
      end: bodyStart + serverBlock.body.indexOf("\n    }", start + 1),
    });
  }

  assert.ok(spans.length > 0, `no server block selected for ${locationHeader}`);

  // Last first, so the earlier offsets stay valid.
  return spans.reverse().reduce((edited, { start, end }) => {
    const block = edited.slice(start, end);
    const withoutLimit = block.replace(
      /^[ \t]*client_max_body_size 4M;\n/m,
      "",
    );

    assert.notEqual(
      withoutLimit,
      block,
      `${locationHeader} had no 4M limit to remove`,
    );
    assert.ok(
      /(proxy|grpc)_pass /.test(withoutLimit),
      "sliced the wrong block",
    );

    return edited.slice(0, start) + withoutLimit + edited.slice(end);
  }, source);
}

/**
 * A self-signed certificate for `host` in `directory`, as
 * <basename>.crt/.key. `readableByWorkers` is for a certificate nginx loads
 * per handshake from a path with variables in it (the status-page servers'
 * StatusPageCerts/$ssl_server_name.crt): the worker reads that one, not the
 * master, and in the docker run workers are not root.
 */
/*
 * Every certificate makeTlsCertificate has issued. TLS clients below trust
 * exactly these (as `ca`) rather than turning verification off, so a
 * handshake also proves nginx presented the certificate for the SNI name.
 */
const issuedCertificatePaths = new Set();

function trustedTestCertificates() {
  return [...issuedCertificatePaths]
    .filter((certificatePath) => {
      return fs.existsSync(certificatePath);
    })
    .map((certificatePath) => {
      return fs.readFileSync(certificatePath);
    });
}

function makeTlsCertificate(
  directory,
  { host = INGRESS_HOST, basename = "ingress", readableByWorkers = false } = {},
) {
  const certificatePath = path.join(directory, `${basename}.crt`);
  const keyPath = path.join(directory, `${basename}.key`);

  // The same command envsubst-on-templates.sh uses for its placeholder cert.
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      `/CN=${host}`,
      // Node verifies the name against the SAN; the CN alone is not enough.
      "-addext",
      `subjectAltName=DNS:${host}`,
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
      "-days",
      "2",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  issuedCertificatePaths.add(certificatePath);

  if (readableByWorkers) {
    fs.chmodSync(certificatePath, 0o644);
    fs.chmodSync(keyPath, 0o644);
  }

  return { certificatePath, keyPath };
}

/**
 * Render the template for this host the way envsubst-on-templates.sh would
 * for a container, start a real nginx on it, and wait until it listens.
 *
 * What differs from the shipped config is only what has to: the App's
 * address (our stubs on loopback), the listen ports (free ones instead of
 * 7849/7850/4317), and nginx.conf's absolute paths (moved into a temp
 * prefix, exactly as NginxTemplateRender.test.js does for `nginx -t`) --
 * plus, with `statusPageCertificates`, the StatusPageCerts directory, moved
 * into the prefix and holding a certificate for each of those names.
 *
 * `tls` provisions the primary's certificate (PROVISION_SSL);
 * `environment` overrides the container environment (e.g. BILLING_ENABLED).
 */
async function startIngress({
  appPort,
  grpcPort,
  upstreamMode = UPSTREAM_MODES[0],
  tls = false,
  environment: environmentOverrides = {},
  statusPageCertificates = [],
  withoutBodyLimitIn: strippedLocations = [],
}) {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-otlp-"));

  // nginx drops privileges for its workers when started as root (the docker
  // run), and they must still reach the body temp files under this prefix.
  fs.chmodSync(prefix, 0o755);
  fs.mkdirSync(path.join(prefix, "conf.d"));
  fs.mkdirSync(path.join(prefix, "logs"));

  const httpPort = await freePort();
  const tlsPort = await freePort();

  const environment = baseEnvironment({
    ...upstreamMode.environment,
    APP_PORT: String(appPort),
    HOME_PORT: String(appPort),
    NGINX_LISTEN_ADDRESS: "127.0.0.1:",
    NGINX_RESOLVER: "127.0.0.1",
    SERVER_APP_HOSTNAME: "127.0.0.1",
    SERVER_HOME_HOSTNAME: "127.0.0.1",
    ...environmentOverrides,
  });

  if (tls) {
    const { certificatePath, keyPath } = makeTlsCertificate(prefix);

    // What envsubst-on-templates.sh exports when PROVISION_SSL is set.
    Object.assign(environment, {
      PROVISION_SSL_LISTEN_DIRECTIVE: `    listen ${environment.NGINX_LISTEN_ADDRESS}7850 ssl ${environment.NGINX_LISTEN_OPTIONS};`,
      PROVISION_SSL_CERTIFICATE_DIRECTIVE: `    ssl_certificate ${certificatePath};`,
      PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE: `    ssl_certificate_key ${keyPath};`,
    });
  }

  let rendered = render(environment);

  rendered = replaceEveryOccurrence(
    rendered,
    `127.0.0.1:${INGRESS_PORT}`,
    `127.0.0.1:${httpPort}`,
  );
  rendered = replaceEveryOccurrence(
    rendered,
    "127.0.0.1:7850",
    `127.0.0.1:${tlsPort}`,
  );
  rendered = replaceEveryOccurrence(
    rendered,
    `127.0.0.1:${appGrpcPort()}`,
    `127.0.0.1:${grpcPort}`,
  );

  if (statusPageCertificates.length > 0) {
    const certificateDirectory = path.join(prefix, "StatusPageCerts");

    fs.mkdirSync(certificateDirectory);

    for (const host of statusPageCertificates) {
      makeTlsCertificate(certificateDirectory, {
        host,
        basename: host,
        readableByWorkers: true,
      });
    }

    rendered = replaceEveryOccurrence(
      rendered,
      "/etc/nginx/certs/StatusPageCerts/",
      `${certificateDirectory}/`,
    );
  }

  for (const edit of strippedLocations) {
    rendered = withoutBodyLimitIn(rendered, edit);
  }

  const temporaryPaths = [
    "client_body_temp_path",
    "proxy_temp_path",
    "fastcgi_temp_path",
    "uwsgi_temp_path",
    "scgi_temp_path",
  ]
    .map((directive) => {
      return `${directive} ${path.join(prefix, directive)};`;
    })
    .join("\n    ");

  const mainConf = nginxConf
    .replace(/^load_module .*\n/m, "")
    .replace(/^user\s+.*\n/m, "")
    .replace(/^\s*include\s+\/etc\/nginx\/mime\.types;\n/m, "")
    .replace(/\/var\/log\/nginx\//g, `${prefix}/logs/`)
    .replace(/\/var\/run\/nginx\.pid/g, `${prefix}/logs/nginx.pid`)
    .replace(
      "include /etc/nginx/conf.d/default.conf;",
      `${temporaryPaths}\n    include ${prefix}/conf.d/default.conf;`,
    );

  // Otherwise nginx would quietly serve the image's own default.conf.
  assert.ok(
    mainConf.includes(`include ${prefix}/conf.d/default.conf;`),
    "nginx.conf no longer includes conf.d/default.conf where expected",
  );

  fs.writeFileSync(path.join(prefix, "nginx.conf"), mainConf);
  fs.writeFileSync(path.join(prefix, "conf.d", "default.conf"), rendered);

  const errorLogPath = path.join(prefix, "logs", "error.log");
  const child = spawn(
    "nginx",
    [
      "-p",
      prefix,
      "-c",
      path.join(prefix, "nginx.conf"),
      "-e",
      errorLogPath,
      "-g",
      "daemon off;",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";

  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  liveNginxProcesses.add(child);

  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
  });

  function errorLog() {
    try {
      return fs.readFileSync(errorLogPath, "utf8");
    } catch {
      return "";
    }
  }

  const listening = await waitUntil(async () => {
    if (child.exitCode !== null) {
      return true;
    }

    return new Promise((resolve) => {
      const socket = net.connect(httpPort, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        resolve(false);
      });
    });
  }, 15000);

  assert.ok(
    listening && child.exitCode === null,
    `nginx did not start:\n${stderr}\n${errorLog()}`,
  );

  return {
    httpPort,
    tlsPort,
    /** Error-log bytes so far; pass to errorLogSince() to see only what follows. */
    errorLogOffset: () => {
      return Buffer.byteLength(errorLog());
    },
    errorLogSince: (offset) => {
      return Buffer.from(errorLog()).subarray(offset).toString("utf8");
    },
    stop: async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        const stopped = await Promise.race([
          exited.then(() => {
            return true;
          }),
          delay(5000).then(() => {
            return false;
          }),
        ]);

        if (!stopped) {
          child.kill("SIGKILL");
          await exited;
        }
      }

      liveNginxProcesses.delete(child);
      fs.rmSync(prefix, { recursive: true, force: true });
    },
  };
}

/**
 * POST `body` over HTTP/1.1. `chunked` sends it with Transfer-Encoding:
 * chunked and no Content-Length, in 64 KiB writes, so nginx has to count it
 * as it arrives rather than refuse it from the header. `tls` sends it over
 * TLS with SNI for the Host's name (HTTP/1.1, which is all the status-page
 * TLS server offers), and reports the name on the certificate that answered.
 */
function postHttp1({
  port,
  uri,
  body,
  host = INGRESS_HOST,
  chunked,
  id,
  tls = false,
}) {
  return new Promise((resolve, reject) => {
    const headers = {
      host,
      "content-type": "application/x-protobuf",
      [REQUEST_ID_HEADER]: id,
    };

    if (chunked) {
      headers["transfer-encoding"] = "chunked";
    } else {
      headers["content-length"] = String(body.length);
    }

    const options = {
      host: "127.0.0.1",
      port,
      method: "POST",
      path: uri,
      headers,
      agent: false,
    };

    const request = tls
      ? https.request({
          ...options,
          servername: hostName(host),
          ca: trustedTestCertificates(),
        })
      : http.request(options);
    let answered = false;

    request.on("response", (response) => {
      const chunks = [];
      const certificateName = tls
        ? response.socket.getPeerCertificate().subject.CN
        : undefined;

      response.on("data", (chunk) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        answered = true;
        resolve({
          status: response.statusCode,
          headers: response.headers,
          text: Buffer.concat(chunks).toString("utf8"),
          certificateName,
        });
      });
    });

    // nginx may answer an oversized body before it has all been written.
    request.on("error", (error) => {
      if (!answered) {
        reject(error);
      }
    });

    for (let offset = 0; offset < body.length; offset += 64 * 1024) {
      request.write(body.subarray(offset, offset + 64 * 1024));
    }

    request.end();
  });
}

/**
 * POST `body` on one HTTP/2 stream and collect everything that comes back.
 * Over TLS the session negotiates h2 by ALPN with SNI for the ingress host,
 * which is what an exporter pointed at https://<host> does. Never rejects:
 * a refused connection is an outcome the tests assert on.
 */
function postHttp2({
  origin,
  uri,
  body,
  id,
  grpc = false,
  withContentLength = false,
}) {
  return new Promise((resolve) => {
    const result = {
      alpnProtocol: undefined,
      status: undefined,
      headers: {},
      trailers: {},
      text: "",
      error: undefined,
    };
    const chunks = [];
    let finished = false;

    const session = http2.connect(
      origin,
      origin.startsWith("https:")
        ? { servername: INGRESS_HOST, ca: trustedTestCertificates() }
        : {},
    );

    function finish() {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        result.text = Buffer.concat(chunks).toString("utf8");
        session.destroy();
        resolve(result);
      }
    }

    const timer = setTimeout(() => {
      result.error = result.error || new Error("timed out");
      finish();
    }, 15000);

    session.on("error", (error) => {
      result.error = result.error || error;
    });
    session.on("connect", () => {
      result.alpnProtocol = session.alpnProtocol;
    });
    session.on("close", () => {
      finish();
    });

    const headers = {
      ":method": "POST",
      ":path": uri,
      ":authority": INGRESS_HOST,
      "content-type": grpc ? "application/grpc" : "application/x-protobuf",
      [REQUEST_ID_HEADER]: id,
    };

    if (grpc) {
      headers.te = "trailers";
    }

    // gRPC clients send no content-length; nginx then has to count DATA.
    if (withContentLength) {
      headers["content-length"] = String(body.length);
    }

    const stream = session.request(headers);

    stream.on("response", (responseHeaders) => {
      result.status = responseHeaders[":status"];
      result.headers = responseHeaders;
    });
    stream.on("trailers", (trailers) => {
      result.trailers = trailers;
    });
    stream.on("data", (chunk) => {
      chunks.push(chunk);
    });
    stream.on("error", (error) => {
      result.error = result.error || error;
    });
    stream.on("close", () => {
      finish();
    });

    stream.end(body);
  });
}

/** The reply came from our App stub, not from nginx. */
function assertAnsweredByApp(response, what) {
  assert.equal(
    response.status,
    200,
    `${what}: expected the App's 200, got ${response.status}: ${response.text || response.error}`,
  );
  assert.equal(response.headers[UPSTREAM_HEADER], "app", what);
}

/** nginx refused it with its own 413: no App header, nginx's error page. */
function assertRefusedByNginx(response, what) {
  assert.equal(
    response.status,
    413,
    `${what}: expected nginx's 413, got ${response.status}: ${response.text || response.error}`,
  );
  assert.equal(response.headers[UPSTREAM_HEADER], undefined, what);
  assert.ok(response.text.includes("413 Request Entity Too Large"), what);
}

/** nginx sent it to https itself: a 301 to `location`, no App header. */
function assertRedirectedByNginx(response, location, what) {
  assert.equal(
    response.status,
    301,
    `${what}: expected nginx's 301, got ${response.status}: ${response.text || response.error}`,
  );
  assert.equal(response.headers.location, location, what);
  assert.equal(response.headers[UPSTREAM_HEADER], undefined, what);
}

// ---------------------------------------------------------------------------
// Live: OTLP/HTTP over HTTP/1.1
// ---------------------------------------------------------------------------

const OTLP_HTTP_ENTRY_POINTS = [
  { location: OTLP_HTTP_LOCATION, uri: "/otlp/v1/metrics" },
  { location: TELEMETRY_LOCATION, uri: "/telemetry/otlp/v1/metrics" },
];

const ADMITTED_SIZES = [
  // One byte past the 1M default that caused GH#3978.
  { label: "1 MiB + 1 byte", bytes: NGINX_DEFAULT_BODY_LIMIT_BYTES + 1 },
  { label: "3 MiB", bytes: 3 * MIB },
  { label: "4 MiB - 64 KiB", bytes: OTLP_BATCH_LIMIT_BYTES - 64 * 1024 },
  // client_max_body_size refuses only what is strictly larger.
  { label: "exactly 4 MiB", bytes: OTLP_BATCH_LIMIT_BYTES },
];

const REFUSED_SIZES = [
  { label: "4 MiB + 1 byte", bytes: OTLP_BATCH_LIMIT_BYTES + 1 },
  { label: "5 MiB", bytes: 5 * MIB },
];

for (const upstreamMode of UPSTREAM_MODES) {
  describe(
    `live: OTLP/HTTP batches through the rendered ingress, ${upstreamMode.name}`,
    { skip: liveSkipReason, timeout: 120000 },
    () => {
      let appStub;
      let grpcStub;
      let ingress;

      before(async () => {
        appStub = await startAppStub();
        grpcStub = await startGrpcStub();
        ingress = await startIngress({
          appPort: appStub.port,
          grpcPort: grpcStub.port,
          upstreamMode,
        });
      });

      after(async () => {
        await ingress?.stop();
        await appStub?.close();
        await grpcStub?.close();
      });

      for (const { location, uri } of OTLP_HTTP_ENTRY_POINTS) {
        for (const size of ADMITTED_SIZES) {
          test(`${uri}: a batch of ${size.label} reaches the App whole`, async () => {
            const id = newRequestId();
            const body = crypto.randomBytes(size.bytes);

            const response = await postHttp1({
              port: ingress.httpPort,
              uri,
              body,
              id,
            });

            assertAnsweredByApp(response, `${location}, ${size.label}`);

            const forwarded = appStub.requestsFor(id);

            assert.equal(forwarded.length, 1, "forwarded exactly once");
            assert.equal(forwarded[0].method, "POST");
            assert.equal(forwarded[0].url, uri);
            assert.equal(forwarded[0].complete, true);
            assert.equal(forwarded[0].bytes, size.bytes);
            assert.equal(forwarded[0].sha256, sha256(body));
          });
        }

        for (const size of REFUSED_SIZES) {
          test(`${uri}: a batch of ${size.label} gets nginx's 413 and never reaches the App`, async () => {
            const id = newRequestId();
            const logOffset = ingress.errorLogOffset();

            const response = await postHttp1({
              port: ingress.httpPort,
              uri,
              body: crypto.randomBytes(size.bytes),
              id,
            });

            assertRefusedByNginx(response, `${location}, ${size.label}`);
            assert.deepEqual(appStub.requestsFor(id), []);

            // Refused from the Content-Length, before reading the body.
            assert.ok(
              ingress
                .errorLogSince(logOffset)
                .includes(
                  `client intended to send too large body: ${size.bytes} bytes`,
                ),
              ingress.errorLogSince(logOffset),
            );
          });
        }

        test(`${uri}: a chunked 3 MiB batch reaches the App whole`, async () => {
          const id = newRequestId();
          const body = crypto.randomBytes(3 * MIB);

          const response = await postHttp1({
            port: ingress.httpPort,
            uri,
            body,
            id,
            chunked: true,
          });

          assertAnsweredByApp(response, `${location}, chunked 3 MiB`);

          const forwarded = appStub.requestsFor(id);

          assert.equal(forwarded.length, 1);
          assert.equal(forwarded[0].bytes, body.length);
          assert.equal(forwarded[0].sha256, sha256(body));

          // nginx buffered it whole and re-framed it with a length.
          assert.equal(forwarded[0].contentLength, String(body.length));
          assert.equal(forwarded[0].transferEncoding, undefined);
        });

        test(`${uri}: a chunked 5 MiB batch is cut off at the limit and never reaches the App`, async () => {
          const id = newRequestId();
          const logOffset = ingress.errorLogOffset();

          const response = await postHttp1({
            port: ingress.httpPort,
            uri,
            body: crypto.randomBytes(5 * MIB),
            id,
            chunked: true,
          });

          assertRefusedByNginx(response, `${location}, chunked 5 MiB`);
          assert.deepEqual(appStub.requestsFor(id), []);

          // nginx logs "<read so far>+<next chunk's size>" for a chunked body.
          const counted =
            /client intended to send too large chunked body: (\d+)\+(\d+) bytes/.exec(
              ingress.errorLogSince(logOffset),
            );

          assert.ok(counted, ingress.errorLogSince(logOffset));

          // It stopped AT the limit: what it had read fit, the next chunk
          // would not have.
          const alreadyRead = Number(counted[1]);
          const nextChunk = Number(counted[2]);

          assert.ok(alreadyRead <= OTLP_BATCH_LIMIT_BYTES, counted[0]);
          assert.ok(
            alreadyRead + nextChunk > OTLP_BATCH_LIMIT_BYTES,
            counted[0],
          );
        });
      }

      test("every OTLP signal route takes a 2 MiB batch on both prefixes", async () => {
        for (const route of appOtlpHttpRoutes()) {
          for (const uri of [route, `/telemetry${route}`]) {
            const id = newRequestId();
            const body = crypto.randomBytes(2 * MIB);

            const response = await postHttp1({
              port: ingress.httpPort,
              uri,
              body,
              id,
            });

            assertAnsweredByApp(response, uri);
            assert.equal(appStub.requestsFor(id)[0].url, uri);
            assert.equal(appStub.requestsFor(id)[0].sha256, sha256(body));
          }
        }
      });

      test("the limit holds under every name the primary ingress answers to", async () => {
        // Including a Host that carries the port, as in-network clients send.
        for (const host of [
          INGRESS_HOST,
          "localhost",
          "ingress",
          `ingress:${INGRESS_PORT}`,
          INGRESS_HOST.toUpperCase(),
        ]) {
          for (const [bytes, expectAdmitted] of [
            [OTLP_BATCH_LIMIT_BYTES, true],
            [OTLP_BATCH_LIMIT_BYTES + 1, false],
          ]) {
            const id = newRequestId();

            const response = await postHttp1({
              port: ingress.httpPort,
              uri: "/otlp/v1/metrics",
              body: crypto.randomBytes(bytes),
              host,
              id,
            });

            if (expectAdmitted) {
              assertAnsweredByApp(response, `Host: ${host}, ${bytes} bytes`);
              assert.equal(appStub.requestsFor(id).length, 1);
              assert.equal(appStub.requestsFor(id)[0].complete, true);
              assert.equal(appStub.requestsFor(id)[0].bytes, bytes);
            } else {
              assertRefusedByNginx(response, `Host: ${host}, ${bytes} bytes`);
              assert.deepEqual(appStub.requestsFor(id), []);
            }
          }
        }
      });

      /*
       * Names the primary does not answer to land in the status-page default
       * server (see "Static: OTLP under a Host the primary ingress does not
       * name"; the control suite below proves these requests are served
       * there). Run in both upstream modes because those locations carry
       * their own proxy_pass.
       */
      for (const host of UNNAMED_HOSTS) {
        test(`Host ${host}: 2 MiB, 3 MiB and exactly 4 MiB reach the App whole on both prefixes`, async () => {
          for (const { location, uri } of OTLP_HTTP_ENTRY_POINTS) {
            for (const bytes of [2 * MIB, 3 * MIB, OTLP_BATCH_LIMIT_BYTES]) {
              const what = `Host: ${host}, ${location}, ${bytes} bytes`;
              const id = newRequestId();
              const body = crypto.randomBytes(bytes);

              const response = await postHttp1({
                port: ingress.httpPort,
                uri,
                body,
                host,
                id,
              });

              assertAnsweredByApp(response, what);

              const forwarded = appStub.requestsFor(id);

              assert.equal(forwarded.length, 1, what);
              assert.equal(forwarded[0].url, uri, what);
              assert.equal(forwarded[0].host, hostName(host), what);
              assert.equal(forwarded[0].complete, true, what);
              assert.equal(forwarded[0].bytes, bytes, what);
              assert.equal(forwarded[0].sha256, sha256(body), what);
            }
          }
        });

        test(`Host ${host}: 4 MiB + 1 byte and 5 MiB get nginx's 413 on both prefixes and never reach the App`, async () => {
          for (const { location, uri } of OTLP_HTTP_ENTRY_POINTS) {
            for (const bytes of [OTLP_BATCH_LIMIT_BYTES + 1, 5 * MIB]) {
              const id = newRequestId();

              const response = await postHttp1({
                port: ingress.httpPort,
                uri,
                body: crypto.randomBytes(bytes),
                host,
                id,
              });

              assertRefusedByNginx(
                response,
                `Host: ${host}, ${location}, ${bytes} bytes`,
              );
              assert.deepEqual(appStub.requestsFor(id), []);
            }
          }
        });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Live control: the same ingress without the fix
// ---------------------------------------------------------------------------

describe(
  "live control: the rendered ingress with /otlp's limit removed (the GH#3978 config)",
  { skip: liveSkipReason, timeout: 120000 },
  () => {
    /*
     * Proves the live suites above are sensitive to the directive rather than
     * to something about this harness: delete just that line and the same
     * kind of batch gets the bare 413 the issue reported.
     */
    let appStub;
    let grpcStub;
    let ingress;

    before(async () => {
      appStub = await startAppStub();
      grpcStub = await startGrpcStub();
      ingress = await startIngress({
        appPort: appStub.port,
        grpcPort: grpcStub.port,
        withoutBodyLimitIn: [
          { location: "location /otlp", server: RENDERED_SERVERS.primary },
        ],
      });
    });

    after(async () => {
      await ingress?.stop();
      await appStub?.close();
      await grpcStub?.close();
    });

    test("/otlp falls back to nginx's 1M default: exactly 1 MiB still passes", async () => {
      const id = newRequestId();
      const body = crypto.randomBytes(NGINX_DEFAULT_BODY_LIMIT_BYTES);

      const response = await postHttp1({
        port: ingress.httpPort,
        uri: "/otlp/v1/metrics",
        body,
        id,
      });

      assertAnsweredByApp(response, "1 MiB without the directive");
      assert.equal(appStub.requestsFor(id)[0].sha256, sha256(body));
    });

    test("/otlp falls back to nginx's 1M default: one byte more is a bare 413", async () => {
      const id = newRequestId();

      const response = await postHttp1({
        port: ingress.httpPort,
        uri: "/otlp/v1/metrics",
        body: crypto.randomBytes(NGINX_DEFAULT_BODY_LIMIT_BYTES + 1),
        id,
      });

      assertRefusedByNginx(response, "1 MiB + 1 without the directive");
      assert.deepEqual(appStub.requestsFor(id), []);
    });

    test("/telemetry keeps its own 4M, so only the removed line changed", async () => {
      const id = newRequestId();

      const response = await postHttp1({
        port: ingress.httpPort,
        uri: "/telemetry/otlp/v1/metrics",
        body: crypto.randomBytes(OTLP_BATCH_LIMIT_BYTES),
        id,
      });

      assertAnsweredByApp(response, "/telemetry, 4 MiB");
    });

    test("a Host the primary does not name is not served by the primary's /otlp", async () => {
      // Its batch goes through the default server's own /otlp, which kept 4M.
      const id = newRequestId();

      const response = await postHttp1({
        port: ingress.httpPort,
        uri: "/otlp/v1/metrics",
        body: crypto.randomBytes(2 * MIB),
        host: UNNAMED_HOSTS[0],
        id,
      });

      assertAnsweredByApp(response, `Host: ${UNNAMED_HOSTS[0]}, 2 MiB`);
    });
  },
);

describe(
  "live control: the rendered ingress with the status-page servers' OTLP limits removed",
  { skip: tlsSkipReason, timeout: 120000 },
  () => {
    /*
     * The other half of that proof: with only the default servers' two
     * directives gone, a batch under a name the primary does not answer to is
     * back to the 1M default -- on 7849 and on 7850 -- while the primary still
     * takes it. So those requests are served by the default servers, and it
     * is their own /otlp and /telemetry that admit the batch.
     */
    let appStub;
    let grpcStub;
    let ingress;

    before(async () => {
      appStub = await startAppStub();
      grpcStub = await startGrpcStub();
      ingress = await startIngress({
        appPort: appStub.port,
        grpcPort: grpcStub.port,
        statusPageCertificates: [STATUS_PAGE_DOMAIN],
        withoutBodyLimitIn: OTLP_HTTP_SPECS.map((spec) => {
          return {
            location: `location ${spec}`,
            server: RENDERED_SERVERS.statusPage,
          };
        }),
      });
    });

    after(async () => {
      await ingress?.stop();
      await appStub?.close();
      await grpcStub?.close();
    });

    for (const { location, uri } of OTLP_HTTP_ENTRY_POINTS) {
      test(`${uri}: 2 MiB under an unnamed Host is a bare 413 on both ports; under the primary's name it passes`, async () => {
        for (const host of UNNAMED_HOSTS) {
          const id = newRequestId();

          const response = await postHttp1({
            port: ingress.httpPort,
            uri,
            body: crypto.randomBytes(2 * MIB),
            host,
            id,
          });

          assertRefusedByNginx(response, `${location}, Host: ${host}`);
          assert.deepEqual(appStub.requestsFor(id), []);
        }

        const tlsId = newRequestId();

        const overTls = await postHttp1({
          port: ingress.tlsPort,
          uri,
          body: crypto.randomBytes(2 * MIB),
          host: STATUS_PAGE_DOMAIN,
          id: tlsId,
          tls: true,
        });

        assert.equal(overTls.certificateName, STATUS_PAGE_DOMAIN);
        assertRefusedByNginx(
          overTls,
          `${location}, TLS, ${STATUS_PAGE_DOMAIN}`,
        );
        assert.deepEqual(appStub.requestsFor(tlsId), []);

        const primaryId = newRequestId();

        const primary = await postHttp1({
          port: ingress.httpPort,
          uri,
          body: crypto.randomBytes(2 * MIB),
          id: primaryId,
        });

        assertAnsweredByApp(primary, `${location}, Host: ${INGRESS_HOST}`);
      });

      test(`${uri}: exactly 1 MiB under an unnamed Host still passes, so it is the size`, async () => {
        const id = newRequestId();

        const response = await postHttp1({
          port: ingress.httpPort,
          uri,
          body: crypto.randomBytes(NGINX_DEFAULT_BODY_LIMIT_BYTES),
          host: UNNAMED_HOSTS[0],
          id,
        });

        assertAnsweredByApp(response, `${location}, 1 MiB`);
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Live: the plaintext default server with billing on
// ---------------------------------------------------------------------------

describe(
  "live: the plaintext default server with BILLING_ENABLED=true (the hosted product)",
  { skip: liveSkipReason, timeout: 120000 },
  () => {
    /*
     * With billing on, that server's `location /` answers plain HTTP with a
     * 301 to https, and its /otlp and /telemetry must do the same. The one
     * visible change: nginx checks a declared Content-Length BEFORE the
     * redirect runs, so a batch declaring between 1M and 4M used to get a
     * 413 there and now gets the 301 a smaller one always got. (Every
     * request here declares its length; a chunked body is simply discarded
     * behind the redirect, before and after this change.)
     */
    let appStub;
    let grpcStub;
    let ingress;

    before(async () => {
      appStub = await startAppStub();
      grpcStub = await startGrpcStub();
      ingress = await startIngress({
        appPort: appStub.port,
        grpcPort: grpcStub.port,
        environment: { BILLING_ENABLED: "true" },
      });
    });

    after(async () => {
      await ingress?.stop();
      await appStub?.close();
      await grpcStub?.close();
    });

    test("premise: its location / still sends plain HTTP to https", async () => {
      for (const host of UNNAMED_HOSTS) {
        const id = newRequestId();

        const response = await postHttp1({
          port: ingress.httpPort,
          uri: "/",
          body: crypto.randomBytes(1024),
          host,
          id,
        });

        assertRedirectedByNginx(
          response,
          `https://${hostName(host)}/`,
          `Host: ${host}`,
        );
        assert.deepEqual(appStub.requestsFor(id), []);
      }
    });

    for (const { location, uri } of OTLP_HTTP_ENTRY_POINTS) {
      test(`${uri}: an unnamed Host gets the same https redirect, for any batch up to 4M`, async () => {
        for (const host of UNNAMED_HOSTS) {
          for (const bytes of [
            1024,
            2 * MIB,
            3 * MIB,
            OTLP_BATCH_LIMIT_BYTES,
          ]) {
            const id = newRequestId();

            const response = await postHttp1({
              port: ingress.httpPort,
              uri,
              body: crypto.randomBytes(bytes),
              host,
              id,
            });

            assertRedirectedByNginx(
              response,
              `https://${hostName(host)}${uri}`,
              `${location}, Host: ${host}, ${bytes} bytes`,
            );
            assert.deepEqual(appStub.requestsFor(id), []);
          }
        }
      });

      test(`${uri}: a batch declaring more than 4M under an unnamed Host gets nginx's 413, not the redirect`, async () => {
        for (const host of UNNAMED_HOSTS) {
          const id = newRequestId();

          const response = await postHttp1({
            port: ingress.httpPort,
            uri,
            body: crypto.randomBytes(5 * MIB),
            host,
            id,
          });

          assertRefusedByNginx(response, `${location}, Host: ${host}, 5 MiB`);
          assert.deepEqual(appStub.requestsFor(id), []);
        }
      });

      test(`${uri}: the primary ingress still takes the batch itself`, async () => {
        // Its OTLP locations have no billing split; only the default server
        // redirects.
        const id = newRequestId();
        const body = crypto.randomBytes(3 * MIB);

        const response = await postHttp1({
          port: ingress.httpPort,
          uri,
          body,
          id,
        });

        assertAnsweredByApp(response, `${location}, Host: ${INGRESS_HOST}`);
        assert.equal(appStub.requestsFor(id)[0].sha256, sha256(body));
      });
    }
  },
);

// ---------------------------------------------------------------------------
// Live: the TLS default server (a status page's custom domain)
// ---------------------------------------------------------------------------

for (const provisionSsl of [false, true]) {
  describe(
    `live: OTLP/HTTP to a status page's custom domain on 7850, PROVISION_SSL ${provisionSsl ? "on" : "off"}`,
    { skip: tlsSkipReason, timeout: 120000 },
    () => {
      /*
       * The custom domain is not a name the primary answers to, so SNI picks
       * the status-page TLS server (its certificate is the one that answers)
       * and so does the Host. With PROVISION_SSL off the primary does not
       * listen on 7850 at all.
       */
      let appStub;
      let grpcStub;
      let ingress;

      before(async () => {
        appStub = await startAppStub();
        grpcStub = await startGrpcStub();
        ingress = await startIngress({
          appPort: appStub.port,
          grpcPort: grpcStub.port,
          tls: provisionSsl,
          statusPageCertificates: [STATUS_PAGE_DOMAIN],
        });
      });

      after(async () => {
        await ingress?.stop();
        await appStub?.close();
        await grpcStub?.close();
      });

      for (const { location, uri } of OTLP_HTTP_ENTRY_POINTS) {
        test(`${uri}: 2 MiB, 3 MiB and exactly 4 MiB reach the App whole; past 4M is nginx's 413`, async () => {
          for (const [bytes, expectAdmitted] of [
            [2 * MIB, true],
            [3 * MIB, true],
            [OTLP_BATCH_LIMIT_BYTES, true],
            [OTLP_BATCH_LIMIT_BYTES + 1, false],
            [5 * MIB, false],
          ]) {
            const what = `${location}, ${STATUS_PAGE_DOMAIN}, ${bytes} bytes`;
            const id = newRequestId();
            const body = crypto.randomBytes(bytes);

            const response = await postHttp1({
              port: ingress.tlsPort,
              uri,
              body,
              host: STATUS_PAGE_DOMAIN,
              id,
              tls: true,
            });

            assert.equal(response.certificateName, STATUS_PAGE_DOMAIN, what);

            if (expectAdmitted) {
              assertAnsweredByApp(response, what);
              assert.equal(appStub.requestsFor(id).length, 1, what);
              assert.equal(appStub.requestsFor(id)[0].url, uri, what);
              assert.equal(
                appStub.requestsFor(id)[0].sha256,
                sha256(body),
                what,
              );
            } else {
              assertRefusedByNginx(response, what);
              assert.deepEqual(appStub.requestsFor(id), [], what);
            }
          }
        });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Live: HTTP/2 and OTLP/gRPC over TLS
// ---------------------------------------------------------------------------

const METRICS_EXPORT_PATH =
  "/opentelemetry.proto.collector.metrics.v1.MetricsService/Export";

describe(
  "live: OTLP over HTTP/2 through the rendered ingress with TLS provisioned",
  { skip: tlsSkipReason, timeout: 120000 },
  () => {
    let appStub;
    let grpcStub;
    let ingress;
    let origin;

    before(async () => {
      appStub = await startAppStub();
      grpcStub = await startGrpcStub();
      ingress = await startIngress({
        appPort: appStub.port,
        grpcPort: grpcStub.port,
        tls: true,
      });
      origin = `https://127.0.0.1:${ingress.tlsPort}`;
    });

    after(async () => {
      await ingress?.stop();
      await appStub?.close();
      await grpcStub?.close();
    });

    async function exportOverGrpc({ uri, message, withContentLength }) {
      const id = newRequestId();
      const frame = grpcFrame(message);

      const response = await postHttp2({
        origin,
        uri,
        body: frame,
        id,
        grpc: true,
        withContentLength,
      });

      await waitUntil(() => {
        return grpcStub.settled(id);
      }, 5000);

      return { id, frame, response, forwarded: grpcStub.requestsFor(id) };
    }

    function assertExportDelivered({ frame, response, forwarded }, what) {
      assert.equal(response.alpnProtocol, "h2", `${what}: not HTTP/2`);
      assert.equal(response.status, 200, `${what}: ${response.text}`);
      assert.equal(response.headers[UPSTREAM_HEADER], "app-grpc", what);
      assert.equal(response.trailers["grpc-status"], "0", what);

      assert.equal(forwarded.length, 1, `${what}: forwarded exactly once`);
      assert.ok(deliveredWholeMessage(forwarded[0]), what);
      assert.equal(forwarded[0].bytes, frame.length, what);
      assert.equal(forwarded[0].sha256, sha256(frame), what);
      assert.equal(forwarded[0].contentType, "application/grpc", what);
    }

    test("a 2 MiB OTLP/gRPC export reaches the App's gRPC server whole", async () => {
      // No content-length, as gRPC clients send it.
      const exported = await exportOverGrpc({
        uri: METRICS_EXPORT_PATH,
        message: crypto.randomBytes(2 * MIB),
        withContentLength: false,
      });

      assertExportDelivered(exported, "2 MiB export");
      assert.equal(exported.forwarded[0].path, METRICS_EXPORT_PATH);
    });

    test("every OTLP/gRPC service takes an export past the old 1M default", async () => {
      for (const exportPath of appGrpcExportPaths()) {
        const exported = await exportOverGrpc({
          uri: exportPath,
          message: crypto.randomBytes(NGINX_DEFAULT_BODY_LIMIT_BYTES + 1),
          withContentLength: false,
        });

        assertExportDelivered(exported, exportPath);
        assert.equal(exported.forwarded[0].path, exportPath);
      }
    });

    test("an export whose frame is exactly 4 MiB is admitted", async () => {
      // nginx counts the 5-byte gRPC prefix too, so the message is 4 MiB - 5.
      const exported = await exportOverGrpc({
        uri: METRICS_EXPORT_PATH,
        message: crypto.randomBytes(OTLP_BATCH_LIMIT_BYTES - 5),
        withContentLength: false,
      });

      assertExportDelivered(exported, "4 MiB frame");
    });

    test("an export one byte over 4 MiB gets a 413 and the App never sees a whole message", async () => {
      /*
       * grpc_pass streams the request body, so without a content-length the
       * App's gRPC server does see up to the first 4 MiB before nginx gives
       * up on the upstream stream -- but never a complete message, so nothing
       * is ingested. The exporter gets no stream reset: it gets nginx's HTTP
       * 413 page with no grpc-status at all, which gRPC clients report as
       * status UNKNOWN (what the comment on the gRPC location says).
       */
      const logOffset = ingress.errorLogOffset();
      const exported = await exportOverGrpc({
        uri: METRICS_EXPORT_PATH,
        message: crypto.randomBytes(OTLP_BATCH_LIMIT_BYTES - 4),
        withContentLength: false,
      });

      assert.equal(exported.response.error, undefined);
      assert.equal(exported.response.status, 413, exported.response.text);
      assert.equal(exported.response.headers[UPSTREAM_HEADER], undefined);
      assert.match(exported.response.headers["content-type"], /^text\/html/);
      assert.ok(
        exported.response.text.includes("413 Request Entity Too Large"),
      );
      assert.equal(exported.response.headers["grpc-status"], undefined);
      assert.equal(exported.response.trailers["grpc-status"], undefined);

      for (const record of exported.forwarded) {
        assert.equal(deliveredWholeMessage(record), false);
        assert.ok(record.bytes <= OTLP_BATCH_LIMIT_BYTES, `${record.bytes}`);
      }

      assert.ok(
        ingress
          .errorLogSince(logOffset)
          .includes("client intended to send too large chunked body"),
        ingress.errorLogSince(logOffset),
      );
    });

    test("a 5 MiB export that declares its length is refused before the App is contacted", async () => {
      const exported = await exportOverGrpc({
        uri: METRICS_EXPORT_PATH,
        message: crypto.randomBytes(5 * MIB),
        withContentLength: true,
      });

      assert.equal(exported.response.error, undefined);
      assert.equal(exported.response.status, 413, exported.response.text);
      assert.ok(
        exported.response.text.includes("413 Request Entity Too Large"),
      );
      assert.equal(exported.response.headers["grpc-status"], undefined);
      assert.equal(exported.response.trailers["grpc-status"], undefined);
      assert.deepEqual(exported.forwarded, []);
    });

    for (const { location, uri } of OTLP_HTTP_ENTRY_POINTS) {
      test(`${uri} over HTTP/2: 3 MiB reaches the App whole, 5 MiB is refused`, async () => {
        // What an OTLP/HTTP exporter (Go's net/http) negotiates against https.
        for (const withContentLength of [true, false]) {
          const admittedId = newRequestId();
          const admittedBody = crypto.randomBytes(3 * MIB);

          const admitted = await postHttp2({
            origin,
            uri,
            body: admittedBody,
            id: admittedId,
            withContentLength,
          });

          assert.equal(admitted.alpnProtocol, "h2");
          assertAnsweredByApp(admitted, `${location} over h2, 3 MiB`);
          assert.equal(appStub.requestsFor(admittedId).length, 1);
          assert.equal(
            appStub.requestsFor(admittedId)[0].sha256,
            sha256(admittedBody),
          );

          const refusedId = newRequestId();

          const refused = await postHttp2({
            origin,
            uri,
            body: crypto.randomBytes(5 * MIB),
            id: refusedId,
            withContentLength,
          });

          assertRefusedByNginx(refused, `${location} over h2, 5 MiB`);
          assert.deepEqual(appStub.requestsFor(refusedId), []);
        }
      });
    }

    test("a plaintext HTTP/2 connection preface is refused as an HTTP/1.x request", async () => {
      /*
       * What the comment on the gRPC location says happens to an h2c
       * exporter, and why the KNOWN BUG below is still broken: the port's
       * default server does not speak HTTP/2 in cleartext, so the preface
       * ("PRI * HTTP/2.0") is parsed as an HTTP/1.x request line and gets a
       * 400 before any Host could pick the primary.
       */
      const reply = await new Promise((resolve, reject) => {
        const socket = net.connect(ingress.httpPort, "127.0.0.1");
        const chunks = [];

        socket.setTimeout(5000, () => {
          socket.destroy(new Error("no reply to the preface"));
        });
        socket.on("connect", () => {
          socket.write("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
        });
        socket.on("data", (chunk) => {
          chunks.push(chunk);
        });
        socket.on("error", reject);
        socket.on("close", () => {
          resolve(Buffer.concat(chunks).toString("latin1"));
        });
      });

      assert.match(reply, /^HTTP\/1\.1 400 Bad Request\r\n/, reply);
    });

    test("KNOWN BUG: a plaintext (h2c) OTLP/gRPC export reaches the gRPC location", async (t) => {
      // See the static KNOWN BUG above: nginx takes the h2c decision from the
      // port's default server, which is the status-page block.
      const id = newRequestId();
      const frame = grpcFrame(crypto.randomBytes(2 * MIB));

      const response = await postHttp2({
        origin: `http://127.0.0.1:${ingress.httpPort}`,
        uri: METRICS_EXPORT_PATH,
        body: frame,
        id,
        grpc: true,
      });

      await expectKnownBug(t, () => {
        assert.equal(
          response.status,
          200,
          `h2c export failed: ${response.error && response.error.message}`,
        );
        assert.equal(grpcStub.requestsFor(id).length, 1);
      });
    });
  },
);

describe(
  "live control: the TLS ingress with the OTLP/gRPC limit removed",
  { skip: tlsSkipReason, timeout: 120000 },
  () => {
    let appStub;
    let grpcStub;
    let ingress;

    before(async () => {
      appStub = await startAppStub();
      grpcStub = await startGrpcStub();
      ingress = await startIngress({
        appPort: appStub.port,
        grpcPort: grpcStub.port,
        tls: true,
        withoutBodyLimitIn: [
          {
            location: "location ~ /opentelemetry.proto.collector*",
            server: RENDERED_SERVERS.primary,
          },
        ],
      });
    });

    after(async () => {
      await ingress?.stop();
      await appStub?.close();
      await grpcStub?.close();
    });

    test("without it, an export just past 1 MiB is refused (what the exporter saw before)", async () => {
      const id = newRequestId();

      const response = await postHttp2({
        origin: `https://127.0.0.1:${ingress.tlsPort}`,
        uri: METRICS_EXPORT_PATH,
        body: grpcFrame(crypto.randomBytes(NGINX_DEFAULT_BODY_LIMIT_BYTES)),
        id,
        grpc: true,
      });

      await waitUntil(() => {
        return grpcStub.settled(id);
      }, 5000);

      assert.equal(response.alpnProtocol, "h2");
      assert.equal(response.status, 413, response.text);

      for (const record of grpcStub.requestsFor(id)) {
        assert.equal(deliveredWholeMessage(record), false);
      }
    });
  },
);
