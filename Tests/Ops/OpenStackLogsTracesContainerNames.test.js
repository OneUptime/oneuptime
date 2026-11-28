/*
 * The OpenStack agent's logs and traces collectors read their container
 * names from .env (#11434): install-logs.sh (the files profile) and
 * install-traces.sh (the docker profile), against the stand-in engine of
 * Utils/ComposeNamesEngine.js. One of each runs on a machine, under its
 * default name; another one there, in a directory of its own, has a name of
 * its own, which a re-run and an upgrade keep, as one given by hand to a
 * collector set up before .env held it.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const { agentFilesCurlStub } = require("./Utils/AgentFilesCurlStub");
const {
  containersOn,
  engineScript,
  runContainersAs,
} = require("./Utils/ComposeNamesEngine");
const { dotenv, shellFunction } = require("./Utils/AgentContainerNamesSuite");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "OpenStackAgent");
const IN_CI = Boolean(process.env["CI"]);

const COLLECTORS = [
  {
    what: "logs",
    script: "install-logs.sh",
    args: ["files"],
    composeFile: "docker-compose.logs.yml",
    service: "oneuptime-openstack-logs",
    variable: "OPENSTACK_LOGS_CONTAINER_NAME",
    defaultDir: "oneuptime-openstack-logs",
  },
  {
    what: "traces",
    script: "install-traces.sh",
    args: ["docker"],
    composeFile: "docker-compose.traces.yml",
    service: "oneuptime-openstack-traces",
    variable: "OPENSTACK_TRACES_CONTAINER_NAME",
    defaultDir: "oneuptime-openstack-traces",
  },
];

const scratchDirs = [];
afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function scratch() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "openstack-collector-names-"),
  );
  scratchDirs.push(dir);
  return dir;
}

function stubs(dir) {
  const bin = path.join(dir, "bin");
  if (!fs.existsSync(bin)) {
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "docker"), engineScript(), { mode: 0o755 });
    fs.writeFileSync(
      path.join(bin, "curl"),
      agentFilesCurlStub({
        installName: "openstack-agent",
        agentDirectory: "OpenStackAgent",
        servedDir: AGENT_DIR,
      }),
      { mode: 0o755 },
    );
  }
  return bin;
}

describe.each(COLLECTORS)("agents/OpenStackAgent/$script", (collector) => {
  function install(dir, installDirName, { env = {} } = {}) {
    const bin = stubs(dir);
    const installDir = path.join(dir, installDirName);
    const result = spawnSync(
      "bash",
      [path.join(AGENT_DIR, collector.script), ...collector.args],
      {
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          HOME: dir,
          STUB_DIR: dir,
          INSTALL_DIR: installDir,
          ONEUPTIME_URL: "https://oneuptime.example.com",
          ONEUPTIME_TELEMETRY_INGESTION_KEY:
            "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11",
          OPENSTACK_CLOUD_NAME: "prod",
          OPENSTACK_REGION_NAME: "RegionOne",
          OPENSTACK_NODE_NAME: "compute-1",
          ...env,
        },
        encoding: "utf8",
        timeout: 120000,
      },
    );
    const envText = (() => {
      try {
        return fs.readFileSync(path.join(installDir, ".env"), "utf8");
      } catch {
        return "";
      }
    })();
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      installDir,
      name: dotenv(envText, collector.variable),
    };
  }

  function runningIn(dir, installDir) {
    return containersOn(dir)
      .filter((container) => {
        return container.dir === installDir;
      })
      .map((container) => {
        return container.name;
      });
  }

  function composeCalls(dir) {
    let log = "";
    try {
      log = fs.readFileSync(path.join(dir, "docker.log"), "utf8");
    } catch {
      return [];
    }
    return log.split("\n").filter((line) => {
      return / \| compose -f \S+ (up|down|pull|rm)\b/.test(line);
    });
  }

  test("a first one, in the default directory, is named as it always was", () => {
    const dir = scratch();
    const first = install(dir, collector.defaultDir);
    expect(first.status).toBe(0);
    expect(first.name).toBe(collector.service);
    expect(runningIn(dir, first.installDir)).toEqual([collector.service]);
  });

  test("another one on the machine, in a directory of its own, is named after it, and both run, again after a re-run and an upgrade", () => {
    const dir = scratch();
    const first = install(dir, collector.defaultDir);
    const second = install(dir, "node2");
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(second.name).toBe(`${collector.service}-node2`);
    expect(runningIn(dir, second.installDir)).toEqual([
      `${collector.service}-node2`,
    ]);
    expect(runningIn(dir, first.installDir)).toEqual([collector.service]);

    const again = install(dir, "node2");
    expect(again.status).toBe(0);
    expect(again.name).toBe(`${collector.service}-node2`);

    const newer = path.join(dir, "newer");
    fs.cpSync(AGENT_DIR, newer, { recursive: true });
    fs.appendFileSync(
      path.join(newer, collector.composeFile),
      "# a later release\n",
    );
    const upgraded = install(dir, "node2", { env: { SERVE_DIR: newer } });
    expect(upgraded.status).toBe(0);
    expect(upgraded.name).toBe(`${collector.service}-node2`);
    expect(runningIn(dir, first.installDir)).toEqual([collector.service]);
  });

  test("an exported name is kept, and a re-run keeps it; Compose reads it from .env alone", () => {
    const dir = scratch();
    const exported = install(dir, "node2", {
      env: { [collector.variable]: "my-collector" },
    });
    expect(exported.status).toBe(0);
    expect(exported.name).toBe("my-collector");
    const again = install(dir, "node2");
    expect(again.name).toBe("my-collector");
    expect(runningIn(dir, again.installDir)).toEqual(["my-collector"]);
    for (const line of fs
      .readFileSync(path.join(dir, "docker.log"), "utf8")
      .split("\n")
      .filter((candidate) => {
        return candidate.startsWith("compose up sees:");
      })) {
      expect(line).toBe("compose up sees: ");
    }
  });

  test.each([["-x"], ["a"], ["two words"], ["slash/ed"]])(
    "a name Docker would refuse (%j) stops it before anything is installed",
    (name) => {
      const dir = scratch();
      const result = install(dir, "node2", {
        env: { [collector.variable]: name },
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain(
        `Error: ${collector.variable}="${name}" is not a container name`,
      );
      expect(fs.existsSync(result.installDir)).toBe(false);
      expect(composeCalls(dir)).toEqual([]);
    },
  );

  test("a name another container holds stops the start, and the advice it gives works", () => {
    const dir = scratch();
    runContainersAs(dir, path.join(dir, "someone-else"), {
      app: `${collector.service}-node2`,
    });
    const refused = install(dir, "node2");
    expect(refused.status).toBe(1);
    expect(refused.output).toContain(
      `"/${collector.service}-node2" is already in use`,
    );
    expect(refused.output).toContain(
      `${collector.variable}=${collector.service}-2 INSTALL_DIR=${refused.installDir} bash ${collector.script}`,
    );

    const advised = install(dir, "node2", {
      env: { [collector.variable]: `${collector.service}-2` },
    });
    expect(advised.status).toBe(0);
  });

  test("one set up before .env held its name keeps the name its compose file was given by hand", () => {
    const dir = scratch();
    const installed = install(dir, "node2");
    expect(installed.status).toBe(0);
    // The release before: the name written out, given another by hand, and no name in .env.
    const composePath = path.join(installed.installDir, collector.composeFile);
    fs.writeFileSync(
      composePath,
      fs
        .readFileSync(composePath, "utf8")
        .replace(
          `\${${collector.variable}:-${collector.service}}`,
          "hand-named",
        ),
    );
    const envPath = path.join(installed.installDir, ".env");
    fs.writeFileSync(
      envPath,
      fs
        .readFileSync(envPath, "utf8")
        .split("\n")
        .filter((line) => {
          return !line.startsWith(`${collector.variable}=`);
        })
        .join("\n"),
    );
    runContainersAs(dir, installed.installDir, {
      [collector.service]: "hand-named",
    });

    const upgraded = install(dir, "node2");
    expect(upgraded.status).toBe(0);
    expect(upgraded.name).toBe("hand-named");
  });

  test("one in a directory of its own that runs under the default name keeps it", () => {
    const dir = scratch();
    const installed = install(dir, "elsewhere");
    expect(installed.status).toBe(0);
    const envPath = path.join(installed.installDir, ".env");
    fs.writeFileSync(
      envPath,
      fs
        .readFileSync(envPath, "utf8")
        .split("\n")
        .filter((line) => {
          return !line.startsWith(`${collector.variable}=`);
        })
        .join("\n"),
    );
    runContainersAs(dir, installed.installDir, {
      [collector.service]: collector.service,
    });

    const upgraded = install(dir, "elsewhere");
    expect(upgraded.status).toBe(0);
    expect(upgraded.name).toBe(collector.service);
  });

  test("a directory whose Compose project another directory runs is refused before anything is written", () => {
    const dir = scratch();
    const first = install(dir, "a/collector");
    expect(first.status).toBe(0);
    fs.writeFileSync(path.join(dir, "docker.log"), "");

    const second = install(dir, "b/collector");

    expect(second.status).toBe(1);
    expect(second.output).toContain(
      `Error: ${first.installDir} already runs containers in the Docker Compose project`,
    );
    expect(second.output).toContain(
      `INSTALL_DIR=${second.installDir}-2 bash ${collector.script}`,
    );
    expect(fs.existsSync(second.installDir)).toBe(false);
    expect(composeCalls(dir)).toEqual([]);
    expect(runningIn(dir, first.installDir)).toEqual([
      `${collector.service}-collector`,
    ]);
  });

  test("its compose file reads the name from .env", () => {
    const compose = yaml.load(
      fs.readFileSync(path.join(AGENT_DIR, collector.composeFile), "utf8"),
    );
    expect(compose.services[collector.service].container_name).toBe(
      `\${${collector.variable}:-${collector.service}}`,
    );
  });

  test("its helpers are install.sh's, and its chooser and alias the other collector's", () => {
    const script = fs.readFileSync(
      path.join(AGENT_DIR, collector.script),
      "utf8",
    );
    const main = fs.readFileSync(path.join(AGENT_DIR, "install.sh"), "utf8");
    const other = fs.readFileSync(
      path.join(
        AGENT_DIR,
        collector.what === "logs" ? "install-traces.sh" : "install-logs.sh",
      ),
      "utf8",
    );
    for (const name of [
      "is_container_name",
      "compose_container_name",
      "directory_container_name",
      "absolute_install_dir",
      "compose_project_name",
      "same_directory",
      "other_project_directory",
    ]) {
      expect(shellFunction(script, name)).toBe(shellFunction(main, name));
    }
    for (const name of ["choose_collector_container_name", "dotenv_get"]) {
      expect(shellFunction(script, name)).toBe(shellFunction(other, name));
    }
    expect(script).toContain(`AGENT_SERVICE="${collector.service}"`);
    expect(script).toContain(`COMPOSE_FILE_NAME="${collector.composeFile}"`);
  });

  const probe = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  });
  const canRender = (!probe.error && probe.status === 0) || IN_CI;
  (canRender ? test : test.skip)(
    "the real Docker Compose names the container as .env says",
    () => {
      const dir = scratch();
      const second = install(dir, "node2");
      expect(second.status).toBe(0);
      const rendered = spawnSync(
        "docker",
        ["compose", "-f", collector.composeFile, "config", "--format", "json"],
        {
          cwd: second.installDir,
          env: { PATH: process.env.PATH, HOME: second.installDir },
          encoding: "utf8",
          timeout: 60000,
        },
      );
      expect(rendered.status).toBe(0);
      expect(
        JSON.parse(rendered.stdout).services[collector.service].container_name,
      ).toBe(`${collector.service}-node2`);
    },
  );
});
