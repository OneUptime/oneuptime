import { recordingLogger } from "./Helpers/TestSupport";
import assert from "assert";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import { after, afterEach, before, describe, test } from "node:test";
import { ExecResult, SpawnFunction } from "../Executors/ResourceExecutor";
import SpawnSandbox, {
  DEFAULT_SPAWN_PATH,
  JOB_DIR_PARENT_NAME,
  JOB_HOME_DIR_NAME,
  MAX_OUTPUT_BYTES,
  NUL_REPLACEMENT,
  STDERR_MAX_BYTES,
  SandboxCapture,
  SandboxJobDirectory,
  SandboxRunRequest,
  describeKill,
  describeMissingBinary,
  formatResourceOutput,
  lastStderrLine,
  redactOutput,
  replaceNulCharacters,
} from "../Executors/SpawnSandbox";
import FakeBinary, {
  FakeBinaryInvocation,
  makeTempDir,
} from "./Helpers/FakeBinary";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import { MAX_RESOURCE_AGENT_OUTPUT_BYTES } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The sandbox against a FAKE program (Helpers/FakeBinary): a script first
 * on the PATH the sandbox spawns with, recording its argv, environment and
 * working directory. Every fact about the spawn is checked from the
 * program's side.
 */

let docker: FakeBinary;
let tmpDir: string;

before((): void => {
  docker = new FakeBinary("docker");
  tmpDir = makeTempDir("agent-sandbox-");
});

after((): void => {
  docker.cleanup();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

afterEach((): void => {
  docker.clearInvocations();
  docker.setBehaviour({});
});

function sandbox(
  options: { tmpDir?: string; maxOutputBytes?: number } = {},
): SpawnSandbox {
  return new SpawnSandbox({
    tmpDir: options.tmpDir || tmpDir,
    logger: recordingLogger(),
    maxOutputBytes: options.maxOutputBytes,
  });
}

function runRequest(
  overrides: Partial<SandboxRunRequest> = {},
): SandboxRunRequest {
  return {
    binary: "docker",
    args: ["ps", "--format", "{{.Names}}"],
    resourceType: AiResourceType.DockerHost,
    program: "docker",
    timeoutInMs: 30_000,
    buildEnv: (jobDir: SandboxJobDirectory): Record<string, string> => {
      return {
        PATH: docker.getPath(),
        HOME: jobDir.homeDir,
        DOCKER_CONFIG: path.join(jobDir.path, "docker-config"),
      };
    },
    prepareJobDir: (jobDir: SandboxJobDirectory): void => {
      jobDir.makePrivateDir("docker-config");
    },
    ...overrides,
  };
}

function onlyInvocation(): FakeBinaryInvocation {
  const invocations: Array<FakeBinaryInvocation> = docker.getInvocations();
  assert.strictEqual(invocations.length, 1, "the program ran exactly once");
  return invocations[0]!;
}

describe("how the program is started", () => {
  test("the argv is passed exactly as given — never through a shell", async () => {
    const args: Array<string> = [
      "ps",
      "--filter",
      "name=web; rm -rf /",
      "$(whoami)",
      "`id`",
      "a b",
      "*",
    ];

    await sandbox().run(runRequest({ args }));

    assert.deepStrictEqual(onlyInvocation().argv, args);
  });

  test("the environment is closed: exactly what buildEnv returned", async () => {
    const previous: string | undefined = process.env["ONEUPTIME_API_KEY"];
    process.env["ONEUPTIME_API_KEY"] = "must-never-reach-the-program";

    try {
      await sandbox().run(runRequest());
    } finally {
      if (previous === undefined) {
        delete process.env["ONEUPTIME_API_KEY"];
      } else {
        process.env["ONEUPTIME_API_KEY"] = previous;
      }
    }

    const invocation: FakeBinaryInvocation = onlyInvocation();
    assert.deepStrictEqual(Object.keys(invocation.env).sort(), [
      "DOCKER_CONFIG",
      "HOME",
      "PATH",
    ]);
  });

  test("closeEnvironment drops anything that is not a plain string variable", () => {
    assert.deepStrictEqual(
      SpawnSandbox.closeEnvironment({
        PATH: "/bin",
        EMPTY: "",
        "BAD=NAME": "x",
        NUMBER: 5 as unknown as string,
        MISSING: undefined as unknown as string,
      }),
      { PATH: "/bin", EMPTY: "" },
    );
  });

  test("HOME is the job's private, empty directory and the working directory; the job directory is 0700", async () => {
    const run: SpawnSandbox = sandbox();
    await run.run(runRequest());

    const invocation: FakeBinaryInvocation = onlyInvocation();
    // process.cwd() is the real path (macOS: /var -> /private/var).
    assert.strictEqual(
      path.join(
        fs.realpathSync(path.dirname(path.dirname(invocation.env["HOME"]!))),
        path.basename(path.dirname(invocation.env["HOME"]!)),
        path.basename(invocation.env["HOME"]!),
      ),
      invocation.cwd,
    );
    assert.strictEqual(path.basename(invocation.cwd), JOB_HOME_DIR_NAME);
    assert.strictEqual(invocation.homeExists, true);
    assert.strictEqual(invocation.cwdMode, 0o700);
    assert.strictEqual(invocation.parentMode, 0o700);
    // prepareJobDir shaped the directory before the program started.
    assert.deepStrictEqual(invocation.parentEntries, [
      "docker-config",
      JOB_HOME_DIR_NAME,
    ]);
    assert.strictEqual(
      path.dirname(path.dirname(invocation.cwd)),
      fs.realpathSync(run.getJobDirParent()),
    );
  });

  test("the job directory is gone afterwards", async () => {
    const run: SpawnSandbox = sandbox();
    await run.run(runRequest());

    const jobDir: string = path.dirname(onlyInvocation().cwd);
    assert.strictEqual(fs.existsSync(jobDir), false);
    assert.deepStrictEqual(run.getActiveJobDirs(), []);
  });

  test("a working directory of the caller's choosing", async () => {
    await sandbox().run(
      runRequest({
        cwd: (jobDir: SandboxJobDirectory): string => {
          return jobDir.path;
        },
      }),
    );

    assert.strictEqual(
      path.basename(onlyInvocation().cwd).startsWith("job-"),
      true,
    );
  });

  test("an absolute binary path works without PATH", async () => {
    await sandbox().run(
      runRequest({
        binary: docker.binary,
        buildEnv: (): Record<string, string> => {
          return {};
        },
      }),
    );

    assert.deepStrictEqual(Object.keys(onlyInvocation().env), []);
  });
});

describe("results", () => {
  test("success: exit 0 and the output under [stdout]", async () => {
    docker.setBehaviour({ stdout: "web-1\napi-1\n" });

    const result: ExecResult = await sandbox().run(runRequest());

    assert.deepStrictEqual(result, {
      success: true,
      output: "[stdout]\nweb-1\napi-1\n",
      exitCode: 0,
    });
  });

  test("failure: the exit code, and the last stderr line as the reason", async () => {
    docker.setBehaviour({
      stderr:
        "some context\nError response from daemon: No such container: web-9\n",
      exitCode: 1,
    });

    const result: ExecResult = await sandbox().run(runRequest());

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(
      result.errorMessage,
      "Exit code 1: Error response from daemon: No such container: web-9",
    );
    assert.match(result.output, /^\[stderr\]\nsome context\n/);
  });

  test("a failure with nothing on stderr is just the exit code", async () => {
    docker.setBehaviour({ exitCode: 3 });

    const result: ExecResult = await sandbox().run(runRequest());

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      exitCode: 3,
      errorMessage: "Exit code 3",
    });
  });

  test("a missing binary says to use the agent image", async () => {
    const result: ExecResult = await sandbox().run(
      runRequest({
        binary: path.join(tmpDir, "no-such-docker"),
        missingBinaryHint: "The docker CLI ships in the image.",
      }),
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.match(
      result.errorMessage!,
      /^docker is not installed in this container \(.*no-such-docker was not found\). Use the oneuptime\/resource-ai-agent image, which includes it. The docker CLI ships in the image.$/,
    );
  });

  test("a command that outlives its budget is killed, and silence is explained", async () => {
    docker.setBehaviour({ sleepMs: 10_000 });

    const started: number = Date.now();
    const result: ExecResult = await sandbox().run(
      runRequest({
        timeoutInMs: 400,
        silenceHint: "the Docker socket is probably not reachable",
      }),
    );

    assert.ok(Date.now() - started < 5_000, "killed long before it finished");
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(
      result.errorMessage,
      "Killed (timeout 400ms): docker produced no output at all, so the Docker socket is probably not reachable.",
    );
  });

  test("a killed command that printed something is just 'Killed'", async () => {
    docker.setBehaviour({ stdout: "partial\n", sleepMs: 20_000 });

    // Long enough for the fake to start and print, even on a busy machine.
    const result: ExecResult = await sandbox().run(
      runRequest({ timeoutInMs: 3_000 }),
    );

    assert.strictEqual(result.errorMessage, "Killed (timeout 3000ms)");
    assert.match(result.output, /partial/);
  });

  test("a child that keeps the pipes open cannot hold the job past its budget", async () => {
    docker.setBehaviour({
      stdout: "forked\n",
      orphanSleepMs: 30_000,
      sleepMs: 30_000,
    });

    const started: number = Date.now();
    const result: ExecResult = await sandbox().run(
      runRequest({ timeoutInMs: 1_500 }),
    );

    assert.ok(Date.now() - started < 6_000, `${Date.now() - started}ms`);
    assert.strictEqual(result.success, false);
    assert.match(result.errorMessage!, /^Killed \(timeout 1500ms\)/);
  });

  test("a program killed by another signal says so", async () => {
    docker.setBehaviour({ stdout: "x\n", killSelfWith: "SIGTERM" });

    const result: ExecResult = await sandbox().run(runRequest());

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, undefined);
    assert.strictEqual(result.errorMessage, "docker was terminated by SIGTERM");
  });

  test("stdout is capped at the output budget and says so", async () => {
    docker.setBehaviour({ stdoutBytes: 120_000 });

    const result: ExecResult = await sandbox().run(runRequest());

    assert.strictEqual(result.success, true);
    assert.match(
      result.output,
      /\.\.\. \[output truncated: stdout cut at \d+ bytes\]$/,
    );
    assert.ok(Buffer.byteLength(result.output) < MAX_OUTPUT_BYTES + 200);
    assert.strictEqual(MAX_OUTPUT_BYTES, MAX_RESOURCE_AGENT_OUTPUT_BYTES);
  });

  test("stderr keeps its tail, and is never pushed out by a large stdout", async () => {
    docker.setBehaviour({
      stdoutBytes: 120_000,
      stderr: `${"e".repeat(30_000)}\nError: the real reason\n`,
      exitCode: 1,
    });

    const result: ExecResult = await sandbox().run(runRequest());

    assert.match(
      result.output,
      /\[stderr\]\n\.\.\. \[earlier stderr truncated\]/,
    );
    assert.match(result.output, /Error: the real reason\n$/);
    assert.match(result.output, /stderr follows/);
    assert.strictEqual(
      result.errorMessage,
      "Exit code 1: Error: the real reason",
    );
    const stderrSection: string = result.output.split("[stderr]\n")[1]!;
    assert.ok(Buffer.byteLength(stderrSection) <= STDERR_MAX_BYTES + 40);
  });

  test("NUL characters are replaced, in stdout and stderr", async () => {
    docker.setBehaviour({
      stdout: "a\u0000b",
      stderr: "c\u0000d",
      exitCode: 1,
    });

    const result: ExecResult = await sandbox().run(runRequest());

    assert.ok(!result.output.includes("\u0000"));
    assert.ok(result.output.includes(`a${NUL_REPLACEMENT}b`));
    assert.ok(result.output.includes(`c${NUL_REPLACEMENT}d`));
  });

  test("secrets are redacted before the output is formatted, in stdout, stderr and the reason", async () => {
    docker.setBehaviour({
      stdout:
        '[{"Config":{"Env":["POSTGRES_PASSWORD=s3cr3t-value-1","TZ=UTC"]}}]\n',
      stderr: "Error: login failed for password=hunter2hunter2\n",
      exitCode: 1,
    });

    const result: ExecResult = await sandbox().run(runRequest());

    assert.ok(!result.output.includes("s3cr3t-value-1"), result.output);
    assert.ok(!result.output.includes("hunter2hunter2"), result.output);
    assert.ok(!result.errorMessage!.includes("hunter2hunter2"));
    assert.match(result.output, /POSTGRES_PASSWORD=\[redacted\]/);
  });

  test("the maxOutputBytes setting bounds the output", async () => {
    docker.setBehaviour({ stdoutBytes: 5_000 });

    const result: ExecResult = await sandbox({ maxOutputBytes: 1_000 }).run(
      runRequest(),
    );

    assert.ok(Buffer.byteLength(result.output) < 1_200);

    docker.setBehaviour({ stdoutBytes: 5_000 });
    const perCommand: ExecResult = await sandbox().run(
      runRequest({ maxOutputBytes: 500 }),
    );
    assert.ok(Buffer.byteLength(perCommand.output) < 700);
  });

  test("capture() returns the raw streams, unredacted and unformatted, for probes", async () => {
    docker.setBehaviour({
      stdout: '{"Server":{"Version":"29.4.3"}}',
      stderr: "warn: password=abc12345\n",
    });

    const captured: SandboxCapture = await sandbox().capture(runRequest());

    assert.strictEqual(captured.stdout, '{"Server":{"Version":"29.4.3"}}');
    assert.strictEqual(captured.stderr, "warn: password=abc12345\n");
    assert.strictEqual(captured.exitCode, 0);
    assert.strictEqual(captured.signal, null);
    assert.strictEqual(captured.timedOut, false);
    assert.strictEqual(captured.spawnError, null);
    assert.strictEqual(captured.setupError, null);
  });
});

describe("a job directory that cannot be prepared: nothing starts", () => {
  test("prepareJobDir throwing", async () => {
    const run: SpawnSandbox = sandbox();
    const result: ExecResult = await run.run(
      runRequest({
        prepareJobDir: (): void => {
          throw new Error("disk full");
        },
      }),
    );

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage:
        "Could not prepare a private directory for docker: disk full",
    });
    assert.strictEqual(docker.getInvocations().length, 0);
    assert.deepStrictEqual(run.getActiveJobDirs(), []);
  });

  test("buildEnv throwing", async () => {
    const result: ExecResult = await sandbox().run(
      runRequest({
        buildEnv: (): Record<string, string> => {
          throw new Error("DOCKER_HOST is not a URL");
        },
      }),
    );

    assert.match(result.errorMessage!, /DOCKER_HOST is not a URL/);
    assert.strictEqual(docker.getInvocations().length, 0);
  });

  test("a file where the parent directory should be", async () => {
    const blocked: string = makeTempDir("agent-blocked-");
    fs.writeFileSync(path.join(blocked, JOB_DIR_PARENT_NAME), "not a dir");

    try {
      const result: ExecResult = await sandbox({ tmpDir: blocked }).run(
        runRequest(),
      );

      assert.strictEqual(result.success, false);
      assert.match(
        result.errorMessage!,
        /Could not prepare a private directory/,
      );
      assert.strictEqual(docker.getInvocations().length, 0);
    } finally {
      fs.rmSync(blocked, { recursive: true, force: true });
    }
  });

  test("entry names inside the job directory must be plain names", () => {
    const run: SpawnSandbox = sandbox();
    const jobDir: SandboxJobDirectory = run.createJobDir();

    try {
      for (const name of ["", ".", "..", "a/b", "../escape", "a\\b"]) {
        assert.throws((): void => {
          jobDir.makePrivateDir(name);
        }, /is not a plain file or directory name/);
        assert.throws((): void => {
          jobDir.writePrivateFile(name, "x");
        }, /is not a plain file or directory name/);
      }

      const file: string = jobDir.writePrivateFile("config.json", "{}");
      assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
      // Never overwrites: the sandbox wrote nothing there before the caller.
      assert.throws((): void => {
        jobDir.writePrivateFile("config.json", "{}");
      });
      const dir: string = jobDir.makePrivateDir("session");
      assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700);
    } finally {
      run.releaseJobDir(jobDir);
    }

    assert.strictEqual(fs.existsSync(jobDir.path), false);
  });
});

describe("job directories", () => {
  test("the start-up sweep removes what a previous life left behind", () => {
    const run: SpawnSandbox = sandbox();
    const parent: string = run.getJobDirParent();

    fs.mkdirSync(path.join(parent, "job-abandoned", "home"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(parent, "job-abandoned", "config"), "stale");

    assert.strictEqual(run.sweepOrphanedJobDirs(), 1);
    assert.deepStrictEqual(fs.readdirSync(parent), []);
    assert.strictEqual(run.removeAllJobDirs(), 0);
  });

  test("sweeping a parent that does not exist yet is a no-op", () => {
    assert.strictEqual(
      sandbox({
        tmpDir: path.join(tmpDir, "never-created"),
      }).sweepOrphanedJobDirs(),
      0,
    );
  });

  test("the sweep leaves the directories of running commands alone; shutdown removes them", async () => {
    docker.setBehaviour({ sleepMs: 1_000 });
    const run: SpawnSandbox = sandbox();
    const running: Promise<ExecResult> = run.run(runRequest());

    const deadline: number = Date.now() + 5_000;
    while (run.getActiveJobDirs().length === 0 && Date.now() < deadline) {
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 10);
      });
    }

    const [dir] = run.getActiveJobDirs();
    assert.ok(dir);
    assert.strictEqual(run.sweepOrphanedJobDirs(), 0);
    assert.strictEqual(fs.existsSync(dir), true);
    assert.strictEqual(run.removeAllJobDirs(), 1);
    assert.strictEqual(fs.existsSync(dir), false);

    await running;
  });

  test("a parent directory with loose permissions is made private", async () => {
    const run: SpawnSandbox = sandbox();
    const parent: string = run.getJobDirParent();

    fs.mkdirSync(parent, { recursive: true });
    fs.chmodSync(parent, 0o777);

    await run.run(runRequest());

    assert.strictEqual(fs.statSync(parent).mode & 0o777, 0o700);
  });

  test("the parent lives under the tmp dir, named for the resource AI agent", () => {
    assert.strictEqual(
      sandbox().getJobDirParent(),
      path.join(tmpDir, "oneuptime-resource-ai-agent"),
    );
  });
});

/*
 * A fake child process, for spawn failures real programs cannot produce on
 * demand: a synchronous throw, an asynchronous error.
 */
class FakeChild extends EventEmitter {
  public stdout: PassThrough = new PassThrough();
  public stderr: PassThrough = new PassThrough();
  public pid: number | undefined = undefined;
  public killed: Array<string> = [];

  public kill(signal: string): boolean {
    this.killed.push(signal);
    setImmediate((): void => {
      this.emit("close", null, signal);
    });
    return true;
  }
}

describe("with an injected spawn", () => {
  test("the options: no shell, no stdin, the closed env and the job's home", async () => {
    let seen: Record<string, unknown> | null = null;
    const spawnImpl: SpawnFunction = ((
      _binary: string,
      _args: Array<string>,
      options: Record<string, unknown>,
    ): FakeChild => {
      seen = options;
      const child: FakeChild = new FakeChild();
      setImmediate((): void => {
        child.stdout.end("ok");
        child.emit("close", 0, null);
      });
      return child;
    }) as unknown as SpawnFunction;

    const result: ExecResult = await new SpawnSandbox({
      tmpDir,
      spawnImpl,
    }).run(runRequest());

    assert.strictEqual(result.success, true);
    assert.ok(seen);
    const options: Record<string, unknown> = seen as Record<string, unknown>;
    assert.strictEqual(options["shell"], false);
    assert.deepStrictEqual(options["stdio"], ["ignore", "pipe", "pipe"]);
    // Fakes are never detached: there is no real process group to kill.
    assert.strictEqual(options["detached"], false);
    assert.deepStrictEqual(
      Object.keys(options["env"] as Record<string, string>).sort(),
      ["DOCKER_CONFIG", "HOME", "PATH"],
    );
  });

  test("a spawn that throws is reported, with its code", async () => {
    const spawnImpl: SpawnFunction = ((): never => {
      throw Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
    }) as unknown as SpawnFunction;

    const result: ExecResult = await new SpawnSandbox({
      tmpDir,
      spawnImpl,
    }).run(runRequest());

    assert.deepStrictEqual(result, {
      success: false,
      output: "",
      errorMessage: "Could not start docker: spawn EACCES",
    });
  });

  test("an error event (ENOENT) is the missing binary", async () => {
    const spawnImpl: SpawnFunction = ((): FakeChild => {
      const child: FakeChild = new FakeChild();
      setImmediate((): void => {
        child.emit(
          "error",
          Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" }),
        );
        child.emit("close", -2, null);
      });
      return child;
    }) as unknown as SpawnFunction;

    const result: ExecResult = await new SpawnSandbox({
      tmpDir,
      spawnImpl,
    }).run(runRequest());

    assert.match(
      result.errorMessage!,
      /^docker is not installed in this container/,
    );
  });

  test("the timeout kills the fake child with SIGKILL", async () => {
    const children: Array<FakeChild> = [];
    const spawnImpl: SpawnFunction = ((): FakeChild => {
      const child: FakeChild = new FakeChild();
      children.push(child);
      return child;
    }) as unknown as SpawnFunction;

    const result: ExecResult = await new SpawnSandbox({
      tmpDir,
      spawnImpl,
    }).run(runRequest({ timeoutInMs: 50 }));

    assert.deepStrictEqual(children[0]!.killed, ["SIGKILL"]);
    assert.match(
      result.errorMessage!,
      /^Killed \(timeout 50ms\): docker produced no output/,
    );
  });
});

describe("pure helpers", () => {
  test("formatResourceOutput sections and markers", () => {
    assert.strictEqual(formatResourceOutput({ stdout: "", stderr: "" }), "");
    assert.strictEqual(
      formatResourceOutput({ stdout: "out", stderr: "err" }),
      "[stdout]\nout\n[stderr]\nerr",
    );
    assert.strictEqual(
      formatResourceOutput({
        stdout: "out",
        stderr: "",
        stdoutTruncated: true,
      }),
      "[stdout]\nout\n... [output truncated: stdout cut at 3 bytes]",
    );
    assert.strictEqual(
      formatResourceOutput({
        stdout: "",
        stderr: "err",
        stderrTruncated: true,
      }),
      "[stderr]\n... [earlier stderr truncated]\nerr",
    );
  });

  test("lastStderrLine takes the last non-empty line, capped", () => {
    assert.strictEqual(lastStderrLine("a\n\nb\n  \n"), "b");
    assert.strictEqual(lastStderrLine(""), "");
    assert.strictEqual(lastStderrLine("x".repeat(600)).length, 503);
  });

  test("replaceNulCharacters", () => {
    assert.strictEqual(
      replaceNulCharacters("a\u0000b\u0000"),
      `a${NUL_REPLACEMENT}b${NUL_REPLACEMENT}`,
    );
  });

  test("describeKill", () => {
    assert.strictEqual(
      describeKill({ timeoutInMs: 5, producedOutput: true, program: "govc" }),
      "Killed (timeout 5ms)",
    );
    assert.match(
      describeKill({ timeoutInMs: 5, producedOutput: false, program: "govc" }),
      /^Killed \(timeout 5ms\): govc produced no output at all, so the resource is probably unreachable from this agent/,
    );
  });

  test("describeMissingBinary", () => {
    assert.strictEqual(
      describeMissingBinary({ program: "ceph", binary: "/usr/bin/ceph" }),
      "ceph is not installed in this container (/usr/bin/ceph was not found). Use the oneuptime/resource-ai-agent image, which includes it.",
    );
  });

  test("redactOutput applies the program's hooks and the generic rules", () => {
    assert.strictEqual(
      redactOutput({
        resourceType: AiResourceType.CephCluster,
        program: "ceph",
        text: "",
      }),
      "",
    );
    const masked: string = redactOutput({
      resourceType: AiResourceType.CephCluster,
      program: "ceph",
      text: "[client.admin]\n\tkey = AQDabcdefghijklmnopqrstuvwxyz0123456789==\n",
    });
    assert.ok(!masked.includes("AQDabcdefghij"), masked);
  });

  test("a standard PATH for tools spawned without the caller's", () => {
    assert.strictEqual(
      DEFAULT_SPAWN_PATH,
      "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );
  });
});
