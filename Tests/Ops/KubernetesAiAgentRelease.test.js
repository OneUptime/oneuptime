"use strict";

/**
 * How the Kubernetes AI agent image (oneuptime/kubernetes-ai-agent, built from
 * agents/KubernetesAIAgent) is built and released, and the order release.yml
 * publishes things in because of it.
 *
 * The kubernetes-agent chart installs the agent by default, at the moving
 * `release` tag, and the agent talks to an API (/kubernetes-ai-agent-ingest)
 * that only a server of the same release has. So in release.yml:
 *
 *  - its build and merge publish version tags only, and `release` /
 *    `enterprise-release` move in push-release-tags, with the App's, after the
 *    three e2e jobs pass (the Runner's pattern, not the other Kubernetes
 *    agents', which move `release` at build time);
 *  - helm-chart-deploy publishes the charts after that, so no published chart
 *    installs an agent image that does not exist yet. It used to run first;
 *  - the e2e jobs, which used to need helm-chart-deploy, need helm-chart-check
 *    (lint and render, nothing published) instead. push-release-tags needs
 *    the e2e jobs, so keeping the old edge would be a cycle;
 *  - generate-sboms waits for the agent's merge, and the GitHub release is not
 *    published before the charts are.
 *
 * GitHub refuses to run a workflow whose jobs need a job that does not exist,
 * or need each other in a cycle, and nothing on a pull request runs
 * release.yml. So every workflow's needs graph is checked here too.
 *
 * Pull requests build the image in build.yml (amd64), and every push to
 * master builds both architectures in test-release.yaml, so a broken kubectl
 * download or digest fails before a release does.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { findTemplates } = require("./Utils/DockerfileTemplate");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = ".github/workflows";
const RELEASE_WORKFLOW = `${WORKFLOWS_DIR}/release.yml`;
const TEST_RELEASE_WORKFLOW = `${WORKFLOWS_DIR}/test-release.yaml`;
const BUILD_WORKFLOW = `${WORKFLOWS_DIR}/build.yml`;
const CHART_VALUES = "HelmChart/Public/kubernetes-agent/values.yaml";
const COMMON_AI_ACCESS_TYPES =
  "packages/Common/Types/Kubernetes/KubernetesClusterAiAccess.ts";

const IMAGE = "kubernetes-ai-agent";
const DOCKERFILE = "./agents/KubernetesAIAgent/Dockerfile";
const BUILD_JOB = `${IMAGE}-docker-image-build`;
const MERGE_JOB = `${IMAGE}-docker-image-merge`;
const PR_BUILD_JOB = `docker-build-${IMAGE}`;
const RELEASE_VERSION = "${{needs.read-version.outputs.major_minor}}";
const PLATFORMS = ["linux/amd64", "linux/arm64"];
const RELEASE_E2E_JOBS = [
  "test-e2e-release-saas",
  "test-e2e-release-self-hosted",
  "test-e2e-release-enterprise",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readYaml(relativePath) {
  return yaml.load(read(relativePath));
}

/**
 * A job's needs as a list: GitHub accepts one name or a list of names.
 * @param {Object} job
 * @returns {Array<string>}
 */
function needsOf(job) {
  const needs = (job && job.needs) || [];
  return Array.isArray(needs) ? needs : [needs];
}

/**
 * Every job `name` waits for, directly or through the jobs it needs. Names
 * the workflow does not define are left out (danglingNeeds reports them).
 * @param {Object<string, Object>} jobs
 * @param {string} name
 * @returns {Set<string>}
 */
function ancestorsOf(jobs, name) {
  const seen = new Set();
  const pending = [...needsOf(jobs[name])];

  while (pending.length > 0) {
    const next = pending.pop();
    if (seen.has(next) || !jobs[next]) {
      continue;
    }
    seen.add(next);
    pending.push(...needsOf(jobs[next]));
  }

  return seen;
}

/**
 * Every `needs` entry that names no job of the workflow, as "job -> need".
 * @param {Object<string, Object>} jobs
 * @returns {Array<string>}
 */
function danglingNeeds(jobs) {
  return Object.entries(jobs).flatMap(([name, job]) => {
    return needsOf(job)
      .filter((need) => {
        return !Object.prototype.hasOwnProperty.call(jobs, need);
      })
      .map((need) => {
        return `${name} -> ${need}`;
      });
  });
}

/**
 * A cycle in the needs graph, as the path around it (first job repeated at
 * the end), or null when there is none.
 * @param {Object<string, Object>} jobs
 * @returns {Array<string>|null}
 */
function findCycle(jobs) {
  const VISITING = 1;
  const DONE = 2;
  const state = new Map();

  const visit = (name, trail) => {
    if (state.get(name) === DONE || !jobs[name]) {
      return null;
    }
    if (state.get(name) === VISITING) {
      return [...trail.slice(trail.indexOf(name)), name];
    }
    state.set(name, VISITING);
    for (const need of needsOf(jobs[name])) {
      const cycle = visit(need, [...trail, name]);
      if (cycle) {
        return cycle;
      }
    }
    state.set(name, DONE);
    return null;
  };

  for (const name of Object.keys(jobs)) {
    const cycle = visit(name, []);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

/**
 * What a step runs: `run`, or the `command` of a nick-fields/retry step.
 * @param {Object} step
 * @returns {string}
 */
function stepCommand(step) {
  if (typeof step.run === "string") {
    return step.run;
  }
  if (step.with && typeof step.with.command === "string") {
    return step.with.command;
  }
  return "";
}

/**
 * Every command line of a job that mentions `needle`, with backslash
 * continuations joined, so a multi-line call reads as one line.
 * @param {Object} job
 * @param {string} needle
 * @returns {Array<string>}
 */
function commandsMentioning(job, needle) {
  return ((job && job.steps) || [])
    .flatMap((step) => {
      return stepCommand(step)
        .replace(/\\\n\s*/g, " ")
        .split("\n");
    })
    .map((line) => {
      return line.trim().replace(/\s+/g, " ");
    })
    .filter((line) => {
      return line.includes(needle);
    });
}

/**
 * The value of `<flag> <value>` in a command, without surrounding quotes.
 * @param {string} command
 * @param {string} flag
 * @returns {string|undefined}
 */
function flagValue(command, flag) {
  const match = new RegExp(`(?:^|\\s)${flag}\\s+("[^"]*"|\\S+)`).exec(command);
  return match ? match[1].replace(/^"|"$/g, "") : undefined;
}

function hasFlag(command, flag) {
  return new RegExp(`(?:^|\\s)${flag}(?:\\s|=|$)`).test(command);
}

/**
 * Every call of `script` in a workflow whose --image is `image`.
 * @param {Object<string, Object>} jobs
 * @param {string} script
 * @param {string} image
 * @returns {Array<{job: string, command: string}>}
 */
function callsFor(jobs, script, image) {
  return Object.entries(jobs).flatMap(([name, job]) => {
    return commandsMentioning(job, script)
      .filter((command) => {
        return flagValue(command, "--image") === image;
      })
      .map((command) => {
        return { job: name, command };
      });
  });
}

function mergedTags(command) {
  return flagValue(command, "--tags")
    .split(",")
    .map((tag) => {
      return tag.trim();
    });
}

function matrixPlatforms(job) {
  return (((job.strategy || {}).matrix || {}).include || []).map((leg) => {
    return leg.platform;
  });
}

/*
 * What renders a Dockerfile from the Dockerfile.tpl beside it:
 * Scripts/Install/configure.sh, which `npm run prerun` ends in. `npm run dev`
 * runs prerun too, and is read as the script it runs (see expandNpmDev). A
 * fresh checkout has no rendered Dockerfile, and warm_base_images.sh reads the
 * FROM lines of one.
 */
const RENDERS_DOCKERFILES =
  /\bnpm run prerun\b|Scripts\/Install\/configure\.sh/;

/*
 * The dev stack, which the E2E jobs build their e2e container from. It is run
 * from the repository root with --project-directory . (see its header), so its
 * build paths are relative to the root.
 */
const DEV_COMPOSE = "Scripts/Dev/docker-compose.dev.yml";

/* docker compose's own options that take a value, before its subcommand. */
const COMPOSE_OPTIONS_WITH_VALUE = new Set([
  "-f",
  "--file",
  "-p",
  "--project-name",
  "--project-directory",
  "--env-file",
  "--profile",
  "--ansi",
  "--progress",
  "--parallel",
]);

/**
 * Each service of a compose file: the Dockerfile it builds from, relative to
 * the repository root the way a workflow step names it (./packages/E2E/Dockerfile),
 * or undefined when it only pulls an image, and the services it depends on.
 * @param {Object<string, Object>} services
 * @returns {Object<string, {dockerfile: (string|undefined), dependsOn: Array<string>}>}
 */
function composeServices(services) {
  return Object.fromEntries(
    Object.entries(services || {}).map(([name, service]) => {
      const build =
        typeof service.build === "string"
          ? { context: service.build }
          : service.build;
      const dependsOn = service.depends_on || [];
      return [
        name,
        {
          dockerfile: build
            ? `./${path.posix.join(build.context || ".", build.dockerfile || "Dockerfile")}`
            : undefined,
          dependsOn: Array.isArray(dependsOn)
            ? dependsOn
            : Object.keys(dependsOn),
        },
      ];
    }),
  );
}

/**
 * The Dockerfiles a command builds through the dev compose file, each with its
 * offset in the command. An `up`, `create` or `build` of it builds the services
 * it names, or all of them when it names none, and a `run` the one service it
 * runs; either also builds what those depend on, unless --no-deps. Compose
 * builds an image from a service's build section when the image is missing,
 * and on a fresh runner it always is.
 * @param {string} command
 * @param {Object<string, {dockerfile: (string|undefined), dependsOn: Array<string>}>} services
 * @returns {Array<{dockerfile: string, offset: number}>}
 */
function devComposeBuilds(command, services) {
  const builds = [];

  for (const segment of command.matchAll(/[^;&|()\n]+/g)) {
    const words = segment[0].trim().split(/\s+/);
    const at = words.findIndex((word, index) => {
      return word === "compose" && words[index - 1] === "docker";
    });
    if (at === -1) {
      continue;
    }

    const files = [];
    let index = at + 1;
    while (index < words.length && words[index].startsWith("-")) {
      const [option, inlineValue] = words[index].split("=");
      if (option === "-f" || option === "--file") {
        files.push(inlineValue || words[index + 1]);
      }
      index +=
        inlineValue === undefined && COMPOSE_OPTIONS_WITH_VALUE.has(option)
          ? 2
          : 1;
    }
    const usesDevCompose = files.some((file) => {
      return path.posix.normalize(file) === DEV_COMPOSE;
    });
    const subcommand = words[index];
    if (
      !usesDevCompose ||
      !["up", "create", "build", "run"].includes(subcommand)
    ) {
      continue;
    }

    const named = words.slice(index + 1).filter((word) => {
      return Object.prototype.hasOwnProperty.call(services, word);
    });
    const pending =
      subcommand === "run"
        ? named.slice(0, 1)
        : named.length > 0
          ? named
          : Object.keys(services);
    const started = new Set();
    while (pending.length > 0) {
      const name = pending.pop();
      if (started.has(name) || !services[name]) {
        continue;
      }
      started.add(name);
      if (!words.includes("--no-deps")) {
        pending.push(...services[name].dependsOn);
      }
    }
    for (const name of started) {
      if (services[name].dockerfile) {
        builds.push({
          dockerfile: services[name].dockerfile,
          offset: segment.index,
        });
      }
    }
  }

  return builds;
}

const DEV_COMPOSE_SERVICES = composeServices(readYaml(DEV_COMPOSE).services);

/*
 * The root package.json's `dev` script, which the Terraform E2E bring-up runs:
 * it renders the Dockerfiles (prerun) and then builds and starts the dev stack
 * with a `docker compose ... up` of $npm_config_services, which npm sets from
 * `npm run dev --services="..."`.
 */
const NPM_DEV_SCRIPT = JSON.parse(read("package.json")).scripts.dev;

/**
 * A command with each `npm run dev` in it replaced by the script it runs, and
 * $npm_config_services in that by its --services value (none, and compose
 * starts every service), so what it renders and builds is read like any other
 * command's. Only a call in command position is expanded, not one an echo
 * quotes.
 * @param {string} command
 * @returns {string}
 */
function expandNpmDev(command) {
  return command.replace(
    /(^|&&|\|\||[;|(])([ \t]*)npm run dev((?:[ \t]+--[\w-]+(?:=(?:"[^"]*"|'[^']*'|[^\s;&|()]+))?)*)(?=[\s;&|()]|$)/gm,
    (_call, before, space, flags) => {
      const services = /--services=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(flags);
      const value = services
        ? services.slice(1).find((group) => {
            return group !== undefined;
          })
        : "";
      return `${before}${space}${NPM_DEV_SCRIPT.replace(
        /\$\{?npm_config_services\}?/g,
        () => {
          return value;
        },
      )}`;
    },
  );
}

/**
 * Where a job does each thing its base-image warm-up depends on, as the index
 * of the step and the offset in that step's command: the Dockerfiles it builds,
 * with `docker build -f` or through the dev compose file (directly or by
 * `npm run dev`), the ones it warms with warm_base_images.sh, and where it
 * renders the Dockerfiles. Comment lines are no command, and are left out.
 * @param {Object} job
 */
function dockerfileSteps(job) {
  const built = [];
  const warmed = [];
  const rendered = [];

  (job.steps || []).forEach((step, index) => {
    const command = expandNpmDev(
      stepCommand(step)
        .replace(/^[ \t]*#.*$/gm, "")
        .replace(/\\\n\s*/g, " "),
    );
    for (const match of command.matchAll(
      /\bdocker build\b[^\n]*?\s-f\s+(\S+)/g,
    )) {
      built.push({ dockerfile: match[1], index, offset: match.index });
    }
    for (const build of devComposeBuilds(command, DEV_COMPOSE_SERVICES)) {
      built.push({ ...build, index, compose: true });
    }
    for (const match of command.matchAll(
      /warm_base_images\.sh((?:[ \t]+[^\s-]\S*)+)/g,
    )) {
      for (const dockerfile of match[1].trim().split(/\s+/)) {
        warmed.push({ dockerfile, index, offset: match.index });
      }
    }
    const render = command.search(RENDERS_DOCKERFILES);
    if (render !== -1) {
      rendered.push({ index, offset: render });
    }
  });

  return { built, warmed, rendered };
}

/**
 * Whether `a` happens before `b` in a job: an earlier step, or earlier in the
 * same step's command.
 * @param {{index: number, offset: number}} a
 * @param {{index: number, offset: number}} b
 * @returns {boolean}
 */
function happensBefore(a, b) {
  return a.index < b.index || (a.index === b.index && a.offset < b.offset);
}

/**
 * What is wrong with a job's base-image warm-up: a built Dockerfile it does
 * not warm (or warms only after building), a warmed one it never builds, or
 * one rendered from a Dockerfile.tpl that it warms before rendering it.
 * @param {Object} job
 * @returns {Array<string>}
 */
function warmUpProblems(job) {
  const { built, warmed, rendered } = dockerfileSteps(job);
  const problems = [];

  for (const build of built) {
    const warm = warmed.find((candidate) => {
      return candidate.dockerfile === build.dockerfile;
    });
    if (!warm) {
      problems.push(
        `builds ${build.dockerfile} without warming its base images`,
      );
    } else if (!happensBefore(warm, build)) {
      problems.push(`warms ${build.dockerfile} only after building it`);
    }
  }
  for (const warm of warmed) {
    if (
      !built.some((build) => {
        return build.dockerfile === warm.dockerfile;
      })
    ) {
      problems.push(`warms ${warm.dockerfile}, which it never builds`);
    } else if (
      fs.existsSync(path.join(REPO_ROOT, `${warm.dockerfile}.tpl`)) &&
      !rendered.some((render) => {
        return happensBefore(render, warm);
      })
    ) {
      problems.push(`warms ${warm.dockerfile} before rendering it`);
    }
  }

  // A Dockerfile built twice (the App's two targets, the e2e container's two
  // phases) is one problem, not two.
  return [...new Set(problems)];
}

/**
 * The `helm lint` / `helm template` commands of a job, as they would run from
 * HelmChart/Public: output redirection and a `cd` into it are not part of
 * what is checked.
 * @param {Object} job
 * @returns {Array<string>}
 */
function helmChecks(job) {
  return commandsMentioning(job, "helm ")
    .filter((line) => {
      return /^helm (lint|template)\s/.test(line);
    })
    .map((line) => {
      return line.replace(/\s*>\s*\/dev\/null$/, "");
    })
    .sort();
}

describe("the release-order checks' own machinery", () => {
  test("reads needs written as one name, a list, or not at all", () => {
    expect(needsOf({ needs: "a" })).toEqual(["a"]);
    expect(needsOf({ needs: ["a", "b"] })).toEqual(["a", "b"]);
    expect(needsOf({})).toEqual([]);
    expect(needsOf(undefined)).toEqual([]);
  });

  test("follows needs transitively, through a diamond, and past a missing job", () => {
    const jobs = {
      top: { needs: ["left", "right"] },
      left: { needs: "base" },
      right: { needs: ["base", "missing"] },
      base: {},
      unrelated: {},
    };

    expect([...ancestorsOf(jobs, "top")].sort()).toEqual([
      "base",
      "left",
      "right",
    ]);
    expect([...ancestorsOf(jobs, "base")]).toEqual([]);
    expect(danglingNeeds(jobs)).toEqual(["right -> missing"]);
  });

  test("finds a cycle, including a job that needs itself, and nothing in a DAG", () => {
    expect(findCycle({ a: { needs: "b" }, b: { needs: "c" }, c: {} })).toBe(
      null,
    );
    expect(
      findCycle({ a: { needs: "b" }, b: { needs: "c" }, c: { needs: "a" } }),
    ).toEqual(["a", "b", "c", "a"]);
    expect(findCycle({ a: { needs: "a" } })).toEqual(["a", "a"]);
    expect(
      findCycle({
        entry: { needs: "a" },
        a: { needs: "b" },
        b: { needs: "a" },
      }),
    ).toEqual(["a", "b", "a"]);
  });

  test("catches the cycle release.yml would have had, had the e2e jobs kept needing helm-chart-deploy", () => {
    const jobs = {
      "helm-chart-deploy": { needs: ["push-release-tags"] },
      "push-release-tags": { needs: ["test-e2e-release-saas"] },
      "test-e2e-release-saas": { needs: ["helm-chart-deploy"] },
    };

    expect(findCycle(jobs)).toEqual([
      "helm-chart-deploy",
      "push-release-tags",
      "test-e2e-release-saas",
      "helm-chart-deploy",
    ]);
  });

  test("reads flags from multi-line build and merge calls", () => {
    const job = {
      steps: [
        { uses: "actions/checkout@v4" },
        {
          run: [
            "bash ./Scripts/GHA/build_docker_images.sh \\",
            "  --image kubernetes-ai-agent \\",
            '  --version "${{needs.read-version.outputs.major_minor}}" \\',
            "  --dockerfile ./agents/KubernetesAIAgent/Dockerfile \\",
            "  --extra-tags release",
          ].join("\n"),
        },
        {
          run: [
            'VERSION="1.2.3"',
            "bash ./Scripts/GHA/merge_docker_manifests.sh \\",
            "  --image kubernetes-ai-agent \\",
            '  --tags "${SANITIZED_VERSION}, enterprise-${SANITIZED_VERSION}"',
          ].join("\n"),
        },
      ],
    };
    const [build] = callsFor(
      { job },
      "build_docker_images.sh",
      "kubernetes-ai-agent",
    );
    const [merge] = callsFor(
      { job },
      "merge_docker_manifests.sh",
      "kubernetes-ai-agent",
    );

    expect(flagValue(build.command, "--version")).toBe(RELEASE_VERSION);
    expect(flagValue(build.command, "--dockerfile")).toBe(DOCKERFILE);
    expect(hasFlag(build.command, "--extra-tags")).toBe(true);
    expect(hasFlag(build.command, "--extra-enterprise-tags")).toBe(false);
    expect(mergedTags(merge.command)).toEqual([
      "${SANITIZED_VERSION}",
      "enterprise-${SANITIZED_VERSION}",
    ]);
    expect(
      callsFor({ job }, "build_docker_images.sh", "kubernetes-ai"),
    ).toEqual([]);
  });

  test("names a Dockerfile that is built without its base images warmed first, and a warm-up for nothing (negative control)", () => {
    const warm = (dockerfile) => {
      return { run: `bash ./Scripts/GHA/warm_base_images.sh ${dockerfile}` };
    };
    const build = (dockerfile) => {
      return {
        uses: "nick-fields/retry@v3",
        with: { command: `sudo docker build --no-cache -f ${dockerfile} .` },
      };
    };

    expect(
      warmUpProblems({
        steps: [warm("./a/Dockerfile"), build("./a/Dockerfile")],
      }),
    ).toEqual([]);
    expect(warmUpProblems({ steps: [build("./a/Dockerfile")] })).toEqual([
      "builds ./a/Dockerfile without warming its base images",
    ]);
    expect(
      warmUpProblems({
        steps: [build("./a/Dockerfile"), warm("./a/Dockerfile")],
      }),
    ).toEqual(["warms ./a/Dockerfile only after building it"]);
    expect(
      warmUpProblems({
        steps: [warm("./b/Dockerfile"), build("./a/Dockerfile")],
      }),
    ).toEqual([
      "builds ./a/Dockerfile without warming its base images",
      "warms ./b/Dockerfile, which it never builds",
    ]);
    // Two targets of one Dockerfile (the App's editions) need one warm-up.
    expect(
      warmUpProblems({
        steps: [
          warm("./a/Dockerfile"),
          build("./a/Dockerfile"),
          {
            with: {
              command:
                "sudo docker build --target enterprise -t x -f ./a/Dockerfile .",
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  test("reads which Dockerfiles a dev compose command builds, and nothing from other compose files or subcommands", () => {
    const dev =
      "docker compose --project-directory . -f Scripts/Dev/docker-compose.dev.yml";
    const services = composeServices({
      db: { image: "postgres:15" },
      app: {
        build: { context: ".", dockerfile: "./packages/App/Dockerfile" },
        depends_on: { db: { condition: "service_healthy" } },
      },
      e2e: { build: { context: ".", dockerfile: "./packages/E2E/Dockerfile" } },
      home: { build: "./packages/Home", depends_on: ["app"] },
    });
    const dockerfiles = (command) => {
      return devComposeBuilds(command, services)
        .map((build) => {
          return build.dockerfile;
        })
        .sort();
    };

    expect(services.home.dockerfile).toBe("./packages/Home/Dockerfile");
    expect(
      dockerfiles(
        `${dev} up --exit-code-from e2e --abort-on-container-exit e2e || (${dev} logs e2e; exit 1)`,
      ),
    ).toEqual(["./packages/E2E/Dockerfile"]);
    expect(
      dockerfiles(`${dev} run --rm e2e npm run test-enterprise-licensed`),
    ).toEqual(["./packages/E2E/Dockerfile"]);
    // What a service depends on is started, and built, with it.
    expect(dockerfiles(`${dev} up -d home`)).toEqual([
      "./packages/App/Dockerfile",
      "./packages/Home/Dockerfile",
    ]);
    expect(dockerfiles(`${dev} up -d --no-deps home`)).toEqual([
      "./packages/Home/Dockerfile",
    ]);
    // No service named is every service.
    expect(
      dockerfiles(
        "docker compose --file=Scripts/Dev/docker-compose.dev.yml build",
      ),
    ).toEqual([
      "./packages/App/Dockerfile",
      "./packages/E2E/Dockerfile",
      "./packages/Home/Dockerfile",
    ]);
    expect(dockerfiles(`${dev} logs e2e`)).toEqual([]);
    expect(
      dockerfiles(
        "docker compose -f docker-compose.yml -f packages/E2E/docker-compose.e2e.yml up e2e",
      ),
    ).toEqual([]);
    expect(dockerfiles(`COMPOSE="${dev}"\n$COMPOSE ps -a`)).toEqual([]);
  });

  test("reads `npm run dev` as the script it runs, building the services its --services names", () => {
    const services = composeServices({
      db: { image: "postgres:15" },
      app: {
        build: { context: ".", dockerfile: "./packages/App/Dockerfile" },
        depends_on: ["db"],
      },
      e2e: { build: { context: ".", dockerfile: "./packages/E2E/Dockerfile" } },
      home: { build: "./packages/Home", depends_on: ["app"] },
    });
    const dockerfiles = (command) => {
      return devComposeBuilds(expandNpmDev(command), services)
        .map((build) => {
          return build.dockerfile;
        })
        .sort();
    };

    expect(
      dockerfiles('npm run dev --services="app" && npm run status-check'),
    ).toEqual(["./packages/App/Dockerfile"]);
    expect(dockerfiles("npm run dev --services=home")).toEqual([
      "./packages/App/Dockerfile",
      "./packages/Home/Dockerfile",
    ]);
    // Without --services, compose starts, and builds, every service.
    expect(dockerfiles("npm run dev")).toEqual([
      "./packages/App/Dockerfile",
      "./packages/E2E/Dockerfile",
      "./packages/Home/Dockerfile",
    ]);
    // It renders the Dockerfiles before it builds them, as its script does.
    const expanded = expandNpmDev('npm run dev --services="app"');
    expect(expanded.search(RENDERS_DOCKERFILES)).toBeGreaterThan(-1);
    expect(expanded.search(RENDERS_DOCKERFILES)).toBeLessThan(
      expanded.indexOf("docker compose"),
    );
    // Only a call is read, not a mention or another script.
    expect(dockerfiles('echo "then npm run dev"')).toEqual([]);
    expect(dockerfiles("npm run dev-server")).toEqual([]);
    expect(
      warmUpProblems({ steps: [{ run: "# how `npm run dev` started it" }] }),
    ).toEqual([]);

    // Against the real compose file, a warm-up of the App before the
    // Terraform E2E bring-up's `npm run dev` is held to the same rule.
    const app = "./packages/App/Dockerfile";
    const bringUp = {
      uses: "nick-fields/retry@v3",
      with: {
        command: 'npm run dev --services="app" && npm run status-check',
      },
    };
    const warm = { run: `bash ./Scripts/GHA/warm_base_images.sh ${app}` };
    expect(
      warmUpProblems({
        steps: [
          {
            run: `npm run prerun\nbash ./Scripts/GHA/warm_base_images.sh ${app}`,
          },
          bringUp,
        ],
      }),
    ).toEqual([]);
    expect(warmUpProblems({ steps: [bringUp] })).toEqual([
      `builds ${app} without warming its base images`,
    ]);
    expect(warmUpProblems({ steps: [warm, bringUp] })).toEqual([
      `warms ${app} before rendering it`,
    ]);
    expect(warmUpProblems({ steps: [bringUp, warm] })).toEqual([
      `warms ${app} only after building it`,
    ]);
  });

  test("names a warm-up that runs before the Dockerfile it reads is rendered (negative control)", () => {
    // Real paths: whether a Dockerfile is rendered is read from the checkout,
    // and packages/E2E has a Dockerfile.tpl.
    const e2e = "./packages/E2E/Dockerfile";
    const prerun = { run: "npm run prerun" };
    const warm = {
      run: `bash ./Scripts/GHA/warm_base_images.sh ${e2e}`,
    };
    const build = {
      run: `docker compose --project-directory . -f ${DEV_COMPOSE} up --exit-code-from e2e e2e`,
    };

    expect(fs.existsSync(path.join(REPO_ROOT, `${e2e}.tpl`))).toBe(true);
    expect(warmUpProblems({ steps: [prerun, warm, build] })).toEqual([]);
    expect(warmUpProblems({ steps: [warm, prerun, build] })).toEqual([
      `warms ${e2e} before rendering it`,
    ]);
    expect(warmUpProblems({ steps: [warm, build] })).toEqual([
      `warms ${e2e} before rendering it`,
    ]);
    expect(warmUpProblems({ steps: [prerun, build, warm] })).toEqual([
      `warms ${e2e} only after building it`,
    ]);
    expect(warmUpProblems({ steps: [prerun, build, build] })).toEqual([
      `builds ${e2e} without warming its base images`,
    ]);
    // Within one step, the order of its commands is what counts.
    expect(
      warmUpProblems({
        steps: [
          {
            run: `set -euo pipefail\nnpm run prerun\nbash ./Scripts/GHA/warm_base_images.sh ${e2e}`,
          },
          build,
        ],
      }),
    ).toEqual([]);
    expect(
      warmUpProblems({
        steps: [
          {
            run: `bash ./Scripts/GHA/warm_base_images.sh ${e2e}\nnpm run prerun`,
          },
          build,
        ],
      }),
    ).toEqual([`warms ${e2e} before rendering it`]);
  });

  test("compares helm checks without their redirection", () => {
    const job = {
      steps: [
        {
          run: "cd oneuptime/HelmChart/Public\nhelm lint oneuptime\nhelm template oneuptime --values oneuptime/values.yaml\nhelm package oneuptime",
        },
      ],
    };
    const check = {
      steps: [
        {
          run: "helm template oneuptime --values oneuptime/values.yaml > /dev/null\nhelm lint oneuptime",
        },
      ],
    };

    expect(helmChecks(check)).toEqual(helmChecks(job));
    expect(helmChecks(job)).toEqual([
      "helm lint oneuptime",
      "helm template oneuptime --values oneuptime/values.yaml",
    ]);
  });
});

const workflowFiles = fs
  .readdirSync(path.join(REPO_ROOT, WORKFLOWS_DIR))
  .filter((file) => {
    return /\.ya?ml$/.test(file);
  })
  .sort()
  .map((file) => {
    return `${WORKFLOWS_DIR}/${file}`;
  });

describe("every workflow's needs graph is one GitHub will run", () => {
  test("there are workflows to check, release.yml among them", () => {
    expect(workflowFiles).toContain(RELEASE_WORKFLOW);
    expect(workflowFiles).toContain(TEST_RELEASE_WORKFLOW);
  });

  test.each(workflowFiles)(
    "%s: every need names a job of the workflow",
    (file) => {
      expect(danglingNeeds(readYaml(file).jobs || {})).toEqual([]);
    },
  );

  test.each(workflowFiles)("%s: no jobs need each other in a cycle", (file) => {
    expect(findCycle(readYaml(file).jobs || {})).toBeNull();
  });
});

describe("release.yml: the Kubernetes AI agent image", () => {
  const jobs = readYaml(RELEASE_WORKFLOW).jobs;
  const builds = callsFor(jobs, "build_docker_images.sh", IMAGE);
  const merges = callsFor(jobs, "merge_docker_manifests.sh", IMAGE);

  test("is built once, by its own job, from agents/KubernetesAIAgent's Dockerfile", () => {
    expect(
      builds.map((build) => {
        return build.job;
      }),
    ).toEqual([BUILD_JOB]);
    expect(flagValue(builds[0].command, "--dockerfile")).toBe(DOCKERFILE);
    expect(findTemplates(REPO_ROOT)).toContain(
      `${path.posix.normalize(DOCKERFILE)}.tpl`,
    );
    expect(flagValue(builds[0].command, "--context")).toBe(".");
  });

  test("for amd64 and arm64, at this release's version", () => {
    expect(matrixPlatforms(jobs[BUILD_JOB])).toEqual(PLATFORMS);
    // One leg per platform: the expression has spaces, so it is not a flag
    // value flagValue can read.
    expect(builds[0].command).toContain("--platforms ${{ matrix.platform }}");
    expect(flagValue(builds[0].command, "--version")).toBe(RELEASE_VERSION);
    expect(needsOf(jobs[BUILD_JOB])).toEqual(
      expect.arrayContaining(["read-version"]),
    );
  });

  test("the build publishes version tags only: no release tag moves before the e2e jobs pass", () => {
    expect(hasFlag(builds[0].command, "--extra-tags")).toBe(false);
    expect(hasFlag(builds[0].command, "--extra-enterprise-tags")).toBe(false);
  });

  test("the merge publishes <version> and enterprise-<version>, once the build is done", () => {
    expect(
      merges.map((merge) => {
        return merge.job;
      }),
    ).toEqual([MERGE_JOB]);
    expect(needsOf(jobs[MERGE_JOB])).toEqual(
      expect.arrayContaining([BUILD_JOB, "read-version"]),
    );
    expect(mergedTags(merges[0].command)).toEqual([
      "${SANITIZED_VERSION}",
      "enterprise-${SANITIZED_VERSION}",
    ]);
    expect(
      commandsMentioning(jobs[MERGE_JOB], "VERSION=").join("\n"),
    ).toContain(`VERSION="${RELEASE_VERSION}"`);
  });

  test("push-release-tags moves its release and enterprise-release tags, with the App's, after the three e2e jobs", () => {
    const push = jobs["push-release-tags"];

    expect(push.strategy.matrix.image).toEqual(
      expect.arrayContaining([IMAGE, "app"]),
    );
    expect(needsOf(push)).toEqual(
      expect.arrayContaining([
        MERGE_JOB,
        "app-docker-image-merge",
        ...RELEASE_E2E_JOBS,
      ]),
    );

    const commands = commandsMentioning(push, "imagetools create").join("\n");
    for (const tag of ["release", "enterprise-release"]) {
      expect(commands).toContain(`--tag oneuptime/\${{ matrix.image }}:${tag}`);
      expect(commands).toContain(
        `--tag ghcr.io/oneuptime/\${{ matrix.image }}:${tag}`,
      );
    }
  });

  test("generate-sboms names its merge, so an SBOM is never taken of a tag that was not pushed", () => {
    expect(needsOf(jobs["generate-sboms"])).toContain(MERGE_JOB);
  });
});

describe("release.yml: the charts are published after the images they install", () => {
  const jobs = readYaml(RELEASE_WORKFLOW).jobs;
  const values = readYaml(CHART_VALUES);

  test("the kubernetes-agent chart installs this image by default", () => {
    expect(values.aiAgent.enabled).toBe(true);
    expect(values.aiAgent.image.repository).toBe(`oneuptime/${IMAGE}`);
    // The server names the same image (docs, gap messages, status).
    expect(read(COMMON_AI_ACCESS_TYPES)).toMatch(
      new RegExp(
        `export const KUBERNETES_AI_AGENT_IMAGE_REPOSITORY: string =\\s*"oneuptime/${IMAGE}";`,
      ),
    );
  });

  test("helm-chart-deploy waits for the image's version tags, its release tags and every e2e job", () => {
    const waitsFor = ancestorsOf(jobs, "helm-chart-deploy");

    expect(needsOf(jobs["helm-chart-deploy"])).toContain("push-release-tags");
    for (const job of [MERGE_JOB, "push-release-tags", ...RELEASE_E2E_JOBS]) {
      expect({ job, waitedFor: waitsFor.has(job) }).toEqual({
        job,
        waitedFor: true,
      });
    }
  });

  test("the e2e jobs need helm-chart-check, and nothing they wait for waits for the chart publish", () => {
    for (const job of RELEASE_E2E_JOBS) {
      expect(needsOf(jobs[job])).toContain("helm-chart-check");
      expect(ancestorsOf(jobs, job).has("helm-chart-deploy")).toBe(false);
    }
    expect(ancestorsOf(jobs, "push-release-tags").has("helm-chart-check")).toBe(
      true,
    );
  });

  test("helm-chart-check runs at the start, not after any image", () => {
    for (const job of ancestorsOf(jobs, "helm-chart-check")) {
      expect(["read-version", "generate-build-number"]).toContain(job);
    }
  });

  test("helm-chart-check lints and renders exactly what helm-chart-deploy does, and publishes nothing", () => {
    const check = jobs["helm-chart-check"];
    const deployed = helmChecks(jobs["helm-chart-deploy"]);

    // Both charts, linted and rendered.
    expect(deployed).toHaveLength(4);
    expect(helmChecks(check)).toEqual(deployed);

    const all = (check.steps || []).map(stepCommand).join("\n");
    expect(all).not.toMatch(/\bhelm (package|push)\b|\bgit (push|commit)\b/);
    expect(JSON.stringify(check)).not.toContain("secrets.");
  });

  test("the GitHub release is not published before the charts are", () => {
    expect(
      ancestorsOf(jobs, "finalize-github-release").has("helm-chart-deploy"),
    ).toBe(true);
  });
});

describe("build.yml: pull requests build the Kubernetes AI agent image", () => {
  const jobs = readYaml(BUILD_WORKFLOW).jobs;
  const releaseBuild = callsFor(
    readYaml(RELEASE_WORKFLOW).jobs,
    "build_docker_images.sh",
    IMAGE,
  )[0];

  test("from the Dockerfile the release builds", () => {
    expect(jobs[PR_BUILD_JOB]).toBeDefined();
    expect(
      dockerfileSteps(jobs[PR_BUILD_JOB]).built.map((build) => {
        return build.dockerfile;
      }),
    ).toEqual([flagValue(releaseBuild.command, "--dockerfile")]);
  });

  const dockerBuildJobs = Object.entries(jobs).filter(([, job]) => {
    return dockerfileSteps(job).built.length > 0;
  });

  test("the Build workflow's image jobs are found", () => {
    expect(
      dockerBuildJobs.map(([name]) => {
        return name;
      }),
    ).toEqual(expect.arrayContaining([PR_BUILD_JOB, "docker-build-runner"]));
  });

  test.each(dockerBuildJobs)(
    "%s warms the base images of exactly the Dockerfiles it builds, before building them",
    (_name, job) => {
      expect(warmUpProblems(job)).toEqual([]);
    },
  );
});

/*
 * The images the dev compose file builds start FROM public.ecr.aws Node
 * images, the log collectors' aside, and ECR serves anonymous pullers from one
 * data quota that busy CI windows exhaust. So a job that builds from that file
 * warms those images first, from Docker Hub if need be, and compose's default
 * builder then finds them locally (see Scripts/GHA/warm_base_images.sh). As in
 * build.yml, it names every Dockerfile it builds. The warm-up reads the
 * rendered Dockerfiles, so prerun has to come first. Both ways of building
 * from it are read: a `docker compose -f` of it, and `npm run dev`, which the
 * Terraform E2E bring-up builds app and ingress with. (The E2E jobs of
 * test-release.yaml built their e2e container the first way until they began
 * running the image the workflow pushes.) Other npm scripts that build from
 * it (`build`, `force-build`) are not read, and no workflow runs them.
 */
describe("every job that builds from the dev compose file warms the base images first", () => {
  const composeBuildJobs = workflowFiles.flatMap((file) => {
    return Object.entries(readYaml(file).jobs || {})
      .filter(([, job]) => {
        return dockerfileSteps(job).built.some((build) => {
          return build.compose;
        });
      })
      .map(([name, job]) => {
        return [`${file}: ${name}`, job];
      });
  });
  const builtBy = (label) => {
    const found = composeBuildJobs.find(([name]) => {
      return name === label;
    });
    return found
      ? dockerfileSteps(found[1]).built.map((build) => {
          return build.dockerfile;
        })
      : [];
  };

  /*
   * test-release.yaml's E2E jobs used to build their e2e container from this
   * file, once in every job. They now run the e2e image the workflow's own
   * e2e-docker-image-build pushed, as release.yml's E2E jobs do, so there is
   * nothing for them to build or warm here. They must wait for that image's
   * merge, or they would run the previous push's suite against this push's
   * stack.
   */
  test("test-release.yaml's E2E jobs build nothing from it: they run the e2e image the workflow pushed", () => {
    const jobs = readYaml(TEST_RELEASE_WORKFLOW).jobs;

    expect(
      readYaml("packages/E2E/docker-compose.e2e.yml").services.e2e.image,
    ).toBe("ghcr.io/oneuptime/e2e:${APP_TAG}");

    for (const job of [
      "test-e2e-test-saas",
      "test-e2e-test-self-hosted",
      "test-e2e-test-enterprise",
    ]) {
      const commands = jobs[job].steps.map(stepCommand).join("\n");

      expect({
        job,
        built: builtBy(`${TEST_RELEASE_WORKFLOW}: ${job}`),
      }).toEqual({ job, built: [] });
      expect({ job, needs: needsOf(jobs[job]) }).toEqual({
        job,
        needs: expect.arrayContaining(["e2e-docker-image-merge"]),
      });
      expect({
        job,
        runsThePushedImage:
          /-f packages\/E2E\/docker-compose\.e2e\.yml (?:up|run)\b[^\n]*\se2e\b/.test(
            commands,
          ),
      }).toEqual({
        job,
        runsThePushedImage: true,
      });
    }
  });

  test("the Terraform E2E bring-up is found, building app and ingress through `npm run dev`", () => {
    expect(
      builtBy(
        `${WORKFLOWS_DIR}/terraform-provider-e2e.yml: terraform-e2e-tests`,
      ),
    ).toEqual(
      expect.arrayContaining([
        "./packages/App/Dockerfile",
        "./packages/Nginx/Dockerfile",
      ]),
    );
  });

  test.each(composeBuildJobs)(
    "%s renders the Dockerfiles, then warms the base images of exactly the ones it builds, before building them",
    (_label, job) => {
      expect(warmUpProblems(job)).toEqual([]);
    },
  );
});

describe("test-release.yaml: every push to master builds the Kubernetes AI agent for both architectures", () => {
  const jobs = readYaml(TEST_RELEASE_WORKFLOW).jobs;
  const builds = callsFor(jobs, "build_docker_images.sh", IMAGE);
  const merges = callsFor(jobs, "merge_docker_manifests.sh", IMAGE);

  test("from the Dockerfile the release builds, at the -test version, with the test tags", () => {
    expect(
      builds.map((build) => {
        return build.job;
      }),
    ).toEqual([BUILD_JOB]);
    expect(matrixPlatforms(jobs[BUILD_JOB])).toEqual(PLATFORMS);
    expect(flagValue(builds[0].command, "--dockerfile")).toBe(DOCKERFILE);
    expect(flagValue(builds[0].command, "--version")).toBe(
      `${RELEASE_VERSION}-test`,
    );
    expect(flagValue(builds[0].command, "--extra-tags")).toBe("test");
    expect(flagValue(builds[0].command, "--extra-enterprise-tags")).toBe(
      "enterprise-test",
    );
  });

  test("the merge publishes the -test version and the test tags, never release", () => {
    expect(
      merges.map((merge) => {
        return merge.job;
      }),
    ).toEqual([MERGE_JOB]);
    expect(needsOf(jobs[MERGE_JOB])).toContain(BUILD_JOB);
    expect(mergedTags(merges[0].command)).toEqual([
      "${SANITIZED_VERSION}",
      "test",
      "enterprise-${SANITIZED_VERSION}",
      "enterprise-test",
    ]);
    expect(
      commandsMentioning(jobs[MERGE_JOB], "VERSION=").join("\n"),
    ).toContain(`VERSION="${RELEASE_VERSION}-test"`);
  });
});
