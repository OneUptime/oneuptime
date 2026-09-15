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
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const {
  NGINX_DIRECTORY,
  readTemplate,
  readNginxConf,
  getServerBlocks,
  getLocationBlocks,
  getDirectives,
  findBlocks,
} = require("./NginxConfigParser");

const template = readTemplate();
const nginxConf = readNginxConf();
const envsubstScriptPath = path.join(
  NGINX_DIRECTORY,
  "envsubst-on-templates.sh",
);

const HSTS_DIRECTIVE =
  'add_header Strict-Transport-Security "max-age=31536000" always;';

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
    HSTS_HEADER_DIRECTIVE: "",
    SERVER_APP_HOSTNAME: "app",
    SERVER_HOME_HOSTNAME: "home",
  });

  delete environment.SERVER_NAMES_HASH_BUCKET_SIZE;
  delete environment.SERVER_NAMES_HASH_MAX_SIZE;
  delete environment.NGINX_UPSTREAM_KEEPALIVE_CONNECTIONS;
  delete environment.NGINX_INGEST_ACCESS_LOG;

  return { ...environment, ...overrides };
}

/**
 * Execute the same renderer the container runs, but direct all generated files
 * into a temporary directory. Existing dummy certificate files let the local
 * TLS branch run without invoking openssl or touching /etc.
 */
function renderThroughContainerScript({ httpProtocol, provisionSsl }) {
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-nginx-render-"),
  );
  const templateDirectory = path.join(tempDirectory, "templates");
  const outputDirectory = path.join(tempDirectory, "conf.d");
  const certificateDirectory = path.join(tempDirectory, "certificates");
  const primaryDomain = "oneuptime.example.com";

  fs.mkdirSync(templateDirectory, { recursive: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.mkdirSync(certificateDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(templateDirectory, "default.conf.template"),
    template,
  );

  if (provisionSsl) {
    fs.writeFileSync(
      path.join(certificateDirectory, `${primaryDomain}.crt`),
      "test certificate",
    );
    fs.writeFileSync(
      path.join(certificateDirectory, `${primaryDomain}.key`),
      "test key",
    );
  }

  try {
    const result = spawnSync("sh", [envsubstScriptPath], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        ...baseEnvironment(),
        HTTP_PROTOCOL: httpProtocol,
        PROVISION_SSL: provisionSsl ? "true" : "false",
        PRIMARY_DOMAIN: primaryDomain,
        SERVER_CERT_DIRECTORY: certificateDirectory,
        NGINX_ENVSUBST_TEMPLATE_DIR: templateDirectory,
        NGINX_ENVSUBST_OUTPUT_DIR: outputDirectory,
        NGINX_ENVSUBST_TEMPLATE_SUFFIX: ".template",
      },
    });

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    return fs.readFileSync(path.join(outputDirectory, "default.conf"), "utf8");
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function serverHasDirectHsts(server) {
  const firstLocation = getLocationBlocks(server.body)[0];
  const serverDirectives = server.body.slice(
    0,
    firstLocation?.startIndex ?? server.body.length,
  );

  return getDirectives(serverDirectives, "add_header").includes(HSTS_DIRECTIVE);
}

test(
  "the container renderer derives HSTS from each supported TLS topology",
  { skip: hasEnvsubst ? false : "envsubst not on PATH" },
  () => {
    const cases = [
      {
        name: "plain development HTTP",
        httpProtocol: "http",
        provisionSsl: false,
        expectedHstsServers: 1,
      },
      {
        name: "TLS terminated by an upstream proxy",
        httpProtocol: "https",
        provisionSsl: false,
        expectedHstsServers: 3,
      },
      {
        name: "TLS provisioned by the OneUptime ingress",
        httpProtocol: "http",
        provisionSsl: true,
        expectedHstsServers: 3,
      },
    ];

    for (const scenario of cases) {
      const rendered = renderThroughContainerScript(scenario);
      const hstsServers = getServerBlocks(rendered).filter(
        serverHasDirectHsts,
      );

      assert.equal(
        hstsServers.length,
        scenario.expectedHstsServers,
        scenario.name,
      );
      assert.doesNotMatch(rendered, /includeSubDomains|preload/i);

      if (scenario.provisionSsl) {
        assert.match(rendered, /listen\s+7850\s+ssl\s*;/);
        assert.match(rendered, /ssl_certificate\s+[^;]+\.crt;/);
        assert.match(rendered, /ssl_certificate_key\s+[^;]+\.key;/);
      }
    }
  },
);

test(
  "an HTTPS render sends HSTS from every public server and header override",
  { skip: hasEnvsubst ? false : "envsubst not on PATH" },
  () => {
    const rendered = renderThroughContainerScript({
      httpProtocol: "https",
      provisionSsl: false,
    });
    const servers = getServerBlocks(rendered);

    assert.equal(servers.length, 3);

    for (const server of servers) {
      assert.ok(
        serverHasDirectHsts(server),
        `public HTTPS server lost ${HSTS_DIRECTIVE}`,
      );

      for (const location of getLocationBlocks(server.body)) {
        const headers = getDirectives(location.body, "add_header");
        const overridesInheritedHeaders = headers.some((header) => {
          return header !== HSTS_DIRECTIVE;
        });

        if (overridesInheritedHeaders) {
          assert.ok(
            headers.includes(HSTS_DIRECTIVE),
            `${location.spec} overrides add_header inheritance without restating HSTS`,
          );
        }

        const conditionalBlocks = findBlocks(
          location.body,
          /^[^\S\n]*if[^\S\n]+(.*)\{[^\S\n]*$/,
        );

        for (const conditional of conditionalBlocks) {
          const conditionalHeaders = getDirectives(
            conditional.body,
            "add_header",
          );

          if (
            conditionalHeaders.some((header) => header !== HSTS_DIRECTIVE)
          ) {
            assert.ok(
              conditionalHeaders.includes(HSTS_DIRECTIVE),
              `${location.spec} has an if block that overrides add_header inheritance without HSTS`,
            );
          }
        }
      }
    }
  },
);

test(
  "a plain-HTTP render does not opt the HTTP listeners into HSTS",
  { skip: hasEnvsubst ? false : "envsubst not on PATH" },
  () => {
    const rendered = renderThroughContainerScript({
      httpProtocol: "http",
      provisionSsl: false,
    });
    const servers = getServerBlocks(rendered);
    const serversWithHsts = servers.filter(serverHasDirectHsts);

    assert.equal(serversWithHsts.length, 1);
    assert.match(
      serversWithHsts[0].body,
      /listen\s+\$?\{?[^;]*7850\s+ssl\s+default_server/,
      "only the dedicated TLS listener should retain the unconditional HSTS header",
    );
    assert.equal((rendered.match(/Strict-Transport-Security/g) || []).length, 1);
  },
);

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
    // /source-maps.
    assert.equal(
      (
        rendered.match(
          /access_log \/var\/log\/nginx\/access\.log main buffer=64k flush=10s if=\$ingest_access_log;/g,
        ) || []
      ).length,
      7,
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
