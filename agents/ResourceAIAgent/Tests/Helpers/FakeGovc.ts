import fs from "fs";
import os from "os";
import path from "path";
import { ChildProcess, SpawnOptions, spawn } from "child_process";
import { GOVC_BINARY } from "../../Executors/GovcExecutor";
import { SpawnFunction } from "../../Executors/ResourceExecutor";
import { PRINTED_MARKER, waitForFile } from "./KillAfterOutput";

/*
 * A stand-in for /usr/bin/govc: a small Node script that answers each govc
 * command the way the test scripted it (`about -json` with a vCenter's
 * product facts, `vm.info` with a VM, a login failure, a hang) and records
 * how it was started — argv, the complete environment, working directory,
 * and the modes of HOME, the job directory and GOVMOMI_HOME.
 *
 * The executor always starts the absolute path /usr/bin/govc. spawnImpl()
 * returns a spawn that starts this script in its place (and records which
 * binary was asked for), so the real child_process machinery still runs —
 * pipes, exit codes, kills — with the environment exactly as the executor
 * built it.
 *
 * The script's shebang names this Node binary directly (not /bin/sh, which
 * would add PWD/SHLVL to the environment the tests assert is closed).
 */

export interface FakeGovcResponse {
  stdout?: string | undefined;
  stderr?: string | undefined;
  // Print this many "x" bytes to stdout (after stdout).
  stdoutBytes?: number | undefined;
  exitCode?: number | undefined;
  // Wait this long after printing, before exiting.
  sleepMs?: number | undefined;
  /*
   * Once everything above is in the pipes, say so (waitUntilPrinted), so a
   * test can let the time budget run out only after the output
   * (killAfterOutput).
   */
  announcePrinted?: boolean | undefined;
}

/*
 * Responses by the command they answer: the whole argv joined by spaces
 * ("about -json") first, then the govc command alone ("vm.info"), then "*".
 */
export type FakeGovcScript = Record<string, FakeGovcResponse>;

export interface FakeGovcInvocation {
  argv: Array<string>;
  env: Record<string, string>;
  cwd: string;
  cwdMode: number | null;
  // The job directory: the parent of the working directory (HOME).
  parentMode: number | null;
  parentEntries: Array<string>;
  homeExists: boolean;
  govmomiHomeMode: number | null;
  govmomiHomeEntries: Array<string> | null;
}

const SCRIPT: string = `
const fs = require("fs");
const path = require("path");
const dir = __dirname;
let script = {};
try { script = JSON.parse(fs.readFileSync(path.join(dir, "script.json"), "utf8")); } catch {}
const argv = process.argv.slice(2);
const response = script[argv.join(" ")] || script[argv[0] || ""] || script["*"] || {};
function mode(p) { try { return fs.statSync(p).mode & 0o777; } catch { return null; } }
function entries(p) { try { return fs.readdirSync(p).sort(); } catch { return null; } }
let homeExists = false;
try { homeExists = fs.statSync(process.env.HOME || "/nonexistent").isDirectory(); } catch {}
// macOS adds __CF_USER_TEXT_ENCODING to every process it starts; it did not come from the agent.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("__CF_")));
fs.appendFileSync(path.join(dir, "invocations.jsonl"), JSON.stringify({
  argv, env, cwd: process.cwd(),
  cwdMode: mode(process.cwd()),
  parentMode: mode(path.dirname(process.cwd())),
  parentEntries: entries(path.dirname(process.cwd())) || [],
  homeExists,
  govmomiHomeMode: process.env.GOVMOMI_HOME ? mode(process.env.GOVMOMI_HOME) : null,
  govmomiHomeEntries: process.env.GOVMOMI_HOME ? entries(process.env.GOVMOMI_HOME) : null,
}) + "\\n");
// Each write's callback runs once the OS has it; after the last, announce it (announcePrinted).
let unflushed = 1;
function flushed() { if (--unflushed === 0 && response.announcePrinted) fs.writeFileSync(path.join(dir, ${JSON.stringify(PRINTED_MARKER)}), ""); }
function print(stream, text) { unflushed++; stream.write(text, flushed); }
if (response.stdout) print(process.stdout, response.stdout);
if (response.stdoutBytes) print(process.stdout, "x".repeat(response.stdoutBytes));
if (response.stderr) print(process.stderr, response.stderr);
flushed();
// Exit naturally (never process.exit), so every write above is flushed.
process.exitCode = response.exitCode || 0;
if (response.sleepMs) { setTimeout(() => {}, response.sleepMs); }
`;

export default class FakeGovc {
  public readonly dir: string;
  public readonly binary: string;
  // Every binary the executor asked spawn to start, in order.
  public readonly requestedBinaries: Array<string> = [];
  // The options of every spawn, in order.
  public readonly spawnOptions: Array<SpawnOptions> = [];

  public constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-govc-"));
    this.binary = path.join(this.dir, "govc");
    fs.writeFileSync(this.binary, `#!${process.execPath}\n${SCRIPT}`, {
      mode: 0o755,
    });
    this.setScript({});
  }

  public setScript(script: FakeGovcScript): void {
    // A new script, a new run: an earlier run's announcement does not count.
    fs.rmSync(path.join(this.dir, PRINTED_MARKER), { force: true });
    fs.writeFileSync(
      path.join(this.dir, "script.json"),
      JSON.stringify(script),
    );
  }

  /*
   * A spawn that starts this fake wherever the executor asks for
   * /usr/bin/govc (or `binary` instead, e.g. a path that does not exist).
   */
  public spawnImpl(binary?: string): SpawnFunction {
    return ((
      requested: string,
      args: ReadonlyArray<string>,
      options: SpawnOptions,
    ): ChildProcess => {
      this.requestedBinaries.push(requested);
      this.spawnOptions.push(options);

      return spawn(
        requested === GOVC_BINARY ? binary || this.binary : requested,
        args,
        options,
      );
    }) as unknown as SpawnFunction;
  }

  // Resolves once a response scripted with announcePrinted has printed everything.
  public waitUntilPrinted(signal?: AbortSignal | undefined): Promise<void> {
    return waitForFile(path.join(this.dir, PRINTED_MARKER), signal);
  }

  public getInvocations(): Array<FakeGovcInvocation> {
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
      .map((line: string): FakeGovcInvocation => {
        return JSON.parse(line) as FakeGovcInvocation;
      });
  }

  public reset(): void {
    fs.rmSync(path.join(this.dir, "invocations.jsonl"), { force: true });
    this.requestedBinaries.length = 0;
    this.spawnOptions.length = 0;
    this.setScript({});
  }

  public cleanup(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

/*
 * What `govc about -json` prints. Current govc (govmomi 0.37+) writes the
 * vim25 types with lowerCamelCase keys; older releases wrote PascalCase.
 */
export const ABOUT_JSON_CAMEL: string = JSON.stringify({
  about: {
    name: "VMware vCenter Server",
    fullName: "VMware vCenter Server 8.0.2 build-22385739",
    vendor: "VMware, Inc.",
    version: "8.0.2",
    build: "22385739",
    localeVersion: "INTL",
    localeBuild: "000",
    osType: "linux-x64",
    productLineId: "vpx",
    apiType: "VirtualCenter",
    apiVersion: "8.0.2.0",
    instanceUuid: "f3c1b0a2-5d2e-4e8e-9a51-7c0b4d9e2a10",
    licenseProductName: "VMware VirtualCenter Server",
    licenseProductVersion: "8.0",
  },
});

export const ABOUT_JSON_PASCAL: string = JSON.stringify({
  About: {
    Name: "VMware ESXi",
    FullName: "VMware ESXi 7.0.3 build-21930508",
    Vendor: "VMware, Inc.",
    Version: "7.0.3",
    Build: "21930508",
    ApiType: "HostAgent",
    ApiVersion: "7.0.3.0",
  },
});
