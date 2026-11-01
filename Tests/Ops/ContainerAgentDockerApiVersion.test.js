"use strict";

/**
 * The container agents (DockerAgent, PodmanAgent, DockerSwarmAgent) scrape
 * container metrics with the collector's `docker_stats` receiver, and the
 * receiver has to name the Docker Engine API version it speaks.
 *
 * A daemon refuses a client NEWER than its own maximum, and a receiver that
 * fails to start takes the whole collector down with it. With the version a
 * literal `"1.44"` baked into the image, Docker Engine 20.10 (max API 1.41)
 * restart-loops the agent:
 *
 *   Error: cannot start pipelines: failed to start "docker_stats" receiver:
 *   Error response from daemon: client version 1.44 is too new.
 *   Maximum supported API version is 1.41
 *
 * So the version is the DOCKER_API_VERSION environment variable, and it is
 * EMPTY by default: empty makes the receiver negotiate the version with the
 * daemon, which works from Docker Engine 20.10 on. The agents used to default
 * it to 1.44 - the literal they had always shipped - which kept exactly that
 * restart loop for every Engine from 20.10 to 24, the versions the docs list
 * as supported, until someone found the variable.
 *
 * BEHAVIOUR VERIFIED AGAINST otel/opentelemetry-collector-contrib:0.154.0 and a
 * real daemon (max API 1.54, min 1.40), and again against 0.161.0 (whose Docker
 * client negotiates up to 1.56). These numbers are measured, not assumed, and
 * several of them contradict what the configs used to claim:
 *
 *   api_version in config    | on the wire                    | collector
 *   -------------------------|--------------------------------|-----------
 *   field omitted            | /v1.44/ (receiver default)     | starts
 *   "" (unset or empty env)  | HEAD /_ping then /v1.54/       | starts
 *   "1.44"                   | /v1.44/                        | starts
 *   "1.25"                   | -                              | EXIT 1, "too old"
 *   "1.99"                   | -                              | EXIT 1, "too new"
 *
 * Three consequences drive the assertions below:
 *
 *   1. The receiver's own default is 1.44, and 1.25 is its accepted MINIMUM,
 *      not its default. The old comment ("the receiver default is 1.25, which
 *      modern daemons reject") was wrong on both halves, so a test guards
 *      against it coming back.
 *
 *   2. An EMPTY api_version is safe, not broken: the receiver asks the Docker
 *      SDK to auto-negotiate (one HEAD /_ping, then the daemon's own maximum),
 *      which works against any daemon. That makes it a genuine escape hatch for
 *      operators who do not want to look their maximum up, so the docs describe
 *      it and these tests keep it reachable.
 *
 *   3. So empty is the default everywhere the agents ship it: the images'
 *      ENV, the compose files (`${DOCKER_API_VERSION:-}`), and the Swarm
 *      inventory poller. A version is pinned only when someone sets one.
 *
 * The config keeps a plain `${env:DOCKER_API_VERSION}`, with no `:-` default:
 * unset expands to empty too, which is the same negotiation.
 *
 * The receiver is not the only client of that API. The Swarm agent's
 * inventory-snapshot.sh polls the same daemon over curl. Its resolution logic
 * is exercised by RUNNING it under `sh` rather than by pattern-matching the
 * source, so the assertions are about behaviour. (The Docker and Podman
 * agents had pollers too, which their images never ran; they are gone, see
 * ContainerAgentConfigs.test.js.)
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
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
 * DOCKER_API_VERSION entry does not reach it and it needs its own.
 */
const INVENTORY_SIDECAR_SERVICE = "oneuptime-docker-swarm-inventory";

/** Exactly this string — not a literal, and not a `:-` default (see header). */
const API_VERSION_PLACEHOLDER = "${env:DOCKER_API_VERSION}";

/**
 * The default every shipped copy has to agree on: none. Empty negotiates the
 * version with the daemon.
 */
const API_VERSION_DEFAULT = "";

/** The version the agents pinned before, which Docker Engine 20.10 to 24 refuse. */
const OLD_PINNED_DEFAULT = "1.44";

const DOCKERFILE_ENV_LINE = /^ENV DOCKER_API_VERSION=(\S*)$/;

/**
 * `${DOCKER_API_VERSION:-}`: the variable when the user sets it (in .env or
 * the shell), else empty, so the collector negotiates.
 */
const COMPOSE_PASS_THROUGH = "DOCKER_API_VERSION=${DOCKER_API_VERSION:-}";

/** The agents with an inventory poller of their own, which runs. */
const POLLER_AGENTS = ["DockerSwarmAgent"];

function readRepoFile(file) {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

/** receivers.docker_stats.api_version, or a hard error if the receiver is gone. */
function readApiVersion(agent) {
  const file = `agents/${agent}/otel-collector-config.yaml`;
  const config = yaml.load(readRepoFile(file));
  const receiver = config.receivers && config.receivers.docker_stats;

  if (!receiver) {
    throw new Error(`${file}: no docker_stats receiver`);
  }

  return receiver.api_version;
}

/** The value of the Dockerfile's `ENV DOCKER_API_VERSION=` line, or null. */
function readImageDefault(agent) {
  const file = `agents/${agent}/Dockerfile.tpl`;
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
  const file = `agents/${agent}/docker-compose.yml`;
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

/**
 * The value the collector service gets when nothing sets the variable: the
 * pass-through's `:-` default, or null when the entry is not a pass-through.
 */
function readComposeDefault(agent) {
  const match = /^DOCKER_API_VERSION=\$\{DOCKER_API_VERSION:?-([^}]*)\}$/.exec(
    readComposeEntry(agent, COLLECTOR_SERVICE[agent]) || "",
  );

  return match ? match[1] : null;
}

/**
 * The poller's API-base resolution, RUN rather than parsed.
 *
 * The scripts resolve API_VERSION and then build the base URL in an if/else, so
 * pattern-matching the source would only ever assert the shape of one branch.
 * Instead the block is lifted out and executed under `sh` with a controlled
 * environment, and the URL it produces is what gets asserted — which is the
 * thing that actually matters.
 */
function resolvePollerApiBase(agent, apiVersionEnv) {
  const file = `agents/${agent}/inventory-snapshot.sh`;
  const lines = readRepoFile(file).split("\n");
  const start = lines.findIndex((line) => {
    return line.startsWith("API_VERSION=");
  });

  if (start === -1) {
    throw new Error(`${file}: no API_VERSION= assignment`);
  }

  const end = lines.findIndex((line, index) => {
    return index > start && line.trimEnd() === "fi";
  });

  if (end === -1) {
    throw new Error(`${file}: API_VERSION block is not closed by an "fi"`);
  }

  const block = lines.slice(start, end + 1).join("\n");
  const env = { PATH: process.env.PATH };

  if (apiVersionEnv !== undefined) {
    env.DOCKER_API_VERSION = apiVersionEnv;
  }

  return execFileSync(
    "sh",
    ["-c", `${block}\nprintf '%s' "\${DOCKER_API:-$PODMAN_API}"`],
    { env, encoding: "utf8" },
  );
}

/** Every collector config in the repo that declares a docker_stats receiver. */
function findDockerStatsConfigs() {
  const found = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      /*
       * .claude holds agent worktrees: full checkouts of this repo nested
       * under its own root. Without skipping them this scan reports every
       * in-flight branch's copy of every collector config, so the assertion
       * below fails locally for a reason that has nothing to do with what
       * ships - the same trap SyncPackageVersions documents.
       */
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === ".claude"
      ) {
        continue;
      }

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.ya?ml$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");

        if (/^\s{2}docker_stats:/m.test(text)) {
          found.push(path.relative(REPO_ROOT, full));
        }
      }
    }
  }

  walk(REPO_ROOT);

  return found.sort();
}

describe.each(AGENTS)("%s Docker API version", (agent) => {
  /*
   * A version literal here is the exact state that restart-loops the collector
   * on an older Engine, and it is also the state `otelcol validate` accepts
   * without a murmur — so the assertion is on the exact string.
   */
  test("otel-collector-config.yaml reads api_version from the DOCKER_API_VERSION placeholder, not a literal", () => {
    expect(readApiVersion(agent)).toBe(API_VERSION_PLACEHOLDER);
  });

  /*
   * The regression: `${DOCKER_API_VERSION-1.44}` gave every install that did
   * not set the variable a pinned 1.44, which Engine 20.10 to 24 refuse.
   */
  test("docker-compose.yml passes DOCKER_API_VERSION through, empty unless it is set, so the collector negotiates", () => {
    expect(readComposeEntry(agent, COLLECTOR_SERVICE[agent])).toBe(
      COMPOSE_PASS_THROUGH,
    );
    expect(readComposeDefault(agent)).toBe(API_VERSION_DEFAULT);
  });
});

describe.each(POLLER_AGENTS)(
  "%s inventory poller resolves its API base",
  (agent) => {
    /*
     * curl has no version negotiation, so the poller answers an empty version by
     * dropping the /v<version> prefix. The Docker API serves those unversioned
     * paths at the daemon's own version — the same outcome the collector reaches
     * by negotiating, which is the point: both clients of the socket move
     * together, and neither is refused by an older daemon.
     */
    test("with DOCKER_API_VERSION unset it asks for the daemon's own version", () => {
      expect(resolvePollerApiBase(agent, undefined)).toBe("http://localhost");
    });

    test("with DOCKER_API_VERSION explicitly empty it drops the version prefix", () => {
      expect(resolvePollerApiBase(agent, "")).toBe("http://localhost");
    });

    test("an explicit version is used verbatim", () => {
      expect(resolvePollerApiBase(agent, "1.41")).toBe(
        "http://localhost/v1.41",
      );
    });

    test("the script parses under sh -n", () => {
      expect(() => {
        return execFileSync("sh", [
          "-n",
          path.join(REPO_ROOT, "agents", agent, "inventory-snapshot.sh"),
        ]);
      }).not.toThrow();
    });
  },
);

describe.each(IMAGE_AGENTS)("%s image default", (agent) => {
  /*
   * `docker run` without `-e DOCKER_API_VERSION` gets whatever the image's ENV
   * says, which is why the default is baked into the Dockerfile and not only
   * into compose. Empty, the end of the chain: the receiver negotiates.
   */
  test("Dockerfile.tpl sets ENV DOCKER_API_VERSION, empty", () => {
    expect(readImageDefault(agent)).toBe(API_VERSION_DEFAULT);
  });

  test("the image default and the compose default are the same version", () => {
    const imageDefault = readImageDefault(agent);

    expect(imageDefault).not.toBeNull();
    expect(readComposeDefault(agent)).toBe(imageDefault);
  });
});

describe("DockerSwarmAgent inventory sidecar", () => {
  /*
   * The one poller that actually runs, and it runs in its own container, so the
   * collector service's pass-through does not reach it.
   */
  test("docker-compose.yml passes DOCKER_API_VERSION through to the sidecar, empty unless it is set", () => {
    expect(
      readComposeEntry("DockerSwarmAgent", INVENTORY_SIDECAR_SERVICE),
    ).toBe(COMPOSE_PASS_THROUGH);
  });

  test("the sidecar and the collector get byte-identical entries", () => {
    expect(
      readComposeEntry("DockerSwarmAgent", INVENTORY_SIDECAR_SERVICE),
    ).toBe(
      readComposeEntry("DockerSwarmAgent", COLLECTOR_SERVICE.DockerSwarmAgent),
    );
  });
});

describe("the default is identical everywhere it ships", () => {
  function pinOf(agent) {
    return {
      placeholder: readApiVersion(agent),
      composeDefault: readComposeDefault(agent),
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

  test("and the default they share is empty: negotiated, never the 1.44 older daemons refuse", () => {
    for (const agent of AGENTS) {
      expect(readComposeDefault(agent)).toBe(API_VERSION_DEFAULT);
    }
    for (const agent of IMAGE_AGENTS) {
      expect(readImageDefault(agent)).toBe(API_VERSION_DEFAULT);
    }
    for (const agent of POLLER_AGENTS) {
      expect(resolvePollerApiBase(agent, undefined)).toBe("http://localhost");
    }

    for (const file of [
      ...AGENTS.map((agent) => {
        return `agents/${agent}/docker-compose.yml`;
      }),
      ...IMAGE_AGENTS.map((agent) => {
        return `agents/${agent}/Dockerfile.tpl`;
      }),
      ...POLLER_AGENTS.map((agent) => {
        return `agents/${agent}/inventory-snapshot.sh`;
      }),
    ]) {
      const text = readRepoFile(file);
      const pins = [
        `DOCKER_API_VERSION-${OLD_PINNED_DEFAULT}`,
        `DOCKER_API_VERSION:-${OLD_PINNED_DEFAULT}`,
        `DOCKER_API_VERSION=${OLD_PINNED_DEFAULT}`,
      ].filter((pin) => {
        return text.includes(pin);
      });

      expect({ file, pins }).toEqual({ file, pins: [] });
    }
  });

  /*
   * Keeps the Swarm exemption honest: the day DockerSwarmAgent grows an image
   * (or an image agent loses its Dockerfile) this fails, instead of the ENV
   * check silently not applying.
   */
  test("the agents that bake an image are exactly the ones with a Dockerfile.tpl", () => {
    const withDockerfile = AGENTS.filter((agent) => {
      return fs.existsSync(
        path.join(REPO_ROOT, "agents", agent, "Dockerfile.tpl"),
      );
    });

    expect(withDockerfile).toEqual(IMAGE_AGENTS);
  });

  /*
   * The suite works off a hardcoded agent list, so a FOURTH agent added later
   * with a literal pin would sail straight past every assertion above. This is
   * the test that notices.
   */
  test("AGENTS covers every docker_stats receiver in the repo", () => {
    expect(findDockerStatsConfigs()).toEqual(
      AGENTS.map((agent) => {
        return `agents/${agent}/otel-collector-config.yaml`;
      }).sort(),
    );
  });
});

describe("the shipped explanation matches the measured behaviour", () => {
  const SHIPPED_FILES = [
    ...AGENTS.map((agent) => {
      return `agents/${agent}/otel-collector-config.yaml`;
    }),
    ...AGENTS.map((agent) => {
      return `agents/${agent}/README.md`;
    }),
    ...IMAGE_AGENTS.map((agent) => {
      return `agents/${agent}/Dockerfile.tpl`;
    }),
    ...POLLER_AGENTS.map((agent) => {
      return `agents/${agent}/inventory-snapshot.sh`;
    }),
    "packages/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md",
    "packages/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md",
    "packages/App/FeatureSet/Docs/Content/en/telemetry/docker-swarm.md",
  ];

  /*
   * The configs used to say "the receiver default is 1.25, which modern daemons
   * reject". Measured against 0.154.0 and 0.161.0, the receiver's default is 1.44 and 1.25 is
   * its accepted minimum — so that sentence was wrong twice over and steered the
   * reader toward believing an unset variable is dangerous when it is not.
   */
  test.each(SHIPPED_FILES)(
    "%s does not claim the receiver default is 1.25",
    (file) => {
      const text = readRepoFile(file).toLowerCase();
      const claims = text.match(/[^.\n]*receiver[^.\n]*default[^.\n]*/g) || [];

      for (const claim of claims) {
        expect(claim).not.toContain("1.25");
      }
    },
  );

  /*
   * An operator has to be able to find out that the agent negotiates unless
   * DOCKER_API_VERSION is set, and that empty is that default.
   */
  test.each([
    "agents/DockerAgent/README.md",
    "agents/PodmanAgent/README.md",
    "agents/DockerSwarmAgent/README.md",
    "packages/App/FeatureSet/Docs/Content/en/telemetry/docker-host.md",
    "packages/App/FeatureSet/Docs/Content/en/telemetry/podman-host.md",
    "packages/App/FeatureSet/Docs/Content/en/telemetry/docker-swarm.md",
  ])("%s documents that the empty default negotiates", (file) => {
    const text = readRepoFile(file);

    expect(text).toMatch(/DOCKER_API_VERSION/);
    expect(text.toLowerCase()).toMatch(/empty/);
    expect(text.toLowerCase()).toMatch(/negotiat/);
  });
});

describe("translated docs keep the variable in step", () => {
  const CONTENT_ROOT = "packages/App/FeatureSet/Docs/Content";
  const TRANSLATED_PAGES = ["docker-host.md", "podman-host.md"];

  function locales() {
    return fs
      .readdirSync(path.join(REPO_ROOT, CONTENT_ROOT), { withFileTypes: true })
      .filter((entry) => {
        return entry.isDirectory();
      })
      .map((entry) => {
        return entry.name;
      })
      .sort();
  }

  const cases = [];

  for (const locale of locales()) {
    for (const page of TRANSLATED_PAGES) {
      if (
        fs.existsSync(
          path.join(REPO_ROOT, CONTENT_ROOT, locale, "telemetry", page),
        )
      ) {
        cases.push([locale, page]);
      }
    }
  }

  /*
   * These pages exist in 16 locales. The English copy drifting ahead of the rest
   * is the normal failure mode, and it leaves a reader on a German or Japanese
   * page with no way to discover the variable that unbreaks their agent.
   */
  test.each(cases)(
    "%s/telemetry/%s documents DOCKER_API_VERSION",
    (locale, page) => {
      const text = readRepoFile(`${CONTENT_ROOT}/${locale}/telemetry/${page}`);

      expect(text).toContain("DOCKER_API_VERSION");
    },
  );

  test.each(cases)(
    "%s/telemetry/%s carries the troubleshooting entry for the version mismatch",
    (locale, page) => {
      const text = readRepoFile(`${CONTENT_ROOT}/${locale}/telemetry/${page}`);

      expect(text).toContain("client version 1.44 is too new");
    },
  );

  test("every locale that ships these pages was checked", () => {
    expect(cases.length).toBeGreaterThanOrEqual(32);
  });
});
