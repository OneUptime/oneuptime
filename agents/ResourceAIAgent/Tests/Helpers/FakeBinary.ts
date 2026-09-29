import fs from "fs";
import os from "os";
import path from "path";

/*
 * A stand-in CLI for tests (docker, govc, ceph, nsenter — any name): a small
 * Node script in a temporary directory, put first on the PATH the sandbox
 * spawns with. It records what it was started with — argv, environment,
 * working directory, whether HOME exists and the modes of its working
 * directory and job directory — and then behaves as the test scripted:
 * print, fail, sleep past a timeout, fork a child that outlives it.
 *
 * The script starts with a shebang naming this Node binary directly, not
 * `#!/bin/sh`: a shell would add PWD/SHLVL to the environment, and the tests
 * assert the environment the program gets is exactly the closed one.
 */

export interface FakeBinaryBehaviour {
  stdout?: string | undefined;
  // Print this many "x" bytes to stdout (on top of stdout).
  stdoutBytes?: number | undefined;
  stderr?: string | undefined;
  stderrBytes?: number | undefined;
  exitCode?: number | undefined;
  // Wait this long after printing, before exiting.
  sleepMs?: number | undefined;
  /*
   * Start a child that keeps stdout open this long, then exit at once: the
   * sandbox must not wait for the child (it kills the whole group).
   */
  orphanSleepMs?: number | undefined;
  // Kill itself with this signal after printing.
  killSelfWith?: string | undefined;
}

export interface FakeBinaryInvocation {
  argv: Array<string>;
  env: Record<string, string>;
  cwd: string;
  cwdMode: number | null;
  // The mode of the cwd's parent (the job directory when cwd is its home).
  parentMode: number | null;
  homeExists: boolean;
  // Entries of the cwd's parent directory, sorted.
  parentEntries: Array<string>;
  pid: number;
}

const SCRIPT: string = `
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const dir = __dirname;
let behaviour = {};
try { behaviour = JSON.parse(fs.readFileSync(path.join(dir, "behaviour.json"), "utf8")); } catch {}
const argv = process.argv.slice(2);
if (argv[0] === "__orphan__") { setTimeout(() => {}, Number(argv[1]) || 10000); return; }
let homeExists = false;
try { homeExists = fs.statSync(process.env.HOME || "/nonexistent").isDirectory(); } catch {}
let cwdMode = null, parentMode = null, parentEntries = [];
try { cwdMode = fs.statSync(process.cwd()).mode & 0o777; } catch {}
try { parentMode = fs.statSync(path.dirname(process.cwd())).mode & 0o777; } catch {}
try { parentEntries = fs.readdirSync(path.dirname(process.cwd())).sort(); } catch {}
// macOS adds __CF_USER_TEXT_ENCODING to every process it starts; it did not come from the agent.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("__CF_")));
fs.appendFileSync(path.join(dir, "invocations.jsonl"), JSON.stringify({ argv, env, cwd: process.cwd(), cwdMode, parentMode, homeExists, parentEntries, pid: process.pid }) + "\\n");
if (behaviour.stdout) process.stdout.write(behaviour.stdout);
if (behaviour.stdoutBytes) process.stdout.write("x".repeat(behaviour.stdoutBytes));
if (behaviour.stderr) process.stderr.write(behaviour.stderr);
if (behaviour.stderrBytes) process.stderr.write("e".repeat(behaviour.stderrBytes));
if (behaviour.orphanSleepMs) {
  // The child inherits stdout and stderr, so they stay open while it lives.
  spawn(process.execPath, [__filename, "__orphan__", String(behaviour.orphanSleepMs)], { stdio: ["ignore", "inherit", "inherit"] }).unref();
}
if (behaviour.killSelfWith) { process.kill(process.pid, behaviour.killSelfWith); }
// Exit naturally (never process.exit), so every write above is flushed.
process.exitCode = behaviour.exitCode || 0;
if (behaviour.sleepMs) { setTimeout(() => {}, behaviour.sleepMs); }
`;

export default class FakeBinary {
  public readonly dir: string;
  public readonly binary: string;

  public constructor(public readonly name: string = "docker") {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), `fake-${name}-`));
    this.binary = path.join(this.dir, name);
    fs.writeFileSync(this.binary, `#!${process.execPath}\n${SCRIPT}`, {
      mode: 0o755,
    });
    this.setBehaviour({});
  }

  // A PATH that finds this program first.
  public getPath(): string {
    return `${this.dir}${path.delimiter}${process.env["PATH"] || ""}`;
  }

  public setBehaviour(behaviour: FakeBinaryBehaviour): void {
    fs.writeFileSync(
      path.join(this.dir, "behaviour.json"),
      JSON.stringify(behaviour),
    );
  }

  public getInvocations(): Array<FakeBinaryInvocation> {
    let text: string;
    try {
      text = fs.readFileSync(path.join(this.dir, "invocations.jsonl"), "utf8");
    } catch {
      return [];
    }

    return text
      .split("\n")
      .filter((line: string): boolean => {
        return line.trim().length > 0;
      })
      .map((line: string): FakeBinaryInvocation => {
        return JSON.parse(line) as FakeBinaryInvocation;
      });
  }

  public clearInvocations(): void {
    fs.rmSync(path.join(this.dir, "invocations.jsonl"), { force: true });
  }

  public cleanup(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
