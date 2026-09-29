import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import { SpawnFunction } from "../../Executors/ResourceExecutor";
import { makeTempDir } from "./FakeBinary";

/*
 * Test doubles for the host kit (HostExecutor):
 *
 *   - FakeNsenter: an injected spawn standing in for /usr/bin/nsenter. It
 *     answers by the HOST argv — whatever follows nsenter's "--" (`uname
 *     -sr`, `systemctl --no-pager --version`, `hostname`, ...) — and records
 *     the binary, the whole nsenter argv, the environment and the spawn
 *     options exactly as the sandbox passed them. It can also fail the way
 *     nsenter does (exit 127 with "nsenter: failed to execute ..."), hang
 *     until the sandbox kills it, die by a signal, or fail to start.
 *   - makeHostProc: a directory laid out like the parts of /proc the
 *     executor reads — /proc/1/ns/mnt and /proc/self/ns/mnt (symlinks),
 *     /proc/1/comm, /proc/<pid>/stat of the agent's process tree, and pid
 *     1's /etc/os-release — so every test decides whether pid 1 is the
 *     host's init, whatever machine the tests run on.
 */

export const HOST_NAMESPACE: string = "mnt:[4026531841]";
export const CONTAINER_NAMESPACE: string = "mnt:[4026532770]";

export const UNAME_SR: string = "Linux 6.8.0-45-generic\n";
export const SYSTEMD_VERSION_OUTPUT: string =
  "systemd 255 (255.4-1ubuntu8.4)\n+PAM +AUDIT +SELINUX +APPARMOR +IMA +SMACK +SECCOMP +GCRYPT -GNUTLS +OPENSSL +ACL +BLKID +CURL +ELFUTILS +FIDO2 +IDN2 -IDN +IPTC +KMOD +LIBCRYPTSETUP +LIBFDISK +PCRE2 -PWQUALITY +P11KIT +QRENCODE +TPM2 +BZIP2 +LZ4 +XZ +ZLIB +ZSTD -BPF_FRAMEWORK -XKBCOMMON +UTMP +SYSVINIT default-hierarchy=unified\n";
export const OS_RELEASE: string =
  'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\n';

export interface FakeHostReply {
  stdout?: string | undefined;
  stderr?: string | undefined;
  exitCode?: number | undefined;
  // Close with this signal instead of an exit code.
  signal?: string | undefined;
  // Print stdout/stderr, then never finish (the sandbox's timeout kills it).
  hang?: boolean | undefined;
  // Emit an "error" event with this code (ENOENT: no nsenter).
  errorCode?: string | undefined;
  // Throw from spawn() itself with this code.
  throwCode?: string | undefined;
}

export type HostResponder = (hostArgv: Array<string>) => FakeHostReply;

export interface HostSpawnRecord {
  binary: string;
  // nsenter's whole argv.
  args: Array<string>;
  // What follows nsenter's "--": the program and its arguments.
  hostArgv: Array<string>;
  env: Record<string, string>;
  cwd: string;
  options: Record<string, unknown>;
}

// nsenter's complaint when the program is not on the host.
export function execFailure(program: string): FakeHostReply {
  return {
    stderr: `nsenter: failed to execute ${program}: No such file or directory\n`,
    exitCode: 127,
  };
}

// The program and its arguments, as nsenter runs them.
export function hostArgvOf(args: Array<string>): Array<string> {
  const index: number = args.indexOf("--");
  return index >= 0 ? args.slice(index + 1) : [];
}

/*
 * A healthy systemd host named `hostname`; anything else prints "ran ...".
 */
export function healthyHost(hostname: string = "web-host-1"): HostResponder {
  return (hostArgv: Array<string>): FakeHostReply => {
    const command: string = hostArgv.join(" ");

    if (command === "uname -sr") {
      return { stdout: UNAME_SR };
    }

    if (command === "systemctl --no-pager --version") {
      return { stdout: SYSTEMD_VERSION_OUTPUT };
    }

    if (command === "hostname" || command === "uname -n") {
      return { stdout: `${hostname}\n` };
    }

    return { stdout: `ran ${command}\n` };
  };
}

export class FakeChild extends EventEmitter {
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

export default class FakeNsenter {
  public readonly calls: Array<HostSpawnRecord> = [];
  public readonly children: Array<FakeChild> = [];
  public readonly spawnImpl: SpawnFunction;

  public constructor(public responder: HostResponder = healthyHost()) {
    this.spawnImpl = ((
      binary: string,
      args: Array<string>,
      options: Record<string, unknown>,
    ): FakeChild => {
      const env: Record<string, string> = (options["env"] || {}) as Record<
        string,
        string
      >;
      const hostArgv: Array<string> = hostArgvOf(args);

      this.calls.push({
        binary,
        args: args.slice(),
        hostArgv,
        env: { ...env },
        cwd: String(options["cwd"]),
        options,
      });

      const reply: FakeHostReply = this.responder(hostArgv.slice());

      if (reply.throwCode) {
        throw Object.assign(new Error(`spawn ${binary} ${reply.throwCode}`), {
          code: reply.throwCode,
        });
      }

      const child: FakeChild = new FakeChild();
      this.children.push(child);

      setImmediate((): void => {
        if (reply.errorCode) {
          child.emit(
            "error",
            Object.assign(new Error(`spawn ${binary} ${reply.errorCode}`), {
              code: reply.errorCode,
            }),
          );
          return;
        }

        if (reply.hang) {
          if (reply.stdout) {
            child.stdout.write(reply.stdout);
          }

          if (reply.stderr) {
            child.stderr.write(reply.stderr);
          }

          return;
        }

        let ended: number = 0;
        const onEnd: () => void = (): void => {
          ended++;

          if (ended === 2) {
            if (reply.signal) {
              child.emit("close", null, reply.signal);
            } else {
              child.emit("close", reply.exitCode ?? 0, null);
            }
          }
        };

        child.stdout.on("end", onEnd);
        child.stderr.on("end", onEnd);
        child.stdout.resume();
        child.stderr.resume();
        child.stdout.end(reply.stdout || "");
        child.stderr.end(reply.stderr || "");
      });

      return child;
    }) as unknown as SpawnFunction;
  }

  // The host argv of every call, in order.
  public hostArgvs(): Array<Array<string>> {
    return this.calls.map((call: HostSpawnRecord): Array<string> => {
      return call.hostArgv;
    });
  }

  public clear(): void {
    this.calls.splice(0);
  }
}

// ---- A /proc the test controls -----------------------------------------------

export interface HostProcLayout {
  // /proc/1/ns/mnt's target; null leaves it out (ENOENT).
  hostMountNamespace?: string | null | undefined;
  // /proc/self/ns/mnt's target; null leaves it out.
  ownMountNamespace?: string | null | undefined;
  // /proc/1/comm.
  initName?: string | undefined;
  // pid -> parent pid, written as /proc/<pid>/stat.
  parents?: Record<number, number> | undefined;
  // /proc/1/root/etc/os-release; null leaves it out.
  osRelease?: string | null | undefined;
}

// The agent's own process tree in the default layout: node, tini, the shim.
export const AGENT_PID: number = 4242;
export const DEFAULT_PARENTS: Record<number, number> = {
  4242: 4200,
  4200: 4100,
  4100: 1,
};

export function makeHostProc(layout: HostProcLayout = {}): string {
  const root: string = makeTempDir("agent-host-proc-");
  const hostNamespace: string | null =
    layout.hostMountNamespace === undefined
      ? HOST_NAMESPACE
      : layout.hostMountNamespace;
  const ownNamespace: string | null =
    layout.ownMountNamespace === undefined
      ? CONTAINER_NAMESPACE
      : layout.ownMountNamespace;

  fs.mkdirSync(path.join(root, "1", "ns"), { recursive: true });
  fs.mkdirSync(path.join(root, "self", "ns"), { recursive: true });

  if (hostNamespace !== null) {
    fs.symlinkSync(hostNamespace, path.join(root, "1", "ns", "mnt"));
  }

  if (ownNamespace !== null) {
    fs.symlinkSync(ownNamespace, path.join(root, "self", "ns", "mnt"));
  }

  fs.writeFileSync(
    path.join(root, "1", "comm"),
    `${layout.initName ?? "systemd"}\n`,
  );

  for (const [pid, parent] of Object.entries(
    layout.parents ?? DEFAULT_PARENTS,
  )) {
    fs.mkdirSync(path.join(root, pid), { recursive: true });
    fs.writeFileSync(
      path.join(root, pid, "stat"),
      `${pid} (node) S ${parent} ${pid} ${pid} 0 -1 4194560 1234 0 0 0 5 3 0 0 20 0 11 0 8123 1103101952 12000\n`,
    );
  }

  const osRelease: string | null =
    layout.osRelease === undefined ? OS_RELEASE : layout.osRelease;

  if (osRelease !== null) {
    fs.mkdirSync(path.join(root, "1", "root", "etc"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "1", "root", "etc", "os-release"),
      osRelease,
    );
  }

  return root;
}
