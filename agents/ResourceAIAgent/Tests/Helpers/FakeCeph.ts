import fs from "fs";
import os from "os";
import path from "path";
import { ChildProcess, SpawnOptions, spawn } from "child_process";
import { CEPH_BINARY } from "../../Executors/CephExecutor";
import { SpawnFunction } from "../../Executors/ResourceExecutor";
import { PRINTED_MARKER, waitForFile } from "./KillAfterOutput";

/*
 * A stand-in for /usr/bin/ceph: a small Node script that answers each ceph
 * command the way the test scripted it (`versions --format json` with a
 * cluster's versions, `health --format json`, a refused key, a monitor that
 * never answers) and records how it was started — argv, the complete
 * environment, working directory, and the modes of HOME and the job
 * directory.
 *
 * The executor always starts the absolute path /usr/bin/ceph with its own
 * connection options first (--conf, --keyring, --id, --connect-timeout).
 * The script skips those to find the command words it answers; the test
 * still sees the whole argv. spawnImpl() returns a spawn that starts this
 * script in its place (and records which binary was asked for), so the
 * real child_process machinery still runs — pipes, exit codes, kills — with
 * the environment exactly as the executor built it.
 *
 * The script's shebang names this Node binary directly (not /bin/sh, which
 * would add PWD/SHLVL to the environment the tests assert is closed).
 *
 * The fixtures below are what ceph 19.2.3 (Alpine's ceph19-common, the
 * agent image's) printed against a real single-monitor cluster.
 */

export interface FakeCephResponse {
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
 * Responses by the command they answer: the command words joined by spaces
 * ("versions --format json") first, then the first word alone ("versions"),
 * then "*".
 */
export type FakeCephScript = Record<string, FakeCephResponse>;

export interface FakeCephInvocation {
  // Everything after the program name, connection options included.
  argv: Array<string>;
  // The command words after the agent's connection options.
  command: Array<string>;
  env: Record<string, string>;
  cwd: string;
  cwdMode: number | null;
  // The job directory: the parent of the working directory (HOME).
  parentMode: number | null;
  parentEntries: Array<string>;
  homeExists: boolean;
  homeEntries: Array<string> | null;
}

const SCRIPT: string = `
const fs = require("fs");
const path = require("path");
const dir = __dirname;
let script = {};
try { script = JSON.parse(fs.readFileSync(path.join(dir, "script.json"), "utf8")); } catch {}
const argv = process.argv.slice(2);
const connection = ["--conf", "--keyring", "--id", "--connect-timeout"];
let index = 0;
while (index < argv.length && connection.includes(argv[index])) { index += 2; }
const command = argv.slice(index);
const response = script[command.join(" ")] || script[command[0] || ""] || script["*"] || {};
function mode(p) { try { return fs.statSync(p).mode & 0o777; } catch { return null; } }
function entries(p) { try { return fs.readdirSync(p).sort(); } catch { return null; } }
let homeExists = false;
try { homeExists = fs.statSync(process.env.HOME || "/nonexistent").isDirectory(); } catch {}
// macOS adds __CF_USER_TEXT_ENCODING to every process it starts; it did not come from the agent.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("__CF_")));
fs.appendFileSync(path.join(dir, "invocations.jsonl"), JSON.stringify({
  argv, command, env, cwd: process.cwd(),
  cwdMode: mode(process.cwd()),
  parentMode: mode(path.dirname(process.cwd())),
  parentEntries: entries(path.dirname(process.cwd())) || [],
  homeExists,
  homeEntries: process.env.HOME ? entries(process.env.HOME) : null,
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

export default class FakeCeph {
  public readonly dir: string;
  public readonly binary: string;
  // Every binary the executor asked spawn to start, in order.
  public readonly requestedBinaries: Array<string> = [];
  // The options of every spawn, in order.
  public readonly spawnOptions: Array<SpawnOptions> = [];

  public constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-ceph-"));
    this.binary = path.join(this.dir, "ceph");
    fs.writeFileSync(this.binary, `#!${process.execPath}\n${SCRIPT}`, {
      mode: 0o755,
    });
    this.setScript({});
  }

  public setScript(script: FakeCephScript): void {
    // A new script, a new run: an earlier run's announcement does not count.
    fs.rmSync(path.join(this.dir, PRINTED_MARKER), { force: true });
    fs.writeFileSync(
      path.join(this.dir, "script.json"),
      JSON.stringify(script),
    );
  }

  /*
   * A spawn that starts this fake wherever the executor asks for
   * /usr/bin/ceph (or `binary` instead, e.g. a path that does not exist).
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
        requested === CEPH_BINARY ? binary || this.binary : requested,
        args,
        options,
      );
    }) as unknown as SpawnFunction;
  }

  // Resolves once a response scripted with announcePrinted has printed everything.
  public waitUntilPrinted(signal?: AbortSignal | undefined): Promise<void> {
    return waitForFile(path.join(this.dir, PRINTED_MARKER), signal);
  }

  public getInvocations(): Array<FakeCephInvocation> {
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
      .map((line: string): FakeCephInvocation => {
        return JSON.parse(line) as FakeCephInvocation;
      });
  }

  // The invocations whose command starts with these words.
  public invocationsOf(...words: Array<string>): Array<FakeCephInvocation> {
    return this.getInvocations().filter(
      (invocation: FakeCephInvocation): boolean => {
        return words.every((word: string, index: number): boolean => {
          return invocation.command[index] === word;
        });
      },
    );
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

// `ceph versions --format json` (ceph prints a newline before its JSON).
export const VERSIONS_JSON: string =
  '\n{"mon":{"ceph version 19.2.3 (c92aebb279828e9c3c1f5d24613efca272649e62) squid (stable)":3},"mgr":{"ceph version 19.2.3 (c92aebb279828e9c3c1f5d24613efca272649e62) squid (stable)":2},"osd":{"ceph version 19.2.3 (c92aebb279828e9c3c1f5d24613efca272649e62) squid (stable)":12},"overall":{"ceph version 19.2.3 (c92aebb279828e9c3c1f5d24613efca272649e62) squid (stable)":17}}';

// The same cluster half way through an upgrade from Reef.
export const MIXED_VERSIONS_JSON: string =
  '\n{"mon":{"ceph version 19.2.3 (c92aebb279828e9c3c1f5d24613efca272649e62) squid (stable)":3},"osd":{"ceph version 18.2.4 (e7ad5345525c7aa95470c26863873b581076945d) reef (stable)":8,"ceph version 19.2.3 (c92aebb279828e9c3c1f5d24613efca272649e62) squid (stable)":4},"overall":{"ceph version 18.2.4 (e7ad5345525c7aa95470c26863873b581076945d) reef (stable)":8,"ceph version 19.2.3 (c92aebb279828e9c3c1f5d24613efca272649e62) squid (stable)":7}}';

// `ceph -s` in its plain format (its blank separator lines are " ").
export const STATUS_PLAIN: string = [
  "  cluster:",
  "    id:     e8fbdea0-d86b-4173-b675-a3eb7337179d",
  "    health: HEALTH_WARN",
  "            1 osds down",
  " ",
  "  services:",
  "    mon: 3 daemons, quorum a,b,c (age 30m)",
  "    mgr: x(active, since 24m), standbys: y",
  "    osd: 12 osds: 11 up (since 2m), 12 in (since 3d)",
  " ",
  "  data:",
  "    pools:   4 pools, 97 pgs",
  "    objects: 115 objects, 453 MiB",
  "    usage:   1.4 GiB used, 299 GiB / 300 GiB avail",
  "    pgs:     85 active+clean",
  "             12 active+undersized+degraded",
  " ",
  "",
].join("\n");

// `ceph health --format json` with two raised checks.
export const HEALTH_WARN_JSON: string =
  '\n{"status":"HEALTH_WARN","checks":{"OSD_DOWN":{"severity":"HEALTH_WARN","summary":{"message":"1 osds down","count":1},"muted":false},"PG_DEGRADED":{"severity":"HEALTH_WARN","summary":{"message":"Degraded data redundancy: 12/345 objects degraded","count":12},"muted":false}},"mutes":[]}\n';

export const HEALTH_OK_JSON: string =
  '\n{"status":"HEALTH_OK","checks":{},"mutes":[]}\n';

// What ceph prints when it cannot connect, each ending in ceph's last line.
export const STDERR_KEYRING_MISSING: (keyring: string) => string = (
  keyring: string,
): string => {
  return [
    `2026-09-29T10:09:14.727+0000 ffff9a1d7ab8 -1 auth: unable to find a keyring on ${keyring}: (2) No such file or directory`,
    `2026-09-29T10:09:14.727+0000 ffff9a1d7ab8 -1 AuthRegistry(0xffff9a59b328) no keyring found at ${keyring}, disabling cephx`,
    "[errno 2] RADOS object not found (error connecting to the cluster)",
    "",
  ].join("\n");
};

export const STDERR_KEYRING_UNREADABLE: (keyring: string) => string = (
  keyring: string,
): string => {
  return [
    `2026-09-29T10:09:15.537+0000 ffffb0f36ab8 -1 auth: unable to find a keyring on ${keyring}: (13) Permission denied`,
    "2026-09-29T10:09:15.541+0000 ffffb0f36ab8 -1 monclient: keyring not found",
    "[errno 13] RADOS permission denied (error connecting to the cluster)",
    "",
  ].join("\n");
};

export const STDERR_KEYRING_INVALID: (keyring: string) => string = (
  keyring: string,
): string => {
  return [
    `2026-09-29T10:09:16.187+0000 fffface0fab8 -1 auth: failed to load ${keyring}: (5) I/O error`,
    `2026-09-29T10:09:16.187+0000 fffface0fab8 -1 auth: error parsing file ${keyring}: error setting modifier for [client.oneuptime-ai] type=key val=AQBtest==: Malformed input [buffer:3]`,
    "2026-09-29T10:09:16.187+0000 fffface0fab8 -1 monclient: keyring not found",
    "[errno 5] RADOS I/O error (error connecting to the cluster)",
    "",
  ].join("\n");
};

export const STDERR_AUTH_REJECTED: string = [
  "2026-09-29T10:09:16.655+0000 ffff852a9ab8 -1 monclient(hunting): handle_auth_bad_method server allowed_methods [2] but i only support [2]",
  "[errno 13] RADOS permission denied (error connecting to the cluster)",
  "",
].join("\n");

export const STDERR_CONF_MISSING: string =
  "Error initializing cluster client: ObjectNotFound('RADOS object not found (error calling conf_read_file)')\n";

export const STDERR_CONF_INVALID: string =
  "Error initializing cluster client: InvalidArgumentError('RADOS invalid argument (error calling conf_read_file)')\n";

export const STDERR_NO_MONITORS: string = [
  "unable to get monitor info from DNS SRV with service name: ceph-mon",
  "[errno 2] RADOS object not found (error connecting to the cluster)",
  "",
].join("\n");

export const STDERR_MON_UNRESOLVABLE: string = [
  "server name not found: nosuchhost.invalid (Name does not resolve)",
  "unable to parse addrs in 'nosuchhost.invalid'",
  "2026-09-29T10:09:51.449+0000 ffffb9dddab8 -1 monclient: get_monmap_and_config cannot identify monitors to contact",
  "[errno 22] RADOS invalid argument (error connecting to the cluster)",
  "",
].join("\n");

// --connect-timeout ran out: the monitors never answered.
export const STDERR_MON_UNREACHABLE: string = "timed out\n";

export const STDERR_ACCESS_DENIED: string = "Error EACCES: access denied\n";

export const STDERR_MGR_ACCESS_DENIED: string =
  "Error EACCES: access denied: does your client key have mgr caps? See http://docs.ceph.com/en/latest/mgr/administrator/#client-authentication\n";

export const STDERR_NO_ORCHESTRATOR: string =
  "Error ENOENT: No orchestrator configured (try `ceph orch set backend`)\n";

export const STDERR_OSD_NOT_FOUND: string =
  "Error ENOENT: osd.99 does not exist\n";

export const STDERR_UNKNOWN_COMMAND: string = [
  "no valid command found; 10 closest matches:",
  "pg stat",
  "pg getmap",
  "pg dump [<dumpcontents:all|summary|sum|delta|pools|osds|pgs|pgs_brief>...]",
  "Error EINVAL: invalid command",
  "",
].join("\n");

export const STDERR_PG_NO_PRIMARY: string =
  "Error EAGAIN: pg 1.0 has no primary osd\n";

/*
 * The two lines ceph prints on EVERY run whose keyring is not at the
 * default place for its --id — even runs that succeed.
 */
export const STDERR_DEFAULT_KEYRING_SEARCH: (clientId: string) => string = (
  clientId: string,
): string => {
  const searched: string = `/etc/ceph/ceph.client.${clientId}.keyring,/etc/ceph/ceph.keyring,/etc/ceph/keyring,/etc/ceph/keyring.bin`;

  return [
    `2026-09-29T10:11:14.110+0000 ffffad78dab8 -1 auth: unable to find a keyring on ${searched}: (2) No such file or directory`,
    `2026-09-29T10:11:14.110+0000 ffffad78dab8 -1 AuthRegistry(0xffffadb92210) no keyring found at ${searched}, disabling cephx`,
    "",
  ].join("\n");
};
