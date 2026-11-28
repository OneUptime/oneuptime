"use strict";

/*
 * The container names of an agent whose docker-compose.yml reads them from
 * .env (#11168, #11434): one suite, run for each agent by its own test file
 * (CephAgentContainerNames.test.js, ...), against the stand-in engine of
 * ComposeNamesEngine.js, which every install of a test shares, as every
 * install on a machine shares one Docker.
 *
 * A first agent is named as it always was. A second one, in a directory of
 * its own, is named after it, its AI agent and sidecars beside its
 * collector, and its re-run and upgrade keep the names. An exported name is
 * kept, and refused when Docker would refuse it or another container holds
 * it. An agent set up before .env held the names keeps the ones it was given
 * by hand. Two directories of one name are one Compose project, so the second
 * is refused before anything is written.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const { agentFilesCurlStub } = require("./AgentFilesCurlStub");
const {
  containersOn,
  engineScript,
  namesOn,
  runContainersAs,
} = require("./ComposeNamesEngine");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const IN_CI = Boolean(process.env["CI"]);

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

// A variable as install.sh wrote it to .env, as Compose reads it back.
function dotenv(envText, name) {
  const line = envText
    .split("\n")
    .filter((candidate) => {
      return candidate.startsWith(`${name}=`);
    })
    .pop();
  if (line === undefined) {
    return undefined;
  }
  const raw = line.slice(name.length + 1);
  if (raw.startsWith("'")) {
    return raw.slice(1, raw.lastIndexOf("'"));
  }
  if (raw.startsWith('"')) {
    return raw
      .slice(1, raw.lastIndexOf('"'))
      .replace(/\\(["\\])/g, "$1")
      .replace(/\$\$/g, "$");
  }
  return raw;
}

// A shell function of a script, as the identity checks compare them.
function shellFunction(script, name) {
  const start = script.indexOf(`\n${name}() {\n`);
  if (start < 0) {
    throw new Error(`no ${name}() in the script`);
  }
  const end = script.indexOf("\n}\n", start);
  return script.slice(start + 1, end + 2);
}

/*
 * spec: {
 *   agentDir, installName, title, noun (a "cluster"), readme (its section),
 *   defaultInstallDir, keepsRecord (an .agent-files.sha256 and backups),
 *   collector: { variable, service, default },
 *   companions: [{ variable, service, default, role }],
 *   env(extra): the variables of a fresh install that asks nothing,
 *   stubs(bin): the agent's own stand-ins (its CLI, its API),
 *   running(): the services a fresh install runs (its profiles),
 * }
 */
function describeAgentContainerNames(spec) {
  const AGENT_DIR = path.join(REPO_ROOT, "agents", spec.agentDir);
  const INSTALL_SCRIPT = path.join(AGENT_DIR, "install.sh");
  const COMPOSE_FILE = path.join(AGENT_DIR, "docker-compose.yml");
  const SERVICES = [spec.collector, ...spec.companions];
  const DEFAULT_DIR_NAME = path.basename(spec.defaultInstallDir);

  const scratchDirs = [];
  afterAll(() => {
    for (const dir of scratchDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  function scratch() {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), `${spec.installName}-names-`),
    );
    scratchDirs.push(dir);
    return dir;
  }

  function stubs(dir) {
    const bin = path.join(dir, "bin");
    if (fs.existsSync(bin)) {
      return bin;
    }
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "docker"), engineScript(), { mode: 0o755 });
    fs.writeFileSync(
      path.join(bin, "curl"),
      agentFilesCurlStub({
        installName: spec.installName,
        agentDirectory: spec.agentDir,
        servedDir: AGENT_DIR,
        extraCases: spec.curlCases || "",
      }),
      { mode: 0o755 },
    );
    if (spec.stubs) {
      spec.stubs(bin, dir);
    }
    return bin;
  }

  // install.sh, into <dir>/<installDirName>, with `env` on top of a fresh install's.
  function install(dir, installDirName, { env = {}, input = "" } = {}) {
    const bin = stubs(dir);
    const installDir = path.join(dir, installDirName);
    const result = spawnSync("bash", [INSTALL_SCRIPT], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir,
        STUB_DIR: dir,
        INSTALL_DIR: installDir,
        ...spec.env(dir),
        ...env,
      },
      input,
      encoding: "utf8",
      timeout: 120000,
    });
    const envText = readIfExists(
      path.join(installDir.replace(/\/+$/, ""), ".env"),
    );
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      installDir: installDir.replace(/\/+$/, ""),
      envText,
      names: Object.fromEntries(
        SERVICES.map((service) => {
          return [service.variable, dotenv(envText, service.variable)];
        }),
      ),
    };
  }

  function expectInstalled(result) {
    expect({ status: result.status, output: result.output }).toEqual({
      status: 0,
      output: expect.any(String),
    });
  }

  // The names install.sh gives an agent whose collector is named `collector`.
  function namesBeside(collector) {
    const names = { [spec.collector.variable]: collector };
    for (const companion of spec.companions) {
      let name;
      if (collector === spec.collector.default) {
        name = companion.default;
      } else if (collector.startsWith(`${spec.collector.default}-`)) {
        name = `${companion.default}${collector.slice(spec.collector.default.length)}`;
      } else {
        name = `${collector}-${companion.role}`;
      }
      names[companion.variable] = name;
    }
    return names;
  }

  // The containers the engine runs for a directory: service -> name.
  function runningIn(dir, installDir) {
    return Object.fromEntries(
      containersOn(dir)
        .filter((container) => {
          return container.dir === installDir;
        })
        .map((container) => {
          return [container.service, container.name];
        }),
    );
  }

  // What the services that run are named, by the names install.sh wrote.
  function expectRunningAs(dir, installDir, names) {
    const expected = Object.fromEntries(
      SERVICES.filter((service) => {
        return spec.running().includes(service.service);
      }).map((service) => {
        return [service.service, names[service.variable]];
      }),
    );
    expect(runningIn(dir, installDir)).toEqual(expected);
  }

  function composeCalls(dir) {
    return readIfExists(path.join(dir, "docker.log"))
      .split("\n")
      .filter((line) => {
        return / \| compose (up|down|pull|rm)\b/.test(line);
      });
  }

  // The docker-compose.yml of a release before .env held the names.
  function shippedBeforeEnvHeldTheNames() {
    let text = fs.readFileSync(COMPOSE_FILE, "utf8");
    for (const service of SERVICES) {
      const before = text;
      text = text.replace(
        `    container_name: \${${service.variable}:-${service.default}}\n`,
        `    container_name: ${service.default}\n`,
      );
      expect(text).not.toBe(before);
    }
    return text;
  }

  // The compose file with these services' names given by hand.
  function renamed(text, names) {
    let edited = text;
    for (const service of SERVICES) {
      if (names[service.variable]) {
        edited = edited.replace(
          `    container_name: ${service.default}\n`,
          `    container_name: ${names[service.variable]}\n`,
        );
      }
    }
    return edited;
  }

  /*
   * An agent install.sh set up before .env held its names: that release's
   * docker-compose.yml, recorded as installed (when the agent keeps a
   * record), an .env without the names; then `edit` made to the compose file
   * and its containers run as it names them (`running`).
   */
  function agentFromBefore(
    dir,
    installDirName,
    { edit = (text) => text, running = true, record = true } = {},
  ) {
    const installed = install(dir, installDirName);
    expectInstalled(installed);
    const shipped = shippedBeforeEnvHeldTheNames();
    const recordFile = path.join(installed.installDir, ".agent-files.sha256");
    if (spec.keepsRecord) {
      if (record) {
        fs.writeFileSync(
          recordFile,
          fs
            .readFileSync(recordFile, "utf8")
            .replace(
              /^[0-9a-f]{64} {2}docker-compose\.yml$/m,
              `${sha256(shipped)}  docker-compose.yml`,
            ),
        );
      } else {
        fs.rmSync(recordFile, { force: true });
      }
    }
    fs.writeFileSync(
      path.join(installed.installDir, ".env"),
      installed.envText
        .split("\n")
        .filter((line) => {
          return !SERVICES.some((service) => {
            return line.startsWith(`${service.variable}=`);
          });
        })
        .join("\n"),
    );
    const edited = edit(shipped);
    fs.writeFileSync(
      path.join(installed.installDir, "docker-compose.yml"),
      edited,
    );
    const parsed = yaml.load(edited).services;
    runContainersAs(
      dir,
      installed.installDir,
      running
        ? Object.fromEntries(
            SERVICES.filter((service) => {
              return spec.running().includes(service.service);
            }).map((service) => {
              return [service.service, parsed[service.service].container_name];
            }),
          )
        : {},
    );
    return { installDir: installed.installDir, shipped, edited };
  }

  function backupsIn(installDir) {
    return fs
      .readdirSync(installDir)
      .filter((file) => {
        return file.includes(".bak.");
      })
      .sort();
  }

  const lab = namesBeside(`${spec.collector.default}-cluster2`);

  describe(`${spec.title} gives each agent on a machine its own container names, and keeps them`, () => {
    test("a first agent, in the default directory, is named as it always was", () => {
      const dir = scratch();
      const first = install(dir, DEFAULT_DIR_NAME);

      expectInstalled(first);
      expect(first.names).toEqual(namesBeside(spec.collector.default));
      expectRunningAs(dir, first.installDir, first.names);
      expect(first.output).not.toContain("named after its directory");
    });

    test(`a second ${spec.noun}'s agent, in a directory of its own, is named after it, and both run`, () => {
      const dir = scratch();
      const first = install(dir, DEFAULT_DIR_NAME);
      expectInstalled(first);
      const before = runningIn(dir, first.installDir);

      const second = install(dir, "cluster2");

      expectInstalled(second);
      expect(second.names).toEqual(lab);
      expectRunningAs(dir, second.installDir, lab);
      // The first agent is as it was.
      expect(runningIn(dir, first.installDir)).toEqual(before);
      expect(second.output).toContain("named after");
    });

    test("their re-runs and an upgrade to newer files keep both agents' names", () => {
      const dir = scratch();
      const first = install(dir, DEFAULT_DIR_NAME);
      const second = install(dir, "cluster2");
      expectInstalled(first);
      expectInstalled(second);

      const again = install(dir, "cluster2");
      expectInstalled(again);
      expect(again.names).toEqual(lab);

      // Newer files: the compose file and the collector config of a later release.
      const newer = path.join(dir, "newer");
      fs.cpSync(AGENT_DIR, newer, { recursive: true });
      fs.appendFileSync(
        path.join(newer, "docker-compose.yml"),
        "# a later release\n",
      );
      const upgraded = install(dir, "cluster2", { env: { SERVE_DIR: newer } });
      expectInstalled(upgraded);
      expect(upgraded.names).toEqual(lab);
      expectRunningAs(dir, upgraded.installDir, lab);

      const firstAgain = install(dir, DEFAULT_DIR_NAME, {
        env: { SERVE_DIR: newer },
      });
      expectInstalled(firstAgain);
      expect(firstAgain.names).toEqual(namesBeside(spec.collector.default));
      expect(Object.keys(namesOn(dir)).sort()).toEqual(
        [
          ...Object.values(runningIn(dir, first.installDir)),
          ...Object.values(runningIn(dir, second.installDir)),
        ].sort(),
      );
    });

    test("a directory named after the agent gives the agent that name", () => {
      const dir = scratch();
      const result = install(dir, `${spec.collector.default}-cluster2`);
      expectInstalled(result);
      expect(result.names).toEqual(lab);
    });

    test("a directory Compose spells otherwise is named as Compose spells it", () => {
      const dir = scratch();
      const result = install(dir, "Ceph Lab (2)");
      expectInstalled(result);
      expect(result.names[spec.collector.variable]).toBe(
        `${spec.collector.default}-cephlab2`,
      );
    });

    test("an exported name is kept, its companions are named beside it, and a re-run keeps them", () => {
      const dir = scratch();
      const exported = install(dir, "east", {
        env: { [spec.collector.variable]: "east-agent" },
      });
      expectInstalled(exported);
      expect(exported.names).toEqual(namesBeside("east-agent"));

      const again = install(dir, "east");
      expectInstalled(again);
      expect(again.names).toEqual(namesBeside("east-agent"));
      expectRunningAs(dir, again.installDir, again.names);
    });

    test("a collector given another name takes the companions named beside it along, but not one chosen", () => {
      const dir = scratch();
      expectInstalled(install(dir, "east"));
      const chosen = spec.companions[0];

      const renamedOnce = install(dir, "east", {
        env: {
          [spec.collector.variable]: "west-agent",
          [chosen.variable]: "my-own-name",
        },
      });
      expectInstalled(renamedOnce);
      expect(renamedOnce.names).toEqual({
        ...namesBeside("west-agent"),
        [chosen.variable]: "my-own-name",
      });

      const renamedAgain = install(dir, "east", {
        env: { [spec.collector.variable]: "north-agent" },
      });
      expectInstalled(renamedAgain);
      expect(renamedAgain.names).toEqual({
        ...namesBeside("north-agent"),
        [chosen.variable]: "my-own-name",
      });
    });

    test.each([["-agent"], ["a"], ["two words"], ["slash/ed"], ["dollar$x"]])(
      "a collector name Docker would refuse (%j) stops it before anything is installed",
      (name) => {
        const dir = scratch();
        const result = install(dir, "cluster2", {
          env: { [spec.collector.variable]: name },
        });

        expect(result.status).toBe(1);
        expect(result.output).toContain(
          `Error: ${spec.collector.variable}="${name}" is not a container name`,
        );
        expect(fs.existsSync(result.installDir)).toBe(false);
        expect(composeCalls(dir)).toEqual([]);
      },
    );

    test.each(spec.companions.map((companion) => [companion.variable]))(
      "a %s Docker would refuse stops it before anything is installed",
      (variable) => {
        const dir = scratch();
        const result = install(dir, "cluster2", {
          env: { [variable]: "bad name" },
        });

        expect(result.status).toBe(1);
        expect(result.output).toContain(
          `Error: ${variable}="bad name" is not a container name`,
        );
        expect(fs.existsSync(result.installDir)).toBe(false);
        expect(composeCalls(dir)).toEqual([]);
      },
    );

    test("a name another container holds stops the start, and the advice it gives works", () => {
      const dir = scratch();
      // Someone else's container, under the name the agent would take.
      runContainersAs(dir, path.join(dir, "someone-else"), {
        app: lab[spec.collector.variable],
      });

      const refused = install(dir, "cluster2");
      expect(refused.status).toBe(1);
      expect(refused.output).toContain(
        `"/${lab[spec.collector.variable]}" is already in use`,
      );
      expect(refused.output).toContain(
        "give this agent names of its own and run this",
      );
      expect(refused.output).toContain(
        `INSTALL_DIR=${refused.installDir} bash install.sh`,
      );

      const advised = install(dir, "cluster2", {
        env: {
          [spec.collector.variable]: `${spec.collector.default}-cluster2b`,
        },
      });
      expectInstalled(advised);
      expect(advised.names).toEqual(
        namesBeside(`${spec.collector.default}-cluster2b`),
      );
    });

    test("hands Compose none of the names from the shell: .env alone names the containers", () => {
      const dir = scratch();
      const result = install(dir, "east", {
        env: { [spec.collector.variable]: "east-agent" },
      });
      expectInstalled(result);
      const seen = readIfExists(path.join(dir, "docker.log"))
        .split("\n")
        .filter((line) => {
          return line.startsWith("compose up sees:");
        });
      expect(seen.length).toBeGreaterThan(0);
      for (const line of seen) {
        expect(line).toBe("compose up sees: ");
      }
    });
  });

  describe(`${spec.title} keeps the names of an agent set up before .env held them`, () => {
    const handNamed = namesBeside("handmade-agent");
    const handNames = Object.fromEntries(
      SERVICES.map((service) => {
        return [service.variable, `${handNamed[service.variable]}-x`];
      }),
    );

    test("given by hand in docker-compose.yml, and running so", () => {
      const dir = scratch();
      expectInstalled(install(dir, DEFAULT_DIR_NAME));
      const old = agentFromBefore(dir, "cluster2", {
        edit: (text) => renamed(text, handNames),
      });

      const upgraded = install(dir, "cluster2");

      expectInstalled(upgraded);
      expect(upgraded.names).toEqual(handNames);
      expectRunningAs(dir, old.installDir, handNames);
      expect(upgraded.output).toContain("keep their names");
      if (spec.keepsRecord) {
        expect(upgraded.output).toContain("so there is nothing to make again");
        expect(upgraded.output).not.toContain("You had edited these files");
        expect(upgraded.output).not.toContain(
          "NOTE: you had edited these files",
        );
        const backups = backupsIn(old.installDir).filter((file) => {
          return file.startsWith("docker-compose.yml.bak.");
        });
        expect(backups).toHaveLength(1);
        expect(
          fs.readFileSync(path.join(old.installDir, backups[0]), "utf8"),
        ).toBe(old.edited);
      }
    });

    if (spec.keepsRecord) {
      test("with other edits besides, which are listed as before, and say to leave the names alone", () => {
        const dir = scratch();
        const old = agentFromBefore(dir, "cluster2", {
          edit: (text) => `${renamed(text, handNames)}# an edit of my own\n`,
        });

        const upgraded = install(dir, "cluster2");

        expectInstalled(upgraded);
        expect(upgraded.names).toEqual(handNames);
        expect(upgraded.output).toMatch(/you had edited these files/i);
        expect(upgraded.output).toContain(
          `${old.installDir}/docker-compose.yml.bak.`,
        );
        expect(upgraded.output).toContain(
          "leave their container_name lines as they are",
        );
      });

      test("after an older upgrade put the default names back: from the newest copy it kept that names them", () => {
        const dir = scratch();
        const old = agentFromBefore(dir, "cluster2", { running: false });
        fs.writeFileSync(
          path.join(old.installDir, "docker-compose.yml.bak.20260101000000"),
          renamed(old.shipped, namesBeside("older-agent")),
        );
        fs.writeFileSync(
          path.join(old.installDir, "docker-compose.yml.bak.20260201000000"),
          renamed(old.shipped, handNames),
        );

        const upgraded = install(dir, "cluster2");

        expectInstalled(upgraded);
        expect(upgraded.names).toEqual(handNames);
      });

      test("with no record of what install.sh installed: kept, and the old file kept as one that differs", () => {
        const dir = scratch();
        const old = agentFromBefore(dir, "cluster2", {
          edit: (text) => renamed(text, handNames),
          record: false,
        });

        const upgraded = install(dir, "cluster2");

        expectInstalled(upgraded);
        expect(upgraded.names).toEqual(handNames);
        expect(upgraded.output).toContain(
          `${old.installDir}/docker-compose.yml.bak.`,
        );
      });
    }

    test("from the containers it runs, when its docker-compose.yml names them no more", () => {
      const dir = scratch();
      const old = agentFromBefore(dir, "cluster2");
      runContainersAs(
        dir,
        old.installDir,
        Object.fromEntries(
          SERVICES.filter((service) => {
            return spec.running().includes(service.service);
          }).map((service) => {
            return [service.service, handNames[service.variable]];
          }),
        ),
      );

      const upgraded = install(dir, "cluster2");

      expectInstalled(upgraded);
      for (const service of SERVICES.filter((candidate) => {
        return spec.running().includes(candidate.service);
      })) {
        expect(upgraded.names[service.variable]).toBe(
          handNames[service.variable],
        );
      }
    });

    test("an old first agent in a folder of its own, running under the default names, keeps them", () => {
      const dir = scratch();
      const old = agentFromBefore(dir, "elsewhere");

      const upgraded = install(dir, "elsewhere");

      expectInstalled(upgraded);
      expect(upgraded.names).toEqual(namesBeside(spec.collector.default));
      expectRunningAs(dir, old.installDir, upgraded.names);
    });
  });

  describe(`${spec.title} refuses a directory whose Compose project another directory runs`, () => {
    test("a folder of the same name elsewhere is refused before anything is written, and the first agent runs on", () => {
      const dir = scratch();
      const first = install(dir, "prod/agent");
      expectInstalled(first);
      const before = runningIn(dir, first.installDir);
      fs.writeFileSync(path.join(dir, "docker.log"), "");

      const second = install(dir, "staging/agent");

      expect(second.status).toBe(1);
      expect(second.output).toContain(
        `Error: ${first.installDir} already runs containers in the Docker Compose project`,
      );
      expect(second.output).toContain(
        `INSTALL_DIR=${second.installDir}-2 bash install.sh`,
      );
      expect(fs.existsSync(second.installDir)).toBe(false);
      expect(composeCalls(dir)).toEqual([]);
      expect(runningIn(dir, first.installDir)).toEqual(before);

      // Following the advice works.
      const advised = install(dir, "staging/agent-2");
      expectInstalled(advised);
    });

    test("the agent's own folder is its own, through a symlink or with a trailing /", () => {
      const dir = scratch();
      // Installed through /alias/agent, a symlink to /real/agent: Compose
      // records the path it was given.
      fs.mkdirSync(path.join(dir, "real", "agent"), { recursive: true });
      fs.mkdirSync(path.join(dir, "alias"));
      fs.symlinkSync(
        path.join(dir, "real", "agent"),
        path.join(dir, "alias", "agent"),
      );
      const first = install(dir, "alias/agent");
      expectInstalled(first);

      const byItsRealPath = install(dir, "real/agent");
      expectInstalled(byItsRealPath);
      expect(byItsRealPath.output).not.toContain("already runs containers");

      const withASlash = install(dir, "real/agent/");
      expectInstalled(withASlash);
      expect(withASlash.output).not.toContain("already runs containers");
    });

    test("a moved agent's leftovers, whose folder is gone, are this install's to replace", () => {
      const dir = scratch();
      runContainersAs(dir, path.join(dir, "gone", "agent"), {
        [spec.collector.service]: spec.collector.default,
      });

      const result = install(dir, "agent");

      expectInstalled(result);
      expect(result.output).not.toContain("already runs containers");
    });

    test("COMPOSE_PROJECT_NAME names the project, as Compose has it", () => {
      const dir = scratch();
      expectInstalled(
        install(dir, "one", { env: { COMPOSE_PROJECT_NAME: "shared" } }),
      );

      const second = install(dir, "two", {
        env: { COMPOSE_PROJECT_NAME: "shared" },
      });

      expect(second.status).toBe(1);
      expect(second.output).toContain('Docker Compose project\n"shared"');
    });
  });

  describe(`${spec.title}, as written`, () => {
    const script = fs.readFileSync(INSTALL_SCRIPT, "utf8");
    const storageArray = fs.readFileSync(
      path.join(REPO_ROOT, "agents/StorageArrayAgent/install.sh"),
      "utf8",
    );

    test("its name and project helpers are the Storage Array and XCP-ng agents', for its own service and names", () => {
      for (const name of [
        "is_container_name",
        "compose_container_name",
        "existing_container_name",
        "backup_container_name",
        "directory_container_name",
        "absolute_install_dir",
        "compose_project_name",
        "same_directory",
        "other_project_directory",
      ]) {
        expect(shellFunction(script, name)).toBe(
          shellFunction(storageArray, name),
        );
      }
      expect(
        shellFunction(script, "choose_container_name").replaceAll(
          spec.collector.variable,
          "STORAGE_ARRAY_AGENT_CONTAINER_NAME",
        ),
      ).toBe(shellFunction(storageArray, "choose_container_name"));
      expect(script).toContain(`AGENT_SERVICE="${spec.collector.service}"`);
      expect(script).toContain(
        `DEFAULT_CONTAINER_NAME="${spec.collector.default}"`,
      );
    });

    test("its companion helpers are every other agent's with companions", () => {
      const others = [
        "CephAgent",
        "ProxmoxAgent",
        "VMwareAgent",
        "OpenStackAgent",
      ]
        .filter((agent) => {
          return agent !== spec.agentDir;
        })
        .map((agent) => {
          return fs.readFileSync(
            path.join(REPO_ROOT, "agents", agent, "install.sh"),
            "utf8",
          );
        });
      for (const name of [
        "exported_container_names",
        "kept_container_name",
        "companion_container_name_for",
        "choose_companion_container_names",
      ]) {
        for (const other of others) {
          expect(shellFunction(script, name)).toBe(shellFunction(other, name));
        }
      }
    });

    test("lists every container of docker-compose.yml, and the compose file reads each one's name from .env", () => {
      const companions = script.match(/^COMPANION_CONTAINERS="([^"]*)"$/m);
      expect(companions).not.toBeNull();
      expect(companions[1].split("\n")).toEqual(
        spec.companions.map((companion) => {
          return `${companion.variable}|${companion.service}|${companion.default}|${companion.role}`;
        }),
      );
      const services = yaml.load(
        fs.readFileSync(COMPOSE_FILE, "utf8"),
      ).services;
      expect(Object.keys(services).sort()).toEqual(
        SERVICES.map((service) => {
          return service.service;
        }).sort(),
      );
      for (const service of SERVICES) {
        expect(services[service.service].container_name).toBe(
          `\${${service.variable}:-${service.default}}`,
        );
      }
    });

    test("keeps every name in .env, as it does every other value", () => {
      for (const service of SERVICES) {
        expect(script).toContain(
          `${service.variable}=$(compose_env_quote "$${service.variable}")\n`,
        );
      }
    });
  });

  // The real Docker Compose, rendering what install.sh wrote: nothing is started.
  const probe = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  });
  const canRender = (!probe.error && probe.status === 0) || IN_CI;

  describe(`${spec.title}: the real Docker Compose names the containers as .env says`, () => {
    (canRender ? test : test.skip)(
      "a first agent and a second, each under its own names",
      () => {
        const dir = scratch();
        const first = install(dir, DEFAULT_DIR_NAME);
        const second = install(dir, "cluster2");
        expectInstalled(first);
        expectInstalled(second);

        for (const installed of [first, second]) {
          const rendered = spawnSync(
            "docker",
            ["compose", "--profile", "*", "config", "--format", "json"],
            {
              cwd: installed.installDir,
              env: { PATH: process.env.PATH, HOME: installed.installDir },
              encoding: "utf8",
              timeout: 60000,
            },
          );
          expect(rendered.stderr).not.toMatch(/error/i);
          expect(rendered.status).toBe(0);
          const services = JSON.parse(rendered.stdout).services;
          for (const service of SERVICES) {
            expect({
              service: service.service,
              name: services[service.service].container_name,
            }).toEqual({
              service: service.service,
              name: installed.names[service.variable],
            });
          }
        }
      },
    );
  });

  return { install, scratch, namesBeside, runningIn };
}

module.exports = { describeAgentContainerNames, dotenv, shellFunction };
