"use strict";

/**
 * Scripts/Install/Preflight.js, the first step of `npm start`.
 *
 * It checks the server before Compose starts anything and says, a line each,
 * what is wrong and which setting fixes it: Docker installed, running and
 * usable by this user with the Compose v2 plugin; Docker's memory and free
 * disk; every port the stack publishes free or held by this install's own
 * containers; HOST, HTTP_PROTOCOL and PROVISION_SSL in shapes that work, and
 * HOST's DNS. It creates config.env from config.example.env when there is
 * none. Only what would certainly stop OneUptime stops the start.
 *
 * The friction it answers, from the issues people opened while installing:
 * a port already taken (#2195, #1742, #1755), HOST not the address people
 * open, written with http:// or as 0.0.0.0 (#1425, #2418, #1291), the ingress
 * moved while HOST kept port 80 (#1072, #2195), Docker's socket refusing the
 * user, a server with too little memory (#1834, #2303).
 *
 * Every effect is passed in, so these tests run without Docker, a network or
 * a terminal; the script and `npm start` itself are run too, with a `docker`
 * on PATH that answers like Docker would.
 */

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  SKIP_SETTING,
  DOCS_URL,
  MINIMUM_MEMORY_BYTES,
  MINIMUM_FREE_DISK_BYTES,
  PUBLISHED_PORTS,
  DOCKER_MESSAGES,
  isTruthy,
  gigabytes,
  versionNumbers,
  parsePortSetting,
  splitHost,
  cleanedHost,
  exampleAddress,
  hostFindings,
  dockerFailureOf,
  dockerFindings,
  freeDiskBytes,
  resourceFindings,
  servicesToStart,
  publishedPortsOf,
  runningServicesOf,
  addressesToTry,
  portFindings,
  dnsFindings,
  defaultIsPortInUse,
  prepareConfig,
  run,
} = require("../../Scripts/Install/Preflight");
const {
  readSettings,
} = require("../../Scripts/Install/ReplacePlaceholderSecrets");
const {
  REPO_ROOT,
  hasDockerCompose,
  renderCompose,
} = require("./Utils/ComposePorts");

const SCRIPT_PATH = "./Scripts/Install/Preflight.js";
const TEMPLATE = fs.readFileSync(
  path.join(REPO_ROOT, "config.example.env"),
  "utf8",
);
const ROOT_PACKAGE = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);
const INSTALL_STEP_IN_SCRIPT = /node (\.\/Scripts\/Install\/[\w.-]+\.js)/g;

const GB = 1000 * 1000 * 1000;

// A network as os.networkInterfaces() reports one: loopback and one LAN address.
const INTERFACES = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  eth0: [
    { address: "fe80::1", family: "IPv6", internal: false },
    { address: "203.0.113.5", family: "IPv4", internal: false },
  ],
};

function settingsWith(lines) {
  return readSettings(lines.join("\n"));
}

function levelsOf(findings) {
  return findings.map((finding) => {
    return finding.level;
  });
}

/*
 * What `docker compose config --format json` renders for docker-compose.yml
 * with config.example.env, trimmed to what the checks read, with `ports`
 * moving the ingress and the probe.
 */
function renderedConfig(changes) {
  const given = changes || {};
  const common = ["clickhouse", "postgres", "valkey"];

  return {
    services: {
      app: { environment: { PORT: "3002" }, depends_on: { postgres: {} } },
      clickhouse: {},
      valkey: {},
      postgres: {
        ports: [
          {
            mode: "ingress",
            host_ip: "127.0.0.1",
            target: 5432,
            published: "5400",
            protocol: "tcp",
          },
        ],
      },
      ingress: {
        ports: [
          {
            mode: "ingress",
            host_ip: given.ingressAddress,
            target: 7849,
            published: given.http || "80",
            protocol: "tcp",
          },
          {
            mode: "ingress",
            target: 7850,
            published: given.https || "443",
            protocol: "tcp",
          },
        ],
        depends_on: Object.fromEntries(
          common.map((name) => {
            return [name, { condition: "service_healthy" }];
          }),
        ),
      },
      "probe-1": {
        network_mode: "host",
        environment: { PORT: given.probe || "3874" },
        depends_on: { postgres: {} },
      },
      "global-runner": {
        environment: { PORT: "3877" },
        depends_on: { postgres: {} },
      },
    },
  };
}

/*
 * A runCommand stub (spawnSync's signature and result) answering each
 * `<command> <args>` from `answers`, and recording every call.
 */
function commands(answers) {
  const calls = [];
  const runCommand = (command, args, options) => {
    const line = [command].concat(args).join(" ");
    calls.push({ line: line, options: options || {} });

    // The longest prefix that matches answers, so an answer for one port beats one for every port.
    const prefixes = Object.keys(answers)
      .filter((prefix) => {
        return line.startsWith(prefix);
      })
      .sort((a, b) => {
        return b.length - a.length;
      });

    if (prefixes.length > 0) {
      const answer = answers[prefixes[0]];

      return typeof answer === "function" ? answer(line, options) : answer;
    }

    return { status: 1, stdout: "", stderr: `no answer for ${line}` };
  };

  return { calls: calls, runCommand: runCommand };
}

const answered = (stdout) => {
  return { status: 0, stdout: stdout, stderr: "" };
};

// Docker 29 with Compose 5, 16 GB, 120 GB free, and the stack it would start.
function healthyDocker(overrides) {
  return Object.assign(
    {
      "docker info": answered("29.8.1|16000000000|/var/lib/docker\n"),
      "docker compose version": answered("5.5.1\n"),
      "df -Pk": answered(
        "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 811000000 600000000 117187500 85% /\n",
      ),
      "docker compose config": answered(JSON.stringify(renderedConfig())),
      "docker compose ps": answered(""),
      "docker ps --filter": answered(""),
    },
    overrides || {},
  );
}

// An isPortInUse that says the listed host:port pairs are in use.
function portsInUse(pairs) {
  const asked = [];
  const isPortInUse = (host, port) => {
    asked.push(`${host}:${port}`);
    return Promise.resolve(pairs.indexOf(`${host}:${port}`) !== -1);
  };

  return { asked: asked, isPortInUse: isPortInUse };
}

function workspace(config) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-preflight-"),
  );

  fs.copyFileSync(
    path.join(REPO_ROOT, "config.example.env"),
    path.join(directory, "config.example.env"),
  );

  if (config !== null && config !== undefined) {
    fs.writeFileSync(path.join(directory, "config.env"), config);
  }

  return directory;
}

async function runWith(options) {
  const lines = [];
  const directory = workspace(options.config);

  try {
    const code = await run({
      cwd: directory,
      env: options.env || { PATH: process.env.PATH },
      log: (message) => {
        lines.push.apply(lines, String(message).split("\n"));
      },
      runCommand: commands(options.docker || healthyDocker()).runCommand,
      isPortInUse:
        options.isPortInUse ||
        (() => {
          return Promise.resolve(false);
        }),
      lookupHost:
        options.lookupHost ||
        (() => {
          return Promise.resolve(null);
        }),
      interfaces:
        options.interfaces === undefined ? INTERFACES : options.interfaces,
    });

    return {
      code: code,
      lines: lines,
      config: fs.existsSync(path.join(directory, "config.env"))
        ? fs.readFileSync(path.join(directory, "config.env"), "utf8")
        : null,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe("reading what it is given", () => {
  test.each([
    ["80", { address: "", port: 80 }],
    ["8080", { address: "", port: 8080 }],
    [" 8080 ", { address: "", port: 8080 }],
    ["127.0.0.1:8080", { address: "127.0.0.1", port: 8080 }],
    ["0.0.0.0:80", { address: "0.0.0.0", port: 80 }],
    ["[::1]:8080", { address: "[::1]", port: 8080 }],
    ["eighty", null],
    ["", null],
  ])("ONEUPTIME_HTTP_PORT=%p", (value, expected) => {
    expect(parsePortSetting(value)).toEqual(expected);
  });

  test.each([
    [
      "oneuptime.example.com",
      { hostname: "oneuptime.example.com", port: null },
    ],
    [
      "oneuptime.example.com:8080",
      { hostname: "oneuptime.example.com", port: 8080 },
    ],
    ["localhost:8080", { hostname: "localhost", port: 8080 }],
    ["203.0.113.5", { hostname: "203.0.113.5", port: null }],
    ["[::1]:8080", { hostname: "[::1]", port: 8080 }],
    ["[::1]", { hostname: "[::1]", port: null }],
    ["2001:db8::1", { hostname: "2001:db8::1", port: null }],
  ])("HOST=%p", (host, expected) => {
    expect(splitHost(host)).toEqual(expected);
  });

  test.each([
    ["http://oneuptime.example.com", "oneuptime.example.com"],
    ["https://oneuptime.example.com/", "oneuptime.example.com"],
    ["oneuptime.example.com/dashboard", "oneuptime.example.com"],
    ["oneuptime.example.com:8080/", "oneuptime.example.com:8080"],
    ["one uptime.example.com", "oneuptime.example.com"],
    ["oneuptime.example.com", "oneuptime.example.com"],
  ])("HOST=%p is written as %p", (host, cleaned) => {
    expect(cleanedHost(host)).toBe(cleaned);
  });

  test("an example address: the first IPv4 address off this server's loopback, or none", () => {
    expect(exampleAddress(INTERFACES)).toBe("203.0.113.5");
    expect(exampleAddress({ lo: INTERFACES.lo })).toBeNull();
    expect(exampleAddress({})).toBeNull();
    // Node.js 18.0 and 18.1 reported the family as a number.
    expect(
      exampleAddress({
        eth0: [{ address: "10.0.0.5", family: 4, internal: false }],
      }),
    ).toBe("10.0.0.5");
  });

  test.each([
    [16000000000, "16 GB"],
    [7800000000, "7.8 GB"],
    [117187500 * 1024, "120 GB"],
    [3.84 * GB, "3.8 GB"],
  ])("%d bytes read as %s", (bytes, text) => {
    expect(gigabytes(bytes)).toBe(text);
  });

  test.each([
    ["29.8.1", [29, 8, 1]],
    ["v2.29.7-desktop.1", [2, 29, 7]],
    ["5.5.1\n", [5, 5, 1]],
    ["20.10", [20, 10, 0]],
    ["", null],
    ["unknown", null],
  ])("version %p", (text, expected) => {
    expect(versionNumbers(text)).toEqual(expected);
  });

  test.each([
    ["true", true],
    ["1", true],
    ["YES", true],
    ["false", false],
    ["", false],
    [undefined, false],
  ])("%p is %p as a switch", (value, expected) => {
    expect(isTruthy(value)).toBe(expected);
  });
});

describe("HOST, HTTP_PROTOCOL and PROVISION_SSL", () => {
  const stock = [
    "HOST=localhost",
    "HTTP_PROTOCOL=http",
    "PROVISION_SSL=false",
    "ONEUPTIME_HTTP_PORT=80",
    "TRUSTED_PROXY_HOPS=1",
  ];

  function findingsFor(changes) {
    const lines = stock.filter((line) => {
      return !changes.some((change) => {
        return change.split("=")[0] === line.split("=")[0];
      });
    });

    return hostFindings(settingsWith(lines.concat(changes)), INTERFACES);
  }

  test("a domain name over http or https is fine", () => {
    expect(findingsFor(["HOST=oneuptime.example.com"])).toEqual([]);
    expect(
      findingsFor(["HOST=oneuptime.example.com", "HTTP_PROTOCOL=https"]),
    ).toEqual([]);
    expect(findingsFor(["HOST=203.0.113.5"])).toEqual([]);
  });

  test("localhost: only this computer can open it, and the server's own address is the example", () => {
    const findings = findingsFor([]);

    expect(findings).toEqual([
      {
        level: "warn",
        message:
          "HOST is localhost, so only this computer can open OneUptime. To open it from other computers, set HOST in config.env to this server's domain name or IP address, such as HOST=203.0.113.5, then run npm start again.",
      },
    ]);
  });

  test("localhost on a server with no other address names no example", () => {
    const findings = hostFindings(settingsWith(stock), { lo: INTERFACES.lo });

    expect(findings[0].message).toBe(
      "HOST is localhost, so only this computer can open OneUptime. To open it from other computers, set HOST in config.env to this server's domain name or IP address, then run npm start again.",
    );
  });

  test.each(["127.0.0.1", "[::1]", "localhost:8080"])(
    "%s is this computer too",
    (host) => {
      expect(levelsOf(findingsFor([`HOST=${host}`]))).toContain("warn");
    },
  );

  test.each([
    ["http://oneuptime.example.com", "HOST=oneuptime.example.com"],
    ["https://oneuptime.example.com/", "HOST=oneuptime.example.com"],
    ["oneuptime.example.com/", "HOST=oneuptime.example.com"],
    ["http://203.0.113.5:8080/accounts", "HOST=203.0.113.5:8080"],
  ])(
    "HOST=%s stops the start, with the line to write instead",
    (host, line) => {
      const findings = findingsFor([`HOST=${host}`]);

      expect(findings).toEqual([
        {
          level: "stop",
          message: `HOST in config.env is ${host}. Write the address alone, without http:// or a path: ${line}. HTTP_PROTOCOL says whether people use http or https.`,
        },
      ]);
    },
  );

  test.each(["0.0.0.0", "0.0.0.0:8080", "::", "[::]"])(
    "HOST=%s, an address servers listen on, stops the start",
    (host) => {
      const findings = findingsFor([`HOST=${host}`]);

      expect(levelsOf(findings)).toEqual(["stop"]);
      expect(findings[0].message).toContain(
        "an address servers listen on rather than one people open",
      );
      expect(findings[0].message).toContain("such as HOST=203.0.113.5");
    },
  );

  test("HOST=0.0.0.0:8080 keeps its port in the example", () => {
    expect(findingsFor(["HOST=0.0.0.0:8080"])[0].message).toContain(
      "such as HOST=203.0.113.5:8080.",
    );
  });

  test("an empty HOST stops the start", () => {
    const findings = findingsFor(["HOST="]);

    expect(findings).toEqual([
      {
        level: "stop",
        message:
          "HOST in config.env is empty. Set it to the domain name or IP address people will use to reach OneUptime, without http://, such as HOST=203.0.113.5.",
      },
    ]);
  });

  test.each(["HTTPS", "Http", "ftp", ""])(
    "HTTP_PROTOCOL=%p is said, not stopped: an existing install keeps starting",
    (protocol) => {
      const findings = findingsFor([
        "HOST=oneuptime.example.com",
        `HTTP_PROTOCOL=${protocol}`,
      ]);

      expect(levelsOf(findings)).toEqual(["warn"]);
      expect(findings[0].message).toContain(
        "which OneUptime reads as http. It takes http or https, in lowercase",
      );
    },
  );

  test("PROVISION_SSL with an address Let's Encrypt cannot certify, or with http links", () => {
    expect(
      findingsFor([
        "HOST=203.0.113.5",
        "PROVISION_SSL=true",
        "HTTP_PROTOCOL=https",
      ]),
    ).toEqual([
      {
        level: "warn",
        message:
          "PROVISION_SSL=true, but HOST is 203.0.113.5: Let's Encrypt issues certificates for domain names only. Set HOST to a domain name that points at this server, or PROVISION_SSL=false.",
      },
    ]);
    expect(
      findingsFor(["HOST=oneuptime.example.com", "PROVISION_SSL=true"]),
    ).toEqual([
      {
        level: "warn",
        message:
          "PROVISION_SSL=true, but HTTP_PROTOCOL=http: set HTTP_PROTOCOL=https too, so OneUptime's links, sign-in and status pages use the certificate.",
      },
    ]);
    expect(
      findingsFor([
        "HOST=oneuptime.example.com",
        "PROVISION_SSL=true",
        "HTTP_PROTOCOL=https",
      ]),
    ).toEqual([]);
  });

  test("the ingress moved to another port while HOST has none: sign-in would call port 80", () => {
    const findings = findingsFor([
      "HOST=oneuptime.example.com",
      "ONEUPTIME_HTTP_PORT=8080",
    ]);

    expect(findings).toEqual([
      {
        level: "warn",
        message: `OneUptime's ingress is on port 8080 (ONEUPTIME_HTTP_PORT=8080), but HOST has no port, so its pages call port 80 and signing in fails. If people open it at http://oneuptime.example.com:8080, set HOST=oneuptime.example.com:8080. If a proxy of yours on port 80 or 443 is in front of it, see ${DOCS_URL}#use-your-own-reverse-proxy.`,
      },
    ]);
  });

  test("the moved ingress says nothing when HOST has the port, a proxy is counted, or the ingress is on one address", () => {
    expect(
      findingsFor([
        "HOST=oneuptime.example.com:8080",
        "ONEUPTIME_HTTP_PORT=8080",
      ]),
    ).toEqual([]);
    expect(
      findingsFor([
        "HOST=oneuptime.example.com",
        "ONEUPTIME_HTTP_PORT=8080",
        "TRUSTED_PROXY_HOPS=2",
      ]),
    ).toEqual([]);
    expect(
      findingsFor([
        "HOST=oneuptime.example.com",
        "ONEUPTIME_HTTP_PORT=127.0.0.1:8080",
      ]),
    ).toEqual([]);
    expect(
      findingsFor([
        "HOST=oneuptime.example.com",
        "ONEUPTIME_HTTP_PORT=0.0.0.0:80",
      ]),
    ).toEqual([]);
  });

  test("localhost with a moved ingress hears both: HOST=localhost:<port> is what works on this computer", () => {
    const findings = findingsFor(["ONEUPTIME_HTTP_PORT=8080"]);

    expect(levelsOf(findings)).toEqual(["warn", "warn"]);
    expect(findings[1].message).toContain("set HOST=localhost:8080");
  });
});

describe("Docker and Docker Compose", () => {
  test.each([
    [
      {
        error: Object.assign(new Error("spawn docker ENOENT"), {
          code: "ENOENT",
        }),
      },
      "not-installed",
    ],
    [
      {
        error: Object.assign(new Error("spawnSync docker ETIMEDOUT"), {
          code: "ETIMEDOUT",
        }),
      },
      "not-running",
    ],
    [
      {
        status: 1,
        stderr:
          "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock",
      },
      "permission",
    ],
    [
      {
        status: 1,
        stderr:
          "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
      },
      "not-running",
    ],
    [
      {
        status: 1,
        stderr:
          "error during connect: Get http://...: open //./pipe/docker_engine",
      },
      "not-running",
    ],
    [{ status: 1, stderr: "something else" }, "other"],
  ])("a failed docker info (%p) is %s", (result, failure) => {
    expect(dockerFailureOf(result)).toBe(failure);
  });

  test.each([
    [
      "not-installed",
      { error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) },
    ],
    [
      "permission",
      { status: 1, stderr: "Got permission denied while trying to connect" },
    ],
    [
      "not-running",
      {
        status: 1,
        stderr:
          "Cannot connect to the Docker daemon at unix:///var/run/docker.sock.",
      },
    ],
  ])("%s stops the start, saying what to do", (failure, result) => {
    const docker = commands({ "docker info": result });
    const found = dockerFindings(docker.runCommand);

    expect(found.docker).toBeNull();
    expect(found.findings).toEqual([
      { level: "stop", message: DOCKER_MESSAGES[failure] },
    ]);
    // Nothing else is asked of a Docker that does not answer.
    expect(docker.calls).toHaveLength(1);
  });

  test("the messages say what to run", () => {
    expect(DOCKER_MESSAGES.permission).toContain(
      "sudo usermod -aG docker $USER, sign out and back in",
    );
    expect(DOCKER_MESSAGES["not-running"]).toContain(
      "sudo systemctl start docker",
    );
    expect(
      new URL(DOCKER_MESSAGES["not-installed"].match(/https:\/\/\S+?(?=\))/)[0])
        .origin,
    ).toBe("https://docs.docker.com");
  });

  test("another failure names what Docker said", () => {
    const docker = commands({
      "docker info": {
        status: 1,
        stderr: "\nError response from daemon: bad things\n",
      },
    });

    expect(dockerFindings(docker.runCommand).findings).toEqual([
      {
        level: "stop",
        message:
          "Docker did not answer (Error response from daemon: bad things). Check that it runs with docker info, then run npm start again.",
      },
    ]);
  });

  test("Docker without the Compose v2 plugin stops the start", () => {
    for (const compose of [
      { status: 1, stderr: "docker: 'compose' is not a docker command." },
      answered(""),
      answered("1.29.2"),
    ]) {
      const docker = commands(
        healthyDocker({ "docker compose version": compose }),
      );
      const found = dockerFindings(docker.runCommand);

      expect(levelsOf(found.findings)).toEqual(["stop"]);
      expect(found.findings[0].message).toContain(
        "Docker Compose v2 is missing: Docker cannot run the docker compose command.",
      );
      expect(found.findings[0].message).toContain(
        "The older docker-compose command is not enough.",
      );
    }
  });

  test("a working Docker is named with its Compose, and what it has is read", () => {
    const found = dockerFindings(commands(healthyDocker()).runCommand);

    expect(found.findings).toEqual([
      { level: "ok", message: "Docker 29.8.1 with Docker Compose 5.5.1." },
    ]);
    expect(found.docker).toEqual({
      version: "29.8.1",
      memoryBytes: 16000000000,
      rootDirectory: "/var/lib/docker",
    });
  });

  test("Compose's v prefix is dropped, as Docker Desktop prints it", () => {
    const found = dockerFindings(
      commands(
        healthyDocker({
          "docker compose version": answered("v2.29.7-desktop.1\n"),
        }),
      ).runCommand,
    );

    expect(found.findings[0].message).toBe(
      "Docker 29.8.1 with Docker Compose 2.29.7-desktop.1.",
    );
  });

  test("a Docker older than 20.10 is said, and the start goes on", () => {
    const found = dockerFindings(
      commands(
        healthyDocker({
          "docker info": answered("19.03.15|16000000000|/var/lib/docker"),
        }),
      ).runCommand,
    );

    expect(found.findings).toEqual([
      {
        level: "warn",
        message:
          "Docker 19.03.15 is older than OneUptime is tested with (20.10 and later). Update Docker if anything fails to start.",
      },
    ]);
  });
});

describe("memory and disk", () => {
  test("below 8 GB of memory is said; at or above it is fine", () => {
    expect(resourceFindings(3.84 * GB, null, "/var/lib/docker")).toEqual([
      {
        level: "warn",
        message:
          "Docker has 3.8 GB of memory. OneUptime needs at least 8 GB, and without it may run slowly or stop.",
      },
    ]);
    // An 8 GB server reports a little less than 8 GB.
    expect(resourceFindings(7.7 * GB, null, "")).toEqual([
      { level: "ok", message: "7.7 GB of memory." },
    ]);
    expect(MINIMUM_MEMORY_BYTES).toBeLessThan(7.7 * GB);
    expect(MINIMUM_MEMORY_BYTES).toBeGreaterThan(6 * GB);
  });

  test("below 20 GB free where Docker keeps its data is said", () => {
    expect(resourceFindings(0, 12 * GB, "/var/lib/docker")).toEqual([
      {
        level: "warn",
        message:
          "Only 12 GB free at /var/lib/docker, where Docker keeps its images and data. OneUptime's images take about 15 GB and its databases grow with your data: free up space, or OneUptime may stop when the disk fills.",
      },
    ]);
    expect(resourceFindings(0, 120 * GB, "/var/lib/docker")).toEqual([
      { level: "ok", message: "120 GB free for Docker's images and data." },
    ]);
    expect(MINIMUM_FREE_DISK_BYTES).toBe(20 * GB);
  });

  test("what cannot be read is not said", () => {
    expect(resourceFindings(0, null, "/var/lib/docker")).toEqual([]);
  });

  test("free space is read from df's POSIX output, and a path df cannot read is no answer", () => {
    const docker = commands(healthyDocker());

    expect(freeDiskBytes(docker.runCommand, "/var/lib/docker")).toBe(
      117187500 * 1024,
    );
    expect(docker.calls[0].line).toBe("df -Pk /var/lib/docker");
    expect(
      freeDiskBytes(
        commands({
          "df -Pk": {
            status: 1,
            stderr: "df: /var/lib/docker: No such file or directory",
          },
        }).runCommand,
        "/var/lib/docker",
      ),
    ).toBeNull();
    expect(freeDiskBytes(commands({}).runCommand, "")).toBeNull();
  });

  test("the real df answers for the root of this machine", () => {
    const real = (command, args) => {
      return spawnSync(command, args, { encoding: "utf8" });
    };

    expect(freeDiskBytes(real, "/")).toBeGreaterThan(0);
  });
});

describe("the ports the stack publishes", () => {
  test("every port docker-compose.yml publishes, with the setting that moves it", () => {
    const config = renderedConfig();
    const found = publishedPortsOf(config, servicesToStart(config, ""));

    expect(
      found.map((port) => {
        return `${port.service} ${port.address || "*"}:${port.port} ${port.entry.setting}`;
      }),
    ).toEqual([
      "postgres 127.0.0.1:5400 null",
      "ingress *:80 ONEUPTIME_HTTP_PORT",
      "ingress *:443 STATUS_PAGE_HTTPS_PORT",
      "probe-1 *:3874 GLOBAL_PROBE_1_PORT",
    ]);
  });

  test("--services starts those services and what they depend on, and only their ports count", () => {
    const config = renderedConfig();

    expect(servicesToStart(config, "app")).toEqual(["app", "postgres"]);
    expect(servicesToStart(config, "ingress probe-1")).toEqual([
      "ingress",
      "clickhouse",
      "postgres",
      "valkey",
      "probe-1",
    ]);
    expect(servicesToStart(config, "no-such-service")).toEqual([]);
    expect(servicesToStart(config, undefined)).toEqual(
      Object.keys(config.services),
    );
  });

  test("this install's running containers, from either JSON Compose prints", () => {
    const lines = [
      JSON.stringify({
        Service: "ingress",
        State: "running",
        Publishers: [
          {
            URL: "0.0.0.0",
            TargetPort: 7849,
            PublishedPort: 80,
            Protocol: "tcp",
          },
          { URL: "::", TargetPort: 7849, PublishedPort: 80, Protocol: "tcp" },
        ],
      }),
      JSON.stringify({ Service: "probe-1", State: "running", Publishers: [] }),
      JSON.stringify({ Service: "app", State: "exited", Publishers: [] }),
    ];
    const expected = { services: ["ingress", "probe-1"], ports: [80, 80] };

    expect(runningServicesOf(lines.join("\n"))).toEqual(expected);
    expect(
      runningServicesOf(
        JSON.stringify(
          lines.map((line) => {
            return JSON.parse(line);
          }),
        ),
      ),
    ).toEqual(expected);
    expect(runningServicesOf("")).toEqual({ services: [], ports: [] });
    expect(runningServicesOf("not json")).toEqual({ services: [], ports: [] });
  });

  test("a port published on every address is tried on both loopback addresses; one on an address, there", () => {
    expect(addressesToTry("")).toEqual(["127.0.0.1", "::1"]);
    expect(addressesToTry("0.0.0.0")).toEqual(["127.0.0.1", "::1"]);
    expect(addressesToTry("127.0.0.1")).toEqual(["127.0.0.1"]);
    expect(addressesToTry("[::1]")).toEqual(["::1"]);
  });

  async function portsWith(docker, inUse, env) {
    return portFindings({
      runCommand: commands(docker).runCommand,
      isPortInUse: portsInUse(inUse).isPortInUse,
      env: env || {},
    });
  }

  test("all free: one line naming them", async () => {
    expect(await portsWith(healthyDocker(), [])).toEqual([
      { level: "ok", message: "Ports 80, 443, 3874 and 5400 are free." },
    ]);
  });

  test("port 80 taken by another program stops the start, naming the setting and a free value", async () => {
    expect(await portsWith(healthyDocker(), ["127.0.0.1:80"])).toEqual([
      {
        level: "stop",
        message:
          "Port 80 is already in use by another program, and OneUptime's ingress needs it. Stop that program, or set ONEUPTIME_HTTP_PORT in config.env to a free port, such as ONEUPTIME_HTTP_PORT=8080.",
      },
    ]);
  });

  test("a port taken only over IPv6 is taken", async () => {
    expect(levelsOf(await portsWith(healthyDocker(), ["::1:443"]))).toEqual([
      "stop",
    ]);
  });

  test("a container of another project is named", async () => {
    const findings = await portsWith(
      healthyDocker({
        "docker ps --filter publish=443": answered("caddy-1\n"),
      }),
      ["127.0.0.1:443"],
    );

    expect(findings).toEqual([
      {
        level: "stop",
        message:
          "Port 443 is already in use by the container caddy-1, and OneUptime's ingress serves HTTPS on it. Stop that container, or set STATUS_PAGE_HTTPS_PORT in config.env to a free port, such as STATUS_PAGE_HTTPS_PORT=8443.",
      },
    ]);
  });

  test("PostgreSQL's port and the probe's say what each is for", async () => {
    const findings = await portsWith(healthyDocker(), [
      "127.0.0.1:5400",
      "127.0.0.1:3874",
    ]);

    expect(findings).toEqual([
      {
        level: "stop",
        message:
          "Port 5400 of 127.0.0.1 is already in use by another program, and OneUptime publishes PostgreSQL there for npm run backup. Stop that program, then run npm start again.",
      },
      {
        level: "stop",
        message:
          "Port 3874 is already in use by another program, and the bundled probe listens on it. Stop that program, or set GLOBAL_PROBE_1_PORT in config.env to a free port, such as GLOBAL_PROBE_1_PORT=3884.",
      },
    ]);
  });

  test("ports this install's own containers hold are fine: npm start recreates them", async () => {
    const ps = [
      JSON.stringify({
        Service: "ingress",
        State: "running",
        Publishers: [
          {
            URL: "0.0.0.0",
            TargetPort: 7849,
            PublishedPort: 80,
            Protocol: "tcp",
          },
          {
            URL: "0.0.0.0",
            TargetPort: 7850,
            PublishedPort: 443,
            Protocol: "tcp",
          },
        ],
      }),
      JSON.stringify({
        Service: "postgres",
        State: "running",
        Publishers: [
          {
            URL: "127.0.0.1",
            TargetPort: 5432,
            PublishedPort: 5400,
            Protocol: "tcp",
          },
        ],
      }),
      JSON.stringify({ Service: "probe-1", State: "running", Publishers: [] }),
    ].join("\n");
    const probes = portsInUse([
      "127.0.0.1:80",
      "127.0.0.1:443",
      "127.0.0.1:5400",
      "127.0.0.1:3874",
    ]);
    const findings = await portFindings({
      runCommand: commands(healthyDocker({ "docker compose ps": answered(ps) }))
        .runCommand,
      isPortInUse: probes.isPortInUse,
      env: {},
    });

    expect(findings).toEqual([
      {
        level: "ok",
        message:
          "Ports 80, 443, 3874 and 5400 are free or used by this OneUptime.",
      },
    ]);
    // Its own ports are not even tried.
    expect(probes.asked).toEqual([]);
  });

  test("a moved ingress is checked where config.env moves it", async () => {
    const probes = portsInUse([]);

    await portFindings({
      runCommand: commands(
        healthyDocker({
          "docker compose config": answered(
            JSON.stringify(
              renderedConfig({ http: "8080", ingressAddress: "127.0.0.1" }),
            ),
          ),
        }),
      ).runCommand,
      isPortInUse: probes.isPortInUse,
      env: {},
    });

    expect(probes.asked).toContain("127.0.0.1:8080");
    expect(probes.asked).not.toContain("127.0.0.1:80");
    expect(probes.asked).not.toContain("::1:8080");
  });

  test("--services=app checks PostgreSQL's port and not the ingress's", async () => {
    const probes = portsInUse([]);

    await portFindings({
      runCommand: commands(healthyDocker()).runCommand,
      isPortInUse: probes.isPortInUse,
      env: { npm_config_services: "app" },
    });

    expect(probes.asked).toEqual(["127.0.0.1:5400"]);
  });

  test("Compose renders with config.env's settings, in the install's folder", async () => {
    const docker = commands(healthyDocker());

    await portFindings({
      runCommand: docker.runCommand,
      isPortInUse: portsInUse([]).isPortInUse,
      env: { COMPOSE_PROJECT_NAME: "my-oneuptime", HOST: "x" },
    });

    const config = docker.calls.find((call) => {
      return call.line === "docker compose config --format json";
    });

    expect(config.options.env.COMPOSE_PROJECT_NAME).toBe("my-oneuptime");
    expect(
      docker.calls.some((call) => {
        return call.line === "docker compose ps --format json";
      }),
    ).toBe(true);
  });

  test("files Compose cannot render say nothing here: Compose says what is wrong as it starts", async () => {
    expect(
      await portsWith(
        healthyDocker({
          "docker compose config": { status: 15, stderr: "yaml: line 3" },
        }),
        ["127.0.0.1:80"],
      ),
    ).toEqual([]);
    expect(
      await portsWith(
        healthyDocker({ "docker compose config": answered("{not json") }),
        ["127.0.0.1:80"],
      ),
    ).toEqual([]);
  });

  /*
   * The bundled global Runner publishes no port: unlike the shared Runner it
   * replaced, it is on OneUptime's own network, not the host's.
   */
  test("the published ports it knows are every port the ingress, PostgreSQL and the probes publish", () => {
    expect(
      PUBLISHED_PORTS.map((entry) => {
        return entry.service;
      }),
    ).toEqual(["ingress", "ingress", "postgres", "probe-1", "probe-2"]);
  });

  test("whether a port is in use, asked of a real socket", async () => {
    const server = net.createServer();

    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    const port = server.address().port;

    try {
      expect(await defaultIsPortInUse("127.0.0.1", port)).toBe(true);
    } finally {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }

    expect(await defaultIsPortInUse("127.0.0.1", port)).toBe(false);
  });
});

const describeWithCompose = hasDockerCompose() ? describe : describe.skip;

describeWithCompose("the ports as Compose renders the shipped files", () => {
  test("docker-compose.yml with config.example.env publishes what the checks expect, on the defaults the guide's table gives", () => {
    const config = renderCompose(["docker-compose.yml"]);
    const found = publishedPortsOf(config, servicesToStart(config, ""));

    expect(
      found
        .map((port) => {
          return `${port.port} ${port.entry.setting}`;
        })
        .sort(),
    ).toEqual([
      "3874 GLOBAL_PROBE_1_PORT",
      "443 STATUS_PAGE_HTTPS_PORT",
      "5400 null",
      "80 ONEUPTIME_HTTP_PORT",
    ]);
  });

  test("a moved ingress and probe are rendered where config.env moves them", () => {
    const config = renderCompose(["docker-compose.yml"], {
      ONEUPTIME_HTTP_PORT: "127.0.0.1:8080",
      GLOBAL_PROBE_1_PORT: "3884",
    });
    const found = publishedPortsOf(config, servicesToStart(config, ""));

    expect(
      found
        .filter((port) => {
          return port.service !== "postgres";
        })
        .map((port) => {
          return `${port.address || "*"}:${port.port}`;
        }),
    ).toEqual(["127.0.0.1:8080", "*:443", "*:3884"]);
  });
});

describe("HOST's DNS", () => {
  test("a domain name that does not resolve is said, with Let's Encrypt when it provisions", async () => {
    const asked = [];
    const lookup = (hostname) => {
      asked.push(hostname);
      return Promise.resolve("not-found");
    };

    expect(
      await dnsFindings(
        settingsWith(["HOST=oneuptime.example.com:8080"]),
        lookup,
      ),
    ).toEqual([
      {
        level: "warn",
        message:
          "HOST is oneuptime.example.com:8080, and oneuptime.example.com does not resolve yet. People cannot open OneUptime by that name until a DNS record points it at this server.",
      },
    ]);
    expect(asked).toEqual(["oneuptime.example.com"]);
    expect(
      (
        await dnsFindings(
          settingsWith(["HOST=oneuptime.example.com", "PROVISION_SSL=true"]),
          lookup,
        )
      )[0].message,
    ).toContain(", and Let's Encrypt cannot issue its certificate.");
  });

  test("a name that resolves, or a lookup that cannot tell, says nothing", async () => {
    expect(
      await dnsFindings(settingsWith(["HOST=oneuptime.example.com"]), () => {
        return Promise.resolve(null);
      }),
    ).toEqual([]);
  });

  test.each([
    "localhost",
    "203.0.113.5",
    "[::1]:8080",
    "oneuptime",
    "http://x.example.com",
    "",
  ])("HOST=%p is not looked up", async (host) => {
    const lookup = jest.fn(() => {
      return Promise.resolve("not-found");
    });

    expect(await dnsFindings(settingsWith([`HOST=${host}`]), lookup)).toEqual(
      [],
    );
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("config.env", () => {
  test("created from config.example.env when it is missing", () => {
    const directory = workspace(null);

    try {
      const result = prepareConfig(directory);

      expect(result.finding).toEqual({
        level: "ok",
        message:
          "Created config.env from config.example.env. Your settings live there.",
      });
      expect(fs.readFileSync(path.join(directory, "config.env"), "utf8")).toBe(
        TEMPLATE,
      );
      expect(result.settings.get("HOST")).toBe("localhost");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("filled from config.example.env when it holds no setting, as an empty file touch made does", () => {
    const directory = workspace("# nothing here yet\n\n");

    try {
      expect(prepareConfig(directory).finding.message).toBe(
        "config.env held no settings, so it now holds config.example.env's. Your settings live there.",
      );
      expect(fs.readFileSync(path.join(directory, "config.env"), "utf8")).toBe(
        TEMPLATE,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("an existing config.env is never touched", () => {
    const directory = workspace("HOST=oneuptime.example.com\n");

    try {
      const result = prepareConfig(directory);

      expect(result.finding).toBeNull();
      expect(fs.readFileSync(path.join(directory, "config.env"), "utf8")).toBe(
        "HOST=oneuptime.example.com\n",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("with neither file, the start stops: npm start runs in the wrong folder", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-preflight-"),
    );

    try {
      expect(prepareConfig(directory).finding.level).toBe("stop");
      expect(fs.existsSync(path.join(directory, "config.env"))).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("a start, from the first line to the last", () => {
  test("a new install on a healthy server: config.env made, every check passes, and HOST is said", async () => {
    const result = await runWith({ config: null });

    expect(result.code).toBe(0);
    expect(result.lines).toEqual([
      "Checking this server before OneUptime starts:",
      "  ✓ Created config.env from config.example.env. Your settings live there.",
      "  ✓ Docker 29.8.1 with Docker Compose 5.5.1.",
      "  ✓ 16 GB of memory.",
      "  ✓ 120 GB free for Docker's images and data.",
      "  ✓ Ports 80, 443, 3874 and 5400 are free.",
      "  ! HOST is localhost, so only this computer can open OneUptime. To open it from other computers, set HOST in config.env to this server's domain name or IP address, such as HOST=203.0.113.5, then run npm start again.",
    ]);
    expect(result.config).toBe(TEMPLATE);
  });

  test("something that stops the start says so last, with the guide and the way around the checks", async () => {
    const result = await runWith({
      config: TEMPLATE.replace("HOST=localhost", "HOST=http://203.0.113.5"),
      isPortInUse: portsInUse(["127.0.0.1:80"]).isPortInUse,
    });

    expect(result.code).toBe(1);
    expect(
      result.lines.filter((line) => {
        return line.startsWith("  ✗ ");
      }),
    ).toEqual([
      "  ✗ Port 80 is already in use by another program, and OneUptime's ingress needs it. Stop that program, or set ONEUPTIME_HTTP_PORT in config.env to a free port, such as ONEUPTIME_HTTP_PORT=8080.",
      "  ✗ HOST in config.env is http://203.0.113.5. Write the address alone, without http:// or a path: HOST=203.0.113.5. HTTP_PROTOCOL says whether people use http or https.",
    ]);
    expect(result.lines.slice(-3)).toEqual([
      "",
      `OneUptime did not start. Fix what is marked ✗, then run npm start again. The Docker Compose guide has more: ${DOCS_URL}`,
      "To start without these checks, run ONEUPTIME_SKIP_PREFLIGHT=true npm start.",
    ]);
  });

  test("without Docker, the ports are not checked, but HOST still is", async () => {
    const result = await runWith({
      config: TEMPLATE.replace("HOST=localhost", "HOST=0.0.0.0"),
      docker: {
        "docker info": {
          error: Object.assign(new Error("spawn docker ENOENT"), {
            code: "ENOENT",
          }),
        },
      },
    });

    expect(result.code).toBe(1);
    expect(
      result.lines.filter((line) => {
        return line.startsWith("  ✗ ");
      }),
    ).toEqual([
      `  ✗ ${DOCKER_MESSAGES["not-installed"]}`,
      expect.stringContaining(
        "  ✗ HOST in config.env is 0.0.0.0, an address servers listen on",
      ),
    ]);
    expect(result.lines.join("\n")).not.toContain("Port");
  });

  test.each(["true", "1", "yes"])(
    "%s=%s skips every check, says so, and starts",
    async (value) => {
      const docker = commands({});
      const lines = [];
      const code = await run({
        cwd: os.tmpdir(),
        env: { [SKIP_SETTING]: value },
        log: (line) => {
          lines.push(line);
        },
        runCommand: docker.runCommand,
      });

      expect(code).toBe(0);
      expect(lines).toEqual([
        "Not checking this server before OneUptime starts: ONEUPTIME_SKIP_PREFLIGHT is set.",
      ]);
      expect(docker.calls).toEqual([]);
    },
  );

  test("the lines are printed as they are found, the heading first", async () => {
    const order = [];
    const directory = workspace(TEMPLATE);

    try {
      await run({
        cwd: directory,
        env: {},
        log: (line) => {
          order.push(line.split("\n")[0]);
        },
        runCommand: commands(healthyDocker()).runCommand,
        isPortInUse: portsInUse([]).isPortInUse,
        lookupHost: () => {
          return Promise.resolve(null);
        },
        interfaces: INTERFACES,
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }

    expect(order[0]).toBe("Checking this server before OneUptime starts:");
    expect(order.length).toBeGreaterThan(4);
  });
});

/*
 * Ports nothing on this machine listens on, for a rendered config the real
 * port check of the script and of npm start can pass anywhere.
 */
async function freePorts(count) {
  const servers = [];

  for (let index = 0; index < count; index++) {
    const server = net.createServer();

    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    servers.push(server);
  }

  const ports = servers.map((server) => {
    return String(server.address().port);
  });

  for (const server of servers) {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }

  return ports;
}

// The stack's rendered config, every published port moved to a free one.
async function renderedOnFreePorts() {
  const [http, https, postgres, probe] = await freePorts(4);
  const config = renderedConfig({ http: http, https: https, probe: probe });

  config.services.postgres.ports[0].published = postgres;

  return config;
}

/*
 * A `docker` for the script and npm start: answers the checks like a healthy
 * Docker 29 with Compose 5 (no running containers, `rendered` as the stack's
 * rendered config), "not created" to GenerateDatabasePassword's check, and
 * records every call. `permission` makes it refuse like a socket the user
 * cannot use.
 */
function writeDocker(directory, calls, behaviour, renderedStack) {
  const rendered = path.join(directory, "rendered.json");

  fs.writeFileSync(rendered, JSON.stringify(renderedStack || renderedConfig()));
  fs.mkdirSync(path.join(directory, "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "bin", "docker"),
    [
      "#!/bin/sh",
      `echo "$*" >> "${calls}"`,
      behaviour === "permission"
        ? 'echo "permission denied while trying to connect to the Docker daemon socket" >&2; exit 1'
        : ":",
      'case "$*" in',
      '  "info "*) echo "29.8.1|16000000000|/" ;;',
      '  "compose version"*) echo "5.5.1" ;;',
      `  "compose config"*) cat "${rendered}" ;;`,
      '  "compose run "*) echo oneuptime-database:not-created ;;',
      "esac",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

function cleanEnv(directory) {
  const env = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toLowerCase().startsWith("npm_") && key !== SKIP_SETTING) {
      env[key] = value;
    }
  }

  env.PATH = `${path.join(directory, "bin")}${path.delimiter}${process.env.PATH}`;
  env.npm_config_update_notifier = "false";

  return env;
}

describe("run as a script", () => {
  function scriptIn(directory) {
    fs.mkdirSync(path.join(directory, "Scripts", "Install"), {
      recursive: true,
    });
    for (const file of [
      "Preflight.js",
      "ReplacePlaceholderSecrets.js",
      "StartOutput.js",
    ]) {
      fs.copyFileSync(
        path.join(REPO_ROOT, "Scripts", "Install", file),
        path.join(directory, "Scripts", "Install", file),
      );
    }
  }

  test("a healthy Docker: exit 0, and config.env made", async () => {
    const directory = workspace(null);

    try {
      scriptIn(directory);
      writeDocker(
        directory,
        path.join(directory, "calls.log"),
        null,
        await renderedOnFreePorts(),
      );

      const result = spawnSync(process.execPath, [SCRIPT_PATH], {
        cwd: directory,
        env: cleanEnv(directory),
        encoding: "utf8",
        timeout: 60 * 1000,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "  ✓ Created config.env from config.example.env.",
      );
      expect(result.stdout).toContain(
        "  ✓ Docker 29.8.1 with Docker Compose 5.5.1.",
      );
      expect(fs.existsSync(path.join(directory, "config.env"))).toBe(true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a Docker the user cannot use: exit 1, saying what to run", () => {
    const directory = workspace(TEMPLATE);

    try {
      scriptIn(directory);
      writeDocker(directory, path.join(directory, "calls.log"), "permission");

      const result = spawnSync(process.execPath, [SCRIPT_PATH], {
        cwd: directory,
        env: cleanEnv(directory),
        encoding: "utf8",
        timeout: 60 * 1000,
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`  ✗ ${DOCKER_MESSAGES.permission}`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a fault of its own never stops the start", () => {
    const directory = workspace(null);

    try {
      scriptIn(directory);
      // A directory where config.env belongs: reading it throws EISDIR.
      fs.mkdirSync(path.join(directory, "config.env"));

      const result = spawnSync(process.execPath, [SCRIPT_PATH], {
        cwd: directory,
        env: cleanEnv(directory),
        encoding: "utf8",
        timeout: 60 * 1000,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "  ! Could not check this server (EISDIR",
      );
      expect(result.stdout).toContain("Starting OneUptime anyway.");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("npm start", () => {
  test("runs the checks first, as a command of its own script, before anything reads config.env", () => {
    const steps = ROOT_PACKAGE.scripts.start.split(" && ");

    expect(steps[0]).toBe(`node ${SCRIPT_PATH}`);
    expect(
      steps.indexOf("export $(grep -v '^#' config.env | xargs)"),
    ).toBeGreaterThan(0);
    // Not a hook: npm skips pre- and post-scripts under ignore-scripts.
    expect(ROOT_PACKAGE.scripts.prestart).toBeUndefined();
    expect(ROOT_PACKAGE.scripts.update).toMatch(/&& npm run start$/);
  });

  /*
   * npm itself runs the root package's start script in a throwaway copy of
   * the repository's layout - no config.env, as a fresh clone has - with the
   * `docker` above on PATH.
   */
  function npmStart(behaviour, renderedStack) {
    const directory = workspace(null);
    const calls = path.join(directory, "docker-calls.log");

    try {
      fs.mkdirSync(path.join(directory, "Scripts", "Install"), {
        recursive: true,
      });
      for (const match of ROOT_PACKAGE.scripts.start.matchAll(
        INSTALL_STEP_IN_SCRIPT,
      )) {
        fs.copyFileSync(
          path.join(REPO_ROOT, match[1]),
          path.join(directory, match[1]),
        );
      }
      fs.copyFileSync(
        path.join(REPO_ROOT, "Scripts", "Install", "StartOutput.js"),
        path.join(directory, "Scripts", "Install", "StartOutput.js"),
      );
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({
          name: "npm-start-preflight",
          version: "1.0.0",
          private: true,
          scripts: {
            start: ROOT_PACKAGE.scripts.start,
            "status-check": "echo status-check >> docker-calls.log",
          },
        }),
      );
      writeDocker(directory, calls, behaviour, renderedStack);

      const result = spawnSync("npm", ["start"], {
        cwd: directory,
        env: cleanEnv(directory),
        encoding: "utf8",
        timeout: 120 * 1000,
      });

      return {
        status: result.status,
        output: `${result.stdout || ""}${result.stderr || ""}`,
        calls: fs.existsSync(calls)
          ? fs.readFileSync(calls, "utf8").trim().split("\n")
          : [],
        config: fs.existsSync(path.join(directory, "config.env"))
          ? fs.readFileSync(path.join(directory, "config.env"), "utf8")
          : null,
      };
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  test("a fresh clone starts with npm start alone: config.env is made, every secret gets a value, Compose starts", async () => {
    const result = npmStart(null, await renderedOnFreePorts());
    const settings = readSettings(result.config);

    expect(result.status).toBe(0);
    expect(
      result.output.indexOf("Checking this server before OneUptime starts:"),
    ).toBeLessThan(
      result.output.indexOf("Gave DATABASE_PASSWORD and ENCRYPTION_SECRET"),
    );
    for (const [key, value] of settings) {
      expect({
        key,
        placeholder: value.includes("please-change-this"),
      }).toEqual({ key, placeholder: false });
    }
    expect(result.calls.slice(-2)).toEqual([
      "compose up --remove-orphans -d",
      "status-check",
    ]);
  });

  test("a check that fails stops npm start before Compose starts anything", () => {
    const result = npmStart("permission");

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(`  ✗ ${DOCKER_MESSAGES.permission}`);
    expect(
      result.calls.filter((call) => {
        return call.startsWith("compose up") || call.startsWith("compose run");
      }),
    ).toEqual([]);
    expect(result.calls).not.toContain("status-check");
  });
});

/*
 * The install scripts npm start runs are read by the Node.js the server has,
 * which can be the one its distribution packages (Ubuntu 22.04's is 12): no
 * syntax newer than that, such as `?.`, `??` or `??=`.
 */
describe("the scripts run on an older Node.js", () => {
  const scripts = [];

  // npm start's and npm run update's steps, and the modules they require.
  for (const command of [
    ROOT_PACKAGE.scripts.start,
    ROOT_PACKAGE.scripts.update,
  ]) {
    for (const match of command.matchAll(INSTALL_STEP_IN_SCRIPT)) {
      if (scripts.indexOf(match[1]) === -1) {
        scripts.push(match[1]);
      }
    }
  }
  scripts.push("./Scripts/Install/StartOutput.js");
  scripts.push("./Scripts/Install/MergeEnvTemplate.js");

  // Code without its comments and string literals.
  function codeOf(source) {
    let code = "";
    let index = 0;

    while (index < source.length) {
      const two = source.slice(index, index + 2);
      const char = source.charAt(index);

      if (two === "//") {
        const end = source.indexOf("\n", index);
        index = end === -1 ? source.length : end;
      } else if (two === "/*") {
        index = source.indexOf("*/", index + 2) + 2;
      } else if (char === '"' || char === "'" || char === "`") {
        index += 1;
        while (index < source.length && source.charAt(index) !== char) {
          index += source.charAt(index) === "\\" ? 2 : 1;
        }
        index += 1;
        code += '""';
      } else {
        code += char;
        index += 1;
      }
    }

    return code;
  }

  test.each(scripts)("%s", (script) => {
    const code = codeOf(fs.readFileSync(path.join(REPO_ROOT, script), "utf8"));

    expect({ script, optionalChaining: /\?\.[^\d]/.test(code) }).toEqual({
      script,
      optionalChaining: false,
    });
    expect({ script, nullish: code.includes("??") }).toEqual({
      script,
      nullish: false,
    });
  });

  test("the check finds what it looks for", () => {
    expect(/\?\.[^\d]/.test(codeOf("const a = b?.c;"))).toBe(true);
    expect(codeOf("const a = b ?? c;").includes("??")).toBe(true);
    expect(/\?\.[^\d]/.test(codeOf('const a = "is it running?.";'))).toBe(
      false,
    );
    expect(/\?\.[^\d]/.test(codeOf("const a = b ? .5 : 1;"))).toBe(false);
  });
});
