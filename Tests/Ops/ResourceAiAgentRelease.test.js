"use strict";

/**
 * How the resource AI agent image (oneuptime/resource-ai-agent, built from
 * agents/ResourceAIAgent) is built and released.
 *
 * One image serves every resource the Kubernetes AI agent's approach was
 * extended to: Docker, Podman and Swarm hosts, Proxmox clusters, VMware
 * vCenters, Ceph clusters, database servers and hosts. Each of those agents'
 * docker-compose.yml (and the Docker and Podman install.sh) runs it at the
 * moving `release` tag, next to the collector. It registers with an API
 * (/resource-ai-agent-ingest) that only a server of the same release has, and
 * re-checks every command against its byte-identical copy of the server's
 * resource command policy. So it is released like the Kubernetes AI agent
 * (and the Runner):
 *
 *  - release.yml's build and merge publish version tags only, and `release` /
 *    `enterprise-release` move in push-release-tags, with the App's, after the
 *    three e2e jobs pass. The collector-based agents move `release` at build
 *    time; this one must not get ahead of the server;
 *  - generate-sboms waits for its merge, and generate_sboms.sh scans it (its
 *    drift check against release.yml fails a release that builds an image the
 *    script does not account for);
 *  - pull requests build it in build.yml (amd64), and every push to master
 *    builds both architectures in test-release.yaml with the `test` tags, so
 *    an Alpine package that goes missing for one architecture (docker-cli,
 *    govc, ceph19-common, util-linux-misc) fails before a release does;
 *  - pull requests run the agent's own tests (test.resource-ai-agent.yaml),
 *    including the check that its Common copies have not drifted;
 *  - everything in the repository that tells someone to run the image names a
 *    tag that is published. There is no `latest`.
 *
 * KubernetesAiAgentRelease.test.js checks every workflow's needs graph for
 * needs that name no job and for cycles, so this suite does not repeat that;
 * it pins what is specific to this image.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const {
  findTemplates,
  render,
  parseStages,
} = require("./Utils/DockerfileTemplate");
const {
  needsOf,
  ancestorsOf,
  danglingNeeds,
  stepCommand,
  commandsMentioning,
  flagValue,
  hasFlag,
  callsFor,
  mergedTags,
  matrixPlatforms,
  dockerfileSteps,
  warmUpProblems,
  readBashArray,
} = require("./Utils/ReleaseWorkflow");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = ".github/workflows";
const RELEASE_WORKFLOW = `${WORKFLOWS_DIR}/release.yml`;
const TEST_RELEASE_WORKFLOW = `${WORKFLOWS_DIR}/test-release.yaml`;
const BUILD_WORKFLOW = `${WORKFLOWS_DIR}/build.yml`;
const AGENT_TEST_WORKFLOW = `${WORKFLOWS_DIR}/test.resource-ai-agent.yaml`;
const GENERATE_SBOMS = "Scripts/GHA/generate_sboms.sh";
const COMMON_ACCESS_TYPES =
  "packages/Common/Types/ResourceAiAgent/ResourceAiAccess.ts";

const IMAGE = "resource-ai-agent";
const REPOSITORY = `oneuptime/${IMAGE}`;
const AGENT_DIR = "agents/ResourceAIAgent";
const DOCKERFILE = `./${AGENT_DIR}/Dockerfile`;
const TEMPLATE = `${AGENT_DIR}/Dockerfile.tpl`;
const AGENT_ACCESS_TYPES = `${AGENT_DIR}/Common/Types/ResourceAiAgent/ResourceAiAccess.ts`;
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

/*
 * The moving tags the workflows publish for this image: `release` and
 * `enterprise-release` from push-release-tags, `test` and `enterprise-test`
 * from test-release.yaml's merge. Version tags (and enterprise-<version>) are
 * published too; published() below accepts those by shape.
 */
const MOVING_TAGS = [
  "release",
  "enterprise-release",
  "test",
  "enterprise-test",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readYaml(relativePath) {
  return yaml.load(read(relativePath));
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

/*
 * A reference to the image with a tag: the repository (Docker Hub, or GHCR's
 * ghcr.io/oneuptime/...), a colon, then a `${...}` expansion or a run of
 * characters up to the next space, quote, backtick or closing bracket.
 * Built from REPOSITORY so this file never spells out a reference itself.
 */
const IMAGE_REFERENCE = new RegExp(
  `${REPOSITORY.replace(/[/.-]/g, "\\$&")}:(\\$\\{[^}]*\\}|[^\\s"'\`)\\]},;|]*)`,
  "g",
);

/**
 * Every tag a line of text names for the image, trailing sentence
 * punctuation removed.
 * @param {string} text
 * @returns {Array<string>}
 */
function tagsReferencedIn(text) {
  return [...text.matchAll(IMAGE_REFERENCE)].map((match) => {
    return match[1].replace(/[.:]+$/, "");
  });
}

/**
 * Whether a referenced tag is one the workflows publish (or one that is not
 * written down here at all: an expansion, a documentation placeholder, or a
 * reference whose tag is added by code).
 * @param {string} tag
 * @returns {boolean}
 */
function published(tag) {
  if (tag === "" || tag.startsWith("$") || /^<[^>]+>$/.test(tag)) {
    return true;
  }
  if (MOVING_TAGS.includes(tag)) {
    return true;
  }
  return /^(enterprise-)?\d+\.\d+\.\d+(-test)?$/.test(tag);
}

/**
 * Every file:line in the repository (tracked, or new and not ignored) that
 * names the image with a tag, and the tag. git grep, because it already
 * skips node_modules, build output and everything else .gitignore lists.
 * @returns {Array<{where: string, tag: string}>}
 */
function imageReferences() {
  const result = spawnSync(
    "git",
    [
      "grep",
      "--untracked",
      "-I",
      "-n",
      "-F",
      `${REPOSITORY}:`,
      "--",
      ".",
      ":!**/package-lock.json",
    ],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );

  // git grep exits 1 when nothing matches, and 2+ when it could not search.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git grep failed: ${result.stderr || result.error}`);
  }

  return result.stdout
    .split("\n")
    .filter((line) => {
      return line.length > 0;
    })
    .flatMap((line) => {
      const [file, lineNumber, ...rest] = line.split(":");
      return tagsReferencedIn(rest.join(":")).map((tag) => {
        return { where: `${file}:${lineNumber}`, tag };
      });
    });
}

describe("the release checks' own machinery", () => {
  test("reads needs written as one name, a list, or not at all, and follows them transitively", () => {
    const jobs = {
      top: { needs: ["left", "right"] },
      left: { needs: "base" },
      right: { needs: ["base", "missing"] },
      base: {},
    };

    expect(needsOf({ needs: "a" })).toEqual(["a"]);
    expect(needsOf({})).toEqual([]);
    expect(needsOf(undefined)).toEqual([]);
    expect([...ancestorsOf(jobs, "top")].sort()).toEqual([
      "base",
      "left",
      "right",
    ]);
    expect(danglingNeeds(jobs)).toEqual(["right -> missing"]);
  });

  test("reads flags from multi-line build and merge calls, and tells this image from a longer name", () => {
    const job = {
      steps: [
        { uses: "actions/checkout@v4" },
        {
          run: [
            "bash ./Scripts/GHA/build_docker_images.sh \\",
            `  --image ${IMAGE} \\`,
            `  --version "${RELEASE_VERSION}" \\`,
            `  --dockerfile ${DOCKERFILE} \\`,
            "  --extra-tags release",
          ].join("\n"),
        },
        {
          run: [
            "bash ./Scripts/GHA/build_docker_images.sh \\",
            `  --image ${IMAGE}-other \\`,
            "  --dockerfile ./elsewhere/Dockerfile",
          ].join("\n"),
        },
        {
          run: [
            'VERSION="1.2.3"',
            "bash ./Scripts/GHA/merge_docker_manifests.sh \\",
            `  --image ${IMAGE} \\`,
            '  --tags "${SANITIZED_VERSION}, enterprise-${SANITIZED_VERSION}"',
          ].join("\n"),
        },
      ],
    };
    const builds = callsFor({ job }, "build_docker_images.sh", IMAGE);
    const [merge] = callsFor({ job }, "merge_docker_manifests.sh", IMAGE);

    expect(builds).toHaveLength(1);
    expect(flagValue(builds[0].command, "--version")).toBe(RELEASE_VERSION);
    expect(flagValue(builds[0].command, "--dockerfile")).toBe(DOCKERFILE);
    expect(hasFlag(builds[0].command, "--extra-tags")).toBe(true);
    expect(hasFlag(builds[0].command, "--extra-enterprise-tags")).toBe(false);
    expect(mergedTags(merge.command)).toEqual([
      "${SANITIZED_VERSION}",
      "enterprise-${SANITIZED_VERSION}",
    ]);
    expect(callsFor({ job }, "build_docker_images.sh", "resource-ai")).toEqual(
      [],
    );
    expect(mergedTags("merge_docker_manifests.sh --image x")).toEqual([]);
  });

  test("names a Dockerfile built without its base images warmed first (negative control)", () => {
    const warm = {
      run: `bash ./Scripts/GHA/warm_base_images.sh ${DOCKERFILE}`,
    };
    const build = {
      uses: "nick-fields/retry@v3",
      with: { command: `sudo docker build --no-cache -f ${DOCKERFILE} .` },
    };

    expect(stepCommand(build)).toContain("docker build");
    expect(dockerfileSteps({ steps: [warm, build] })).toEqual({
      built: [{ dockerfile: DOCKERFILE, index: 1 }],
      warmed: [{ dockerfile: DOCKERFILE, index: 0 }],
    });
    expect(warmUpProblems({ steps: [warm, build] })).toEqual([]);
    expect(warmUpProblems({ steps: [build] })).toEqual([
      `builds ${DOCKERFILE} without warming its base images`,
    ]);
    expect(warmUpProblems({ steps: [build, warm] })).toEqual([
      `warms ${DOCKERFILE} only after building it`,
    ]);
  });

  test("reads a bash array the way bash does", () => {
    const script = [
      "IMAGES=(",
      "\t# a comment, not an item",
      "\tapp",
      `\t"${IMAGE}" # trailing comment`,
      ")",
    ].join("\n");

    expect(readBashArray(script, "IMAGES")).toEqual(["app", IMAGE]);
    expect(readBashArray(script, "MISSING")).toBeNull();
  });

  test("finds the image's tags in compose files, install scripts and prose, and refuses a tag nobody publishes (negative control)", () => {
    const ref = (tag) => {
      return `${REPOSITORY}:${tag}`;
    };

    expect(tagsReferencedIn(`    image: ${ref("release")}`)).toEqual([
      "release",
    ]);
    expect(
      tagsReferencedIn(
        `AI_IMAGE="\${ONEUPTIME_AI_AGENT_IMAGE:-${ref("release")}}"`,
      ),
    ).toEqual(["release"]);
    expect(tagsReferencedIn(`Run \`ghcr.io/${ref("test")}\`.`)).toEqual([
      "test",
    ]);
    expect(tagsReferencedIn(`Pin ${ref("14.0.8")}.`)).toEqual(["14.0.8"]);
    expect(tagsReferencedIn(`image: ${ref("${TAG}")}`)).toEqual(["${TAG}"]);
    expect(tagsReferencedIn(`docker pull ${ref("<version>")}`)).toEqual([
      "<version>",
    ]);
    expect(tagsReferencedIn(`image: ${REPOSITORY}`)).toEqual([]);
    expect(tagsReferencedIn(`image: ${ref("latest")}`)).toEqual(["latest"]);

    for (const tag of [
      "release",
      "enterprise-release",
      "test",
      "enterprise-test",
      "14.0.8",
      "enterprise-14.0.8",
      "14.0.8-test",
      "${TAG}",
      "<version>",
    ]) {
      expect({ tag, published: published(tag) }).toEqual({
        tag,
        published: true,
      });
    }
    for (const tag of ["latest", "main", "master", "stable", "14", "v14.0.8"]) {
      expect({ tag, published: published(tag) }).toEqual({
        tag,
        published: false,
      });
    }
  });
});

describe("the image", () => {
  test("is built from a template the repository renders", () => {
    expect(findTemplates(REPO_ROOT)).toContain(TEMPLATE);
    expect(`${path.posix.normalize(DOCKERFILE)}.tpl`).toBe(TEMPLATE);
  });

  test("is the repository the server names (docs, gap messages, install snippets), in the server's types and the agent's copy of them", () => {
    for (const file of [COMMON_ACCESS_TYPES, AGENT_ACCESS_TYPES]) {
      expect({ file, text: read(file) }).toEqual({
        file,
        text: expect.stringMatching(
          new RegExp(
            `export const RESOURCE_AI_AGENT_IMAGE_REPOSITORY: string =\\s*"${REPOSITORY}";`,
          ),
        ),
      });
    }
  });

  test("its package is versioned with the release (SyncPackageVersions.js --check gates release.yml on it)", () => {
    const pkg = readJson(`${AGENT_DIR}/package.json`);

    expect(pkg.name).toBe(`@oneuptime/${IMAGE}`);
    expect(pkg.version).toBe(read("VERSION").trim());
    expect(readJson(`${AGENT_DIR}/package-lock.json`).version).toBe(
      pkg.version,
    );
  });

  test("has no enterprise target: both tags are the same build, so only the community tag gets an SBOM", () => {
    const stages = parseStages(
      render(read(TEMPLATE), "production", {
        fileExists: (relativePath) => {
          return fs.existsSync(path.join(REPO_ROOT, relativePath));
        },
      }),
    );

    expect(
      stages.map((stage) => {
        return stage.name;
      }),
    ).not.toContain("enterprise");
  });

  test("CI builds it with the Node major the image runs", () => {
    const from = /^FROM\s+\S*\/node:(\d+)-alpine/m.exec(read(TEMPLATE));
    expect(from).not.toBeNull();

    for (const [file, job] of [
      [RELEASE_WORKFLOW, BUILD_JOB],
      [TEST_RELEASE_WORKFLOW, BUILD_JOB],
    ]) {
      const setupNode = readYaml(file).jobs[job].steps.find((step) => {
        return /^actions\/setup-node@/.test(step.uses || "");
      });
      expect({ file, node: String(setupNode.with["node-version"]) }).toEqual({
        file,
        node: from[1],
      });
    }
  });
});

describe("release.yml: the resource AI agent image", () => {
  const jobs = readYaml(RELEASE_WORKFLOW).jobs;
  const builds = callsFor(jobs, "build_docker_images.sh", IMAGE);
  const merges = callsFor(jobs, "merge_docker_manifests.sh", IMAGE);

  test("is built once, by its own job, from agents/ResourceAIAgent's Dockerfile, with the repository as context", () => {
    expect(
      builds.map((build) => {
        return build.job;
      }),
    ).toEqual([BUILD_JOB]);
    expect(flagValue(builds[0].command, "--dockerfile")).toBe(DOCKERFILE);
    expect(flagValue(builds[0].command, "--context")).toBe(".");
    expect(flagValue(builds[0].command, "--git-sha")).toBe("${{ github.sha }}");
  });

  test("renders its Dockerfile from the template (npm run prerun, with the pinned gomplate) before building", () => {
    const steps = jobs[BUILD_JOB].steps;
    const setup = steps.findIndex((step) => {
      return step.uses === "./.github/actions/setup-gomplate";
    });
    const prerun = steps.findIndex((step) => {
      return stepCommand(step).trim() === "npm run prerun";
    });
    const build = steps.findIndex((step) => {
      return stepCommand(step).includes("build_docker_images.sh");
    });

    expect(setup).toBeGreaterThan(-1);
    expect(prerun).toBeGreaterThan(setup);
    expect(build).toBeGreaterThan(prerun);
  });

  test("for amd64 and arm64, each on its own native runner, at this release's version", () => {
    expect(matrixPlatforms(jobs[BUILD_JOB])).toEqual(PLATFORMS);
    expect(
      jobs[BUILD_JOB].strategy.matrix.include.map((leg) => {
        return leg.runner;
      }),
    ).toEqual(["ubuntu-latest", "ubuntu-24.04-arm"]);
    expect(jobs[BUILD_JOB]["runs-on"]).toBe("${{ matrix.runner }}");
    // One leg per platform: the expression has spaces, so it is not a flag
    // value flagValue can read.
    expect(builds[0].command).toContain("--platforms ${{ matrix.platform }}");
    expect(flagValue(builds[0].command, "--version")).toBe(RELEASE_VERSION);
  });

  test("the build starts with the other images, and waits for nothing that could move a release tag", () => {
    expect([...needsOf(jobs[BUILD_JOB])].sort()).toEqual([
      "generate-build-number",
      "read-version",
    ]);
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

  test("nothing else in release.yml retags this image directly", () => {
    // The merge retags through merge_docker_manifests.sh (checked above);
    // any other direct `imagetools create` of this image would be a second
    // place `release` could move from.
    const movers = Object.entries(jobs)
      .filter(([, job]) => {
        const commands = commandsMentioning(job, "imagetools create").join(
          "\n",
        );
        const matrixImages = ((job.strategy || {}).matrix || {}).image || [];
        return (
          commands.includes(IMAGE) ||
          (commands.includes("matrix.image") && matrixImages.includes(IMAGE))
        );
      })
      .map(([name]) => {
        return name;
      });

    expect(movers).toEqual(["push-release-tags"]);
  });

  test("generate-sboms names its merge, so an SBOM is never taken of a tag that was not pushed", () => {
    expect(needsOf(jobs["generate-sboms"])).toContain(MERGE_JOB);
    expect(ancestorsOf(jobs, "generate-sboms").has(BUILD_JOB)).toBe(true);
  });

  test("the GitHub release is not published before this image's release tags have moved", () => {
    const waitsFor = ancestorsOf(jobs, "finalize-github-release");

    for (const job of [MERGE_JOB, "push-release-tags", "generate-sboms"]) {
      expect({ job, waitedFor: waitsFor.has(job) }).toEqual({
        job,
        waitedFor: true,
      });
    }
  });

  test("the jobs it adds need only jobs that exist", () => {
    const own = Object.fromEntries(
      Object.entries(jobs).filter(([name]) => {
        return name.startsWith(`${IMAGE}-`);
      }),
    );

    expect(Object.keys(own).sort()).toEqual([BUILD_JOB, MERGE_JOB]);
    expect(
      danglingNeeds({ ...jobs }).filter((entry) => {
        return entry.startsWith(`${IMAGE}-`) || entry.includes(`-> ${IMAGE}`);
      }),
    ).toEqual([]);
  });
});

describe("generate_sboms.sh: the image is scanned", () => {
  const script = read(GENERATE_SBOMS);
  const scanned = readBashArray(script, "IMAGES");
  const skipped = readBashArray(script, "SKIPPED_IMAGES");
  const enterprise = readBashArray(script, "ENTERPRISE_IMAGES");

  test("it is listed in IMAGES, not skipped, and its enterprise tag is not scanned twice", () => {
    expect(scanned).toContain(IMAGE);
    expect(skipped).not.toContain(IMAGE);
    expect(enterprise).not.toContain(IMAGE);
  });

  test("every image release.yml builds is either scanned or skipped on purpose (the script's own drift check)", () => {
    const built = Object.values(readYaml(RELEASE_WORKFLOW).jobs)
      .flatMap((job) => {
        return commandsMentioning(job, "build_docker_images.sh");
      })
      .map((command) => {
        return flagValue(command, "--image");
      });

    expect([...new Set(built)].sort()).toEqual([...scanned, ...skipped].sort());
  });
});

describe("build.yml: pull requests build the resource AI agent image", () => {
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

  test("renders the Dockerfile with the pinned gomplate first, and warms its base image before building", () => {
    const steps = jobs[PR_BUILD_JOB].steps;
    const setup = steps.findIndex((step) => {
      return step.uses === "./.github/actions/setup-gomplate";
    });
    const prerun = steps.findIndex((step) => {
      return stepCommand(step).trim() === "npm run prerun";
    });
    const { built } = dockerfileSteps(jobs[PR_BUILD_JOB]);

    expect(setup).toBeGreaterThan(-1);
    expect(prerun).toBeGreaterThan(setup);
    expect(built[0].index).toBeGreaterThan(prerun);
    expect(warmUpProblems(jobs[PR_BUILD_JOB])).toEqual([]);
  });

  test("builds without the cache and pushes nothing", () => {
    const all = jobs[PR_BUILD_JOB].steps.map(stepCommand).join("\n");

    expect(all).toMatch(/\bdocker build --no-cache\b/);
    expect(all).not.toMatch(/\bdocker (push|login)\b|build_docker_images\.sh/);
    expect(JSON.stringify(jobs[PR_BUILD_JOB])).not.toContain("secrets.");
  });
});

describe("test-release.yaml: every push to master builds the resource AI agent for both architectures", () => {
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
    expect(needsOf(jobs[BUILD_JOB])).toEqual(
      expect.arrayContaining(["read-version"]),
    );
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

describe("test.resource-ai-agent.yaml: pull requests run the agent's own tests", () => {
  const workflow = readYaml(AGENT_TEST_WORKFLOW);
  const commands = Object.values(workflow.jobs || {})
    .flatMap((job) => {
      return (job.steps || []).map(stepCommand);
    })
    .map((command) => {
      return command.trim().replace(/\s+/g, " ");
    });
  const scripts = readJson(`${AGENT_DIR}/package.json`).scripts;

  test("on every pull request and every push to master", () => {
    // js-yaml reads the `on:` key as the boolean true (YAML 1.1).
    const triggers = workflow.on || workflow[true];

    expect(Object.keys(triggers)).toEqual(
      expect.arrayContaining(["pull_request", "push"]),
    );
    expect(triggers.push.branches).toContain("master");
  });

  test("installs, checks the Common copies, and runs the tests, in the agent's directory", () => {
    const inAgent = commands.filter((command) => {
      return command.startsWith(`cd ${AGENT_DIR} && `);
    });

    expect(inAgent).toEqual([
      `cd ${AGENT_DIR} && npm install`,
      `cd ${AGENT_DIR} && npm run check-common`,
      `cd ${AGENT_DIR} && npm run test`,
    ]);
    expect(scripts["check-common"]).toMatch(/--check\b/);
    // `npm test` compiles first, so a type error fails the workflow too.
    expect(scripts.test).toMatch(/^npm run compile && node --test /);
  });

  test("with the Node major the image runs", () => {
    const from = /^FROM\s+\S*\/node:(\d+)-alpine/m.exec(read(TEMPLATE));
    const setupNode = Object.values(workflow.jobs)
      .flatMap((job) => {
        return job.steps || [];
      })
      .find((step) => {
        return /^actions\/setup-node@/.test(step.uses || "");
      });

    expect(String(setupNode.with["node-version"])).toBe(from[1]);
  });
});

describe("everything that tells someone to run the image names a tag that is published", () => {
  const references = imageReferences();

  test("the image is referenced with a tag somewhere (the check below is not vacuous)", () => {
    // The agent's README shows the compose service every resource runs.
    expect(
      references.filter((reference) => {
        return reference.where.startsWith(`${AGENT_DIR}/README.md:`);
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ tag: "release" })]),
    );
  });

  test("every tag is release, test (or their enterprise-), a version, or a placeholder", () => {
    expect(
      references.filter((reference) => {
        return !published(reference.tag);
      }),
    ).toEqual([]);
  });
});
