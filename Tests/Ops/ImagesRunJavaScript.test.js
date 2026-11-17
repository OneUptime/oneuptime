"use strict";

/**
 * Every OneUptime server image runs the JavaScript its build compiled, and no
 * process of it loads TypeScript or ts-node.
 *
 * The images used to start through ts-node (`node --require ts-node/register
 * Index.ts`), which compiled each module as it was first required: every
 * process carried TypeScript itself, ts-node, and the work of compiling some
 * 5,000 modules at each start. Now each image's build compiles its
 * TypeScript beside every file, with the options ts-node ran it with
 * (packages/Common/Server/Utils/TsNode/Precompile.js), and the image starts
 * the JavaScript after Common's PrecompiledSourceMaps.js, which gives stack
 * traces their TypeScript lines and refuses to load TypeScript.
 *
 * So this holds, for every server image - the App (both editions), Home, the
 * ingress sidecar (packages/Nginx), the Probe, the Runner and the test server
 * - from the files that make it:
 *
 *   - its start script (package.json's start, and the App's migrate, which
 *     the Helm chart's migrate job runs) execs node on the entry's JavaScript,
 *     with PrecompiledSourceMaps.js first, and names neither ts-node nor a
 *     .ts file;
 *   - nothing its production build runs or sets (rendered as `npm run
 *     prerun` renders it) starts ts-node or sets a TS_NODE_ variable;
 *   - its build compiles the package and Common with Precompile.js and the
 *     package's tsconfig, after the type-check, in a stage its /usr/src comes
 *     from, and before its development packages are pruned;
 *   - the images that prune their packages (App, Runner, ingress) keep what
 *     PrecompiledSourceMaps.js requires, prune ts-node and TypeScript, and
 *     fail their build when either is still there; the check itself fails on
 *     a tree that has them;
 *   - ts-node is a development package of every server, and Common depends
 *     on the source-map-support PrecompiledSourceMaps.js requires;
 *   - the Enterprise image compiles ee/ with the App's tsconfig;
 *   - the Iron Bank images, the Helm chart and docker-compose start them with
 *     their own commands, and none names ts-node;
 *   - and LoadedModules' check, which AppImageRuntime.test.js and
 *     RunnerImageRuntime.test.js run inside the images they boot to ask the
 *     running server what it loaded, finds a server's process, and sees
 *     TypeScript, ts-node and TypeScript's compiler among its modules when
 *     they are there.
 */

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const {
  render,
  parseStages,
  buildOrder,
  instructions,
} = require("./Utils/DockerfileTemplate");
const { CHECK_SCRIPT, parseReport } = require("./Utils/LoadedModules");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const PRECOMPILED_SOURCE_MAPS =
  "Common/Server/Utils/TsNode/PrecompiledSourceMaps.js";
const PRECOMPILE =
  "RUN node /usr/src/Common/Server/Utils/TsNode/Precompile.js --project /usr/src/app/tsconfig.json --root /usr/src/app --root /usr/src/Common";
// The Enterprise Edition's compile, which takes ee/ too.
const PRECOMPILE_EE = `${PRECOMPILE} --root /usr/src/ee`;
// Steps that bundle TypeScript (the frontends, the Runner's sandbox worker).
const BUNDLES = /\bbuild-frontends|frontend-run\.sh|\besbuild\b/;
const PRUNE_ENTRY = `--entry /usr/src/${PRECOMPILED_SOURCE_MAPS}`;
// The check every pruning image runs after its prune.
const TOOLING_GONE =
  "node -e \"for (const name of ['ts-node', 'typescript']) for (const from of ['/usr/src/app', '/usr/src/Common']) { let found = ''; try { found = require.resolve(name, { paths: [from] }); } catch {} if (found) throw new Error(found + ' is still installed, and the image runs JavaScript'); }\"";

/*
 * Each server image: its package, the scripts its image or the Helm chart
 * runs, the stages it ships (the App builds both editions from one
 * template; null is the template's last stage), and whether its build
 * prunes its development packages.
 */

// A Precompile.js step: the community compile, or the Enterprise one.
function isPrecompile(line) {
  return line === PRECOMPILE || line === PRECOMPILE_EE;
}
const SERVERS = [
  {
    name: "App",
    scripts: { start: "Index", migrate: "Migrate" },
    finalStages: ["enterprise", "community"],
    prunes: true,
  },
  { name: "Home", scripts: { start: "Index" }, finalStages: [null] },
  {
    name: "Nginx",
    scripts: { start: "Index" },
    finalStages: [null],
    prunes: true,
  },
  { name: "Probe", scripts: { start: "Index" }, finalStages: [null] },
  {
    name: "Runner",
    scripts: { start: "Index" },
    finalStages: [null],
    prunes: true,
  },
  { name: "TestServer", scripts: { start: "Index" }, finalStages: [null] },
];

// Anything that starts or configures ts-node.
const STARTS_TS_NODE = /ts-node\/register|(^|\s)-r ts-node|TS_NODE_/;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function packageJson(name) {
  return JSON.parse(read(`packages/${name}/package.json`));
}

function productionStages(name) {
  return parseStages(
    render(read(`packages/${name}/Dockerfile.tpl`), "production", {
      fileExists: (relativePath) => {
        return fs.existsSync(path.join(REPO_ROOT, relativePath));
      },
    }),
  );
}

/*
 * The stages an image is made of: those its FROM ancestry and its `COPY
 * --from`s build, then the image's own.
 */
function stagesOfImage(stages, finalStage) {
  if (finalStage.name) {
    return buildOrder(stages, finalStage.name);
  }
  const order = buildOrder(stages, finalStage.from);
  for (const line of instructions(finalStage.body)) {
    const match = /^COPY\s+(?:--\S+\s+)*?--from=(\S+)/i.exec(line);
    if (match) {
      for (const stage of buildOrder(stages, match[1].toLowerCase())) {
        if (!order.includes(stage)) {
          order.push(stage);
        }
      }
    }
  }
  return order.concat([finalStage]);
}

function finalStagesOf(server, stages) {
  return server.finalStages.map((name) => {
    return name === null
      ? stages[stages.length - 1]
      : stages.find((stage) => {
          return stage.name === name;
        });
  });
}

describe.each(SERVERS)("packages/$name", (server) => {
  const scripts = packageJson(server.name).scripts;
  const stages = productionStages(server.name);
  const finals = finalStagesOf(server, stages);

  test.each(Object.entries(server.scripts))(
    "its %s script execs node on %s.js, with the stack-trace support first, and names no TypeScript",
    (script, entry) => {
      const text = scripts[script];

      // Read as text, not built into a pattern: the path holds dots and slashes.
      expect(text).toMatch(
        /&& exec node (--no-node-snapshot )?--require \S+ \S+\.js$/,
      );
      expect(
        text.endsWith(` --require ${PRECOMPILED_SOURCE_MAPS} ${entry}.js`),
      ).toBe(true);
      expect(text).not.toMatch(/ts-node|\.tsx?\b/);
      expect(
        fs.existsSync(
          path.join(REPO_ROOT, "packages", server.name, `${entry}.ts`),
        ),
      ).toBe(true);
    },
  );

  test("finds the stages it ships (the checks below are not vacuous)", () => {
    expect(finals).toHaveLength(server.finalStages.length);
    for (const stage of finals) {
      expect(stage).toBeDefined();
      expect(stagesOfImage(stages, stage).length).toBeGreaterThan(0);
    }
  });

  test("nothing its production build runs or sets starts ts-node", () => {
    for (const stage of finals) {
      for (const built of stagesOfImage(stages, stage)) {
        for (const line of instructions(built.body)) {
          expect({ stage: built.name, line }).toEqual({
            stage: built.name,
            line: expect.not.stringMatching(STARTS_TS_NODE),
          });
        }
      }
    }
  });

  test("its build compiles the package and Common once, after the type-check, where its /usr/src comes from", () => {
    for (const stage of finals) {
      const lines = stagesOfImage(stages, stage).flatMap((built) => {
        return instructions(built.body);
      });
      const compiles = lines.filter(isPrecompile);

      expect({ stage: stage.name, compiles }).toEqual({
        stage: stage.name,
        compiles: [stage.name === "enterprise" ? PRECOMPILE_EE : PRECOMPILE],
      });
      const typeCheck = lines.indexOf("RUN npm run compile");
      expect(typeCheck).toBeGreaterThanOrEqual(0);
      expect(lines.findIndex(isPrecompile)).toBeGreaterThan(typeCheck);
    }
  });

  /*
   * esbuild takes Foo.js over Foo.ts for a file it reaches through
   * node_modules, as the frontends reach Common: a bundle built after the
   * compile took Common's compiled CommonJS, past the browser stand-ins
   * Common's package.json names by their .ts, and with it the server's
   * packages, and the Enterprise Dashboard's bundle failed. So every bundle
   * is built before the compile.
   */
  test("no step of its build bundles TypeScript after the compile", () => {
    for (const stage of finals) {
      const lines = stagesOfImage(stages, stage).flatMap((built) => {
        return instructions(built.body);
      });
      const compile = lines.findIndex(isPrecompile);
      const bundlesAfter = lines.slice(compile + 1).filter((line) => {
        return BUNDLES.test(line);
      });

      expect(compile).toBeGreaterThanOrEqual(0);
      expect({ stage: stage.name, bundlesAfter }).toEqual({
        stage: stage.name,
        bundlesAfter: [],
      });
    }
  });

  test("ts-node is one of its development packages, never one it runs", () => {
    const manifest = packageJson(server.name);
    expect(Object.keys(manifest.dependencies || {})).not.toContain("ts-node");
    expect(Object.keys(manifest.devDependencies || {})).toContain("ts-node");

    const lock = JSON.parse(read(`packages/${server.name}/package-lock.json`));
    expect(lock.packages[""].dependencies || {}).not.toHaveProperty("ts-node");
    expect(lock.packages[""].devDependencies).toHaveProperty("ts-node");
    expect(lock.packages["node_modules/ts-node"].dev).toBe(true);
  });

  if (server.prunes) {
    test("its prune keeps what PrecompiledSourceMaps.js requires, removes ts-node and TypeScript, and checks that it did", () => {
      for (const stage of finals) {
        const prunes = stagesOfImage(stages, stage)
          .flatMap((built) => {
            return instructions(built.body);
          })
          .filter((line) => {
            return line.includes("PruneUnreachablePackages.js --entry");
          });

        expect({ stage: stage.name, prunes: prunes.length }).toEqual({
          stage: stage.name,
          prunes: 1,
        });
        const prune = prunes[0];
        expect(prune).toContain(PRUNE_ENTRY);
        const omitDev = prune.indexOf(
          "npm prune --omit=dev --offline --no-audit --no-fund",
        );
        expect(omitDev).toBeGreaterThan(0);
        expect(prune.indexOf(TOOLING_GONE)).toBeGreaterThan(omitDev);
      }
    });

    test("its compile comes before the prune that takes TypeScript away", () => {
      for (const stage of finals) {
        const lines = stagesOfImage(stages, stage).flatMap((built) => {
          return instructions(built.body);
        });
        const compile = lines.findIndex(isPrecompile);
        const prune = lines.findIndex((line) => {
          return line.includes("PruneUnreachablePackages.js --entry");
        });
        expect(compile).toBeGreaterThanOrEqual(0);
        expect(prune).toBeGreaterThan(compile);
      }
    });
  }
});

describe("the check after a prune", () => {
  // The check's JavaScript, run against a tree of our own for /usr/src.
  const script = /^node -e "([\s\S]*)"$/.exec(TOOLING_GONE)[1];

  function runIn(tree) {
    return spawnSync(
      process.execPath,
      ["-e", script.split("/usr/src/").join(`${tree}/`)],
      { encoding: "utf8" },
    );
  }

  function makeTree(installed) {
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-pruned-"));
    for (const folder of ["app", "Common"]) {
      fs.mkdirSync(path.join(tree, folder, "node_modules"), {
        recursive: true,
      });
    }
    for (const [folder, name] of installed) {
      const directory = path.join(tree, folder, "node_modules", name);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({ name, main: "index.js" }),
      );
      fs.writeFileSync(path.join(directory, "index.js"), "");
    }
    return tree;
  }

  test.each([
    ["ts-node in the App's packages", [["app", "ts-node"]]],
    ["TypeScript in the App's packages", [["app", "typescript"]]],
    ["TypeScript in Common's packages", [["Common", "typescript"]]],
  ])("fails the build with %s", (_label, installed) => {
    const tree = makeTree(installed);
    try {
      const run = runIn(tree);
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain(
        "is still installed, and the image runs JavaScript",
      );
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  });

  test("passes a tree without them", () => {
    const tree = makeTree([["app", "left-pad"]]);
    try {
      expect(runIn(tree).status).toBe(0);
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  });
});

describe("what the images share", () => {
  test("Common depends on the source-map-support PrecompiledSourceMaps.js requires", () => {
    const common = packageJson("Common");
    const source = read(`packages/${PRECOMPILED_SOURCE_MAPS}`);

    expect(source).toContain('require("@cspotcode/source-map-support")');
    expect(common.dependencies).toHaveProperty("@cspotcode/source-map-support");
  });

  test("the Enterprise image compiles ee/ with the App's tsconfig, after the Enterprise bundles", () => {
    const stages = productionStages("App");
    const lines = buildOrder(stages, "enterprise").flatMap((built) => {
      return instructions(built.body);
    });

    const copy = lines.indexOf("COPY ./ee /usr/src/ee");
    const bundles = lines.findIndex((line) => {
      return line.includes(
        "ONEUPTIME_EDITION=enterprise bash scripts/frontend-run.sh",
      );
    });
    const compile = lines.indexOf(PRECOMPILE_EE);

    expect(copy).toBeGreaterThanOrEqual(0);
    expect(bundles).toBeGreaterThan(copy);
    expect(compile).toBeGreaterThan(bundles);
  });

  test.each(["App", "Probe", "Runner", "Ingress"])(
    "IronBank/%s neither starts ts-node nor sets a TS_NODE_ variable",
    (project) => {
      const lines = instructions(read(`IronBank/${project}/Dockerfile`));
      expect(lines.length).toBeGreaterThan(5);
      for (const line of lines) {
        expect({ project, line }).toEqual({
          project,
          line: expect.not.stringMatching(STARTS_TS_NODE),
        });
      }
    },
  );

  test("the Helm chart starts the server images with their own commands, or the App's migrate script", () => {
    const templates = path.join(
      REPO_ROOT,
      "HelmChart/Public/oneuptime/templates",
    );
    const files = fs.readdirSync(templates).filter((file) => {
      return /\.ya?ml$/.test(file);
    });
    expect(files.length).toBeGreaterThan(10);

    for (const file of files) {
      const text = fs
        .readFileSync(path.join(templates, file), "utf8")
        .split("\n")
        .filter((line) => {
          return !/^\s*#/.test(line);
        })
        .join("\n");
      expect({ file, startsTsNode: STARTS_TS_NODE.test(text) }).toEqual({
        file,
        startsTsNode: false,
      });
    }
    expect(
      read("HelmChart/Public/oneuptime/templates/migrate-job.yaml"),
    ).toContain('command: ["npm", "run", "migrate"]');
  });

  test("docker-compose starts the server images with their own commands", () => {
    for (const file of ["docker-compose.yml", "docker-compose.base.yml"]) {
      expect({ file, startsTsNode: STARTS_TS_NODE.test(read(file)) }).toEqual({
        file,
        startsTsNode: false,
      });
    }
  });

  test("the release workflows' edition check boots the App image's JavaScript", () => {
    const check = read("Scripts/GHA/check_app_image_edition.sh");
    const probe = /PROBE_COMMAND=\(([\s\S]*?)\n\)/.exec(check)[1];

    expect(probe).toContain(`--require ${PRECOMPILED_SOURCE_MAPS}`);
    expect(probe).not.toMatch(STARTS_TS_NODE);
  });
});

/*
 * LoadedModules' check, on a process of this machine that stands in for a
 * server: an entry that requires its modules and stays up.
 */
describe("LoadedModules' check of a running server", () => {
  function freePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        server.close(() => {
          resolve(port);
        });
      });
    });
  }

  /*
   * Starts Index.js in a folder of its own, with these files beside it, and
   * runs the check against it.
   */
  async function check(files) {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-loaded-"),
    );
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(directory, name)), {
        recursive: true,
      });
      fs.writeFileSync(path.join(directory, name), text);
    }
    const entry = path.join(directory, "Index.js");
    const port = await freePort();
    const server = spawn(process.execPath, [`--inspect-port=${port}`, entry], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    try {
      // Up once it says so, with every module it requires loaded.
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.stdout.once("data", resolve);
      });
      const run = spawnSync(process.execPath, ["-e", CHECK_SCRIPT], {
        encoding: "utf8",
        timeout: 60000,
        env: {
          ...process.env,
          LOADED_MODULES_ENTRY: entry,
          LOADED_MODULES_PORT: String(port),
        },
      });
      return { ...parseReport(`${run.stdout}${run.stderr}`), directory };
    } finally {
      server.kill("SIGKILL");
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  test("lists a JavaScript server's modules, and finds no TypeScript", async () => {
    const { report, problem, directory } = await check({
      "Index.js":
        'require("./Helper"); console.log("up"); setInterval(() => {}, 1000);\n',
      "Helper.js": "module.exports = 1;\n",
    });

    expect(problem).toBeNull();
    expect(report.modules).toBe(2);
    expect(report.typeScript).toEqual([]);
    expect(report.tooling).toEqual([]);
    expect(typeof report.pid).toBe("number");
    expect(directory.length).toBeGreaterThan(0);
  });

  test("names the TypeScript a server loaded, and ts-node and TypeScript's compiler", async () => {
    const { report, problem } = await check({
      "Index.js": [
        'require.extensions[".ts"] = require.extensions[".js"];',
        'require("./Module.ts");',
        'require("ts-node");',
        'require("typescript");',
        'console.log("up");',
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
      "Module.ts": "module.exports = 2;\n",
      "node_modules/ts-node/index.js": "module.exports = {};\n",
      "node_modules/typescript/index.js": "module.exports = {};\n",
    });

    expect(problem).toBeNull();
    expect(report.typeScript).toEqual([
      expect.stringMatching(/[\\/]Module\.ts$/),
    ]);
    expect(report.tooling).toEqual([
      expect.stringMatching(/[\\/]node_modules[\\/]ts-node[\\/]index\.js$/),
      expect.stringMatching(/[\\/]node_modules[\\/]typescript[\\/]index\.js$/),
    ]);
  });

  test("refuses an inspector that is another process's (a server on the host's network)", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-loaded-"),
    );
    const entry = path.join(directory, "Index.js");
    fs.writeFileSync(
      entry,
      'console.log("up"); setInterval(() => {}, 1000);\n',
    );
    const otherPort = await freePort();
    const serverPort = await freePort();
    const other = spawn(
      process.execPath,
      [
        `--inspect=127.0.0.1:${otherPort}`,
        "-e",
        'console.log("up"); setInterval(() => {}, 1000);',
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const server = spawn(
      process.execPath,
      [`--inspect-port=${serverPort}`, entry],
      {
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    try {
      await Promise.all(
        [other, server].map((child) => {
          return new Promise((resolve) => {
            child.stdout.once("data", resolve);
          });
        }),
      );
      const run = spawnSync(process.execPath, ["-e", CHECK_SCRIPT], {
        encoding: "utf8",
        timeout: 60000,
        env: {
          ...process.env,
          LOADED_MODULES_ENTRY: entry,
          LOADED_MODULES_PORT: String(otherPort),
        },
      });
      const { report, problem } = parseReport(`${run.stdout}${run.stderr}`);

      expect(report).toBeNull();
      expect(problem).toBe(
        `the inspector on 127.0.0.1:${otherPort} is process ${other.pid}'s, not the server's (${server.pid})`,
      );
    } finally {
      other.kill("SIGKILL");
      server.kill("SIGKILL");
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("says so when no node process runs the entry", () => {
    const run = spawnSync(process.execPath, ["-e", CHECK_SCRIPT], {
      encoding: "utf8",
      timeout: 60000,
      env: {
        ...process.env,
        LOADED_MODULES_ENTRY: "/nowhere/oneuptime-no-such-entry/Index.js",
      },
    });
    const { report, problem } = parseReport(`${run.stdout}${run.stderr}`);

    expect(run.status).toBe(1);
    expect(report).toBeNull();
    expect(problem).toBe(
      "no node process runs /nowhere/oneuptime-no-such-entry/Index.js",
    );
  });
});
