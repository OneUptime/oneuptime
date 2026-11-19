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
 * The name lists localhost and ingress before HOST's, and leaves HOST out
 * when it is one of them. Under the default HOST=localhost it read
 * "localhost ingress localhost", and nginx warned
 * 'conflicting server name "localhost" on 0.0.0.0:7849, ignored' for each of
 * the primary's listens, four warnings on every start (#8023).
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
  PRIMARY_SERVER_FIXED_NAMES,
  getDirectives,
  getServerBlocks,
  ingressListenEnvironment,
  primaryHttp2Environment,
  primaryServerNameEnvironment,
  readNginxConf,
  readTemplate,
} = require("./NginxConfigParser");

const template = readTemplate();
const nginxConf = readNginxConf();
const SCRIPT_PATH = path.join(NGINX_DIRECTORY, "envsubst-on-templates.sh");
const RUN_SCRIPT_PATH = path.join(NGINX_DIRECTORY, "run.sh");

/*
 * HOST as people set it; HOST without its port, which the script exports as
 * HOST_WITHOUT_PORT and run.sh's PRIMARY_DOMAIN is in lower case; and what the
 * primary server's name lists after localhost and ingress (HOST_SERVER_NAME):
 * HOST without its port, or nothing when that is localhost or ingress.
 */
const HOSTS = [
  ["oneuptime.example.com", "oneuptime.example.com", "oneuptime.example.com"],
  [
    "oneuptime.example.com:8080",
    "oneuptime.example.com",
    "oneuptime.example.com",
  ],
  ["10.0.0.5", "10.0.0.5", "10.0.0.5"],
  ["10.0.0.5:8080", "10.0.0.5", "10.0.0.5"],
  // localhost and ingress are named already: in any case, with a port or not.
  ["localhost", "localhost", ""],
  ["localhost:3000", "localhost", ""],
  ["LOCALHOST", "LOCALHOST", ""],
  ["LocalHost:3000", "LocalHost", ""],
  ["ingress", "ingress", ""],
  ["ingress:7849", "ingress", ""],
  ["Ingress", "Ingress", ""],
  // A name with one of them in it is a name of its own.
  ["localhost.localdomain", "localhost.localdomain", "localhost.localdomain"],
  ["oneuptime-ingress:8080", "oneuptime-ingress", "oneuptime-ingress"],
  ["ingress.example.com", "ingress.example.com", "ingress.example.com"],
  // An IPv6 address keeps its brackets, with a port and without one.
  ["[::1]:8080", "[::1]", "[::1]"],
  ["[::1]", "[::1]", "[::1]"],
  ["[2001:DB8::1]:8443", "[2001:DB8::1]", "[2001:DB8::1]"],
  ["[2001:db8::1]", "[2001:db8::1]", "[2001:db8::1]"],
  // Without brackets an IPv6 address has no port: all its colons are its own.
  ["2001:db8::1", "2001:db8::1", "2001:db8::1"],
  ["", "", ""],
];

/*
 * One HOST of each kind, for the tests that render the whole config: the
 * default, and localhost and ingress with a port; an IPv4 address; an IPv6
 * address in brackets and without; a real domain, with a port and without;
 * and none.
 */
const HOST_KINDS = [
  "localhost",
  "localhost:3000",
  "LOCALHOST",
  "ingress",
  "ingress:7849",
  "10.0.0.5",
  "10.0.0.5:8080",
  "[::1]:8080",
  "[2001:DB8::1]",
  "2001:db8::1",
  "oneuptime.example.com",
  "oneuptime.example.com:8080",
  "",
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

/*
 * The script's HOST_WITHOUT_PORT and HOST_SERVER_NAME, read back through a
 * template that prints them.
 */
function exportedServerNames(environment) {
  const printed = runScript(
    "HOST_WITHOUT_PORT=${HOST_WITHOUT_PORT}\nHOST_SERVER_NAME=${HOST_SERVER_NAME}\n",
    containerEnvironment(environment),
  );
  const match = /^HOST_WITHOUT_PORT=(.*)\nHOST_SERVER_NAME=(.*)\n$/.exec(
    printed,
  );

  assert.ok(match, printed);

  return { HOST_WITHOUT_PORT: match[1], HOST_SERVER_NAME: match[2] };
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

// The names a server_name directive lists, in its order.
function namesOf(directive) {
  return directive
    .replace(/^server_name\b/, "")
    .replace(/;$/, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/*
 * The names nginx files a rendered config's servers under, for each address
 * and port they listen on: in lower case, as nginx reads a server name, and
 * with "listen 7849" (a port alone) on every IPv4 address, as nginx reads it.
 * A name filed twice under one address and port draws the warning
 * 'conflicting server name "<name>" on <address>, ignored'.
 */
function serverNamesBySocket(source) {
  const sockets = new Map();

  for (const block of getServerBlocks(source)) {
    const names = getDirectives(block.body, "server_name")
      .flatMap(namesOf)
      .map((name) => {
        return name.toLowerCase();
      });

    for (const listen of getDirectives(block.body, "listen")) {
      // "listen [::]:7849 ssl default_server;" listens on "[::]:7849".
      const [address] = listen.replace(/^listen\s+/, "").split(/[\s;]/);
      const socket = /^\d+$/.test(address) ? `0.0.0.0:${address}` : address;

      sockets.set(socket, [...(sockets.get(socket) || []), ...names]);
    }
  }

  return sockets;
}

// Each name `names` lists more than once.
function namesListedTwice(names) {
  return names.filter((name, index) => {
    return names.indexOf(name) !== index;
  });
}

/*
 * The template rendered for `host` with envsubst, from the script's exports
 * as NginxConfigParser models them (the listens of `listens`, the primary's
 * names, HTTP/2 at its default). With PROVISION_SSL on, the script writes
 * the primary's certificate under /etc/nginx/certs, which only the image
 * allows, so the PROVISION_SSL listens are rendered from the model here.
 * IngressListensOnIpv6.test.js, PrimaryServerHttp2.test.js and the script
 * test below hold the model to the script.
 */
function renderModelled(host, listens, overrides = {}) {
  const environment = {
    ...containerEnvironment({ HOST: host }),
    BACKEND_APP_TARGET: "$backend_app",
    BACKEND_APP_GRPC_TARGET: "$backend_app_grpc",
    PROVISION_SSL_CERTIFICATE_DIRECTIVE: "",
    PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE: "",
    ...ingressListenEnvironment(listens),
    ...primaryServerNameEnvironment(host),
    ...primaryHttp2Environment(),
    ...overrides,
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

test("the primary server is named localhost, ingress and HOST without its port, and no server by HOST itself", () => {
  assert.equal(
    primaryServerName(template),
    "server_name localhost ingress ${HOST_SERVER_NAME};",
  );

  // localhost first: it is $server_name, the Host the primary hands the app.
  assert.deepEqual(
    namesOf(primaryServerName(template)).slice(0, -1),
    PRIMARY_SERVER_FIXED_NAMES,
  );

  // nginx never compares a server name with a port, so none may keep HOST's.
  for (const directive of getDirectives(template, "server_name")) {
    assert.ok(!directive.includes("${HOST}"), directive);
    assert.ok(!directive.includes("${HOST_WITHOUT_PORT}"), directive);
  }
});

test(
  "the script takes the port off HOST, and leaves it out of the name when the name lists it already",
  { skip: scriptSkipReason },
  () => {
    for (const [host, hostWithoutPort, hostServerName] of HOSTS) {
      const expected = {
        HOST_WITHOUT_PORT: hostWithoutPort,
        HOST_SERVER_NAME: hostServerName,
      };

      assert.deepEqual(
        exportedServerNames({ HOST: host }),
        expected,
        `HOST="${host}"`,
      );
      assert.deepEqual(
        primaryServerNameEnvironment(host),
        expected,
        `HOST="${host}"`,
      );
    }
  },
);

/*
 * An IPv6 HOST without brackets never works (#8022): a browser names the
 * address in brackets, which the primary server's name then never matches.
 * npm start and the Helm chart refuse it before anything starts; one that
 * came another way is said in the ingress's log, and the ingress starts as
 * it did, so the status pages it serves on custom domains keep working.
 */
function scriptLog(host) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-log-"));

  try {
    const templateDirectory = path.join(directory, "templates");
    const outputDirectory = path.join(directory, "out");

    fs.mkdirSync(templateDirectory);
    fs.mkdirSync(outputDirectory);
    fs.writeFileSync(
      path.join(templateDirectory, "default.conf.template"),
      "server_name localhost ingress ${HOST_SERVER_NAME};\n",
    );

    const result = spawnSync("sh", [SCRIPT_PATH], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NGINX_ENVSUBST_TEMPLATE_DIR: templateDirectory,
        NGINX_ENVSUBST_OUTPUT_DIR: outputDirectory,
        ...containerEnvironment({ HOST: host }),
      },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    return `${result.stdout}${result.stderr}`.split("\n").filter((line) => {
      return line.includes("WARNING");
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test(
  "the script says in its log that an IPv6 HOST without brackets cannot be opened, and starts",
  { skip: scriptSkipReason },
  () => {
    for (const host of ["2001:db8::1", "2001:db8::1:8080", "::1"]) {
      assert.deepEqual(
        scriptLog(host),
        [
          `envsubst-on-templates.sh: WARNING: HOST is ${host}, an IPv6 address without brackets, so no browser can open OneUptime at it. Set HOST=[${host}], with any port after the brackets, such as [2001:db8::1]:8080.`,
        ],
        `HOST="${host}"`,
      );
    }
  },
);

test(
  "the script says nothing of a HOST that is a name, an IPv4 address or an IPv6 address in brackets",
  { skip: scriptSkipReason },
  () => {
    // Every HOST of the table but the IPv6 address without brackets.
    const hosts = HOSTS.map(([host]) => {
      return host;
    }).filter((host) => {
      return host.startsWith("[") || host.split(":").length <= 2;
    });

    assert.ok(hosts.includes("[2001:db8::1]"));
    assert.ok(!hosts.includes("2001:db8::1"));

    for (const host of hosts) {
      assert.deepEqual(scriptLog(host), [], `HOST="${host}"`);
    }
  },
);

/*
 * The script leaves HOST out for the names the template lists before it,
 * read from the template here: a name added to the line, and not to the
 * script, would be listed twice again.
 */
test(
  "the script leaves out of HOST_SERVER_NAME exactly the names the template lists before it",
  { skip: scriptSkipReason },
  () => {
    const fixedNames = namesOf(primaryServerName(template)).filter((name) => {
      return name !== "${HOST_SERVER_NAME}";
    });

    assert.deepEqual(fixedNames, PRIMARY_SERVER_FIXED_NAMES);

    for (const name of fixedNames) {
      for (const host of [
        name,
        name.toUpperCase(),
        `${name}:8080`,
        `${name[0].toUpperCase()}${name.slice(1)}:443`,
      ]) {
        assert.equal(
          exportedServerNames({ HOST: host }).HOST_SERVER_NAME,
          "",
          `HOST="${host}"`,
        );
      }

      // ...and only those: a longer name is HOST's own.
      for (const host of [`${name}.example.com`, `my-${name}`, `${name}2`]) {
        assert.equal(
          exportedServerNames({ HOST: host }).HOST_SERVER_NAME,
          host,
          `HOST="${host}"`,
        );
      }
    }
  },
);

/*
 * The regression of #8023: under HOST=localhost the primary listed
 * "localhost" twice, and nginx warned once for each address and port it
 * listens on (7849 and, with PROVISION_SSL, 7850; IPv4 and IPv6).
 */
test(
  "every server name is listed once for each address and port, under every kind of HOST, rendered by the real script",
  { skip: scriptSkipReason },
  () => {
    for (const host of HOST_KINDS) {
      for (const [listenAddress, ipv6, sockets] of [
        // A kernel with IPv6: every listen has a twin on [::].
        ["", true, ["0.0.0.0:7849", "[::]:7849", "0.0.0.0:7850", "[::]:7850"]],
        ["", false, ["0.0.0.0:7849", "0.0.0.0:7850"]],
        // NGINX_LISTEN_ADDRESS names the one address to listen on.
        ["127.0.0.1:", true, ["127.0.0.1:7849", "127.0.0.1:7850"]],
      ]) {
        const rendered = runScript(
          template,
          containerEnvironment({
            HOST: host,
            NGINX_LISTEN_ADDRESS: listenAddress,
            ...(ipv6 ? { NGINX_IPV6_SUPPORT_FILE: SCRIPT_PATH } : {}),
          }),
        );
        const names = serverNamesBySocket(rendered);
        const label = `HOST="${host}", NGINX_LISTEN_ADDRESS="${listenAddress}", IPv6 ${ipv6}`;

        assert.deepEqual([...names.keys()].sort(), [...sockets].sort(), label);

        for (const [socket, socketNames] of names) {
          assert.deepEqual(
            namesListedTwice(socketNames),
            [],
            `${label}: ${socket}`,
          );
        }
      }
    }
  },
);

test(
  "every server name is listed once for each address and port with PROVISION_SSL, where the primary listens on 7850 as well",
  { skip: scriptSkipReason },
  () => {
    for (const host of HOST_KINDS) {
      const names = serverNamesBySocket(
        renderModelled(host, { provisionSsl: true }),
      );

      assert.deepEqual(
        [...names.keys()].sort(),
        ["0.0.0.0:7849", "0.0.0.0:7850", "[::]:7849", "[::]:7850"],
        host,
      );

      for (const [socket, socketNames] of names) {
        // The primary answers on each, beside a status-page default server.
        assert.ok(socketNames.includes("localhost"), `${host}: ${socket}`);
        assert.deepEqual(
          namesListedTwice(socketNames),
          [],
          `HOST="${host}": ${socket}`,
        );
      }
    }
  },
);

/*
 * Leaving the second "localhost" out changes nothing nginx routes: it filed
 * the primary under localhost, ingress and HOST without its port, in lower
 * case, and ignored a name filed twice. So the primary answers those names
 * still, and localhost is still the first, $server_name.
 */
test(
  "the primary answers localhost, ingress and HOST without its port under every kind of HOST, localhost first",
  { skip: scriptSkipReason },
  () => {
    for (const [host, hostWithoutPort] of HOSTS) {
      const names = namesOf(
        primaryServerName(
          runScript(template, containerEnvironment({ HOST: host })),
        ),
      );
      const answeredBefore = new Set(
        ["localhost", "ingress", hostWithoutPort]
          .filter(Boolean)
          .map((name) => {
            return name.toLowerCase();
          }),
      );

      assert.equal(names[0], "localhost", `HOST="${host}"`);
      assert.deepEqual(
        new Set(
          names.map((name) => {
            return name.toLowerCase();
          }),
        ),
        answeredBefore,
        `HOST="${host}"`,
      );
      assert.deepEqual(namesListedTwice(names), [], `HOST="${host}"`);
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
    for (const [host, hostWithoutPort] of HOSTS) {
      assert.equal(
        primaryDomainOf(host),
        hostWithoutPort.toLowerCase(),
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
    assert.deepEqual(
      exportedServerNames({
        HOST: "oneuptime.example.com:8080",
        PRIMARY_DOMAIN: "certificate.example.com",
      }),
      {
        HOST_WITHOUT_PORT: "oneuptime.example.com",
        HOST_SERVER_NAME: "oneuptime.example.com",
      },
    );

    // HOST, not PRIMARY_DOMAIN, decides whether the name lists it.
    assert.deepEqual(
      exportedServerNames({
        HOST: "localhost",
        PRIMARY_DOMAIN: "certificate.example.com",
      }),
      { HOST_WITHOUT_PORT: "localhost", HOST_SERVER_NAME: "" },
    );
    assert.deepEqual(
      exportedServerNames({
        HOST: "oneuptime.example.com",
        PRIMARY_DOMAIN: "localhost",
      }),
      {
        HOST_WITHOUT_PORT: "oneuptime.example.com",
        HOST_SERVER_NAME: "oneuptime.example.com",
      },
    );

    for (const [host, serverName] of [
      [
        "oneuptime.example.com:8080",
        "server_name localhost ingress oneuptime.example.com;",
      ],
      ["localhost", "server_name localhost ingress ;"],
    ]) {
      assert.equal(
        primaryServerName(
          runScript(
            template,
            containerEnvironment({
              HOST: host,
              PRIMARY_DOMAIN: "other.example",
            }),
          ),
        ),
        serverName,
      );
    }
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

/*
 * `nginx -t` on nginx.conf and the rendered `defaultConf`, with what depends
 * on the image moved into a temporary prefix: its status, and all it printed.
 * nginx -t binds the ports it would listen on, and lets one in use pass.
 */
function nginxTest(defaultConf) {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-name-"));

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

// The IPv6 twins where this kernel has IPv6, as the script decides in the image.
const IPV6_SUPPORT_FILE = "/proc/net/if_inet6";
const hasIpv6 = fs.existsSync(IPV6_SUPPORT_FILE);

/*
 * The warning of #8023, from a real nginx: with HOST=localhost the primary
 * was named "localhost ingress localhost", and nginx warned for each of its
 * listens. Rendered as the template named it then, to show the check below
 * sees the warning it looks for.
 */
test(
  "a real nginx warns of a conflicting server name for each listen when the primary lists localhost twice",
  { skip: nginxSkipReason },
  () => {
    const before = template.replace(
      "server_name localhost ingress ${HOST_SERVER_NAME};",
      "server_name localhost ingress ${HOST_WITHOUT_PORT};",
    );

    assert.notEqual(before, template);

    const { status, output } = nginxTest(
      runScript(
        before,
        containerEnvironment({
          HOST: "localhost",
          ...(hasIpv6 ? { NGINX_IPV6_SUPPORT_FILE: IPV6_SUPPORT_FILE } : {}),
        }),
      ),
    );

    assert.equal(status, 0, output);
    assert.equal(
      output.match(/\[warn\][^\n]*conflicting server name "localhost"/g)
        ?.length,
      hasIpv6 ? 2 : 1,
      output,
    );
  },
);

test(
  "a real nginx reads the config of every kind of HOST without a conflicting server name warning",
  { skip: nginxSkipReason, timeout: 60000 },
  () => {
    for (const host of HOST_KINDS) {
      const { status, output } = nginxTest(
        runScript(
          template,
          containerEnvironment({
            HOST: host,
            ...(hasIpv6 ? { NGINX_IPV6_SUPPORT_FILE: IPV6_SUPPORT_FILE } : {}),
          }),
        ),
      );

      assert.equal(status, 0, `HOST="${host}": ${output}`);
      assert.doesNotMatch(
        output,
        /conflicting server name/,
        `HOST="${host}": ${output}`,
      );
    }
  },
);

/*
 * With PROVISION_SSL the primary listens on 7850 too, and nginx filed its
 * names under four addresses and ports where there is IPv6: the four
 * warnings of #8023. Rendered from the model, with a certificate made here,
 * so this runs outside the image as well (the image test below runs the
 * script itself).
 */
test(
  "a real nginx reads the PROVISION_SSL config of every kind of HOST without a conflicting server name warning",
  {
    skip:
      nginxSkipReason ||
      (isOnPath("openssl", ["version"]) ? false : "openssl not on PATH"),
    timeout: 60000,
  },
  () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-name-"));
    const certificate = path.join(directory, "primary.crt");
    const key = path.join(directory, "primary.key");

    try {
      // The workers may run as another user than the one that made it.
      fs.chmodSync(directory, 0o755);

      const made = spawnSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-subj",
          "/CN=localhost",
          "-keyout",
          key,
          "-out",
          certificate,
          "-days",
          "1",
        ],
        { encoding: "utf8" },
      );

      assert.equal(made.status, 0, made.stderr);

      for (const host of HOST_KINDS) {
        const rendered = renderModelled(
          host,
          { ipv6: hasIpv6, provisionSsl: true },
          {
            PROVISION_SSL_CERTIFICATE_DIRECTIVE: `    ssl_certificate ${certificate};`,
            PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE: `    ssl_certificate_key ${key};`,
          },
        );

        assert.ok(rendered.includes("    listen 7850 ssl;\n"), host);

        const { status, output } = nginxTest(rendered);

        assert.equal(status, 0, `HOST="${host}": ${output}`);
        assert.doesNotMatch(
          output,
          /conflicting server name/,
          `HOST="${host}": ${output}`,
        );
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);

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

    try {
      const rendered = runScript(
        template,
        containerEnvironment({
          HOST: host,
          PROVISION_SSL: "true",
          PRIMARY_DOMAIN: primaryDomainOf(host),
        }),
      );

      assert.ok(
        rendered.includes(`ssl_certificate ${certificate};`),
        "the primary's certificate is named by the address in brackets",
      );
      assert.ok(fs.existsSync(certificate), `${certificate} was not made`);
      assert.ok(fs.existsSync(key), `${key} was not made`);

      const { status, output } = nginxTest(rendered);

      assert.equal(status, 0, output);
    } finally {
      if (madeHere) {
        fs.rmSync(certificate, { force: true });
        fs.rmSync(key, { force: true });
      }
    }
  },
);

/*
 * The image as it starts: PROVISION_SSL on, so the primary listens on 7850
 * as well as 7849, and an IPv6 twin for each listen where the kernel has
 * IPv6. Under HOST=localhost nginx warned four times on every start (#8023);
 * under no HOST may it warn at all.
 */
test(
  "inside the image, with PROVISION_SSL and IPv6, nginx -t warns of nothing under every kind of HOST",
  { skip: provisionSslSkipReason, timeout: 120000 },
  () => {
    for (const host of [
      "localhost",
      "localhost:3000",
      "LOCALHOST",
      "ingress",
      "ingress:7849",
      "10.0.0.5:8080",
      "[::1]:8080",
      "[2001:DB8::1]",
      "oneuptime.example.com",
      "oneuptime.example.com:8080",
    ]) {
      const primaryDomain = primaryDomainOf(host);
      const certificate = `/etc/nginx/certs/ServerCerts/${primaryDomain}.crt`;
      const key = `/etc/nginx/certs/ServerCerts/${primaryDomain}.key`;
      const madeHere = !fs.existsSync(certificate) && !fs.existsSync(key);

      try {
        const rendered = runScript(
          template,
          containerEnvironment({
            HOST: host,
            PROVISION_SSL: "true",
            PRIMARY_DOMAIN: primaryDomain,
            NGINX_IPV6_SUPPORT_FILE: IPV6_SUPPORT_FILE,
          }),
        );
        const sockets = [...serverNamesBySocket(rendered).entries()].filter(
          ([, names]) => {
            return names.includes("localhost");
          },
        );

        // The primary listens on 7849 and 7850, on IPv6 too where there is one.
        assert.deepEqual(
          sockets
            .map(([socket]) => {
              return socket;
            })
            .sort(),
          (hasIpv6
            ? ["0.0.0.0:7849", "0.0.0.0:7850", "[::]:7849", "[::]:7850"]
            : ["0.0.0.0:7849", "0.0.0.0:7850"]
          ).sort(),
          `HOST="${host}"`,
        );

        const { status, output } = nginxTest(rendered);

        assert.equal(status, 0, `HOST="${host}": ${output}`);
        assert.doesNotMatch(
          output,
          /\[(warn|error|crit|alert|emerg)\]/,
          `HOST="${host}": ${output}`,
        );
      } finally {
        if (madeHere) {
          fs.rmSync(certificate, { force: true });
          fs.rmSync(key, { force: true });
        }
      }
    }
  },
);
