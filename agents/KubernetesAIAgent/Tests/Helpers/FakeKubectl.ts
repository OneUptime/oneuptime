import fs from "fs";
import os from "os";
import path from "path";

/*
 * A stand-in kubectl for tests: a small Node script named `kubectl` in a
 * temporary directory, put first on the PATH the agent spawns with. It
 * records what it was started with — argv, environment, working directory,
 * and the kubeconfig named by --kubeconfig (contents and file modes) — and
 * then behaves as the test scripted: print, fail, sleep past a timeout.
 *
 * The script starts with a shebang naming this Node binary directly, not
 * `#!/bin/sh`: a shell would add PWD/SHLVL to the environment and the tests
 * assert the environment kubectl gets is exactly the closed one.
 */

export interface FakeKubectlBehaviour {
  stdout?: string | undefined;
  // Print this many "x" bytes to stdout (on top of stdout).
  stdoutBytes?: number | undefined;
  stderr?: string | undefined;
  stderrBytes?: number | undefined;
  exitCode?: number | undefined;
  // Wait this long after printing, before exiting.
  sleepMs?: number | undefined;
  // Answer `kubectl version --client -o json` with this (null: exit 1).
  clientVersion?: string | null | undefined;
}

export interface FakeKubectlInvocation {
  argv: Array<string>;
  env: Record<string, string>;
  cwd: string;
  kubeconfigPath: string | null;
  kubeconfig: string | null;
  kubeconfigMode: number | null;
  jobDirMode: number | null;
  homeExists: boolean;
}

const SCRIPT: string = `
const fs = require("fs");
const path = require("path");
const dir = __dirname;
let behaviour = {};
try { behaviour = JSON.parse(fs.readFileSync(path.join(dir, "behaviour.json"), "utf8")); } catch {}
const argv = process.argv.slice(2);
const index = argv.indexOf("--kubeconfig");
const kubeconfigPath = index >= 0 ? argv[index + 1] : null;
let kubeconfig = null, kubeconfigMode = null, jobDirMode = null;
if (kubeconfigPath) {
  try { kubeconfig = fs.readFileSync(kubeconfigPath, "utf8"); kubeconfigMode = fs.statSync(kubeconfigPath).mode & 0o777; } catch {}
  try { jobDirMode = fs.statSync(path.dirname(kubeconfigPath)).mode & 0o777; } catch {}
}
let homeExists = false;
try { homeExists = fs.statSync(process.env.HOME || "/nonexistent").isDirectory(); } catch {}
// macOS adds __CF_USER_TEXT_ENCODING to every process it starts; it did not come from the agent.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("__CF_")));
fs.appendFileSync(path.join(dir, "invocations.jsonl"), JSON.stringify({ argv, env, cwd: process.cwd(), kubeconfigPath, kubeconfig, kubeconfigMode, jobDirMode, homeExists }) + "\\n");
if (argv[0] === "version" && argv.includes("--client")) {
  if (behaviour.clientVersion === null) { process.exitCode = 1; return; }
  process.stdout.write(JSON.stringify({ clientVersion: { gitVersion: behaviour.clientVersion || "v1.36.4" } }));
  return;
}
if (behaviour.stdout) process.stdout.write(behaviour.stdout);
if (behaviour.stdoutBytes) process.stdout.write("x".repeat(behaviour.stdoutBytes));
if (behaviour.stderr) process.stderr.write(behaviour.stderr);
if (behaviour.stderrBytes) process.stderr.write("e".repeat(behaviour.stderrBytes));
// Exit naturally (never process.exit), so every write above is flushed.
process.exitCode = behaviour.exitCode || 0;
if (behaviour.sleepMs) { setTimeout(() => {}, behaviour.sleepMs); }
`;

export default class FakeKubectl {
  public readonly dir: string;
  public readonly binary: string;

  public constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-kubectl-"));
    this.binary = path.join(this.dir, "kubectl");
    fs.writeFileSync(this.binary, `#!${process.execPath}\n${SCRIPT}`, {
      mode: 0o755,
    });
    this.setBehaviour({});
  }

  // A PATH that finds this kubectl first.
  public getPath(): string {
    return `${this.dir}${path.delimiter}${process.env["PATH"] || ""}`;
  }

  public setBehaviour(behaviour: FakeKubectlBehaviour): void {
    fs.writeFileSync(
      path.join(this.dir, "behaviour.json"),
      JSON.stringify(behaviour),
    );
  }

  public getInvocations(): Array<FakeKubectlInvocation> {
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
      .map((line: string): FakeKubectlInvocation => {
        return JSON.parse(line) as FakeKubectlInvocation;
      });
  }

  // Invocations other than the `version --client` probe.
  public getCommandInvocations(): Array<FakeKubectlInvocation> {
    return this.getInvocations().filter(
      (invocation: FakeKubectlInvocation): boolean => {
        return !(
          invocation.argv[0] === "version" &&
          invocation.argv.includes("--client")
        );
      },
    );
  }

  public clearInvocations(): void {
    fs.rmSync(path.join(this.dir, "invocations.jsonl"), { force: true });
  }

  public cleanup(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

/*
 * A fake ServiceAccount mount (token, ca.crt, namespace) in a temporary
 * directory, standing in for /var/run/secrets/kubernetes.io/serviceaccount.
 */
export class FakeServiceAccount {
  public readonly dir: string;
  public readonly token: string;
  public readonly ca: string;
  public readonly namespace: string;

  public static readonly TOKEN_VALUE: string =
    "eyJhbGciOiJSUzI1NiJ9.fake-service-account-token";

  public constructor(options: { namespace?: string | null } = {}) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-sa-"));
    this.token = path.join(this.dir, "token");
    this.ca = path.join(this.dir, "ca.crt");
    this.namespace = path.join(this.dir, "namespace");
    fs.writeFileSync(this.token, FakeServiceAccount.TOKEN_VALUE);
    fs.writeFileSync(
      this.ca,
      "-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----\n",
    );

    if (options.namespace !== null) {
      fs.writeFileSync(this.namespace, options.namespace || "oneuptime-agent");
    }
  }

  public paths(): { token: string; ca: string; namespace: string } {
    return { token: this.token, ca: this.ca, namespace: this.namespace };
  }

  public cleanup(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
