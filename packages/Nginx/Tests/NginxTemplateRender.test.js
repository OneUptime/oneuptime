/**
 * Renders default.conf.template the way the container actually renders it and
 * asserts on the result.
 *
 * run.sh calls envsubst-on-templates.sh, which strips a couple of optional
 * blocks with sed and then runs envsubst with a shell-format list built from
 * `env`. The consequence that matters: a variable that is NOT in the container
 * environment is left in the output as the literal text "${NAME}", which nginx
 * then reads as a reference to an nginx variable of that name. The ingest
 * access-log switch depends on exactly that behaviour, so these tests pin it
 * down with the real envsubst instead of trusting a comment.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawn, spawnSync } = require("node:child_process");

const {
  NGINX_DIRECTORY,
  readTemplate,
  readNginxConf,
} = require("./NginxConfigParser");

const template = readTemplate();
const nginxConf = readNginxConf();

function isOnPath(binary) {
  const probe = spawnSync(binary, ["--version"], { encoding: "utf8" });

  if (probe.error) {
    return false;
  }

  // nginx prints its version to stderr and exits 0; envsubst exits 0 too.
  return probe.status === 0;
}

const hasEnvsubst = isOnPath("envsubst");

/*
 * The shipped image's nginx (Nginx/Dockerfile.tpl). `nginx -t` is only a
 * meaningful check against a binary at least this new: the config uses
 * `http2 on;`, a directive added in 1.25.1 that older builds reject outright.
 * Ubuntu runners carry 1.24, so validating there would fail on a config that
 * is correct for the version OneUptime actually runs.
 */
const MINIMUM_NGINX_VERSION = [1, 25, 1];

/** [major, minor, patch] of the nginx on PATH, or null if there is none. */
function localNginxVersion() {
  const probe = spawnSync("nginx", ["-v"], { encoding: "utf8" });

  if (probe.error) {
    return null;
  }

  // nginx writes "nginx version: nginx/1.24.0" to stderr.
  const match = /nginx\/(\d+)\.(\d+)\.(\d+)/.exec(
    `${probe.stderr || ""}${probe.stdout || ""}`,
  );

  return match ? match.slice(1, 4).map(Number) : null;
}

const nginxVersion = localNginxVersion();

/** Reason to skip the `nginx -t` check, or false to run it. */
const nginxCheckSkipReason = (() => {
  if (!nginxVersion) {
    return "nginx binary not on PATH";
  }

  // Compare lexicographically: the FIRST component that differs decides, so a
  // later component can never overturn it (2.0.0 is newer than 1.25.1).
  const decidingIndex = MINIMUM_NGINX_VERSION.findIndex((floor, index) => {
    return nginxVersion[index] !== floor;
  });

  const tooOld =
    decidingIndex !== -1 &&
    nginxVersion[decidingIndex] < MINIMUM_NGINX_VERSION[decidingIndex];

  return tooOld
    ? `nginx ${nginxVersion.join(".")} predates ${MINIMUM_NGINX_VERSION.join(".")}, which the shipped config requires`
    : false;
})();

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
 * A full container environment minus the variables under test, so a render is
 * representative of a real deployment.
 */
function baseEnvironment(overrides = {}) {
  const environment = {};

  for (const name of templateVariables(template)) {
    environment[name] = `dummy-${name.toLowerCase()}`;
  }

  Object.assign(environment, {
    APP_PORT: "3002",
    HOME_PORT: "1444",
    HOST: "oneuptime.example.com",
    BILLING_ENABLED: "false",
    NGINX_LISTEN_ADDRESS: "",
    NGINX_LISTEN_OPTIONS: "",
    BACKEND_APP_TARGET: "$backend_app",
    BACKEND_APP_GRPC_TARGET: "$backend_app_grpc",
    NGINX_RESOLVER: "127.0.0.11",
    PROVISION_SSL_LISTEN_DIRECTIVE: "",
    PROVISION_SSL_CERTIFICATE_DIRECTIVE: "",
    PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE: "",
    SERVER_APP_HOSTNAME: "app",
    SERVER_HOME_HOSTNAME: "home",
  });

  delete environment.SERVER_NAMES_HASH_BUCKET_SIZE;
  delete environment.SERVER_NAMES_HASH_MAX_SIZE;
  delete environment.NGINX_UPSTREAM_KEEPALIVE_CONNECTIONS;
  delete environment.NGINX_INGEST_ACCESS_LOG;

  return { ...environment, ...overrides };
}

test("the only template variable the container environment does not supply is the ingest switch", () => {
  // Everything else is either exported by envsubst-on-templates.sh or set on
  // the ingress service in docker-compose / the Helm chart. A new placeholder
  // that nothing supplies renders as literal "${NAME}" and takes nginx down at
  // startup, so a new one has to be a deliberate, declared-in-nginx.conf case.
  const suppliedByEnvsubstScript = new Set();
  const script = fs.readFileSync(
    path.join(NGINX_DIRECTORY, "envsubst-on-templates.sh"),
    "utf8",
  );
  const exportPattern = /export\s+([A-Z_][A-Z0-9_]*)=/g;
  let match;

  while ((match = exportPattern.exec(script)) !== null) {
    suppliedByEnvsubstScript.add(match[1]);
  }

  const suppliedByContainerEnvironment = new Set([
    // Detected from /etc/resolv.conf and exported by run.sh, not by
    // envsubst-on-templates.sh.
    "NGINX_RESOLVER",
    "APP_PORT",
    "BILLING_ENABLED",
    "HOME_PORT",
    "HOST",
    "NGINX_LISTEN_ADDRESS",
    "NGINX_LISTEN_OPTIONS",
    "SERVER_APP_HOSTNAME",
    "SERVER_HOME_HOSTNAME",
    // Removed from the template by sed when unset, so never left dangling.
    "SERVER_NAMES_HASH_BUCKET_SIZE",
    "SERVER_NAMES_HASH_MAX_SIZE",
  ]);

  const unsupplied = [...templateVariables(template)].filter((name) => {
    return (
      !suppliedByEnvsubstScript.has(name) &&
      !suppliedByContainerEnvironment.has(name)
    );
  });

  assert.deepEqual(unsupplied, ["NGINX_INGEST_ACCESS_LOG"]);

  // ...and that one is safe precisely because nginx.conf declares it.
  assert.ok(/\$NGINX_INGEST_ACCESS_LOG\s*\{/.test(nginxConf));
});

test(
  "an unset ingest switch renders to the nginx variable nginx.conf declares",
  { skip: hasEnvsubst ? false : "envsubst not on PATH" },
  () => {
    const rendered = render(baseEnvironment());

    assert.ok(
      rendered.includes(
        'map "${NGINX_INGEST_ACCESS_LOG}" $ingest_access_log {',
      ),
      "the unset case must fall through to the nginx.conf declaration",
    );

    // Nothing else may be left dangling: any other surviving ${...} would be an
    // unknown nginx variable and would refuse to start.
    const leftovers = [...templateVariables(rendered)];

    assert.deepEqual(leftovers, ["NGINX_INGEST_ACCESS_LOG"]);
  },
);

test(
  "an explicit off switch renders to a literal the map turns into 0",
  { skip: hasEnvsubst ? false : "envsubst not on PATH" },
  () => {
    for (const offValue of ["off", "false", "0", "no"]) {
      const rendered = render(
        baseEnvironment({ NGINX_INGEST_ACCESS_LOG: offValue }),
      );

      assert.ok(
        rendered.includes(`map "${offValue}" $ingest_access_log {`),
        `expected map "${offValue}"`,
      );
      assert.ok(
        new RegExp(`^\\s*"${offValue}"\\s+0\\s*;`, "m").test(rendered),
        `${offValue} must still be mapped to 0 after rendering`,
      );
    }
  },
);

test(
  "an empty or affirmative ingest switch still renders a logging config",
  { skip: hasEnvsubst ? false : "envsubst not on PATH" },
  () => {
    for (const onValue of ["", "on", "true", "1", "yes", "TRUE"]) {
      const rendered = render(
        baseEnvironment({ NGINX_INGEST_ACCESS_LOG: onValue }),
      );

      assert.ok(
        rendered.includes(`map "${onValue}" $ingest_access_log {`),
        `expected map "${onValue}"`,
      );
      assert.ok(
        !new RegExp(`^\\s*"${onValue}"\\s+0\\s*;`, "m").test(rendered),
        `${onValue} must not be mapped to 0`,
      );
    }
  },
);

test(
  "rendering leaves nginx's own runtime variables alone",
  { skip: hasEnvsubst ? false : "envsubst not on PATH" },
  () => {
    const rendered = render(baseEnvironment());

    for (const nginxVariable of [
      "$ingest_access_log",
      "$connection_upgrade",
      "$backend_app",
      "$host",
      "$remote_addr",
      "$proxy_add_x_forwarded_for",
    ]) {
      assert.ok(rendered.includes(nginxVariable), `${nginxVariable} was eaten`);
    }
  },
);

test(
  "the tuned directives survive rendering intact",
  { skip: hasEnvsubst ? false : "envsubst not on PATH" },
  () => {
    const rendered = render(baseEnvironment());

    assert.equal((rendered.match(/gzip_comp_level 5;/g) || []).length, 3);
    assert.equal((rendered.match(/gzip_vary on;/g) || []).length, 3);
    assert.equal((rendered.match(/gzip_proxied\s+any;/g) || []).length, 3);

    // One per operator-controllable ingest location: /telemetry, /otlp,
    // /kubernetes-cost, /security-events, /session-replay, /pyroscope and
    // /source-maps in the primary ingress, plus /otlp and /telemetry in each
    // of the two status-page servers (GH#3978).
    assert.equal(
      (
        rendered.match(
          /access_log \/var\/log\/nginx\/access\.log main buffer=64k flush=10s if=\$ingest_access_log;/g,
        ) || []
      ).length,
      11,
    );

    // The {8,} repetition quantifier in the immutable location's regex must not
    // be mangled by envsubst or by the sed passes, and it must still be quoted:
    // nginx's tokeniser would otherwise read that brace as the start of the
    // location block.
    assert.ok(
      rendered.includes(
        'location ~ "^/(accounts|admin|dashboard|public-dashboard|status-page)/dist/.+-[A-Z0-9]{8,}\\.(js|css)$" {',
      ),
      "the immutable asset location did not survive rendering",
    );
    assert.ok(
      rendered.includes(
        'add_header Cache-Control "public, max-age=31536000, immutable";',
      ),
    );

    // The three directives that make that header and that upstream connection
    // actually behave: hide the upstream's own Cache-Control (add_header only
    // appends), and keep the upstream connection pooled instead of opening a new
    // one per chunk. Quotes and empty values are exactly the sort of thing a sed
    // or envsubst pass mangles, so assert on the rendered output, not the source.
    const immutableBlock = rendered.slice(
      rendered.indexOf('location ~ "^/(accounts|admin|dashboard'),
    );

    for (const directive of [
      "proxy_http_version 1.1;",
      'proxy_set_header Connection "";',
      "proxy_hide_header Cache-Control;",
    ]) {
      assert.ok(
        immutableBlock
          .slice(0, immutableBlock.indexOf("\n    }"))
          .includes(directive),
        `the immutable asset location lost "${directive}" in rendering`,
      );
    }
  },
);

test(
  "the rendered config passes nginx -t",
  { skip: nginxCheckSkipReason },
  () => {
    const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-nginx-"));

    fs.mkdirSync(path.join(prefix, "conf.d"), { recursive: true });
    fs.mkdirSync(path.join(prefix, "logs"), { recursive: true });

    // Strip the bits that depend on the container image rather than on this
    // config: the NJS module (nothing here uses js_*), the distro mime.types,
    // the nginx user, and the absolute log/pid paths.
    const mainConf = nginxConf
      .replace(/^load_module .*\n/m, "")
      .replace(/^user\s+.*\n/m, "")
      .replace(/^\s*include\s+\/etc\/nginx\/mime\.types;\n/m, "")
      .replace(/\/var\/log\/nginx\//g, `${prefix}/logs/`)
      .replace(/\/var\/run\/nginx\.pid/g, `${prefix}/logs/nginx.pid`)
      .replace(
        "include /etc/nginx/conf.d/default.conf;",
        `include ${prefix}/conf.d/default.conf;`,
      );

    fs.writeFileSync(path.join(prefix, "nginx.conf"), mainConf);
    fs.writeFileSync(
      path.join(prefix, "conf.d", "default.conf"),
      render(baseEnvironment()),
    );

    const result = spawnSync(
      "nginx",
      ["-t", "-p", prefix, "-c", path.join(prefix, "nginx.conf")],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
  },
);

test(
  "the calendar feed location survives rendering in every server block",
  { skip: hasEnvsubst ? false : "envsubst not on PATH" },
  () => {
    /*
     * The location's whole purpose is keeping a URL that carries a bearer
     * token out of nginx's logs: `access_log off` for the per-request line,
     * `error_log /dev/null crit` for the upstream-failure lines (which quote
     * the same request line, and which every polling client triggers during a
     * deploy), and `proxy_max_temp_file_size 0` for the [warn] nginx emits
     * when a large feed is spooled to a temp file. The sed passes and envsubst
     * run over the source before nginx sees it, so assert on the rendered
     * output: three copies of the location (one per server block), three of
     * each directive, and none of them anywhere else.
     */
    const rendered = render(baseEnvironment());

    const locationHeader =
      "location ~ ^/api/on-call-calendar/(user|schedule|project)/ {";

    assert.equal(rendered.split(locationHeader).length - 1, 3);
    assert.equal((rendered.match(/^\s*access_log off;/gm) || []).length, 3);
    assert.equal(
      (rendered.match(/^\s*error_log \/dev\/null crit;/gm) || []).length,
      3,
    );
    assert.equal((rendered.match(/^\s*error_log /gm) || []).length, 3);
    assert.equal(
      (rendered.match(/^\s*proxy_max_temp_file_size 0;/gm) || []).length,
      3,
    );
    assert.equal(
      (rendered.match(/^\s*proxy_max_temp_file_size /gm) || []).length,
      3,
    );

    // Each copy proxies to the app and keeps the pooled upstream connection.
    let searchFrom = 0;

    for (let copy = 0; copy < 3; copy++) {
      const start = rendered.indexOf(locationHeader, searchFrom);

      assert.ok(start >= 0, `copy ${copy + 1} of the location is missing`);

      const end = rendered.indexOf("\n    }", start);
      const block = rendered.slice(start, end);

      for (const directive of [
        "access_log off;",
        "error_log /dev/null crit;",
        "proxy_max_temp_file_size 0;",
        "proxy_pass $backend_app;",
        "proxy_http_version 1.1;",
        "proxy_set_header Connection $connection_upgrade;",
        "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
        "resolver 127.0.0.11 valid=30s;",
      ]) {
        assert.ok(
          block.includes(directive),
          `copy ${copy + 1} of the calendar feed location lost "${directive}" in rendering`,
        );
      }

      searchFrom = end;
    }
  },
);

test(
  "the /api proxy timeouts survive rendering",
  { skip: hasEnvsubst ? false : "envsubst not on PATH" },
  () => {
    /*
     * envsubst-on-templates.sh runs sed passes over the template before
     * envsubst, and one of them strips a whole "# BEGIN upstream-keepalive"
     * block. A directive that is correct in the source but eaten in rendering
     * leaves /api back on nginx's 60s default, which is GH#3434 all over
     * again — and the source-level assertions in NginxConfig.test.js cannot
     * see it. Assert on what the container actually loads.
     */
    const rendered = render(baseEnvironment());

    // /api, /mqtt and /mcp — the three locations allowed to hold a connection
    // open for minutes. See PROXY_TIMEOUT_LOCATIONS in NginxConfig.test.js.
    assert.equal(
      (rendered.match(/proxy_read_timeout\s+\S+;/g) || []).length,
      3,
    );
    assert.equal(
      (rendered.match(/proxy_send_timeout\s+\S+;/g) || []).length,
      3,
    );

    const apiBlockStart = rendered.indexOf("location /api {");

    assert.ok(
      apiBlockStart >= 0,
      "the /api location did not survive rendering",
    );

    const apiBlock = rendered.slice(
      apiBlockStart,
      rendered.indexOf("\n    }", apiBlockStart),
    );

    assert.ok(
      apiBlock.includes("proxy_read_timeout 300s;"),
      "location /api lost its proxy_read_timeout in rendering: a synchronous 'Generate with AI' call would 504 at 60s (GH#3434)",
    );
    assert.ok(
      apiBlock.includes("proxy_send_timeout 300s;"),
      "location /api lost its proxy_send_timeout in rendering",
    );
  },
);

// ---------------------------------------------------------------------------
// OAuth discovery documents for the MCP server
// ---------------------------------------------------------------------------

const OAUTH_DISCOVERY_LOCATION_HEADER =
  "location ~ ^/\\.well-known/oauth-(authorization-server|protected-resource)(/|$) {";

const OAUTH_DISCOVERY_PATHS = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server/mcp",
];

test(
  "the OAuth discovery location survives rendering",
  { skip: hasEnvsubst ? false : "envsubst not on PATH" },
  () => {
    /*
     * The location's regex ends in `(/|$)`. envsubst is only told about names
     * from the environment, so a bare `$` must come through untouched - but
     * that is exactly the kind of thing worth reading off the rendered output
     * rather than assuming: a mangled regex is a location that matches
     * nothing, and the documents silently go back to the marketing site.
     */
    const rendered = render(baseEnvironment());

    assert.equal(
      rendered.split(OAUTH_DISCOVERY_LOCATION_HEADER).length - 1,
      1,
      "the OAuth discovery location must render exactly once, unmangled",
    );

    const start = rendered.indexOf(OAUTH_DISCOVERY_LOCATION_HEADER);
    const block = rendered.slice(start, rendered.indexOf("\n    }", start));

    for (const directive of [
      "resolver 127.0.0.11 valid=30s;",
      "set $backend_app http://app:3002;",
      "proxy_set_header Host $host;",
      "proxy_set_header X-Real-IP $remote_addr;",
      "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
      "proxy_set_header X-Forwarded-Proto $scheme;",
      "proxy_http_version 1.1;",
      "proxy_set_header Connection $connection_upgrade;",
      "proxy_pass $backend_app;",
    ]) {
      assert.ok(
        block.includes(directive),
        `the OAuth discovery location lost "${directive}" in rendering`,
      );
    }

    // Home is never an option for these paths, with billing on or off.
    for (const billingEnabled of ["true", "false"]) {
      const withBilling = render(
        baseEnvironment({ BILLING_ENABLED: billingEnabled }),
      );
      const blockStart = withBilling.indexOf(OAUTH_DISCOVERY_LOCATION_HEADER);
      const renderedBlock = withBilling.slice(
        blockStart,
        withBilling.indexOf("\n    }", blockStart),
      );

      assert.ok(
        !renderedBlock.includes("backend_home"),
        `BILLING_ENABLED=${billingEnabled}: the OAuth discovery location must not mention Home`,
      );
      assert.ok(renderedBlock.includes("proxy_pass $backend_app;"));
    }
  },
);

test(
  "the OAuth discovery location follows the app upstream when upstream keepalive is on",
  { skip: hasEnvsubst ? false : "envsubst not on PATH" },
  () => {
    /*
     * With NGINX_UPSTREAM_KEEPALIVE=true the app is reached through the
     * pooled `upstream backend_app` block and BACKEND_APP_TARGET names it.
     * The location must proxy to whatever that is, like /mcp does - a
     * hard-coded $backend_app here would quietly bypass the pool.
     */
    const rendered = render(
      baseEnvironment({
        NGINX_UPSTREAM_KEEPALIVE: "true",
        NGINX_UPSTREAM_KEEPALIVE_CONNECTIONS: "64",
        BACKEND_APP_TARGET: "http://backend_app",
      }),
    );

    const start = rendered.indexOf(OAUTH_DISCOVERY_LOCATION_HEADER);

    assert.ok(start >= 0, "the OAuth discovery location did not render");

    const block = rendered.slice(start, rendered.indexOf("\n    }", start));

    assert.ok(block.includes("proxy_pass http://backend_app;"));

    const mcpStart = rendered.indexOf("location /mcp {");
    const mcpBlock = rendered.slice(
      mcpStart,
      rendered.indexOf("\n    }", mcpStart),
    );

    assert.ok(mcpBlock.includes("proxy_pass http://backend_app;"));
  },
);

/*
 * The rest of this file asks a REAL nginx where it sends a request: the
 * rendered config is loaded into the nginx on PATH, in front of two tiny
 * upstreams standing in for the app and for Home, and requests are sent
 * through it. That is the only way to be sure of location precedence - a
 * regex location against the prefix locations around it - rather than
 * reasoning about nginx's rules from the source.
 *
 * It needs the same nginx `nginx -t` above needs, so it is skipped wherever
 * that is (CI's runners carry an older nginx). To run it:
 *
 *   docker run --rm -v <repo>:/repo -w /repo/packages/Nginx \
 *     nginx:1.30.5-alpine3.24 sh -c \
 *     'rm -f /var/log/nginx/*; apk add -q nodejs openssl; node --test Tests/'
 */

// Every nginx this file starts, so none can outlive a crashed run.
const startedNginxProcesses = new Set();

process.on("exit", () => {
  for (const child of startedNginxProcesses) {
    child.kill("SIGKILL");
  }
});

/** A stand-in upstream that answers every request with who it is and what it was asked. */
function startUpstream(name) {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        upstream: name,
        url: request.url,
        host: request.headers.host,
        forwardedFor: request.headers["x-forwarded-for"] || null,
      }),
    );
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        close: () => {
          return new Promise((done) => {
            server.closeAllConnections();
            server.close(() => {
              done();
            });
          });
        },
      });
    });
  });
}

/** A port nothing is listening on right now, for nginx to take. */
function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();

      probe.close(() => {
        resolve(port);
      });
    });
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** GET a path through the ingress under a given Host; resolves with the upstream's own account of it. */
function getThroughIngress(port, requestPath, host) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: requestPath,
        method: "GET",
        headers: { Host: host },
        agent: false,
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          let answer = null;

          try {
            answer = JSON.parse(body);
          } catch {
            // Not one of the stand-in upstreams: leave it null.
          }

          resolve({ status: response.statusCode, answer, body });
        });
      },
    );

    request.setTimeout(10000, () => {
      request.destroy(new Error(`GET ${requestPath} timed out`));
    });
    request.once("error", reject);
    request.end();
  });
}

/**
 * Run the rendered config in a real nginx, with the app and Home replaced by
 * stand-ins, and hand `callback` the port to send requests to. Everything it
 * starts is stopped again, whatever the callback does.
 */
async function withRunningIngress(billingEnabled, callback) {
  const app = await startUpstream("app");
  const home = await startUpstream("home");
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-nginx-run-"));

  let nginx = null;
  let nginxOutput = "";

  try {
    // The workers may run as another user than the one that made the directory.
    fs.chmodSync(prefix, 0o755);
    fs.mkdirSync(path.join(prefix, "conf.d"), { recursive: true });
    fs.mkdirSync(path.join(prefix, "logs"), { recursive: true });

    const httpPort = await reservePort();
    const tlsPort = await reservePort();

    // The same image-dependent lines the `nginx -t` test strips, plus temp
    // paths and a single worker so the run stays inside its own directory.
    const mainConf = nginxConf
      .replace(/^load_module .*\n/m, "")
      .replace(/^user\s+.*\n/m, "")
      .replace(/^worker_processes\s+.*\n/m, "worker_processes 1;\n")
      .replace(/^\s*include\s+\/etc\/nginx\/mime\.types;\n/m, "")
      .replace(/\/var\/log\/nginx\//g, `${prefix}/logs/`)
      .replace(/\/var\/run\/nginx\.pid/g, `${prefix}/logs/nginx.pid`)
      .replace(
        "include /etc/nginx/conf.d/default.conf;",
        `include ${prefix}/conf.d/default.conf;`,
      )
      .replace(/^http\s*\{/m, (match) => {
        return [
          match,
          `    client_body_temp_path ${prefix}/client_temp;`,
          `    proxy_temp_path ${prefix}/proxy_temp;`,
          `    fastcgi_temp_path ${prefix}/fastcgi_temp;`,
          `    uwsgi_temp_path ${prefix}/uwsgi_temp;`,
          `    scgi_temp_path ${prefix}/scgi_temp;`,
        ].join("\n");
      });

    /*
     * Loopback only, and on ports that are free here: the listeners are
     * hard-coded to 7849/7850 in the template, so they are moved once the
     * config is rendered (as OtlpIngestBodySize.test.js does for its own live
     * runs).
     */
    const serverConf = render(
      baseEnvironment({
        BILLING_ENABLED: billingEnabled ? "true" : "false",
        NGINX_LISTEN_ADDRESS: "127.0.0.1:",
        NGINX_RESOLVER: "127.0.0.1",
        SERVER_APP_HOSTNAME: "127.0.0.1",
        APP_PORT: String(app.port),
        SERVER_HOME_HOSTNAME: "127.0.0.1",
        HOME_PORT: String(home.port),
      }),
    )
      .split("127.0.0.1:7849")
      .join(`127.0.0.1:${httpPort}`)
      .split("127.0.0.1:7850")
      .join(`127.0.0.1:${tlsPort}`);

    assert.ok(
      serverConf.includes(`listen 127.0.0.1:${httpPort}`),
      "the test could not move the ingress listener to a free port",
    );
    // Directive lines only: the template's comments mention the ports too.
    assert.ok(
      !/^[^\S\n]*listen[^\S\n]+[^;\n#]*\b78(49|50)\b/m.test(serverConf),
      "a listener was left on the ingress's real port",
    );

    const mainConfPath = path.join(prefix, "nginx.conf");

    fs.writeFileSync(mainConfPath, mainConf);
    fs.writeFileSync(path.join(prefix, "conf.d", "default.conf"), serverConf);

    nginx = spawn(
      "nginx",
      [
        "-p",
        prefix,
        "-e",
        path.join(prefix, "logs", "startup-error.log"),
        "-c",
        mainConfPath,
        "-g",
        "daemon off;",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    startedNginxProcesses.add(nginx);

    nginx.stdout.on("data", (chunk) => {
      nginxOutput += chunk;
    });
    nginx.stderr.on("data", (chunk) => {
      nginxOutput += chunk;
    });

    const deadline = Date.now() + 15000;
    let listening = false;

    while (Date.now() < deadline) {
      if (nginx.exitCode !== null) {
        break;
      }

      if (await canConnect(httpPort)) {
        listening = true;
        break;
      }

      await wait(50);
    }

    assert.ok(
      listening,
      `nginx did not start listening on ${httpPort} (exit code ${nginx.exitCode}): ${nginxOutput}`,
    );

    await callback({ port: httpPort });
  } finally {
    if (nginx && nginx.exitCode === null) {
      const exited = new Promise((resolve) => {
        nginx.once("exit", resolve);
      });

      nginx.kill("SIGTERM");

      const stopped = await Promise.race([
        exited.then(() => {
          return true;
        }),
        wait(5000).then(() => {
          return false;
        }),
      ]);

      if (!stopped) {
        nginx.kill("SIGKILL");
        await exited;
      }
    }

    if (nginx) {
      startedNginxProcesses.delete(nginx);
    }

    await app.close();
    await home.close();
    fs.rmSync(prefix, { recursive: true, force: true });
  }
}

const runningNginxSkipReason =
  nginxCheckSkipReason || (hasEnvsubst ? false : "envsubst not on PATH");

for (const billingEnabled of [true, false]) {
  test(
    `a real nginx sends the OAuth discovery documents to the app (BILLING_ENABLED=${billingEnabled})`,
    { skip: runningNginxSkipReason, timeout: 60000 },
    async () => {
      await withRunningIngress(billingEnabled, async ({ port }) => {
        // The primary ingress answers for "localhost" and for HOST.
        for (const host of ["localhost", "oneuptime.example.com"]) {
          for (const uri of [
            ...OAUTH_DISCOVERY_PATHS,
            // A query string does not change which location serves it, and
            // reaches the app with the path.
            "/.well-known/oauth-protected-resource/mcp?probe=1",
          ]) {
            const response = await getThroughIngress(port, uri, host);

            assert.equal(response.status, 200, `${host}${uri}`);
            assert.ok(
              response.answer,
              `${host}${uri}: not proxied: ${response.body}`,
            );
            assert.equal(
              response.answer.upstream,
              "app",
              `${host}${uri} must reach the app, not ${response.answer.upstream}`,
            );
            // The app registers these routes at the paths themselves.
            assert.equal(response.answer.url, uri);
            // Host is the one the browser asked for, as on /mcp.
            assert.equal(response.answer.host, host);
            assert.ok(
              response.answer.forwardedFor,
              `${host}${uri} lost X-Forwarded-For`,
            );
          }
        }

        /*
         * Everything else under /.well-known goes where it went before. With
         * billing on the catch-all is Home, which is what makes the split
         * visible; with billing off the catch-all is the app as well.
         */
        const catchAll = billingEnabled ? "home" : "app";

        for (const uri of [
          "/.well-known/mcp.json",
          "/.well-known/openid-configuration",
          "/.well-known/apple-app-site-association",
          "/.well-known/oauth-protected-resourceX",
          "/.well-known/oauth-authorization-servers",
        ]) {
          const response = await getThroughIngress(port, uri, "localhost");

          assert.equal(
            response.answer?.upstream,
            catchAll,
            `${uri} must keep going to the catch-all (${catchAll})`,
          );
          assert.equal(response.answer.url, uri);
        }

        const assetLinks = await getThroughIngress(
          port,
          "/.well-known/assetlinks.json",
          "localhost",
        );

        assert.equal(assetLinks.answer?.upstream, "home");

        const acme = await getThroughIngress(
          port,
          "/.well-known/acme-challenge/some-token",
          "localhost",
        );

        assert.equal(acme.answer?.upstream, "app");
        assert.equal(
          acme.answer.url,
          "/api/acme-challenge/.well-known/some-token",
        );

        // The copies under /mcp were always the app's, through location /mcp.
        for (const uri of [
          "/mcp/.well-known/oauth-protected-resource",
          "/mcp/.well-known/oauth-authorization-server",
          "/mcp/oauth/authorize?client_id=x",
        ]) {
          const response = await getThroughIngress(port, uri, "localhost");

          assert.equal(response.answer?.upstream, "app", uri);
          assert.equal(response.answer.url, uri);
        }
      });
    },
  );
}

test(
  "a real nginx does not serve the MCP discovery documents on a status page's domain",
  { skip: runningNginxSkipReason, timeout: 60000 },
  async () => {
    /*
     * A Host the primary ingress does not name lands in the status-page
     * server, which has no /mcp and so nothing to discover. There the path
     * is the status page's own well-known namespace, as it always was: the
     * app is handed the rewritten status-page path, not the document's.
     */
    await withRunningIngress(false, async ({ port }) => {
      for (const uri of OAUTH_DISCOVERY_PATHS) {
        const response = await getThroughIngress(
          port,
          uri,
          "status.customer.example",
        );

        assert.equal(response.answer?.upstream, "app", uri);
        assert.equal(response.answer.url, `/api/status-page${uri}`);
      }
    });
  },
);
