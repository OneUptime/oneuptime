/**
 * NGINX_HTTP2 turns HTTP/2 off for HOST, and changes nothing else (#9846).
 *
 * The primary server turns HTTP/2 on, and with PROVISION_SSL its HTTPS
 * listener offers it to HOST through ALPN, which OTLP over gRPC to HOST
 * needs. When nginx fixed two vulnerabilities in HTTP/2 (CVE-2026-123007 and
 * CVE-2026-123633, in nginx 1.30.7: #9709), the only way to turn it off
 * without upgrading was a sed in the running container, which the next
 * container or pod undid. NGINX_HTTP2 (config.env, and nginx.http2 in the
 * Helm chart) turns it off for good, until it is set back. These tests hold:
 *
 *   - the template: the primary server's one `http2` directive reads the
 *     setting, and no other server, listen or http{} setting turns HTTP/2 on;
 *   - the real envsubst-on-templates.sh: on, true, yes, 1 or nothing render
 *     "on"; off, false, no and 0 render "off", in any case; anything else
 *     renders "on" and is warned of; the log says when it is off, and when
 *     that changes nothing; NginxConfigParser's model agrees;
 *   - the rendered config: off differs from the default in the primary's
 *     `http2` directive alone, and a real nginx accepts both, with
 *     PROVISION_SSL and without (inside the ingress image as the script
 *     renders it, where RUN_NGINX_IMAGE_TESTS=1);
 *   - a real nginx: h2 for HOST over TLS only while it is on; a client that
 *     offers only h2, as gRPC clients do, refused while it is off; HTTP/1.1
 *     answered either way, and a status page's domain and the plaintext port
 *     never on HTTP/2;
 *   - the way to it: Docker Compose, config.example.env and the Helm chart
 *     hand the ingress the name the script reads, on by default, and run.sh
 *     and the certificate sidecar both render through the script.
 *
 * What OTLP does with it off, over gRPC and over HTTP, is in
 * OtlpIngestBodySize.test.js ("NGINX_HTTP2=off").
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const tls = require("node:tls");
const { spawn, spawnSync } = require("node:child_process");

const {
  NGINX_DIRECTORY,
  PRIMARY_HTTP2_OFF_SETTINGS,
  getDirectives,
  getServerBlocks,
  ingressListenEnvironment,
  primaryHttp2Environment,
  primaryServerNameEnvironment,
  readNginxConf,
  readTemplate,
  stripComments,
} = require("./NginxConfigParser");

const { after, before, describe } = test;

const template = readTemplate();
const nginxConf = readNginxConf();
const REPOSITORY_ROOT = path.resolve(NGINX_DIRECTORY, "..", "..");
const SCRIPT_PATH = path.join(NGINX_DIRECTORY, "envsubst-on-templates.sh");
const SCRIPT_NAME = "envsubst-on-templates.sh";

const SETTING = "NGINX_HTTP2";
const PLACEHOLDER = "${NGINX_HTTP2}";
const PRIMARY_HTTP2_DIRECTIVE = `http2 ${PLACEHOLDER};`;

const HOST = "oneuptime.example.com";
const STATUS_PAGE_DOMAIN = "status.example.org";

/*
 * Settings as people write them. The script reads them without the spaces
 * around them and in any case.
 */
const ON_SETTINGS = [
  "",
  "on",
  "ON",
  "On",
  "true",
  "TRUE",
  "True",
  "yes",
  "YES",
  "1",
  " on ",
  "\ttrue",
];

const OFF_SETTINGS = [
  "off",
  "OFF",
  "Off",
  "false",
  "FALSE",
  "False",
  "no",
  "NO",
  "0",
  " off ",
  "off\t",
  " FALSE",
];

/*
 * Values the script does not know. Each keeps HTTP/2 on, as it was, and is
 * warned of. None reaches the config as written, so a value cannot add a
 * directive of its own ("off; listen 1234").
 */
const UNKNOWN_SETTINGS = [
  "disabled",
  "disable",
  "enabled",
  "of",
  "onn",
  "2",
  "-1",
  "h2",
  "http/1.1",
  "off;",
  "off; listen 1234",
  "$off",
  '"off"',
];

// What the script says, beside its own "Running ..." lines.
const OFF_LOG = (hostWithoutPort) => {
  return `${SCRIPT_NAME}: HTTP/2 is off for ${hostWithoutPort} (NGINX_HTTP2=off): OTLP over gRPC to it stops, and OTLP over HTTP and browsers keep working over HTTP/1.1.`;
};
const OFF_WITHOUT_HTTPS_LOG = `${SCRIPT_NAME}: NGINX_HTTP2 is off, which changes nothing here: the ingress serves no HTTPS for HOST, and so speaks only HTTP/1.1 to it.`;
const UNKNOWN_LOG = (value) => {
  return `${SCRIPT_NAME}: WARNING: NGINX_HTTP2 is "${value}", which is neither on nor off, so HTTP/2 stays on. Set NGINX_HTTP2=off to turn it off.`;
};

// A template that prints what the script exports for the setting.
const PRINT_TEMPLATE = `NGINX_HTTP2=${PLACEHOLDER}\n`;

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
}

function isOnPath(binary, args = ["--version"]) {
  const probe = spawnSync(binary, args, { encoding: "utf8" });

  return !probe.error && probe.status === 0;
}

const scriptSkipReason =
  isOnPath("sh", ["-c", "exit 0"]) && isOnPath("envsubst")
    ? false
    : "sh or envsubst not on PATH";

const opensslSkipReason = isOnPath("openssl", ["version"])
  ? false
  : "openssl not on PATH";

/*
 * A real nginx has to be the shipped image's or newer: the `http2` directive
 * came in nginx 1.25.1, and older builds refuse it.
 */
const MINIMUM_NGINX_VERSION = [1, 25, 1];

const nginxSkipReason = (() => {
  if (scriptSkipReason) {
    return scriptSkipReason;
  }

  const probe = spawnSync("nginx", ["-v"], { encoding: "utf8" });
  const match = probe.error
    ? null
    : /nginx\/(\d+)\.(\d+)\.(\d+)/.exec(
        `${probe.stderr || ""}${probe.stdout || ""}`,
      );

  if (!match) {
    return "nginx binary not on PATH";
  }

  const version = match.slice(1, 4).map(Number);
  // The first component that differs decides (2.0.0 is newer than 1.25.1).
  const decidingIndex = MINIMUM_NGINX_VERSION.findIndex((floor, index) => {
    return version[index] !== floor;
  });

  return decidingIndex !== -1 &&
    version[decidingIndex] < MINIMUM_NGINX_VERSION[decidingIndex]
    ? `nginx ${version.join(".")} predates ${MINIMUM_NGINX_VERSION.join(".")}, which the shipped config requires`
    : false;
})();

const liveSkipReason = nginxSkipReason || opensslSkipReason;

/*
 * With PROVISION_SSL the script writes the primary's placeholder certificate
 * where the ingress image keeps it (/etc/nginx/certs/ServerCerts), so the
 * script's own PROVISION_SSL path runs only inside that image.
 */
const imageSkipReason = (() => {
  if (liveSkipReason) {
    return liveSkipReason;
  }

  if (process.env.RUN_NGINX_IMAGE_TESTS !== "1") {
    return "writes to /etc/nginx/certs/ServerCerts: set RUN_NGINX_IMAGE_TESTS=1 inside the ingress image";
  }

  return false;
})();

/**
 * The container environment of a stock install, without IPv6 listens, with
 * `overrides` on top. NGINX_HTTP2 is in it only when an override sets it.
 */
function containerEnvironment(overrides = {}) {
  return {
    APP_PORT: "3002",
    HOME_PORT: "1444",
    HOST,
    BILLING_ENABLED: "false",
    NGINX_RESOLVER: "127.0.0.11",
    SERVER_APP_HOSTNAME: "app",
    SERVER_HOME_HOSTNAME: "home",
    NGINX_LISTEN_ADDRESS: "",
    NGINX_LISTEN_OPTIONS: "",
    NGINX_IPV6_SUPPORT_FILE: path.join(
      os.tmpdir(),
      `oneuptime-no-ipv6-${process.pid}-absent`,
    ),
    ...overrides,
  };
}

/** The environment with NGINX_HTTP2 set to `setting`, or unset for undefined. */
function withSetting(setting, overrides = {}) {
  return containerEnvironment(
    setting === undefined ? overrides : { ...overrides, [SETTING]: setting },
  );
}

/**
 * Run the real envsubst-on-templates.sh over `templateText`, the way the
 * container runs it: what it wrote, and every line it logged.
 */
function runScript(templateText, environment) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-http2-"));

  try {
    const templateDirectory = path.join(directory, "templates");
    const outputDirectory = path.join(directory, "out");

    fs.mkdirSync(templateDirectory);
    fs.mkdirSync(outputDirectory);
    fs.writeFileSync(
      path.join(templateDirectory, "default.conf.template"),
      templateText,
    );

    const result = spawnSync("sh", [SCRIPT_PATH], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NGINX_ENVSUBST_TEMPLATE_DIR: templateDirectory,
        NGINX_ENVSUBST_OUTPUT_DIR: outputDirectory,
        ...environment,
      },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    return {
      rendered: fs.readFileSync(
        path.join(outputDirectory, "default.conf"),
        "utf8",
      ),
      log: `${result.stdout}${result.stderr}`.split("\n").filter(Boolean),
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

/** What the script exports for the setting, and the lines it says of it. */
function exportedSetting(setting, overrides = {}) {
  const { rendered, log } = runScript(
    PRINT_TEMPLATE,
    withSetting(setting, overrides),
  );
  const match = /^NGINX_HTTP2=(.*)\n$/.exec(rendered);

  assert.ok(match, rendered);

  return { value: match[1], log: http2LogLines(log) };
}

// The lines of a log that speak of HTTP/2 or of the setting.
function http2LogLines(log) {
  return log.filter((line) => {
    return /HTTP\/2|NGINX_HTTP2/.test(line);
  });
}

/** The primary server block of `source`: the one named localhost ingress. */
function primaryServerBlockOf(source) {
  const blocks = getServerBlocks(source).filter((block) => {
    return /server_name\s+localhost\s+ingress\b/.test(block.body);
  });

  assert.equal(blocks.length, 1, "expected one primary server block");

  return blocks[0];
}

/** The lines where `before` and `after` differ, as [before, after] pairs. */
function differingLines(before, after) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  assert.equal(
    beforeLines.length,
    afterLines.length,
    "the two renders have a different number of lines",
  );

  return beforeLines
    .map((line, index) => {
      return [line, afterLines[index]];
    })
    .filter(([beforeLine, afterLine]) => {
      return beforeLine !== afterLine;
    });
}

/**
 * The template rendered with envsubst from the script's exports as
 * NginxConfigParser models them: the PROVISION_SSL listens on 7849 and 7850
 * with `certificate` and `key`, the primary's names for HOST, and the
 * setting. With PROVISION_SSL the script itself writes the primary's
 * certificate under /etc/nginx/certs, which only the image allows; the image
 * test below runs the script, and holds the two to the same render.
 */
function renderModelled(setting, { certificate, key, overrides = {} }) {
  const environment = {
    ...containerEnvironment(overrides),
    BACKEND_APP_TARGET: "$backend_app",
    BACKEND_APP_GRPC_TARGET: "$backend_app_grpc",
    ...ingressListenEnvironment({
      listenAddress:
        overrides.NGINX_LISTEN_ADDRESS === undefined
          ? ""
          : overrides.NGINX_LISTEN_ADDRESS,
      ipv6: false,
      provisionSsl: true,
    }),
    ...primaryServerNameEnvironment(overrides.HOST || HOST),
    ...primaryHttp2Environment(setting),
    PROVISION_SSL_CERTIFICATE_DIRECTIVE: `    ssl_certificate ${certificate};`,
    PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE: `    ssl_certificate_key ${key};`,
  };
  // The script's own removals, for the settings left unset here.
  const source = template
    .replace(/^[ \t]*server_names_hash_(bucket|max)_size[ \t].*\n/gm, "")
    .replace(
      /# BEGIN upstream-keepalive[\s\S]*?# END upstream-keepalive\n/,
      "",
    );
  const result = spawnSync(
    "envsubst",
    [
      Object.keys(environment)
        .map((name) => {
          return `\${${name}}`;
        })
        .join(" "),
    ],
    {
      input: source,
      encoding: "utf8",
      env: { PATH: process.env.PATH, ...environment },
    },
  );

  assert.equal(result.status, 0, result.stderr);

  return result.stdout;
}

/**
 * A self-signed certificate for `name`, with the name in its SAN so that a
 * client can verify it. `readableByWorkers`: nginx started as root reads a
 * certificate named by a variable (the status pages') in a worker, which
 * runs as another user.
 */
function makeCertificate(directory, name, { readableByWorkers = false } = {}) {
  const certificate = path.join(directory, `${name}.crt`);
  const key = path.join(directory, `${name}.key`);
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      `/CN=${name}`,
      "-addext",
      `subjectAltName=DNS:${name}`,
      "-keyout",
      key,
      "-out",
      certificate,
      "-days",
      "1",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);

  if (readableByWorkers) {
    fs.chmodSync(certificate, 0o644);
    fs.chmodSync(key, 0o644);
  }

  return { certificate, key };
}

// nginx.conf with what depends on the image moved into `prefix`.
function mainConfIn(prefix) {
  return nginxConf
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
}

/**
 * `nginx -t` on nginx.conf and the rendered `defaultConf`, with what depends
 * on the image moved into a temporary prefix: its status, and all it printed.
 */
function nginxTest(defaultConf) {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-http2-"));

  try {
    fs.mkdirSync(path.join(prefix, "conf.d"));
    fs.mkdirSync(path.join(prefix, "logs"));
    fs.writeFileSync(path.join(prefix, "nginx.conf"), mainConfIn(prefix));
    fs.writeFileSync(
      path.join(prefix, "conf.d", "default.conf"),
      // The template's own access_log lines name the image's log folder too.
      defaultConf.replace(/\/var\/log\/nginx\//g, `${prefix}/logs/`),
    );

    const result = spawnSync(
      "nginx",
      [
        "-t",
        "-p",
        prefix,
        "-e",
        path.join(prefix, "logs", "startup-error.log"),
        "-c",
        path.join(prefix, "nginx.conf"),
      ],
      { encoding: "utf8" },
    );

    return {
      status: result.status,
      output: `${result.stdout || ""}${result.stderr || ""}`,
    };
  } finally {
    fs.rmSync(prefix, { recursive: true, force: true });
  }
}

const NGINX_COMPLAINT = /\[(warn|error|crit|alert|emerg)\]/;

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

test("the primary server's one http2 directive reads NGINX_HTTP2", () => {
  assert.deepEqual(
    getDirectives(primaryServerBlockOf(template).body, "http2"),
    [PRIMARY_HTTP2_DIRECTIVE],
  );

  // ...and the template reads the setting nowhere else.
  assert.equal(stripComments(template).split(PLACEHOLDER).length - 1, 1);
});

test("no other server, listen or http{} setting turns HTTP/2 on", () => {
  const primary = primaryServerBlockOf(template);
  const others = getServerBlocks(template).filter((block) => {
    return block.startIndex !== primary.startIndex;
  });

  assert.equal(others.length, 2, "expected the two status-page servers");

  for (const block of others) {
    assert.deepEqual(getDirectives(block.body, "http2"), []);
  }

  // The pre-1.25.1 spelling, `listen ... http2`, in the template or in the
  // listens the script writes into it.
  for (const listen of getDirectives(template, "listen")) {
    assert.doesNotMatch(listen, /\bhttp2\b/, listen);
  }

  assert.doesNotMatch(
    fs.readFileSync(SCRIPT_PATH, "utf8"),
    /listen [^"\n]*\bhttp2\b/,
  );
  assert.deepEqual(getDirectives(nginxConf, "http2"), []);
});

// ---------------------------------------------------------------------------
// The script
// ---------------------------------------------------------------------------

test(
  "the script keeps HTTP/2 on, and says nothing of it, when the setting is unset, empty, on, true, yes or 1",
  { skip: scriptSkipReason },
  () => {
    for (const setting of [undefined, ...ON_SETTINGS]) {
      assert.deepEqual(
        exportedSetting(setting),
        { value: "on", log: [] },
        `NGINX_HTTP2=${JSON.stringify(setting)}`,
      );
    }
  },
);

test(
  "the script turns HTTP/2 off for off, false, no and 0, in any case and with spaces around",
  { skip: scriptSkipReason },
  () => {
    for (const setting of OFF_SETTINGS) {
      assert.equal(
        exportedSetting(setting).value,
        "off",
        `NGINX_HTTP2=${JSON.stringify(setting)}`,
      );
    }
  },
);

test(
  "a value the script does not know keeps HTTP/2 on, and the log says so",
  { skip: scriptSkipReason },
  () => {
    for (const setting of UNKNOWN_SETTINGS) {
      assert.deepEqual(
        exportedSetting(setting),
        { value: "on", log: [UNKNOWN_LOG(setting)] },
        `NGINX_HTTP2=${JSON.stringify(setting)}`,
      );
    }
  },
);

test(
  "a value the script does not know adds nothing to the config: the primary's directive stays http2 on",
  { skip: scriptSkipReason },
  () => {
    const { rendered } = runScript(template, withSetting("off; listen 1234"));

    assert.deepEqual(
      getDirectives(primaryServerBlockOf(rendered).body, "http2"),
      ["http2 on;"],
    );
    assert.ok(!rendered.includes("1234"), "the value reached the config");
  },
);

test(
  "NginxConfigParser's model exports what the script does, for every setting",
  { skip: scriptSkipReason },
  () => {
    for (const setting of [
      undefined,
      ...ON_SETTINGS,
      ...OFF_SETTINGS,
      ...UNKNOWN_SETTINGS,
    ]) {
      assert.deepEqual(
        { NGINX_HTTP2: exportedSetting(setting).value },
        primaryHttp2Environment(setting),
        `NGINX_HTTP2=${JSON.stringify(setting)}`,
      );
    }

    // The model's list is the four the script names.
    assert.deepEqual(PRIMARY_HTTP2_OFF_SETTINGS, ["off", "false", "no", "0"]);
  },
);

test(
  "with HTTP/2 off and no HTTPS for HOST, the log says it changes nothing",
  { skip: scriptSkipReason },
  () => {
    // PROVISION_SSL off, as on every install that ends TLS in front of it.
    assert.deepEqual(exportedSetting("off").log, [OFF_WITHOUT_HTTPS_LOG]);
    assert.deepEqual(exportedSetting("false").log, [OFF_WITHOUT_HTTPS_LOG]);

    // PROVISION_SSL asked for without a HOST to name the certificate by: the
    // script serves no HTTPS for HOST then either (and warns of that).
    const { value, log } = exportedSetting("off", {
      PROVISION_SSL: "true",
      HOST: "",
    });

    assert.equal(value, "off");
    assert.deepEqual(log, [OFF_WITHOUT_HTTPS_LOG]);
  },
);

// ---------------------------------------------------------------------------
// The rendered config
// ---------------------------------------------------------------------------

test(
  "turned off, the config differs from the default in the primary's http2 directive alone, in both upstream modes",
  { skip: scriptSkipReason },
  () => {
    // Per-request upstreams (Docker Compose), and the keepalive pools the
    // Helm chart turns on.
    for (const upstream of [{}, { NGINX_UPSTREAM_KEEPALIVE: "true" }]) {
      const on = runScript(template, withSetting(undefined, upstream));
      const off = runScript(template, withSetting("off", upstream));

      assert.deepEqual(
        differingLines(on.rendered, off.rendered),
        [["    http2  on;", "    http2  off;"]],
        JSON.stringify(upstream),
      );
      assert.deepEqual(
        getDirectives(primaryServerBlockOf(off.rendered).body, "http2"),
        ["http2 off;"],
      );
      assert.deepEqual(
        getDirectives(primaryServerBlockOf(on.rendered).body, "http2"),
        ["http2 on;"],
      );
    }
  },
);

test("run.sh and the certificate sidecar render through the script, which reads NGINX_HTTP2 from the container's environment", () => {
  const runScriptSource = fs.readFileSync(
    path.join(NGINX_DIRECTORY, "run.sh"),
    "utf8",
  );
  const sidecar = fs.readFileSync(
    path.join(NGINX_DIRECTORY, "Utils", "NginxConfigurator.ts"),
    "utf8",
  );
  const dockerfile = fs.readFileSync(
    path.join(NGINX_DIRECTORY, "Dockerfile.tpl"),
    "utf8",
  );

  // Where the image puts the script, and where both run it from.
  assert.ok(
    dockerfile.includes(
      "COPY ./packages/Nginx/envsubst-on-templates.sh /etc/nginx/envsubst-on-templates.sh",
    ),
  );
  assert.match(runScriptSource, /^\/etc\/nginx\/envsubst-on-templates\.sh$/m);
  assert.ok(
    sidecar.includes('"/etc/nginx/envsubst-on-templates.sh"'),
    "the sidecar no longer re-renders through the script",
  );

  // Neither sets the setting or drops it from the environment.
  for (const [file, source] of [
    ["run.sh", runScriptSource],
    ["Utils/NginxConfigurator.ts", sidecar],
  ]) {
    assert.ok(!source.includes(SETTING), `${file} names ${SETTING}`);
  }
});

// ---------------------------------------------------------------------------
// A real nginx: nginx -t
// ---------------------------------------------------------------------------

test(
  "a real nginx accepts the config with HTTP/2 on and off, with PROVISION_SSL and without, and warns of nothing",
  { skip: liveSkipReason, timeout: 60000 },
  () => {
    // Without PROVISION_SSL, as the real script renders it.
    for (const setting of [undefined, "off"]) {
      const { status, output } = nginxTest(
        runScript(template, withSetting(setting)).rendered,
      );

      assert.equal(status, 0, `NGINX_HTTP2=${setting}: ${output}`);
      assert.doesNotMatch(output, NGINX_COMPLAINT, `NGINX_HTTP2=${setting}`);
    }

    // With PROVISION_SSL, from the model, with a certificate made here.
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-http2-"),
    );

    try {
      const { certificate, key } = makeCertificate(directory, HOST);

      for (const setting of ["on", "off"]) {
        const rendered = renderModelled(setting, { certificate, key });

        assert.ok(rendered.includes("    listen 7850 ssl;\n"), setting);
        assert.deepEqual(
          getDirectives(primaryServerBlockOf(rendered).body, "http2"),
          [`http2 ${setting};`],
        );

        const { status, output } = nginxTest(rendered);

        assert.equal(status, 0, `NGINX_HTTP2=${setting}: ${output}`);
        assert.doesNotMatch(output, NGINX_COMPLAINT, `NGINX_HTTP2=${setting}`);
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

/*
 * The image as it starts with PROVISION_SSL: the script makes the primary's
 * placeholder certificate, listens on 7850 for HOST, and renders the setting.
 * HOST with a port and capitals, as people write it: the log names it as the
 * server name does, without its port.
 */
test(
  "inside the image, with PROVISION_SSL, off turns HTTP/2 off for HOST alone, the log says so, and nginx -t accepts both",
  { skip: imageSkipReason, timeout: 60000 },
  () => {
    const host = "OneUptime.Example.com:8443";
    // run.sh's PRIMARY_DOMAIN for it (PrimaryServerName.test.js holds run.sh
    // to this): HOST without its port, in lower case.
    const primaryDomain = "oneuptime.example.com";
    const certificate = `/etc/nginx/certs/ServerCerts/${primaryDomain}.crt`;
    const key = `/etc/nginx/certs/ServerCerts/${primaryDomain}.key`;
    const madeHere = !fs.existsSync(certificate) && !fs.existsSync(key);
    const environment = {
      HOST: host,
      PROVISION_SSL: "true",
      PRIMARY_DOMAIN: primaryDomain,
    };

    try {
      const on = runScript(template, withSetting(undefined, environment));
      const off = runScript(template, withSetting("off", environment));

      for (const { rendered } of [on, off]) {
        assert.ok(rendered.includes("    listen 7850 ssl;\n"));
        assert.ok(rendered.includes(`    ssl_certificate ${certificate};\n`));
      }

      assert.deepEqual(differingLines(on.rendered, off.rendered), [
        ["    http2  on;", "    http2  off;"],
      ]);
      assert.deepEqual(http2LogLines(on.log), []);
      assert.deepEqual(http2LogLines(off.log), [
        OFF_LOG("OneUptime.Example.com"),
      ]);

      // The model renders what the script did, so the live suite below,
      // which runs from the model, runs what the image runs.
      for (const [setting, { rendered }] of [
        ["on", on],
        ["off", off],
      ]) {
        assert.equal(
          renderModelled(setting, {
            certificate,
            key,
            overrides: environment,
          }),
          rendered,
          `NGINX_HTTP2=${setting}`,
        );

        const { status, output } = nginxTest(rendered);

        assert.equal(status, 0, `NGINX_HTTP2=${setting}: ${output}`);
        assert.doesNotMatch(output, NGINX_COMPLAINT, `NGINX_HTTP2=${setting}`);
      }
    } finally {
      if (madeHere) {
        fs.rmSync(certificate, { force: true });
        fs.rmSync(key, { force: true });
      }
    }
  },
);

// ---------------------------------------------------------------------------
// A real nginx: what it negotiates
// ---------------------------------------------------------------------------

function freePort() {
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

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
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

const UPSTREAM_HEADER = "x-oneuptime-test-upstream";

/** A stand-in App that answers every request with a 200 of its own. */
function startApp() {
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, {
        "Content-Type": "text/plain",
        [UPSTREAM_HEADER]: "app",
      });
      response.end("app");
    });
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

/**
 * A real nginx on the config the image renders with PROVISION_SSL and
 * `setting`, on free loopback ports, in front of a stand-in App: HOST's
 * certificate on the primary, and a status page's on its domain.
 */
async function startIngress(setting) {
  const app = await startApp();
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-http2-"));

  // nginx started as root (the image) runs its workers as another user, who
  // reads the status pages' certificates and the temp folders under here.
  fs.chmodSync(prefix, 0o755);
  fs.mkdirSync(path.join(prefix, "conf.d"));
  fs.mkdirSync(path.join(prefix, "logs"));

  const statusPageCertificates = path.join(prefix, "StatusPageCerts");

  fs.mkdirSync(statusPageCertificates);
  fs.chmodSync(statusPageCertificates, 0o755);

  const primary = makeCertificate(prefix, HOST);
  const statusPage = makeCertificate(
    statusPageCertificates,
    STATUS_PAGE_DOMAIN,
    { readableByWorkers: true },
  );
  const httpPort = await freePort();
  const tlsPort = await freePort();

  const rendered = renderModelled(setting, {
    certificate: primary.certificate,
    key: primary.key,
    overrides: {
      APP_PORT: String(app.port),
      HOME_PORT: String(app.port),
      NGINX_LISTEN_ADDRESS: "127.0.0.1:",
      NGINX_RESOLVER: "127.0.0.1",
      SERVER_APP_HOSTNAME: "127.0.0.1",
      SERVER_HOME_HOSTNAME: "127.0.0.1",
    },
  })
    .replace(/\b127\.0\.0\.1:7849\b/g, `127.0.0.1:${httpPort}`)
    .replace(/\b127\.0\.0\.1:7850\b/g, `127.0.0.1:${tlsPort}`)
    .replace(
      /\/etc\/nginx\/certs\/StatusPageCerts\//g,
      `${statusPageCertificates}/`,
    )
    .replace(/\/var\/log\/nginx\//g, `${prefix}/logs/`);

  fs.writeFileSync(path.join(prefix, "nginx.conf"), mainConfIn(prefix));
  fs.writeFileSync(path.join(prefix, "conf.d", "default.conf"), rendered);

  let output = "";
  const nginx = spawn(
    "nginx",
    [
      "-p",
      prefix,
      "-e",
      path.join(prefix, "logs", "startup-error.log"),
      "-c",
      path.join(prefix, "nginx.conf"),
      "-g",
      "daemon off;",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  nginx.stdout.on("data", (chunk) => {
    output += chunk;
  });
  nginx.stderr.on("data", (chunk) => {
    output += chunk;
  });

  const exited = new Promise((resolve) => {
    nginx.once("exit", resolve);
  });

  async function stop() {
    if (nginx.exitCode === null && nginx.signalCode === null) {
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

    await app.close();
    fs.rmSync(prefix, { recursive: true, force: true });
  }

  const deadline = Date.now() + 15000;
  let listening = false;

  while (Date.now() < deadline && nginx.exitCode === null) {
    if ((await canConnect(httpPort)) && (await canConnect(tlsPort))) {
      listening = true;
      break;
    }

    await wait(50);
  }

  if (!listening) {
    await stop();
    assert.fail(`nginx did not start: ${output}`);
  }

  return {
    httpPort,
    tlsPort,
    trusted: [
      fs.readFileSync(primary.certificate),
      fs.readFileSync(statusPage.certificate),
    ],
    stop,
  };
}

/**
 * Open a TLS connection to the ingress for `servername`, offering the ALPN
 * `protocols`, and verify the certificate it answers with. With `request`,
 * send it once HTTP/1.1 is agreed and read the answer. Never rejects: a
 * refused handshake is an outcome the tests assert on.
 */
function connectOverTls(ingress, { servername, protocols, request = null }) {
  return new Promise((resolve) => {
    const result = {
      protocol: undefined,
      certificateName: undefined,
      response: "",
      error: undefined,
    };
    let finished = false;
    const socket = tls.connect({
      host: "127.0.0.1",
      port: ingress.tlsPort,
      servername,
      ALPNProtocols: protocols,
      ca: ingress.trusted,
    });

    function finish() {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(result);
      }
    }

    const timer = setTimeout(() => {
      result.error = result.error || new Error("timed out");
      finish();
    }, 10000);

    socket.once("secureConnect", () => {
      result.protocol = socket.alpnProtocol;
      result.certificateName = socket.getPeerCertificate().subject.CN;

      if (request && socket.alpnProtocol === "http/1.1") {
        socket.write(request);
      } else {
        finish();
      }
    });
    socket.on("data", (chunk) => {
      result.response += chunk;
    });
    socket.once("error", (error) => {
      result.error = error;
      finish();
    });
    socket.once("close", finish);
  });
}

// What a browser sends for HOST's front page once it has HTTP/1.1.
const FRONT_PAGE_REQUEST = `GET / HTTP/1.1\r\nHost: ${HOST}\r\nConnection: close\r\n\r\n`;

/**
 * Open a plaintext connection to the ingress's HTTP port with the HTTP/2
 * connection preface, as an h2c client with prior knowledge does, and read
 * what comes back.
 */
function sendHttp2Preface(ingress) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(ingress.httpPort, "127.0.0.1");
    let response = "";

    socket.setTimeout(10000, () => {
      socket.destroy();
    });
    socket.once("connect", () => {
      socket.write("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
    });
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.once("error", reject);
    socket.once("close", () => {
      resolve(response);
    });
  });
}

/*
 * What a real nginx negotiates for each setting. A browser offers h2 and
 * HTTP/1.1, and takes HTTP/1.1 when h2 is not offered back; a gRPC client
 * offers h2 alone, and nginx refuses a TLS handshake whose ALPN offers it
 * nothing it speaks (since nginx 1.21.4).
 */
const NEGOTIATED = [
  { setting: "on", browser: "h2", grpcClient: "h2" },
  { setting: "off", browser: "http/1.1", grpcClient: null },
];

for (const { setting, browser, grpcClient } of NEGOTIATED) {
  describe(
    `live: what a real nginx negotiates with NGINX_HTTP2=${setting} and PROVISION_SSL`,
    { skip: liveSkipReason, timeout: 120000 },
    () => {
      let ingress;

      before(async () => {
        ingress = await startIngress(setting);
      });

      after(async () => {
        await ingress?.stop();
      });

      test(`a browser offering h2 and HTTP/1.1 gets ${browser} for HOST, with HOST's certificate`, async () => {
        const result = await connectOverTls(ingress, {
          servername: HOST,
          protocols: ["h2", "http/1.1"],
        });

        assert.equal(result.error, undefined, String(result.error));
        assert.equal(result.protocol, browser);
        assert.equal(result.certificateName, HOST);
      });

      test(
        grpcClient
          ? "a gRPC client offering h2 alone gets it for HOST"
          : "a gRPC client offering h2 alone is refused in the TLS handshake for HOST",
        async () => {
          const result = await connectOverTls(ingress, {
            servername: HOST,
            protocols: ["h2"],
          });

          if (grpcClient) {
            assert.equal(result.error, undefined, String(result.error));
            assert.equal(result.protocol, grpcClient);
          } else {
            assert.ok(result.error, "the handshake was not refused");
            assert.match(
              `${result.error.code} ${result.error.message}`,
              /no.application.protocol/i,
            );
            assert.equal(result.protocol, undefined);
          }
        },
      );

      test("HOST's front page answers over HTTPS on HTTP/1.1, from the App", async () => {
        // A client that offers HTTP/1.1 alone, and a browser that falls back
        // to it while HTTP/2 is off.
        const offers = [["http/1.1"]];

        if (browser === "http/1.1") {
          offers.push(["h2", "http/1.1"]);
        }

        for (const protocols of offers) {
          const result = await connectOverTls(ingress, {
            servername: HOST,
            protocols,
            request: FRONT_PAGE_REQUEST,
          });

          assert.equal(result.error, undefined, String(result.error));
          assert.equal(result.protocol, "http/1.1");
          assert.match(result.response, /^HTTP\/1\.1 200 /, result.response);
          assert.match(
            result.response,
            new RegExp(`^${UPSTREAM_HEADER}: app\\r$`, "im"),
            result.response,
          );
        }
      });

      test("a status page's own domain gets HTTP/1.1, with its own certificate", async () => {
        const result = await connectOverTls(ingress, {
          servername: STATUS_PAGE_DOMAIN,
          protocols: ["h2", "http/1.1"],
        });

        assert.equal(result.error, undefined, String(result.error));
        assert.equal(result.protocol, "http/1.1");
        assert.equal(result.certificateName, STATUS_PAGE_DOMAIN);
      });

      test("the plaintext port refuses an HTTP/2 connection preface", async () => {
        const response = await sendHttp2Preface(ingress);

        assert.match(response, /^HTTP\/1\.1 400 /, response);
      });
    },
  );
}

// ---------------------------------------------------------------------------
// The way to it: Docker Compose, config.example.env and the Helm chart
// ---------------------------------------------------------------------------

/**
 * The lines of the YAML block whose key sits at `indent` spaces, up to the
 * next key at that indent or shallower: enough for "the environment of the
 * ingress service" in a package with no YAML parser.
 */
function yamlBlock(source, keyPattern, indent) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => {
    return new RegExp(`^ {${indent}}${keyPattern}:`).test(line);
  });

  assert.notEqual(start, -1, `could not find a "${keyPattern}:" block`);

  const body = [];

  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || /^\s*#/.test(line)) {
      body.push(line);
      continue;
    }

    if (!new RegExp(`^ {${indent + 1},}\\S`).test(line)) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

test("Docker Compose hands config.env's NGINX_HTTP2 to the ingress, on when config.env does not set it", () => {
  const ingress = yamlBlock(
    readRepositoryFile("docker-compose.base.yml"),
    "ingress",
    2,
  );
  const declarations = yamlBlock(ingress, "environment", 4)
    .split("\n")
    .map((line) => {
      return line.trim();
    })
    .filter((line) => {
      return line.startsWith(`${SETTING}:`);
    });

  // "${NGINX_HTTP2:-on}", not a bare reference: a config.env from before the
  // setting does not set it, and Compose would warn on every command and
  // hand the ingress an empty value.
  assert.deepEqual(declarations, [`${SETTING}: \${${SETTING}:-on}`]);
  assert.equal(primaryHttp2Environment("on").NGINX_HTTP2, "on");
});

test("config.example.env sets NGINX_HTTP2=on, and says what off does and that upgrading is the fix", () => {
  const lines = readRepositoryFile("config.example.env").split("\n");
  const assignments = lines.filter((line) => {
    return line.startsWith(`${SETTING}=`);
  });

  assert.deepEqual(assignments, [`${SETTING}=on`]);

  // The comment block right above it.
  const index = lines.indexOf(`${SETTING}=on`);
  const comment = [];

  for (let line = index - 1; line >= 0 && lines[line].startsWith("#"); line--) {
    comment.unshift(lines[line].replace(/^#\s?/, ""));
  }

  const said = comment.join(" ");

  for (const phrase of [
    "PROVISION_SSL=true",
    "OTLP over gRPC to HOST needs it",
    "off turns it off",
    "OTLP over gRPC to HOST stops",
    "OTLP over HTTP",
    "upgrading is the fix",
  ]) {
    assert.ok(said.includes(phrase), `the comment no longer says "${phrase}"`);
  }
});

test("the Helm chart hands nginx.http2 to the gateway as the on or off the script reads, on by default", () => {
  const nginxTemplate = readRepositoryFile(
    "HelmChart/Public/oneuptime/templates/nginx.yaml",
  );
  const entry = nginxTemplate.match(
    new RegExp(`- name: ${SETTING}\\n\\s*value: (.*)\\n`),
  );

  assert.ok(entry, `the nginx Deployment does not set ${SETTING}`);
  assert.equal(
    entry[1],
    '{{ ternary "off" "on" (eq (toString $.Values.nginx.http2) "false") | quote }}',
  );

  // The two values it can hand the script are the two the script renders.
  assert.equal(primaryHttp2Environment("off").NGINX_HTTP2, "off");
  assert.equal(primaryHttp2Environment("on").NGINX_HTTP2, "on");

  const nginxValues = yamlBlock(
    readRepositoryFile("HelmChart/Public/oneuptime/values.yaml"),
    "nginx",
    0,
  );

  assert.match(nginxValues, /^ {2}http2: true$/m);

  const schema = JSON.parse(
    readRepositoryFile("HelmChart/Public/oneuptime/values.schema.json"),
  );

  // The nginx block is closed: an undeclared key fails `helm install`.
  assert.equal(schema.properties.nginx.additionalProperties, false);
  assert.deepEqual(schema.properties.nginx.properties.http2, {
    type: "boolean",
  });
});
