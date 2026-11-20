"use strict";

/**
 * `npm run doctor` (Scripts/Install/Doctor.js, #6826): what is wrong with a
 * Docker Compose install, worst first, each line with its fix, ending in one
 * line - "Everything looks right." or "3 things to fix." - and an exit code
 * scripts can use.
 *
 * Every check is tested with a passing and a failing fixture, then the
 * whole run with stubs (a healthy server says so in one line; the server of
 * the issue - HOST left at localhost, a certificate that failed, no email
 * and a stopped probe - names all four with their fixes), and once against
 * a real HTTP server standing in for the ingress. Nothing here starts
 * Docker or reaches the network.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  DOCTOR_PATH,
  READY_PATH,
  CERTIFICATE_WARN_DAYS,
  TROUBLESHOOTING_COVERAGE,
  MINIMUM_FREE_DISK_TO_RUN_BYTES,
  http2SettingOf,
  http2Findings,
  reminder,
  configFindings,
  containersOf,
  logLinesOf,
  serviceFindings,
  recentErrorsOf,
  publicUrlOf,
  ingressFindings,
  serverFixOf,
  serverFindings,
  productsFindings,
  addressFindings,
  proxyFindings,
  certificateFindings,
  diskFindings,
  summaryOf,
  linesOf,
  finding,
  defaultRequest,
  run,
} = require("../../Scripts/Install/Doctor");
const {
  readSettings,
} = require("../../Scripts/Install/ReplacePlaceholderSecrets");

const REPO_ROOT = path.resolve(__dirname, "../..");
const ROOT_PACKAGE = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);
const TEMPLATE = fs.readFileSync(
  path.join(REPO_ROOT, "config.example.env"),
  "utf8",
);

const SECRET = "a".repeat(64);
const NOW = new Date("2026-11-12T10:00:00.000Z");
const SERVICES = [
  "postgres",
  "valkey",
  "clickhouse",
  "app",
  "probe-1",
  "global-runner",
  "ingress",
];

const settingsOf = (lines) => {
  return readSettings(lines.join("\n"));
};

// A config.env as `npm start` leaves it: every secret its own.
const healthyConfig = (overrides) => {
  const lines = [
    "HOST=oneuptime.example.com",
    "HTTP_PROTOCOL=https",
    "PROVISION_SSL=true",
    `ONEUPTIME_SECRET=${SECRET}`,
    `ENCRYPTION_SECRET=${"b".repeat(64)}`,
    `DATABASE_PASSWORD=${"c".repeat(64)}`,
    `CLICKHOUSE_PASSWORD=${"d".repeat(64)}`,
    `VALKEY_PASSWORD=${"e".repeat(64)}`,
    `REGISTER_PROBE_KEY=${"f".repeat(64)}`,
    `GLOBAL_PROBE_1_KEY=${"1".repeat(64)}`,
    `GLOBAL_PROBE_2_KEY=${"2".repeat(64)}`,
    `GLOBAL_RUNNER_KEY=${"3".repeat(64)}`,
  ];

  return lines.concat(overrides || []).join("\n");
};

const workspace = (config) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-"));

  if (config !== null) {
    fs.writeFileSync(path.join(directory, "config.env"), config);
  }

  return directory;
};

const running = (service, extra) => {
  return Object.assign(
    { Service: service, State: "running", Health: "", ExitCode: 0 },
    extra || {},
  );
};

/*
 * A fake `docker`: { containers, logs: { service: text }, free (bytes),
 * dockerFails } -> runCommand(command, args), recording each call.
 */
const fakeDocker = (state) => {
  const calls = [];
  const given = state || {};
  const containers =
    given.containers ||
    SERVICES.map((service) => {
      return running(service);
    });

  const runCommand = (command, args) => {
    calls.push([command].concat(args).join(" "));
    const ok = (stdout) => {
      return { status: 0, stdout: stdout, stderr: "" };
    };

    if (command === "df") {
      return ok(
        `Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 500000000 100000000 ${Math.round((given.free === undefined ? 200 * 1000 * 1000 * 1000 : given.free) / 1024)} 20% /`,
      );
    }

    if (args[0] === "info") {
      return given.dockerFails
        ? {
            status: 1,
            stdout: "",
            stderr:
              "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
          }
        : ok("29.0.1|16000000000|/var/lib/docker");
    }

    if (args[0] === "compose" && args[1] === "version") {
      return ok("2.29.7");
    }

    if (args[0] === "compose" && args[1] === "config") {
      return ok(`${SERVICES.join("\n")}\n`);
    }

    if (args[0] === "compose" && args[1] === "ps") {
      return ok(
        containers
          .map((container) => {
            return JSON.stringify(container);
          })
          .join("\n"),
      );
    }

    if (args[0] === "compose" && args[1] === "logs") {
      const service = args[args.length - 1];
      const logs = given.logs || {};

      if (logs[service] !== undefined) {
        return ok(logs[service]);
      }

      return ok(given.allLogs || "");
    }

    return { status: 1, stdout: "", stderr: `unexpected ${command}` };
  };

  return { runCommand: runCommand, calls: calls };
};

// The server's answer: a healthy one, or with these findings.
const serverAnswer = (findings, extra) => {
  return Object.assign(
    {
      findings: findings || [],
      checked: ["postgres", "clickhouse", "valkey"],
      version: {
        current: "14.0.108",
        latest: "14.0.108",
        isUpdateAvailable: false,
        isUpdateCheckDisabled: false,
      },
      addressProof: "0123abcd.signature",
      checkedAt: NOW.toISOString(),
    },
    extra || {},
  );
};

const EMAIL_NOT_SET_UP = {
  id: "setup-email",
  level: "fix",
  title: "Email",
  words:
    "Not set up yet: OneUptime cannot send invitations, password resets or alerts by email.",
  fix: "Finish it on the Server setup page.",
  values: {},
  adminPath: "/admin/settings/smtp",
  guidePath: null,
  sentence:
    "Not set up yet: OneUptime cannot send invitations, password resets or alerts by email.",
  fixSentence: "Finish it on the Server setup page.",
};

const PROBES_NOT_REPORTING = {
  id: "setup-probes",
  level: "warn",
  title: "Probes",
  words:
    "No global probe is reporting, so monitors that run on global probes are not checked.",
  fix: "Finish it on the Server setup page.",
  values: {},
  adminPath: "/admin/settings/probes",
  guidePath: null,
  sentence:
    "No global probe is reporting, so monitors that run on global probes are not checked.",
  fixSentence: "Finish it on the Server setup page.",
};

/*
 * How the app answers a GET of the doctor's path without a master admin's
 * session: the GET is the Admin Dashboard's, and the cluster key opens only
 * the POST.
 */
const GET_OF_THE_DOCTORS_PATH = {
  status: 401,
  body: JSON.stringify({ message: "Unauthorized: Access token is required." }),
  json: { message: "Unauthorized: Access token is required." },
};

/*
 * A fake network: { ready, doctor, address } are the answers to the ready
 * check, the server's answer (to a POST, as the app answers) and the address
 * check; every request is recorded with its method and headers.
 */
const fakeNetwork = (answers) => {
  const given = answers || {};
  const requests = [];

  const request = (url, options) => {
    const method = (options && options.method) || "GET";

    requests.push({
      url: url,
      method: method,
      headers: (options && options.headers) || {},
    });

    if (url.endsWith(READY_PATH)) {
      return Promise.resolve(
        given.ready === undefined ? { status: 200, body: "" } : given.ready,
      );
    }

    if (url.endsWith(DOCTOR_PATH)) {
      if (method !== "POST") {
        return Promise.resolve(GET_OF_THE_DOCTORS_PATH);
      }

      if (given.doctor !== undefined) {
        return Promise.resolve(given.doctor);
      }

      const answer = serverAnswer();
      return Promise.resolve({
        status: 200,
        body: JSON.stringify(answer),
        json: answer,
      });
    }

    if (url.indexOf("/status-page-api/custom-domain-readiness/") !== -1) {
      return Promise.resolve(
        given.address === undefined ? { status: 200, body: "" } : given.address,
      );
    }

    return Promise.resolve({ error: "ECONNREFUSED" });
  };

  return { request: request, requests: requests };
};

const VALID_CERTIFICATE = {
  authorized: true,
  authorizationError: null,
  subject: "oneuptime.example.com",
  issuer: "Let's Encrypt",
  validTo: "Feb 10 10:00:00 2027 GMT",
  altNames: "DNS:oneuptime.example.com",
};

/*
 * Runs the doctor with stubs; { code, output, docker, network, certificates },
 * the last the "hostname:port" of each certificate it asked for.
 */
const runDoctor = async (options) => {
  const given = options || {};
  const directory = workspace(
    given.config === undefined ? healthyConfig() : given.config,
  );
  const docker = fakeDocker(given.docker);
  const network = fakeNetwork(given.network);
  const certificates = [];
  const lines = [];

  try {
    const code = await run({
      cwd: directory,
      env: {},
      argv: given.argv || [],
      log: (line) => {
        lines.push(line);
      },
      runCommand: docker.runCommand,
      request: network.request,
      certificate: (hostname, port) => {
        certificates.push(`${hostname}:${port}`);

        return Promise.resolve(
          given.certificate === undefined
            ? VALID_CERTIFICATE
            : given.certificate,
        );
      },
      interfaces: {},
      now: NOW,
    });

    return {
      code: code,
      output: lines.join("\n"),
      docker: docker,
      network: network,
      certificates: certificates,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

describe("config.env", () => {
  test("a config.env npm start left says nothing", () => {
    expect(
      configFindings(settingsOf(healthyConfig().split("\n")), {}).filter(
        (entry) => {
          return entry.level !== "ok";
        },
      ),
    ).toEqual([]);
  });

  test("HOST left at localhost is worth a look, with the setting to change", () => {
    const findings = configFindings(
      settingsOf(["HOST=localhost", "HTTP_PROTOCOL=http"]),
      { eth0: [{ family: "IPv4", internal: false, address: "203.0.113.7" }] },
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("warn");
    expect(findings[0].message).toContain("HOST is localhost");
    expect(findings[0].message).toContain("HOST=203.0.113.7");
  });

  test("an empty HOST is something to fix", () => {
    const findings = configFindings(settingsOf(["HOST="]), {});

    expect(findings[0].level).toBe("fix");
    expect(findings[0].message).toContain("HOST in config.env is empty");
  });

  test("PROVISION_SSL with an IP address, and without HTTP_PROTOCOL=https, are each named", () => {
    const messages = configFindings(
      settingsOf([
        "HOST=203.0.113.7",
        "HTTP_PROTOCOL=http",
        "PROVISION_SSL=true",
      ]),
      {},
    ).map((entry) => {
      return entry.message;
    });

    expect(messages.join("\n")).toContain(
      "Let's Encrypt issues certificates for domain names only",
    );
    expect(messages.join("\n")).toContain("set HTTP_PROTOCOL=https too");
  });

  /*
   * An IPv6 HOST goes in brackets (#8022): the doctor says what npm start
   * stops on, as a thing to fix, with the line to write.
   */
  test("an IPv6 HOST without brackets is something to fix, with the line that brackets it", () => {
    expect(
      configFindings(
        settingsOf(["HOST=2001:db8::1", "HTTP_PROTOCOL=http"]),
        {},
      ),
    ).toEqual([
      finding(
        "fix",
        "HOST in config.env is 2001:db8::1, an IPv6 address without the brackets a web address needs around one, so no browser can open OneUptime at it. Write HOST=[2001:db8::1].",
      ),
    ]);
    expect(
      configFindings(
        settingsOf(["HOST=2001:db8::1:8080", "HTTP_PROTOCOL=http"]),
        {},
      )[0].message,
    ).toContain(
      "Write HOST=[2001:db8::1:8080], or HOST=[2001:db8::1]:8080 if 8080 is the port people open it on.",
    );
  });

  /*
   * A name that is not a domain name (#8877), which the app stops at as it
   * starts: the doctor says what npm start stops on, as a thing to fix.
   */
  test("a HOST with a character no domain name has is something to fix, saying which", () => {
    expect(
      configFindings(
        settingsOf(["HOST=oneuptime,example.com", "HTTP_PROTOCOL=http"]),
        {},
      ),
    ).toEqual([
      finding(
        "fix",
        'HOST in config.env is oneuptime,example.com, which is not a domain name: a domain name has the letters a to z, digits, hyphens and dots only, and "," is none of them.',
      ),
    ]);
    expect(
      configFindings(
        settingsOf(["HOST=bücher.example:8443", "HTTP_PROTOCOL=https"]),
        {},
      )[0].message,
    ).toContain("Write HOST=xn--bcher-kva.example:8443.");
  });

  test.each([
    "[2001:db8::1]",
    "[2001:db8::1]:8080",
    "203.0.113.7",
    "203.0.113.7:8080",
    "oneuptime.example.com",
    "oneuptime.example.com:8080",
    "one_uptime.example.com",
    "xn--bcher-kva.example:8080",
  ])("HOST=%s, with a port or without, says nothing", (host) => {
    expect(
      configFindings(settingsOf([`HOST=${host}`, "HTTP_PROTOCOL=https"]), {}),
    ).toEqual([]);
  });

  test("the ingress moved off port 80 while HOST has no port is named", () => {
    const messages = configFindings(
      settingsOf([
        "HOST=oneuptime.example.com",
        "HTTP_PROTOCOL=http",
        "ONEUPTIME_HTTP_PORT=8080",
      ]),
      {},
    ).map((entry) => {
      return entry.message;
    });

    expect(messages.join("\n")).toContain(
      "set HOST=oneuptime.example.com:8080",
    );
  });

  test("every secret still at config.example.env's placeholder is one thing to fix, naming each", () => {
    const findings = configFindings(readSettings(TEMPLATE), {});
    const secrets = findings.find((entry) => {
      return entry.message.indexOf("placeholder") !== -1;
    });

    expect(secrets.level).toBe("fix");
    expect(secrets.message).toContain("ONEUPTIME_SECRET");
    expect(secrets.message).toContain("GLOBAL_PROBE_1_KEY");
    // The bundled datastores' passwords: npm start gives them values too.
    expect(secrets.message).toContain("CLICKHOUSE_PASSWORD");
    expect(secrets.message).toContain("VALKEY_PASSWORD");
    expect(secrets.message).toContain("are still the placeholder");
    expect(secrets.fix).toBe(
      "Run npm start: it gives each its own random value and restarts OneUptime with it.",
    );
  });

  test("a placeholder DATABASE_PASSWORD is worth a look, with the guide that changes it in PostgreSQL too", () => {
    const findings = configFindings(
      settingsOf(
        healthyConfig([
          "DATABASE_PASSWORD=please-change-this-to-random-value",
        ]).split("\n"),
      ),
      {},
    );

    expect(findings).toEqual([
      finding(
        "warn",
        "DATABASE_PASSWORD in config.env is still the placeholder config.example.env ships, which everybody knows.",
        "Change it in PostgreSQL and in config.env together: https://oneuptime.com/docs/installation/docker-compose#change-the-database-password",
      ),
    ]);
  });

  test("the password of a datastore OneUptime does not run is not npm start's to change", () => {
    const findings = configFindings(
      settingsOf(
        healthyConfig([
          "CLICKHOUSE_HOST=clickhouse.internal.example.com",
          "CLICKHOUSE_PASSWORD=please-change-this-to-random-value",
        ]).split("\n"),
      ),
      {},
    );

    expect(findings).toEqual([]);
  });

  test("one placeholder says is", () => {
    const findings = configFindings(
      settingsOf(
        healthyConfig([
          "ONEUPTIME_SECRET=please-change-this-to-random-value",
        ]).split("\n"),
      ),
      {},
    );

    expect(findings.map((entry) => entry.message)).toContain(
      "ONEUPTIME_SECRET in config.env is still the placeholder config.example.env ships, which everybody knows.",
    );
  });
});

describe("the services", () => {
  const noLogs = () => {
    return [];
  };

  test("every service running and healthy is one passing line", () => {
    const findings = serviceFindings(
      SERVICES,
      SERVICES.map((service) => {
        return running(
          service,
          service === "postgres" ? { Health: "healthy" } : {},
        );
      }),
      noLogs,
    );

    expect(findings).toEqual([
      finding("ok", `Every service is running: ${SERVICES.join(", ")}.`),
    ]);
  });

  test("a service with no container is something to fix: npm start starts it", () => {
    const findings = serviceFindings(
      ["app", "probe-1"],
      [running("app")],
      noLogs,
    );

    expect(findings).toEqual([
      finding(
        "fix",
        "The probe-1 service is not running: it has no container.",
        "Run npm start to start every service.",
      ),
    ]);
  });

  test("a stopped service says its exit code and shows the last lines of its log", () => {
    const findings = serviceFindings(
      ["probe-1"],
      [running("probe-1", { State: "exited", ExitCode: 137 })],
      (service) => {
        return [`${service}: out of memory`];
      },
    );

    expect(findings[0].level).toBe("fix");
    expect(findings[0].message).toBe(
      "The probe-1 service stopped (exit code 137). Its last lines:",
    );
    expect(findings[0].details).toEqual(["probe-1: out of memory"]);
    expect(findings[0].fix).toContain("npm run logs --services=probe-1");
    expect(findings[0].fix).toContain("npm start");
  });

  test("a service that keeps restarting, and one that fails its health check, are each something to fix", () => {
    const findings = serviceFindings(
      ["app", "postgres"],
      [
        running("app", { State: "restarting" }),
        running("postgres", { Health: "unhealthy" }),
      ],
      noLogs,
    );

    expect(findings.map((entry) => entry.level)).toEqual(["fix", "fix"]);
    expect(findings[0].message).toContain("keeps restarting");
    expect(findings[1].message).toContain("fails its health check");
  });

  test("a service still starting is worth a look, not a fault", () => {
    const findings = serviceFindings(
      ["clickhouse"],
      [running("clickhouse", { Health: "starting" })],
      noLogs,
    );

    expect(findings).toEqual([
      finding(
        "warn",
        "The clickhouse service is still starting.",
        "Wait a minute, then run npm run doctor again.",
      ),
    ]);
  });

  test("containers are read from Compose's JSON lines and from its older array", () => {
    const lines = `${JSON.stringify(running("app"))}\n${JSON.stringify(running("ingress"))}\n`;
    const array = JSON.stringify([running("app"), running("ingress")]);

    expect(containersOf(lines).map((entry) => entry.Service)).toEqual([
      "app",
      "ingress",
    ]);
    expect(containersOf(array).map((entry) => entry.Service)).toEqual([
      "app",
      "ingress",
    ]);
    expect(containersOf("")).toEqual([]);
    expect(containersOf("not json\n")).toEqual([]);
  });

  test("a log's lines lose Compose's service prefix and the blank lines, and keep the last ones", () => {
    const log = [
      "app-1  | first",
      "",
      "app-1  | second",
      "app-1  | Error: third | with a bar",
    ].join("\n");

    expect(logLinesOf(log, 2)).toEqual(["second", "Error: third | with a bar"]);
  });
});

describe("--logs: recent errors across services", () => {
  test("only the lines that report an error, the last few of each service, with the service named", () => {
    const log = [
      "app-1  | Server started",
      "app-1  | Error: connect ECONNREFUSED 10.0.0.2:5432",
      "ingress-1  | 2026/11/12 [error] upstream timed out",
      "probe-1-1  | Probe registered",
      "app-1  | Unhandled rejection: boom",
    ].join("\n");

    expect(recentErrorsOf(log)).toEqual([
      {
        service: "app",
        lines: [
          "Error: connect ECONNREFUSED 10.0.0.2:5432",
          "Unhandled rejection: boom",
        ],
      },
      { service: "ingress", lines: ["2026/11/12 [error] upstream timed out"] },
    ]);
  });

  test("a log without errors has none", () => {
    expect(recentErrorsOf("app-1  | all good\n")).toEqual([]);
  });

  test("at most five errors a service", () => {
    const log = Array.from({ length: 9 }, (_value, index) => {
      return `app-1  | Error number ${index}`;
    }).join("\n");

    expect(recentErrorsOf(log)[0].lines).toEqual([
      "Error number 4",
      "Error number 5",
      "Error number 6",
      "Error number 7",
      "Error number 8",
    ]);
  });
});

describe("OneUptime at the ingress", () => {
  test("ready is one passing line", () => {
    expect(ingressFindings("http://localhost", { status: 200 })).toEqual([
      finding("ok", "OneUptime answers at http://localhost."),
    ]);
  });

  test("no answer is something to fix, saying what came back", () => {
    const refused = ingressFindings("http://localhost:8080", {
      error: "ECONNREFUSED",
    })[0];
    const failing = ingressFindings("http://localhost", { status: 502 })[0];

    expect(refused.level).toBe("fix");
    expect(refused.message).toBe(
      "OneUptime does not answer at http://localhost:8080 on this server (connection refused), so nobody can use it.",
    );
    expect(failing.message).toContain("(HTTP 502)");
  });
});

describe("what the server says of itself", () => {
  const ok = (findings, extra) => {
    const answer = serverAnswer(findings, extra);
    return { status: 200, json: answer, body: JSON.stringify(answer) };
  };

  test("a healthy server: datastores, migrations, queues and setup in one passing line, and the version", () => {
    expect(serverFindings(ok([]), "https://oneuptime.example.com")).toEqual([
      finding(
        "ok",
        "PostgreSQL, ClickHouse and Valkey answer, migrations are complete, the queues are moving and the server is set up.",
      ),
      finding("ok", "OneUptime 14.0.108, the latest release."),
    ]);
  });

  test("each finding keeps its level, its title and its words, and a setup step says where to set it up", () => {
    const findings = serverFindings(
      ok([EMAIL_NOT_SET_UP, PROBES_NOT_REPORTING]),
      "https://oneuptime.example.com",
    );

    expect(findings[0]).toEqual(
      finding(
        "fix",
        "Email: Not set up yet: OneUptime cannot send invitations, password resets or alerts by email.",
        "Set it up at https://oneuptime.example.com/admin/settings/smtp",
      ),
    );
    expect(findings[1].level).toBe("warn");
    expect(findings[1].fix).toBe(
      "Set it up at https://oneuptime.example.com/admin/settings/probes",
    );
    // No passing line while something is wrong.
    expect(
      findings.filter((entry) => {
        return (
          entry.level === "ok" && entry.message.indexOf("PostgreSQL") === 0
        );
      }),
    ).toEqual([]);
  });

  test("a finding with a fix of its own says it, then where", () => {
    expect(
      serverFixOf(
        {
          id: "clickhouse-disk",
          fixSentence: "Give the disk more space.",
          adminPath: "/admin/health/clickhouse",
        },
        "http://203.0.113.7",
      ),
    ).toBe(
      "Give the disk more space. http://203.0.113.7/admin/health/clickhouse",
    );
    expect(
      serverFixOf(
        {
          id: "update-available",
          fixSentence: "Back up, then update.",
          guidePath: "/docs/installation/upgrading",
        },
        "http://203.0.113.7",
      ),
    ).toBe(
      "Back up, then update. https://oneuptime.com/docs/installation/upgrading",
    );
    expect(
      serverFixOf(
        {
          id: "setup-https",
          guidePath: "/docs/installation/docker-compose#set-up-https",
        },
        null,
      ),
    ).toBe(
      "See https://oneuptime.com/docs/installation/docker-compose#set-up-https",
    );
    expect(
      serverFixOf({ id: "postgres", fixSentence: "Check it." }, null),
    ).toBe("Check it.");
  });

  test("a row that is not a finding is left out", () => {
    expect(
      serverFindings(
        ok([null, { level: "fix" }, { level: "info", sentence: "x" }]),
        null,
      ).map((entry) => entry.level),
    ).toEqual(["ok", "ok"]);
  });

  test("an update is not called the latest release", () => {
    const findings = serverFindings(
      ok([], {
        version: {
          current: "14.0.100",
          latest: "14.0.108",
          isUpdateAvailable: true,
        },
      }),
      null,
    );

    expect(findings.map((entry) => entry.message).join("\n")).not.toContain(
      "latest release",
    );
  });

  test("a key OneUptime refuses: it runs with other settings than config.env's", () => {
    for (const status of [400, 401]) {
      const findings = serverFindings({ status: status, body: "" }, null);

      expect(findings[0].level).toBe("warn");
      expect(findings[0].message).toContain("did not accept ONEUPTIME_SECRET");
      expect(findings[0].fix).toContain("npm start");
    }
  });

  test("a version without the route: update", () => {
    expect(serverFindings({ status: 404, body: "" }, null)[0].fix).toContain(
      "npm run update",
    );
  });

  test("any other answer: the app's log", () => {
    const findings = serverFindings({ status: 500, body: "boom" }, null);

    expect(findings[0].message).toContain("(HTTP 500)");
    expect(findings[0].fix).toContain("npm run logs --services=app");
  });

  test("no answer at all says nothing: the ingress check already does", () => {
    expect(serverFindings({ error: "ECONNREFUSED" }, null)).toEqual([]);
  });
});

/*
 * #7481: which products the server switches off, from its own answer, so
 * that "where did Logs go?" is answered from the command line. A product an
 * admin switched off is no fault: a note, shown whenever there is one and
 * never counted. What SERVER_PRODUCTS got wrong, while it applies, is worth
 * a look.
 */
const TELEMETRY_OFF = [
  { product: "logs", title: "Logs" },
  { product: "metrics", title: "Metrics" },
  { product: "traces", title: "Traces" },
  { product: "profiles", title: "Profiles" },
  { product: "exceptions", title: "Exceptions" },
];

const products = (overrides) => {
  return Object.assign(
    {
      switchableCount: 44,
      onCount: 44,
      preset: "everything",
      presetTitle: "Everything",
      source: "starting-value",
      switchedOff: [],
      unknownNames: [],
      isTelemetryIngestionStopped: false,
      offByIngestion: [],
      shouldSuggestStoppingIngestion: false,
    },
    overrides || {},
  );
};

const MONITORING_ONLY = products({
  onCount: 5,
  preset: "monitoring-and-status-pages",
  presetTitle: "Monitoring and status pages",
  source: "saved",
  switchedOff: TELEMETRY_OFF.concat([{ product: "alerts", title: "Alerts" }]),
});

describe("the products switched off on the server", () => {
  const PUBLIC_URL = "https://oneuptime.example.com";

  test("every product on is one passing line", () => {
    expect(productsFindings(products(), PUBLIC_URL)).toEqual([
      finding("ok", "Products: every product is switched on."),
    ]);
  });

  test("a preset an admin saved: its name, how many are on, and where to change it", () => {
    expect(productsFindings(MONITORING_ONLY, PUBLIC_URL)).toEqual([
      finding(
        "note",
        "Products: Monitoring and status pages (5 of 44 on), set in the Admin Dashboard at https://oneuptime.example.com/admin/settings/products.",
      ),
    ]);
  });

  test("without an address to name, it says only where", () => {
    expect(productsFindings(MONITORING_ONLY, null)[0].message).toBe(
      "Products: Monitoring and status pages (5 of 44 on), set in the Admin Dashboard.",
    );
  });

  test("set by SERVER_PRODUCTS, it says so", () => {
    expect(
      productsFindings(
        Object.assign({}, MONITORING_ONLY, { source: "starting-value" }),
        PUBLIC_URL,
      )[0].message,
    ).toBe(
      "Products: Monitoring and status pages (5 of 44 on), set by SERVER_PRODUCTS in config.env.",
    );
  });

  test.each([
    [[{ product: "logs", title: "Logs" }], "Switched off: Logs."],
    [TELEMETRY_OFF.slice(0, 2), "Switched off: Logs and Metrics."],
    [
      TELEMETRY_OFF.concat([
        { product: "alerts", title: "Alerts" },
        { product: "slos", title: "SLOs" },
        { product: "workflows", title: "Workflows" },
      ]),
      "Switched off: Logs, Metrics, Traces, Profiles, Exceptions, Alerts and 2 more.",
    ],
  ])(
    "a choice of one's own names what is switched off: %j",
    (switchedOff, named) => {
      const found = productsFindings(
        products({
          onCount: 44 - switchedOff.length,
          preset: null,
          presetTitle: null,
          source: "saved",
          switchedOff: switchedOff,
        }),
        PUBLIC_URL,
      );

      expect(found.length).toBe(1);
      expect(found[0].level).toBe("note");
      expect(found[0].message).toBe(
        `Products: ${44 - switchedOff.length} of 44 on, set in the Admin Dashboard at https://oneuptime.example.com/admin/settings/products. ${named}`,
      );
    },
  );

  test("names SERVER_PRODUCTS held that OneUptime did not know are worth a look, with the names and the fix", () => {
    const found = productsFindings(
      products({ unknownNames: ["monitor", "statuspages"] }),
      PUBLIC_URL,
    );

    expect(found).toEqual([
      finding("ok", "Products: every product is switched on."),
      finding(
        "warn",
        "SERVER_PRODUCTS in config.env names what OneUptime does not know, so it left them out: monitor, statuspages.",
        "Use everything, monitoring-and-status-pages, incident-response, or product keys such as monitors,incidents,status-pages, then run npm start. See https://oneuptime.com/docs/installation/docker-compose#run-only-what-you-need",
      ),
    ]);
  });

  test("one unknown name is said as one", () => {
    expect(
      productsFindings(products({ unknownNames: ["monitor"] }), PUBLIC_URL)[1]
        .message,
    ).toContain("so it left it out: monitor.");
  });

  test("once an admin saved the page, SERVER_PRODUCTS no longer applies, and what it got wrong is not said", () => {
    expect(
      productsFindings(
        Object.assign({}, MONITORING_ONLY, { unknownNames: ["monitor"] }),
        PUBLIC_URL,
      ).map((entry) => {
        return entry.level;
      }),
    ).toEqual(["note"]);
  });

  test("telemetry ingestion stopped is a note naming the products it turns off", () => {
    expect(
      productsFindings(
        products({
          isTelemetryIngestionStopped: true,
          offByIngestion: TELEMETRY_OFF,
        }),
        PUBLIC_URL,
      ),
    ).toEqual([
      finding("ok", "Products: every product is switched on."),
      finding(
        "note",
        "Telemetry ingestion is stopped (DISABLE_TELEMETRY_INGESTION=true), so Logs, Metrics, Traces, Profiles and Exceptions are off for every project.",
      ),
    ]);
  });

  test("every telemetry product switched off while ingestion runs is a note with how to save memory", () => {
    const found = productsFindings(
      Object.assign({}, MONITORING_ONLY, {
        shouldSuggestStoppingIngestion: true,
      }),
      PUBLIC_URL,
    );

    expect(found[1]).toEqual(
      finding(
        "note",
        "Every telemetry product is switched off, but telemetry ingestion still runs. You can also stop it to save memory: set DISABLE_TELEMETRY_INGESTION=true in config.env, then run npm start.",
      ),
    );
  });

  test.each([
    ["an older server, which does not say", undefined],
    ["a server that could not read them", null],
    ["an answer that is no object", "everything"],
  ])("nothing is said for %s", (_label, value) => {
    expect(productsFindings(value, PUBLIC_URL)).toEqual([]);
  });

  test("npm run doctor prints the note on a healthy server, counts it as nothing, and exits 0", async () => {
    const answer = serverAnswer([], { products: MONITORING_ONLY });
    const result = await runDoctor({
      network: {
        doctor: { status: 200, body: JSON.stringify(answer), json: answer },
      },
    });

    expect(result.output).toBe(
      [
        "Checking this OneUptime:",
        "  • Products: Monitoring and status pages (5 of 44 on), set in the Admin Dashboard at https://oneuptime.example.com/admin/settings/products.",
        "",
        "Everything looks right.",
      ].join("\n"),
    );
    expect(result.code).toBe(0);
  });

  test("the note comes after what needs attention", async () => {
    const answer = serverAnswer([EMAIL_NOT_SET_UP], {
      products: products({ unknownNames: ["monitor"] }),
    });
    const result = await runDoctor({
      network: {
        doctor: { status: 200, body: JSON.stringify(answer), json: answer },
      },
    });
    const marks = result.output
      .split("\n")
      .filter((line) => {
        return /^ {2}[✗!•✓] /.test(line);
      })
      .map((line) => {
        return line.slice(2, 3);
      });

    expect(marks).toEqual(["✗", "!"]);
    expect(result.output).toContain("1 thing to fix, and 1 worth a look.");
  });

  test("after npm start, a note is not said: only what needs attention is", async () => {
    const answer = serverAnswer([], { products: MONITORING_ONLY });
    const result = await runDoctor({
      argv: ["--after-start"],
      network: {
        doctor: { status: 200, body: JSON.stringify(answer), json: answer },
      },
    });

    expect(result.output).not.toContain("Products:");
    expect(result.output).toBe("✓ Everything looks right.");
    expect(result.code).toBe(0);

    // Nor beside something that does need attention.
    const withProblem = serverAnswer([EMAIL_NOT_SET_UP], {
      products: MONITORING_ONLY,
    });
    const problem = await runDoctor({
      argv: ["--after-start"],
      network: {
        doctor: {
          status: 200,
          body: JSON.stringify(withProblem),
          json: withProblem,
        },
      },
    });

    expect(problem.output).toContain("What needs attention on this server:");
    expect(problem.output).toContain("✗ Email: Not set up yet");
    expect(problem.output).not.toContain("Products:");
  });

  test("--all says every product is on", async () => {
    const answer = serverAnswer([], { products: products() });
    const result = await runDoctor({
      argv: ["--all"],
      network: {
        doctor: { status: 200, body: JSON.stringify(answer), json: answer },
      },
    });

    expect(result.output).toContain(
      "  ✓ Products: every product is switched on.",
    );
  });
});

describe("HOST, from outside the containers", () => {
  test("HOST answering the server's proof is this OneUptime", () => {
    expect(
      addressFindings("https://oneuptime.example.com", { status: 200 }),
    ).toEqual([
      finding("ok", "https://oneuptime.example.com reaches this OneUptime."),
    ]);
  });

  test("HOST answering something else is another server or a proxy that does not pass requests on", () => {
    const found = addressFindings("https://oneuptime.example.com", {
      status: 404,
    })[0];

    expect(found.level).toBe("fix");
    expect(found.message).toContain(
      "answers (HTTP 404), but not as this OneUptime",
    );
    expect(found.fix).toContain("Point HOST's DNS record at this server");
  });

  test("HOST this server cannot open is worth a look, with the reason", () => {
    const found = addressFindings("https://oneuptime.example.com", {
      error: "ENOTFOUND",
    })[0];

    expect(found.level).toBe("warn");
    expect(found.message).toContain("(the name does not resolve)");
  });
});

/*
 * #7050: the server says how the doctor's request to HOST reached it - the
 * host name and whether it took it for HTTPS - so a proxy in front that does
 * not pass them on is named, with the fix for the proxies people run.
 */
describe("a proxy in front of OneUptime", () => {
  const PUBLIC_URL = "https://oneuptime.example.com";
  const reachedAs = (request) => {
    const json = { proof: "0123abcd.signature", request: request };

    return { status: 200, body: JSON.stringify(json), json: json };
  };

  test("that passes on the host name and HTTPS is one passing line", () => {
    expect(
      proxyFindings(
        PUBLIC_URL,
        "oneuptime.example.com",
        reachedAs({ host: "oneuptime.example.com", isHttps: true }),
      ),
    ).toEqual([
      finding(
        "ok",
        "Requests to https://oneuptime.example.com reach OneUptime with their host name and as HTTPS.",
      ),
    ]);
  });

  test.each([
    ["the proxy's upstream address", "127.0.0.1"],
    ["the proxy's own name for OneUptime", "oneuptime-upstream"],
    ["another site's name", "status.example.org"],
  ])(
    "that sends %s instead of the host name is something to fix: HOST's visitors are served as a status page's domain",
    (_label, seenHost) => {
      const found = proxyFindings(
        PUBLIC_URL,
        "oneuptime.example.com",
        reachedAs({ host: seenHost, isHttps: true }),
      );

      expect(found.length).toBe(1);
      expect(found[0].level).toBe("fix");
      expect(found[0].message).toBe(
        `A proxy in front of OneUptime changes the host name: a request to https://oneuptime.example.com reached OneUptime as ${seenHost}, so people who open https://oneuptime.example.com get "OneUptime is not set up for this address", and signing in fails.`,
      );
      expect(found[0].fix).toContain("proxy_set_header Host $host;");
      expect(found[0].fix).toContain("ProxyPreserveHost On");
      expect(found[0].fix).toContain(
        "https://oneuptime.com/docs/installation/docker-compose#use-your-own-reverse-proxy",
      );
    },
  );

  test.each(["localhost", "ingress"])(
    "that sends %s, a name OneUptime's ingress still serves the dashboard on, is worth a look: custom domains cannot work through it",
    (seenHost) => {
      const found = proxyFindings(
        PUBLIC_URL,
        "oneuptime.example.com",
        reachedAs({ host: seenHost, isHttps: true }),
      );

      expect(found.length).toBe(1);
      expect(found[0].level).toBe("warn");
      expect(found[0].message).toContain(`reached OneUptime as ${seenHost}.`);
      expect(found[0].message).toContain(
        "status pages and dashboards on their own domains cannot be served through this proxy",
      );
    },
  );

  test("that sends no host name OneUptime can read is something to fix", () => {
    const found = proxyFindings(
      PUBLIC_URL,
      "oneuptime.example.com",
      reachedAs({ host: null, isHttps: true }),
    );

    expect(found[0].level).toBe("fix");
    expect(found[0].message).toContain(
      "reached OneUptime with no host name it could read",
    );
  });

  test.each([
    [
      "with a port in HOST",
      "oneuptime.example.com:8443",
      "oneuptime.example.com",
    ],
    ["in other capitals", "OneUptime.Example.com", "oneuptime.example.com"],
    ["with a trailing dot", "oneuptime.example.com.", "oneuptime.example.com"],
    ["an IPv6 address in brackets", "[2001:db8::1]:8443", "[2001:db8::1]"],
    [
      "an IPv6 address the server names without them",
      "[2001:db8::1]",
      "2001:db8::1",
    ],
  ])(
    "the same host name %s is the host name passed on",
    (_label, host, seenHost) => {
      expect(
        proxyFindings(
          PUBLIC_URL,
          host,
          reachedAs({ host: seenHost, isHttps: true }),
        ).map((entry) => {
          return entry.level;
        }),
      ).toEqual(["ok"]);
    },
  );

  test("that ends TLS and drops X-Forwarded-Proto is worth a look, with what goes wrong and the fix", () => {
    const found = proxyFindings(
      PUBLIC_URL,
      "oneuptime.example.com",
      reachedAs({ host: "oneuptime.example.com", isHttps: false }),
    );

    expect(found.length).toBe(1);
    expect(found[0].level).toBe("warn");
    expect(found[0].message).toBe(
      "A proxy in front of OneUptime drops X-Forwarded-Proto: OneUptime took an HTTPS request to https://oneuptime.example.com for plain HTTP. Links it writes for status pages start with http://, the sign-in cookies of status pages and dashboards on custom domains are not kept on HTTPS, and Twilio's calls to incoming call policies are refused.",
    );
    expect(found[0].fix).toContain("X-Forwarded-Proto: https");
    expect(found[0].fix).toContain(
      "proxy_set_header X-Forwarded-Proto $scheme;",
    );
    expect(found[0].fix).toContain("Caddy, Traefik and cloud load balancers");
  });

  test("both at once are both said, the host name first", () => {
    expect(
      proxyFindings(
        PUBLIC_URL,
        "oneuptime.example.com",
        reachedAs({ host: "127.0.0.1", isHttps: false }),
      ).map((entry) => {
        return entry.level;
      }),
    ).toEqual(["fix", "warn"]);
  });

  test("over plain HTTP, the scheme is not asked about", () => {
    expect(
      proxyFindings(
        "http://oneuptime.example.com",
        "oneuptime.example.com",
        reachedAs({ host: "oneuptime.example.com", isHttps: false }),
      ),
    ).toEqual([
      finding(
        "ok",
        "Requests to http://oneuptime.example.com reach OneUptime with their host name.",
      ),
    ]);
  });

  test.each([
    [
      "HOST did not reach this OneUptime",
      { status: 404, body: "", json: null },
    ],
    ["no answer", { error: "ETIMEDOUT" }],
    [
      "an older server, which does not say how the request arrived",
      { status: 200, body: "{}", json: { proof: "0123abcd.signature" } },
    ],
    ["an answer that is no JSON", { status: 200, body: "OK", json: null }],
  ])("nothing is said when %s", (_label, response) => {
    expect(
      proxyFindings(PUBLIC_URL, "oneuptime.example.com", response),
    ).toEqual([]);
  });
});

describe("the certificate, when PROVISION_SSL is on", () => {
  test("issued and far from expiry: who issued it and until when", () => {
    expect(
      certificateFindings("oneuptime.example.com", VALID_CERTIFICATE, NOW, []),
    ).toEqual([
      finding(
        "ok",
        "The certificate for oneuptime.example.com, from Let's Encrypt, is valid until 2027-02-10.",
      ),
    ]);
  });

  test("not issued: the reason from the app's log, and what Let's Encrypt needs", () => {
    const found = certificateFindings(
      "oneuptime.example.com",
      {
        authorized: false,
        authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT",
        validTo: "Feb 10 10:00:00 2027 GMT",
      },
      NOW,
      ["CoreSSL:EnsurePrimaryHostCertificate: DNS problem: NXDOMAIN"],
    )[0];

    expect(found.level).toBe("fix");
    expect(found.message).toContain("is not issued yet");
    expect(found.message).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(found.message).toContain("The app's last lines about it:");
    expect(found.details).toEqual([
      "CoreSSL:EnsurePrimaryHostCertificate: DNS problem: NXDOMAIN",
    ]);
    expect(found.fix).toContain("port 80 is open to the internet");
  });

  test("no HTTPS at all is something to fix", () => {
    const found = certificateFindings(
      "oneuptime.example.com",
      { error: "ECONNREFUSED" },
      NOW,
      [],
    )[0];

    expect(found.level).toBe("fix");
    expect(found.message).toContain("does not answer over HTTPS on port 443");
  });

  test(`expiring within ${CERTIFICATE_WARN_DAYS} days is worth a look; expired is something to fix`, () => {
    const soon = certificateFindings(
      "oneuptime.example.com",
      Object.assign({}, VALID_CERTIFICATE, {
        validTo: "Nov 20 10:00:00 2026 GMT",
      }),
      NOW,
      [],
    )[0];
    const expired = certificateFindings(
      "oneuptime.example.com",
      Object.assign({}, VALID_CERTIFICATE, {
        validTo: "Nov 01 10:00:00 2026 GMT",
      }),
      NOW,
      [],
    )[0];

    expect(soon.level).toBe("warn");
    expect(soon.message).toContain("expires on 2026-11-20, in 8 days");
    expect(expired.level).toBe("fix");
    expect(expired.message).toContain("expired on 2026-11-01");
  });

  /*
   * PROVISION_SSL as the app (EnvironmentConfig's ProvisionSsl) and the
   * ingress (run.sh) read it: "true" alone. The doctor took yes, 1 and on
   * as well, asked HOST for a certificate neither of them serves, and
   * reported "PROVISION_SSL=true, but ... does not answer over HTTPS".
   */
  test.each(["yes", "1", "on", "TRUE", "True"])(
    "PROVISION_SSL=%s, which OneUptime reads as off, asks for no certificate",
    async (value) => {
      const result = await runDoctor({
        config: healthyConfig([`PROVISION_SSL=${value}`]),
        certificate: { error: "ECONNREFUSED" },
      });

      expect(result.certificates).toEqual([]);
      expect(result.output).not.toContain("does not answer over HTTPS");
      expect(result.code).toBe(0);
    },
  );

  test.each(["true", " true ", '"true"'])(
    "PROVISION_SSL=%s asks HOST for its certificate on port 443",
    async (value) => {
      const result = await runDoctor({
        config: healthyConfig([`PROVISION_SSL=${value}`]),
      });

      expect(result.certificates).toEqual(["oneuptime.example.com:443"]);
    },
  );
});

/*
 * #9973: NGINX_HTTP2=off turns HTTP/2 off for HOST on the ingress, for when
 * nginx fixes a vulnerability in HTTP/2 and OneUptime cannot be upgraded yet
 * (#9846). It lasts through restarts and upgrades until it is set back, and
 * OTLP over gRPC to HOST is refused meanwhile, so the doctor reminds of it -
 * a note, no fault - and so does npm start. Only with PROVISION_SSL=true:
 * otherwise the ingress serves no HTTPS for HOST, and the setting changes
 * nothing. The setting is read as the ingress's envsubst-on-templates.sh
 * reads it, and the tests hold the two to each other.
 */
const ENVSUBST_SCRIPT = path.join(
  REPO_ROOT,
  "packages",
  "Nginx",
  "envsubst-on-templates.sh",
);
const WITH_CONFIG = path.join(REPO_ROOT, "Scripts", "Install", "WithConfig.sh");

// Every way to write off that the ingress takes: off, false, no and 0, in any case and with whitespace anywhere.
const HTTP2_OFF = [
  "off",
  "OFF",
  "Off",
  "oFf",
  "false",
  "FALSE",
  "False",
  "no",
  "NO",
  "No",
  "0",
  " off ",
  "\toff\t",
  "o f f",
  "F A L S E",
];
// And every way to keep it on: on, true, yes, 1, or nothing.
const HTTP2_ON = [
  "",
  "on",
  "ON",
  "On",
  "true",
  "TRUE",
  "yes",
  "YES",
  "1",
  " on ",
];
// Anything else, which the ingress reads as on, and warns of in its log.
const HTTP2_UNKNOWN = [
  "disabled",
  "offf",
  "2",
  "off;",
  "off; listen 1234",
  "nope",
  "-",
  // A space beyond ASCII is no space to the ingress's tr.
  "off ",
];

/*
 * What the ingress's own script makes of NGINX_HTTP2: "off", "on" or
 * "unknown", from what it logs. Without PROVISION_SSL, so it needs no
 * certificate: it says that off changes nothing, and warns of an unknown
 * value. `config`, when given, is a config.env, run through WithConfig.sh
 * as npm start hands it to Compose.
 */
const ingressReadsHttp2 = (value, config) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-http2-"));

  try {
    const env = {
      PATH: process.env.PATH,
      HOST: "oneuptime.example.com",
      // Nothing to render: the script returns before it writes a file.
      NGINX_ENVSUBST_TEMPLATE_DIR: path.join(directory, "no-templates"),
    };
    let command = ["sh", [ENVSUBST_SCRIPT]];

    if (config === undefined) {
      env.NGINX_HTTP2 = value;
    } else {
      fs.writeFileSync(path.join(directory, "config.env"), config);
      command = ["sh", [WITH_CONFIG, "sh", ENVSUBST_SCRIPT]];
    }

    const result = spawnSync(command[0], command[1], {
      cwd: directory,
      env: env,
      encoding: "utf8",
    });

    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: "",
    });

    if (result.stdout.includes("NGINX_HTTP2 is off, which changes nothing")) {
      return "off";
    }

    if (result.stdout.includes("WARNING: NGINX_HTTP2 is")) {
      return "unknown";
    }

    return "on";
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

describe("HTTP/2 turned off for HOST (#9973)", () => {
  const REMINDER =
    "HTTP/2 is off for oneuptime.example.com (NGINX_HTTP2=off in config.env), so OTLP over gRPC to it is refused. Restarts and upgrades keep it off: once OneUptime's ingress runs a fixed nginx, set NGINX_HTTP2=on and run npm start.";

  const http2With = (lines) => {
    return http2Findings(settingsOf(lines));
  };

  describe("NGINX_HTTP2, read as the ingress reads it", () => {
    test.each(HTTP2_OFF)("%j is off", (value) => {
      expect(http2SettingOf(value)).toBe("off");
    });

    test.each(HTTP2_ON)("%j is on", (value) => {
      expect(http2SettingOf(value)).toBe("on");
    });

    test("no setting at all is on, as Compose hands the ingress on for it", () => {
      expect(http2SettingOf(undefined)).toBe("on");
      expect(http2SettingOf(null)).toBe("on");
    });

    test.each(HTTP2_UNKNOWN)(
      "%j is neither, which keeps HTTP/2 on",
      (value) => {
        expect(http2SettingOf(value)).toBe("unknown");
      },
    );

    test.each(HTTP2_OFF.concat(HTTP2_ON, HTTP2_UNKNOWN))(
      "the ingress's envsubst-on-templates.sh reads %j the same way",
      (value) => {
        expect(ingressReadsHttp2(value)).toBe(http2SettingOf(value));
      },
    );

    /*
     * From config.env, the doctor reads a line as readSettings does, and
     * npm start hands Compose what WithConfig.sh makes of it: quotes and
     * the spaces around the value go, the rest stays.
     */
    test.each([
      "NGINX_HTTP2=off",
      'NGINX_HTTP2="off"',
      "NGINX_HTTP2='FALSE'",
      'NGINX_HTTP2=" Off "',
      "  NGINX_HTTP2 = no  ",
      "NGINX_HTTP2=0",
      "NGINX_HTTP2=on",
      'NGINX_HTTP2=""',
      "NGINX_HTTP2=",
      "NGINX_HTTP2=disabled",
      'NGINX_HTTP2="off; listen 1234"',
    ])(
      "the line %j in config.env reaches the ingress as the doctor reads it",
      (line) => {
        const config = `HOST=oneuptime.example.com\n${line}\n`;

        expect(ingressReadsHttp2(undefined, config)).toBe(
          http2SettingOf(readSettings(config).get("NGINX_HTTP2")),
        );
      },
    );
  });

  test.each(HTTP2_OFF)(
    "NGINX_HTTP2=%j with PROVISION_SSL=true is a reminder: a note, no fault",
    (value) => {
      const found = http2With([
        "HOST=oneuptime.example.com",
        "PROVISION_SSL=true",
        `NGINX_HTTP2=${value}`,
      ]);
      const written = value.trim();

      expect(found).toEqual([
        reminder(
          REMINDER.replace("NGINX_HTTP2=off in", `NGINX_HTTP2=${written} in`),
        ),
      ]);
      expect(found[0]).toEqual(
        expect.objectContaining({ level: "note", isReminder: true, fix: null }),
      );
    },
  );

  test("the reminder names the host without its port, and the brackets of an IPv6 one", () => {
    expect(
      http2With([
        "HOST=oneuptime.example.com:8443",
        "PROVISION_SSL=true",
        "NGINX_HTTP2=off",
      ])[0].message,
    ).toBe(REMINDER);
    expect(
      http2With([
        "HOST=[2001:db8::1]:8443",
        "PROVISION_SSL=true",
        "NGINX_HTTP2=off",
      ])[0].message,
    ).toContain(
      "HTTP/2 is off for [2001:db8::1] (NGINX_HTTP2=off in config.env)",
    );
  });

  test.each(HTTP2_ON)(
    "NGINX_HTTP2=%j with PROVISION_SSL=true says nothing",
    (value) => {
      expect(
        http2With([
          "HOST=oneuptime.example.com",
          "PROVISION_SSL=true",
          `NGINX_HTTP2=${value}`,
        ]),
      ).toEqual([]);
    },
  );

  test("a config.env without NGINX_HTTP2, from before the setting, says nothing", () => {
    expect(
      http2With(["HOST=oneuptime.example.com", "PROVISION_SSL=true"]),
    ).toEqual([]);
  });

  /*
   * Without PROVISION_SSL the ingress serves no HTTPS for HOST and speaks
   * HTTP/1.1 alone: off changes nothing, and neither does a typo.
   */
  test.each([
    ["PROVISION_SSL=false", ["PROVISION_SSL=false"]],
    ["PROVISION_SSL empty", ["PROVISION_SSL="]],
    ["no PROVISION_SSL at all", []],
    ["PROVISION_SSL=yes, which OneUptime reads as off", ["PROVISION_SSL=yes"]],
    [
      "PROVISION_SSL=TRUE, which OneUptime reads as off",
      ["PROVISION_SSL=TRUE"],
    ],
    ["PROVISION_SSL=1, which OneUptime reads as off", ["PROVISION_SSL=1"]],
  ])(
    "with %s, NGINX_HTTP2=off and an unknown value say nothing",
    (_label, ssl) => {
      for (const value of ["off", "FALSE", "0", "disabled"]) {
        expect(
          http2With(
            ["HOST=oneuptime.example.com", `NGINX_HTTP2=${value}`].concat(ssl),
          ),
        ).toEqual([]);
      }
    },
  );

  test.each(
    HTTP2_UNKNOWN.filter((value) => {
      return value.trim() === value;
    }),
  )(
    "NGINX_HTTP2=%j with PROVISION_SSL=true is worth a look: HTTP/2 stays on, which whoever wrote it did not mean",
    (value) => {
      expect(
        http2With([
          "HOST=oneuptime.example.com",
          "PROVISION_SSL=true",
          `NGINX_HTTP2=${value}`,
        ]),
      ).toEqual([
        finding(
          "warn",
          `NGINX_HTTP2 in config.env is ${value}, which the ingress reads as neither on nor off, so HTTP/2 stays on for oneuptime.example.com.`,
          "To turn it off, set NGINX_HTTP2=off, then run npm start. To keep it on, set NGINX_HTTP2=on.",
        ),
      ]);
    },
  );

  test("config.env's checks include it", () => {
    expect(
      configFindings(
        settingsOf(healthyConfig(["NGINX_HTTP2=off"]).split("\n")),
        {},
      ),
    ).toEqual([reminder(REMINDER)]);
  });

  test("config.example.env ships it on, so a new install is reminded of nothing", () => {
    const template = readSettings(TEMPLATE);

    expect(template.get("NGINX_HTTP2")).toBe("on");
    expect(
      http2Findings(
        new Map(
          Array.from(template.entries()).concat([
            ["HOST", "oneuptime.example.com"],
            ["PROVISION_SSL", "true"],
          ]),
        ),
      ),
    ).toEqual([]);
  });

  test("the hardening guide sets it back with the line the reminder gives", () => {
    const guide = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "packages/App/FeatureSet/Docs/Content/en/self-hosted/hardening.md",
      ),
      "utf8",
    );

    expect(guide).toContain("Until you set it back: `NGINX_HTTP2=on`");
    expect(guide).toContain("set it back once your gateway runs a fixed nginx");
    expect(REMINDER).toContain("set NGINX_HTTP2=on and run npm start");
  });

  test("npm run doctor says it on a healthy server, counts it as nothing, and exits 0", async () => {
    const result = await runDoctor({
      config: healthyConfig(["NGINX_HTTP2=off"]),
    });

    expect(result.output).toBe(
      [
        "Checking this OneUptime:",
        `  • ${REMINDER}`,
        "",
        "Everything looks right.",
      ].join("\n"),
    );
    expect(result.code).toBe(0);
  });

  test("after npm start it is said too, under the one line a healthy server gets", async () => {
    const result = await runDoctor({
      argv: ["--after-start"],
      config: healthyConfig(["NGINX_HTTP2=off"]),
    });

    expect(result.output).toBe(
      ["✓ Everything looks right.", `  • ${REMINDER}`].join("\n"),
    );
    expect(result.code).toBe(0);
  });

  test("after npm start, beside what needs attention, it comes after it and is not counted", async () => {
    const answer = serverAnswer([EMAIL_NOT_SET_UP], {
      products: MONITORING_ONLY,
    });
    const result = await runDoctor({
      argv: ["--after-start"],
      config: healthyConfig(["NGINX_HTTP2=off"]),
      network: {
        doctor: { status: 200, body: JSON.stringify(answer), json: answer },
      },
    });
    const marks = result.output
      .split("\n")
      .filter((line) => {
        return /^ {2}[✗!•✓] /.test(line);
      })
      .map((line) => {
        return line.slice(2, 3);
      });

    expect(result.output.split("\n")[0]).toBe(
      "What needs attention on this server:",
    );
    expect(marks).toEqual(["✗", "•"]);
    expect(result.output).toContain(`  • ${REMINDER}`);
    // The products switched off are still no reminder: npm start leaves them out.
    expect(result.output).not.toContain("Products:");
    expect(result.output).toContain("1 thing to fix.");
    expect(result.code).toBe(0);
  });

  test("after npm start, the other notes stay unsaid beside it", async () => {
    const answer = serverAnswer([], { products: MONITORING_ONLY });
    const result = await runDoctor({
      argv: ["--after-start"],
      config: healthyConfig(["NGINX_HTTP2=off"]),
      network: {
        doctor: { status: 200, body: JSON.stringify(answer), json: answer },
      },
    });

    expect(result.output).toBe(
      ["✓ Everything looks right.", `  • ${REMINDER}`].join("\n"),
    );

    // While npm run doctor says both.
    const doctor = await runDoctor({
      config: healthyConfig(["NGINX_HTTP2=off"]),
      network: {
        doctor: { status: 200, body: JSON.stringify(answer), json: answer },
      },
    });

    expect(doctor.output).toContain(`  • ${REMINDER}`);
    expect(doctor.output).toContain(
      "  • Products: Monitoring and status pages",
    );
  });

  test("an unknown value after npm start is worth a look, with its fix", async () => {
    const result = await runDoctor({
      argv: ["--after-start"],
      config: healthyConfig(["NGINX_HTTP2=disabled"]),
    });

    expect(result.output).toContain(
      "! NGINX_HTTP2 in config.env is disabled, which the ingress reads as neither on nor off, so HTTP/2 stays on for oneuptime.example.com.",
    );
    expect(result.output).toContain(
      "Fix: To turn it off, set NGINX_HTTP2=off, then run npm start.",
    );
    expect(result.output).toContain("Nothing to fix. 1 thing worth a look.");
    expect(result.code).toBe(0);
  });

  test("with PROVISION_SSL off, npm start and npm run doctor say nothing of it", async () => {
    for (const argv of [[], ["--after-start"]]) {
      const result = await runDoctor({
        argv: argv,
        config: healthyConfig([
          "HTTP_PROTOCOL=http",
          "PROVISION_SSL=false",
          "NGINX_HTTP2=off",
        ]),
      });

      expect(result.output).not.toContain("HTTP/2");
      expect(result.output).toContain("Everything looks right.");
    }
  });

  /*
   * The script itself, as npm start ends: nothing answers at the ingress
   * here (port 1), so the doctor says so, and the reminder follows it. HOST
   * is localhost, so that it asks no name on the network for a certificate.
   */
  test("the real script, run as npm start runs it, prints the reminder after what needs attention", () => {
    const directory = workspace(
      healthyConfig([
        "HOST=localhost",
        "NGINX_HTTP2=off",
        "ONEUPTIME_HTTP_PORT=127.0.0.1:1",
      ]),
    );

    try {
      const result = spawnSync(
        process.execPath,
        [
          path.join(REPO_ROOT, "Scripts", "Install", "Doctor.js"),
          "--after-start",
        ],
        {
          cwd: directory,
          env: { PATH: process.env.PATH, HOME: directory },
          encoding: "utf8",
          timeout: 60 * 1000,
        },
      );
      const lines = result.stdout.split("\n");

      expect(result.status).toBe(0);
      expect(lines[0]).toBe("What needs attention on this server:");
      expect(result.stdout).toContain(
        "✗ OneUptime does not answer at http://127.0.0.1:1 on this server (connection refused)",
      );
      expect(result.stdout).toContain(
        "  • HTTP/2 is off for localhost (NGINX_HTTP2=off in config.env), so OTLP over gRPC to it is refused.",
      );
      expect(
        lines.findIndex((line) => {
          return line.startsWith("  • HTTP/2 is off");
        }),
      ).toBeGreaterThan(
        lines.findIndex((line) => {
          return line.startsWith("  ✗ OneUptime does not answer");
        }),
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("disk", () => {
  test("plenty free is a passing line", () => {
    expect(diskFindings(200 * 1000 * 1000 * 1000, "/var/lib/docker")).toEqual([
      finding("ok", "200 GB free for Docker's images and data."),
    ]);
  });

  test("short of room is worth a look; nearly full is something to fix", () => {
    const short = diskFindings(10 * 1000 * 1000 * 1000, "/var/lib/docker")[0];
    const full = diskFindings(
      MINIMUM_FREE_DISK_TO_RUN_BYTES - 1,
      "/var/lib/docker",
    )[0];

    expect(short.level).toBe("warn");
    expect(full.level).toBe("fix");
    expect(full.message).toContain("is nearly full");
    expect(full.fix).toContain("docker system prune");
  });

  test("a disk it cannot measure says nothing", () => {
    expect(diskFindings(null, "/var/lib/docker")).toEqual([]);
  });
});

describe("the output", () => {
  test("the summary line: all right, things to fix, worth a look, singular and plural", () => {
    const fix = finding("fix", "x");
    const warn = finding("warn", "y");
    const ok = finding("ok", "z");

    expect(summaryOf([ok])).toBe("Everything looks right.");
    expect(summaryOf([fix, ok])).toBe("1 thing to fix.");
    expect(summaryOf([fix, fix, fix])).toBe("3 things to fix.");
    expect(summaryOf([fix, fix, warn])).toBe(
      "2 things to fix, and 1 worth a look.",
    );
    expect(summaryOf([warn, warn])).toBe(
      "Nothing to fix. 2 things worth a look.",
    );
    expect(summaryOf([warn])).toBe("Nothing to fix. 1 thing worth a look.");
  });

  test("a finding is its mark and what is wrong, its log lines indented, then its fix", () => {
    expect(
      linesOf(
        finding("fix", "The app service stopped.", "Run npm start.", [
          "Error: boom",
        ]),
      ),
    ).toEqual([
      "  ✗ The app service stopped.",
      "        Error: boom",
      "      Fix: Run npm start.",
    ]);
    expect(linesOf(finding("warn", "Worth a look."))).toEqual([
      "  ! Worth a look.",
    ]);
    expect(linesOf(finding("ok", "Fine."))).toEqual(["  ✓ Fine."]);
  });

  test("the address people open, from HOST and HTTP_PROTOCOL", () => {
    expect(
      publicUrlOf(settingsOf(["HOST=a.example.com", "HTTP_PROTOCOL=https"])),
    ).toBe("https://a.example.com");
    expect(publicUrlOf(settingsOf(["HOST=a.example.com:8080"]))).toBe(
      "http://a.example.com:8080",
    );
    expect(publicUrlOf(settingsOf(["HOST="]))).toBe(null);
  });

  test.each([
    ["[2001:db8::1]", "https://[2001:db8::1]", "[2001:db8::1]", ""],
    [
      "[2001:db8::1]:8443",
      "https://[2001:db8::1]:8443",
      "[2001:db8::1]",
      "8443",
    ],
    ["203.0.113.7:8443", "https://203.0.113.7:8443", "203.0.113.7", "8443"],
    ["a.example.com", "https://a.example.com", "a.example.com", ""],
  ])(
    "HOST=%s is opened at %s, a web address on host %s, port %j",
    (host, url, hostname, port) => {
      const publicUrl = publicUrlOf(
        settingsOf([`HOST=${host}`, "HTTP_PROTOCOL=https"]),
      );
      const parsed = new URL(publicUrl);

      expect(publicUrl).toBe(url);
      expect(parsed.hostname).toBe(hostname);
      expect(parsed.port).toBe(port);
    },
  );
});

describe("npm run doctor", () => {
  test("on a healthy server it says so in one line, and exits 0", async () => {
    const result = await runDoctor();

    expect(result.code).toBe(0);
    expect(result.output).toBe(
      ["Checking this OneUptime:", "", "Everything looks right."].join("\n"),
    );
  });

  test("--all also lists what passed", async () => {
    const result = await runDoctor({ argv: ["--all"] });

    expect(result.code).toBe(0);
    expect(result.output).toContain(
      "✓ Docker 29.0.1 with Docker Compose 2.29.7.",
    );
    expect(result.output).toContain("✓ Every service is running");
    expect(result.output).toContain("✓ OneUptime answers at http://localhost.");
    expect(result.output).toContain(
      "✓ https://oneuptime.example.com reaches this OneUptime.",
    );
    expect(result.output).toContain(
      "✓ The certificate for oneuptime.example.com, from Let's Encrypt, is valid until 2027-02-10.",
    );
    expect(result.output.endsWith("Everything looks right.")).toBe(true);
  });

  test("the server of the issue - HOST left at localhost, a failed certificate, no email, a stopped probe - names all four with their fixes, and exits 1", async () => {
    const answer = serverAnswer([EMAIL_NOT_SET_UP, PROBES_NOT_REPORTING]);
    const result = await runDoctor({
      config: healthyConfig(["HOST=localhost", "PROVISION_SSL=true"]),
      docker: {
        containers: SERVICES.map((service) => {
          return service === "probe-1"
            ? running(service, { State: "exited", ExitCode: 1 })
            : running(service);
        }),
        logs: {
          "probe-1": "probe-1-1  | Error: cannot reach http://localhost:8080\n",
          app: "app-1  | CoreSSL:EnsurePrimaryHostCertificate: rate limited\n",
        },
      },
      network: {
        doctor: { status: 200, json: answer, body: JSON.stringify(answer) },
      },
      certificate: {
        authorized: false,
        authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT",
      },
    });

    expect(result.code).toBe(1);
    // HOST at localhost.
    expect(result.output).toContain(
      "HOST is localhost, so only this computer can open OneUptime.",
    );
    // The stopped probe, its log, and the server saying no probe reports.
    expect(result.output).toContain(
      "The probe-1 service stopped (exit code 1).",
    );
    expect(result.output).toContain(
      "Error: cannot reach http://localhost:8080",
    );
    expect(result.output).toContain("Probes: No global probe is reporting");
    // No email.
    expect(result.output).toContain("Email: Not set up yet");
    expect(result.output).toContain(
      "Fix: Set it up at https://localhost/admin/settings/smtp",
    );
    // A certificate for localhost is not asked for: Let's Encrypt cannot issue one.
    expect(result.output).toContain(
      "Let's Encrypt issues certificates for domain names only",
    );
    // Worst first: every ✗ before every !.
    const lines = result.output.split("\n");
    const lastFix = Math.max(
      ...lines
        .map((line, index) => (line.startsWith("  ✗") ? index : -1))
        .filter((index) => index !== -1),
    );
    const firstWarn = lines.findIndex((line) => line.startsWith("  !"));
    expect(lastFix).toBeLessThan(firstWarn);
    expect(lines[lines.length - 2]).toBe(
      "2 things to fix, and 3 worth a look.",
    );
    expect(lines[lines.length - 1]).toContain("#troubleshooting");
  });

  test("a certificate that failed, on a HOST that is a domain name: named with the app's CoreSSL lines", async () => {
    const result = await runDoctor({
      docker: {
        logs: {
          app: [
            "app-1  | Server started",
            "app-1  | CoreSSL:EnsurePrimaryHostCertificate: Error: DNS problem: NXDOMAIN looking up A for oneuptime.example.com",
          ].join("\n"),
        },
      },
      certificate: {
        authorized: false,
        authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT",
      },
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "✗ The certificate for oneuptime.example.com is not issued yet",
    );
    expect(result.output).toContain(
      "        CoreSSL:EnsurePrimaryHostCertificate: Error: DNS problem: NXDOMAIN",
    );
    expect(result.output).not.toContain("Server started");
    expect(result.output.split("\n").pop()).toContain("#troubleshooting");
  });

  test("warnings alone exit 0", async () => {
    const answer = serverAnswer([PROBES_NOT_REPORTING]);
    const result = await runDoctor({
      network: { doctor: { status: 200, json: answer } },
    });

    expect(result.code).toBe(0);
    expect(result.output).toContain("Nothing to fix. 1 thing worth a look.");
  });

  /*
   * An IPv6 HOST without brackets is no address (#8022): the doctor says how
   * to write it and builds nothing from it - no http://2001:db8::1 to ask
   * from outside, and no such link in a fix.
   */
  test("an IPv6 HOST without brackets is the thing to fix, and no address is built from it", async () => {
    const answer = serverAnswer([EMAIL_NOT_SET_UP]);
    const result = await runDoctor({
      config: healthyConfig(["HOST=2001:db8::1", "PROVISION_SSL=false"]),
      network: {
        doctor: { status: 200, json: answer, body: JSON.stringify(answer) },
      },
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "  ✗ HOST in config.env is 2001:db8::1, an IPv6 address without the brackets a web address needs around one, so no browser can open OneUptime at it. Write HOST=[2001:db8::1].",
    );
    // The server is still asked, at the ingress on this server.
    expect(
      result.network.requests.map((entry) => {
        return entry.url;
      }),
    ).toEqual([
      `http://localhost${READY_PATH}`,
      `http://localhost${DOCTOR_PATH}`,
    ]);
    expect(result.output).not.toContain("2001:db8::1/");
    expect(result.output).toContain("Fix: Set it up at /admin/settings/smtp");
    expect(result.certificates).toEqual([]);
  });

  test.each([
    "<your-address>",
    "http://oneuptime.example.com/",
    "0.0.0.0",
    "[oneuptime.example.com]",
    // Not a domain name (#8877): the app stops at its start with either.
    "oneuptime,example.com",
    "one_uptime-.example.com:8443",
  ])(
    "HOST=%s, which npm start stops on, is never asked for from outside",
    async (host) => {
      const result = await runDoctor({
        config: healthyConfig([`HOST=${host}`]),
      });

      expect(result.code).toBe(1);
      expect(
        result.network.requests.map((entry) => {
          return entry.url;
        }),
      ).toEqual([
        `http://localhost${READY_PATH}`,
        `http://localhost${DOCTOR_PATH}`,
      ]);
      expect(result.certificates).toEqual([]);
      expect(result.output).toContain(`  ✗ HOST in config.env is ${host}`);
    },
  );

  test("an IPv6 HOST in brackets is asked for from outside at its own address, and its certificate is not asked for", async () => {
    const result = await runDoctor({
      config: healthyConfig([
        "HOST=[2001:db8::1]:8443",
        "HTTP_PROTOCOL=https",
        "PROVISION_SSL=true",
      ]),
      argv: ["--all"],
    });

    expect(
      result.network.requests.map((entry) => {
        return entry.url;
      }),
    ).toEqual([
      `http://localhost${READY_PATH}`,
      `http://localhost${DOCTOR_PATH}`,
      "https://[2001:db8::1]:8443/status-page-api/custom-domain-readiness/0123abcd.signature",
    ]);
    expect(result.output).toContain(
      "✓ https://[2001:db8::1]:8443 reaches this OneUptime.",
    );
    /*
     * Let's Encrypt certifies domain names only, which the configuration
     * check says; asked of "[2001:db8::1]", the TLS connection went to the
     * resolver with the brackets on and answered "the name does not resolve".
     */
    expect(result.certificates).toEqual([]);
    expect(result.output).toContain(
      "! PROVISION_SSL=true, but HOST is [2001:db8::1]:8443: Let's Encrypt issues certificates for domain names only.",
    );
    expect(result.output).not.toContain("does not answer over HTTPS");
    expect(result.code).toBe(0);
  });

  test.each(["203.0.113.7", "203.0.113.7:8443", "[2001:db8::1]", "[::1]"])(
    "HOST=%s, an IP address: no certificate is asked for",
    async (host) => {
      const result = await runDoctor({
        config: healthyConfig([`HOST=${host}`, "PROVISION_SSL=true"]),
      });

      expect(result.certificates).toEqual([]);
    },
  );

  test("a domain name's certificate is asked for on port 443 by its name", async () => {
    const result = await runDoctor({
      config: healthyConfig(["HOST=oneuptime.example.com:8443"]),
    });

    expect(result.certificates).toEqual(["oneuptime.example.com:443"]);
  });

  test("the cluster key goes to the ingress on this server, in the clusterkey header of a POST, and never to HOST", async () => {
    const result = await runDoctor();
    // A request presents the key by its header, under either name, or by its value anywhere.
    const presentsTheKey = (entry) => {
      return (
        entry.url.indexOf(SECRET) !== -1 ||
        Object.keys(entry.headers).some((name) => {
          return /^(?:x-)?clusterkey$/i.test(name);
        }) ||
        Object.values(entry.headers).some((value) => {
          return String(value).indexOf(SECRET) !== -1;
        })
      );
    };

    expect(result.network.requests.filter(presentsTheKey)).toEqual([
      {
        url: `http://localhost${DOCTOR_PATH}`,
        method: "POST",
        headers: { Host: "localhost", clusterkey: SECRET },
      },
    ]);
    // HOST is asked for the server's proof, with a GET and without the key.
    expect(
      result.network.requests.filter((entry) => {
        return !presentsTheKey(entry);
      }),
    ).toContainEqual({
      url: "https://oneuptime.example.com/status-page-api/custom-domain-readiness/0123abcd.signature",
      method: "GET",
      headers: {},
    });
  });

  test("a proxy in front that rewrites the host name and drops X-Forwarded-Proto is named, each with its fix, and the doctor exits 1 (#7050)", async () => {
    const reached = {
      proof: "0123abcd.signature",
      request: { host: "127.0.0.1", isHttps: false },
    };
    const result = await runDoctor({
      config: healthyConfig(["PROVISION_SSL=false"]),
      network: {
        address: {
          status: 200,
          body: JSON.stringify(reached),
          json: reached,
        },
      },
    });

    expect(result.output).toContain(
      '  ✗ A proxy in front of OneUptime changes the host name: a request to https://oneuptime.example.com reached OneUptime as 127.0.0.1, so people who open https://oneuptime.example.com get "OneUptime is not set up for this address", and signing in fails.\n      Fix: Have the proxy pass on the Host header the browser sent:',
    );
    expect(result.output).toContain(
      "  ! A proxy in front of OneUptime drops X-Forwarded-Proto: OneUptime took an HTTPS request to https://oneuptime.example.com for plain HTTP.",
    );
    // HOST still reaches this OneUptime: only the proxy's headers are wrong.
    expect(result.output).not.toContain("but not as this OneUptime");
    expect(result.output).toContain("1 thing to fix, and 1 worth a look.");
    expect(result.code).toBe(1);
  });

  test("a proxy that passes on the host name and HTTPS says so with --all, and nothing without it", async () => {
    const reached = {
      proof: "0123abcd.signature",
      request: { host: "oneuptime.example.com", isHttps: true },
    };
    const network = {
      address: { status: 200, body: JSON.stringify(reached), json: reached },
    };

    const quiet = await runDoctor({ network: network });

    expect(quiet.output).not.toContain("A proxy in front");
    expect(quiet.output).toContain("Everything looks right.");
    expect(quiet.code).toBe(0);

    const all = await runDoctor({ network: network, argv: ["--all"] });

    expect(all.output).toContain(
      "  ✓ Requests to https://oneuptime.example.com reach OneUptime with their host name and as HTTPS.",
    );
  });

  test("the ingress on another port is checked there", async () => {
    const result = await runDoctor({
      config: healthyConfig([
        "HOST=oneuptime.example.com:8080",
        "ONEUPTIME_HTTP_PORT=8080",
      ]),
    });

    expect(result.network.requests[0].url).toBe(
      `http://localhost:8080${READY_PATH}`,
    );
    expect(result.network.requests[0].headers).toEqual({
      Host: "localhost:8080",
    });
  });

  /*
   * By the address it is published on, the ingress serves a status page's
   * custom domain: the server is asked where ONEUPTIME_HTTP_PORT publishes
   * it, under localhost, the name it serves OneUptime under (#10024).
   */
  test.each([
    ["8080", "http://localhost:8080", "localhost:8080"],
    ["0.0.0.0:8080", "http://localhost:8080", "localhost:8080"],
    // Docker publishes :: on IPv6 alone.
    ["[::]:8080", "http://[::1]:8080", "localhost:8080"],
    ["127.0.0.1:8080", "http://127.0.0.1:8080", "localhost:8080"],
    ["127.0.0.1:80", "http://127.0.0.1", "localhost"],
    ["[::1]:8080", "http://[::1]:8080", "localhost:8080"],
    ["::1:8080", "http://[::1]:8080", "localhost:8080"],
    ["10.0.0.5:8443", "http://10.0.0.5:8443", "localhost:8443"],
    ["[2001:db8::5]:8080", "http://[2001:db8::5]:8080", "localhost:8080"],
  ])(
    "ONEUPTIME_HTTP_PORT=%s: the server is asked at %s, with Host: %s",
    async (setting, origin, host) => {
      const result = await runDoctor({
        config: healthyConfig([`ONEUPTIME_HTTP_PORT=${setting}`]),
      });
      const atTheIngress = result.network.requests.filter((entry) => {
        return entry.url.indexOf("custom-domain-readiness") === -1;
      });

      expect(
        atTheIngress.map((entry) => {
          return [entry.method, entry.url, entry.headers.Host];
        }),
      ).toEqual([
        ["GET", `${origin}${READY_PATH}`, host],
        ["POST", `${origin}${DOCTOR_PATH}`, host],
      ]);
      expect(result.output).not.toContain("does not answer at");

      const all = await runDoctor({
        config: healthyConfig([`ONEUPTIME_HTTP_PORT=${setting}`]),
        argv: ["--all"],
      });

      expect(all.output).toContain(`✓ OneUptime answers at ${origin}.`);
    },
  );

  test("HOST, asked from outside, keeps its own name: only the ingress is asked under localhost", async () => {
    const result = await runDoctor({
      config: healthyConfig(["ONEUPTIME_HTTP_PORT=127.0.0.1:8080"]),
    });
    const outside = result.network.requests.filter((entry) => {
      return entry.url.indexOf("custom-domain-readiness") !== -1;
    });

    expect(outside).toHaveLength(1);
    expect(outside[0].url.startsWith("https://oneuptime.example.com/")).toBe(
      true,
    );
    expect(outside[0].headers).toEqual({});
  });

  test("a placeholder ONEUPTIME_SECRET is never sent: the server is not asked", async () => {
    const result = await runDoctor({
      config: healthyConfig([
        "ONEUPTIME_SECRET=please-change-this-to-random-value",
      ]),
    });

    expect(
      result.network.requests.some((entry) => entry.url.endsWith(DOCTOR_PATH)),
    ).toBe(false);
    expect(result.code).toBe(1);
  });

  test("OneUptime not answering at the ingress is something to fix, and the server is not asked", async () => {
    const result = await runDoctor({
      network: { ready: { error: "ECONNREFUSED" } },
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "✗ OneUptime does not answer at http://localhost on this server (connection refused)",
    );
    expect(
      result.network.requests.some((entry) => entry.url.endsWith(DOCTOR_PATH)),
    ).toBe(false);
  });

  test("Docker not running: said, and the containers are not asked about", async () => {
    const result = await runDoctor({ docker: { dockerFails: true } });

    expect(result.code).toBe(1);
    expect(result.output).toContain("Docker is installed but not running.");
    expect(
      result.docker.calls.some((call) => call.indexOf("compose ps") !== -1),
    ).toBe(false);
  });

  test("--logs shows the recent errors of every service, with the service named", async () => {
    const result = await runDoctor({
      argv: ["--logs"],
      docker: {
        allLogs: ["app-1  | Error: something broke", "ingress-1  | ok"].join(
          "\n",
        ),
      },
    });

    expect(result.code).toBe(0);
    expect(result.output).toContain(
      [
        "Recent errors, by service:",
        "  app",
        "    Error: something broke",
      ].join("\n"),
    );
  });

  test("--logs on a quiet server says there are none", async () => {
    const result = await runDoctor({ argv: ["--logs"] });

    expect(result.output).toContain(
      "No errors in the last 500 lines of any service's log.",
    );
  });

  test("without config.env it says where to run it, and exits 1", async () => {
    const result = await runDoctor({ config: null });

    expect(result.code).toBe(1);
    expect(result.output).toContain("config.env is missing");
  });
});

describe("after npm start", () => {
  test("npm start ends with the doctor's quiet run, after the status check", () => {
    const steps = ROOT_PACKAGE.scripts.start.split(" && ");

    expect(steps[steps.length - 1]).toBe(
      "node ./Scripts/Install/Doctor.js --after-start",
    );
    expect(steps[steps.length - 2]).toBe("npm run status-check");
    expect(ROOT_PACKAGE.scripts.doctor).toBe(
      "node ./Scripts/Install/Doctor.js",
    );
  });

  test("a healthy server: one line", async () => {
    const result = await runDoctor({ argv: ["--after-start"] });

    expect(result.code).toBe(0);
    expect(result.output).toBe("✓ Everything looks right.");
  });

  test("what needs attention is the last thing on screen, and the start never fails", async () => {
    const answer = serverAnswer([EMAIL_NOT_SET_UP]);
    const result = await runDoctor({
      argv: ["--after-start"],
      network: { doctor: { status: 200, json: answer } },
    });
    const lines = result.output.split("\n");

    expect(result.code).toBe(0);
    expect(lines[0]).toBe("What needs attention on this server:");
    expect(result.output).toContain("✗ Email: Not set up yet");
    expect(lines.slice(-2)).toEqual([
      "1 thing to fix.",
      "Run npm run doctor at any time to check again.",
    ]);
  });

  test("it leaves Docker alone: the preflight and the status check have just looked", async () => {
    const result = await runDoctor({ argv: ["--after-start"] });

    expect(result.docker.calls).toEqual([]);
  });

  test("without config.env the start does not fail", async () => {
    const result = await runDoctor({ argv: ["--after-start"], config: null });

    expect(result.code).toBe(0);
  });
});

describe("tidied", () => {
  test("npm run run-probes starts only the probe the stock compose file defines", () => {
    const compose = fs.readFileSync(
      path.join(REPO_ROOT, "docker-compose.yml"),
      "utf8",
    );

    expect(ROOT_PACKAGE.scripts["run-probes"]).toBe(
      "sh ./Scripts/Install/WithConfig.sh docker compose up --remove-orphans -d probe-1",
    );
    expect(compose).toMatch(/^ {2}probe-1:$/m);
    expect(compose).not.toMatch(/^ {2}probe-2:$/m);
  });

  test("config.example.env no longer asks people to change the secrets npm start generates", () => {
    expect(TEMPLATE).not.toContain("PLEASE CHANGE");
    expect(TEMPLATE).toContain(
      "# Secrets. npm start gives each one its own random value the first time it runs,",
    );
  });
});

describe("against a real HTTP server standing in for the ingress", () => {
  let server;
  let port;
  // Another server, which nothing should reach.
  let elsewhere;
  let elsewherePort;
  // Where the doctor's path redirects to, when a test says.
  let redirectTo = null;
  // The ONEUPTIME_SECRET the app runs with, which it compares the key with.
  let appKey = SECRET;
  const seen = [];
  const seenElsewhere = [];
  // The Host header of each request the stand-in ingress took, by its path.
  const hosts = [];

  const recordOf = (req) => {
    return {
      method: req.method,
      url: req.url,
      clusterkey: req.headers.clusterkey,
      contentLength: req.headers["content-length"],
      transferEncoding: req.headers["transfer-encoding"],
    };
  };

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push(recordOf(req));
      hosts.push({ url: req.url, host: req.headers.host });

      if (req.url === READY_PATH) {
        res.writeHead(200);
        res.end("ok");
        return;
      }

      if (req.url === DOCTOR_PATH) {
        if (req.method !== "POST") {
          res.writeHead(GET_OF_THE_DOCTORS_PATH.status, {
            "content-type": "application/json",
          });
          res.end(GET_OF_THE_DOCTORS_PATH.body);
          return;
        }

        if (redirectTo) {
          res.writeHead(307, { location: redirectTo });
          res.end();
          return;
        }

        // As the app compares a key: with its own, URI-encoded (ClusterKeyAuthorization.getClusterKey).
        if (req.headers.clusterkey !== encodeURIComponent(appKey)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid cluster key" }));
          return;
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(serverAnswer([EMAIL_NOT_SET_UP])));
        return;
      }

      res.writeHead(404);
      res.end();
    });
    elsewhere = http.createServer((req, res) => {
      seenElsewhere.push(recordOf(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(serverAnswer([EMAIL_NOT_SET_UP])));
    });

    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = server.address().port;
    await new Promise((resolve) => {
      elsewhere.listen(0, "127.0.0.1", resolve);
    });
    elsewherePort = elsewhere.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
    await new Promise((resolve) => {
      elsewhere.close(resolve);
    });
  });

  beforeEach(() => {
    redirectTo = null;
    appKey = SECRET;
    seen.length = 0;
    seenElsewhere.length = 0;
    hosts.length = 0;
  });

  // The doctor's POST, as the server saw it.
  const DOCTORS_POST = {
    method: "POST",
    url: DOCTOR_PATH,
    clusterkey: SECRET,
    // An empty body, said so.
    contentLength: "0",
    transferEncoding: undefined,
  };

  const runAgainstServer = async (config) => {
    const directory = workspace(config);
    const lines = [];

    try {
      const code = await run({
        cwd: directory,
        env: {},
        argv: [],
        log: (line) => {
          lines.push(line);
        },
        runCommand: fakeDocker().runCommand,
        interfaces: {},
        now: NOW,
      });

      return { code: code, output: lines.join("\n") };
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };

  test("the real request reads the server's answer, with the key from config.env", async () => {
    const result = await runAgainstServer(
      healthyConfig([
        `HOST=127.0.0.1:${port}`,
        "HTTP_PROTOCOL=http",
        "PROVISION_SSL=false",
        `ONEUPTIME_HTTP_PORT=127.0.0.1:${port}`,
      ]),
    );

    expect(result.output).toContain("✗ Email: Not set up yet");
    expect(result.code).toBe(1);
    // One request presents the key: the doctor's POST.
    expect(
      seen.filter((entry) => {
        return entry.url === DOCTOR_PATH || entry.clusterkey !== undefined;
      }),
    ).toEqual([DOCTORS_POST]);
    expect(seen).toContainEqual({
      method: "GET",
      url: READY_PATH,
      clusterkey: undefined,
      contentLength: undefined,
      transferEncoding: undefined,
    });
  });

  /*
   * The ingress published on 127.0.0.1 alone, as behind a reverse proxy of
   * one's own: the doctor connects there, and asks for localhost, the name
   * the ingress serves OneUptime under. Asked as 127.0.0.1, the ingress
   * serves a status page's custom domain (#10024).
   */
  test("the real requests go where ONEUPTIME_HTTP_PORT publishes the ingress, under the name localhost", async () => {
    // A HOST of this computer, which the doctor does not ask from outside; the name sent is not HOST's.
    const result = await runAgainstServer(
      healthyConfig([
        "HOST=127.0.0.1",
        "HTTP_PROTOCOL=http",
        "PROVISION_SSL=false",
        `ONEUPTIME_HTTP_PORT=127.0.0.1:${port}`,
      ]),
    );

    expect(hosts).toEqual([
      { url: READY_PATH, host: `localhost:${port}` },
      { url: DOCTOR_PATH, host: `localhost:${port}` },
    ]);
    expect(result.output).not.toContain("does not answer at");
    expect(result.output).toContain("✗ Email: Not set up yet");
  });

  test("a redirect is not followed, so the key reaches no other server", async () => {
    redirectTo = `http://127.0.0.1:${elsewherePort}${DOCTOR_PATH}`;

    const result = await runAgainstServer(
      healthyConfig([
        `HOST=127.0.0.1:${port}`,
        "HTTP_PROTOCOL=http",
        "PROVISION_SSL=false",
        `ONEUPTIME_HTTP_PORT=127.0.0.1:${port}`,
      ]),
    );

    expect(
      seen.filter((entry) => {
        return entry.url === DOCTOR_PATH;
      }),
    ).toEqual([DOCTORS_POST]);
    expect(seenElsewhere).toEqual([]);
    expect(result.output).toContain(
      "OneUptime could not say how its databases, migrations, queues and setup are (HTTP 307).",
    );
  });

  /*
   * Keys with characters URI-encoding changes: + / = @ & %, a Latin-1
   * letter, which Node's http would send as one byte, and letters beyond
   * Latin-1, which it would not send at all.
   */
  test.each([
    ["+ / = @ & %", "Ab+c/d=e@f&g%h"],
    ["a Latin-1 letter", "clé-du-cluster"],
    ["letters beyond Latin-1", "clé-du-cluster-ä-ø-漢字-🔑"],
  ])(
    "a key with %s goes URI-encoded, as the app compares it, and the server's answer is read",
    async (_characters, key) => {
      appKey = key;

      const result = await runAgainstServer(
        healthyConfig([
          `HOST=127.0.0.1:${port}`,
          "HTTP_PROTOCOL=http",
          "PROVISION_SSL=false",
          `ONEUPTIME_HTTP_PORT=127.0.0.1:${port}`,
          `ONEUPTIME_SECRET=${key}`,
        ]),
      );

      expect(
        seen.filter((entry) => {
          return entry.url === DOCTOR_PATH;
        }),
      ).toEqual([
        Object.assign({}, DOCTORS_POST, {
          clusterkey: encodeURIComponent(key),
        }),
      ]);
      expect(result.output).toContain("✗ Email: Not set up yet");
      expect(result.output).not.toContain("did not accept ONEUPTIME_SECRET");
    },
  );

  test("a key the server refuses is said, not a crash", async () => {
    const result = await runAgainstServer(
      healthyConfig([
        `HOST=127.0.0.1:${port}`,
        "HTTP_PROTOCOL=http",
        "PROVISION_SSL=false",
        `ONEUPTIME_HTTP_PORT=127.0.0.1:${port}`,
        `ONEUPTIME_SECRET=${"9".repeat(64)}`,
      ]),
    );

    expect(result.output).toContain("did not accept ONEUPTIME_SECRET");
  });

  test("defaultRequest: a GET unless told otherwise, a status and JSON, and an error code for a closed port", async () => {
    const answer = await defaultRequest(
      `http://127.0.0.1:${port}${DOCTOR_PATH}`,
      {
        method: "POST",
        headers: { clusterkey: SECRET },
      },
    );
    const ready = await defaultRequest(
      `http://127.0.0.1:${port}${READY_PATH}`,
      {},
    );
    const closed = await defaultRequest("http://127.0.0.1:1/", {});

    expect(answer.status).toBe(200);
    expect(answer.json.findings[0].id).toBe("setup-email");
    expect(ready).toEqual({ status: 200, body: "ok", json: null });
    expect(seen).toEqual([
      DOCTORS_POST,
      {
        method: "GET",
        url: READY_PATH,
        clusterkey: undefined,
        contentLength: undefined,
        transferEncoding: undefined,
      },
    ]);
    expect(closed.error).toBe("ECONNREFUSED");
  });

  test("defaultRequest answers a redirect with its status, and asks no other server", async () => {
    redirectTo = `http://127.0.0.1:${elsewherePort}${DOCTOR_PATH}`;

    const answer = await defaultRequest(
      `http://127.0.0.1:${port}${DOCTOR_PATH}`,
      {
        method: "POST",
        headers: { clusterkey: SECRET },
      },
    );

    expect(answer.status).toBe(307);
    expect(seen).toEqual([DOCTORS_POST]);
    expect(seenElsewhere).toEqual([]);
  });
});

describe("the Docker Compose guide", () => {
  const guide = fs.readFileSync(
    path.join(
      REPO_ROOT,
      "packages/App/FeatureSet/Docs/Content/en/installation/docker-compose.md",
    ),
    "utf8",
  );

  test("every entry of its troubleshooting list is detected, partly, or not, with the reason", () => {
    const troubleshooting = guide.slice(
      guide.indexOf("\n## Troubleshooting\n"),
      guide.indexOf("\n## Next steps\n"),
    );
    const entries = Array.from(
      troubleshooting.matchAll(/^:::details (.+)$/gm),
    ).map((match) => {
      return match[1];
    });

    expect(entries.length).toBeGreaterThan(5);
    expect(Object.keys(TROUBLESHOOTING_COVERAGE).sort()).toEqual(
      entries.sort(),
    );

    for (const answer of Object.values(TROUBLESHOOTING_COVERAGE)) {
      expect(answer).toMatch(/^(Detected|Partly|Not)\b/);
    }
  });

  test("it documents the command, its errors option and its exit code, and Troubleshooting starts with it", () => {
    const check = guide.slice(
      guide.indexOf("\n## Check your installation\n"),
      guide.indexOf("\n## Troubleshooting\n"),
    );

    expect(check).toContain("```bash\nnpm run doctor\n```");
    expect(check).toContain("```bash\nnpm run doctor -- --logs\n```");
    expect(check).toContain("It exits with `1` when something marked ✗");
    expect(check).toContain("**Everything looks right.**");
    // A proxy in front (#7050), the products switched off (#7481), diagnose.sh's address check (#7051).
    expect(check).toContain(
      "a proxy in front of it passes on the host name and `X-Forwarded-Proto`",
    );
    expect(check).toContain(
      "Lines marked • are worth knowing but no fault, and are not counted: which products are switched off on this server",
    );
    expect(check).toContain("A name in `SERVER_PRODUCTS`");
    expect(check).toContain(
      "`HelmChart/Public/diagnose.sh` prints it, then checks the address people open and its certificate.",
    );
    expect(
      guide.slice(guide.indexOf("\n## Troubleshooting\n")).split("\n")[3],
    ).toBe(
      "Start with `npm run doctor`: it names most of the problems below, with their fixes.",
    );
  });

  test.each([
    "da",
    "de",
    "es",
    "fa",
    "fr",
    "hi",
    "it",
    "ja",
    "ko",
    "nl",
    "no",
    "pt",
    "ru",
    "sv",
    "zh-CN",
    "zh-TW",
  ])(
    "%s documents it too, in the same place, with the same commands",
    (language) => {
      const page = fs.readFileSync(
        path.join(
          REPO_ROOT,
          `packages/App/FeatureSet/Docs/Content/${language}/installation/docker-compose.md`,
        ),
        "utf8",
      );
      const headings = page.split("\n").filter((line) => {
        return line.startsWith("## ");
      });
      // Check your installation, Troubleshooting, Next steps: the last three.
      const check = page.slice(
        page.indexOf(`\n${headings[headings.length - 3]}\n`),
        page.indexOf(`\n${headings[headings.length - 2]}\n`),
      );

      expect(check).toContain("```bash\nnpm run doctor\n```");
      expect(check).toContain("```bash\nnpm run doctor -- --logs\n```");
      expect(check).toContain("`1`");
      expect(check).toContain("**Everything looks right.**");
      expect(check).toContain("HelmChart/Public/diagnose.sh");
      // The proxy check, the note's mark and SERVER_PRODUCTS, written as the doctor writes them.
      expect(check).toContain("`X-Forwarded-Proto`");
      expect(check).toContain("•");
      expect(check).toContain("`SERVER_PRODUCTS`");
      expect(
        page
          .slice(page.indexOf(`\n${headings[headings.length - 2]}\n`))
          .split("\n")[3],
      ).toContain("`npm run doctor`");
    },
  );
});
