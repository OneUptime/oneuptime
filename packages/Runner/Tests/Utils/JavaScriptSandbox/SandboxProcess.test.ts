/*
 * ---------------------------------------------------------------------------
 * A global Runner's JavaScript step, in a process of its own, run for real.
 *
 * Every test here starts real processes: the step's worker (SandboxWorker,
 * from its TypeScript, or from the bundle the image builds), or a stand-in
 * that behaves as code that got out of its isolate would (EscapedStep.js),
 * or one that does not keep to the protocol (MisbehavingWorker.js). They run
 * as this test's own user - what a Runner whose container forbids switching
 * users gets - so what they prove holds there too:
 *
 *   - a step runs, logs, returns, fails and times out exactly as it did in
 *     the Runner's own process, with the same egress policy;
 *   - its process holds none of the Runner's environment, starts in /, and
 *     under Node's permission model may read no file of the Runner's, list
 *     no directory of it, write nothing and start no process;
 *   - a process that hangs is killed at its deadline; one that answers
 *     nothing, the wrong request, garbage or too much fails the step with a
 *     plain reason;
 *   - with the launcher (a stand-in here; SandboxLauncherInDocker runs the
 *     real one, setuid), each step runs as a user no other running step
 *     holds, and its user is reaped and given back after it.
 * ---------------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import {
  DEFAULT_SANDBOX_PATH,
  PASSED_THROUGH_ENVIRONMENT,
  SANDBOX_DEADLINE_GRACE_MS,
  SANDBOX_WORKER_BUNDLE_PATH,
  SANDBOX_WORKER_SOURCE_PATH,
  STEP_ENDED_WITHOUT_RESULT_MESSAGE,
  STEP_HTTP_CHANNEL_MISUSED_MESSAGE,
  STEP_NO_NETWORK_FILTER_MESSAGE,
  STEP_NO_PRIVILEGE_MESSAGE,
  STEP_RAN_OUT_OF_TIME_MESSAGE,
  STEP_REPLY_TOO_LARGE_MESSAGE,
  SandboxDecision,
  SandboxRunOptions,
  SandboxStepRequest,
  SandboxWorkerEntry,
  getCommonPackageDirectory,
  getDefaultWorkerEntry,
  getReadableRoots,
  getRunnerPackageDirectory,
  getSandboxEnvironment,
  getSandboxNodeArguments,
  getSandboxProgram,
  logSandboxDecision,
  runSandboxedStep,
  toSandboxReport,
  usesOpenSslCertificateStore,
} from "../../../Utils/JavaScriptSandbox/SandboxProcess";
import {
  SANDBOX_IDENTITY_MIN,
  SandboxIdentityPool,
  SandboxIsolation,
  SandboxIsolationDecision,
  callLauncher,
} from "../../../Utils/JavaScriptSandbox/SandboxIdentity";
import {
  NO_NETWORK,
  NO_NETWORK_EXIT_NO_FILTER,
  SandboxNetwork,
  SandboxNetworkDecision,
} from "../../../Utils/JavaScriptSandbox/SandboxNetwork";
import { JavaScriptStepOutcome } from "../../../Utils/JavaScriptSandbox/JavaScriptStepResult";
import { TRUNCATED_OUTPUT_MARKER } from "../../../Utils/OutputTruncation";
import { GLOBAL_RUNNER_JAVASCRIPT_PRIVATE_NETWORK_HINT } from "../../../Services/RunbookExecutor";
import {
  GlobalRunnerStepNetwork,
  GlobalRunnerStepNetworkReason,
  GlobalRunnerStepUser,
  GlobalRunnerStepUserReason,
} from "Common/Types/Runner/GlobalRunnerSandbox";
import logger from "Common/Server/Utils/Logger";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

jest.setTimeout(180_000);

const HELPERS: string = path.join(__dirname, "Helpers");

const PROCESS_ID_PATTERN: RegExp = /^\d+$/;
const DEAD_STATE_PATTERN: RegExp = /State:\s+[ZX]/;

const OWN_PROCESS: SandboxIsolationDecision = {
  isolation: SandboxIsolation.OwnProcess,
  reason: "a test",
  reasonCode: GlobalRunnerStepUserReason.CheckFailed,
};

/*
 * In jest there is no seccomp wrapper binary, so a step's process shares the
 * test's network - and Node's permission model, without --allow-net, is what
 * keeps it off a socket. The wrapper's own path is one nothing runs.
 */
const SHARED_NETWORK: SandboxNetworkDecision = {
  network: SandboxNetwork.Shared,
  reason: "a test",
  reasonCode: GlobalRunnerStepNetworkReason.CheckFailed,
};

const SOURCE_WORKER: SandboxWorkerEntry = {
  path: SANDBOX_WORKER_SOURCE_PATH,
  kind: "source",
};

const ESCAPED_STEP: SandboxWorkerEntry = {
  path: path.join(HELPERS, "EscapedStep.js"),
  kind: "source",
};

const MISBEHAVING_WORKER: SandboxWorkerEntry = {
  path: path.join(HELPERS, "MisbehavingWorker.js"),
  kind: "source",
};

const GLOBAL_POLICY: SandboxStepRequest["policy"] = {
  allowPrivateNetworkRequests: false,
  privateNetworkAccessIsAllowed: false,
  privateNetworkHint: GLOBAL_RUNNER_JAVASCRIPT_PRIVATE_NETWORK_HINT,
  includeResolutionDetailInError: false,
};

function stepOf(
  script: string,
  overrides: Partial<SandboxStepRequest> = {},
): SandboxStepRequest {
  return {
    script,
    args: {},
    timeoutInMs: 10_000,
    maxOutputBytes: 50_000,
    policy: GLOBAL_POLICY,
    ...overrides,
  };
}

function optionsOf(
  overrides: Partial<SandboxRunOptions> = {},
): SandboxRunOptions {
  return {
    isolation: OWN_PROCESS,
    identities: null,
    launcherPath: "/nonexistent/javascript-sandbox",
    network: SHARED_NETWORK,
    noNetworkPath: "/nonexistent/javascript-sandbox-no-network",
    workerEntry: SOURCE_WORKER,
    deadlineGraceMs: SANDBOX_DEADLINE_GRACE_MS,
    ...overrides,
  };
}

const loggerInfo: jest.Mock = logger.info as unknown as jest.Mock;
const loggerWarn: jest.Mock = logger.warn as unknown as jest.Mock;

// The processes still running this file as their program.
function processesRunning(file: string): Array<number> {
  const found: Array<number> = [];

  for (const entry of fs.readdirSync("/proc")) {
    if (!PROCESS_ID_PATTERN.test(entry)) {
      continue;
    }

    try {
      const commandLine: string = fs.readFileSync(
        `/proc/${entry}/cmdline`,
        "utf8",
      );
      const status: string = fs.readFileSync(`/proc/${entry}/status`, "utf8");

      if (commandLine.includes(file) && !DEAD_STATE_PATTERN.test(status)) {
        found.push(Number(entry));
      }
    } catch {
      // Gone between the listing and the read.
    }
  }

  return found;
}

describe("a step, in a process of its own", () => {
  test("logs and returns what it would in the Runner's own process, from the run's inputs", async () => {
    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf(
        "console.log('checking', args.inputs.host); return { host: args.inputs.host, ok: true };",
        { args: { inputs: { host: "web-1" }, trigger: "Webhook" } },
      ),
      optionsOf(),
    );

    expect(outcome).toEqual({
      success: true,
      output: 'checking web-1\nReturn: {\n  "host": "web-1",\n  "ok": true\n}',
    });
  });

  test("a step that throws fails with its own error, and keeps what it logged", async () => {
    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf("console.log('before'); throw new Error('the check failed');"),
      optionsOf(),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.output).toBe("before");
    expect(outcome.errorMessage).toBe("the check failed");
  });

  test("a step past its time limit is stopped by its isolate, as before", async () => {
    const started: number = Date.now();
    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf("while (true) {}", { timeoutInMs: 1_000 }),
      optionsOf(),
    );

    expect(outcome.success).toBe(false);
    expect(String(outcome.errorMessage).toLowerCase()).toContain("timed out");
    expect(Date.now() - started).toBeLessThan(SANDBOX_DEADLINE_GRACE_MS);
  });

  /*
   * The step's process has no network of its own: its isolate's axios goes
   * over the HTTP channel to the Runner, which makes the request through the
   * SSRF guard with the Runner's policy. A refusal is a whole round trip - the
   * process could not have refused a private address itself - so this proves
   * the channel carries the step's HTTP, and the guard holds it to the policy.
   */
  test("its HTTP is held to the global Runner's policy by the Runner: a private address is refused, with what to do instead", async () => {
    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf("await axios.get('http://10.0.0.1/'); return 'reached';"),
      optionsOf(),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.errorMessage).toBe(
      `Request URL points to a private network address and is not allowed.${GLOBAL_RUNNER_JAVASCRIPT_PRIVATE_NETWORK_HINT}`,
    );
  });

  test("and the host it runs on is refused too", async () => {
    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf("await axios.get('http://127.0.0.1:9/'); return 'reached';"),
      optionsOf(),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.errorMessage).toBe(
      "Request URL points to a private, loopback, or link-local address and is not allowed.",
    );
  });

  test("its output is cut to the Runner's limit, and says so", async () => {
    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf("console.log('x'.repeat(5000)); return 1;", {
        maxOutputBytes: 100,
      }),
      optionsOf(),
    );

    expect(outcome.success).toBe(true);
    expect(outcome.output.endsWith(TRUNCATED_OUTPUT_MARKER)).toBe(true);
    expect(Buffer.byteLength(outcome.output, "utf8")).toBe(
      100 + Buffer.byteLength(TRUNCATED_OUTPUT_MARKER, "utf8"),
    );
  });

  test("two steps at once run in two processes, neither of them the Runner's", async () => {
    const outcomes: Array<JavaScriptStepOutcome> = await Promise.all([
      runSandboxedStep(
        stepOf(""),
        optionsOf({ workerEntry: MISBEHAVING_WORKER }),
      ),
      runSandboxedStep(
        stepOf(""),
        optionsOf({ workerEntry: MISBEHAVING_WORKER }),
      ),
    ]);

    const pids: Array<number> = outcomes.map(
      (outcome: JavaScriptStepOutcome): number => {
        expect(outcome.success).toBe(true);
        return Number(outcome.output);
      },
    );

    expect(pids[0]).not.toBe(pids[1]);
    expect(pids).not.toContain(process.pid);
  });
});

describe("what a step's process holds, even if its code got out of the isolate", () => {
  let privateDirectory: string;
  let privateFile: string;
  let writableDirectory: string;
  let report: Record<string, unknown>;

  beforeAll(async () => {
    privateDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "runner-private-"),
    );
    fs.chmodSync(privateDirectory, 0o700);
    fs.writeFileSync(path.join(privateDirectory, "repository"), "private code");
    privateFile = path.join(privateDirectory, "credential");
    fs.writeFileSync(privateFile, "a repository token", { mode: 0o600 });
    writableDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "runner-open-"));
    fs.chmodSync(writableDirectory, 0o777);

    process.env["ONEUPTIME_TEST_RUNNER_SECRET"] = "only-the-runner-knows";

    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf("", {
        args: {
          runnerPid: process.pid,
          runnerFile: privateFile,
          runnerDirectory: privateDirectory,
          writeDirectory: writableDirectory,
        },
      }),
      optionsOf({ workerEntry: ESCAPED_STEP }),
    );

    expect(outcome.success).toBe(true);
    report = JSON.parse(outcome.output) as Record<string, unknown>;
  });

  afterAll(() => {
    delete process.env["ONEUPTIME_TEST_RUNNER_SECRET"];
    fs.rmSync(privateDirectory, { recursive: true, force: true });
    fs.rmSync(writableDirectory, { recursive: true, force: true });
  });

  test("none of the Runner's environment: no key, no id, no server, no setting", () => {
    // The Runner's own (jest.setup sets them as a Runner's container would).
    expect(process.env["ONEUPTIME_RUNNER_KEY"]).toBeTruthy();

    const names: Array<string> = report["environmentNames"] as Array<string>;

    expect(names).not.toContain("ONEUPTIME_RUNNER_KEY");
    expect(names).not.toContain("ONEUPTIME_RUNNER_ID");
    expect(names).not.toContain("ONEUPTIME_URL");
    expect(names).not.toContain("ONEUPTIME_TEST_RUNNER_SECRET");
    expect(names).not.toContain("NODE_OPTIONS");

    for (const name of names) {
      expect(["PATH", "LANG", ...PASSED_THROUGH_ENVIRONMENT]).toContain(name);
    }
  });

  test("it starts in /, in a process that is not the Runner's", () => {
    expect(report["cwd"]).toBe("/");
    expect(report["pid"]).not.toBe(process.pid);
  });

  test.each([
    ["read the Runner's private file", "readRunnerFile"],
    ["list the Runner's private directory", "listRunnerDirectory"],
    ["read the Runner's environment", "readRunnerEnvironment"],
    ["read the Runner's memory map", "readRunnerMemoryMap"],
    ["start a process", "startProcess"],
    ["run the launcher", "runLauncher"],
    ["write a file, even where the directory lets anyone", "writeFile"],
  ])("it may not %s", (_label: string, attempt: string) => {
    expect(report[attempt]).toEqual({
      ok: false,
      code: "ERR_ACCESS_DENIED",
    });
  });

  /*
   * The one way a step could reach a network: a socket of its own. Here the
   * permission model refuses it (no --allow-net); the image's no-network
   * filter refuses it in the kernel too (RunnerImageRuntime). Either way the
   * step reaches nothing by itself - not the cluster's or Compose's networks,
   * the Kubernetes API or a cloud metadata endpoint - and its HTTP goes
   * through the Runner.
   */
  test.each([
    ["a TCP socket", "openTcpSocket"],
    ["a UDP socket", "openUdpSocket"],
  ])("it may not open %s of its own", (_label: string, attempt: string) => {
    expect(report[attempt]).toMatchObject({ ok: false });
    expect(report[attempt]).not.toEqual({ ok: false, code: "TIMEOUT" });
  });
});

describe("a step's process that does not keep to the protocol", () => {
  test("one that hangs is killed at its deadline, and nothing of it is left", async () => {
    const started: number = Date.now();
    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf("", { args: { mode: "hang" }, timeoutInMs: 500 }),
      optionsOf({ workerEntry: MISBEHAVING_WORKER, deadlineGraceMs: 1_500 }),
    );

    expect(outcome).toEqual({
      success: false,
      output: "",
      errorMessage: STEP_RAN_OUT_OF_TIME_MESSAGE,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_000);
    expect(processesRunning("MisbehavingWorker.js")).toEqual([]);
  });

  test.each([
    ["exits without answering", "silent", "(exit code 0)"],
    ["crashes", "crash", "(exit code 3)"],
    ["answers another request", "wrong-nonce", "(exit code 0)"],
    ["answers with text that is not JSON", "garbage", "(exit code 0)"],
  ])(
    "one that %s fails the step, saying it ended without a result",
    async (_label: string, mode: string, ending: string) => {
      const outcome: JavaScriptStepOutcome = await runSandboxedStep(
        stepOf("", { args: { mode } }),
        optionsOf({ workerEntry: MISBEHAVING_WORKER }),
      );

      expect(outcome).toEqual({
        success: false,
        output: "",
        errorMessage: `${STEP_ENDED_WITHOUT_RESULT_MESSAGE} ${ending}.`,
      });
    },
  );

  test("one that answers with more than a reply may hold is stopped", async () => {
    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf("", { args: { mode: "flood" } }),
      optionsOf({ workerEntry: MISBEHAVING_WORKER }),
    );

    expect(outcome).toEqual({
      success: false,
      output: "",
      errorMessage: STEP_REPLY_TOO_LARGE_MESSAGE,
    });
  });

  test.each([
    [
      "writes something other than its HTTP calls on its HTTP channel",
      "http-garbage",
    ],
    ["writes more on its HTTP channel than a step may send", "http-flood"],
  ])("one that %s is stopped", async (_label: string, mode: string) => {
    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf("", { args: { mode } }),
      optionsOf({ workerEntry: MISBEHAVING_WORKER }),
    );

    expect(outcome).toEqual({
      success: false,
      output: "",
      errorMessage: STEP_HTTP_CHANNEL_MISUSED_MESSAGE,
    });
    expect(processesRunning("MisbehavingWorker.js")).toEqual([]);
  });

  test("a no-network filter that can no longer be set fails the step, and says why", async () => {
    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "runner-no-network-"),
    );
    const filter: string = path.join(directory, "no-network");

    /*
     * Stands in for javascript-sandbox-no-network when the kernel refuses the
     * filter: it exits 72 without running the worker, as the real one does.
     */
    fs.writeFileSync(filter, `#!/bin/sh\nexit ${NO_NETWORK_EXIT_NO_FILTER}\n`, {
      mode: 0o755,
    });

    try {
      const outcome: JavaScriptStepOutcome = await runSandboxedStep(
        stepOf("return 1;"),
        optionsOf({ network: NO_NETWORK, noNetworkPath: filter }),
      );

      expect(outcome).toEqual({
        success: false,
        output: "",
        errorMessage: STEP_NO_NETWORK_FILTER_MESSAGE,
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("as a user of its own, through the launcher", () => {
  let directory: string;
  let callLog: string;

  /*
   * A launcher that keeps to the real one's contract without being setuid:
   * it records each call, runs "run <uid> <program> ..." as this user, and
   * answers "reap" and "check" with 0 - or "run" with 71, as the real one
   * does when the container no longer lets it switch users.
   */
  function writeLauncher(runExitCode: number | null): string {
    const launcher: string = path.join(directory, `launcher-${Date.now()}`);

    fs.writeFileSync(
      launcher,
      [
        "#!/bin/sh",
        `echo "$*" >> '${callLog}'`,
        'if [ "$1" = run ]; then',
        runExitCode === null ? '  shift 2; exec "$@"' : `  exit ${runExitCode}`,
        "fi",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    return launcher;
  }

  function calls(): Array<Array<string>> {
    return fs.existsSync(callLog)
      ? fs
          .readFileSync(callLog, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line: string): Array<string> => {
            return line.split(" ");
          })
      : [];
  }

  function poolOf(launcherPath: string): SandboxIdentityPool {
    return new SandboxIdentityPool({
      launcherPath,
      call: callLauncher,
      hasLiveProcess: (): boolean => {
        return false;
      },
    });
  }

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "runner-launcher-"));
    callLog = path.join(directory, "calls.log");
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("runs the step as a free user, with the step's node command, then reaps that user and gives it back", async () => {
    const launcherPath: string = writeLauncher(null);
    const identities: SandboxIdentityPool = poolOf(launcherPath);

    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf("return 6 * 7;"),
      optionsOf({
        isolation: { isolation: SandboxIsolation.OwnUser, reason: null },
        identities,
        launcherPath,
      }),
    );

    expect(outcome).toEqual({ success: true, output: "Return: 42" });

    const [run, reap] = calls();

    expect(run!.slice(0, 3)).toEqual([
      "run",
      String(SANDBOX_IDENTITY_MIN),
      process.execPath,
    ]);
    expect(run!.slice(3)).toEqual(getSandboxNodeArguments(SOURCE_WORKER));
    expect(reap).toEqual(["reap", String(SANDBOX_IDENTITY_MIN)]);
    expect(identities.activeCount).toBe(0);
  });

  test("two steps at once never run as the same user", async () => {
    const launcherPath: string = writeLauncher(null);
    const identities: SandboxIdentityPool = poolOf(launcherPath);
    const options: SandboxRunOptions = optionsOf({
      isolation: { isolation: SandboxIsolation.OwnUser, reason: null },
      identities,
      launcherPath,
      workerEntry: MISBEHAVING_WORKER,
    });

    await Promise.all([
      runSandboxedStep(stepOf(""), options),
      runSandboxedStep(stepOf(""), options),
    ]);

    const runUsers: Array<string> = calls()
      .filter((call: Array<string>): boolean => {
        return call[0] === "run";
      })
      .map((call: Array<string>): string => {
        return call[1]!;
      });

    expect(runUsers).toHaveLength(2);
    expect(new Set(runUsers).size).toBe(2);
    expect(identities.activeCount).toBe(0);
  });

  test("a launcher that may no longer switch users fails the step, and says why", async () => {
    const launcherPath: string = writeLauncher(71);

    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf("return 1;"),
      optionsOf({
        isolation: { isolation: SandboxIsolation.OwnUser, reason: null },
        identities: poolOf(launcherPath),
        launcherPath,
      }),
    );

    expect(outcome).toEqual({
      success: false,
      output: "",
      errorMessage: STEP_NO_PRIVILEGE_MESSAGE,
    });
  });

  test("with every user taken, the step is not started at all", async () => {
    const launcherPath: string = writeLauncher(null);
    const identities: SandboxIdentityPool = new SandboxIdentityPool({
      launcherPath,
      call: callLauncher,
      hasLiveProcess: (): boolean => {
        return false;
      },
      min: SANDBOX_IDENTITY_MIN,
      max: SANDBOX_IDENTITY_MIN,
    });

    identities.acquire();

    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf("return 1;"),
      optionsOf({
        isolation: { isolation: SandboxIsolation.OwnUser, reason: null },
        identities,
        launcherPath,
      }),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.errorMessage).toContain(
      "Every JavaScript sandbox user is in use",
    );
    expect(calls()).toEqual([]);
  });
});

describe("the step's command and environment", () => {
  const bundle: SandboxWorkerEntry = {
    path: SANDBOX_WORKER_BUNDLE_PATH,
    kind: "bundle",
  };

  test("Node's permission model, with leave to load isolated-vm and read the code it runs - and no network, not even that", () => {
    for (const entry of [SOURCE_WORKER, bundle]) {
      const args: Array<string> = getSandboxNodeArguments(entry);

      expect(args).toContain("--permission");
      expect(args).toContain("--allow-addons");
      expect(args).toContain("--no-node-snapshot");
      expect(args[args.length - 1]).toBe(entry.path);

      /*
       * No --allow-net: the isolate's HTTP goes through the Runner, so the
       * process needs no network, and Node refuses it one.
       */
      expect(args).not.toContain("--allow-net");

      for (const forbidden of [
        "--allow-net",
        "--allow-child-process",
        "--allow-worker",
        "--allow-wasi",
        "--allow-inspector",
        "--allow-ffi",
        "--allow-fs-vfs",
        "--allow-openssl-store",
      ]) {
        expect(args).not.toContain(forbidden);
      }

      expect(
        args.filter((arg: string): boolean => {
          return arg.startsWith("--allow-fs-write");
        }),
      ).toEqual([]);
      expect(
        args.filter((arg: string): boolean => {
          return arg.startsWith("--allow-fs-read=");
        }),
      ).toEqual(
        getReadableRoots(entry).map((root: string): string => {
          return `--allow-fs-read=${root}`;
        }),
      );
      expect(args).not.toContain("--require");
    }
  });

  test("it may read the code it runs, never / or the temporary directory where a fix's workspace lies", () => {
    const commonDirectory: string = getCommonPackageDirectory();

    expect(getReadableRoots(SOURCE_WORKER)).toEqual([
      getRunnerPackageDirectory(),
      commonDirectory,
      "/etc/alpine-release",
    ]);
    expect(getReadableRoots(bundle)).toEqual([
      path.dirname(SANDBOX_WORKER_BUNDLE_PATH),
      path.join(commonDirectory, "node_modules"),
      "/etc/alpine-release",
    ]);

    for (const root of [
      ...getReadableRoots(SOURCE_WORKER),
      ...getReadableRoots(bundle),
    ]) {
      expect(root).not.toBe("/");
      expect(path.relative(os.tmpdir(), root).startsWith("..")).toBe(true);
    }
  });

  test("it trusts the system's certificates only when the Runner does", () => {
    expect(usesOpenSslCertificateStore([], "--use-openssl-ca")).toBe(true);
    expect(usesOpenSslCertificateStore(["--use-openssl-ca"], undefined)).toBe(
      true,
    );
    expect(usesOpenSslCertificateStore([], "--max-old-space-size=8096")).toBe(
      false,
    );
  });

  test("its environment is a PATH, a language and the host's own settings - never the Runner's", () => {
    const base: NodeJS.ProcessEnv = {
      ONEUPTIME_RUNNER_KEY: "key",
      ONEUPTIME_RUNNER_ID: "id",
      ONEUPTIME_URL: "https://oneuptime.example",
      NODE_OPTIONS: "--require /tmp/evil.js",
      HTTPS_PROXY: "http://proxy.internal:3128",
      AWS_SECRET_ACCESS_KEY: "aws",
      HOME: "/home/node",
      TZ: "Europe/Berlin",
      NODE_ENV: "production",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/extra.pem",
    };

    expect(getSandboxEnvironment(SOURCE_WORKER, base)).toEqual({
      PATH: DEFAULT_SANDBOX_PATH,
      LANG: "C.UTF-8",
      TZ: "Europe/Berlin",
      NODE_ENV: "production",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/extra.pem",
    });

    expect(getSandboxEnvironment(bundle, base)).toEqual({
      PATH: DEFAULT_SANDBOX_PATH,
      LANG: "C.UTF-8",
      TZ: "Europe/Berlin",
      NODE_ENV: "production",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/extra.pem",
      NODE_PATH: path.join(getCommonPackageDirectory(), "node_modules"),
    });
  });

  test("the image's bundle where it is, the worker's TypeScript otherwise", () => {
    expect(
      getDefaultWorkerEntry((file: string): boolean => {
        return file === SANDBOX_WORKER_BUNDLE_PATH;
      }),
    ).toEqual(bundle);
    expect(
      getDefaultWorkerEntry((): boolean => {
        return false;
      }),
    ).toEqual(SOURCE_WORKER);
  });

  test("the program is the worker behind the no-network filter, or - where the step shares the network - the worker alone", () => {
    const nodeArguments: Array<string> = getSandboxNodeArguments(SOURCE_WORKER);

    expect(
      getSandboxProgram({
        network: NO_NETWORK,
        noNetworkPath:
          "/usr/lib/oneuptime-runner/javascript-sandbox-no-network",
        nodeArguments,
      }),
    ).toEqual([
      "/usr/lib/oneuptime-runner/javascript-sandbox-no-network",
      process.execPath,
      ...nodeArguments,
    ]);

    expect(
      getSandboxProgram({
        network: SHARED_NETWORK,
        noNetworkPath:
          "/usr/lib/oneuptime-runner/javascript-sandbox-no-network",
        nodeArguments,
      }),
    ).toEqual([process.execPath, ...nodeArguments]);
  });
});

describe("what the Runner says of its sandbox, in its log and on its heartbeat", () => {
  function decisionOf(
    isolation: SandboxIsolationDecision,
    network: SandboxNetworkDecision,
  ): SandboxDecision {
    return { isolation, network };
  }

  const OWN_USER: SandboxIsolationDecision = {
    isolation: SandboxIsolation.OwnUser,
    reason: null,
    reasonCode: null,
  };

  beforeEach(() => {
    loggerInfo.mockClear();
    loggerWarn.mockClear();
  });

  test("a step gets a user of its own and no network: the report says both, and the log says so once", () => {
    const decision: SandboxDecision = decisionOf(OWN_USER, NO_NETWORK);

    expect(toSandboxReport(decision)).toEqual({
      user: GlobalRunnerStepUser.OwnUser,
      network: GlobalRunnerStepNetwork.None,
    });

    logSandboxDecision(decision);

    expect(loggerWarn).not.toHaveBeenCalled();
    expect(loggerInfo).toHaveBeenCalledTimes(1);
    expect(loggerInfo.mock.calls[0]![0]).toContain("as a user of its own");
    expect(loggerInfo.mock.calls[0]![0]).toContain("no network");
  });

  test("a step gets the Runner's user: the report says why, and the log warns", () => {
    const decision: SandboxDecision = decisionOf(OWN_PROCESS, NO_NETWORK);

    expect(toSandboxReport(decision)).toEqual({
      user: GlobalRunnerStepUser.RunnerUser,
      userReason: GlobalRunnerStepUserReason.CheckFailed,
      network: GlobalRunnerStepNetwork.None,
    });

    logSandboxDecision(decision);

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn.mock.calls[0]![0]).toContain("as this Runner's own user");
  });

  test("a step shares the Runner's network: the report says why, and the log warns", () => {
    const decision: SandboxDecision = decisionOf(OWN_USER, SHARED_NETWORK);

    expect(toSandboxReport(decision)).toEqual({
      user: GlobalRunnerStepUser.OwnUser,
      network: GlobalRunnerStepNetwork.Shared,
      networkReason: GlobalRunnerStepNetworkReason.CheckFailed,
    });

    logSandboxDecision(decision);

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn.mock.calls[0]![0]).toContain(
      "share this Runner's network",
    );
  });
});

describe("the bundle the image runs", () => {
  let bundleDirectory: string;
  let bundleEntry: SandboxWorkerEntry;
  let bundledInputs: Array<string>;

  beforeAll(() => {
    bundleDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "runner-bundle-"));
    const outfile: string = path.join(
      bundleDirectory,
      path.basename(SANDBOX_WORKER_BUNDLE_PATH),
    );
    const metafile: string = path.join(bundleDirectory, "meta.json");
    const esbuild: string = path.join(
      getCommonPackageDirectory(),
      "node_modules",
      ".bin",
      "esbuild",
    );

    /*
     * The Dockerfile's own esbuild flags, with the image's paths swapped for
     * these: the bundle under test is the one the image builds.
     */
    const command: string | undefined = fs
      .readFileSync(
        path.join(getRunnerPackageDirectory(), "Dockerfile.tpl"),
        "utf8",
      )
      .replace(/\\\n/g, " ")
      .split("\n")
      .find((line: string): boolean => {
        return (
          line.includes("node_modules/.bin/esbuild ") &&
          line.includes("--outfile=")
        );
      });

    expect(command).toBeDefined();

    const flags: Array<string> = command!
      .slice(command!.indexOf("node_modules/.bin/esbuild "))
      .split(/\s+/)
      .filter((token: string): boolean => {
        return (
          token.startsWith("--") &&
          !token.startsWith("--tsconfig=") &&
          !token.startsWith("--outfile=")
        );
      });

    expect(flags).toEqual(
      expect.arrayContaining(["--bundle", "--external:isolated-vm"]),
    );

    execFileSync(
      esbuild,
      [
        path.join(
          getRunnerPackageDirectory(),
          "Utils/JavaScriptSandbox/SandboxWorker.ts",
        ),
        ...flags,
        `--tsconfig=${path.join(getRunnerPackageDirectory(), "tsconfig.json")}`,
        `--metafile=${metafile}`,
        `--outfile=${outfile}`,
      ],
      { stdio: "pipe" },
    );

    bundleEntry = { path: outfile, kind: "bundle" };
    bundledInputs = Object.keys(
      (
        JSON.parse(fs.readFileSync(metafile, "utf8")) as {
          inputs: Record<string, unknown>;
        }
      ).inputs,
    );
  });

  afterAll(() => {
    fs.rmSync(bundleDirectory, { recursive: true, force: true });
  });

  test("runs a step, finding isolated-vm through NODE_PATH, under the same permissions", async () => {
    const outcome: JavaScriptStepOutcome = await runSandboxedStep(
      stepOf("console.log(args.word); return args.word.length;", {
        args: { word: "bundle" },
      }),
      optionsOf({ workerEntry: bundleEntry }),
    );

    expect(outcome).toEqual({ success: true, output: "bundle\nReturn: 6" });
  });

  test("holds none of the Runner's settings: nothing it bundles reads the Runner's Config", () => {
    const runnerFiles: Array<string> = bundledInputs.filter(
      (input: string): boolean => {
        return !input.includes("node_modules") && !input.startsWith("../");
      },
    );

    expect(runnerFiles.length).toBeGreaterThan(0);
    expect(runnerFiles).not.toContain("Config.ts");
    expect(
      runnerFiles.every((input: string): boolean => {
        return (
          input.startsWith("Utils/JavaScriptSandbox/") ||
          input === "Utils/OutputTruncation.ts"
        );
      }),
    ).toBe(true);
  });
});
