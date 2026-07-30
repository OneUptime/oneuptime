import { describe, expect, test } from "@jest/globals";
import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * Regression tests for graceful shutdown signal delivery.
 *
 * Kubernetes terminates a pod by sending SIGTERM to PID 1 and then SIGKILLing
 * whatever is left at the end of terminationGracePeriodSeconds. Our services
 * register SIGTERM handlers (Common/Server/Utils/GracefulShutdown.ts) that close
 * the HTTP server, drain the Postgres pool and stop BullMQ consumers.
 *
 * Those handlers only run if the signal actually reaches the Node process. A
 * start script shaped like:
 *
 *     export NODE_OPTIONS="..." && node Index.ts
 *
 * is a COMPOUND command, so the shell cannot exec-optimise it: `sh` forks, Node
 * becomes a grandchild, and `sh` does not forward signals to it. The SIGTERM
 * stops at the shell, no handler runs, and every pod is hard-killed with its
 * Postgres connections still open -- which surfaces downstream as a burst of
 * pgbouncer "client unexpected eof" and 502s on every rolling update.
 *
 * Prefixing the final command with `exec` makes the shell REPLACE itself with
 * Node, so Node becomes the direct child and receives the signal.
 */

const REPO_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

// Every service whose container start script boots a long-lived process.
const LONG_RUNNING_SERVICES: Array<string> = [
  "App",
  "AIAgent",
  "Home",
  "Nginx",
  "Probe",
  "RunbookAgent",
  "TestServer",
];

const BOOT_TIMEOUT_MS: number = 30000;
const SIGNAL_TIMEOUT_MS: number = 10000;
const TEST_TIMEOUT_MS: number = 90000;

type ShellShape = "fork" | "exec";

// The two shapes under test, matching the real production scripts.
const SHELL_SHAPES: Record<ShellShape, string> = {
  fork: 'export NODE_OPTIONS="--max-old-space-size=512${NODE_OPTIONS:+ $NODE_OPTIONS}" && node child.js',
  exec: 'export NODE_OPTIONS="--max-old-space-size=512${NODE_OPTIONS:+ $NODE_OPTIONS}" && exec node child.js',
};

interface Workspace {
  dir: string;
  cleanup: () => void;
}

// Matches "&& node" but not "&& exec node".
const BARE_NODE_CHAIN: RegExp = /&&\s+node\s/;

/*
 * A stand-in for a OneUptime service: it announces readiness by writing its PID,
 * and on SIGTERM writes a marker -- the same thing GracefulShutdown does, minus
 * the Postgres/Redis work.
 */
const CHILD_SOURCE: string = [
  "const fs = require('fs');",
  "process.on('SIGTERM', () => {",
  "  fs.writeFileSync(process.env.GRACEFUL_FILE, process.env.NODE_OPTIONS || '');",
  "  process.exit(0);",
  "});",
  "fs.writeFileSync(process.env.READY_FILE, String(process.pid));",
  "setInterval(() => {}, 1000);",
].join("\n");

const createWorkspace: () => Workspace = (): Workspace => {
  const dir: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-signal-"),
  );

  fs.writeFileSync(path.join(dir, "child.js"), CHILD_SOURCE);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "signal-delivery-fixture",
      private: true,
      scripts: SHELL_SHAPES,
    }),
  );

  return {
    dir,
    cleanup: (): void => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
};

const sleep: (ms: number) => Promise<void> = (ms: number): Promise<void> => {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
};

const waitForFile: (
  file: string,
  timeoutMs: number,
) => Promise<boolean> = async (
  file: string,
  timeoutMs: number,
): Promise<boolean> => {
  const deadline: number = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      return true;
    }
    await sleep(50);
  }
  return false;
};

const killQuietly: (pid: number) => void = (pid: number): void => {
  try {
    /*
     * Always SIGKILL when cleaning up: a SIGTERM here would run the child's
     * handler and forge the very marker these tests assert on.
     */
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
};

interface ShutdownOutcome {
  // Did the child's SIGTERM handler run before the deadline?
  gracefulShutdownRan: boolean;
  // NODE_OPTIONS as the child observed it, captured by the handler.
  observedNodeOptions: string | null;
  // Did the child boot at all? Distinguishes a real failure from a flaky spawn.
  booted: boolean;
}

/*
 * Boot `command`, wait until the child is genuinely up (no fixed sleeps), send
 * SIGTERM to the process we spawned -- exactly what the kubelet does to PID 1 --
 * and report whether the Node process ran its handler.
 */
const runAndTerminate: (
  workspace: Workspace,
  spawnChild: (env: NodeJS.ProcessEnv) => ChildProcess,
) => Promise<ShutdownOutcome> = async (
  workspace: Workspace,
  spawnChild: (env: NodeJS.ProcessEnv) => ChildProcess,
): Promise<ShutdownOutcome> => {
  const unique: string = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const readyFile: string = path.join(workspace.dir, `ready-${unique}`);
  const gracefulFile: string = path.join(workspace.dir, `graceful-${unique}`);

  const child: ChildProcess = spawnChild({
    ...process.env,
    READY_FILE: readyFile,
    GRACEFUL_FILE: gracefulFile,
  });

  const booted: boolean = await waitForFile(readyFile, BOOT_TIMEOUT_MS);
  if (!booted) {
    if (child.pid !== undefined) {
      killQuietly(child.pid);
    }
    return {
      gracefulShutdownRan: false,
      observedNodeOptions: null,
      booted: false,
    };
  }

  const nodePid: number = parseInt(fs.readFileSync(readyFile, "utf8"), 10);

  child.kill("SIGTERM");

  const gracefulShutdownRan: boolean = await waitForFile(
    gracefulFile,
    SIGNAL_TIMEOUT_MS,
  );

  const observedNodeOptions: string | null = gracefulShutdownRan
    ? fs.readFileSync(gracefulFile, "utf8")
    : null;

  killQuietly(nodePid);
  if (child.pid !== undefined) {
    killQuietly(child.pid);
  }
  await sleep(100);

  return { gracefulShutdownRan, observedNodeOptions, booted: true };
};

describe("Graceful shutdown signal delivery", () => {
  describe("shell semantics: why `exec` is required", () => {
    test(
      "WITHOUT exec, a compound `&&` command forks and SIGTERM never reaches Node",
      async () => {
        const workspace: Workspace = createWorkspace();
        try {
          const outcome: ShutdownOutcome = await runAndTerminate(
            workspace,
            (env: NodeJS.ProcessEnv): ChildProcess => {
              return spawn("sh", ["-c", SHELL_SHAPES.fork], {
                cwd: workspace.dir,
                stdio: "ignore",
                env,
              });
            },
          );

          expect(outcome.booted).toBe(true);
          // This is the bug: the shell swallows the signal.
          expect(outcome.gracefulShutdownRan).toBe(false);
        } finally {
          workspace.cleanup();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "WITH exec, the shell is replaced by Node and SIGTERM is delivered",
      async () => {
        const workspace: Workspace = createWorkspace();
        try {
          const outcome: ShutdownOutcome = await runAndTerminate(
            workspace,
            (env: NodeJS.ProcessEnv): ChildProcess => {
              return spawn("sh", ["-c", SHELL_SHAPES.exec], {
                cwd: workspace.dir,
                stdio: "ignore",
                env,
              });
            },
          );

          expect(outcome.booted).toBe(true);
          expect(outcome.gracefulShutdownRan).toBe(true);
        } finally {
          workspace.cleanup();
        }
      },
      TEST_TIMEOUT_MS,
    );
  });

  describe("the real container chain: npm run start", () => {
    test(
      "WITHOUT exec, npm -> sh -> node loses the signal",
      async () => {
        const workspace: Workspace = createWorkspace();
        try {
          const outcome: ShutdownOutcome = await runAndTerminate(
            workspace,
            (env: NodeJS.ProcessEnv): ChildProcess => {
              return spawn("npm", ["run", "fork"], {
                cwd: workspace.dir,
                stdio: "ignore",
                env,
              });
            },
          );

          expect(outcome.booted).toBe(true);
          expect(outcome.gracefulShutdownRan).toBe(false);
        } finally {
          workspace.cleanup();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "WITH exec, npm -> node delivers the signal and graceful shutdown runs",
      async () => {
        const workspace: Workspace = createWorkspace();
        try {
          const outcome: ShutdownOutcome = await runAndTerminate(
            workspace,
            (env: NodeJS.ProcessEnv): ChildProcess => {
              return spawn("npm", ["run", "exec"], {
                cwd: workspace.dir,
                stdio: "ignore",
                env,
              });
            },
          );

          expect(outcome.booted).toBe(true);
          expect(outcome.gracefulShutdownRan).toBe(true);
        } finally {
          workspace.cleanup();
        }
      },
      TEST_TIMEOUT_MS,
    );

    test(
      "exec preserves the NODE_OPTIONS append semantics the images rely on",
      async () => {
        /*
         * Probe, AIAgent and RunbookAgent set ENV NODE_OPTIONS="--use-openssl-ca"
         * in their Dockerfiles; the start script appends the heap flag to it via
         * ${NODE_OPTIONS:+ $NODE_OPTIONS}. Moving NODE_OPTIONS into the Dockerfile
         * instead of using `exec` would silently drop --use-openssl-ca, so this
         * guards the reason `exec` was chosen over that alternative.
         */
        const workspace: Workspace = createWorkspace();
        try {
          const outcome: ShutdownOutcome = await runAndTerminate(
            workspace,
            (env: NodeJS.ProcessEnv): ChildProcess => {
              return spawn("sh", ["-c", SHELL_SHAPES.exec], {
                cwd: workspace.dir,
                stdio: "ignore",
                env: { ...env, NODE_OPTIONS: "--use-openssl-ca" },
              });
            },
          );

          expect(outcome.gracefulShutdownRan).toBe(true);
          expect(outcome.observedNodeOptions).toContain("--use-openssl-ca");
          expect(outcome.observedNodeOptions).toContain(
            "--max-old-space-size=512",
          );
        } finally {
          workspace.cleanup();
        }
      },
      TEST_TIMEOUT_MS,
    );
  });

  describe("repository invariant: every service start script is signal-safe", () => {
    const readScript: (service: string, scriptName: string) => string | null = (
      service: string,
      scriptName: string,
    ): string | null => {
      const packageJsonPath: string = path.join(
        REPO_ROOT,
        service,
        "package.json",
      );
      const parsed: { scripts?: Record<string, string> } = JSON.parse(
        fs.readFileSync(packageJsonPath, "utf8"),
      ) as { scripts?: Record<string, string> };

      return parsed.scripts?.[scriptName] ?? null;
    };

    test.each(LONG_RUNNING_SERVICES)(
      "%s start script hands the process to node via exec",
      (service: string) => {
        const startScript: string | null = readScript(service, "start");

        expect(startScript).not.toBeNull();

        /*
         * Only chained scripts are at risk. A bare `node ...` is already exec'd
         * by the shell, so it does not need the keyword.
         */
        if (startScript !== null && startScript.includes("&&")) {
          expect(startScript).toContain("&& exec node");
        }
      },
    );

    test("App migrate script is also signal-safe", () => {
      /*
       * The migration Job is long-running too, and a half-applied migration
       * killed mid-statement is worse than a dropped HTTP request.
       */
      const migrateScript: string | null = readScript("App", "migrate");

      expect(migrateScript).not.toBeNull();
      expect(migrateScript).toContain("&& exec node");
    });

    test("no service start script chains directly into a bare node invocation", () => {
      const offenders: Array<string> = [];

      for (const service of LONG_RUNNING_SERVICES) {
        const startScript: string | null = readScript(service, "start");
        if (startScript === null) {
          continue;
        }
        if (BARE_NODE_CHAIN.test(startScript)) {
          offenders.push(`${service}: ${startScript}`);
        }
      }

      expect(offenders).toEqual([]);
    });
  });

  describe("repository invariant: the nginx wrapper forwards signals", () => {
    const runScript: string = fs.readFileSync(
      path.join(REPO_ROOT, "Nginx", "run.sh"),
      "utf8",
    );

    test("traps TERM so the wrapper does not swallow container termination", () => {
      /*
       * run.sh is PID 1 in the nginx image and backgrounds both children, so
       * without a trap neither child is ever told to shut down.
       */
      expect(runScript).toMatch(/trap\s+\w+\s+TERM/);
    });

    test("sends nginx SIGQUIT, not SIGTERM, so in-flight requests finish", () => {
      // SIGTERM is nginx's *fast* shutdown and drops in-flight requests.
      expect(runScript).toMatch(/kill\s+-QUIT\s+"?\$NGINX_PID/);
    });

    test("forwards SIGTERM to the node sidecar", () => {
      expect(runScript).toMatch(/kill\s+-TERM\s+"?\$NODE_PID/);
    });
  });
});
