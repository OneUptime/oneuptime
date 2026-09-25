/**
 * OTLP ingest body size at the ingress (GH#3978).
 *
 * An OTel pipeline repointed from Datadog at OneUptime keeps sending the
 * batches it always sent, and a full collector batch is well over a
 * megabyte. /telemetry allowed 4M, but /otlp -- the path the docs hand out --
 * and the OTLP/gRPC location were left on nginx's 1M default, so those
 * batches got a bare nginx 413 that no App log ever saw. All three now take
 * 4M.
 *
 * Two halves:
 *
 *   - Static: read default.conf.template and the App source and pin the
 *     limit, its agreement across the three entry points, and its place under
 *     every cap the App applies after it. The App caps are read from source
 *     at test time, so the test breaks when either side drifts.
 *   - Live: render the template the way the container does, run it under a
 *     real nginx in front of stub upstreams that record what actually
 *     arrives, and send real batches at and around the limit over HTTP/1.1,
 *     HTTP/2 and gRPC. Skipped without nginx >= 1.25.1 and envsubst on PATH;
 *     the TLS suite also needs openssl.
 *
 * Tests named "KNOWN BUG" document gaps the fix leaves; see expectKnownBug().
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const http2 = require("node:http2");
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

const INGRESS_PORT = "7849";

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
 * below), and nginx needs a certificate file for that.
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
   * Not only the primary ingress: if an OTLP location is ever added to
   * another server block (see the fallback KNOWN BUG below), it has to take
   * the same batch.
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

  assert.ok(
    checked >= OTLP_LOCATIONS.length,
    `expected at least ${OTLP_LOCATIONS.length} OTLP locations, found ${checked}`,
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
  // The comment is the only place an operator reads why 4M and not more.
  const [otlpBlock] = findBlocks(
    template,
    /^[^\S\n]*location[^\S\n]+(\/otlp)[^\S\n]*\{[^\S\n]*$/,
  );

  assert.ok(otlpBlock, "location /otlp not found");
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
      const renderedPrimary = getServerBlocks(rendered).find((block) => {
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
// Static: gaps the fix leaves
// ---------------------------------------------------------------------------

test("KNOWN BUG: OTLP/HTTP sent under a Host the ingress does not name gets the same 4M", async (t) => {
  /*
   * nginx picks the server block by Host. The primary ingress only answers to
   * "localhost ingress $HOST"; anything else on the plaintext port -- the
   * ingress's IP, an in-cluster Service name, or any name at all when HOST is
   * left at its "localhost" default -- lands in the status-page default
   * server. With billing off (every self-hosted install) that server's
   * `location /` proxies the batch to the same App, which serves OTLP under
   * "/" too, but with no client_max_body_size, so it still gets GH#3978's
   * bare 413 above 1M.
   */
  const fallbackServer = plaintextIngressDefaultServer();

  if (fallbackServer === primaryServerBlock) {
    // The primary became the default: nothing falls through any more.
    assert.fail(
      "This known bug is fixed: turn this test into a plain one that asserts the fixed behaviour.",
    );
  }

  const location = resolveLocation(
    getLocationBlocks(fallbackServer.body),
    "/otlp/v1/metrics",
  );

  assert.ok(location, "/otlp/v1/metrics matches nothing in the default server");
  assert.ok(
    getDirectives(location.body, "proxy_pass").includes(
      "proxy_pass ${BACKEND_APP_TARGET};",
    ),
    "premise: the default server proxies OTLP to the App when billing is off",
  );

  await expectKnownBug(t, () => {
    const limit = effectiveBodyLimit(fallbackServer, location);

    assert.ok(
      limit >= OTLP_BATCH_LIMIT_BYTES,
      `the default server's "location ${location.spec}" gives OTLP ${limit} bytes (nginx's default is ${NGINX_DEFAULT_BODY_LIMIT_BYTES})`,
    );
  });
});

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

/**
 * Delete one location's client_max_body_size from a rendered config: the
 * config as it was before GH#3978's fix, for the control suite.
 */
function withoutBodyLimitIn(rendered, locationHeader) {
  const start = rendered.indexOf(`${locationHeader} {`);

  assert.notEqual(start, -1, `${locationHeader} not in the rendered config`);
  assert.equal(
    rendered.indexOf(`${locationHeader} {`, start + 1),
    -1,
    `${locationHeader} appears twice in the rendered config`,
  );

  const end = rendered.indexOf("\n    }", start);
  const block = rendered.slice(start, end);
  const edited = block.replace(/^[ \t]*client_max_body_size 4M;\n/m, "");

  assert.notEqual(edited, block, `${locationHeader} had no 4M limit to remove`);
  assert.ok(/(proxy|grpc)_pass /.test(edited), "sliced the wrong block");

  return rendered.slice(0, start) + edited + rendered.slice(end);
}

function makeTlsCertificate(directory) {
  const certificatePath = path.join(directory, "ingress.crt");
  const keyPath = path.join(directory, "ingress.key");

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
      `/CN=${INGRESS_HOST}`,
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

  return { certificatePath, keyPath };
}

/**
 * Render the template for this host the way envsubst-on-templates.sh would
 * for a container, start a real nginx on it, and wait until it listens.
 *
 * What differs from the shipped config is only what has to: the App's
 * address (our stubs on loopback), the listen ports (free ones instead of
 * 7849/7850/4317), and nginx.conf's absolute paths (moved into a temp
 * prefix, exactly as NginxTemplateRender.test.js does for `nginx -t`).
 */
async function startIngress({
  appPort,
  grpcPort,
  upstreamMode = UPSTREAM_MODES[0],
  tls = false,
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

  for (const locationHeader of strippedLocations) {
    rendered = withoutBodyLimitIn(rendered, locationHeader);
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
 * as it arrives rather than refuse it from the header.
 */
function postHttp1({ port, uri, body, host = INGRESS_HOST, chunked, id }) {
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

    const request = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: uri,
      headers,
      agent: false,
    });
    let answered = false;

    request.on("response", (response) => {
      const chunks = [];

      response.on("data", (chunk) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        answered = true;
        resolve({
          status: response.statusCode,
          headers: response.headers,
          text: Buffer.concat(chunks).toString("utf8"),
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
        ? { servername: INGRESS_HOST, rejectUnauthorized: false }
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

      // Server selection happens before the upstream mode matters, so one
      // mode is enough for this one.
      if (upstreamMode !== UPSTREAM_MODES[0]) {
        return;
      }

      test("KNOWN BUG: a batch under a Host the ingress does not name takes the same 4M", async (t) => {
        // See the static KNOWN BUG above: an IP lands in the status-page
        // default server, which proxies to the App on nginx's 1M default.
        const id = newRequestId();
        const body = crypto.randomBytes(2 * MIB);
        const logOffset = ingress.errorLogOffset();

        const response = await postHttp1({
          port: ingress.httpPort,
          uri: "/otlp/v1/metrics",
          body,
          host: "10.0.0.5",
          id,
        });

        await expectKnownBug(t, () => {
          assertAnsweredByApp(response, "Host: 10.0.0.5, 2 MiB");
          assert.equal(appStub.requestsFor(id).length, 1);
        });

        t.diagnostic(ingress.errorLogSince(logOffset).trim());
      });
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
        withoutBodyLimitIn: ["location /otlp"],
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
  },
);

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
       * App's gRPC server does see the first 4 MiB before nginx resets the
       * stream -- but never a complete message, so nothing is ingested.
       */
      const logOffset = ingress.errorLogOffset();
      const exported = await exportOverGrpc({
        uri: METRICS_EXPORT_PATH,
        message: crypto.randomBytes(OTLP_BATCH_LIMIT_BYTES - 4),
        withContentLength: false,
      });

      assert.equal(exported.response.status, 413, exported.response.text);
      assert.equal(exported.response.headers[UPSTREAM_HEADER], undefined);
      assert.notEqual(exported.response.trailers["grpc-status"], "0");

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

      assert.equal(exported.response.status, 413, exported.response.text);
      assert.ok(
        exported.response.text.includes("413 Request Entity Too Large"),
      );
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
        withoutBodyLimitIn: ["location ~ /opentelemetry.proto.collector*"],
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
