"use strict";

/*
 * Every Node.js service image gives node a heap that follows the container's
 * memory limit.
 *
 * The images started node with --max-old-space-size=8096 whatever memory the
 * container had. The flag turns off Node's own sizing of the heap to the
 * container's limit, so in a pod limited below 8 GB V8 went on growing the
 * heap toward 8 GB between collections, and the kernel killed the container
 * (OOMKilled: no graceful shutdown, no log line) instead of V8 collecting
 * harder near a limit of its own.
 *
 * So every start script (package.json's; each image's production CMD is
 * `sh -c` with it, Tests/Ops/NodeImageStartCommand.test.js, and the ingress
 * image's run.sh runs it with npm) opens with one rule, and so does the App's
 * migrate script, which the Helm chart's migrate Job runs:
 *
 *   - The container's memory limit is the first number among cgroup v2's
 *     memory.max in the process's own cgroup (the 0:: line of
 *     /proc/self/cgroup: a container in the host's cgroup namespace sees the
 *     whole tree), cgroup v2's memory.max at /sys/fs/cgroup (the container's
 *     own cgroup in Docker's and Kubernetes' default private namespace), and
 *     cgroup v1's memory/memory.limit_in_bytes. "max", v1's "no limit" (a
 *     number of 19 digits), anything that is not a number and no file at all
 *     are no limit.
 *   - With a limit, the heap is three quarters of it, in MB: the quarter left
 *     is for what node holds beside its old generation (its own code, the
 *     young generation, buffers, the allocator). At least 256 MB, so that a
 *     tiny limit still boots node, and at most 8096 MB, which a container
 *     never had more of before.
 *   - Without a limit, 8096 MB, as before.
 *   - A --max-old-space-size an operator puts in NODE_OPTIONS (Helm's
 *     extraEnv, an environment line in a compose override) comes after the
 *     rule's, and node takes the last one; every other flag in NODE_OPTIONS
 *     (the Probe's and the Runner's --use-openssl-ca) stays as it was.
 *
 * Here each script runs up to node for real, under sh (dash on Ubuntu),
 * bash and BusyBox's ash, against cgroup files written for each case, with
 * node swapped for one that reports the heap V8 took. With
 * RUN_NODE_HEAP_CONTAINER_TESTS=1 (Ops Config Test sets it) the rule also
 * runs in containers of the images' Alpine base with real memory limits,
 * and with NODE_HEAP_IMAGES (space-separated image references, such as the
 * Build workflow's) in each of those images, with its own CMD.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");

const {
  REPO_ROOT,
  SERVICES,
  PROC_SELF_CGROUP,
  SYS_FS_CGROUP,
  HAND_OVER,
  NO_LIMIT_HEAP_MB,
  MB,
  REPORT,
  scriptsOf,
  heapRuleOf,
  reporting,
  writeCgroups,
  parseReport,
  runScript,
  heapSizeLimitMbFor,
  expectedHeapMb,
} = require("./Utils/NodeHeapRule");

const GIB = 1024 * MB;

// Every script the rule opens: each service's start script, and the App's migrate.
const SCRIPTS = [
  ...SERVICES.map((service) => {
    return { name: `${service} start`, script: scriptsOf(service).start };
  }),
  { name: "App migrate", script: scriptsOf("App").migrate },
];

const START = scriptsOf("App").start;

jest.setTimeout(180000);

/*
 * The shells the images run the script with. sh is dash on Ubuntu (CI's
 * runners) and Debian (the Probe's and the Runner's images); BusyBox's ash
 * is Alpine's sh (the App's, the ingress's, Home's and the test server's
 * images), run here where BusyBox is installed and, with
 * RUN_NODE_HEAP_CONTAINER_TESTS=1, in Alpine below. And bash.
 */
const SHELLS = ["sh", "bash", "busybox sh"].filter((shell) => {
  const [command, ...args] = shell.split(" ");
  return spawnSync(command, [...args, "-c", "exit 0"]).status === 0;
});

function runUnder(shell, script, options) {
  return runScript(script, { ...options, shell: shell.split(" ") });
}

/*
 * The cases: how a container's cgroups look, and the heap the rule gives it.
 * procSelfCgroup is /proc/self/cgroup; files are under /sys/fs/cgroup.
 */
const V1_PROC =
  "12:memory:/docker/0a16b511e6af\n1:name=systemd:/docker/0a16b511e6af";
const CASES = [
  {
    name: "cgroup v2, a container's own namespace (Docker's and Kubernetes' default): 2 GiB",
    cgroups: { procSelfCgroup: "0::/", files: { "memory.max": 2 * GIB } },
    heapMb: 1536,
  },
  {
    name: "cgroup v2, the host's cgroup namespace (docker run --cgroupns=host): the process's own cgroup's 1 GiB",
    // The host's root cgroup has no memory.max.
    cgroups: {
      procSelfCgroup: "0::/system.slice/docker-0a16b511e6af.scope",
      files: { "system.slice/docker-0a16b511e6af.scope/memory.max": GIB },
    },
    heapMb: 768,
  },
  {
    name: "cgroup v2: the process's own cgroup's limit comes before the one at /sys/fs/cgroup",
    cgroups: {
      procSelfCgroup: "0::/app.slice",
      files: { "app.slice/memory.max": GIB, "memory.max": 4 * GIB },
    },
    heapMb: 768,
  },
  {
    name: "cgroup v2, a cgroup below the namespace's own with no limit of its own: the namespace's 4 GiB",
    cgroups: {
      procSelfCgroup: "0::/init.scope",
      files: { "init.scope/memory.max": "max", "memory.max": 4 * GIB },
    },
    heapMb: 3072,
  },
  {
    name: "cgroup v2 without a limit",
    cgroups: { procSelfCgroup: "0::/", files: { "memory.max": "max" } },
    heapMb: NO_LIMIT_HEAP_MB,
  },
  {
    name: "cgroup v1: 1 GiB",
    cgroups: {
      procSelfCgroup: V1_PROC,
      files: { "memory/memory.limit_in_bytes": GIB },
    },
    heapMb: 768,
  },
  {
    name: "cgroup v1 without a limit (its largest page-aligned number)",
    cgroups: {
      procSelfCgroup: V1_PROC,
      files: { "memory/memory.limit_in_bytes": "9223372036854771712" },
    },
    heapMb: NO_LIMIT_HEAP_MB,
  },
  {
    name: "cgroup v1 with systemd's unified hierarchy beside it (hybrid): v1's 1 GiB",
    cgroups: {
      procSelfCgroup: `${V1_PROC}\n0::/docker/0a16b511e6af`,
      files: { "memory/memory.limit_in_bytes": GIB },
    },
    heapMb: 768,
  },
  {
    name: "no cgroups at all (macOS, or a checkout's npm start)",
    cgroups: { procSelfCgroup: null, files: {} },
    heapMb: NO_LIMIT_HEAP_MB,
  },
  {
    name: "a tiny limit, 64 MiB: the floor",
    cgroups: { procSelfCgroup: "0::/", files: { "memory.max": 64 * MB } },
    heapMb: 256,
  },
  {
    name: "a limit past what the heap ever had, 32 GiB: the ceiling",
    cgroups: { procSelfCgroup: "0::/", files: { "memory.max": 32 * GIB } },
    heapMb: NO_LIMIT_HEAP_MB,
  },
  {
    name: "a limit that is not a number",
    cgroups: { procSelfCgroup: "0::/", files: { "memory.max": "12ab" } },
    heapMb: NO_LIMIT_HEAP_MB,
  },
];

describe("every Node.js service's start script opens with the heap rule", () => {
  test("the scripts it reads are there (the checks below are not vacuous)", () => {
    expect(SCRIPTS).toHaveLength(7);
    for (const { name, script } of SCRIPTS) {
      expect({ name, script: typeof script }).toEqual({
        name,
        script: "string",
      });
    }
  });

  test("the same rule, word for word, before each hands its heap to node", () => {
    const rule = heapRuleOf(START);

    expect(rule.length).toBeGreaterThan(100);
    for (const { name, script } of SCRIPTS) {
      expect({ name, rule: heapRuleOf(script) }).toEqual({ name, rule });
    }
  });

  test("each puts the rule's heap first in NODE_OPTIONS, keeps what NODE_OPTIONS had after it, and execs node", () => {
    for (const { name, script } of SCRIPTS) {
      const handOver = script.slice(heapRuleOf(script).length);

      expect({ name, handOver }).toEqual({
        name,
        handOver: expect.stringMatching(
          /^export NODE_OPTIONS="--max-old-space-size=\$heap( --max-http-header-size=8388608)?\$\{NODE_OPTIONS:\+ \$NODE_OPTIONS\}" && exec node (--no-node-snapshot )?--require ts-node\/register (Index|Migrate)\.ts$/,
        ),
      });
    }
  });

  test("no script names a heap of its own any more", () => {
    for (const { name, script } of SCRIPTS) {
      expect({ name, fixed: /--max-old-space-size=\d/.test(script) }).toEqual({
        name,
        fixed: false,
      });
    }
  });

  test("the rule reads the container's memory limit from /proc/self/cgroup and /sys/fs/cgroup only, so the cases below see every file it reads", () => {
    const rule = heapRuleOf(START);

    expect(rule.split(PROC_SELF_CGROUP)).toHaveLength(2);
    expect(rule.split(SYS_FS_CGROUP)).toHaveLength(4);
    expect(rule.match(/\/(?:proc|sys)\/[^\s"$);]*/g)).toEqual([
      SYS_FS_CGROUP,
      PROC_SELF_CGROUP,
      `${SYS_FS_CGROUP}/memory.max`,
      `${SYS_FS_CGROUP}/memory/memory.limit_in_bytes`,
    ]);
    expect(HAND_OVER).toBe('export NODE_OPTIONS="--max-old-space-size=$heap');
  });
});

describe.each(SHELLS)("the rule, under %s", (shell) => {
  test.each(CASES)("$name", ({ cgroups, heapMb }) => {
    expect(runUnder(shell, START, { cgroups })).toEqual({
      nodeOptions: `--max-old-space-size=${heapMb}`,
      heapSizeLimitMb: heapSizeLimitMbFor(heapMb),
    });
  });

  test("keeps what NODE_OPTIONS had, after the heap (the Probe's and the Runner's --use-openssl-ca)", () => {
    expect(
      runUnder(shell, START, {
        cgroups: { procSelfCgroup: "0::/", files: { "memory.max": 2 * GIB } },
        nodeOptions: "--use-openssl-ca --enable-source-maps",
      }).nodeOptions,
    ).toBe("--max-old-space-size=1536 --use-openssl-ca --enable-source-maps");
  });

  test("an operator's own --max-old-space-size in NODE_OPTIONS wins, above or below the rule's", () => {
    for (const operatorMb of [600, 3000]) {
      expect(
        runUnder(shell, START, {
          cgroups: {
            procSelfCgroup: "0::/",
            files: { "memory.max": 2 * GIB },
          },
          nodeOptions: `--max-old-space-size=${operatorMb}`,
        }),
      ).toEqual({
        nodeOptions: `--max-old-space-size=1536 --max-old-space-size=${operatorMb}`,
        heapSizeLimitMb: heapSizeLimitMbFor(operatorMb),
      });
    }
  });
});

describe("three quarters of the limit, between the floor and the ceiling", () => {
  /*
   * Limits around each bend of the rule, in bytes: 341 MiB is the last whose
   * three quarters are under the floor, 10,795 MiB the first whose three
   * quarters reach the ceiling.
   */
  const LIMITS = [
    1,
    MB,
    256 * MB,
    341 * MB,
    342 * MB,
    344 * MB,
    512 * MB,
    GIB - 1,
    GIB,
    1536 * MB,
    3 * GIB + 12345,
    8 * GIB,
    10794 * MB,
    10795 * MB,
    16 * GIB,
    999999999999999,
  ];

  test.each(LIMITS)("a limit of %d bytes", (limit) => {
    expect(
      runScript(START, {
        cgroups: { procSelfCgroup: "0::/", files: { "memory.max": limit } },
      }).nodeOptions,
    ).toBe(`--max-old-space-size=${expectedHeapMb(limit)}`);
  });

  test("the bends are where the rule says", () => {
    expect(expectedHeapMb(341 * MB)).toBe(256);
    expect(expectedHeapMb(344 * MB)).toBe(258);
    expect(expectedHeapMb(2 * GIB)).toBe(1536);
    expect(expectedHeapMb(10794 * MB)).toBe(8095);
    expect(expectedHeapMb(10795 * MB)).toBe(NO_LIMIT_HEAP_MB);
    expect(expectedHeapMb(null)).toBe(NO_LIMIT_HEAP_MB);
  });

  test("a number of 16 digits or more (a petabyte) is no limit, so the shell never meets a number it cannot hold", () => {
    expect(
      runScript(START, {
        cgroups: {
          procSelfCgroup: "0::/",
          files: { "memory.max": "18446744073709551615" },
        },
      }).nodeOptions,
    ).toBe(`--max-old-space-size=${NO_LIMIT_HEAP_MB}`);
  });
});

/*
 * In containers, with the memory limits Docker sets: the kernel's cgroup
 * files, BusyBox's ash and the node of the images' Alpine base, which Ops
 * Config Test has pulled for its other Docker checks.
 */
const ALPINE = "public.ecr.aws/docker/library/node:26-alpine3.24";
const RUN_CONTAINERS = process.env.RUN_NODE_HEAP_CONTAINER_TESTS === "1";

function docker(args) {
  return spawnSync("docker", args, { encoding: "utf8", timeout: 180000 });
}

describe("Ops Config Test runs the container checks", () => {
  test("its jest step sets RUN_NODE_HEAP_CONTAINER_TESTS=1, so they never skip in CI", () => {
    const { stepCommand } = require("./Utils/WorkflowStep");
    const steps = yaml.load(
      fs.readFileSync(
        path.join(REPO_ROOT, ".github", "workflows", "test.ops.yaml"),
        "utf8",
      ),
    ).jobs.test.steps;
    const jest = steps.filter((step) => {
      return stepCommand(step) === "cd Tests/Ops && npm run test";
    });

    expect(jest).toHaveLength(1);
    expect(jest[0].env).toEqual(
      expect.objectContaining({ RUN_NODE_HEAP_CONTAINER_TESTS: "1" }),
    );
  });
});

(RUN_CONTAINERS ? describe : describe.skip)(
  "the rule in a container, with the memory limit Docker gives it",
  () => {
    beforeAll(() => {
      const version = docker(["version", "--format", "{{.Server.Version}}"]);
      if (version.status !== 0) {
        throw new Error(
          `RUN_NODE_HEAP_CONTAINER_TESTS=1, but docker is not usable: ${version.stderr}`,
        );
      }
    });

    // What node reports in a container run with these docker run flags.
    function inContainer(flags, command) {
      return parseReport(
        docker(["run", "--rm", ...flags, ALPINE, ...command]),
        `docker run ${flags.join(" ")}`,
      );
    }

    function heapInContainer(flags, oldSpaceMb) {
      return inContainer(flags, [
        "node",
        `--max-old-space-size=${oldSpaceMb}`,
        "-e",
        REPORT,
      ]).heapSizeLimitMb;
    }

    test.each([
      ["no memory limit", [], NO_LIMIT_HEAP_MB],
      [
        "--memory=256m (three quarters would be 192 MB: the floor)",
        ["--memory=256m"],
        256,
      ],
      ["--memory=1g", ["--memory=1g"], 768],
      ["--memory=2g", ["--memory=2g"], 1536],
      ["--memory=16g (the ceiling)", ["--memory=16g"], NO_LIMIT_HEAP_MB],
      [
        "--memory=1g in the host's cgroup namespace",
        ["--cgroupns=host", "--memory=1g"],
        768,
      ],
    ])("%s", (what, flags, heapMb) => {
      expect(inContainer(flags, ["sh", "-c", reporting(START)])).toEqual({
        nodeOptions: `--max-old-space-size=${heapMb}`,
        heapSizeLimitMb: heapInContainer(flags, heapMb),
      });
    });

    /*
     * Docker runs cgroup v2 here, so v1 is what a container sees of it:
     * memory/memory.limit_in_bytes at /sys/fs/cgroup, its v2 files gone.
     */
    test("cgroup v1's file, mounted where a v1 host mounts it: 1 GiB", () => {
      const directory = writeCgroups({
        files: { "memory/memory.limit_in_bytes": GIB },
      });
      try {
        expect(
          inContainer(
            [
              "--volume",
              `${path.join(directory, "sys-fs-cgroup")}:/sys/fs/cgroup:ro`,
            ],
            ["sh", "-c", reporting(START)],
          ).nodeOptions,
        ).toBe("--max-old-space-size=768");
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    test("an operator's NODE_OPTIONS heap wins in a 2 GiB container", () => {
      const flags = [
        "--memory=2g",
        "-e",
        "NODE_OPTIONS=--max-old-space-size=3000",
      ];

      expect(
        inContainer(flags, ["sh", "-c", reporting(START)]).heapSizeLimitMb,
      ).toBe(heapInContainer(["--memory=2g"], 3000));
    });
  },
);

/*
 * Built images (NODE_HEAP_IMAGES="oneuptime-app:community oneuptime-runner:ci"):
 * the start script each image carries, run with the image's shell, sed, cat
 * and node.
 */
const IMAGES = (process.env.NODE_HEAP_IMAGES || "")
  .split(/\s+/)
  .filter(Boolean);

(IMAGES.length > 0 ? describe.each(IMAGES) : describe.skip.each(["none"]))(
  "the image %s",
  (image) => {
    function imageCommand() {
      const inspected = docker([
        "image",
        "inspect",
        "--format",
        "{{json .Config.Cmd}}",
        image,
      ]);
      expect(inspected.status).toBe(0);
      return JSON.parse(inspected.stdout);
    }

    // The start script of the image's own package.json, in /usr/src/app.
    function imageStartScript() {
      const read = docker([
        "run",
        "--rm",
        "--entrypoint",
        "cat",
        image,
        "/usr/src/app/package.json",
      ]);
      expect(read.status).toBe(0);
      return JSON.parse(read.stdout).scripts.start;
    }

    test("its CMD runs its start script, which opens with the rule: sh -c with it, or the ingress's run.sh, which runs npm start", () => {
      const start = imageStartScript();
      const command = imageCommand();

      expect(heapRuleOf(start)).toBe(heapRuleOf(START));
      if (command[2] === "./run.sh") {
        const runScript = docker([
          "run",
          "--rm",
          "--entrypoint",
          "cat",
          image,
          "/usr/src/app/run.sh",
        ]);
        expect(command).toEqual(["/bin/sh", "-c", "./run.sh"]);
        expect(runScript.stdout).toMatch(/^npm start &$/m);
      } else {
        expect(command).toEqual(["sh", "-c", start]);
      }
    });

    test.each([
      ["no memory limit", [], NO_LIMIT_HEAP_MB],
      ["--memory=1g", ["--memory=1g"], 768],
      ["--memory=3g", ["--memory=3g"], 2304],
    ])("%s", (what, flags, heapMb) => {
      const script = imageStartScript();
      const report = parseReport(
        docker([
          "run",
          "--rm",
          ...flags,
          "--entrypoint",
          "sh",
          image,
          "-c",
          reporting(script),
        ]),
        `${image} with ${flags.join(" ") || "no limit"}`,
      );

      expect(report.nodeOptions.split(" ")[0]).toBe(
        `--max-old-space-size=${heapMb}`,
      );
    });
  },
);
