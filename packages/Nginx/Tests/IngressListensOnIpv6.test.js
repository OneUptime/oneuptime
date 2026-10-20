/**
 * The ingress listens on IPv6 as well as IPv4.
 *
 * The address the app counts a visitor by - for its sign-in limits, its other
 * per-address limits and its IP allowlists - is the address this ingress
 * accepted the connection from, which it appends to X-Forwarded-For. A visitor
 * who comes over IPv6 is counted by their own address only when their
 * connection reaches the ingress over IPv6: where the ingress's network has
 * IPv6 (Docker Compose with IPv6 turned on in docker-compose.override.yml, a
 * dual-stack Kubernetes cluster), Docker and Kubernetes hand it such a
 * connection on IPv6, and only an ingress listening there accepts it. So
 * unless NGINX_LISTEN_ADDRESS names the one address to listen on,
 * envsubst-on-templates.sh gives every listen on 7849 and 7850 an IPv6 twin,
 * whenever the kernel has IPv6.
 *
 * NGINX_LISTEN_OPTIONS are options of a listening socket, which nginx takes
 * once for each address and port. The template writes them on the
 * default_server listen of each port only; before, a second listen of the
 * same port carried them too, and nginx refused every value
 * ("duplicate listen options"), the documented dual-stack setting included.
 *
 * These tests run the real script (sh and envsubst), and a real nginx where
 * there is one at least as new as the shipped image's.
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
  getDirectives,
  getServerBlocks,
  ingressListenEnvironment,
  readNginxConf,
  readTemplate,
} = require("./NginxConfigParser");

const template = readTemplate();
const nginxConf = readNginxConf();
const SCRIPT_PATH = path.join(NGINX_DIRECTORY, "envsubst-on-templates.sh");

const INGRESS_PORTS = ["7849", "7850"];

const LISTEN_VARIABLES = [
  "NGINX_IPV6_LISTEN_DEFAULT_DIRECTIVE",
  "NGINX_IPV6_LISTEN_SSL_DEFAULT_DIRECTIVE",
  "NGINX_IPV6_LISTEN_DIRECTIVE",
  "PROVISION_SSL_LISTEN_DIRECTIVE",
  "PROVISION_SSL_IPV6_LISTEN_DIRECTIVE",
];

function isOnPath(binary, args = ["--version"]) {
  const probe = spawnSync(binary, args, { encoding: "utf8" });

  return !probe.error && probe.status === 0;
}

const hasShellAndEnvsubst =
  isOnPath("sh", ["-c", "exit 0"]) && isOnPath("envsubst");
const scriptSkipReason = hasShellAndEnvsubst
  ? false
  : "sh or envsubst not on PATH";

/*
 * `nginx -t` and live runs need the shipped image's nginx or newer: the
 * config uses `http2 on;`, which nginx before 1.25.1 refuses.
 */
const MINIMUM_NGINX_VERSION = [1, 25, 1];

function localNginxVersion() {
  const probe = spawnSync("nginx", ["-v"], { encoding: "utf8" });

  if (probe.error) {
    return null;
  }

  const match = /nginx\/(\d+)\.(\d+)\.(\d+)/.exec(
    `${probe.stderr || ""}${probe.stdout || ""}`,
  );

  return match ? match.slice(1, 4).map(Number) : null;
}

const nginxSkipReason = (() => {
  if (scriptSkipReason) {
    return scriptSkipReason;
  }

  const version = localNginxVersion();

  if (!version) {
    return "nginx binary not on PATH";
  }

  const decidingIndex = MINIMUM_NGINX_VERSION.findIndex((floor, index) => {
    return version[index] !== floor;
  });

  const tooOld =
    decidingIndex !== -1 &&
    version[decidingIndex] < MINIMUM_NGINX_VERSION[decidingIndex];

  return tooOld
    ? `nginx ${version.join(".")} predates ${MINIMUM_NGINX_VERSION.join(".")}, which the shipped config requires`
    : false;
})();

/** Whether this machine can listen on the IPv6 loopback address. */
function canListenOnIpv6Loopback() {
  return new Promise((resolve) => {
    const probe = net.createServer();

    probe.once("error", () => {
      resolve(false);
    });
    probe.listen(0, "::1", () => {
      probe.close(() => {
        resolve(true);
      });
    });
  });
}

/** The listen directives of a config, whitespace-normalised. */
function listensOf(source) {
  return getDirectives(source, "listen");
}

/** What a listen directive says: its address, its port and its flags. */
function parseListen(directive) {
  const words = directive.replace(/;$/, "").trim().split(/\s+/).slice(1);
  const target = words[0];
  const portMatch = /(?:^|:)(\d+)$/.exec(target);

  assert.ok(portMatch, `cannot read the port of "${directive}"`);

  const port = portMatch[1];
  const address = target.slice(0, target.length - port.length);

  return {
    directive,
    address: address.replace(/:$/, ""),
    port,
    isIpv6: address.startsWith("["),
    ssl: words.includes("ssl"),
    defaultServer: words.includes("default_server"),
    options: words.slice(1).filter((word) => {
      return word !== "ssl" && word !== "default_server";
    }),
  };
}

/**
 * Run the real envsubst-on-templates.sh over `templateText`, the way the
 * container runs it, and return what it wrote.
 */
function runScript(templateText, environment) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-listen-"));

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

    return fs.readFileSync(path.join(outputDirectory, "default.conf"), "utf8");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

/** A file the script can take as the kernel's IPv6 interface list, or not. */
function ipv6SupportFile(present) {
  if (!present) {
    return path.join(os.tmpdir(), `oneuptime-no-ipv6-${process.pid}-absent`);
  }

  const file = path.join(os.tmpdir(), `oneuptime-if-inet6-${process.pid}`);

  fs.writeFileSync(
    file,
    "00000000000000000000000000000001 01 80 10 80       lo\n",
  );

  return file;
}

// The script's exports, read back through a template that prints them.
function exportedListenDirectives(environment) {
  const probeTemplate = LISTEN_VARIABLES.map((name) => {
    return `${name}=\${${name}}`;
  }).join("\n");

  const rendered = runScript(`${probeTemplate}\n`, environment);
  const exported = {};

  for (const line of rendered.split("\n")) {
    const separator = line.indexOf("=");

    if (separator > 0) {
      exported[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }

  return exported;
}

/** The container environment of a stock install, minus the listen settings. */
function containerEnvironment(overrides = {}) {
  return {
    APP_PORT: "3002",
    HOME_PORT: "1444",
    HOST: "oneuptime.example.com",
    BILLING_ENABLED: "false",
    NGINX_RESOLVER: "127.0.0.11",
    SERVER_APP_HOSTNAME: "app",
    SERVER_HOME_HOSTNAME: "home",
    NGINX_LISTEN_ADDRESS: "",
    NGINX_LISTEN_OPTIONS: "",
    ...overrides,
  };
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

function makePrefix() {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-nginx-v6-"));

  // The workers may run as another user than the one that made the directory.
  fs.chmodSync(prefix, 0o755);
  fs.mkdirSync(path.join(prefix, "conf.d"));
  fs.mkdirSync(path.join(prefix, "logs"));
  fs.writeFileSync(path.join(prefix, "nginx.conf"), mainConfIn(prefix));

  return prefix;
}

test("every listen on the ingress ports in the template is followed by its IPv6 twin", () => {
  const lines = template.split("\n");
  const twins = [
    [
      /^\s*listen \$\{NGINX_LISTEN_ADDRESS\}7849 default_server \$\{NGINX_LISTEN_OPTIONS\};/,
      "${NGINX_IPV6_LISTEN_DEFAULT_DIRECTIVE}",
    ],
    [
      /^\s*listen \$\{NGINX_LISTEN_ADDRESS\}7850 ssl default_server \$\{NGINX_LISTEN_OPTIONS\};/,
      "${NGINX_IPV6_LISTEN_SSL_DEFAULT_DIRECTIVE}",
    ],
    [
      /^\s*listen \$\{NGINX_LISTEN_ADDRESS\}7849;/,
      "${NGINX_IPV6_LISTEN_DIRECTIVE}",
    ],
    [
      /^\$\{PROVISION_SSL_LISTEN_DIRECTIVE\}$/,
      "${PROVISION_SSL_IPV6_LISTEN_DIRECTIVE}",
    ],
  ];

  for (const [listenLine, twin] of twins) {
    const indexes = lines
      .map((line, index) => {
        return listenLine.test(line) ? index : -1;
      })
      .filter((index) => {
        return index !== -1;
      });

    assert.equal(indexes.length, 1, `${listenLine} should appear once`);
    assert.equal(
      lines[indexes[0] + 1],
      twin,
      `${lines[indexes[0]].trim()} is not followed by ${twin}`,
    );
  }

  // And nothing else listens on an ingress port behind the script's back.
  const listenLines = lines.filter((line) => {
    return /^\s*listen\s/.test(line) || /^\$\{\w*LISTEN\w*\}$/.test(line);
  });

  assert.equal(listenLines.length, 8, listenLines.join("\n"));
});

test("NGINX_LISTEN_OPTIONS is written on the default_server listen of each port, and nowhere else", () => {
  const optionLines = template.split("\n").filter((line) => {
    return line.includes("${NGINX_LISTEN_OPTIONS}");
  });

  assert.equal(optionLines.length, 2);

  for (const line of optionLines) {
    assert.match(line, /\bdefault_server\b/);
  }

  assert.deepEqual(
    optionLines.map((line) => {
      return /\}(\d+)\b/.exec(line)[1];
    }),
    INGRESS_PORTS,
  );

  // The primary's listen on 7850, which PROVISION_SSL adds, takes none.
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");
  const provisionListen =
    /export PROVISION_SSL_LISTEN_DIRECTIVE="([^"]*)"/.exec(script);

  assert.ok(provisionListen, "the script no longer exports the 7850 listen");
  assert.equal(
    provisionListen[1],
    "    listen ${NGINX_LISTEN_ADDRESS}7850 ssl;",
  );

  // Its IPv6 twin is the one the twins above come with, or nothing.
  const provisionTwin =
    /export PROVISION_SSL_IPV6_LISTEN_DIRECTIVE="([^"]*)"/.exec(script);

  assert.ok(provisionTwin, "the script no longer exports the 7850 twin");
  assert.equal(provisionTwin[1], "${NGINX_IPV6_LISTEN_SSL_DIRECTIVE}");
  assert.deepEqual(
    [
      ...script.matchAll(/^\s*NGINX_IPV6_LISTEN_SSL_DIRECTIVE="([^"]*)"$/gm),
    ].map((match) => {
      return match[1];
    }),
    ["    listen [::]:7850 ssl;", ""],
  );
});

test(
  "the script gives every listen an IPv6 twin when the kernel has IPv6 and no listen address is set",
  { skip: scriptSkipReason },
  () => {
    const exported = exportedListenDirectives(
      containerEnvironment({
        NGINX_IPV6_SUPPORT_FILE: ipv6SupportFile(true),
      }),
    );

    assert.deepEqual(exported, ingressListenEnvironment({ listenAddress: "" }));
    assert.deepEqual(exported, {
      NGINX_IPV6_LISTEN_DEFAULT_DIRECTIVE:
        "    listen [::]:7849 default_server;",
      NGINX_IPV6_LISTEN_SSL_DEFAULT_DIRECTIVE:
        "    listen [::]:7850 ssl default_server;",
      NGINX_IPV6_LISTEN_DIRECTIVE: "    listen [::]:7849;",
      PROVISION_SSL_LISTEN_DIRECTIVE: "",
      PROVISION_SSL_IPV6_LISTEN_DIRECTIVE: "",
    });
  },
);

test(
  "a kernel without IPv6 gets no IPv6 listen at all",
  { skip: scriptSkipReason },
  () => {
    const exported = exportedListenDirectives(
      containerEnvironment({
        NGINX_IPV6_SUPPORT_FILE: ipv6SupportFile(false),
      }),
    );

    assert.deepEqual(
      exported,
      ingressListenEnvironment({ listenAddress: "", ipv6: false }),
    );

    for (const name of LISTEN_VARIABLES) {
      assert.equal(exported[name], "", name);
    }
  },
);

test(
  "a listen address the operator names is the only one listened on",
  { skip: scriptSkipReason },
  () => {
    for (const listenAddress of ["127.0.0.1:", "0.0.0.0:", "[::]:", "[::1]:"]) {
      const exported = exportedListenDirectives(
        containerEnvironment({
          NGINX_LISTEN_ADDRESS: listenAddress,
          NGINX_IPV6_SUPPORT_FILE: ipv6SupportFile(true),
        }),
      );

      assert.deepEqual(
        exported,
        ingressListenEnvironment({ listenAddress }),
        listenAddress,
      );

      for (const name of LISTEN_VARIABLES) {
        assert.equal(exported[name], "", `${listenAddress} ${name}`);
      }
    }
  },
);

test(
  "without NGINX_IPV6_SUPPORT_FILE the script asks the kernel itself",
  { skip: scriptSkipReason },
  () => {
    const exported = exportedListenDirectives(containerEnvironment());

    assert.deepEqual(
      exported,
      ingressListenEnvironment({
        listenAddress: "",
        ipv6: fs.existsSync("/proc/net/if_inet6"),
      }),
    );
  },
);

/*
 * With PROVISION_SSL the script writes a placeholder certificate where the
 * ingress image keeps it (/etc/nginx/certs/ServerCerts), so this runs only
 * inside that image, when RUN_NGINX_IMAGE_TESTS=1 says so.
 */
const provisionSslSkipReason = (() => {
  if (scriptSkipReason) {
    return scriptSkipReason;
  }

  if (process.env.RUN_NGINX_IMAGE_TESTS !== "1") {
    return "writes to /etc/nginx/certs/ServerCerts: set RUN_NGINX_IMAGE_TESTS=1 inside the ingress image";
  }

  return isOnPath("openssl", ["version"]) ? false : "openssl not on PATH";
})();

test(
  "with PROVISION_SSL the primary's 7850 listen has its IPv6 twin and no socket options",
  { skip: provisionSslSkipReason },
  () => {
    for (const [listenAddress, ipv6] of [
      ["", true],
      ["", false],
      ["127.0.0.1:", true],
    ]) {
      const exported = exportedListenDirectives(
        containerEnvironment({
          NGINX_LISTEN_ADDRESS: listenAddress,
          NGINX_LISTEN_OPTIONS: "backlog=1024",
          NGINX_IPV6_SUPPORT_FILE: ipv6SupportFile(ipv6),
          PROVISION_SSL: "true",
          PRIMARY_DOMAIN: "oneuptime.example.com",
        }),
      );

      assert.deepEqual(
        exported,
        ingressListenEnvironment({ listenAddress, ipv6, provisionSsl: true }),
        `${listenAddress} ipv6=${ipv6}`,
      );
    }
  },
);

/*
 * The rendered default config, through the real script: every server that
 * listens on an ingress port over IPv4 listens there over IPv6 as well, with
 * the same ssl and default_server flags, and a socket's options appear once.
 */
test(
  "in the rendered config every IPv4 listen has an IPv6 twin with the same flags",
  { skip: scriptSkipReason },
  () => {
    const rendered = runScript(
      template,
      containerEnvironment({
        NGINX_LISTEN_OPTIONS: "backlog=1024",
        NGINX_IPV6_SUPPORT_FILE: ipv6SupportFile(true),
      }),
    );

    const servers = getServerBlocks(rendered);

    assert.equal(servers.length, 3);

    for (const server of servers) {
      const listens = listensOf(server.body).map(parseListen);
      const ipv4 = listens.filter((listen) => {
        return !listen.isIpv6;
      });
      const ipv6 = listens.filter((listen) => {
        return listen.isIpv6;
      });

      assert.ok(
        ipv4.length > 0,
        listens
          .map((listen) => {
            return listen.directive;
          })
          .join(", "),
      );
      assert.equal(ipv6.length, ipv4.length, server.header);

      for (const listen of ipv4) {
        const twin = ipv6.find((candidate) => {
          return (
            candidate.port === listen.port &&
            candidate.ssl === listen.ssl &&
            candidate.defaultServer === listen.defaultServer
          );
        });

        assert.ok(twin, `${listen.directive} has no IPv6 twin`);
        assert.equal(twin.address, "[::]");
        assert.deepEqual(twin.options, [], twin.directive);
      }
    }

    // Each socket's options once: on 0.0.0.0:7849 and 0.0.0.0:7850.
    const withOptions = listensOf(rendered)
      .map(parseListen)
      .filter((listen) => {
        return listen.options.length > 0;
      });

    assert.deepEqual(
      withOptions.map((listen) => {
        return [listen.port, listen.defaultServer, listen.options];
      }),
      [
        ["7849", true, ["backlog=1024"]],
        ["7850", true, ["backlog=1024"]],
      ],
    );

    // Nothing is left for nginx to read as a variable of its own but the
    // ingest switch, which nginx.conf declares.
    const leftovers = [...rendered.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)]
      .map((match) => {
        return match[1];
      })
      .filter((name, index, all) => {
        return all.indexOf(name) === index;
      });

    assert.deepEqual(leftovers, ["NGINX_INGEST_ACCESS_LOG"]);
  },
);

/*
 * Every listen setting an operator may set renders a config nginx accepts.
 * Before, any NGINX_LISTEN_OPTIONS value - the documented dual-stack
 * `ipv6only=off` among them - made nginx refuse the config.
 */
const LISTEN_SETTINGS = [
  { address: "", options: "", ipv6: true },
  { address: "", options: "", ipv6: false },
  { address: "", options: "backlog=1024", ipv6: true },
  // Options that would clash on a second socket of the port stay off the twin.
  { address: "", options: "ipv6only=off", ipv6: true },
  { address: "", options: "reuseport backlog=4096", ipv6: true },
  { address: "[::]:", options: "ipv6only=off", ipv6: true },
  { address: "[::]:", options: "", ipv6: true },
  { address: "127.0.0.1:", options: "", ipv6: true },
  { address: "0.0.0.0:", options: "", ipv6: true },
];

for (const setting of LISTEN_SETTINGS) {
  test(
    `nginx -t accepts NGINX_LISTEN_ADDRESS="${setting.address}" NGINX_LISTEN_OPTIONS="${setting.options}" (IPv6 ${setting.ipv6 ? "on" : "off"})`,
    { skip: nginxSkipReason },
    () => {
      const prefix = makePrefix();

      try {
        fs.writeFileSync(
          path.join(prefix, "conf.d", "default.conf"),
          runScript(
            template,
            containerEnvironment({
              NGINX_LISTEN_ADDRESS: setting.address,
              NGINX_LISTEN_OPTIONS: setting.options,
              NGINX_IPV6_SUPPORT_FILE: ipv6SupportFile(setting.ipv6),
            }),
          ),
        );

        const result = spawnSync(
          "nginx",
          ["-t", "-p", prefix, "-c", path.join(prefix, "nginx.conf")],
          { encoding: "utf8" },
        );

        assert.equal(result.status, 0, result.stderr);
      } finally {
        fs.rmSync(prefix, { recursive: true, force: true });
      }
    },
  );
}

/*
 * The same with PROVISION_SSL, where the primary listens on 7850 as well:
 * its own listen and its twin carry no socket options, so every setting
 * still gives each socket its options once. Inside the ingress image only
 * (provisionSslSkipReason), as the script writes the placeholder
 * certificate there.
 */
test(
  "nginx -t accepts the PROVISION_SSL config for every listen setting operators may set",
  { skip: provisionSslSkipReason || nginxSkipReason },
  () => {
    for (const setting of LISTEN_SETTINGS) {
      const prefix = makePrefix();

      try {
        const rendered = runScript(
          template,
          containerEnvironment({
            NGINX_LISTEN_ADDRESS: setting.address,
            NGINX_LISTEN_OPTIONS: setting.options,
            NGINX_IPV6_SUPPORT_FILE: ipv6SupportFile(setting.ipv6),
            PROVISION_SSL: "true",
            PRIMARY_DOMAIN: "oneuptime.example.com",
          }),
        );

        // The primary listens on 7850 too, which it does only with PROVISION_SSL.
        assert.ok(
          listensOf(rendered).filter((listen) => {
            return /7850 ssl;$/.test(listen);
          }).length >= 1,
          `${setting.address} ${setting.options}: no primary 7850 listen`,
        );

        fs.writeFileSync(path.join(prefix, "conf.d", "default.conf"), rendered);

        const result = spawnSync(
          "nginx",
          ["-t", "-p", prefix, "-c", path.join(prefix, "nginx.conf")],
          { encoding: "utf8" },
        );

        assert.equal(
          result.status,
          0,
          `NGINX_LISTEN_ADDRESS="${setting.address}" NGINX_LISTEN_OPTIONS="${setting.options}": ${result.stderr}`,
        );
      } finally {
        fs.rmSync(prefix, { recursive: true, force: true });
      }
    }
  },
);

/** A stand-in app that answers with the addresses the ingress handed it. */
function startApp() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        forwardedFor: request.headers["x-forwarded-for"] || null,
        realIp: request.headers["x-real-ip"] || null,
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

function freePort(host) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once("error", reject);
    probe.listen(0, host, () => {
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

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

function getThrough(host, port, hostHeader) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host,
        port,
        path: "/api/status",
        method: "GET",
        headers: {
          Host: hostHeader,
          // Whatever a caller writes in front stays in front.
          "X-Forwarded-For": "203.0.113.99",
        },
        agent: false,
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode, body });
        });
      },
    );

    request.setTimeout(10000, () => {
      request.destroy(new Error("request timed out"));
    });
    request.once("error", reject);
    request.end();
  });
}

test(
  "a real nginx takes a visitor's IPv6 connection on the IPv6 twin and hands the app the visitor's IPv6 address",
  { skip: nginxSkipReason, timeout: 60000 },
  async (context) => {
    if (!(await canListenOnIpv6Loopback())) {
      context.skip("no IPv6 loopback address here");
      return;
    }

    const app = await startApp();
    const prefix = makePrefix();
    let nginx = null;
    let output = "";

    try {
      const httpPort = await freePort("127.0.0.1");
      const tlsPort = await freePort("127.0.0.1");

      // Rendered by the real script, then moved onto free loopback ports.
      const rendered = runScript(
        template,
        containerEnvironment({
          SERVER_APP_HOSTNAME: "127.0.0.1",
          APP_PORT: String(app.port),
          SERVER_HOME_HOSTNAME: "127.0.0.1",
          HOME_PORT: String(app.port),
          NGINX_RESOLVER: "127.0.0.1",
          NGINX_IPV6_SUPPORT_FILE: ipv6SupportFile(true),
        }),
      )
        .replace(/^(\s*listen\s+)7849\b/gm, `$1127.0.0.1:${httpPort}`)
        .replace(/^(\s*listen\s+)\[::\]:7849\b/gm, `$1[::1]:${httpPort}`)
        .replace(/^(\s*listen\s+)7850\b/gm, `$1127.0.0.1:${tlsPort}`)
        .replace(/^(\s*listen\s+)\[::\]:7850\b/gm, `$1[::1]:${tlsPort}`);

      assert.equal(
        listensOf(rendered).filter((listen) => {
          return /\b78(49|50)\b/.test(listen);
        }).length,
        0,
        "a listener was left on the ingress's real port",
      );

      fs.writeFileSync(path.join(prefix, "conf.d", "default.conf"), rendered);

      nginx = spawn(
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

      const deadline = Date.now() + 15000;
      let listening = false;

      while (Date.now() < deadline && nginx.exitCode === null) {
        if (
          (await canConnect("127.0.0.1", httpPort)) &&
          (await canConnect("::1", httpPort))
        ) {
          listening = true;
          break;
        }

        await wait(50);
      }

      assert.ok(listening, `nginx did not start: ${output}`);

      // The primary server (the installation's own HOST) and the default one.
      for (const hostHeader of [
        "oneuptime.example.com",
        "status.example.org",
      ]) {
        const overIpv6 = await getThrough("::1", httpPort, hostHeader);

        assert.equal(overIpv6.status, 200, overIpv6.body);
        assert.deepEqual(JSON.parse(overIpv6.body), {
          forwardedFor: "203.0.113.99, ::1",
          realIp: "::1",
        });

        const overIpv4 = await getThrough("127.0.0.1", httpPort, hostHeader);

        assert.equal(overIpv4.status, 200, overIpv4.body);
        assert.deepEqual(JSON.parse(overIpv4.body), {
          forwardedFor: "203.0.113.99, 127.0.0.1",
          realIp: "127.0.0.1",
        });
      }
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

      await app.close();
      fs.rmSync(prefix, { recursive: true, force: true });
    }
  },
);
