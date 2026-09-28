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

/**
 * The Dockerfiles a job builds with `docker build -f`, and the ones it warms
 * with warm_base_images.sh, each with the index of the step that does it.
 * @param {Object} job
 */
function dockerfileSteps(job) {
  const built = [];
  const warmed = [];

  (job.steps || []).forEach((step, index) => {
    const command = stepCommand(step).replace(/\\\n\s*/g, " ");
    for (const match of command.matchAll(
      /\bdocker build\b[^\n]*?\s-f\s+(\S+)/g,
    )) {
      built.push({ dockerfile: match[1], index });
    }
    for (const match of command.matchAll(
      /warm_base_images\.sh((?:[ \t]+[^\s-]\S*)+)/g,
    )) {
      for (const dockerfile of match[1].trim().split(/\s+/)) {
        warmed.push({ dockerfile, index });
      }
    }
  });

  return { built, warmed };
}

/**
 * What is wrong with a job's base-image warm-up: a built Dockerfile it does
 * not warm (or warms only after building), or a warmed one it never builds.
 * @param {Object} job
 * @returns {Array<string>}
 */
function warmUpProblems(job) {
  const { built, warmed } = dockerfileSteps(job);
  const problems = [];

  for (const build of built) {
    const warm = warmed.find((candidate) => {
      return candidate.dockerfile === build.dockerfile;
    });
    if (!warm) {
      problems.push(
        `builds ${build.dockerfile} without warming its base images`,
      );
    } else if (warm.index >= build.index) {
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
    }
  }

  return problems;
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
