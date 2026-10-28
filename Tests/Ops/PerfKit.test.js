"use strict";

/**
 * The measurement kit in Scripts/Perf stays runnable.
 *
 * The "less CPU" and "less memory in production" pull requests took their
 * numbers with these scripts, and Scripts/Perf/README.md tells the next
 * change to measure itself the same way. That only works while the scripts
 * still run, and nothing else runs them: they need a whole stack.
 *
 * Held here, without a stack:
 * - every script parses (node --check, bash -n, Python's own parser), and
 *   the README names every file of the kit;
 * - the memory tools work end to end on a real Node process that holds a
 *   known structure: heap-snapshot.js reads its live heap over the
 *   inspector after a full garbage collection (an object that only a
 *   WeakRef holds is gone) and writes a snapshot; heap-summary.js counts the structure's
 *   objects and says who holds them (the dominator chain, the shortest path
 *   from the root, the first retainers, the strings' holders) and writes
 *   --json; heap-diff.js sees the structure grow between two snapshots; and
 *   memory-phase.sh with memory-sample.py records the process's resident
 *   memory and live heap with no container running;
 * - the kit's App image (image/App.Dockerfile) starts the App as
 *   packages/App/Dockerfile.tpl's Community stage does: the same Node
 *   image, the same places for the App and Common, the same user,
 *   transpile-only flag and command.
 */

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const KIT = path.join(REPO_ROOT, "Scripts", "Perf");
const IN_CI = Boolean(process.env["CI"]);

// How many objects the fixture process holds once it has grown.
const ITEMS = 20000;

/*
 * A process that holds nothing much, and answers one command a line:
 * "grow N" holds N more objects (PerfKitItem, in a PerfKitHoard), "drop"
 * makes an object that nothing but a WeakRef holds, and "weak" says whether
 * a garbage collection has taken it since.
 */
const FIXTURE = [
  '"use strict";',
  "class PerfKitHoard {",
  "  constructor() {",
  "    this.items = [];",
  "  }",
  "}",
  "class PerfKitItem {",
  "  constructor(index) {",
  "    this.index = index;",
  // Short enough to be a flat string, not a concatenation.
  '    this.label = "item" + index;',
  "    this.values = [index, index + 1, index + 2];",
  "  }",
  "}",
  "globalThis.perfKitHoard = new PerfKitHoard();",
  "function answer(command) {",
  '  const [name, argument] = command.split(" ");',
  '  if (name === "grow") {',
  "    for (let index = 0; index < Number(argument); index++) {",
  "      globalThis.perfKitHoard.items.push(new PerfKitItem(index));",
  "    }",
  '    process.stdout.write("grew " + globalThis.perfKitHoard.items.length + "\\n");',
  '  } else if (name === "drop") {',
  "    globalThis.perfKitWeak = new WeakRef({ values: new Array(100000).fill(1) });",
  '    process.stdout.write("dropped\\n");',
  '  } else if (name === "weak") {',
  '    const state = globalThis.perfKitWeak.deref() === undefined ? "collected" : "alive";',
  '    process.stdout.write("weak " + state + "\\n");',
  "  }",
  "}",
  'let buffered = "";',
  'process.stdin.setEncoding("utf8");',
  'process.stdin.on("data", (text) => {',
  "  buffered += text;",
  '  let newline = buffered.indexOf("\\n");',
  "  while (newline >= 0) {",
  "    answer(buffered.slice(0, newline).trim());",
  "    buffered = buffered.slice(newline + 1);",
  '    newline = buffered.indexOf("\\n");',
  "  }",
  "});",
  'process.stdout.write("ready\\n");',
  "",
].join("\n");

const INSPECTOR_LISTENING =
  /Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)\//u;

function kitFiles(extension) {
  return fs
    .readdirSync(KIT)
    .filter((name) => {
      return name.endsWith(extension);
    })
    .sort();
}

function hasPython() {
  return spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0;
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: KIT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120000,
    ...(options || {}),
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${result.status}:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
}

// The lines of a heap-summary.js section, from its heading to the next one.
function section(output, heading) {
  const start = output.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = output.slice(start + heading.length);
  const end = rest.search(/\n\n[A-Z]/u);
  return (end >= 0 ? rest.slice(0, end) : rest).split("\n");
}

// A port nothing listens on: one the system just handed out and took back.
function closedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

describe("every script of the kit", () => {
  test.each(kitFiles(".js"))("%s parses (node --check)", (name) => {
    run(process.execPath, ["--check", path.join(KIT, name)]);
  });

  test.each(kitFiles(".sh"))("%s parses (bash -n)", (name) => {
    run("bash", ["-n", path.join(KIT, name)]);
  });

  test.each(kitFiles(".py"))("%s parses (Python's parser)", (name) => {
    if (!hasPython()) {
      // A parity check must not pass by skipping where CI runs it.
      expect(IN_CI).toBe(false);
      console.log(`python3 is not installed: ${name} was not parsed`);
      return;
    }
    run("python3", [
      "-I",
      "-c",
      "import ast, sys; ast.parse(open(sys.argv[1], encoding='utf-8').read(), sys.argv[1])",
      path.join(KIT, name),
    ]);
  });

  test("the README names every file of the kit", () => {
    const readme = fs.readFileSync(path.join(KIT, "README.md"), "utf8");
    const files = [
      ...fs.readdirSync(KIT).filter((name) => {
        return name !== "README.md" && name !== "image";
      }),
      ...fs.readdirSync(path.join(KIT, "image")).map((name) => {
        return `image/${name}`;
      }),
    ];
    const unnamed = files.filter((name) => {
      return !readme.includes(name);
    });
    expect(unnamed).toEqual([]);
  });
});

describe("the memory tools, on a running Node process", () => {
  let directory = "";
  let fixture = null;
  let inspectorPort = 0;
  let stdout = "";

  // Resolves once the fixture has written text (to stdout) matching pattern.
  function waitForOutput(pattern) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`the fixture never wrote ${pattern}: ${stdout}`));
      }, 30000);
      const check = () => {
        if (pattern.test(stdout)) {
          clearTimeout(timer);
          fixture.stdout.off("data", check);
          resolve();
        }
      };
      fixture.stdout.on("data", check);
      check();
    });
  }

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "perf-kit-"));
    const script = path.join(directory, "fixture.js");
    fs.writeFileSync(script, FIXTURE);

    fixture = spawn(process.execPath, ["--inspect=127.0.0.1:0", script], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    fixture.stdout.setEncoding("utf8");
    fixture.stdout.on("data", (text) => {
      stdout += text;
    });

    let stderr = "";
    inspectorPort = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`no inspector port in: ${stderr}`));
      }, 30000);
      fixture.stderr.setEncoding("utf8");
      fixture.stderr.on("data", (text) => {
        stderr += text;
        const match = INSPECTOR_LISTENING.exec(stderr);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
    });
    await waitForOutput(/ready/u);
  }, 60000);

  afterAll(() => {
    if (fixture) {
      fixture.kill("SIGKILL");
    }
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("heap-snapshot.js reads the heap after a full garbage collection: what nothing holds is gone", async () => {
    fixture.stdin.write("drop\n");
    await waitForOutput(/dropped/u);

    // Without an output path: no snapshot, which would collect garbage too.
    const reading = JSON.parse(
      run(process.execPath, ["heap-snapshot.js", String(inspectorPort)]),
    );
    expect(reading.heapUsed).toBeGreaterThan(0);
    expect(reading.snapshot).toBeUndefined();

    fixture.stdin.write("weak\n");
    await waitForOutput(/weak (collected|alive)/u);
    expect(stdout).toContain("weak collected");
  }, 120000);

  test("heap-snapshot.js reads the live heap over the inspector and writes a snapshot, before and after the process grows", async () => {
    const before = JSON.parse(
      run(process.execPath, [
        "heap-snapshot.js",
        String(inspectorPort),
        path.join(directory, "before.heapsnapshot"),
      ]),
    );

    expect(before.heapUsed).toBeGreaterThan(0);
    expect(before.rss).toBeGreaterThan(before.heapUsed);
    expect(before.modules).toBeGreaterThanOrEqual(1);
    expect(before.spaces.old_space).toBeGreaterThan(0);
    expect(before.snapshot.path).toBe(
      path.join(directory, "before.heapsnapshot"),
    );
    expect(
      fs.statSync(path.join(directory, "before.heapsnapshot")).size,
    ).toBeGreaterThan(0);

    fixture.stdin.write(`grow ${ITEMS}\n`);
    await waitForOutput(new RegExp(`grew ${ITEMS}`, "u"));

    const after = JSON.parse(
      run(process.execPath, [
        "heap-snapshot.js",
        String(inspectorPort),
        path.join(directory, "after.heapsnapshot"),
      ]),
    );

    // ITEMS objects of three fields, a string and an array each.
    expect(after.heapUsed - before.heapUsed).toBeGreaterThan(1);
  }, 120000);

  test("heap-summary.js counts the objects and says who holds them", () => {
    const output = run(process.execPath, [
      "heap-summary.js",
      path.join(directory, "after.heapsnapshot"),
      "400",
      "--find",
      "PerfKitHoard",
      "--chains",
      "PerfKitItem",
      "--strings",
      "--scripts",
      "--modules",
      "--json",
      path.join(directory, "after.json"),
    ]);

    expect(output).toMatch(
      /after\.heapsnapshot: \d+ nodes, \d+ edges, [\d.]+ MB of self size/u,
    );

    // By constructor: every one of the objects, once.
    expect(
      section(output, "Self size by constructor or string kind").some(
        (line) => {
          return /^\s*[\d.]+\s+20000\s+object: PerfKitItem$/u.test(line);
        },
      ),
    ).toBe(true);

    // The dominator chain to what holds them all.
    const retainers = section(output, "The biggest retainers");
    expect(retainers.join("\n")).toContain(
      ".perfKitHoard -> object PerfKitHoard",
    );
    expect(retainers.join("\n")).toContain(".items -> object Array");

    // The shortest path from the root ends at the global that keeps it.
    const lines = output.split("\n");
    const found = lines.findIndex((line) => {
      return line.startsWith("object PerfKitHoard  self ");
    });
    expect(found).toBeGreaterThanOrEqual(0);
    expect(lines[found + 1]).toMatch(/^ {4}<- \.perfKitHoard of /u);

    // Who holds the objects: the hoard's array, every one of them.
    expect(
      section(output, "Who holds PerfKitItem").some((line) => {
        return (
          /^\s*[\d.]+\s+20000\s/u.test(line) &&
          line.includes("object PerfKitHoard.items")
        );
      }),
    ).toBe(true);

    // Their labels are held by them.
    expect(
      section(output, "Strings by their first retainer").some((line) => {
        return (
          /^\s*[\d.]+\s+20000\s/u.test(line) &&
          line.includes("object PerfKitItem .label")
        );
      }),
    ).toBe(true);

    expect(output).toMatch(/Script text by package or folder: \d+ scripts/u);
    expect(output).toContain("Retained by module objects");

    const tables = JSON.parse(
      fs.readFileSync(path.join(directory, "after.json"), "utf8"),
    );
    expect(tables.byName["object: PerfKitItem"].count).toBe(ITEMS);
    expect(tables.retainers.length).toBeGreaterThan(0);
    expect(
      tables.retainers.some((retainer) => {
        return retainer.chain.includes(".items -> object Array");
      }),
    ).toBe(true);
  }, 120000);

  test("heap-diff.js sees what grew between the two snapshots", () => {
    run(process.execPath, [
      "heap-summary.js",
      path.join(directory, "before.heapsnapshot"),
      "40",
      "--json",
      path.join(directory, "before.json"),
    ]);
    const before = JSON.parse(
      fs.readFileSync(path.join(directory, "before.json"), "utf8"),
    );
    expect(before.byName["object: PerfKitItem"]).toBeUndefined();

    const output = run(process.execPath, [
      "heap-diff.js",
      path.join(directory, "before.json"),
      path.join(directory, "after.json"),
      "400",
    ]);

    const nodes = /nodes (\d+) -> (\d+)/u.exec(output);
    expect(nodes).not.toBeNull();
    expect(Number(nodes[2])).toBeGreaterThan(Number(nodes[1]) + ITEMS);
    expect(
      section(output, "Grew most").some((line) => {
        return /\+20000\s+20000\s+object: PerfKitItem$/u.test(line);
      }),
    ).toBe(true);
  }, 120000);

  test("memory-phase.sh and memory-sample.py record the process's memory and live heap, with no container running", async () => {
    if (!hasPython()) {
      expect(IN_CI).toBe(false);
      console.log("python3 is not installed: memory-sample.py did not run");
      return;
    }
    if (process.platform !== "linux") {
      // It reads /proc.
      return;
    }

    const perfDir = path.join(directory, "perf");
    fs.mkdirSync(perfDir);
    fs.writeFileSync(path.join(perfDir, "app.pid"), String(fixture.pid));

    // Idle (no collectors, no users: no load generator), one sample, the
    // live heap at every sample.
    const output = run(
      "bash",
      [
        "memory-phase.sh",
        "/dev/null",
        "kit-idle",
        "0",
        "0",
        "0",
        "0",
        String(inspectorPort),
        "1",
      ],
      {
        env: {
          ...process.env,
          PERF_DIR: perfDir,
          // Containers of a prefix nobody uses, and a ClickHouse port nothing answers on.
          PERF_PREFIX: `perf-kit-test-${process.pid}`,
          PERF_CH_PORT: String(await closedPort()),
        },
      },
    );

    expect(output).toMatch(/app rss \d+ \(anon \d+\)/u);
    expect(output).toMatch(/app heap \d+/u);
    expect(output).toContain("memory phase kit-idle done");

    const recorded = JSON.parse(
      fs.readFileSync(
        path.join(perfDir, "results", "kit-idle.memory.json"),
        "utf8",
      ),
    );
    expect(recorded.rows).toHaveLength(1);

    const [row] = recorded.rows;
    expect(row.app.rss).toBeGreaterThan(0);
    expect(row.app.anon).toBeGreaterThan(0);
    expect(row.app_heap.heapUsed).toBeGreaterThan(0);
    expect(row.app_heap.heapUsed).toBeLessThan(row.app.rss);
    // No container, no ClickHouse, no Postgres, no Valkey: nothing recorded, nothing failed.
    expect(
      Object.keys(row).filter((key) => {
        return key.startsWith("container_");
      }),
    ).toEqual([]);
    expect(row.clickhouse).toBeNull();
    expect(row.postgres).toBeNull();
    expect(row.valkey_used).toBeNull();

    expect(recorded.summary.label).toBe("kit-idle");
    expect(recorded.summary.app.rss_first).toBe(row.app.rss);
    expect(recorded.summary.app_heap.first).toBe(row.app_heap.heapUsed);
  }, 180000);
});

describe("the kit's App image", () => {
  const kitDockerfile = fs.readFileSync(
    path.join(KIT, "image", "App.Dockerfile"),
    "utf8",
  );
  const appDockerfile = fs.readFileSync(
    path.join(REPO_ROOT, "packages", "App", "Dockerfile.tpl"),
    "utf8",
  );
  const kitLines = kitDockerfile.split("\n").map((line) => {
    return line.trim();
  });

  // The Community stage: from its FROM to the end of the template.
  const communityStart = appDockerfile.indexOf(
    "FROM community-build AS community",
  );
  const communityLines = appDockerfile
    .slice(communityStart)
    .split("\n")
    .map((line) => {
      return line.trim();
    });

  test("is built FROM the Node image the App's image is", () => {
    const appBase = /^FROM (\S+) AS base$/mu.exec(appDockerfile);
    expect(appBase).not.toBeNull();

    const kitFrom = kitLines.filter((line) => {
      return line.startsWith("FROM ");
    });
    expect(kitFrom).toEqual([`FROM ${appBase[1]}`]);
  });

  test("puts Common and the App where the App's image does", () => {
    expect(appDockerfile).toContain("WORKDIR /usr/src/app");
    expect(appDockerfile).toMatch(
      /COPY \.\/packages\/Common \/usr\/src\/Common/u,
    );
    expect(kitLines).toContain("WORKDIR /usr/src/app");
    expect(kitLines).toContain("COPY packages/Common /usr/src/Common");
    expect(kitLines).toContain(
      "COPY --chown=1000:1000 packages/App /usr/src/app",
    );
  });

  test("runs as the Community stage does: its user, edition, transpile-only flag and command", () => {
    expect(communityStart).toBeGreaterThan(0);

    const runtime = communityLines.filter((line) => {
      return (
        line.startsWith("USER ") ||
        line.startsWith("ENV TS_NODE_TRANSPILE_ONLY=") ||
        line.startsWith("ENV IS_ENTERPRISE_EDITION=") ||
        line.startsWith("CMD ")
      );
    });

    expect(runtime).toHaveLength(4);
    for (const line of runtime) {
      expect(kitLines).toContain(line);
    }
  });
});
