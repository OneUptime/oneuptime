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

    assert.equal(
      (
        rendered.match(
          /access_log \/var\/log\/nginx\/access\.log main buffer=64k flush=10s if=\$ingest_access_log;/g,
        ) || []
      ).length,
      5,
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
