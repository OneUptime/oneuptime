"use strict";

/**
 * The Docker, Podman and Docker Swarm agents' install.sh, run for real in a
 * scratch directory with `docker`, `podman` and `curl` replaced by recording
 * stubs (no daemon or network needed). They also install the OneUptime AI
 * agent, and the bugs that matter are in what they tell it:
 *
 *  - the write switch reaches the agent as exactly `true` or `false`, read
 *    the way the agent reads it (case and surrounding blanks ignored), so
 *    the script never says "read-only" over an agent that applies fixes;
 *  - the Swarm installer writes ONEUPTIME_AI_PROTECTED_TARGETS into .env next
 *    to the write switch, so a later `docker compose up -d` (switching fixes
 *    on, an upgrade, the systemd unit) cannot drop the protection while the
 *    fixes stay on — and a re-run keeps both target lists unless told
 *    otherwise, with the .env (it holds the ingestion key) private;
 *  - on a node that is not a swarm manager the AI agent is left out, because
 *    it can run nothing there and would hold the cluster's AI agent place.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENTS_DIR = path.join(REPO_ROOT, "agents");
const SWARM_DIR = path.join(AGENTS_DIR, "DockerSwarmAgent");
const SWARM_AI_AGENT = "oneuptime-docker-swarm-ai-agent";

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "container-ai-install-"));
  scratchDirs.push(dir);
  return dir;
}

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

/*
 * `docker` / `podman` record every call. `ps -a` lists the names in
 * $STUB_DIR/containers; `info --format` prints $STUB_SWARM_INFO, the node's
 * "<LocalNodeState> <ControlAvailable>" (the swarm manager check); `compose up` records the protected-targets value it
 * was started with. `curl` serves the Swarm agent's files from this checkout.
 */
function installStubs(dir) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);

  const engine = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/engine.log"
case "$1" in
  ps)
    [ -f "$STUB_DIR/containers" ] && cat "$STUB_DIR/containers"
    exit 0
    ;;
  info)
    if [ "$2" = "--format" ]; then
      printf '%s\\n' "\${STUB_SWARM_INFO-active true}"
    fi
    exit 0
    ;;
  run)
    printf '%s\\n' "$@" > "$STUB_DIR/run-$(printf '%s' "$*" | sed -n 's/.*--name \\([^ ]*\\).*/\\1/p').args"
    exit 0
    ;;
  compose)
    if [ "$2" = "up" ]; then
      cp docker-compose.override.yml "$STUB_DIR/override-at-up.yml" 2>/dev/null || rm -f "$STUB_DIR/override-at-up.yml"
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

function run(dir, shell, script, env, input, args) {
  const bin = fs.existsSync(path.join(dir, "bin"))
    ? path.join(dir, "bin")
    : installStubs(dir);
  const result = spawnSync(shell, [script, ...(args || [])], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: dir,
      STUB_DIR: dir,
      ...env,
    },
    input: input || "",
    encoding: "utf8",
  });

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

function aiAgentArgs(dir, name) {
  const file = path.join(dir, `run-${name}.args`);

  return fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split("\n")
    : null;
}

function engineLog(dir) {
  const file = path.join(dir, "engine.log");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

const CONTAINER_INSTALLERS = [
  {
    agent: "DockerAgent",
    aiAgent: "oneuptime-docker-ai-agent",
    env: { ONEUPTIME_SERVICE_TOKEN: "ingest-key", DOCKER_HOST_NAME: "web-1" },
  },
  {
    agent: "PodmanAgent",
    aiAgent: "oneuptime-podman-ai-agent",
    env: { ONEUPTIME_SERVICE_TOKEN: "ingest-key", PODMAN_HOST_NAME: "web-1" },
  },
];

describe.each(CONTAINER_INSTALLERS)(
  "$agent install.sh: the AI agent's write switch",
  ({ agent, aiAgent, env }) => {
    const script = path.join(AGENTS_DIR, agent, "install.sh");

    function install(allowWrites) {
      const dir = scratch();
      const result = run(dir, "bash", script, {
        ONEUPTIME_URL: "https://oneuptime.example.com",
        ...env,
        ...(allowWrites === undefined
          ? {}
          : { ONEUPTIME_AI_ALLOW_WRITES: allowWrites }),
      });

      expect(result.status).toBe(0);

      const args = aiAgentArgs(dir, aiAgent);
      expect(args).not.toBeNull();

      return {
        output: result.output,
        passed: args
          .filter((arg) => {
            return arg.startsWith("ONEUPTIME_AI_ALLOW_WRITES=");
          })
          .map((arg) => {
            return arg.substring("ONEUPTIME_AI_ALLOW_WRITES=".length);
          }),
      };
    }

    test.each(["true", "TRUE", "True", " true "])(
      "%j turns fixes on, and the script says so",
      (value) => {
        const { output, passed } = install(value);

        expect(passed).toEqual(["true"]);
        expect(output).toContain("It may apply the fixes you allow");
        expect(output).not.toContain("It is read-only");
      },
    );

    test.each([undefined, "", "false", "yes", "1", "on", "tru"])(
      "%j keeps it read-only, and the script says so",
      (value) => {
        const { output, passed } = install(value);

        expect(passed).toEqual(["false"]);
        expect(output).toContain("It is read-only");
        expect(output).not.toContain("It may apply the fixes you allow");
      },
    );
  },
);

describe("DockerSwarmAgent install.sh", () => {
  const script = path.join(SWARM_DIR, "install.sh");
  const ANSWERS = "https://oneuptime.example.com\ningest-key\nmy-swarm\n";

  function install(dir, env, args) {
    const installDir = path.join(dir, "agent");
    const result = run(
      dir,
      "sh",
      script,
      { INSTALL_DIR: installDir, ...env },
      ANSWERS,
      args,
    );

    return {
      ...result,
      installDir,
      envFile: () => {
        return fs.readFileSync(path.join(installDir, ".env"), "utf8");
      },
      envLine: (name) => {
        const line = fs
          .readFileSync(path.join(installDir, ".env"), "utf8")
          .split("\n")
          .find((text) => {
            return text.startsWith(`${name}=`);
          });
        return line === undefined ? undefined : line.substring(name.length + 1);
      },
    };
  }

  /*
   * Regression: .env got the write switch and the write targets but not the
   * protected targets, so the first `docker compose up -d` took them from the
   * shell and every later one (the script's own advice for switching fixes
   * on) started the agent without them — writes on, protection gone.
   */
  test("writes the protected targets into .env with the write switch and the write targets", () => {
    const dir = scratch();
    const first = install(dir, {
      ONEUPTIME_AI_PROTECTED_TARGETS: "db_*,vault_*",
      ONEUPTIME_AI_WRITE_TARGETS: "web_*",
    });

    expect(first.status).toBe(0);
    expect(first.envLine("ONEUPTIME_AI_PROTECTED_TARGETS")).toBe(
      "db_*,vault_*",
    );
    expect(first.envLine("ONEUPTIME_AI_WRITE_TARGETS")).toBe("web_*");
    expect(first.envLine("ONEUPTIME_AI_ALLOW_WRITES")).toBe("false");

    // Every variable the AI agent's compose service reads from the
    // environment is in .env, so a later `docker compose up -d` from a
    // fresh shell starts it with the same values.
    const compose = fs.readFileSync(
      path.join(SWARM_DIR, "docker-compose.yml"),
      "utf8",
    );
    for (const name of [
      "ONEUPTIME_AI_ALLOW_WRITES",
      "ONEUPTIME_AI_WRITE_TARGETS",
      "ONEUPTIME_AI_PROTECTED_TARGETS",
    ]) {
      expect(compose).toContain(`- ${name}=\${${name}:-`);
      expect({ name, inEnv: first.envLine(name) !== undefined }).toEqual({
        name,
        inEnv: true,
      });
    }
  });

  test("the .env, which holds the ingestion key, is readable by its owner only", () => {
    const run1 = install(scratch(), {});

    expect(run1.status).toBe(0);
    expect(run1.envLine("ONEUPTIME_SERVICE_TOKEN")).toBe("ingest-key");
    expect(
      fs.statSync(path.join(run1.installDir, ".env")).mode & 0o777,
    ).toBe(0o600);
  });

  test("a re-run without the target lists keeps the ones .env has; one that sets a list (even empty) replaces it", () => {
    const dir = scratch();
    install(dir, {
      ONEUPTIME_AI_PROTECTED_TARGETS: "db_*",
      ONEUPTIME_AI_WRITE_TARGETS: "web_*",
    });

    // Switching fixes on by re-running the script, as the README says.
    const again = install(dir, { ONEUPTIME_AI_ALLOW_WRITES: "true" });

    expect(again.status).toBe(0);
    expect(again.envLine("ONEUPTIME_AI_ALLOW_WRITES")).toBe("true");
    expect(again.envLine("ONEUPTIME_AI_PROTECTED_TARGETS")).toBe("db_*");
    expect(again.envLine("ONEUPTIME_AI_WRITE_TARGETS")).toBe("web_*");

    const cleared = install(dir, {
      ONEUPTIME_AI_PROTECTED_TARGETS: "",
      ONEUPTIME_AI_WRITE_TARGETS: "api_*",
    });

    expect(cleared.envLine("ONEUPTIME_AI_PROTECTED_TARGETS")).toBe("");
    expect(cleared.envLine("ONEUPTIME_AI_WRITE_TARGETS")).toBe("api_*");
  });

  test("a protected list added to .env by hand survives a re-run", () => {
    const dir = scratch();
    const first = install(dir, {});
    const envPath = path.join(first.installDir, ".env");

    fs.writeFileSync(
      envPath,
      first
        .envFile()
        .replace(
          /^ONEUPTIME_AI_PROTECTED_TARGETS=.*$/m,
          'ONEUPTIME_AI_PROTECTED_TARGETS="db_*"',
        ),
    );

    const again = install(dir, { ONEUPTIME_AI_ALLOW_WRITES: "true" });

    expect(again.envLine("ONEUPTIME_AI_PROTECTED_TARGETS")).toBe('"db_*"');
  });

  test.each([
    ["TRUE", "true", "It may apply the fixes you allow"],
    [" true ", "true", "It may apply the fixes you allow"],
    ["yes", "false", "read-only"],
    [undefined, "false", "read-only"],
  ])(
    "ONEUPTIME_AI_ALLOW_WRITES=%j goes into .env as %s, and the script says so",
    (value, written, said) => {
      const result = install(
        scratch(),
        value === undefined ? {} : { ONEUPTIME_AI_ALLOW_WRITES: value },
      );

      expect(result.status).toBe(0);
      expect(result.envLine("ONEUPTIME_AI_ALLOW_WRITES")).toBe(written);
      expect(result.output).toContain(said);
    },
  );

  describe("on a node that is not a swarm manager", () => {
    test("leaves the AI agent out, says why, and removes one installed there earlier (with a sign-off)", () => {
      const dir = scratch();
      fs.writeFileSync(
        path.join(dir, "containers"),
        `oneuptime-docker-swarm-agent\n${SWARM_AI_AGENT}\n`,
      );

      const result = install(dir, { STUB_SWARM_INFO: "active false" });

      expect(result.status).toBe(0);
      expect(result.output).toContain("this node is not a swarm manager");
      // The override that keeps it from starting is in place for compose up.
      const override = fs.readFileSync(
        path.join(dir, "override-at-up.yml"),
        "utf8",
      );
      expect(override).toContain(`${SWARM_AI_AGENT}:`);
      expect(override).toContain('profiles: ["ai-agent-disabled"]');
      // Stopped (SIGTERM: the agent signs off), then removed; never rm -f.
      const log = engineLog(dir);
      expect(log).toContain(`stop ${SWARM_AI_AGENT}\n`);
      expect(log).toContain(`rm ${SWARM_AI_AGENT}\n`);
      expect(log).not.toContain(`rm -f ${SWARM_AI_AGENT}`);
    });

    test("an engine outside any swarm gets no AI agent either", () => {
      const dir = scratch();
      const result = install(dir, { STUB_SWARM_INFO: "inactive false" });

      expect(result.status).toBe(0);
      expect(result.output).toContain("this node is not a swarm manager");
      expect(fs.existsSync(path.join(dir, "override-at-up.yml"))).toBe(true);
    });

    test("even when ONEUPTIME_INSTALL_AI_AGENT=true", () => {
      const dir = scratch();
      const result = install(dir, {
        STUB_SWARM_INFO: "active false",
        ONEUPTIME_INSTALL_AI_AGENT: "true",
      });

      expect(result.status).toBe(0);
      expect(fs.existsSync(path.join(dir, "override-at-up.yml"))).toBe(true);
    });
  });

  describe("on a manager", () => {
    test("runs the AI agent, and removes the override a worker install wrote", () => {
      const dir = scratch();
      install(dir, { STUB_SWARM_INFO: "active false" });

      const result = install(dir, { STUB_SWARM_INFO: "active true" });

      expect(result.status).toBe(0);
      expect(result.output).not.toContain("not a swarm manager");
      expect(fs.existsSync(path.join(dir, "override-at-up.yml"))).toBe(false);
      expect(
        fs.existsSync(
          path.join(result.installDir, "docker-compose.override.yml"),
        ),
      ).toBe(false);
    });

    test.each([
      ["docker cannot say", ""],
      ["the swarm is locked (autolock)", "locked false"],
      ["the node is still joining", "pending false"],
      ["the node is in error", "error false"],
    ])(
      "when %s, the AI agent is installed (it finds out itself)",
      (_case, info) => {
        const dir = scratch();
        const result = install(dir, { STUB_SWARM_INFO: info });

        expect(result.status).toBe(0);
        expect(result.output).not.toContain("not a swarm manager");
        expect(fs.existsSync(path.join(dir, "override-at-up.yml"))).toBe(
          false,
        );
      },
    );

    test("--no-ai-agent still leaves it out, and removes nothing", () => {
      const dir = scratch();
      fs.writeFileSync(path.join(dir, "containers"), `${SWARM_AI_AGENT}\n`);

      const result = install(dir, {}, ["--no-ai-agent"]);

      expect(result.status).toBe(0);
      expect(result.output).toContain("left out (--no-ai-agent)");
      expect(fs.existsSync(path.join(dir, "override-at-up.yml"))).toBe(true);
      expect(engineLog(dir)).not.toContain(`stop ${SWARM_AI_AGENT}`);
    });
  });
});
