"use strict";

/**
 * Scripts/Install/CheckIngressPorts.js, a step of npm start.
 *
 * The rule: OneUptime takes each visitor's address from X-Forwarded-For,
 * counting TRUSTED_PROXY_HOPS entries in from the right, so with 2 it reads
 * what a proxy of the operator's own wrote - the visitor's address only
 * while that proxy is the one way in. Behind a proxy on the same server, the
 * Docker Compose guide moves the ingress off ports 80 and 443 and publishes
 * it on 127.0.0.1 alone. An install whose ingress was moved off those ports
 * but is still published on every address of the server (a port number
 * alone, as the guide had it before) is told so by npm start, with the
 * values that publish it on the loopback address. Nothing is said for the
 * guide's own values, for ports written with an address, for ports 80 and
 * 443, or while TRUSTED_PROXY_HOPS counts no proxy; and the step never stops
 * npm start.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  INGRESS_PORT_SETTINGS,
  HOPS_SETTING,
  REVERSE_PROXY_DOCS_URL,
  trustedProxyHopsOf,
  ingressPortsAroundProxy,
  describeIngressPortsAroundProxy,
  init,
} = require("../../Scripts/Install/CheckIngressPorts");
const {
  readSettings,
} = require("../../Scripts/Install/ReplacePlaceholderSecrets");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = "./Scripts/Install/CheckIngressPorts.js";
const STEP = `node ${SCRIPT_PATH}`;
// One `node ./Scripts/Install/<Name>.js` command of an npm script.
const INSTALL_STEP = /^node \.\/Scripts\/Install\/[\w.-]+\.js$/;
const INSTALL_STEP_IN_SCRIPT = /node (\.\/Scripts\/Install\/[\w.-]+\.js)/g;

const TEMPLATE = fs.readFileSync(
  path.join(REPO_ROOT, "config.example.env"),
  "utf8",
);
const ROOT_PACKAGE = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);
const GUIDE = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "packages/App/FeatureSet/Docs/Content/en/installation/docker-compose.md",
  ),
  "utf8",
);

// What the Docker Compose guide had a proxy on the same server set before.
const EARLIER_GUIDE_SETTINGS = [
  "ONEUPTIME_HTTP_PORT=8080",
  "STATUS_PAGE_HTTPS_PORT=8443",
  "GLOBAL_PROBE_1_ONEUPTIME_URL=http://localhost:8080",
  "ONEUPTIME_RUNNER_ONEUPTIME_URL=http://localhost:8080",
  "HOST=oneuptime.example.com",
  "HTTP_PROTOCOL=https",
  "PROVISION_SSL=false",
  "TRUSTED_PROXY_HOPS=2",
];

// config.example.env with these lines after it: the last assignment wins.
function settingsWith(lines) {
  return readSettings(`${TEMPLATE}\n${lines.join("\n")}\n`);
}

function settingNamesOf(ports) {
  return ports.map((port) => {
    return port.setting;
  });
}

/*
 * The config.env blocks of the guide's "Use your own reverse proxy" steps,
 * as written: every `ini title="config.env"` fence between that heading and
 * the next heading of its level.
 */
function reverseProxyGuideSettings() {
  const lines = GUIDE.split("\n");
  const start = lines.indexOf("### Use your own reverse proxy");
  const end = lines.findIndex((line, index) => {
    return index > start && (line.startsWith("### ") || line.startsWith("## "));
  });
  const section = lines.slice(start, end);
  const settings = [];
  let inBlock = false;

  for (const line of section) {
    if (line === '```ini title="config.env"') {
      inBlock = true;
      continue;
    }

    if (inBlock && line === "```") {
      inBlock = false;
      continue;
    }

    if (inBlock) {
      settings.push(line);
    }
  }

  return settings;
}

describe("TRUSTED_PROXY_HOPS, read as OneUptime reads it", () => {
  test.each([
    [undefined, 1],
    ["", 1],
    ["   ", 1],
    ["1", 1],
    ["2", 2],
    [" 3 ", 3],
    ["0", 0],
    ["-1", 1],
    ["1.5", 1],
    ["two", 1],
    ["2abc", 1],
  ])("%p is %p", (value, hops) => {
    expect(trustedProxyHopsOf(value)).toBe(hops);
  });

  test("the rule is EnvironmentConfig's: empty is 1, and so is anything not a whole number of 0 or more", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "packages/Common/Server/EnvironmentConfig.ts"),
      "utf8",
    );

    expect(source).toContain('process.env["TRUSTED_PROXY_HOPS"]');
    expect(source).toContain(
      'if (rawValue === undefined || rawValue.trim() === "") {\n    return 1;\n  }',
    );
    expect(source).toContain(
      "!Number.isFinite(parsedValue) ||\n    !Number.isInteger(parsedValue) ||\n    parsedValue < 0",
    );
  });
});

describe("which installs are told", () => {
  test("a stock install, as config.example.env ships, is not", () => {
    expect(ingressPortsAroundProxy(readSettings(TEMPLATE))).toEqual([]);
    expect(trustedProxyHopsOf(readSettings(TEMPLATE).get(HOPS_SETTING))).toBe(
      1,
    );
  });

  test("a proxy on the server set up as the guide had it before is, for both ports, with the loopback values", () => {
    expect(
      ingressPortsAroundProxy(settingsWith(EARLIER_GUIDE_SETTINGS)),
    ).toEqual([
      {
        setting: "ONEUPTIME_HTTP_PORT",
        value: "8080",
        loopbackValue: "127.0.0.1:8080",
      },
      {
        setting: "STATUS_PAGE_HTTPS_PORT",
        value: "8443",
        loopbackValue: "127.0.0.1:8443",
      },
    ]);
  });

  test("a proxy on the server set up as the guide says now is not", () => {
    const guide = reverseProxyGuideSettings();

    // The guide's own blocks, read from the page.
    expect(guide).toEqual(
      expect.arrayContaining([
        "ONEUPTIME_HTTP_PORT=127.0.0.1:8080",
        "STATUS_PAGE_HTTPS_PORT=127.0.0.1:8443",
        "TRUSTED_PROXY_HOPS=2",
      ]),
    );
    expect(ingressPortsAroundProxy(settingsWith(guide))).toEqual([]);
  });

  test.each([
    ["the ports alone, two proxies counted", ["TRUSTED_PROXY_HOPS=3"], 2],
    [
      "one port moved and still on every address",
      ["TRUSTED_PROXY_HOPS=2", "STATUS_PAGE_HTTPS_PORT=127.0.0.1:8443"],
      1,
    ],
    [
      "values in quotes, as npm start exports them",
      [
        "TRUSTED_PROXY_HOPS='2'",
        'ONEUPTIME_HTTP_PORT="8080"',
        "STATUS_PAGE_HTTPS_PORT=127.0.0.1:8443",
      ],
      1,
    ],
    [
      "the last assignment of a name, as the shell reads it",
      ["TRUSTED_PROXY_HOPS=1", "TRUSTED_PROXY_HOPS=2"],
      2,
    ],
  ])("is told: %s", (_label, lines, count) => {
    const settings = settingsWith([
      "ONEUPTIME_HTTP_PORT=8080",
      "STATUS_PAGE_HTTPS_PORT=8443",
      ...lines,
    ]);

    expect(ingressPortsAroundProxy(settings)).toHaveLength(count);
  });

  // The ingress moved off its ports and on every address, as before.
  const MOVED = ["ONEUPTIME_HTTP_PORT=8080", "STATUS_PAGE_HTTPS_PORT=8443"];

  test.each([
    [
      "no proxy counted: everyone is the proxy, which the Health page says",
      [...MOVED, "TRUSTED_PROXY_HOPS=1"],
    ],
    ["TRUSTED_PROXY_HOPS=0", [...MOVED, "TRUSTED_PROXY_HOPS=0"]],
    ["TRUSTED_PROXY_HOPS empty", [...MOVED, "TRUSTED_PROXY_HOPS="]],
    [
      "a TRUSTED_PROXY_HOPS OneUptime does not read as a count",
      [...MOVED, "TRUSTED_PROXY_HOPS=two"],
    ],
    [
      "the ports on the loopback address",
      [
        "TRUSTED_PROXY_HOPS=2",
        "ONEUPTIME_HTTP_PORT=127.0.0.1:8080",
        "STATUS_PAGE_HTTPS_PORT=127.0.0.1:8443",
      ],
    ],
    [
      "the ports on the IPv6 loopback address",
      [
        "TRUSTED_PROXY_HOPS=2",
        "ONEUPTIME_HTTP_PORT=[::1]:8080",
        "STATUS_PAGE_HTTPS_PORT=[::1]:8443",
      ],
    ],
    [
      "the ports on an address the operator names, behind a firewall",
      [
        "TRUSTED_PROXY_HOPS=2",
        "ONEUPTIME_HTTP_PORT=0.0.0.0:8080",
        "STATUS_PAGE_HTTPS_PORT=10.0.0.5:8443",
      ],
    ],
    [
      "ports 80 and 443: a proxy on another machine, behind a firewall",
      [
        "TRUSTED_PROXY_HOPS=2",
        "ONEUPTIME_HTTP_PORT=80",
        "STATUS_PAGE_HTTPS_PORT=443",
      ],
    ],
    [
      "a commented-out port",
      [
        "TRUSTED_PROXY_HOPS=2",
        "# ONEUPTIME_HTTP_PORT=8080",
        "#STATUS_PAGE_HTTPS_PORT=8443",
      ],
    ],
    [
      "empty ports",
      [
        "TRUSTED_PROXY_HOPS=2",
        "ONEUPTIME_HTTP_PORT=",
        "STATUS_PAGE_HTTPS_PORT=",
      ],
    ],
  ])("is not told: %s", (_label, lines) => {
    expect(ingressPortsAroundProxy(settingsWith(lines))).toEqual([]);
  });

  test("the settings it reads are the ingress's port settings and their defaults in config.example.env and the compose file", () => {
    const template = readSettings(TEMPLATE);
    const compose = fs.readFileSync(
      path.join(REPO_ROOT, "docker-compose.base.yml"),
      "utf8",
    );

    expect(INGRESS_PORT_SETTINGS).toEqual([
      { setting: "ONEUPTIME_HTTP_PORT", defaultPort: "80" },
      { setting: "STATUS_PAGE_HTTPS_PORT", defaultPort: "443" },
    ]);

    for (const { setting, defaultPort } of INGRESS_PORT_SETTINGS) {
      expect([setting, template.get(setting)]).toEqual([setting, defaultPort]);
    }

    expect(compose).toContain('      - "${ONEUPTIME_HTTP_PORT}:7849"\n');
    expect(compose).toContain('      - "${STATUS_PAGE_HTTPS_PORT}:7850"\n');
  });
});

describe("what it says", () => {
  const ports = ingressPortsAroundProxy(settingsWith(EARLIER_GUIDE_SETTINGS));
  const message = describeIngressPortsAroundProxy(2, ports);

  test("the rule, the ports as they are, and the exact values that publish them on the loopback address", () => {
    expect(message).toBe(
      "  ! config.env sets TRUSTED_PROXY_HOPS=2, so OneUptime takes each visitor's address from what your proxy writes, " +
        "which holds only while that proxy is the one way in. " +
        "ONEUPTIME_HTTP_PORT=8080 and STATUS_PAGE_HTTPS_PORT=8443 publish OneUptime on every address of this server, around the proxy. " +
        "With the proxy on this server, publish them on the loopback address only: set ONEUPTIME_HTTP_PORT=127.0.0.1:8080 and " +
        "STATUS_PAGE_HTTPS_PORT=127.0.0.1:8443 in config.env, then run npm start. " +
        "If a firewall already lets only your proxy reach these ports, write the address they are published on instead, " +
        "such as ONEUPTIME_HTTP_PORT=0.0.0.0:8080, and this warning stops. " +
        "See https://oneuptime.com/docs/installation/docker-compose#use-your-own-reverse-proxy",
    );
  });

  test("one port in the singular", () => {
    const one = ingressPortsAroundProxy(
      settingsWith([
        ...EARLIER_GUIDE_SETTINGS,
        "STATUS_PAGE_HTTPS_PORT=127.0.0.1:8443",
      ]),
    );

    expect(describeIngressPortsAroundProxy(3, one)).toBe(
      "  ! config.env sets TRUSTED_PROXY_HOPS=3, so OneUptime takes each visitor's address from what your proxy writes, " +
        "which holds only while that proxy is the one way in. " +
        "ONEUPTIME_HTTP_PORT=8080 publishes OneUptime on every address of this server, around the proxy. " +
        "With the proxy on this server, publish it on the loopback address only: set ONEUPTIME_HTTP_PORT=127.0.0.1:8080 in config.env, then run npm start. " +
        "If a firewall already lets only your proxy reach this port, write the address it is published on instead, " +
        "such as ONEUPTIME_HTTP_PORT=0.0.0.0:8080, and this warning stops. " +
        "See https://oneuptime.com/docs/installation/docker-compose#use-your-own-reverse-proxy",
    );
  });

  test("the values it gives, applied, leave nothing to say", () => {
    const applied = ports.map((port) => {
      return `${port.setting}=${port.loopbackValue}`;
    });

    expect(
      ingressPortsAroundProxy(
        settingsWith([...EARLIER_GUIDE_SETTINGS, ...applied]),
      ),
    ).toEqual([]);
    // And so does the address it names for a firewall.
    expect(
      ingressPortsAroundProxy(
        settingsWith([
          ...EARLIER_GUIDE_SETTINGS,
          "ONEUPTIME_HTTP_PORT=0.0.0.0:8080",
          "STATUS_PAGE_HTTPS_PORT=0.0.0.0:8443",
        ]),
      ),
    ).toEqual([]);
  });

  test("it points to the guide's section that says how, which is there", () => {
    const url = new URL(REVERSE_PROXY_DOCS_URL);

    expect(url.origin).toBe("https://oneuptime.com");
    expect(url.pathname).toBe("/docs/installation/docker-compose");
    expect(url.hash).toBe("#use-your-own-reverse-proxy");
    expect(GUIDE.split("\n")).toContain("### Use your own reverse proxy");
  });
});

describe("run as a script", () => {
  function runIn(writeConfig) {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-ingress-ports-"),
    );

    try {
      writeConfig(directory);

      return spawnSync(process.execPath, [path.join(REPO_ROOT, SCRIPT_PATH)], {
        cwd: directory,
        encoding: "utf8",
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  test("an install set up as the guide had it before is warned, on stderr, and the start goes on", () => {
    const result = runIn((directory) => {
      fs.writeFileSync(
        path.join(directory, "config.env"),
        `${TEMPLATE}\n${EARLIER_GUIDE_SETTINGS.join("\n")}\n`,
      );
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `${describeIngressPortsAroundProxy(
        2,
        ingressPortsAroundProxy(settingsWith(EARLIER_GUIDE_SETTINGS)),
      )}\n`,
    );
  });

  test("a stock install hears nothing", () => {
    const result = runIn((directory) => {
      fs.writeFileSync(path.join(directory, "config.env"), TEMPLATE);
    });

    expect({
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    }).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  test("without a config.env, or with one it cannot read, it says nothing and never stops npm start", () => {
    for (const writeConfig of [
      () => {},
      (directory) => {
        // A directory where config.env should be: reading it throws EISDIR.
        fs.mkdirSync(path.join(directory, "config.env"));
      },
    ]) {
      const result = runIn(writeConfig);

      expect({
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      }).toEqual({ status: 0, stdout: "", stderr: "" });
    }
  });

  test("init reports what it warned about, and a file system that throws is passed over", () => {
    const warned = [];
    const files = {
      existsSync: () => {
        return true;
      },
      readFileSync: () => {
        return `${TEMPLATE}\n${EARLIER_GUIDE_SETTINGS.join("\n")}\n`;
      },
    };

    expect(
      settingNamesOf(
        init({
          fileSystem: files,
          warn: (line) => {
            warned.push(line);
          },
        }),
      ),
    ).toEqual(["ONEUPTIME_HTTP_PORT", "STATUS_PAGE_HTTPS_PORT"]);
    expect(warned).toHaveLength(1);

    expect(
      init({
        fileSystem: {
          existsSync: () => {
            throw new Error("EACCES");
          },
          readFileSync: () => {
            throw new Error("EACCES");
          },
        },
        warn: (line) => {
          warned.push(line);
        },
      }),
    ).toEqual([]);
    expect(warned).toHaveLength(1);
  });
});

describe("npm start runs it", () => {
  test("as a command of the start script, after the secrets are set and before config.env is exported and Compose starts", () => {
    const commands = ROOT_PACKAGE.scripts.start.split(" && ");
    const at = commands.indexOf(STEP);

    expect(at).toBeGreaterThan(-1);
    expect(commands.filter((command) => command === STEP)).toHaveLength(1);
    // Every command before it is an install step, the secrets' among them.
    expect(
      commands.slice(0, at).every((command) => {
        return INSTALL_STEP.test(command);
      }),
    ).toBe(true);
    expect(commands.slice(0, at)).toContain(
      "node ./Scripts/Install/ReplacePlaceholderSecrets.js",
    );
    expect(commands[at + 1]).toBe("export $(grep -v '^#' config.env | xargs)");
    expect(commands[at + 2].startsWith("docker compose up ")).toBe(true);
    expect(ROOT_PACKAGE.scripts.update).toMatch(/&& npm run start$/);
  });

  test("no other script and no hook runs it", () => {
    for (const [name, command] of Object.entries(ROOT_PACKAGE.scripts)) {
      if (name === "start") {
        continue;
      }

      expect({ name, runsIt: command.includes(SCRIPT_PATH) }).toEqual({
        name,
        runsIt: false,
      });
    }
  });

  /*
   * npm itself runs the root package's start script in a throwaway copy of
   * the repository's layout - its install steps, a config.env set up as the
   * guide had it before - with a `docker` on PATH that records its calls.
   */
  test("npm start warns such an install before Compose starts, and starts it anyway", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-npm-start-ports-"),
    );
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
      // The module every step marks its lines with.
      fs.copyFileSync(
        path.join(REPO_ROOT, "Scripts", "Install", "StartOutput.js"),
        path.join(directory, "Scripts", "Install", "StartOutput.js"),
      );
      fs.writeFileSync(
        path.join(directory, "config.env"),
        `${TEMPLATE}\n${EARLIER_GUIDE_SETTINGS.join("\n")}\n`,
      );
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({
          name: "npm-start-ingress-ports",
          version: "1.0.0",
          private: true,
          scripts: {
            start: ROOT_PACKAGE.scripts.start,
            "status-check": "echo status-check >> docker-calls.log",
          },
        }),
      );
      fs.mkdirSync(path.join(directory, "bin"));
      fs.writeFileSync(
        path.join(directory, "bin", "docker"),
        [
          "#!/bin/sh",
          `echo "$*" >> "${calls}"`,
          'case "$*" in',
          '  "compose run "*) echo oneuptime-database:created ;;',
          "esac",
          "exit 0",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );

      const env = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (!key.toLowerCase().startsWith("npm_")) {
          env[key] = value;
        }
      }
      env.PATH = `${path.join(directory, "bin")}${path.delimiter}${process.env.PATH}`;
      env.npm_config_update_notifier = "false";
      // The checks of the server have suites of their own (Preflight.test.js).
      env.ONEUPTIME_SKIP_PREFLIGHT = "true";

      const result = spawnSync("npm", ["start"], {
        cwd: directory,
        env,
        encoding: "utf8",
        timeout: 120 * 1000,
      });
      const output = `${result.stdout || ""}${result.stderr || ""}`;
      const recorded = fs.readFileSync(calls, "utf8").trim().split("\n");

      expect({ status: result.status }).toEqual({ status: 0 });
      expect(output).toContain(
        "  ! config.env sets TRUSTED_PROXY_HOPS=2, so OneUptime takes each visitor's address from what your proxy writes",
      );
      expect(output).toContain(
        "set ONEUPTIME_HTTP_PORT=127.0.0.1:8080 and STATUS_PAGE_HTTPS_PORT=127.0.0.1:8443 in config.env",
      );
      expect(recorded).toContain("compose up --remove-orphans -d");
      expect(recorded[recorded.length - 1]).toBe("status-check");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
