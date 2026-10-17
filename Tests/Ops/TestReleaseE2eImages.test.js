"use strict";

/**
 * test-release.yaml's e2e jobs run the amd64 images this run's builds push,
 * and so wait for the builds, not for the merges.
 *
 * Each image's build job is a matrix of two legs, amd64 and arm64, and each
 * leg pushes its own tags with an arch suffix (oneuptime/app:9.9.9-test-amd64);
 * the merge job then joins the two into the multi-arch tag
 * (oneuptime/app:9.9.9-test), whose amd64 entry is the very image the amd64
 * leg pushed. The e2e jobs run on amd64 runners, so the -amd64 tag is what
 * they pulled through the merged tag anyway. A merge is a few seconds of work
 * behind a queue for a runner of its own: on run 38996994440, 14.0.66's e2e
 * evidence, the merges queued 34 to 49 minutes between the last build and the
 * e2e jobs, on the path of every release's evidence.
 *
 * So this suite runs Scripts/GHA/build_docker_images.sh with each build
 * job's own flags, for the amd64 leg, with a fake docker on PATH that records
 * every call, and holds the tag each e2e job boots to the tags that leg
 * pushes - for every image of the job's stack, in the job's edition. A job
 * that booted a tag nothing pushed would fail; one that booted a tag an
 * earlier run pushed would test the wrong image without failing.
 *
 * The merges still run, beside the e2e jobs: test-helm-chart installs the
 * multi-arch `test` tags and waits for them, and a failed merge still fails
 * the run - test-release.yaml has no continue-on-error and no always().
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const {
  needsOf,
  ancestorsOf,
  callsFor,
  flagValue,
  matrixPlatforms,
  stepCommand,
} = require("./Utils/ReleaseWorkflow");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TEST_RELEASE = ".github/workflows/test-release.yaml";
const BUILD_SCRIPT = "Scripts/GHA/build_docker_images.sh";
const E2E_OVERLAY = "packages/E2E/docker-compose.e2e.yml";

// What ${{needs.read-version.outputs.major_minor}} stands for in this suite.
const VERSION = "9.9.9";
const VERSION_EXPRESSION =
  /\$\{\{\s*needs\.read-version\.outputs\.major_minor\s*\}\}/g;

const E2E_JOBS = [
  "test-e2e-test-saas",
  "test-e2e-test-self-hosted",
  "test-e2e-test-enterprise",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const workflowText = read(TEST_RELEASE);
const jobs = yaml.load(workflowText).jobs;

function withVersion(text) {
  return String(text).replace(VERSION_EXPRESSION, VERSION);
}

// The compose files a job's `docker compose ... up ... -d` boots its stack with.
function startedStack(job) {
  const start = (job.steps || []).map(stepCommand).find((command) => {
    return /docker compose [^\n]*\bup\b[^\n]*\s-d\b/.test(command);
  });
  if (!start) {
    throw new Error("the job has no `docker compose ... up -d` step");
  }
  const line = start.split("\n").find((candidate) => {
    return /docker compose [^\n]*\bup\b[^\n]*\s-d\b/.test(candidate);
  });
  return [...line.matchAll(/-f (\S+\.ya?ml)/g)].map((match) => {
    return match[1];
  });
}

/**
 * The OneUptime images a stack runs, as written in the compose files
 * ("oneuptime/app:${APP_TAG}"), each file's services over the last's, and
 * none behind a profile.
 */
function stackImages(composeFiles) {
  const services = {};
  for (const file of composeFiles) {
    for (const [name, service] of Object.entries(
      yaml.load(read(file)).services || {},
    )) {
      services[name] = { ...(services[name] || {}), ...service };
    }
  }
  return Object.values(services)
    .filter((service) => {
      return !service.profiles || service.profiles.length === 0;
    })
    .map((service) => {
      return service.image;
    })
    .filter((image) => {
      return /^(?:ghcr\.io\/)?oneuptime\/[a-z0-9-]+:\$\{APP_TAG\}$/.test(
        image || "",
      );
    })
    .sort();
}

function imageName(reference) {
  return /oneuptime\/([a-z0-9-]+):/.exec(reference)[1];
}

/**
 * The APP_TAG a job boots, as each of its steps names it: every
 * `export APP_TAG=` line and the App image its edition check pulls, with the
 * version expression filled in.
 */
function tagsNamed(job) {
  const named = [];
  for (const step of job.steps || []) {
    for (const match of stepCommand(step).matchAll(
      /^\s*export APP_TAG=(\S+)\s*$/gm,
    )) {
      named.push(withVersion(match[1]));
    }
    const appImage = (step.env || {}).APP_IMAGE;
    if (appImage) {
      named.push(withVersion(appImage).replace(/^oneuptime\/app:/, ""));
    }
  }
  return named;
}

/**
 * The APP_TAG the job's pin step writes into config.env: the step's script,
 * run by bash in an empty directory, read back.
 */
function pinnedTag(job, workDir) {
  const pin = (job.steps || []).find((step) => {
    return /^Pin APP_TAG/.test(step.name || "");
  });
  if (!pin) {
    throw new Error("the job has no step that pins APP_TAG");
  }
  const dir = fs.mkdtempSync(path.join(workDir, "pin-"));
  const result = spawnSync("bash", ["-c", withVersion(pin.run)], {
    cwd: dir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`the pin step failed: ${result.stderr}`);
  }
  const line = fs
    .readFileSync(path.join(dir, "config.env"), "utf8")
    .split("\n")
    .find((candidate) => {
      return candidate.startsWith("APP_TAG=");
    });
  return line.slice("APP_TAG=".length);
}

describe(`${TEST_RELEASE}: the e2e jobs run the amd64 images this run's builds push`, () => {
  let workDir = "";
  let dockerfile = "";
  const pushed = {};

  /**
   * Every tag build_docker_images.sh pushes for `image`'s amd64 leg, called
   * with the flags its build job passes, the version filled in. Both passes,
   * community and enterprise.
   */
  function pushedByTheAmd64Leg(image) {
    if (pushed[image]) {
      return pushed[image];
    }
    const buildJob = jobs[`${image}-docker-image-build`];
    const [call] = callsFor(
      { build: buildJob },
      "build_docker_images.sh",
      image,
    );
    const command = withVersion(call.command);
    const log = path.join(workDir, `docker-${image}`);
    const args = [
      path.join(REPO_ROOT, BUILD_SCRIPT),
      "--image",
      image,
      "--version",
      flagValue(command, "--version"),
      "--dockerfile",
      dockerfile,
      "--context",
      ".",
      "--platforms",
      "linux/amd64",
      "--git-sha",
      "0000000000000000000000000000000000000000",
    ];
    for (const flag of ["--extra-tags", "--extra-enterprise-tags"]) {
      const value = flagValue(command, flag);
      if (value) {
        args.push(flag, value);
      }
    }
    const result = spawnSync("bash", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.join(workDir, "bin")}${path.delimiter}${process.env.PATH}`,
        FAKE_DOCKER_LOG: log,
        RETRY_WITH_BACKOFF_DELAYS: "0 0 0",
        ONEUPTIME_KEEP_ECR_BASE_IMAGES: "true",
      },
    });
    if (result.status !== 0) {
      throw new Error(
        `${BUILD_SCRIPT} failed: ${result.stdout}${result.stderr}`,
      );
    }
    const tags = [];
    const words = fs.readFileSync(log, "utf8").split("\n");
    words.forEach((word, index) => {
      if (word === "--tag") {
        tags.push(words[index + 1]);
      }
    });
    pushed[image] = tags;
    return tags;
  }

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-release-e2e-"));
    fs.mkdirSync(path.join(workDir, "bin"));
    // One argument per line, appended for every call.
    fs.writeFileSync(
      path.join(workDir, "bin", "docker"),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$@" >>"$FAKE_DOCKER_LOG"\nexit 0\n',
      { mode: 0o755 },
    );
    // The tags do not depend on what is built; a stage named enterprise only
    // changes how the editions are told apart.
    dockerfile = path.join(workDir, "Dockerfile");
    fs.writeFileSync(dockerfile, "FROM scratch\n");
  });

  afterAll(() => {
    if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  test("finds every e2e job, its stack and the builds of its images (the checks below are not vacuous)", () => {
    for (const name of E2E_JOBS) {
      const images = [
        ...stackImages(startedStack(jobs[name])),
        ...stackImages([E2E_OVERLAY]),
      ];
      expect(images.length).toBeGreaterThan(3);
      for (const image of images) {
        expect(jobs[`${imageName(image)}-docker-image-build`]).toBeDefined();
      }
    }
  });

  test("the fake docker sees the pushes: the App's amd64 leg pushes both editions, arch-suffixed", () => {
    const tags = pushedByTheAmd64Leg("app");

    expect(tags).toEqual(
      expect.arrayContaining([
        `oneuptime/app:${VERSION}-test-amd64`,
        `ghcr.io/oneuptime/app:${VERSION}-test-amd64`,
        `oneuptime/app:enterprise-${VERSION}-test-amd64`,
        `ghcr.io/oneuptime/app:enterprise-${VERSION}-test-amd64`,
      ]),
    );
    expect(
      tags.filter((tag) => {
        return !tag.endsWith("-amd64");
      }),
    ).toEqual([]);
  });

  describe.each(E2E_JOBS)("%s", (name) => {
    const job = jobs[name];
    const images = [
      ...stackImages(startedStack(job)),
      ...stackImages([E2E_OVERLAY]),
    ];

    test("runs on an amd64 runner", () => {
      expect(job["runs-on"]).toBe("ubuntu-latest");
    });

    test("names one tag, the amd64 one, in every step that names it", () => {
      const named = tagsNamed(job);
      const pinned = pinnedTag(job, workDir);

      expect(named.length).toBeGreaterThanOrEqual(3);
      expect([...new Set([...named, pinned])]).toEqual([pinned]);
      expect(pinned.endsWith("-amd64")).toBe(true);
    });

    test("boots, for every image of its stack, a tag the image's amd64 build leg pushes", () => {
      const tag = pinnedTag(job, workDir);

      for (const image of images) {
        const reference = image.replace("${APP_TAG}", tag);
        expect({
          image,
          pushed: pushedByTheAmd64Leg(imageName(image)),
        }).toEqual({ image, pushed: expect.arrayContaining([reference]) });
      }
    });

    test("waits for each of those builds, whose matrix has the amd64 leg", () => {
      for (const image of images) {
        const build = `${imageName(image)}-docker-image-build`;
        expect(needsOf(job)).toContain(build);
        expect(matrixPlatforms(jobs[build])).toContain("linux/amd64");
      }
    });

    test("waits for no merge, directly or through another job", () => {
      expect(
        [...ancestorsOf(jobs, name)].filter((ancestor) => {
          return ancestor.endsWith("-docker-image-merge");
        }),
      ).toEqual([]);
    });
  });

  test("the editions match: the SaaS and enterprise jobs boot enterprise- tags, the self-hosted job a Community tag", () => {
    expect(pinnedTag(jobs["test-e2e-test-saas"], workDir)).toBe(
      `enterprise-${VERSION}-test-amd64`,
    );
    expect(pinnedTag(jobs["test-e2e-test-enterprise"], workDir)).toBe(
      `enterprise-${VERSION}-test-amd64`,
    );
    expect(pinnedTag(jobs["test-e2e-test-self-hosted"], workDir)).toBe(
      `${VERSION}-test-amd64`,
    );
  });
});

describe(`${TEST_RELEASE}: the merges still run, and still count`, () => {
  const merges = Object.keys(jobs).filter((name) => {
    return name.endsWith("-docker-image-merge");
  });

  test("every image built is merged into its multi-arch tags", () => {
    const builds = Object.keys(jobs).filter((name) => {
      return name.endsWith("-docker-image-build");
    });

    expect(builds.length).toBeGreaterThan(8);
    expect(merges.sort()).toEqual(
      builds
        .map((build) => {
          return build.replace(/-build$/, "-merge");
        })
        .sort(),
    );
    for (const merge of merges) {
      expect(needsOf(jobs[merge])).toContain(
        merge.replace(/-merge$/, "-build"),
      );
    }
  });

  test("test-helm-chart, which installs the multi-arch `test` tags, waits for the merges of what it installs", () => {
    expect(yaml.load(read("HelmChart/Tests/ci-values.yaml")).image.tag).toBe(
      "test",
    );
    expect(
      needsOf(jobs["test-helm-chart"]).filter((need) => {
        return need.endsWith("-docker-image-merge");
      }).length,
    ).toBeGreaterThan(5);
  });

  test("nothing lets a failed job end the run green: no continue-on-error, no always()", () => {
    expect(workflowText).not.toMatch(/continue-on-error/);
    expect(workflowText).not.toMatch(/\balways\(\)/);
  });
});
