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
 * `curl` serves the Swarm agent's files from this checkout.
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
    printf '%s\\n' "$@" > "$STUB_DIR/run-$(printf '%s' "$*" | sed -n 's/.*--name \\([^ ]*\\).*/\\1/p').args"
    exit 0
    ;;
esac
exit 0
`;

  writeExecutable(path.join(bin, "docker"), engine);
  writeExecutable(path.join(bin, "podman"), engine);
  writeExecutable(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash
url=""; out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
rel="\${url#https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DockerSwarmAgent/}"
[ -f "${SWARM_DIR}/$rel" ] || exit 22
cp "${SWARM_DIR}/$rel" "$out"
`,
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
