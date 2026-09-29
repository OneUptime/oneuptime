import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  PROCESS_MEMORY_HELPER_MAX_PIDS,
  PROCESS_MEMORY_HELPER_PATH,
} from "../../Utils/Monitors/SyntheticRuntime/ProcessTreeMemory";

/*
 * The synthetic memory watchdog reads a check's PSS through a helper the image
 * builds, and quietly holds checks to their summed RSS when the helper is not
 * there. That fallback is right for a development machine and wrong for the
 * probe image: if the Dockerfile step and the path ProcessTreeMemory runs ever
 * drift apart, every probe goes back to failing ordinary Chromium checks for
 * memory they never held, and no unit test can see it. The helper also runs
 * as root beside untrusted checks, so what it may do is pinned here too.
 */

const probeRoot: string = resolve(__dirname, "../..");
const dockerfile: string = readFileSync(
  resolve(probeRoot, "Dockerfile.tpl"),
  "utf8",
);
const helperSourcePath: string = resolve(
  probeRoot,
  "Utils/Monitors/SyntheticRuntime/Native/synthetic-process-memory.c",
);

// C source without its comments, so only code is matched.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("Probe process-memory helper image step", () => {
  test("compiles the helper source into exactly the path ProcessTreeMemory runs", () => {
    expect(existsSync(helperSourcePath)).toBe(true);
    expect(dockerfile).toContain(
      "COPY ./packages/Probe/Utils/Monitors/SyntheticRuntime/Native/synthetic-process-memory.c /tmp/synthetic-process-memory.c",
    );
    expect(dockerfile).toContain(
      `-o ${PROCESS_MEMORY_HELPER_PATH} /tmp/synthetic-process-memory.c`,
    );
    // A warning is a build failure, not a helper that may misread memory.
    expect(dockerfile).toContain("RUN gcc -O2 -Wall -Wextra -Werror");
  });

  test("builds it for the development and the production image alike", () => {
    const buildStepIndex: number = dockerfile.indexOf(
      `-o ${PROCESS_MEMORY_HELPER_PATH}`,
    );
    const imageSplitIndex: number = dockerfile.indexOf(
      '{{ if eq .Env.ENVIRONMENT "development" }}',
    );

    expect(buildStepIndex).toBeGreaterThan(-1);
    expect(imageSplitIndex).toBeGreaterThan(-1);
    expect(buildStepIndex).toBeLessThan(imageSplitIndex);
  });

  test("leaves the helper root-owned, and runnable by root alone", () => {
    /*
     * It runs with the supervisor's CAP_SETUID and CAP_SETGID. A synthetic
     * worker UID must not be able to replace it, and has no reason to run it.
     */
    expect(dockerfile).toContain(
      `chown root:root ${PROCESS_MEMORY_HELPER_PATH}`,
    );
    expect(dockerfile).toContain(`chmod 0700 ${PROCESS_MEMORY_HELPER_PATH}`);
  });

  test("checks the production image can still run it once the toolchain is gone", () => {
    /*
     * In the same RUN step as the toolchain purge, after it: the helper links
     * only against libc, and this proves the purge left it so.
     */
    const purgeIndex: number = dockerfile.indexOf(
      "apt-get purge -y --auto-remove python3 make g++ unixodbc-dev",
    );
    const runCheck: string = `{ ${PROCESS_MEMORY_HELPER_PATH} 2>/dev/null; test $? -eq 2; }`;
    const runCheckIndex: number = dockerfile.indexOf(runCheck);
    const purgeStep: string = dockerfile.slice(
      purgeIndex,
      dockerfile.indexOf("\n", runCheckIndex),
    );

    expect(purgeIndex).toBeGreaterThan(-1);
    expect(runCheckIndex).toBeGreaterThan(purgeIndex);
    // Every line between them continues the purge's RUN instruction.
    for (const line of purgeStep.split("\n").slice(0, -1)) {
      expect(line.trimEnd().endsWith("\\")).toBe(true);
    }
  });
});

describe("Probe process-memory helper source", () => {
  const code: string = withoutComments(readFileSync(helperSourcePath, "utf8"));

  test("changes only its effective ids, keeping its real and saved ids", () => {
    /*
     * Real and saved ids of root are what keep the check it measures from
     * signalling or ptracing it. setuid(), setreuid() or seteuid() from root
     * could change them.
     */
    expect(code).toContain("setresgid((gid_t)-1, gid, (gid_t)-1)");
    expect(code).toContain("setresuid((uid_t)-1, uid, (uid_t)-1)");
    for (const call of [
      "setuid(",
      "setgid(",
      "setreuid(",
      "setregid(",
      "seteuid(",
      "setegid(",
    ]) {
      expect(code).not.toMatch(
        new RegExp(`(^|[^a-z_])${call.replace("(", "\\(")}`, "m"),
      );
    }
  });

  test("proves the switch before reading anything", () => {
    expect(code).toContain("getresuid(");
    expect(code).toContain("getresgid(");
    expect(code.indexOf("switch_effective_identity((uid_t)uid")).toBeLessThan(
      code.indexOf("read_pss(pid, &pss_kb)"),
    );
  });

  test("opens nothing but a smaps_rollup, and starts nothing", () => {
    const opens: string[] = Array.from(
      code.matchAll(/\bopen\s*\(([^;]*)\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
    expect(opens).toEqual(["path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW"]);
    expect(code).toContain('"/proc/%lu/smaps_rollup"');

    for (const forbidden of [
      "fopen(",
      "openat(",
      "exec",
      "system(",
      "popen(",
      "fork(",
      "getenv(",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  test("reads the Pss line, not Rss or one of the Pss_ breakdown lines", () => {
    expect(code).toContain('strncmp(line, "Pss:", 4)');
    expect(code).not.toMatch(/"Rss:|"Pss_/);
  });

  test("accepts no more pids than ProcessTreeMemory ever sends it", () => {
    const match: RegExpMatchArray | null = code.match(/#define MAX_PIDS (\d+)/);

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(PROCESS_MEMORY_HELPER_MAX_PIDS);
  });
});
