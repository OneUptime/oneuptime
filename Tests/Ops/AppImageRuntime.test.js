"use strict";

/**
 * The App image, started as Docker Compose starts it, serving what it serves.
 *
 * Each edition's image copies /usr/src out of a pruned build
 * (packages/App/Dockerfile.tpl, Scripts/Docker/PruneUnreachablePackages.js):
 * Common pruned to the packages the App reaches, the App without its
 * development packages, the six frontends without their own installs (their
 * bundles are built), and no tests or type-check output. A package the walk
 * missed, or a file the build needed that went with them, would fail only
 * when something reads it. So this starts the image with the repository's
 * docker-compose.yml - its PostgreSQL, ClickHouse and Valkey, in a project of
 * its own - and checks, through curl inside the App's container:
 *
 *   - it boots: every module of its import graph loaded, the migrations ran,
 *     and /status/ready answers (database, cache and ClickHouse reached);
 *   - each frontend's page and its bundle (Accounts, Dashboard, Admin
 *     Dashboard, Status Page, Public Dashboard), which the frontends'
 *     removed installs built;
 *   - the docs and the mermaid build they draw diagrams with
 *     (Common/build/mermaid-browser), the API reference and an agent's
 *     install script (/usr/src/agents);
 *   - the API: the first account signs up and is signed in, creates a
 *     project, a monitor in it, and reads the monitor back;
 *   - the external calendar's worker thread, the one code a walk from the
 *     App's entry does not reach (it alone loads ical.js), expands a
 *     calendar;
 *   - and nothing in its log says a module could not be found.
 *
 * Needs Docker, the image tagged oneuptime/app:<APP_IMAGE_TAG>, and the
 * datastore images docker-compose.yml runs. The Build workflow's App job
 * builds the Community Edition image, tags it oneuptime/app:ci-runtime and
 * runs this suite with RUN_APP_IMAGE_RUNTIME_TESTS=1 APP_IMAGE_TAG=ci-runtime;
 * without them the suite is skipped. Locally:
 *
 *   RUN_APP_IMAGE_RUNTIME_TESTS=1 APP_IMAGE_TAG=<tag> npx jest AppImageRuntime
 *
 * The project has a name of its own, publishes PostgreSQL on a free loopback
 * port, and is removed with its volumes.
 */

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");
const { REPO_ROOT } = require("./Utils/ComposePorts");
const ReplacePlaceholderSecrets = require("../../Scripts/Install/ReplacePlaceholderSecrets");

const RUN = process.env.RUN_APP_IMAGE_RUNTIME_TESTS === "1";
// The tag the Build workflow gives the image it built, and runs this with.
const CI_TAG = "ci-runtime";
const TAG = process.env.APP_IMAGE_TAG || CI_TAG;
const describeRuntime = RUN ? describe : describe.skip;

const PLACEHOLDER = "please-change-this-to-random-value";
const TEMPLATE = fs.readFileSync(
  path.join(REPO_ROOT, "config.example.env"),
  "utf8",
);

const BOOT_TIMEOUT_MS = 10 * 60 * 1000;

jest.setTimeout(BOOT_TIMEOUT_MS + 5 * 60 * 1000);

/*
 * Expands a one-event calendar through ExternalCalendarExpansion, which runs
 * ExternalCalendarExpansionWorker.cjs in a worker thread, and prints what it
 * found. Run in the App's container with node and ts-node, as the App runs.
 */
const CALENDAR_CHECK = [
  'const Expansion = require("/usr/src/Common/Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarExpansion.ts").default;',
  "const now = new Date();",
  "const stamp = (date) => date.toISOString().split('-').join('').split(':').join('').split('.')[0] + 'Z';",
  "const start = new Date(now.getTime() + 86400000);",
  "const end = new Date(start.getTime() + 3600000);",
  "const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OneUptime//runtime//EN', 'BEGIN:VEVENT', 'UID:runtime@example.com', 'DTSTAMP:' + stamp(now), 'DTSTART:' + stamp(start), 'DTEND:' + stamp(end), 'SUMMARY:Database upgrade', 'END:VEVENT', 'END:VCALENDAR', ''].join('\\r\\n');",
  "Expansion.expand(text, { now }).then((result) => { console.log(JSON.stringify(result)); process.exit(result.ok ? 0 : 1); }, (error) => { console.error(error); process.exit(2); });",
].join("\n");

describe("the Build workflow runs these checks", () => {
  test("its App job tags the Community image it built, then runs the suite with RUN_APP_IMAGE_RUNTIME_TESTS=1", () => {
    const job = yaml.load(
      fs.readFileSync(
        path.join(REPO_ROOT, ".github", "workflows", "build.yml"),
        "utf8",
      ),
    ).jobs["docker-build-app"];
    const commands = job.steps.map((step) => {
      return [step.run, step.with && step.with.command]
        .filter(Boolean)
        .join("\n");
    });
    const build = commands.findIndex((command) => {
      return (
        command.includes("docker build") &&
        command.includes("--target community -t oneuptime-app:community")
      );
    });
    const tag = commands.findIndex((command) => {
      return command.includes(
        `docker tag oneuptime-app:community oneuptime/app:${CI_TAG}`,
      );
    });
    const runtime = commands.findIndex((command) => {
      return (
        command.includes("RUN_APP_IMAGE_RUNTIME_TESTS=1") &&
        command.includes(`APP_IMAGE_TAG=${CI_TAG} `) &&
        command.includes("AppImageRuntime")
      );
    });

    expect(build).toBeGreaterThanOrEqual(0);
    expect(tag).toBeGreaterThan(build);
    expect(runtime).toBeGreaterThanOrEqual(tag);
    // Tagged before the suite runs, in the same step or an earlier one.
    const command = commands[runtime];
    if (runtime === tag) {
      expect(command.indexOf("docker tag")).toBeLessThan(
        command.indexOf("RUN_APP_IMAGE_RUNTIME_TESTS=1"),
      );
    }
  });
});

function docker(args, options) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: BOOT_TIMEOUT_MS,
    ...(options || {}),
  });

  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

const STATUS_MARKER = "\nSTATUS:";

describeRuntime("the App image, as Docker Compose starts it", () => {
  const project = `oneuptime-ops-app-${process.pid}-${crypto
    .randomBytes(3)
    .toString("hex")}`;
  let directory;
  let configFile;
  let ready = false;
  let logs = "";
  // The first account's session, and the project it makes.
  let userToken = "";
  let projectId = "";

  function env() {
    return {
      ...process.env,
      ...Object.fromEntries(
        ReplacePlaceholderSecrets.readSettings(
          fs.readFileSync(configFile, "utf8"),
        ),
      ),
    };
  }

  function compose(args) {
    return docker(
      [
        "compose",
        "--project-directory",
        REPO_ROOT,
        "-f",
        path.join(REPO_ROOT, "docker-compose.yml"),
        ...args,
      ],
      { cwd: REPO_ROOT, env: env() },
    );
  }

  /*
   * One request from inside the App's container, where it listens on 3002:
   * its final status, its body, and the headers of every answer on the way
   * (redirects followed when `follow` is set).
   */
  function request(method, route, options = {}) {
    const result = compose([
      "exec",
      "-T",
      "app",
      "curl",
      "-sS",
      "--max-time",
      "60",
      "-D",
      "/dev/stderr",
      ...(options.follow ? ["-L"] : []),
      "-X",
      method,
      ...Object.entries(options.headers || {}).flatMap(([name, value]) => {
        return ["-H", `${name}: ${value}`];
      }),
      ...(options.body === undefined
        ? []
        : [
            "-H",
            "Content-Type: application/json",
            "--data",
            JSON.stringify(options.body),
          ]),
      "-w",
      `${STATUS_MARKER}%{http_code}`,
      `http://localhost:3002${route}`,
    ]);
    const marker = result.stdout.lastIndexOf(STATUS_MARKER);

    return {
      status:
        marker === -1
          ? 0
          : Number(result.stdout.slice(marker + STATUS_MARKER.length).trim()),
      body: marker === -1 ? result.stdout : result.stdout.slice(0, marker),
      // As sent: a cookie's value is case-sensitive.
      headers: result.stderr,
    };
  }

  function json(body) {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  beforeAll(async () => {
    expect(docker(["image", "inspect", `oneuptime/app:${TAG}`]).status).toBe(0);

    directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-ops-app-"));
    configFile = path.join(directory, "config.env");

    // config.example.env as `npm start` leaves it: every secret its own.
    const secrets = TEMPLATE.split("\n")
      .map((line) => {
        return line.includes(PLACEHOLDER)
          ? line.split(PLACEHOLDER).join(crypto.randomBytes(24).toString("hex"))
          : line;
      })
      .join("\n");
    fs.writeFileSync(
      configFile,
      [
        secrets,
        `COMPOSE_PROJECT_NAME=${project}`,
        `APP_TAG=${TAG}`,
        `DATABASE_PUBLISHED_PORT=${await freePort()}`,
        "",
      ].join("\n"),
    );

    const up = compose(["up", "-d", "--no-build", "--pull", "missing", "app"]);
    if (up.status !== 0) {
      throw new Error(`compose up failed: ${up.output}`);
    }

    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = compose(["ps", "--format", "{{.State}}", "app"]);
      if (!state.stdout.includes("running")) {
        break;
      }
      if (request("GET", "/status/ready").status === 200) {
        ready = true;
        break;
      }
      await sleep(5000);
    }

    logs = compose(["logs", "--no-color", "app"]).output;
  });

  afterAll(() => {
    if (configFile && fs.existsSync(configFile)) {
      compose(["down", "-v", "--remove-orphans"]);
    }
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("it boots: the migrations ran, and /status/ready answers", () => {
    expect({ ready, logs: ready ? "" : logs.slice(-6000) }).toEqual({
      ready: true,
      logs: "",
    });
    expect(request("GET", "/status/live").status).toBe(200);
  });

  test.each([
    ["Accounts", "/accounts/", "/accounts/dist/Index.js"],
    ["the Dashboard", "/dashboard/", "/dashboard/dist/Index.js"],
    ["the Admin Dashboard", "/admin/", "/admin/dist/Index.js"],
  ])(
    "%s: its page names its bundle, and the bundle is served",
    (_name, page, bundle) => {
      const html = request("GET", page, { follow: true });
      expect(html.status).toBe(200);
      expect(html.body).toContain(`src="${bundle}"`);

      const script = request("GET", bundle);
      expect(script.status).toBe(200);
      expect(script.headers).toMatch(/content-type: [a-z/]*javascript/i);
      expect(script.body.length).toBeGreaterThan(1000);
    },
  );

  test.each([
    ["the Status Page", "/status-page/dist/Index.js"],
    ["the Public Dashboard", "/public-dashboard/dist/Index.js"],
  ])("%s's bundle is served", (_name, bundle) => {
    const script = request("GET", bundle);
    expect(script.status).toBe(200);
    expect(script.body.length).toBeGreaterThan(1000);
  });

  test("the docs, and the mermaid build their diagrams are drawn with", () => {
    const docs = request("GET", "/docs", { follow: true });
    expect(docs.status).toBe(200);
    expect(docs.body).toContain("<html");

    const mermaid = request("GET", "/oneuptime-assets/mermaid/mermaid.mjs");
    expect(mermaid.status).toBe(200);
    expect(mermaid.body.length).toBeGreaterThan(1000);
  });

  test("the API reference, and an agent's install script", () => {
    const reference = request("GET", "/reference", { follow: true });
    expect(reference.status).toBe(200);
    expect(reference.body).toContain("<html");

    const script = request("GET", "/install/docker-agent");
    expect(script.status).toBe(200);
    expect(script.body.startsWith("#!")).toBe(true);
  });

  test("the first account signs up and is signed in", () => {
    const signup = request("POST", "/api/identity/signup", {
      body: {
        data: {
          email: { _type: "Email", value: "first-admin@example.com" },
          name: { _type: "Name", value: "First Admin" },
          password: {
            _type: "HashedString",
            value: `Runtime-${crypto.randomBytes(8).toString("hex")}!`,
          },
        },
        miscDataProps: {},
      },
    });

    expect({
      status: signup.status,
      body: signup.status === 200 ? "" : signup.body.slice(0, 2000),
    }).toEqual({ status: 200, body: "" });

    const cookie = signup.headers.split("\n").find((line) => {
      return line.toLowerCase().startsWith("set-cookie: user-token=");
    });
    expect(cookie).toBeDefined();
    userToken = cookie.slice("set-cookie: user-token=".length).split(";")[0];
    expect(userToken.length).toBeGreaterThan(20);
  });

  test("the account creates a project, a monitor in it, and reads the monitor back", () => {
    expect(userToken).not.toBe("");
    const asUser = { Cookie: `user-token=${userToken}` };

    const created = request("POST", "/api/project", {
      headers: asUser,
      body: { data: { name: "Runtime check" } },
    });
    expect({
      status: created.status,
      body: created.body.slice(0, 500),
    }).toEqual({ status: 200, body: expect.any(String) });
    projectId = json(created.body)._id;
    expect(projectId).toEqual(expect.any(String));

    const inProject = { ...asUser, tenantid: projectId };
    const monitor = request("POST", "/api/monitor", {
      headers: inProject,
      body: {
        data: {
          name: "Runtime monitor",
          projectId: projectId,
          monitorType: "Manual",
        },
      },
    });
    expect({
      status: monitor.status,
      body: monitor.body.slice(0, 500),
    }).toEqual({ status: 200, body: expect.any(String) });

    const list = request("POST", "/api/monitor/get-list", {
      headers: inProject,
      body: { query: {}, select: { name: true }, limit: 10, skip: 0 },
    });
    expect(list.status).toBe(200);
    expect(
      (json(list.body).data || []).map((item) => {
        return item.name;
      }),
    ).toEqual(["Runtime monitor"]);
  });

  test("the external calendar's worker thread expands a calendar: it alone loads ical.js", () => {
    const run = compose([
      "exec",
      "-T",
      "-e",
      "TS_NODE_TRANSPILE_ONLY=1",
      "app",
      "node",
      "--require",
      "ts-node/register",
      "-e",
      CALENDAR_CHECK,
    ]);

    expect({
      status: run.status,
      output: run.status === 0 ? "" : run.output.slice(-3000),
    }).toEqual({
      status: 0,
      output: "",
    });
    const result = json(run.stdout.trim().split("\n").pop());
    expect(result.ok).toBe(true);
    expect(
      (result.events || []).map((event) => {
        return event.title;
      }),
    ).toEqual(["Database upgrade"]);
  });

  test("its log names no missing module", () => {
    const all = compose(["logs", "--no-color", "app"]).output;
    expect(all).not.toMatch(/Cannot find module|MODULE_NOT_FOUND/);
  });
});
