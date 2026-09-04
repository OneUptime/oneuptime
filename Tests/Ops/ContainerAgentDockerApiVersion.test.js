"use strict";

/**
 * The container agents (DockerAgent, PodmanAgent, DockerSwarmAgent) scrape
 * container metrics with the collector's `docker_stats` receiver, and the
 * receiver has to name the Docker Engine API version it speaks. Its own default
 * (1.25) is too old for a modern daemon ("client version too old"), so the
 * configs pin a newer one — but a daemon ALSO refuses a client newer than its
 * own maximum. With `api_version: "1.44"` a literal in the config, Docker Engine
 * 20.10 (API 1.41) fails the receiver at start-up:
 *
 *   Error: cannot start pipelines: failed to start "docker_stats" receiver:
 *   Error response from daemon: client version 1.44 is too new.
 *   Maximum supported API version is 1.41
 *
 * The collector exits with it and the container restart-loops, and because the
 * config lives inside the image there was no way out short of replacing it. So
 * the pin is now the DOCKER_API_VERSION environment variable: the config
 * carries a plain `${env:DOCKER_API_VERSION}` placeholder — the form every
 * other variable in these configs already resolves as — and the default (1.44)
 * lives in the image's ENV and in the compose file's
 * `${DOCKER_API_VERSION:-1.44}` pass-through, where a host with an older daemon
 * can lower it with `-e`.
 *
 * The receiver is not the only client of that API. Each agent's
 * inventory-snapshot.sh polls the same daemon over curl, and it used to
 * hardcode `http://localhost/v1.44` under a comment saying it matched the
 * receiver's pin. It now reads the same variable with the same default, and
 * Swarm's compose file passes the variable to the sidecar that runs it.
 *
 * Nothing else guards that shape. `otelcol validate` is as happy with a literal
 * as with the placeholder, and the literal only fails at run time, on the hosts
 * old enough to hit it. These tests pin, for every agent that ships the
 * docker_stats receiver:
 *
 *   1. placeholder — the config reads api_version from `${env:…}`, never from
 *                    a version literal
 *   2. image       — the two agents that build an image bake a default into
 *                    their Dockerfile ENV
 *   3. compose     — every compose file passes the variable through with a
 *                    default, and it is the image's default
 *   4. poller      — every inventory-snapshot.sh builds its API base from
 *                    `${DOCKER_API_VERSION:-…}` with the shared default, and
 *                    Swarm's compose file passes the variable through to the
 *                    sidecar that runs the script
 *   5. lockstep    — the placeholder and every default are identical across
 *                    the three agents
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The three agents whose `docker_stats` receiver carries the pin. */
const AGENTS = ["DockerAgent", "PodmanAgent", "DockerSwarmAgent"];

/**
 * The agents that build an image, and so have a Dockerfile to bake the default
 * into. DockerSwarmAgent is deliberately not one of them: it runs the stock
 * upstream collector image with the config bind-mounted (see its
 * docker-compose.yml), so its compose default is the only default it has.
 */
const IMAGE_AGENTS = ["DockerAgent", "PodmanAgent"];

/** The compose service that runs the collector; Swarm's file has a sidecar too. */
const COLLECTOR_SERVICE = {
  DockerAgent: "oneuptime-docker-agent",
  PodmanAgent: "oneuptime-podman-agent",
  DockerSwarmAgent: "oneuptime-docker-swarm-agent",
};

/**
 * The Swarm sidecar that runs inventory-snapshot.sh. It is its own container
 * (stock alpine with the script bind-mounted in), so the collector service's
 * DOCKER_API_VERSION entry does not reach it and it needs a pass-through of
 * its own.
 *
 * DockerAgent and PodmanAgent have no equivalent. Their scripts are not wired
 * into their images today — Dockerfile.tpl copies only the collector config,
 * and nothing references entrypoint.sh — so for them the pin keeps the
 * script's "same default as the collector" comment true rather than guarding
 * a running path.
 */
const INVENTORY_SIDECAR_SERVICE = "oneuptime-docker-swarm-inventory";

/**
 * Exactly this string. A plain `${env:NAME}`, not a default-valued
 * `${env:NAME:-1.44}` expansion, because the plain form is what every other
 * variable in these configs already resolves as: DOCKER_HOST_NAME,
 * PODMAN_HOST_NAME and DOCKER_SWARM_CLUSTER_NAME are `${env:…}` with the
 * default declared as ENV in the Dockerfile (or as a compose `:-` default, for
 * Swarm), and no `${env:VAR:-default}` form exists in any collector config in
 * this repo. One home for the default also keeps it where `docker inspect`
 * shows it. That the plain form works on any confmap version, including the
 * ones that had not learnt `:-` defaults yet, is a secondary point.
 */
const API_VERSION_PLACEHOLDER = "${env:DOCKER_API_VERSION}";

/** The default every shipped copy has to agree on. */
const API_VERSION_DEFAULT = "1.44";

const VERSION_LITERAL = /^\d+\.\d+$/;
const DOCKERFILE_ENV_LINE = /^ENV DOCKER_API_VERSION=(\S+)$/;
const COMPOSE_PASS_THROUGH =
  /^DOCKER_API_VERSION=\$\{DOCKER_API_VERSION:-(\d+\.\d+)\}$/;
/** The poller's API base assignment, e.g. `DOCKER_API="http://localhost/v…"`. */
const POLLER_API_BASE_LINE = /^[A-Z_]+="(http:\/\/localhost\/v[^"]*)"$/;
/** A plain double-quoted shell assignment: NAME="value". */
const SHELL_ASSIGNMENT = /^([A-Z_]+)="([^"]*)"$/;
/** A plain `${NAME}` shell expansion, without a `:-` default of its own. */
const SHELL_EXPANSION = /\$\{([A-Z_]+)\}/g;
const POLLER_PASS_THROUGH =
  /^http:\/\/localhost\/v\$\{DOCKER_API_VERSION:-(\d+\.\d+)\}$/;

function readRepoFile(file) {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

/** receivers.docker_stats.api_version, or a hard error if the receiver is gone. */
function readApiVersion(agent) {
  const file = `${agent}/otel-collector-config.yaml`;
  const config = yaml.load(readRepoFile(file));
  const receiver = config.receivers && config.receivers.docker_stats;

  if (!receiver) {
    throw new Error(`${file}: no docker_stats receiver`);
  }

  return receiver.api_version;
}

/** The value of the Dockerfile's `ENV DOCKER_API_VERSION=` line, or null. */
function readImageDefault(agent) {
  const file = `${agent}/Dockerfile.tpl`;
  const values = readRepoFile(file)
    .split("\n")
    .map((line) => {
      return DOCKERFILE_ENV_LINE.exec(line.trimEnd());
    })
    .filter(Boolean)
    .map((match) => {
      return match[1];
    });

  if (values.length > 1) {
    throw new Error(
      `${file}: ENV DOCKER_API_VERSION is set ${values.length} times`,
    );
  }

  return values.length === 1 ? values[0] : null;
}

/** A compose service's `DOCKER_API_VERSION=…` environment entry, or null. */
function readComposeEntry(agent, serviceName) {
  const file = `${agent}/docker-compose.yml`;
  const service = yaml.load(readRepoFile(file)).services[serviceName];

  if (!service || !Array.isArray(service.environment)) {
    throw new Error(`${file}: service ${serviceName} has no environment list`);
  }

  const entries = service.environment.filter((entry) => {
    return typeof entry === "string" && entry.startsWith("DOCKER_API_VERSION=");
  });

  if (entries.length > 1) {
    throw new Error(
      `${file}: ${serviceName} sets DOCKER_API_VERSION ${entries.length} times`,
    );
  }

  return entries.length === 1 ? entries[0] : null;
}

/** The `:-` default inside the collector service's compose pass-through, or null. */
function readComposeDefault(agent) {
  const match = COMPOSE_PASS_THROUGH.exec(
    readComposeEntry(agent, COLLECTOR_SERVICE[agent]) || "",
  );

  return match ? match[1] : null;
}

/**
 * The poller's `http://localhost/v…` API base with the script's own variables
 * expanded one level, or a hard error if the script has no such base.
 *
 * The scripts assign the version on its own line, in the `NAME="${VAR:-…}"`
 * style of the SOCKET/LOG_PATH/INTERVAL lines above it, and build the URL from
 * that name — so the pass-through and the URL are two lines. One hop of
 * expansion, over the assignments that precede the URL as the shell would see
 * them, joins the two; the literal `/v1.44` this guards against has nothing to
 * expand and comes back as written.
 */
function readPollerApiBase(agent) {
  const file = `${agent}/inventory-snapshot.sh`;
  const lines = readRepoFile(file)
    .split("\n")
    .map((line) => {
      return line.trimEnd();
    });
  const baseIndices = lines
    .map((line, index) => {
      return POLLER_API_BASE_LINE.test(line) ? index : -1;
    })
    .filter((index) => {
      return index !== -1;
    });

  if (baseIndices.length !== 1) {
    throw new Error(
      `${file}: expected one http://localhost/v… API base, found ${baseIndices.length}`,
    );
  }

  const [baseIndex] = baseIndices;
  const assignments = new Map();

  for (const line of lines.slice(0, baseIndex)) {
    const match = SHELL_ASSIGNMENT.exec(line);

    if (match) {
      assignments.set(match[1], match[2]);
    }
  }

  return POLLER_API_BASE_LINE.exec(lines[baseIndex])[1].replace(
    SHELL_EXPANSION,
    (expansion, name) => {
      return assignments.has(name) ? assignments.get(name) : expansion;
    },
  );
}

/** The `:-` default inside the poller's pass-through, or null. */
function readPollerDefault(agent) {
  const match = POLLER_PASS_THROUGH.exec(readPollerApiBase(agent));

  return match ? match[1] : null;
}

describe.each(AGENTS)("%s Docker API version pin", (agent) => {
  /*
   * THE PLACEHOLDER TEST. A version literal here is the exact state that
   * restart-loops the collector on an older Engine, and it is also the state
   * `otelcol validate` accepts without a murmur — so the assertion is on the
   * exact string, and the agent and the file are in the test's name.
   */
  test("otel-collector-config.yaml reads api_version from the DOCKER_API_VERSION placeholder, not a literal", () => {
    expect(readApiVersion(agent)).toBe(API_VERSION_PLACEHOLDER);
  });

  /*
   * With the config reading `${env:…}`, an unset variable is what the collector
   * refuses to start on, so compose has to supply one — and as a `:-` default,
   * so that `DOCKER_API_VERSION=1.41` in the host's .env still wins.
   */
  test("docker-compose.yml passes DOCKER_API_VERSION through with a version default", () => {
    expect(readComposeEntry(agent, COLLECTOR_SERVICE[agent])).toEqual(
      expect.stringMatching(COMPOSE_PASS_THROUGH),
    );
  });

  /*
   * The poller talks to the same daemon as the receiver, so the same "client
   * version too new" refusal applies to it — as a silently empty inventory
   * rather than a crash, because the script swallows curl failures. It has to
   * follow the same variable, and the `:-` default keeps it working where the
   * variable is not set at all. The received value on failure is the URL as
   * the script builds it, so a literal `/v1.44` reads as exactly that.
   */
  test("inventory-snapshot.sh builds its API base from the DOCKER_API_VERSION pass-through, not a literal", () => {
    expect(readPollerApiBase(agent)).toEqual(
      expect.stringMatching(POLLER_PASS_THROUGH),
    );
    expect(readPollerDefault(agent)).toBe(API_VERSION_DEFAULT);
  });
});

describe.each(IMAGE_AGENTS)("%s image default", (agent) => {
  /*
   * `docker run` without `-e DOCKER_API_VERSION` gets whatever the image's ENV
   * says, which is why the default is baked into the Dockerfile and not only
   * into compose. A literal, not another `${…}`: this is the end of the chain.
   */
  test("Dockerfile.tpl sets ENV DOCKER_API_VERSION to a version literal", () => {
    expect(readImageDefault(agent)).toEqual(
      expect.stringMatching(VERSION_LITERAL),
    );
  });

  test("the image default and the compose default are the same version", () => {
    const imageDefault = readImageDefault(agent);

    expect(imageDefault).not.toBeNull();
    expect(readComposeDefault(agent)).toBe(imageDefault);
  });
});

describe("DockerSwarmAgent inventory sidecar", () => {
  /*
   * The one poller that actually runs, and it runs in its own container, so
   * the collector service's pass-through does not reach it. Exactly the
   * collector's entry, default included: the two services can then only
   * disagree when a host sets the variable for one and not the other, and the
   * default stays visible in the compose file rather than only inside the
   * script.
   */
  test("docker-compose.yml passes DOCKER_API_VERSION through to the sidecar with the shared default", () => {
    expect(
      readComposeEntry("DockerSwarmAgent", INVENTORY_SIDECAR_SERVICE),
    ).toBe(`DOCKER_API_VERSION=\${DOCKER_API_VERSION:-${API_VERSION_DEFAULT}}`);
  });
});

describe("the pin is identical everywhere it ships", () => {
  /*
   * The three agents were written as copies of one another, and a bump applied
   * to one and not the rest is the obvious way for them to rot. A host that
   * lowers DOCKER_API_VERSION also expects the same knob, with the same default
   * behind it, on every agent it runs — and behind the poller as well as the
   * receiver, since both talk to the same daemon.
   */
  function pinOf(agent) {
    return {
      placeholder: readApiVersion(agent),
      composeDefault: readComposeDefault(agent),
      pollerDefault: readPollerDefault(agent),
    };
  }

  test.each(AGENTS.slice(1))("%s matches DockerAgent", (agent) => {
    expect(pinOf(agent)).toEqual(pinOf("DockerAgent"));
  });

  test.each(IMAGE_AGENTS.slice(1))(
    "%s bakes the same image default as DockerAgent",
    (agent) => {
      expect(readImageDefault(agent)).toBe(readImageDefault("DockerAgent"));
    },
  );

  test(`and the default they share is ${API_VERSION_DEFAULT}`, () => {
    expect(readComposeDefault("DockerAgent")).toBe(API_VERSION_DEFAULT);
    expect(readImageDefault("DockerAgent")).toBe(API_VERSION_DEFAULT);
    expect(readPollerDefault("DockerAgent")).toBe(API_VERSION_DEFAULT);
  });

  /*
   * Keeps the Swarm exemption honest: the day DockerSwarmAgent grows an image
   * (or an image agent loses its Dockerfile) this fails, instead of the ENV
   * check silently not applying.
   */
  test("the agents that bake an image are exactly the ones with a Dockerfile.tpl", () => {
    const withDockerfile = AGENTS.filter((agent) => {
      return fs.existsSync(path.join(REPO_ROOT, agent, "Dockerfile.tpl"));
    });

    expect(withDockerfile).toEqual(IMAGE_AGENTS);
  });
});
