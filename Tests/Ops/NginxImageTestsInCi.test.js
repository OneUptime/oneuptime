"use strict";

/**
 * The ingress's image-only tests run in CI, inside the ingress image's base.
 *
 * packages/Nginx/Tests holds tests that run only inside the ingress image,
 * gated on RUN_NGINX_IMAGE_TESTS=1: with PROVISION_SSL,
 * envsubst-on-templates.sh writes the primary's placeholder certificate to
 * /etc/nginx/certs/ServerCerts, which only the image has. Nothing set the
 * variable, so the Nginx Test job, which runs on the runner, skipped them on
 * every run ("set RUN_NGINX_IMAGE_TESTS=1"), and the script's own
 * PROVISION_SSL path - the placeholder certificate, the primary's 7850
 * listens and their IPv6 twins, nginx -t on the result - was checked by
 * nobody (#8286).
 *
 * The image job of test.nginx.yaml builds the ingress image's own base stage
 * (packages/Nginx/Dockerfile.tpl, --target base: the nginx, njs, bash,
 * openssl and Node.js the image ships), so there is no second nginx tag to
 * keep in step, and runs every Nginx test in it with RUN_NGINX_IMAGE_TESTS=1,
 * as root, the checkout mounted whole (the tests read Home, App and Common)
 * and read-only. This suite holds
 *
 *   - the job to that, in that order, with the Docker Hub mirror before its
 *     first pull, the public.ecr.aws base image warmed, the build retried and
 *     every step under a timeout;
 *   - the Dockerfile.tpl to having a base stage that holds no gomplate
 *     template, so building the .tpl as it is builds what the release renders,
 *     and that the image that ships is built FROM;
 *   - every Nginx test that reads RUN_NGINX_IMAGE_TESTS to being one npm run
 *     test runs, and to saying, when it skips, how to run it.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { stepCommand } = require("./Utils/WorkflowStep");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = ".github/workflows/test.nginx.yaml";
const DOCKERFILE = "packages/Nginx/Dockerfile.tpl";
const NGINX_DIRECTORY = "packages/Nginx";
const MIRROR_ACTION = "./.github/actions/docker-hub-mirror";
const GATE = "RUN_NGINX_IMAGE_TESTS";

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const workflow = yaml.load(read(WORKFLOW));
const job = (workflow.jobs || {}).image;
const steps = (job && job.steps) || [];

// The index of the first step whose command matches, or -1.
function stepIndex(matches) {
  return steps.findIndex((step) => {
    return matches(stepCommand(step), step);
  });
}

const BUILD = stepIndex((command) => {
  return /\bdocker build\b/.test(command);
});
const RUN = stepIndex((command) => {
  return /\bdocker run\b/.test(command);
});

// The tag the build step names, which the run step must run.
function builtTag() {
  const match = /(?:-t|--tag)[= ](\S+)/.exec(stepCommand(steps[BUILD]));

  return match ? match[1] : null;
}

// The Dockerfile's stages, by name, each with its FROM and its lines.
function stagesOf(dockerfile) {
  const stages = [];

  for (const line of dockerfile.split("\n")) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/i.exec(line.trim());

    if (from) {
      stages.push({ from: from[1], name: from[2] || null, lines: [] });
      continue;
    }

    if (stages.length > 0) {
      stages[stages.length - 1].lines.push(line);
    }
  }

  return stages;
}

function nginxTestFiles() {
  return fs
    .readdirSync(path.join(REPO_ROOT, NGINX_DIRECTORY, "Tests"))
    .filter((name) => {
      return name.endsWith(".test.js");
    })
    .sort();
}

describe("the Nginx Test workflow's image job", () => {
  test("runs on every pull request, and on main nightly, beside the runner's test job", () => {
    expect(workflow.on).toHaveProperty("pull_request");
    // Not on every push to main (PullRequestChecksNotOnPush.test.js).
    expect(workflow.on.schedule).toHaveLength(1);
    expect(Object.keys(workflow.jobs).sort()).toEqual(["image", "test"]);
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job.needs).toBeUndefined();
  });

  test("has a timeout, and so does each step that can hang", () => {
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
    expect(job["timeout-minutes"]).toBeLessThanOrEqual(45);
    expect(steps[BUILD].uses).toMatch(/^nick-fields\/retry@/);
    expect(steps[BUILD].with.timeout_minutes).toBeGreaterThan(0);
    expect(steps[BUILD].with.max_attempts).toBeGreaterThan(1);
    expect(steps[RUN]["timeout-minutes"]).toBeGreaterThan(0);
  });

  test("checks out the code, uses the Docker Hub mirror and warms the base images before the build pulls them", () => {
    const checkout = steps.findIndex((step) => {
      return String(step.uses).startsWith("actions/checkout@");
    });
    const mirror = steps.findIndex((step) => {
      return step.uses === MIRROR_ACTION;
    });
    const warm = stepIndex((command) => {
      return command.includes("warm_base_images.sh");
    });

    expect(checkout).toBe(0);
    expect(mirror).toBeGreaterThan(checkout);
    expect(warm).toBeGreaterThan(mirror);
    expect(BUILD).toBeGreaterThan(warm);
    expect(stepCommand(steps[warm])).toBe(
      `bash ./Scripts/GHA/warm_base_images.sh ./${DOCKERFILE}`,
    );
  });

  test("builds the ingress image's own base stage, from its Dockerfile, with no sudo", () => {
    const build = stepCommand(steps[BUILD]);

    expect(build).toMatch(/^docker build /);
    expect(build).toContain(`-f ./${DOCKERFILE}`);
    expect(build).toContain("--target base");
    expect(build.trim().endsWith(" .")).toBe(true);
    expect(builtTag()).not.toBeNull();
  });

  test("runs every Nginx test in that image, as root, with RUN_NGINX_IMAGE_TESTS=1, the checkout mounted whole and read-only", () => {
    const run = stepCommand(steps[RUN]);

    expect(RUN).toBeGreaterThan(BUILD);
    expect(run).toMatch(/^docker run --rm /);
    expect(run).toContain("--user root");
    expect(run).toContain('--volume "$PWD:/repo:ro"');
    expect(run).toContain(`--workdir /repo/${NGINX_DIRECTORY}`);
    expect(run).toContain(`--env ${GATE}=1`);
    // The image, then the command: the package's whole test script.
    expect(run.trim().endsWith(`${builtTag()} npm run test`)).toBe(true);
    expect(RUN).toBe(steps.length - 1);
  });

  test("the runner's test job still runs the same tests, without the image", () => {
    const runnerSteps = workflow.jobs.test.steps.map((step) => {
      return stepCommand(step);
    });

    expect(runnerSteps).toContain("cd packages/Nginx && npm run test");
    expect(JSON.stringify(workflow.jobs.test)).not.toContain(GATE);
  });
});

describe("the ingress Dockerfile the job builds its base stage of", () => {
  const dockerfile = read(DOCKERFILE);
  const stages = stagesOf(dockerfile);
  const baseIndex = stages.findIndex((stage) => {
    return stage.name === "base";
  });

  test("has a base stage, FROM nginx, that the image that ships is built FROM", () => {
    expect(baseIndex).toBeGreaterThanOrEqual(0);
    expect(stages[baseIndex].from).toMatch(
      /^nginx:\d+\.\d+\.\d+-alpine\d+\.\d+$/,
    );
    expect(stages[stages.length - 1].from).toBe("base");
    expect(stages[stages.length - 1].name).toBeNull();
  });

  test("holds no gomplate template up to its base stage, so the .tpl as it is builds what the release renders", () => {
    const upToBase = dockerfile.split(/^FROM base AS build$/m)[0];

    expect(upToBase).toContain(" AS base");
    expect(upToBase).not.toMatch(/\{\{|\}\}/);
  });

  test("installs in its base stage what the image-only tests run: bash, openssl and Node.js", () => {
    const base = stages[baseIndex].lines.join("\n");

    expect(base).toMatch(/apk add --no-cache [^\n]*\bbash\b/);
    expect(base).toMatch(/apk add --no-cache [^\n]*\bopenssl\b/);
    expect(base).toContain(
      "COPY --from=node26 /usr/local/bin/node /usr/local/bin/node",
    );
    expect(base).toContain("/usr/local/bin/npm");
  });
});

describe("the tests the job is for", () => {
  const testScript = JSON.parse(read(`${NGINX_DIRECTORY}/package.json`)).scripts
    .test;
  const gated = nginxTestFiles().filter((name) => {
    return read(`${NGINX_DIRECTORY}/Tests/${name}`).includes(GATE);
  });

  test("are the ones that read RUN_NGINX_IMAGE_TESTS, which this was written for", () => {
    expect(gated).toEqual(
      expect.arrayContaining([
        "IngressListensOnIpv6.test.js",
        "PrimaryServerName.test.js",
      ]),
    );
  });

  test("npm run test runs every Nginx test, the image-only ones among them", () => {
    for (const name of nginxTestFiles()) {
      expect({ name, run: testScript.includes(`Tests/${name}`) }).toEqual({
        name,
        run: true,
      });
    }
  });

  test.each(gated)(
    "%s runs only when RUN_NGINX_IMAGE_TESTS is 1, and says so when it skips",
    (name) => {
      const source = read(`${NGINX_DIRECTORY}/Tests/${name}`);

      expect(source).toContain(`process.env.${GATE} !== "1"`);
      expect(source).toContain(`set ${GATE}=1 inside the ingress image`);
    },
  );
});
