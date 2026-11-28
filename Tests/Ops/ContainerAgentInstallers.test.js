"use strict";

/**
 * The Docker, Podman and Docker Swarm agents' install.sh, run for real in a
 * scratch directory with `docker`, `podman` and `curl` replaced by recording
 * stubs (no daemon or network needed), for what they hand the collector:
 *
 *  - DOCKER_API_VERSION. The images and compose files leave it empty, so the
 *    collector negotiates the version with the daemon: a pinned 1.44 made
 *    Docker Engine 20.10 to 24 refuse the receiver ("client version 1.44 is
 *    too new") and the agent restart-looped. A version the user sets when
 *    running the script reaches the collector; none set, none is passed.
 *  - Podman's socket and storage. The Podman installer accepted rootless
 *    Podman, then mounted the rootful socket and storage, which a rootless
 *    user does not have: the collector could not start. It now mounts what
 *    the Podman it runs as reports (with the rootless defaults when Podman
 *    does not say), and stops with the command that turns the socket on.
 *  - The Swarm node's name. Swarm labels a task with its node's ID only, so
 *    the Swarm installer writes the node's hostname into .env as
 *    DOCKER_SWARM_NODE_NAME, which the collector stamps on the node's
 *    container metrics (ContainerAgentConfigs.test.js reads that config).
 *
 * ContainerAgentAiInstallers.test.js covers the AI agent the same scripts
 * install.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { agentFilesCurlStub } = require("./Utils/AgentFilesCurlStub");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENTS_DIR = path.join(REPO_ROOT, "agents");
const SWARM_DIR = path.join(AGENTS_DIR, "DockerSwarmAgent");

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "container-install-"));
  scratchDirs.push(dir);
  return dir;
}

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

/*
 * `docker` / `podman` record every call. `info --format` answers the format
 * asked from the STUB_* variables: the swarm manager check, the daemon's
 * name, and Podman's rootless flag, API socket (and whether it is there)
 * and storage. An unset STUB_* variable makes Podman say nothing, as an
 * older Podman may. `run` saves the arguments of each container it starts.
 * `curl` serves the Swarm agent's files from this checkout, as the OneUptime
 * the agent reports to serves them (Utils/AgentFilesCurlStub).
 */
function installStubs(dir) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);

  const engine = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/engine.log"
case "$1" in
  ps)
    exit 0
    ;;
  info)
    if [ "$2" = "--format" ]; then
      case "$3" in
        *Swarm.LocalNodeState*) printf '%s\\n' "active true" ;;
        '{{.Name}}') printf '%s\\n' "\${STUB_NODE_NAME-}" ;;
        *Security.Rootless*) printf '%s\\n' "\${STUB_ROOTLESS-}" ;;
        *RemoteSocket.Path*) printf '%s\\n' "\${STUB_SOCKET-}" ;;
        *RemoteSocket.Exists*) printf '%s\\n' "\${STUB_SOCKET_EXISTS-}" ;;
        *Store.GraphRoot*) printf '%s\\n' "\${STUB_GRAPHROOT-}" ;;
      esac
    fi
    exit 0
    ;;
  run)
    # The collector's validate over the agent's config (issue #11225):
    # recorded, and answered as STUB_VALIDATE_EXIT and _OUTPUT say.
    if printf '%s\\n' "$@" | grep -qx validate; then
      printf '%s\\n' "$@" > "$STUB_DIR/run-validate.args"
      [ -n "\${STUB_VALIDATE_OUTPUT-}" ] && printf '%s\\n' "$STUB_VALIDATE_OUTPUT"
      exit "\${STUB_VALIDATE_EXIT:-0}"
    fi
    printf '%s\\n' "$@" > "$STUB_DIR/run-$(printf '%s' "$*" | sed -n 's/.*--name \\([^ ]*\\).*/\\1/p').args"
    exit 0
    ;;
  compose)
    # The Swarm agent's Compose config check, run before anything changes.
    if printf '%s\\n' "$@" | grep -q -- '-config-check$'; then
      [ -n "\${STUB_VALIDATE_OUTPUT-}" ] && printf '%s\\n' "$STUB_VALIDATE_OUTPUT"
      exit "\${STUB_VALIDATE_EXIT:-0}"
    fi
    exit 0
    ;;
esac
exit 0
`;

  writeExecutable(path.join(bin, "docker"), engine);
  writeExecutable(path.join(bin, "podman"), engine);
  writeExecutable(
    path.join(bin, "curl"),
    agentFilesCurlStub({
      installName: "docker-swarm-agent",
      agentDirectory: "DockerSwarmAgent",
      servedDir: SWARM_DIR,
    }),
  );

  return bin;
}

function run(shell, script, env, input) {
  const dir = scratch();
  const bin = installStubs(dir);
  const result = spawnSync(shell, [script], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: path.join(dir, "home"),
      STUB_DIR: dir,
      ONEUPTIME_URL: "https://oneuptime.example.com",
      ONEUPTIME_SERVICE_TOKEN: "ingest-key",
      ONEUPTIME_INSTALL_AI_AGENT: "true",
      ...env,
    },
    input: input || "",
    encoding: "utf8",
  });

  return {
    dir,
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    // The arguments `run` started a container with, one per line, or null.
    runArgs: (name) => {
      const file = path.join(dir, `run-${name}.args`);
      return fs.existsSync(file)
        ? fs.readFileSync(file, "utf8").split("\n")
        : null;
    },
  };
}

// The values of one flag (`-e`, `-v`) in a container's run arguments.
function flagValues(args, flag) {
  const values = [];

  args.forEach((arg, index) => {
    if (arg === flag && index + 1 < args.length) {
      values.push(args[index + 1]);
    }
  });

  return values;
}

const DOCKER_AND_PODMAN = [
  {
    agent: "DockerAgent",
    collector: "oneuptime-docker-agent",
    aiAgent: "oneuptime-docker-ai-agent",
    env: { DOCKER_HOST_NAME: "web-1" },
  },
  {
    agent: "PodmanAgent",
    collector: "oneuptime-podman-agent",
    aiAgent: "oneuptime-podman-ai-agent",
    env: {
      PODMAN_HOST_NAME: "web-1",
      STUB_ROOTLESS: "false",
      STUB_SOCKET: "/run/podman/podman.sock",
      STUB_SOCKET_EXISTS: "true",
      STUB_GRAPHROOT: "/var/lib/containers/storage",
    },
  },
];

describe.each(DOCKER_AND_PODMAN)(
  "$agent install.sh: the Docker API version",
  ({ agent, collector, aiAgent, env }) => {
    const script = path.join(AGENTS_DIR, agent, "install.sh");

    test("none set: none is passed, and the image's empty default negotiates", () => {
      const result = run("bash", script, env);

      expect(result.status).toBe(0);

      for (const name of [collector, aiAgent]) {
        const variables = flagValues(result.runArgs(name), "-e");
        expect({
          name,
          pinned: variables.filter((value) => {
            return value.startsWith("DOCKER_API_VERSION");
          }),
        }).toEqual({ name, pinned: [] });
      }
    });

    test("one set when running the script reaches the collector, and the AI agent", () => {
      const result = run("bash", script, {
        ...env,
        DOCKER_API_VERSION: "1.41",
      });

      expect(result.status).toBe(0);

      for (const name of [collector, aiAgent]) {
        expect(flagValues(result.runArgs(name), "-e")).toContain(
          "DOCKER_API_VERSION=1.41",
        );
      }
    });

    test("the image is the last argument, after every variable", () => {
      const result = run("bash", script, {
        ...env,
        DOCKER_API_VERSION: "1.41",
      });
      const args = result.runArgs(collector).filter((arg) => {
        return arg.length > 0;
      });

      expect(args[args.length - 1]).toMatch(
        /^oneuptime\/(docker|podman)-agent:release$/,
      );
    });
  },
);

/*
 * Log operators of your own (issue #11225): ONEUPTIME_LOG_OPERATOR_1 to _5,
 * each one collector operator as JSON. A set one is run through the
 * collector's own validate, in the agent's image and with the agent's
 * settings, before the agent you have is touched; a bad one stops the script
 * with the collector's message, so no agent restarts forever on it.
 */
const INHOUSE_OPERATOR =
  '{"type":"regex_parser","id":"inhouse-level","regex":"^<<(?P<severity_text>[DIWEF])>> "}';
const ROUTER_OPERATOR =
  '{"type":"router","id":"sev-route","routes":[{"output":"severity-router","expr":"body matches \\"^SEV1 \\""}],"default":"severity-router"}';

describe.each(DOCKER_AND_PODMAN)(
  "$agent install.sh: log operators of your own",
  ({ agent, collector, aiAgent, env }) => {
    const script = path.join(AGENTS_DIR, agent, "install.sh");
    const validateArgs = (result) => {
      const file = path.join(result.dir, "run-validate.args");

      return fs.existsSync(file)
        ? fs.readFileSync(file, "utf8").split("\n")
        : null;
    };
    const operatorsIn = (args) => {
      return flagValues(args, "-e").filter((value) => {
        return value.startsWith("ONEUPTIME_LOG_OPERATOR_");
      });
    };

    test("none set: nothing is checked, and none is passed", () => {
      const result = run("bash", script, env);

      expect(result.status).toBe(0);
      expect(validateArgs(result)).toBeNull();
      expect(operatorsIn(result.runArgs(collector))).toEqual([]);
    });

    test("set ones are checked by the collector's validate, then passed to the collector alone", () => {
      const result = run("bash", script, {
        ...env,
        ONEUPTIME_LOG_OPERATOR_1: INHOUSE_OPERATOR,
        ONEUPTIME_LOG_OPERATOR_3: ROUTER_OPERATOR,
      });
      const check = validateArgs(result).filter((arg) => {
        return arg.length > 0;
      });

      expect(result.status).toBe(0);
      expect(result.output).toContain(
        "The collector accepts your 2 log operator(s).",
      );
      // In the agent's image, over the config it ships, with its settings.
      expect(check.slice(-3)).toEqual([
        expect.stringMatching(/^oneuptime\/(docker|podman)-agent:release$/),
        "validate",
        "--config=/etc/otelcol-contrib/config.yaml",
      ]);
      expect(check).toContain("--rm");
      expect(operatorsIn(check)).toEqual([
        `ONEUPTIME_LOG_OPERATOR_1=${INHOUSE_OPERATOR}`,
        `ONEUPTIME_LOG_OPERATOR_3=${ROUTER_OPERATOR}`,
      ]);
      expect(flagValues(check, "-e")).toContain(
        "ONEUPTIME_URL=https://oneuptime.example.com",
      );
      expect(operatorsIn(result.runArgs(collector))).toEqual([
        `ONEUPTIME_LOG_OPERATOR_1=${INHOUSE_OPERATOR}`,
        `ONEUPTIME_LOG_OPERATOR_3=${ROUTER_OPERATOR}`,
      ]);
      expect(operatorsIn(result.runArgs(aiAgent))).toEqual([]);
    });

    test("an empty one is not passed, as the collector would stop on it", () => {
      const result = run("bash", script, {
        ...env,
        ONEUPTIME_LOG_OPERATOR_2: "",
      });

      expect(result.status).toBe(0);
      expect(validateArgs(result)).toBeNull();
      expect(operatorsIn(result.runArgs(collector))).toEqual([]);
    });

    test("one the collector refuses stops the install, with its message, and leaves the agent you have", () => {
      const result = run("bash", script, {
        ...env,
        ONEUPTIME_LOG_OPERATOR_1:
          '{"type":"regex_parser","regex":"^(?P<severity_text>[A-Z"}',
        STUB_VALIDATE_EXIT: "1",
        STUB_VALIDATE_OUTPUT:
          'Error: failed to build pipelines: failed to create "filelog" receiver for data type "logs": compiling regex: error parsing regexp: missing closing ]: `[A-Z`',
      });
      const engineLog = fs.readFileSync(
        path.join(result.dir, "engine.log"),
        "utf8",
      );

      expect(result.status).toBe(1);
      expect(result.output).toContain(
        "Error: the agent's collector refuses your log operators (ONEUPTIME_LOG_OPERATOR_1 to _5):",
      );
      expect(result.output).toContain(
        '  Error: failed to build pipelines: failed to create "filelog" receiver for data type "logs": compiling regex: error parsing regexp: missing closing ]: `[A-Z`',
      );
      expect(result.output).toContain("The agent you have was left as it was.");
      // Not removed, not started again.
      expect(engineLog).not.toContain(`rm -f ${collector}`);
      expect(result.runArgs(collector)).toBeNull();
      expect(result.runArgs(aiAgent)).toBeNull();
    });
  },
);

describe("PodmanAgent install.sh: rootful and rootless Podman", () => {
  const script = path.join(AGENTS_DIR, "PodmanAgent", "install.sh");
  const BASE = { PODMAN_HOST_NAME: "web-1" };

  // What the collector and the AI agent mount, as host:container:mode.
  function mounts(result) {
    return {
      collector: flagValues(result.runArgs("oneuptime-podman-agent"), "-v"),
      aiAgent: flagValues(result.runArgs("oneuptime-podman-ai-agent"), "-v"),
    };
  }

  test("rootful: the socket and storage at /run/podman and /var/lib/containers", () => {
    const result = run("bash", script, {
      ...BASE,
      STUB_ROOTLESS: "false",
      STUB_SOCKET: "/run/podman/podman.sock",
      STUB_SOCKET_EXISTS: "true",
      STUB_GRAPHROOT: "/var/lib/containers/storage",
    });

    expect(result.status).toBe(0);
    expect(mounts(result)).toEqual({
      collector: [
        "/run/podman/podman.sock:/run/podman/podman.sock:ro",
        "/var/lib/containers/storage:/var/lib/containers/storage:ro",
      ],
      aiAgent: ["/run/podman/podman.sock:/run/podman/podman.sock:ro"],
    });
  });

  /*
   * The regression: rootless Podman got the rootful paths. The user's own
   * socket and storage are mounted at the rootful paths inside the
   * containers, where the collector's config looks for them.
   */
  test("rootless: the user's own socket and storage, at the paths the collector reads", () => {
    const result = run("bash", script, {
      ...BASE,
      STUB_ROOTLESS: "true",
      STUB_SOCKET: "unix:///run/user/1000/podman/podman.sock",
      STUB_SOCKET_EXISTS: "true",
      STUB_GRAPHROOT: "/home/ops/.local/share/containers/storage",
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "rootless Podman: /run/user/1000/podman/podman.sock",
    );
    expect(mounts(result)).toEqual({
      collector: [
        "/run/user/1000/podman/podman.sock:/run/podman/podman.sock:ro",
        "/home/ops/.local/share/containers/storage:/var/lib/containers/storage:ro",
      ],
      aiAgent: ["/run/user/1000/podman/podman.sock:/run/podman/podman.sock:ro"],
    });
  });

  test("rootless, with a Podman that does not say where: XDG_RUNTIME_DIR and the user's data directory", () => {
    const result = run("bash", script, {
      ...BASE,
      STUB_ROOTLESS: "true",
      STUB_SOCKET_EXISTS: "true",
      XDG_RUNTIME_DIR: "/run/user/1001",
      XDG_DATA_HOME: "/srv/ops-data",
    });

    expect(result.status).toBe(0);
    expect(mounts(result).collector).toEqual([
      "/run/user/1001/podman/podman.sock:/run/podman/podman.sock:ro",
      "/srv/ops-data/containers/storage:/var/lib/containers/storage:ro",
    ]);
  });

  test("rootless with no XDG_DATA_HOME: the storage under the home directory", () => {
    const result = run("bash", script, {
      ...BASE,
      STUB_ROOTLESS: "true",
      STUB_SOCKET_EXISTS: "true",
      XDG_RUNTIME_DIR: "/run/user/1001",
    });

    expect(result.status).toBe(0);
    expect(mounts(result).collector[1]).toBe(
      `${path.join(result.dir, "home")}/.local/share/containers/storage:/var/lib/containers/storage:ro`,
    );
  });

  test.each([
    ["rootless", "true", "systemctl --user enable --now podman.socket"],
    ["rootful", "false", "sudo systemctl enable --now podman.socket"],
  ])(
    "%s, with the socket off: it stops before starting anything, with the command that turns it on",
    (_mode, rootless, fix) => {
      const result = run("bash", script, {
        ...BASE,
        STUB_ROOTLESS: rootless,
        STUB_SOCKET: "/nonexistent/podman/podman.sock",
        STUB_SOCKET_EXISTS: "false",
      });

      expect(result.status).not.toBe(0);
      expect(result.output).toContain(
        "Podman's API socket is not at /nonexistent/podman/podman.sock",
      );
      expect(result.output).toContain(fix);
      expect(result.runArgs("oneuptime-podman-agent")).toBeNull();
      expect(result.runArgs("oneuptime-podman-ai-agent")).toBeNull();
    },
  );
});

describe("DockerSwarmAgent install.sh: the node's name", () => {
  const script = path.join(SWARM_DIR, "install.sh");
  const ANSWERS = "https://oneuptime.example.com\ningest-key\nmy-swarm\n";

  function envLine(result, name) {
    const line = fs
      .readFileSync(path.join(result.dir, "agent", ".env"), "utf8")
      .split("\n")
      .find((text) => {
        return text.startsWith(`${name}=`);
      });

    return line === undefined ? undefined : line.substring(name.length + 1);
  }

  function installed(env) {
    const dir = scratch();
    const result = run(
      "sh",
      script,
      { INSTALL_DIR: path.join(dir, "agent"), ...env },
      ANSWERS,
    );

    return { ...result, dir };
  }

  test("is the daemon's name, the node's hostname as docker node ls shows it, in .env", () => {
    const result = installed({ STUB_NODE_NAME: "swarm-worker-3" });

    expect(result.status).toBe(0);
    expect(envLine(result, "DOCKER_SWARM_NODE_NAME")).toBe("swarm-worker-3");
    // Beside the cluster name, which the compose file reads the same way.
    expect(envLine(result, "DOCKER_SWARM_CLUSTER_NAME")).toBe("my-swarm");
  });

  test("a name given when running the script is kept", () => {
    const result = installed({
      STUB_NODE_NAME: "swarm-worker-3",
      DOCKER_SWARM_NODE_NAME: "edge-7",
    });

    expect(envLine(result, "DOCKER_SWARM_NODE_NAME")).toBe("edge-7");
  });

  /*
   * The name goes into the collector's config inside an OTTL string, so
   * only the characters a hostname has are kept.
   */
  test("only a hostname's characters are kept", () => {
    const result = installed({
      DOCKER_SWARM_NODE_NAME: 'node-1.example.com"); drop(',
    });

    expect(envLine(result, "DOCKER_SWARM_NODE_NAME")).toBe(
      "node-1.example.comdrop",
    );
  });

  test("a daemon that does not answer leaves it empty, and the install goes on", () => {
    const result = installed({});

    expect(result.status).toBe(0);
    expect(envLine(result, "DOCKER_SWARM_NODE_NAME")).toBe("");
  });

  test("the compose file passes it to the collector", () => {
    expect(
      fs.readFileSync(path.join(SWARM_DIR, "docker-compose.yml"), "utf8"),
    ).toContain("- DOCKER_SWARM_NODE_NAME=${DOCKER_SWARM_NODE_NAME:-}");
  });
});

/*
 * Where the Swarm agent's files come from: the OneUptime it reports to,
 * which serves the files of its own release at
 * <ONEUPTIME_URL>/install/docker-swarm-agent/<file>. The install command in
 * OneUptime sets ONEUPTIME_URL to the reader's own OneUptime, so Enter at the
 * URL question takes it; without it, Enter takes OneUptime Cloud, as before.
 */
describe("DockerSwarmAgent install.sh: where its files come from", () => {
  const script = path.join(SWARM_DIR, "install.sh");

  /*
   * The script run in a scratch directory that holds the stubs, their logs
   * and the install directory, with `oneuptimeAnswer` (Utils/AgentFilesCurlStub)
   * standing for an older or a failing OneUptime.
   */
  function runSwarm({
    env = {},
    answers,
    shell = "sh",
    oneuptimeAnswer,
    in: existing,
  }) {
    const dir = existing || scratch();
    const bin = existing ? path.join(dir, "bin") : installStubs(dir);

    if (oneuptimeAnswer) {
      fs.writeFileSync(path.join(dir, "oneuptime.answer"), oneuptimeAnswer);
    }

    const result = spawnSync(shell, [script], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: path.join(dir, "home"),
        STUB_DIR: dir,
        INSTALL_DIR: path.join(dir, "agent"),
        ONEUPTIME_INSTALL_AI_AGENT: "true",
        ...env,
      },
      input: answers,
      encoding: "utf8",
    });
    const log = path.join(dir, "curl.log");

    return {
      dir,
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      requested: (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "")
        .split("\n")
        .filter((line) => {
          return line.includes(" -w ");
        })
        .map((line) => {
          return line.split(" ").pop();
        }),
      envLine: (name) => {
        const line = fs
          .readFileSync(path.join(dir, "agent", ".env"), "utf8")
          .split("\n")
          .find((text) => {
            return text.startsWith(`${name}=`);
          });

        return line === undefined ? undefined : line.substring(name.length + 1);
      },
    };
  }

  const FILES = [
    "docker-compose.yml",
    "otel-collector-config.yaml",
    "inventory-snapshot.sh",
  ];

  test("Enter takes the OneUptime the install command named, and the files come from it", () => {
    const result = runSwarm({
      env: { ONEUPTIME_URL: "https://oneuptime.acme.internal" },
      answers: "\ningest-key\nmy-swarm\n",
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "OneUptime URL [https://oneuptime.acme.internal]: ",
    );
    expect(result.envLine("ONEUPTIME_URL")).toBe(
      "https://oneuptime.acme.internal",
    );
    expect(result.requested).toEqual(
      FILES.map((file) => {
        return `https://oneuptime.acme.internal/install/docker-swarm-agent/${file}`;
      }),
    );
    for (const file of FILES) {
      expect(
        fs.readFileSync(path.join(result.dir, "agent", file), "utf8"),
      ).toBe(fs.readFileSync(path.join(SWARM_DIR, file), "utf8"));
    }
    expect(result.output).not.toContain("GitHub");
  });

  test("a URL typed at the question wins over the one the command named", () => {
    const result = runSwarm({
      env: { ONEUPTIME_URL: "https://oneuptime.acme.internal" },
      answers: "http://10.0.0.5:8080/\ningest-key\nmy-swarm\n",
    });

    expect(result.status).toBe(0);
    expect(result.envLine("ONEUPTIME_URL")).toBe("http://10.0.0.5:8080/");
    expect(result.requested[0]).toBe(
      "http://10.0.0.5:8080/install/docker-swarm-agent/docker-compose.yml",
    );
  });

  test("with no URL in the environment, Enter takes OneUptime Cloud, as it always did", () => {
    const result = runSwarm({ answers: "\ningest-key\nmy-swarm\n" });

    expect(result.status).toBe(0);
    expect(result.output).toContain("OneUptime URL [https://oneuptime.com]: ");
    expect(result.envLine("ONEUPTIME_URL")).toBe("https://oneuptime.com");
    expect(result.requested[0]).toBe(
      "https://oneuptime.com/install/docker-swarm-agent/docker-compose.yml",
    );
  });

  test.each([["sh"], ["bash"]])(
    "an older OneUptime (404) gets the files from GitHub, under %s",
    (shell) => {
      const result = runSwarm({
        shell,
        answers: "https://oneuptime.example.com\ningest-key\nmy-swarm\n",
        oneuptimeAnswer: "404 text/html",
      });

      expect(result.status).toBe(0);
      expect(result.output).toContain("Downloading them from GitHub instead.");
      expect(result.requested.slice(1)).toEqual(
        FILES.map((file) => {
          return `https://raw.githubusercontent.com/OneUptime/oneuptime/main/agents/DockerSwarmAgent/${file}`;
        }),
      );
      for (const file of FILES) {
        expect(
          fs.readFileSync(path.join(result.dir, "agent", file), "utf8"),
        ).toBe(fs.readFileSync(path.join(SWARM_DIR, file), "utf8"));
      }
    },
  );

  test("a OneUptime that errors stops the install before .env is written", () => {
    const result = runSwarm({
      answers: "https://oneuptime.example.com\ningest-key\nmy-swarm\n",
      oneuptimeAnswer: "503 text/html",
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(
      "Error: https://oneuptime.example.com/install/docker-swarm-agent/docker-compose.yml answered 503, not the file",
    );
    expect(fs.existsSync(path.join(result.dir, "agent", ".env"))).toBe(false);
    expect(result.requested.join("\n")).not.toContain("githubusercontent");
  });

  /*
   * Log operators of your own (issue #11225), kept in .env single-quoted, so
   * Compose takes each as written. The new .env is checked by the Compose
   * file's config check, the collector's validate, before it replaces the old
   * one, so a bad operator stops the install and the agent you have runs on.
   */
  const SWARM_ANSWERS = "https://oneuptime.example.com\ningest-key\nmy-swarm\n";

  test("a log operator goes into .env single-quoted, once the config check passes", () => {
    const result = runSwarm({
      answers: SWARM_ANSWERS,
      env: { ONEUPTIME_LOG_OPERATOR_1: INHOUSE_OPERATOR },
    });
    const engineLog = fs.readFileSync(
      path.join(result.dir, "engine.log"),
      "utf8",
    );

    expect(result.status).toBe(0);
    expect(result.envLine("ONEUPTIME_LOG_OPERATOR_1")).toBe(
      `'${INHOUSE_OPERATOR}'`,
    );
    expect(engineLog).toContain(
      "compose --env-file .env.new run --rm oneuptime-docker-swarm-agent-config-check",
    );
    expect(fs.existsSync(path.join(result.dir, "agent", ".env.new"))).toBe(
      false,
    );
    expect(
      (
        fs.statSync(path.join(result.dir, "agent", ".env")).mode & 0o777
      ).toString(8),
    ).toBe("600");
  });

  test("no log operator: none is written and nothing is checked", () => {
    const result = runSwarm({ answers: SWARM_ANSWERS });
    const engineLog = fs.readFileSync(
      path.join(result.dir, "engine.log"),
      "utf8",
    );

    expect(result.status).toBe(0);
    expect(result.envLine("ONEUPTIME_LOG_OPERATOR_1")).toBeUndefined();
    expect(engineLog).not.toContain("config-check");
  });

  test("one the collector refuses stops the install and keeps the .env it had", () => {
    const first = runSwarm({
      answers: SWARM_ANSWERS,
      env: { ONEUPTIME_LOG_OPERATOR_1: INHOUSE_OPERATOR },
    });
    const before = fs.readFileSync(
      path.join(first.dir, "agent", ".env"),
      "utf8",
    );
    const second = runSwarm({
      in: first.dir,
      answers: SWARM_ANSWERS,
      env: {
        ONEUPTIME_LOG_OPERATOR_2: '{"type":"regex_parse"}',
        STUB_VALIDATE_EXIT: "1",
        STUB_VALIDATE_OUTPUT: "'operators[1]' unsupported type 'regex_parse'",
      },
    });

    expect(second.status).toBe(1);
    expect(second.output).toContain(
      "Error: the agent's collector refuses your log operators (ONEUPTIME_LOG_OPERATOR_1 to _5):",
    );
    expect(second.output).toContain(
      "  'operators[1]' unsupported type 'regex_parse'",
    );
    expect(fs.readFileSync(path.join(first.dir, "agent", ".env"), "utf8")).toBe(
      before,
    );
    expect(fs.existsSync(path.join(first.dir, "agent", ".env.new"))).toBe(
      false,
    );
  });

  test("an operator .env holds is kept when the script runs again without it", () => {
    const first = runSwarm({
      answers: SWARM_ANSWERS,
      env: { ONEUPTIME_LOG_OPERATOR_1: INHOUSE_OPERATOR },
    });
    const second = runSwarm({ in: first.dir, answers: SWARM_ANSWERS });

    expect(second.status).toBe(0);
    expect(second.envLine("ONEUPTIME_LOG_OPERATOR_1")).toBe(
      `'${INHOUSE_OPERATOR}'`,
    );
  });

  test("an operator holding a single quote is refused, as .env cannot keep it", () => {
    const result = runSwarm({
      answers: SWARM_ANSWERS,
      env: { ONEUPTIME_LOG_OPERATOR_1: '{"type":"add","value":"it\'s"}' },
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Error: ONEUPTIME_LOG_OPERATOR_1 holds a single quote, which .env cannot keep.",
    );
  });
});
