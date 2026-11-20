"use strict";

/**
 * Tests/Scripts/status-check.sh, the step `npm start` ends with.
 *
 * It waits until OneUptime answers and holds ready, then says where to open
 * it. With no address given it checks the ingress where config.env publishes
 * it (ONEUPTIME_HTTP_PORT): it used to check port 80 of localhost whatever
 * config.env said, so an install that moved the ingress to another port
 * (because port 80 was taken) waited five minutes and ended with "Maximum
 * retries reached" while OneUptime was running - issues #1072, #1834, #2195
 * and the Docker Compose guide's troubleshooting - and `npm start
 * --services=...` handed it the list of services as the address (#2029).
 *
 * Then it asked the ingress by the address it is published on, and the
 * ingress serves OneUptime only under localhost, ingress and HOST: with
 * ONEUPTIME_HTTP_PORT=127.0.0.1:8080, the Docker Compose guide's setting
 * behind a reverse proxy, every page but /status answered 404 and npm start
 * ended with "Maximum retries reached" (#10024). It now connects where the
 * ingress is published and asks for localhost, with curl's --resolve.
 *
 * These tests run the script itself in a throwaway directory, with a `curl`
 * on PATH that records every request it is asked for - each argument - and
 * answers with a status code the test picks, and a `sleep` that returns at
 * once. StatusCheckIngress.test.js runs it with the real curl against the
 * real ingress.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { ingressRequestOf } = require("../../Scripts/Install/FollowIngressPort");
const {
  readSettings,
} = require("../../Scripts/Install/ReplacePlaceholderSecrets");
const { renderCompose, hasDockerCompose } = require("./Utils/ComposePorts");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const STATUS_CHECK = path.join(
  REPO_ROOT,
  "Tests",
  "Scripts",
  "status-check.sh",
);
const ROOT_PACKAGE = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);

// The endpoints the check waits for, after the address itself.
const ENDPOINTS = [
  "",
  "/status",
  "/status/ready",
  "/dashboard",
  "/admin/env.js",
  "/public-dashboard",
  "/accounts",
  "/status-page/",
];

// What the fake curl writes between two arguments of one request.
const ARGUMENT_SEPARATOR = "\u001f";

/*
 * Runs status-check.sh in a throwaway directory holding `config` as
 * config.env (none when null), with `args`, the environment `env` adds and a
 * curl answering `code` (or each address's code from `codeFor`). `calls` are
 * the addresses curl was asked for, `requests` every argument of each.
 */
function statusCheck({ config, args, env, code, codeFor }) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-status-check-"),
  );
  const calls = path.join(directory, "curl-calls.log");
  const bin = path.join(directory, "bin");

  try {
    fs.mkdirSync(bin);

    if (config !== null && config !== undefined) {
      fs.writeFileSync(path.join(directory, "config.env"), config);
    }

    // The address is curl's last argument.
    fs.writeFileSync(
      path.join(bin, "curl"),
      [
        "#!/bin/sh",
        'for last in "$@"; do :; done',
        `printf '%s\\037' "$@" >> "${calls}"`,
        `printf '\\n' >> "${calls}"`,
        'case "$last" in',
        ...Object.entries(codeFor || {}).map(([suffix, answer]) => {
          return `  *${suffix}) printf '%s' "${answer}"; exit 0 ;;`;
        }),
        "esac",
        `printf '%s' "${code || "200"}"`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });

    const result = spawnSync("bash", [STATUS_CHECK].concat(args || []), {
      cwd: directory,
      env: Object.assign(
        { PATH: `${bin}${path.delimiter}${process.env.PATH}` },
        env || {},
      ),
      encoding: "utf8",
      timeout: 60 * 1000,
    });

    const requests = fs.existsSync(calls)
      ? fs
          .readFileSync(calls, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            return line.split(ARGUMENT_SEPARATOR).slice(0, -1);
          })
      : [];

    return {
      status: result.status,
      output: `${result.stdout || ""}${result.stderr || ""}`,
      calls: requests.map((argv) => {
        return argv[argv.length - 1];
      }),
      requests: requests,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function configWith(lines) {
  return `${lines.join("\n")}\n`;
}

// The value curl was given for `option`, or null.
function optionOf(argv, option) {
  const index = argv.indexOf(option);

  return index === -1 ? null : argv[index + 1];
}

/*
 * The request curl makes for one call, as curl documents its options: the
 * Host header names the address's host and port (none for 80), and
 * --resolve HOST:PORT:ADDRESS has a request for HOST:PORT connect to
 * ADDRESS, on that port. StatusCheckIngress.test.js checks the same against
 * the real curl and nginx. A --connect-to would not be read here: curl
 * before 7.49 has none, so the check never sends one.
 */
function requestOf(argv) {
  const address = argv[argv.length - 1];
  const url = new URL(
    /^[a-z]+:\/\//i.test(address) ? address : `http://${address}`,
  );
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const resolve = optionOf(argv, "--resolve");
  let connectsTo = `${url.hostname}:${port}`;

  expect(argv).not.toContain("--connect-to");

  if (resolve) {
    // An IPv6 address without brackets, as every curl since 7.21 reads it.
    const match = /^([^:]+):(\d+):([^[\],]+)$/.exec(resolve);

    expect({ resolve, parses: Boolean(match) }).toEqual({
      resolve,
      parses: true,
    });

    if (match[1] === url.hostname && match[2] === port) {
      connectsTo = match[3].includes(":")
        ? `[${match[3]}]:${port}`
        : `${match[3]}:${port}`;
    }
  }

  return { host: url.host, path: url.pathname, connectsTo: connectsTo };
}

/*
 * Every form of ONEUPTIME_HTTP_PORT that Compose publishes, as `docker
 * compose config` reads it (StatusCheckIngress.test.js holds the two to
 * each other): where the check connects, the Host it sends, and the address
 * it says it waits at. A port alone, which Docker publishes on every
 * address, IPv4 and IPv6, and 0.0.0.0, every IPv4 address, are reached at
 * localhost; ::, which Docker publishes on IPv6 alone, at [::1], as localhost
 * may name 127.0.0.1 alone. On one address of the server, the check connects
 * to that address. Each time it asks for localhost, the name the ingress
 * serves OneUptime under. IPv6 in brackets, as Compose takes it with or
 * without them.
 */
const INGRESS_FORMS = [
  ["80", "localhost:80", "localhost", "localhost"],
  ["", "localhost:80", "localhost", "localhost"],
  ["8080", "localhost:8080", "localhost:8080", "localhost:8080"],
  [":8080", "localhost:8080", "localhost:8080", "localhost:8080"],
  ["0.0.0.0:8080", "localhost:8080", "localhost:8080", "localhost:8080"],
  ["[::]:8080", "[::1]:8080", "localhost:8080", "[::1]:8080"],
  [":::8080", "[::1]:8080", "localhost:8080", "[::1]:8080"],
  ["127.0.0.1:8080", "127.0.0.1:8080", "localhost:8080", "127.0.0.1:8080"],
  ["127.0.0.1:80", "127.0.0.1:80", "localhost", "127.0.0.1"],
  ["[::1]:8080", "[::1]:8080", "localhost:8080", "[::1]:8080"],
  ["::1:8080", "[::1]:8080", "localhost:8080", "[::1]:8080"],
  ["[::1]:80", "[::1]:80", "localhost", "[::1]"],
  ["10.0.0.5:8443", "10.0.0.5:8443", "localhost:8443", "10.0.0.5:8443"],
  ["10.0.0.5:80", "10.0.0.5:80", "localhost", "10.0.0.5"],
  [
    "[2001:db8::5]:8080",
    "[2001:db8::5]:8080",
    "localhost:8080",
    "[2001:db8::5]:8080",
  ],
  [
    "2001:db8::5:8080",
    "[2001:db8::5]:8080",
    "localhost:8080",
    "[2001:db8::5]:8080",
  ],
  // As config.env may write it: quoted, or with spaces around it.
  ['"8080"', "localhost:8080", "localhost:8080", "localhost:8080"],
  ["'8080'", "localhost:8080", "localhost:8080", "localhost:8080"],
  [" 8080 ", "localhost:8080", "localhost:8080", "localhost:8080"],
  ['"127.0.0.1:8080"', "127.0.0.1:8080", "localhost:8080", "127.0.0.1:8080"],
  [" [::1]:8080 ", "[::1]:8080", "localhost:8080", "[::1]:8080"],
];

describe("the address it checks", () => {
  test.each(INGRESS_FORMS)(
    "ONEUPTIME_HTTP_PORT=%s in config.env: it connects to %s and sends Host: %s",
    (setting, connectsTo, host, waitingAt) => {
      const result = statusCheck({
        config: configWith([
          "HOST=oneuptime.example.com",
          `ONEUPTIME_HTTP_PORT=${setting}`,
        ]),
      });
      const isOneAddress = !connectsTo.startsWith("localhost:");

      expect(result.status).toBe(0);
      expect(result.requests.slice(0, ENDPOINTS.length).map(requestOf)).toEqual(
        ENDPOINTS.map((endpoint) => {
          return { host, path: endpoint || "/", connectsTo };
        }),
      );
      // The readiness loop that follows asks the same socket, by the same name.
      expect(result.requests.length).toBeGreaterThan(ENDPOINTS.length);
      for (const argv of result.requests) {
        expect(requestOf(argv)).toEqual(
          expect.objectContaining({ host, connectsTo }),
        );
      }
      // Never the address itself as the name: the ingress serves it as a status page's domain.
      for (const address of result.calls) {
        expect(address.startsWith(`${host}`)).toBe(true);
      }
      expect(result.output).toContain(
        isOneAddress
          ? `Waiting for OneUptime to answer at ${waitingAt}, where ONEUPTIME_HTTP_PORT publishes the ingress.`
          : `Waiting for OneUptime to answer at ${waitingAt}.`,
      );
      expect(result.output).toContain(
        isOneAddress
          ? `✅ Dashboard endpoint is up (${host}/dashboard at ${waitingAt})`
          : `✅ Dashboard endpoint is up (${host}/dashboard)`,
      );
    },
  );

  test("on one address of the server, every request goes there with --resolve, and none is sent without it", () => {
    const result = statusCheck({
      config: configWith(["ONEUPTIME_HTTP_PORT=127.0.0.1:8080"]),
    });

    expect(result.status).toBe(0);
    for (const argv of result.requests) {
      expect(optionOf(argv, "--resolve")).toBe("localhost:8080:127.0.0.1");
      expect(argv[argv.length - 1].startsWith("localhost:8080")).toBe(true);
    }
    expect(result.output).toContain(
      "✅ App endpoint is up (localhost:8080 at 127.0.0.1:8080)",
    );
    expect(result.output).toContain("OneUptime is up!");
  });

  /*
   * Docker publishes [::]:8080 on IPv6 alone: 127.0.0.1:8080 is refused
   * there, and localhost is 127.0.0.1 alone where /etc/hosts gives ::1
   * another name (Ubuntu's), and for any curl that asks the system for it.
   */
  test.each(["[::]:8080", ":::8080"])(
    "on %s, every IPv6 address, it connects to [::1], whatever localhost names here",
    (setting) => {
      const result = statusCheck({
        config: configWith([`ONEUPTIME_HTTP_PORT=${setting}`]),
      });

      expect(result.status).toBe(0);
      for (const argv of result.requests) {
        expect(optionOf(argv, "--resolve")).toBe("localhost:8080:::1");
      }
    },
  );

  test("on every address of the server, curl is told nothing new: the request for localhost goes to localhost", () => {
    for (const setting of ["8080", ":8080", "0.0.0.0:8080"]) {
      const result = statusCheck({
        config: configWith([`ONEUPTIME_HTTP_PORT=${setting}`]),
      });

      expect(result.status).toBe(0);
      for (const argv of result.requests) {
        expect(argv).not.toContain("--resolve");
      }
    }
  });

  test("the last assignment in config.env wins, a comment does not count, and Windows line endings are read", () => {
    const result = statusCheck({
      config: [
        "ONEUPTIME_HTTP_PORT=80",
        "# ONEUPTIME_HTTP_PORT=9999",
        "ONEUPTIME_HTTP_PORT=8080",
        "",
      ].join("\r\n"),
    });

    expect(result.calls[0]).toBe("localhost:8080");
  });

  test("config.env wins over the environment, which npm start exports from it anyway", () => {
    const result = statusCheck({
      config: configWith(["ONEUPTIME_HTTP_PORT=8080"]),
      env: { ONEUPTIME_HTTP_PORT: "9090" },
    });

    expect(result.calls[0]).toBe("localhost:8080");
  });

  test("without config.env, the environment's ONEUPTIME_HTTP_PORT is used", () => {
    const result = statusCheck({
      config: null,
      env: { ONEUPTIME_HTTP_PORT: "9090" },
    });

    expect(result.calls[0]).toBe("localhost:9090");
  });

  test("without config.env or a setting, port 80 of localhost, as before", () => {
    const result = statusCheck({ config: null });

    expect(result.calls[0]).toBe("localhost");
  });

  test("an address given on the command line is checked as given, as CI's jobs give one", () => {
    const result = statusCheck({
      config: configWith(["ONEUPTIME_HTTP_PORT=8080"]),
      args: ["http://localhost"],
    });

    expect(result.calls[0]).toBe("http://localhost");
    expect(result.calls).not.toContain("localhost:8080");
  });

  test.each([
    ["http://localhost", "localhost:80"],
    // The Helm chart's test pod checks the address people open, over HTTPS.
    ["https://oneuptime.example.com", "oneuptime.example.com:443"],
    ["127.0.0.1:8080", "127.0.0.1:8080"],
  ])(
    "an address given on the command line, %s, is asked as it is, whatever config.env publishes",
    (address, connectsTo) => {
      const result = statusCheck({
        config: configWith(["ONEUPTIME_HTTP_PORT=127.0.0.1:8080"]),
        args: [address],
      });

      expect(result.status).toBe(0);
      expect(result.calls[0]).toBe(address);
      for (const argv of result.requests) {
        expect(argv).not.toContain("--resolve");
        expect(requestOf(argv).connectsTo).toBe(connectsTo);
      }
      expect(result.output).toContain(
        `Waiting for OneUptime to answer at ${address}.`,
      );
    },
  );

  test("an empty argument is no address: the ingress is checked", () => {
    const result = statusCheck({
      config: configWith(["ONEUPTIME_HTTP_PORT=8080"]),
      args: [""],
    });

    expect(result.calls[0]).toBe("localhost:8080");
  });
});

/*
 * npm start ends with this check, then the doctor, which asks the ingress
 * itself (Scripts/Install/Doctor.js, by FollowIngressPort's
 * ingressRequestOf), as backup.sh's report does: both must ask the same
 * socket under the same name, or one passes where the other cannot.
 */
describe("the doctor and the backup report ask where the check asks", () => {
  test.each(INGRESS_FORMS)(
    "ONEUPTIME_HTTP_PORT=%s",
    (setting, connectsTo, host) => {
      const value = readSettings(`ONEUPTIME_HTTP_PORT=${setting}\n`).get(
        "ONEUPTIME_HTTP_PORT",
      );
      const request = ingressRequestOf(value);
      const url = new URL(request.url);
      const checked = statusCheck({
        config: configWith([`ONEUPTIME_HTTP_PORT=${setting}`]),
      });

      expect({
        host: request.host,
        connectsTo: `${url.hostname}:${url.port || "80"}`,
      }).toEqual({
        host,
        connectsTo,
      });
      expect(requestOf(checked.requests[0])).toEqual(
        expect.objectContaining({ host, connectsTo }),
      );
    },
  );
});

/*
 * What Compose itself makes of each form: the published address and port
 * of the ingress's 7849, from `docker compose config`, are where the check
 * connects. Needs the Docker CLI's compose plugin, and no daemon. Not the
 * empty setting, which Compose publishes on a port Docker picks when it
 * starts the ingress, so nothing knows it before: the check asks port 80 then,
 * as it always did.
 */
const describeWithCompose = hasDockerCompose() ? describe : describe.skip;

describeWithCompose(
  "as Compose publishes each form of ONEUPTIME_HTTP_PORT",
  () => {
    test.each(
      INGRESS_FORMS.filter(([setting]) => {
        return setting !== "";
      }),
    )(
      "ONEUPTIME_HTTP_PORT=%s is published where the check connects, %s",
      (setting, connectsTo) => {
        const value = readSettings(`ONEUPTIME_HTTP_PORT=${setting}\n`).get(
          "ONEUPTIME_HTTP_PORT",
        );
        const rendered = renderCompose(["docker-compose.yml"], {
          ONEUPTIME_HTTP_PORT: value,
        });
        const published = rendered.services.ingress.ports.find((port) => {
          return Number(port.target) === 7849;
        });
        const hostIp = published.host_ip || "";
        // Where this server reaches it: :: is IPv6 alone, so at [::1].
        const address = ["", "0.0.0.0"].includes(hostIp)
          ? "localhost"
          : hostIp === "::"
            ? "[::1]"
            : hostIp.includes(":")
              ? `[${hostIp}]`
              : hostIp;

        expect(`${address}:${published.published}`).toBe(connectsTo);
      },
    );
  },
);

describe("how npm runs it", () => {
  test("npm's status-check script hands it no address, so it checks the ingress config.env names", () => {
    expect(ROOT_PACKAGE.scripts["status-check"]).toBe(
      "bash ./Tests/Scripts/status-check.sh",
    );
    // The doctor's quiet run follows it, and only it (#6826).
    expect(
      ROOT_PACKAGE.scripts.start.endsWith(
        "&& npm run status-check && node ./Scripts/Install/Doctor.js --after-start",
      ),
    ).toBe(true);
  });

  /*
   * npm itself runs the status-check script in a throwaway copy, as
   * `npm start --services=app` would: npm sets npm_config_services for every
   * script it runs, and the script used to pass it on as the address.
   */
  test("npm run status-check --services=app checks the ingress, not an address called app", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-npm-status-check-"),
    );
    const calls = path.join(directory, "curl-calls.log");

    try {
      fs.mkdirSync(path.join(directory, "Tests", "Scripts"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(directory, "bin"));
      for (const script of ["status-check.sh", "endpoint-status.sh"]) {
        fs.copyFileSync(
          path.join(REPO_ROOT, "Tests", "Scripts", script),
          path.join(directory, "Tests", "Scripts", script),
        );
      }
      fs.writeFileSync(
        path.join(directory, "config.env"),
        "HOST=localhost:8080\nONEUPTIME_HTTP_PORT=8080\n",
      );
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({
          name: "status-check-wiring",
          version: "1.0.0",
          private: true,
          scripts: { "status-check": ROOT_PACKAGE.scripts["status-check"] },
        }),
      );
      fs.writeFileSync(
        path.join(directory, "bin", "curl"),
        `#!/bin/sh\nfor last in "$@"; do :; done\necho "$last" >> "${calls}"\nprintf 200\n`,
        { mode: 0o755 },
      );
      fs.writeFileSync(path.join(directory, "bin", "sleep"), "#!/bin/sh\n", {
        mode: 0o755,
      });

      const env = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (!key.toLowerCase().startsWith("npm_")) {
          env[key] = value;
        }
      }
      env.PATH = `${path.join(directory, "bin")}${path.delimiter}${process.env.PATH}`;
      env.npm_config_update_notifier = "false";

      const result = spawnSync(
        "npm",
        ["run", "status-check", "--services=app"],
        { cwd: directory, env, encoding: "utf8", timeout: 120 * 1000 },
      );
      const checked = fs.readFileSync(calls, "utf8").trim().split("\n");

      expect(result.status).toBe(0);
      expect(checked[0]).toBe("localhost:8080");
      expect(checked).not.toContain("app");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("what it says once OneUptime is up", () => {
  test("it says OneUptime is up only after the backend held ready, then where to open it and sign up", () => {
    const result = statusCheck({
      config: configWith([
        "HOST=oneuptime.example.com",
        "HTTP_PROTOCOL=http",
        "ONEUPTIME_HTTP_PORT=80",
      ]),
    });
    const held = result.output.indexOf("Backend held ready across 5");
    const up = result.output.indexOf("OneUptime is up!");

    expect(result.status).toBe(0);
    expect(held).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(held);
    expect(result.output).toContain(
      "Open http://oneuptime.example.com in your browser. On a new install, sign up at http://oneuptime.example.com/accounts/register: the first account becomes the admin of this OneUptime.",
    );
    expect(result.output).not.toContain("Only this computer can open");
  });

  test("an https install is opened over https", () => {
    const result = statusCheck({
      config: configWith(["HOST=oneuptime.example.com", "HTTP_PROTOCOL=https"]),
    });

    expect(result.output).toContain(
      "Open https://oneuptime.example.com in your browser.",
    );
    expect(result.output).toContain(
      "https://oneuptime.example.com/accounts/register",
    );
  });

  test("anything but https is opened over http, as OneUptime builds its links", () => {
    const result = statusCheck({
      config: configWith(["HOST=oneuptime.example.com", "HTTP_PROTOCOL=HTTPS"]),
    });

    expect(result.output).toContain(
      "Open http://oneuptime.example.com in your browser.",
    );
  });

  test.each([
    "localhost",
    "localhost:8080",
    "127.0.0.1",
    "[::1]",
    "[::1]:8080",
  ])(
    "HOST=%s: it says only this computer can open it, and what to set for the others",
    (host) => {
      const result = statusCheck({
        config: configWith([`HOST=${host}`, "HTTP_PROTOCOL=http"]),
      });

      expect(result.output).toContain(`Open http://${host} in your browser.`);
      expect(result.output).toContain(
        `Only this computer can open http://${host}. To open OneUptime from other computers, set HOST in config.env to this server's domain name or IP address, then run npm start again.`,
      );
    },
  );

  test.each([
    ["[2001:db8::1]", "http://[2001:db8::1]"],
    ["[2001:db8::1]:8080", "http://[2001:db8::1]:8080"],
    ["203.0.113.5:8080", "http://203.0.113.5:8080"],
  ])(
    "HOST=%s is opened at %s, a web address another computer can open",
    (host, address) => {
      const result = statusCheck({
        config: configWith([`HOST=${host}`, "HTTP_PROTOCOL=http"]),
      });

      expect(result.output).toContain(`Open ${address} in your browser.`);
      expect(result.output).toContain(
        `Then finish setting up this server: ${address}/admin/setup`,
      );
      expect(result.output).not.toContain("Only this computer can open");
      expect(new URL(`${address}/admin/setup`).pathname).toBe("/admin/setup");
    },
  );

  test("right after where to sign up, it says where to finish setting up the server (#6824)", () => {
    const result = statusCheck({
      config: configWith([
        "HOST=oneuptime.example.com",
        "HTTP_PROTOCOL=http",
        "ONEUPTIME_HTTP_PORT=80",
      ]),
    });
    const lines = result.output.split("\n");
    const signUp = lines.findIndex((line) => {
      return line.startsWith(
        "Open http://oneuptime.example.com in your browser.",
      );
    });

    expect(signUp).toBeGreaterThan(0);
    expect(lines[signUp + 1]).toBe(
      "Then finish setting up this server: http://oneuptime.example.com/admin/setup",
    );
  });

  test("the setup address follows HTTP_PROTOCOL and HOST, port included", () => {
    const https = statusCheck({
      config: configWith(["HOST=oneuptime.example.com", "HTTP_PROTOCOL=https"]),
    });
    const local = statusCheck({
      config: configWith(["HOST=localhost:8080", "HTTP_PROTOCOL=http"]),
    });

    expect(https.output).toContain(
      "Then finish setting up this server: https://oneuptime.example.com/admin/setup",
    );
    expect(local.output).toContain(
      "Then finish setting up this server: http://localhost:8080/admin/setup",
    );
  });

  test("with no HOST anywhere, it says it is up and names no address", () => {
    const result = statusCheck({ config: null });

    expect(result.status).toBe(0);
    expect(result.output).toContain("OneUptime is up!");
    expect(result.output).not.toContain("in your browser");
    expect(result.output).not.toContain("finish setting up this server");
  });

  test("it ends with one line about feedback and support, not a page of it", () => {
    const result = statusCheck({
      config: configWith(["HOST=localhost"]),
    });
    const lines = result.output.trim().split("\n");

    expect(lines[lines.length - 1]).toBe(
      "Questions or feedback? Email hello@oneuptime.com. Running OneUptime for your organization? Ask sales@oneuptime.com about priority support.",
    );
    expect(result.output).not.toContain("estimated time to ship");
  });
});

describe("when OneUptime does not answer", () => {
  test("nothing listening: after the retries it says so, names the address, and how to look", () => {
    const result = statusCheck({
      config: configWith(["HOST=localhost", "ONEUPTIME_HTTP_PORT=80"]),
      code: "000",
    });

    expect(result.status).toBe(1);
    expect(result.calls).toEqual(new Array(20).fill("localhost"));
    expect(result.output).toContain(
      "❌ Error: Maximum retries reached, App still not returning HTTP 200.",
    );
    expect(result.output).toContain(
      "Nothing answered at localhost. If OneUptime's ingress is on another port, check that one: bash Tests/Scripts/status-check.sh localhost:<port>",
    );
    expect(result.output).toContain(
      "See what is running with npm run ps, and why something stopped with npm run logs.",
    );
    expect(result.output).not.toContain("OneUptime is up!");
  });

  test.each([
    ["127.0.0.1:8080", "127.0.0.1:8080"],
    ["[::1]:8443", "[::1]:8443"],
    ["10.0.0.5:80", "10.0.0.5"],
  ])(
    "nothing listening at ONEUPTIME_HTTP_PORT=%s: it names the address it connected to, not localhost",
    (setting, address) => {
      const result = statusCheck({
        config: configWith([`ONEUPTIME_HTTP_PORT=${setting}`]),
        code: "000",
      });

      expect(result.status).toBe(1);
      expect(result.requests).toHaveLength(20);
      expect(result.output).toContain(
        `Nothing answered at ${address}, where ONEUPTIME_HTTP_PORT in config.env publishes OneUptime's ingress.`,
      );
      expect(result.output).toContain(
        `App ${result.calls[0]} at ${address} returned HTTP 000, retrying in 15 seconds.`,
      );
      expect(result.output).not.toContain("check that one");
    },
  );

  test("an address on one address of the server that answers with an error says where it asked", () => {
    const result = statusCheck({
      config: configWith(["ONEUPTIME_HTTP_PORT=127.0.0.1:8080"]),
      codeFor: { "/accounts": "404" },
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Accounts localhost:8080/accounts at 127.0.0.1:8080 returned HTTP 404, retrying in 15 seconds.",
    );
    expect(result.output).not.toContain("Nothing answered at");
  });

  test("an endpoint that answers with an error is retried, and no hint about ports is given", () => {
    const result = statusCheck({
      config: configWith(["HOST=localhost"]),
      codeFor: { "/dashboard": "502" },
    });

    expect(result.status).toBe(1);
    expect(
      result.calls.filter((call) => {
        return call === "localhost/dashboard";
      }),
    ).toHaveLength(20);
    expect(result.output).toContain("returned HTTP 502");
    expect(result.output).not.toContain("Nothing answered at");
  });

  test("a backend that never holds ready fails, as before", () => {
    const result = statusCheck({
      config: configWith(["HOST=localhost"]),
      codeFor: { "/status/ready": "503" },
    });

    expect(result.status).toBe(1);
    expect(result.output).not.toContain("OneUptime is up!");
  });
});
