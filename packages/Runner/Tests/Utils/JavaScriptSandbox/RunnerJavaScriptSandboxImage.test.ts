import fs from "fs";
import path from "path";
import {
  SANDBOX_IDENTITY_MAX,
  SANDBOX_IDENTITY_MIN,
  SANDBOX_LAUNCHER_PATH,
} from "../../../Utils/JavaScriptSandbox/SandboxIdentity";
import { SANDBOX_NO_NETWORK_PATH } from "../../../Utils/JavaScriptSandbox/SandboxNetwork";
import {
  PASSED_THROUGH_ENVIRONMENT,
  SANDBOX_WORKER_BUNDLE_PATH,
} from "../../../Utils/JavaScriptSandbox/SandboxProcess";

/*
 * The JavaScript sandbox's launcher runs setuid root beside every project's
 * JavaScript steps, and the Runner finds it, and the worker's bundle, at
 * fixed paths. If the Dockerfile and those paths drift apart, every global
 * Runner quietly runs its steps as its own user; if the launcher's source
 * loosens, a step's process could keep a privilege. Neither shows in a unit
 * test, so both are pinned here. (Tests/Ops/RunnerImageRuntime.test.js runs
 * the built image, the launcher included, in CI.)
 */

const runnerRoot: string = path.resolve(__dirname, "../../..");
const dockerfile: string = fs.readFileSync(
  path.join(runnerRoot, "Dockerfile.tpl"),
  "utf8",
);
const launcherSourcePath: string = path.join(
  runnerRoot,
  "Utils/JavaScriptSandbox/Native/javascript-sandbox.c",
);
const noNetworkSourcePath: string = path.join(
  runnerRoot,
  "Utils/JavaScriptSandbox/Native/javascript-sandbox-no-network.c",
);

// C source without its comments, so only code is matched.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// One Dockerfile instruction, its continuation lines joined.
function instructionContaining(text: string, from: number = 0): string {
  const index: number = dockerfile.indexOf(text, from);
  expect(index).toBeGreaterThan(-1);
  const start: number = dockerfile.lastIndexOf("\nRUN ", index) + 1;
  let end: number = dockerfile.indexOf("\n", index);

  while (dockerfile.slice(start, end).trimEnd().endsWith("\\")) {
    end = dockerfile.indexOf("\n", end + 1);
  }

  return dockerfile
    .slice(start, end)
    .replace(/\\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DEVELOPMENT_SPLIT: string = '{{ if eq .Env.ENVIRONMENT "development" }}';
const PRODUCTION_SPLIT: string = "{{ else }}";

const HARDENING_FLAGS: string =
  "gcc -O2 -Wall -Wextra -Werror -Wformat-security -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIE -pie -Wl,-z,relro,-z,now";

describe("the Runner image's JavaScript sandbox", () => {
  const productionStart: number = dockerfile.indexOf(PRODUCTION_SPLIT);
  const developmentStart: number = dockerfile.indexOf(DEVELOPMENT_SPLIT);

  test("the production build compiles the launcher's source into the path the Runner runs, with warnings as errors", () => {
    const compile: string = instructionContaining(
      `-o ${SANDBOX_LAUNCHER_PATH} /usr/src/app/Utils/JavaScriptSandbox/Native/javascript-sandbox.c`,
      productionStart,
    );

    expect(fs.existsSync(launcherSourcePath)).toBe(true);
    expect(compile).toContain(HARDENING_FLAGS);
  });

  test("the production build compiles the no-network filter's source into the path the Runner runs, with the same hardening flags", () => {
    const compile: string = instructionContaining(
      `-o ${SANDBOX_NO_NETWORK_PATH} /usr/src/app/Utils/JavaScriptSandbox/Native/javascript-sandbox-no-network.c`,
      productionStart,
    );

    expect(fs.existsSync(noNetworkSourcePath)).toBe(true);
    expect(compile).toContain(HARDENING_FLAGS);
  });

  test("the image owns the no-network filter as root, runnable by all, never setuid", () => {
    const setUp: string = instructionContaining(
      `chmod 0755 ${SANDBOX_NO_NETWORK_PATH}`,
      productionStart,
    );

    // Owned by root (with the other files on the chown root:root line).
    expect(setUp).toMatch(
      new RegExp(
        `chown root:root [^&]*${SANDBOX_NO_NETWORK_PATH.replace(/[/]/g, "\\/")}`,
      ),
    );
    // Mode 0755: never a setuid or setgid bit, which would be a leading 4, 2 or 6.
    const mode: RegExpMatchArray | null = setUp.match(
      new RegExp(
        `chmod ([0-7]+) ${SANDBOX_NO_NETWORK_PATH.replace(/[/]/g, "\\/")}`,
      ),
    );
    expect(mode).not.toBeNull();
    expect(mode![1]).toBe("0755");
    expect(setUp).toContain(
      `{ ${SANDBOX_NO_NETWORK_PATH} check; test $? -eq 0; }`,
    );
  });

  test("and bundles the worker into the path the Runner runs, holding every package but isolated-vm", () => {
    const bundle: string = instructionContaining(
      `--outfile=${SANDBOX_WORKER_BUNDLE_PATH}`,
      productionStart,
    );

    expect(bundle).toContain(
      "/usr/src/Common/node_modules/.bin/esbuild /usr/src/app/Utils/JavaScriptSandbox/SandboxWorker.ts --bundle --platform=node",
    );
    expect(bundle).toContain("--external:isolated-vm");
    expect(bundle).toContain("--tsconfig=/usr/src/app/tsconfig.json");
  });

  test("the image owns the launcher as root, setuid, run by the node group alone, and the bundle as root, read by all", () => {
    const setUp: string = instructionContaining(
      `chmod 4750 ${SANDBOX_LAUNCHER_PATH}`,
      productionStart,
    );

    expect(setUp).toContain(`chown root:node ${SANDBOX_LAUNCHER_PATH}`);
    expect(setUp).toContain(`chmod 0644 ${SANDBOX_WORKER_BUNDLE_PATH}`);
    expect(setUp).toContain("chmod 0755 /usr/lib/oneuptime-runner");
    expect(setUp).not.toMatch(/chmod [0-7]*[2367] /);
    // Set, and run, before the image becomes the node user's.
    expect(dockerfile.indexOf(setUp)).toBeLessThan(
      dockerfile.indexOf("USER node", productionStart),
    );
  });

  test("and runs each once, as it ships: the launcher answers with its usage code, and the bundle loads isolated-vm and refuses an empty request", () => {
    const setUp: string = instructionContaining(
      `chmod 4750 ${SANDBOX_LAUNCHER_PATH}`,
      productionStart,
    );

    expect(setUp).toContain(
      `{ ${SANDBOX_LAUNCHER_PATH} 2>/dev/null; test $? -eq 64; }`,
    );
    expect(setUp).toContain(
      `{ echo '' | NODE_PATH=/usr/src/Common/node_modules node --no-node-snapshot ${SANDBOX_WORKER_BUNDLE_PATH} 3>/dev/null 4>/dev/null; test $? -eq 2; }`,
    );
  });

  test("the development image compiles the same launcher and filter, with the same flags, and owns them the same way", () => {
    const developmentPart: string = dockerfile.slice(
      developmentStart,
      productionStart,
    );
    const compile: string = instructionContaining(
      `-o ${SANDBOX_LAUNCHER_PATH} /tmp/javascript-sandbox.c`,
      developmentStart,
    );

    expect(developmentPart).toContain(
      "COPY ./packages/Runner/Utils/JavaScriptSandbox/Native/javascript-sandbox.c /tmp/javascript-sandbox.c",
    );
    expect(developmentPart).toContain(
      "COPY ./packages/Runner/Utils/JavaScriptSandbox/Native/javascript-sandbox-no-network.c /tmp/javascript-sandbox-no-network.c",
    );
    expect(compile).toContain(HARDENING_FLAGS);
    expect(compile).toContain(`chown root:node ${SANDBOX_LAUNCHER_PATH}`);
    expect(compile).toContain(`chmod 4750 ${SANDBOX_LAUNCHER_PATH}`);
    expect(compile).toContain(
      `-o ${SANDBOX_NO_NETWORK_PATH} /tmp/javascript-sandbox-no-network.c`,
    );
    expect(compile).toContain(`chmod 0755 ${SANDBOX_NO_NETWORK_PATH}`);
    // Before the toolchain is purged.
    expect(dockerfile.indexOf(compile)).toBeLessThan(
      dockerfile.indexOf("apt-get purge -y --auto-remove python3 make g++"),
    );
  });
});

describe("the no-network filter's source", () => {
  const source: string = fs.readFileSync(noNetworkSourcePath, "utf8");
  const code: string = withoutComments(source);

  test("no_new_privs is set before the seccomp filter, so a process with no privilege may set it", () => {
    const noNewPrivs: number = code.indexOf("PR_SET_NO_NEW_PRIVS");
    const setFilter: number = code.indexOf("PR_SET_SECCOMP");

    expect(noNewPrivs).toBeGreaterThan(-1);
    expect(setFilter).toBeGreaterThan(-1);
    expect(noNewPrivs).toBeLessThan(setFilter);
  });

  test("every socket of every family is refused, and io_uring too", () => {
    for (const call of [
      "__NR_socket",
      "__NR_socketpair",
      "__NR_io_uring_setup",
      "__NR_io_uring_enter",
      "__NR_io_uring_register",
    ]) {
      expect(code).toContain(`REFUSE(${call},`);
    }
  });

  test("nothing of another process - its memory or its open connections", () => {
    for (const call of [
      "__NR_ptrace",
      "__NR_process_vm_readv",
      "__NR_process_vm_writev",
      "__NR_pidfd_getfd",
    ]) {
      expect(code).toContain(`REFUSE(${call},`);
    }
  });

  test("another architecture's system-call table is killed, not let through", () => {
    expect(code).toContain("seccomp_data, arch)");
    expect(code).toContain("SECCOMP_RET_KILL_PROCESS");
    // x32's numbers are this table's with a high bit; they are killed too.
    expect(code).toContain("X32_SYSCALL_BIT");
  });

  test("it runs a program by its full path only, and no shell", () => {
    for (const forbidden of [
      "system(",
      "popen(",
      "execv p(".replace(" ", ""),
      "execl(",
      "dlopen(",
    ]) {
      expect(code).not.toContain(forbidden);
    }
    expect(code).toContain("argv[1][0] != '/'");
    expect(code).toContain("execve(argv[1]");
  });

  test("its check proves a socket is refused once the filter is set", () => {
    expect(code).toContain("is_socket_refused(AF_INET)");
    expect(code).toContain("is_socket_refused(AF_INET6)");
    expect(code).toContain("is_socket_refused(AF_UNIX)");
  });
});

describe("the launcher's source", () => {
  const source: string = fs.readFileSync(launcherSourcePath, "utf8");
  const code: string = withoutComments(source);

  function functionBody(name: string): string {
    const start: number = code.search(new RegExp(`static int ${name}\\(`));
    expect(start).toBeGreaterThan(-1);
    const next: number = code.indexOf("\nstatic ", start + 1);
    const main: number = code.indexOf("\nint main(", start + 1);
    const ends: Array<number> = [next, main].filter((index: number) => {
      return index > -1;
    });

    return code.slice(start, Math.min(...ends));
  }

  test("only users in the Runner's range, written as digits", () => {
    expect(code).toContain(
      `#define SANDBOX_IDENTITY_MIN ${SANDBOX_IDENTITY_MIN}UL`,
    );
    expect(code).toContain(
      `#define SANDBOX_IDENTITY_MAX ${SANDBOX_IDENTITY_MAX}UL`,
    );
    expect(functionBody("is_sandbox_identity")).toContain(
      "value >= SANDBOX_IDENTITY_MIN && value <= SANDBOX_IDENTITY_MAX",
    );
  });

  test("a step's user is taken whole: no group, then the group's three ids, then the user's, each proved, and root never regained", () => {
    const body: string = functionBody("switch_identity");
    const order: Array<number> = [
      "setgroups(0, NULL)",
      "setresgid(gid, gid, gid)",
      "setresuid(uid, uid, uid)",
      "getresuid(&ruid, &euid, &suid)",
      "getresgid(&rgid, &egid, &sgid)",
      "getgroups(0, NULL) != 0",
      "setresuid(0, 0, 0) == 0",
    ].map((call: string): number => {
      return body.indexOf(call);
    });

    for (const index of order) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(
      [...order].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(order);
  });

  test("never the calls that keep a saved id or change one id alone", () => {
    for (const call of [
      "setuid(",
      "setgid(",
      "seteuid(",
      "setegid(",
      "setreuid(",
      "setregid(",
    ]) {
      expect(code).not.toMatch(
        new RegExp(`(^|[^a-z_])${call.replace("(", "\\(")}`, "m"),
      );
    }
  });

  test("the step's process dies with the launcher, and starts only once the launcher holds its user", () => {
    const body: string = functionBody("run");
    const child: string = body.slice(body.indexOf("if (child == 0) {"));
    const steps: Array<number> = [
      "switch_identity(identity)",
      "prctl(PR_SET_PDEATHSIG, SIGKILL)",
      "getppid() != launcher",
      "read(ready[0], &byte, 1)",
      "prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)",
      "set_sandbox_limits()",
      "close_fds_from(FIRST_FD_TO_CLOSE)",
      'chdir("/")',
      "build_environment(environment)",
      "execve(program_argv[0], program_argv, environment)",
    ].map((call: string): number => {
      return child.indexOf(call);
    });

    for (const index of steps) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(
      [...steps].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(steps);
    // A program by its full path only, never looked up on PATH.
    expect(body).toContain("program_argv[0][0] != '/'");
    expect(code).not.toMatch(/\bexec(v|l)p/);
  });

  test("the launcher keeps the caller as its real user and the step's as its effective one, then lets the step go on", () => {
    const hold: string = functionBody("hold_step");
    const run: string = functionBody("run");
    const parent: string = run.slice(run.lastIndexOf("(void)close(ready[0]);"));

    expect(hold).toContain("setresgid(caller_gid, caller_gid, caller_gid)");
    expect(hold).toContain("setresuid(caller_uid, step_uid, step_uid)");
    expect(parent.indexOf("hold_step(")).toBeLessThan(
      parent.indexOf("prctl(PR_SET_PDEATHSIG, SIGKILL)"),
    );
    expect(parent.indexOf("prctl(PR_SET_PDEATHSIG, SIGKILL)")).toBeLessThan(
      parent.indexOf("write(ready[1], &ready_byte, 1)"),
    );
    expect(parent.indexOf("write(ready[1], &ready_byte, 1)")).toBeLessThan(
      parent.indexOf("detach_streams()"),
    );
  });

  test("no core dump, no byte written to a file, and a bounded number of processes and files", () => {
    const limits: string = functionBody("set_sandbox_limits");

    expect(limits).toContain("set_limit(RLIMIT_CORE, 0)");
    expect(limits).toContain("set_limit(RLIMIT_FSIZE, 0)");
    expect(limits).toContain("set_limit(RLIMIT_NPROC, SANDBOX_PROCESS_LIMIT)");
    expect(limits).toContain(
      "set_limit(RLIMIT_NOFILE, SANDBOX_OPEN_FILE_LIMIT)",
    );
    // Standard input, output, error, the result and the HTTP channel stay open.
    expect(code).toContain("#define FIRST_FD_TO_CLOSE 5");
  });

  test("the step's environment holds only the names the Runner passes, never NODE_OPTIONS or one of the Runner's own", () => {
    const list: string = code.slice(
      code.indexOf("ALLOWED_ENVIRONMENT[] = {"),
      code.indexOf("};", code.indexOf("ALLOWED_ENVIRONMENT[] = {")),
    );
    const names: Array<string> = Array.from(list.matchAll(/"([A-Z_]+)"/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );

    expect(names).toEqual([
      "PATH",
      "NODE_PATH",
      "NODE_ENV",
      "NODE_EXTRA_CA_CERTS",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "TZ",
      "LANG",
      "LC_ALL",
    ]);
    for (const name of [
      "PATH",
      "LANG",
      "NODE_PATH",
      ...PASSED_THROUGH_ENVIRONMENT,
    ]) {
      expect(names).toContain(name);
    }
    expect(
      names.some((name: string): boolean => {
        return name.startsWith("ONEUPTIME") || name === "NODE_OPTIONS";
      }),
    ).toBe(false);
  });

  test("a caller that is itself a step's user is refused before anything else", () => {
    const main: string = code.slice(code.indexOf("int main("));

    expect(main.indexOf("is_sandbox_identity((unsigned long)getuid())")).toBe(
      main.indexOf("is_sandbox_identity("),
    );
    expect(main).toContain("return EXIT_REFUSED_CALLER;");
    expect(main.indexOf("EXIT_REFUSED_CALLER")).toBeLessThan(
      main.indexOf("check()"),
    );
  });

  test("the reap and the check act only as the step's user", () => {
    const reap: string = functionBody("reap");
    const check: string = functionBody("check");

    expect(reap.indexOf("switch_identity(identity)")).toBeLessThan(
      reap.indexOf("kill(-1, SIGKILL)"),
    );
    expect(check).toContain("switch_identity(SANDBOX_IDENTITY_MIN)");
  });

  test("it opens no file but /dev/null and /proc/self/fd, and runs no shell", () => {
    for (const forbidden of [
      "system(",
      "popen(",
      "fopen(",
      "execl(",
      "dlopen(",
    ]) {
      expect(code).not.toContain(forbidden);
    }

    const opens: Array<string> = Array.from(
      code.matchAll(/\bopen(?:dir)?\s*\(\s*"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(opens.sort()).toEqual(["/dev/null", "/proc/self/fd"]);
  });
});
