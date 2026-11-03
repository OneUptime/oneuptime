"use strict";

/**
 * The Runner image, started as it ships, doing what it is for.
 *
 * The image is pruned to the packages the Runner reaches
 * (Scripts/Docker/PruneUnreachablePackages.js, packages/Runner/Dockerfile.tpl):
 * a package the walk missed would be gone from the image and fail only when
 * the code that loads it runs. So this starts the built image with its own
 * command, against a stand-in for the OneUptime server on this machine, and
 * checks what a Runner does for a project:
 *
 *   - it registers (POST /runner-ingest/heartbeat with its id and key) and
 *     keeps heartbeating;
 *   - it claims a runbook's JavaScript step and runs it in its isolated-vm
 *     sandbox (a native addon) with the run's inputs as `args`, and a Bash
 *     step with the inputs in its environment, and reports each result;
 *   - its own server answers /status/live, and nothing in its log says a
 *     module could not be found.
 *
 * Needs Docker and the image. The Build workflow builds the Runner image on
 * every pull request and runs this suite against it with
 * RUN_RUNNER_IMAGE_RUNTIME_TESTS=1 and RUNNER_IMAGE set to the tag it built;
 * without them the suite is skipped. Locally:
 *
 *   RUN_RUNNER_IMAGE_RUNTIME_TESTS=1 RUNNER_IMAGE=<tag> npx jest RunnerImageRuntime
 *
 * The container runs on the host's network (so it reaches the stand-in on
 * 127.0.0.1) with a free port of its own, and a name of its own, and is
 * removed afterwards.
 */

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RUN = process.env.RUN_RUNNER_IMAGE_RUNTIME_TESTS === "1";
// The tag the Build workflow builds the image under, and runs this suite with.
const CI_IMAGE = "oneuptime-runner:ci";
const IMAGE = process.env.RUNNER_IMAGE || CI_IMAGE;
const describeRuntime = RUN ? describe : describe.skip;

const WAIT_FOR_RESULTS_MS = 4 * 60 * 1000;

jest.setTimeout(WAIT_FOR_RESULTS_MS + 60 * 1000);

describe("the Build workflow runs these checks", () => {
  test("its Runner job builds the image under the tag this suite reads, then runs the suite with RUN_RUNNER_IMAGE_RUNTIME_TESTS=1", () => {
    const job = yaml.load(
      fs.readFileSync(
        path.join(REPO_ROOT, ".github", "workflows", "build.yml"),
        "utf8",
      ),
    ).jobs["docker-build-runner"];
    const commands = job.steps.map((step) => {
      return [step.run, step.with && step.with.command]
        .filter(Boolean)
        .join("\n");
    });
    const build = commands.findIndex((command) => {
      return (
        command.includes("docker build") &&
        command.includes(`-t ${CI_IMAGE} `) &&
        command.includes("./packages/Runner/Dockerfile")
      );
    });
    const runtime = commands.findIndex((command) => {
      return (
        command.includes("RUN_RUNNER_IMAGE_RUNTIME_TESTS=1") &&
        command.includes(`RUNNER_IMAGE=${CI_IMAGE} `) &&
        command.includes("RunnerImageRuntime")
      );
    });

    expect(build).toBeGreaterThanOrEqual(0);
    expect(runtime).toBeGreaterThan(build);
  });
});

function docker(args, options = {}) {
  return spawnSync("docker", args, { encoding: "utf8", ...options });
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

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        resolve({ unparsed: text });
      }
    });
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/*
 * The part of the OneUptime server a project's Runner talks to: registration
 * and heartbeats, claiming a job, a job's heartbeat and its result. Each job
 * is handed out once; every request is recorded.
 */
function standInServer({ runnerId, runnerKey, jobs }) {
  const requests = [];
  const results = new Map();
  const pending = [...jobs];

  const server = http.createServer(async (request, response) => {
    const body = request.method === "POST" ? await readBody(request) : {};
    requests.push({ method: request.method, url: request.url, body });

    const send = (status, payload) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    };

    const authorized = body.agentId === runnerId && body.agentKey === runnerKey;

    if (
      request.method !== "POST" ||
      !request.url.startsWith("/runner-ingest/")
    ) {
      send(404, { message: "Not found" });
      return;
    }

    if (!authorized) {
      send(401, { message: "Invalid Runner id or key." });
      return;
    }

    if (request.url === "/runner-ingest/heartbeat") {
      send(200, {
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: false,
          canRunAiCommands: false,
        },
        isGlobalRunner: false,
      });
      return;
    }

    if (request.url === "/runner-ingest/claim-next-job") {
      send(200, { job: pending.shift() || null });
      return;
    }

    const jobRoute = /^\/runner-ingest\/job\/([^/]+)\/(heartbeat|result)$/.exec(
      request.url,
    );

    if (jobRoute) {
      const jobId = decodeURIComponent(jobRoute[1]);
      if (jobRoute[2] === "result") {
        results.set(jobId, body);
        send(200, { accepted: true });
      } else {
        send(200, {});
      }
      return;
    }

    send(404, { message: "Not found" });
  });

  return { server, requests, results };
}

describeRuntime("the Runner image", () => {
  const containerName = `oneuptime-runner-runtime-${crypto.randomBytes(4).toString("hex")}`;
  const runnerId = crypto.randomUUID();
  const runnerKey = crypto.randomBytes(24).toString("hex");
  const inputs = { host: "db-1.internal", replicas: 3 };
  const javaScriptJob = {
    jobId: crypto.randomUUID(),
    runbookExecutionId: crypto.randomUUID(),
    origin: "Runbook",
    stepId: crypto.randomUUID(),
    stepType: "JavaScript",
    script: [
      'console.log("ran in the sandbox for " + args.inputs.host + ", started by " + args.trigger);',
      "return { sum: 40 + 2, replicas: args.inputs.replicas };",
    ].join("\n"),
    timeoutInMs: 30000,
    inputs,
    trigger: "Manual",
  };
  const bashJob = {
    jobId: crypto.randomUUID(),
    runbookExecutionId: javaScriptJob.runbookExecutionId,
    origin: "Runbook",
    stepId: crypto.randomUUID(),
    stepType: "Bash",
    script: 'echo "bash says $ONEUPTIME_INPUT_HOST"; uname -s',
    timeoutInMs: 30000,
    inputs,
    trigger: "Manual",
  };

  let stand;
  let runnerPort;
  let logs = "";

  beforeAll(async () => {
    expect(docker(["image", "inspect", IMAGE]).status).toBe(0);

    stand = standInServer({
      runnerId,
      runnerKey,
      jobs: [javaScriptJob, bashJob],
    });
    const serverPort = await freePort();
    await new Promise((resolve) => {
      stand.server.listen(serverPort, "127.0.0.1", resolve);
    });
    runnerPort = await freePort();

    const started = docker([
      "run",
      "-d",
      "--name",
      containerName,
      "--network",
      "host",
      "-e",
      `ONEUPTIME_URL=http://127.0.0.1:${serverPort}`,
      "-e",
      `ONEUPTIME_RUNNER_ID=${runnerId}`,
      "-e",
      `ONEUPTIME_RUNNER_KEY=${runnerKey}`,
      "-e",
      `PORT=${runnerPort}`,
      "-e",
      "ONEUPTIME_RUNNER_POLL_INTERVAL_MS=1000",
      IMAGE,
    ]);
    expect(started.stderr).toBe("");
    expect(started.status).toBe(0);

    const deadline = Date.now() + WAIT_FOR_RESULTS_MS;
    while (Date.now() < deadline && stand.results.size < 2) {
      const state = docker([
        "inspect",
        "--format",
        "{{.State.Running}}",
        containerName,
      ]);
      if (state.stdout.trim() !== "true") {
        break;
      }
      await sleep(1000);
    }

    const logRun = docker(["logs", containerName]);
    logs = `${logRun.stdout}\n${logRun.stderr}`;
  });

  afterAll(async () => {
    docker(["rm", "-f", "-v", containerName]);
    if (stand) {
      await new Promise((resolve) => {
        stand.server.close(resolve);
      });
    }
  });

  test("it registers with its id and key, and keeps heartbeating", () => {
    const heartbeats = stand.requests.filter((request) => {
      return request.url === "/runner-ingest/heartbeat";
    });

    expect(heartbeats.length).toBeGreaterThanOrEqual(1);
    expect(heartbeats[0].body.agentId).toBe(runnerId);
    expect(heartbeats[0].body.agentKey).toBe(runnerKey);
    expect(heartbeats[0].body.agentVersion).toEqual(expect.any(String));
  });

  test("it runs a runbook's JavaScript step in its sandbox, with the run's inputs as args", () => {
    const result = stand.results.get(javaScriptJob.jobId);

    expect({ result: result || null, logs: result ? "" : logs }).toEqual({
      result: expect.objectContaining({ success: true }),
      logs: "",
    });
    expect(result.output).toContain(
      "ran in the sandbox for db-1.internal, started by Manual",
    );
    expect(result.output).toContain('"sum": 42');
    expect(result.output).toContain('"replicas": 3');
  });

  test("it runs a Bash step with the run's inputs in its environment", () => {
    const result = stand.results.get(bashJob.jobId);

    expect({ result: result || null, logs: result ? "" : logs }).toEqual({
      result: expect.objectContaining({ success: true }),
      logs: "",
    });
    expect(result.output).toContain("bash says db-1.internal");
    expect(result.output).toContain("Linux");
  });

  test("its own server answers, and its log names no missing module", async () => {
    const live = await fetch(`http://127.0.0.1:${runnerPort}/status/live`);

    expect(live.status).toBe(200);
    expect(logs).not.toMatch(/Cannot find module|MODULE_NOT_FOUND/);
    expect(
      docker([
        "inspect",
        "--format",
        "{{.State.Running}}",
        containerName,
      ]).stdout.trim(),
    ).toBe("true");
  });
});
