import {
  AwsChainProcessResult,
  defaultAwsChainProcessRunner,
} from "Common/Server/Utils/Aws/AwsCredentialProcess";
import { defaultCanWriteFile } from "Common/Server/Utils/Aws/AwsDefaultCredentialChain";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * THE RUNNER A PROFILE'S credential_process RUNS WITH (#7381), driven with
 * real programs - Node itself, by its full path - since Common's jest runs
 * in jsdom: no shell reads the arguments, the program sees only the
 * environment it is handed, what it writes to stderr is never read (a
 * secret there reaches no result), a program that hangs is killed with
 * what it started, one that prints too much is stopped, and one that
 * cannot be started says why by its code. The chain's own tests drive
 * every outcome through this seam (AwsDefaultCredentialChainProfile).
 */

const NODE: string = process.execPath;

const run: (
  script: string,
  options?: {
    args?: Array<string>;
    env?: Record<string, string>;
    timeoutMs?: number;
    maxOutputBytes?: number;
  },
) => Promise<AwsChainProcessResult> = (
  script: string,
  options?: {
    args?: Array<string>;
    env?: Record<string, string>;
    timeoutMs?: number;
    maxOutputBytes?: number;
  },
): Promise<AwsChainProcessResult> => {
  return defaultAwsChainProcessRunner({
    program: NODE,
    args: ["-e", script, ...(options?.args || [])],
    env: options?.env || { PATH: process.env["PATH"] || "" },
    timeoutMs: options?.timeoutMs || 10 * 1000,
    maxOutputBytes: options?.maxOutputBytes || 64 * 1024,
  });
};

const isRunning: (pid: number) => boolean = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitFor: (
  condition: () => boolean,
  withinMs: number,
) => Promise<boolean> = async (
  condition: () => boolean,
  withinMs: number,
): Promise<boolean> => {
  const until: number = Date.now() + withinMs;

  while (Date.now() < until) {
    if (condition()) {
      return true;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 25);
    });
  }

  return condition();
};

describe("running a credential_process", () => {
  test("what it prints, and its exit code", async () => {
    expect(
      await run(
        'process.stdout.write(JSON.stringify({Version: 1, AccessKeyId: "ASIA", SecretAccessKey: "s"}))',
      ),
    ).toEqual({
      outcome: "exited",
      exitCode: 0,
      stdout: '{"Version":1,"AccessKeyId":"ASIA","SecretAccessKey":"s"}',
    });

    expect(
      await run("process.stdout.write('partial'); process.exit(3)"),
    ).toEqual({
      outcome: "exited",
      exitCode: 3,
      stdout: "partial",
    });
  });

  test("no shell: every argument reaches the program as written", async () => {
    const args: Array<string> = [
      "a; touch /tmp/should-not-exist-7381",
      "$HOME",
      "| cat",
      "`whoami`",
      "*",
      "",
    ];
    const result: AwsChainProcessResult = await run(
      "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
      { args: args },
    );

    expect(result.outcome).toBe("exited");
    expect(
      JSON.parse((result as { stdout: string }).stdout) as Array<string>,
    ).toEqual(args);
    expect(fs.existsSync("/tmp/should-not-exist-7381")).toBe(false);
  });

  test("it sees the environment it is handed, and nothing else", async () => {
    process.env["T074_NOT_HANDED"] = "server-secret";

    try {
      const result: AwsChainProcessResult = await run(
        "process.stdout.write(JSON.stringify({ marker: process.env.MARKER || null, leaked: process.env.T074_NOT_HANDED || null }))",
        { env: { MARKER: "handed" } },
      );

      expect(JSON.parse((result as { stdout: string }).stdout)).toEqual({
        marker: "handed",
        leaked: null,
      });
    } finally {
      delete process.env["T074_NOT_HANDED"];
    }
  });

  test("what it writes to stderr is never read: a secret there reaches no result", async () => {
    const secret: string = "stderr-secret-AKIAEXAMPLE-7381";
    const result: AwsChainProcessResult = await run(
      `process.stderr.write(${JSON.stringify(secret)}); process.stdout.write("out"); process.exit(1)`,
    );

    expect(result).toEqual({ outcome: "exited", exitCode: 1, stdout: "out" });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  test("a program that hangs is killed within its time, and what it started with it", async () => {
    const started: number = Date.now();
    const result: AwsChainProcessResult = await run(
      [
        "const { spawn } = require('child_process');",
        "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });",
        "process.stdout.write(String(child.pid) + '\\n');",
        "setTimeout(() => {}, 60000);",
      ].join(" "),
      { timeoutMs: 1500 },
    );

    expect(result).toEqual({ outcome: "timed-out" });
    expect(Date.now() - started).toBeLessThan(10 * 1000);
  });

  test("the program it started is gone after the timeout", async () => {
    const pidFile: string = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "t074-runner-")),
      "pid",
    );
    const result: AwsChainProcessResult = await run(
      [
        "const { spawn } = require('child_process');",
        "const fs = require('fs');",
        "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });",
        `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
        "setTimeout(() => {}, 60000);",
      ].join(" "),
      { timeoutMs: 1500 },
    );

    expect(result).toEqual({ outcome: "timed-out" });

    const grandchild: number = Number(fs.readFileSync(pidFile, "utf8"));

    expect(grandchild).toBeGreaterThan(0);
    expect(
      await waitFor((): boolean => {
        return !isRunning(grandchild);
      }, 5000),
    ).toBe(true);
  });

  test("a program that prints more than its cap is stopped", async () => {
    const result: AwsChainProcessResult = await run(
      "const chunk = 'y'.repeat(16 * 1024); setInterval(() => process.stdout.write(chunk), 1);",
      { maxOutputBytes: 64 * 1024 },
    );

    expect(result).toEqual({ outcome: "too-much-output" });
  });

  test("a program ended by a signal of its own says which", async () => {
    expect(await run("process.kill(process.pid, 'SIGTERM')")).toEqual({
      outcome: "killed",
      signal: "SIGTERM",
    });
  });

  test("a character split between two writes is read whole", async () => {
    expect(
      await run(
        "process.stdout.write(Buffer.from([0xc3])); setTimeout(() => process.stdout.write(Buffer.from([0xa9])), 50);",
      ),
    ).toEqual({ outcome: "exited", exitCode: 0, stdout: "é" });
  });

  test("a program that is not there, or may not be run, says why by its code", async () => {
    expect(
      await defaultAwsChainProcessRunner({
        program: "/nonexistent/t074/aws_signing_helper",
        args: [],
        env: {},
        timeoutMs: 5000,
        maxOutputBytes: 1024,
      }),
    ).toEqual({ outcome: "not-started", reason: "ENOENT" });

    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "t074-runner-"),
    );
    const notExecutable: string = path.join(directory, "helper");

    fs.writeFileSync(notExecutable, "#!/bin/sh\necho hi\n", { mode: 0o644 });

    const result: AwsChainProcessResult = await defaultAwsChainProcessRunner({
      program: notExecutable,
      args: [],
      env: {},
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });

    expect(result.outcome).toBe("not-started");
    expect(["EACCES", "EPERM"]).toContain(
      (result as { reason: string }).reason,
    );
  });
});

describe("whether the server could change a file", () => {
  let directory: string;

  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "t074-writable-"));
  });

  afterAll(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("a file it may write is one it could change", async () => {
    const file: string = path.join(directory, "config");

    fs.writeFileSync(file, "[default]\n", { mode: 0o600 });

    expect(await defaultCanWriteFile(file)).toBe(true);
  });

  test("a file gone since it was read is taken as one it could change: no program runs on a doubt", async () => {
    expect(await defaultCanWriteFile(path.join(directory, "gone"))).toBe(true);
  });

  test("a file it may not write is one it cannot change (not as root, which may write any file but a read-only mount's)", async () => {
    if (process.getuid && process.getuid() === 0) {
      return;
    }

    const file: string = path.join(directory, "read-only");

    fs.writeFileSync(file, "[default]\n", { mode: 0o400 });

    expect(await defaultCanWriteFile(file)).toBe(false);
  });
});
