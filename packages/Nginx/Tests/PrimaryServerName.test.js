/**
 * The primary server answers for HOST even when HOST carries a port.
 *
 * HOST is the address people open OneUptime at, so it carries a port when they
 * reach OneUptime on one (HOST=oneuptime.example.com:8080): the app builds its
 * links from HOST, port and all, and drops the port when it tells its own
 * address from a status page's custom domain (App/FeatureSet/Frontend). nginx
 * drops the port too: it compares a server name with the Host a request names,
 * minus the port. So the primary server is named by HOST without its port,
 * which envsubst-on-templates.sh exports as HOST_WITHOUT_PORT.
 *
 * Named by HOST itself, it never matched a HOST with a port, and every request
 * people sent to that HOST fell to the status-page default server, which
 * forwards /identity as it is instead of as /api/identity: the sign-up page
 * loaded, and signing up or in answered "Page not found - /identity/signup".
 *
 * An IPv6 address with a port is written in brackets ("[2001:db8::1]:8080"),
 * and nginx keeps them when it reads such a Host, so the server is named
 * "[2001:db8::1]". Cut at its first ":", it was named "[2001" (#7889), and
 * so was run.sh's PRIMARY_DOMAIN, which names the primary's certificate.
 *
 * These tests run the real scripts (sh and envsubst, and run.sh's own lines
 * with bash), and a real nginx where there is one at least as new as the
 * shipped image's.
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
  primaryServerNameEnvironment,
  readNginxConf,
  readTemplate,
} = require("./NginxConfigParser");

const template = readTemplate();
const nginxConf = readNginxConf();
const SCRIPT_PATH = path.join(NGINX_DIRECTORY, "envsubst-on-templates.sh");
const RUN_SCRIPT_PATH = path.join(NGINX_DIRECTORY, "run.sh");

/*
 * HOST as people set it, and the name of the primary server it gives: HOST
 * without its port. run.sh's PRIMARY_DOMAIN is the same, in lower case.
 */
const HOSTS = [
  ["oneuptime.example.com", "oneuptime.example.com"],
  ["oneuptime.example.com:8080", "oneuptime.example.com"],
  ["10.0.0.5", "10.0.0.5"],
  ["10.0.0.5:8080", "10.0.0.5"],
  ["localhost", "localhost"],
  ["localhost:3000", "localhost"],
  // An IPv6 address keeps its brackets, with a port and without one.
  ["[::1]:8080", "[::1]"],
  ["[::1]", "[::1]"],
  ["[2001:DB8::1]:8443", "[2001:DB8::1]"],
  ["[2001:db8::1]", "[2001:db8::1]"],
  // Without brackets an IPv6 address has no port: all its colons are its own.
  ["2001:db8::1", "2001:db8::1"],
  ["", ""],
];

function isOnPath(binary, args = ["--version"]) {
  const probe = spawnSync(binary, args, { encoding: "utf8" });

  return !probe.error && probe.status === 0;
}

const scriptSkipReason =
  isOnPath("sh", ["-c", "exit 0"]) && isOnPath("envsubst")
    ? false
    : "sh or envsubst not on PATH";

// run.sh is a bash script, as the image runs it.
const bashSkipReason = isOnPath("bash", ["-c", "exit 0"])
  ? false
  : "bash not on PATH";

/*
 * Live runs need the shipped image's nginx or newer: the config uses
 * `http2 on;`, which nginx before 1.25.1 refuses.
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
  const decidingIndex = MINIMUM_NGINX_VERSION.findIndex((floor, index) => {
    return version[index] !== floor;
  });

  return decidingIndex !== -1 &&
    version[decidingIndex] < MINIMUM_NGINX_VERSION[decidingIndex]
    ? `nginx ${version.join(".")} predates ${MINIMUM_NGINX_VERSION.join(".")}, which the shipped config requires`
    : false;
})();

/**
 * Run the real envsubst-on-templates.sh over `templateText`, the way the
 * container runs it, and return what it wrote.
 */
function runScript(templateText, environment) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-name-"));

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

/**
 * The container environment of a stock install, without IPv6 listens: the
 * live run below listens on IPv4 loopback only.
 */
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
    NGINX_IPV6_SUPPORT_FILE: path.join(
      os.tmpdir(),
      `oneuptime-no-ipv6-${process.pid}-absent`,
    ),
    ...overrides,
  };
}

// The script's HOST_WITHOUT_PORT, read back through a template that prints it.
function exportedServerName(environment) {
  return runScript(
    "HOST_WITHOUT_PORT=${HOST_WITHOUT_PORT}\n",
    containerEnvironment(environment),
  ).trimEnd();
}

/** The primary server's server_name, as rendered from `source`. */
function primaryServerName(source) {
  const names = getServerBlocks(source)
    .flatMap((block) => {
      return getDirectives(block.body, "server_name");
    })
    .filter((directive) => {
      return directive.startsWith("server_name localhost ingress");
    });

  assert.equal(names.length, 1, names.join("\n"));

  return names[0];
}

test("the primary server is named by HOST without its port, and no server by HOST itself", () => {
  assert.equal(
    primaryServerName(template),
    "server_name localhost ingress ${HOST_WITHOUT_PORT};",
  );

  // nginx never compares a server name with a port, so none may keep HOST's.
  for (const directive of getDirectives(template, "server_name")) {
    assert.ok(!directive.includes("${HOST}"), directive);
  }
});

test(
  "the script takes the port off HOST, and nothing off a HOST without one",
  { skip: scriptSkipReason },
  () => {
    for (const [host, serverName] of HOSTS) {
      assert.equal(
        exportedServerName({ HOST: host }),
        `HOST_WITHOUT_PORT=${serverName}`,
        `HOST="${host}"`,
      );
      assert.deepEqual(primaryServerNameEnvironment(host), {
        HOST_WITHOUT_PORT: serverName,
      });
    }
  },
);

/*
 * run.sh's PRIMARY_DOMAIN for `host`: the lines of run.sh that set it, run
 * with bash on their own, as the rest of run.sh starts nginx and the sidecar.
 */
function primaryDomainOf(host) {
  const source = fs.readFileSync(RUN_SCRIPT_PATH, "utf8");
  const start = source.indexOf('\nPRIMARY_DOMAIN=""\n');
  const end = source.indexOf("\nfi\n", start);

  assert.ok(
    start !== -1 && end !== -1,
    'run.sh sets PRIMARY_DOMAIN="" and then sets it from HOST in an if block',
  );

  const result = spawnSync(
    "bash",
    [
      "-c",
      `${source.slice(start + 1, end + "\nfi\n".length)}printf '%s' "$PRIMARY_DOMAIN"`,
    ],
    { encoding: "utf8", env: { PATH: process.env.PATH, HOST: host } },
  );

  assert.equal(result.status, 0, result.stderr);

  return result.stdout;
}

/*
 * PRIMARY_DOMAIN names the primary's certificate files, which the sidecar
 * writes under the name the app orders the certificate for (CoreSSL): HOST
 * without its port, in lower case. It takes the port off as the server name
 * does: cut at its first ":", "[2001:DB8::1]:8443" named it "[2001".
 */
test(
  "run.sh's PRIMARY_DOMAIN is HOST without its port, in lower case, as the server name takes it off",
  { skip: bashSkipReason },
  () => {
    for (const [host, serverName] of HOSTS) {
      assert.equal(
        primaryDomainOf(host),
        serverName.toLowerCase(),
        `HOST="${host}"`,
      );
    }
  },
);

/*
 * The Node side of the ingress renders the template again when the primary's
 * certificate changes (NginxConfigurator.ensurePrimarySslConfigured), with
 * PRIMARY_DOMAIN set to the certificate's name. The server name still comes
 * from HOST, so both renders name the primary server alike.
 */
test(
  "the server name comes from HOST, whatever PRIMARY_DOMAIN says",
  { skip: scriptSkipReason },
  () => {
    assert.equal(
      exportedServerName({
        HOST: "oneuptime.example.com:8080",
        PRIMARY_DOMAIN: "certificate.example.com",
      }),
      "HOST_WITHOUT_PORT=oneuptime.example.com",
    );

    assert.equal(
      primaryServerName(
        runScript(
          template,
          containerEnvironment({ HOST: "oneuptime.example.com:8080" }),
        ),
      ),
      "server_name localhost ingress oneuptime.example.com;",
    );
  },
);

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

/** A stand-in app that answers with the path the ingress handed it. */
function startApp() {
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ path: request.url }));
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

// The sign-up request the Accounts page sends, under `hostHeader`.
function signUpThrough(port, hostHeader) {
  return new Promise((resolve, reject) => {
    const body = "{}";
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/identity/signup",
        method: "POST",
        headers: {
          Host: hostHeader,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        agent: false,
      },
      (response) => {
        let text = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode, body: text });
        });
      },
    );

    request.setTimeout(10000, () => {
      request.destroy(new Error("request timed out"));
    });
    request.once("error", reject);
    request.end(body);
  });
}

/**
 * Render the template with the real script under `host`, run a real nginx on
 * it, and send the sign-up request under each Host header of `cases`: the
 * app must receive it at the path that case names (/api/identity/signup from
 * the primary server, /identity/signup from the status pages').
 */
async function expectSignUpPaths(host, cases) {
  const app = await startApp();
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-name-"));
  let nginx = null;
  let output = "";

  try {
    // The workers may run as another user than the one that made it.
    fs.chmodSync(prefix, 0o755);
    fs.mkdirSync(path.join(prefix, "conf.d"));
    fs.mkdirSync(path.join(prefix, "logs"));
    fs.writeFileSync(path.join(prefix, "nginx.conf"), mainConfIn(prefix));

    const httpPort = await freePort();
    const tlsPort = await freePort();

    // Rendered by the real script, then moved onto free loopback ports.
    const rendered = runScript(
      template,
      containerEnvironment({
        HOST: host,
        SERVER_APP_HOSTNAME: "127.0.0.1",
        APP_PORT: String(app.port),
        SERVER_HOME_HOSTNAME: "127.0.0.1",
        HOME_PORT: String(app.port),
        NGINX_RESOLVER: "127.0.0.1",
      }),
    )
      .replace(/^(\s*listen\s+)7849\b/gm, `$1127.0.0.1:${httpPort}`)
      .replace(/^(\s*listen\s+)7850\b/gm, `$1127.0.0.1:${tlsPort}`)
      // The template's own access_log lines name the image's log folder too.
      .replace(/\/var\/log\/nginx\//g, `${prefix}/logs/`);

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
      if (await canConnect(httpPort)) {
        listening = true;
        break;
      }

      await wait(50);
    }

    assert.ok(listening, `nginx did not start: ${output}`);

    for (const [hostHeader, appPath] of cases) {
      const response = await signUpThrough(httpPort, hostHeader);

      assert.equal(response.status, 200, `${hostHeader}: ${response.body}`);
      assert.deepEqual(
        JSON.parse(response.body),
        { path: appPath },
        `Host: ${hostHeader}`,
      );
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
}

test(
  "a real nginx serves sign-in on the primary server under a HOST with its port, and leaves other names to the status pages",
  { skip: nginxSkipReason, timeout: 60000 },
  async () => {
    await expectSignUpPaths("oneuptime.example.com:8080", [
      // HOST as people open it, port and all: the primary server.
      ["oneuptime.example.com:8080", "/api/identity/signup"],
      ["oneuptime.example.com", "/api/identity/signup"],
      ["localhost:8080", "/api/identity/signup"],
      // Any other name is a status page's custom domain, as before.
      ["status.example.org", "/identity/signup"],
      ["10.0.0.5:8080", "/identity/signup"],
    ]);
  },
);

/*
 * A browser names an IPv6 host in brackets, with its port, and nginx
 * compares the bracketed address with the server names. Named "[", the
 * primary answered none of these requests (#7889).
 */
test(
  "a real nginx serves sign-in on the primary server under an IPv6 HOST in brackets, and leaves other addresses to the status pages",
  { skip: nginxSkipReason, timeout: 60000 },
  async () => {
    await expectSignUpPaths("[::1]:8080", [
      ["[::1]:8080", "/api/identity/signup"],
      ["[::1]", "/api/identity/signup"],
      ["localhost:8080", "/api/identity/signup"],
      ["[2001:db8::5]:8080", "/identity/signup"],
      ["oneuptime.example.com", "/identity/signup"],
    ]);
  },
);

/*
 * With PROVISION_SSL the script points the primary at the certificate named
 * by PRIMARY_DOMAIN, and makes a temporary self-signed one there until the
 * app writes the real one. It writes where the ingress image keeps them
 * (/etc/nginx/certs/ServerCerts), so this runs only inside that image, when
 * RUN_NGINX_IMAGE_TESTS=1 says so.
 */
const provisionSslSkipReason = (() => {
  if (nginxSkipReason || bashSkipReason) {
    return nginxSkipReason || bashSkipReason;
  }

  if (process.env.RUN_NGINX_IMAGE_TESTS !== "1") {
    return "writes to /etc/nginx/certs/ServerCerts: set RUN_NGINX_IMAGE_TESTS=1 inside the ingress image";
  }

  return isOnPath("openssl", ["version"]) ? false : "openssl not on PATH";
})();

test(
  "with PROVISION_SSL an IPv6 HOST's certificate is named by its address in brackets, and nginx -t accepts the config",
  { skip: provisionSslSkipReason },
  () => {
    const host = "[2001:DB8::1]:8443";
    const certificate = "/etc/nginx/certs/ServerCerts/[2001:db8::1].crt";
    const key = "/etc/nginx/certs/ServerCerts/[2001:db8::1].key";
    const madeHere = !fs.existsSync(certificate) && !fs.existsSync(key);
    const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-name-"));

    try {
      const rendered = runScript(
        template,
        containerEnvironment({
          HOST: host,
          PROVISION_SSL: "true",
          PRIMARY_DOMAIN: primaryDomainOf(host),
        }),
      ).replace(/\/var\/log\/nginx\//g, `${prefix}/logs/`);

      assert.ok(
        rendered.includes(`ssl_certificate ${certificate};`),
        "the primary's certificate is named by the address in brackets",
      );
      assert.ok(fs.existsSync(certificate), `${certificate} was not made`);
      assert.ok(fs.existsSync(key), `${key} was not made`);

      fs.mkdirSync(path.join(prefix, "conf.d"));
      fs.mkdirSync(path.join(prefix, "logs"));
      fs.writeFileSync(path.join(prefix, "nginx.conf"), mainConfIn(prefix));
      fs.writeFileSync(path.join(prefix, "conf.d", "default.conf"), rendered);

      const result = spawnSync(
        "nginx",
        ["-t", "-p", prefix, "-c", path.join(prefix, "nginx.conf")],
        { encoding: "utf8" },
      );

      assert.equal(result.status, 0, result.stderr);
    } finally {
      if (madeHere) {
        fs.rmSync(certificate, { force: true });
        fs.rmSync(key, { force: true });
      }

      fs.rmSync(prefix, { recursive: true, force: true });
    }
  },
);
