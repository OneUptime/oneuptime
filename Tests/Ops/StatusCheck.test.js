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
 * These tests run the script itself in a throwaway directory, with a `curl`
 * on PATH that records every address it is asked for and answers with a
 * status code the test picks, and a `sleep` that returns at once.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

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
  "/status-page",
];

/*
 * Runs status-check.sh in a throwaway directory holding `config` as
 * config.env (none when null), with `args`, the environment `env` adds and a
 * curl answering `code` (or each address's code from `codeFor`).
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
        `echo "$last" >> "${calls}"`,
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

    return {
      status: result.status,
      output: `${result.stdout || ""}${result.stderr || ""}`,
      calls: fs.existsSync(calls)
        ? fs.readFileSync(calls, "utf8").trim().split("\n")
        : [],
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function configWith(lines) {
  return `${lines.join("\n")}\n`;
}

describe("the address it checks", () => {
  test.each([
    ["80", "localhost"],
    ["", "localhost"],
    ["8080", "localhost:8080"],
    ["127.0.0.1:8080", "127.0.0.1:8080"],
    ["127.0.0.1:80", "127.0.0.1"],
    ["0.0.0.0:8080", "localhost:8080"],
    ["[::1]:8080", "[::1]:8080"],
    ["10.0.0.5:8443", "10.0.0.5:8443"],
    ['"8080"', "localhost:8080"],
    ["'8080'", "localhost:8080"],
    [" 8080 ", "localhost:8080"],
  ])(
    "ONEUPTIME_HTTP_PORT=%s in config.env: the ingress at %s",
    (setting, address) => {
      const result = statusCheck({
        config: configWith([
          "HOST=localhost",
          `ONEUPTIME_HTTP_PORT=${setting}`,
        ]),
      });

      expect(result.status).toBe(0);
      expect(result.calls.slice(0, ENDPOINTS.length)).toEqual(
        ENDPOINTS.map((endpoint) => {
          return `${address}${endpoint}`;
        }),
      );
      expect(result.output).toContain(
        `Waiting for OneUptime to answer at ${address}.`,
      );
    },
  );

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

  test("an empty argument is no address: the ingress is checked", () => {
    const result = statusCheck({
      config: configWith(["ONEUPTIME_HTTP_PORT=8080"]),
      args: [""],
    });

    expect(result.calls[0]).toBe("localhost:8080");
  });
});

describe("how npm runs it", () => {
  test("npm's status-check script hands it no address, so it checks the ingress config.env names", () => {
    expect(ROOT_PACKAGE.scripts["status-check"]).toBe(
      "bash ./Tests/Scripts/status-check.sh",
    );
    expect(ROOT_PACKAGE.scripts.start.endsWith("&& npm run status-check")).toBe(
      true,
    );
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

  test.each(["localhost", "localhost:8080", "127.0.0.1"])(
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

  test("with no HOST anywhere, it says it is up and names no address", () => {
    const result = statusCheck({ config: null });

    expect(result.status).toBe(0);
    expect(result.output).toContain("OneUptime is up!");
    expect(result.output).not.toContain("in your browser");
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
