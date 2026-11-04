"use strict";

/**
 * Every Node agent's own tests run in CI, and its image is built on every pull
 * request.
 *
 * Nothing at runtime notices when either stops being true. No workflow ran
 * agents/KubernetesCostAgent's tests: the one CI step that even compiled them
 * was its image build, until the agents' images left their tests out
 * (COPY --exclude=Tests), and a suite that never runs never fails. Only
 * release.yml built the cost agent's and the log tailer's images, and no pull
 * request runs release.yml, so a template that did not build first failed
 * during a release.
 *
 * So this suite walks agents/ and holds
 *
 *   - every agent whose package.json has a test script to a job that, on every
 *     pull request and every push to master, installs in the agent's directory
 *     and then runs that script, with the Node major the agent's image runs;
 *   - every image that compiles its agent (its Dockerfile.tpl runs `npm run
 *     compile`) to one job of build.yml, which builds the Dockerfile release.yml
 *     builds, without the cache, and pushes nothing.
 *
 * The collector images (agents/DockerAgent, agents/PodmanAgent) are a pinned
 * image and a config file. They compile nothing, so the second rule leaves them
 * out.
 *
 * What every job of build.yml is held to besides is not repeated here: warming
 * its base images is in KubernetesAiAgentRelease.test.js, the pinned gomplate in
 * GomplateSetupCoverage.test.js, and running docker as the runner's user in
 * RetryStepsWithoutSudo.test.js.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const {
  commandsMentioning,
  dockerfileSteps,
  flagValue,
} = require("./Utils/ReleaseWorkflow");
const {
  NPM_INSTALL_ACTION,
  stepCommand,
  stepCommandFromRoot,
} = require("./Utils/WorkflowStep");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENTS_DIR = "agents";
const WORKFLOWS_DIR = ".github/workflows";
const RELEASE_WORKFLOW = `${WORKFLOWS_DIR}/release.yml`;
const BUILD_WORKFLOW = `${WORKFLOWS_DIR}/build.yml`;

// The agents this was written for, so a walk that found nothing cannot pass.
const NODE_AGENTS = [
  "agents/KubernetesAIAgent",
  "agents/KubernetesCostAgent",
  "agents/KubernetesLogTailer",
  "agents/ResourceAIAgent",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

function readYaml(relativePath) {
  return yaml.load(read(relativePath));
}

const agentDirectories = fs
  .readdirSync(path.join(REPO_ROOT, AGENTS_DIR), { withFileTypes: true })
  .filter((entry) => {
    return entry.isDirectory();
  })
  .map((entry) => {
    return `${AGENTS_DIR}/${entry.name}`;
  })
  .sort();

const agentsWithTests = agentDirectories.filter((directory) => {
  const manifest = `${directory}/package.json`;

  return (
    exists(manifest) && Boolean((JSON.parse(read(manifest)).scripts || {}).test)
  );
});

const imagesThatCompileTheirAgent = agentDirectories.filter((directory) => {
  const template = `${directory}/Dockerfile.tpl`;

  return exists(template) && read(template).includes("npm run compile");
});

// Every job of every workflow, with the workflow it is in.
const allJobs = fs
  .readdirSync(path.join(REPO_ROOT, WORKFLOWS_DIR))
  .filter((file) => {
    return /\.ya?ml$/.test(file);
  })
  .sort()
  .flatMap((file) => {
    const workflow = readYaml(`${WORKFLOWS_DIR}/${file}`) || {};

    return Object.entries(workflow.jobs || {}).map(([name, job]) => {
      return { where: `${file}: ${name}`, workflow, job };
    });
  });

/**
 * Whether a job installs in an agent's directory and then runs its test script.
 * Each step is read as typed from the root, so an npm-install step and a step
 * with a working-directory read like `cd <directory> && <command>`.
 * @param {Object} job
 * @param {string} directory
 * @returns {boolean}
 */
function jobRunsTests(job, directory) {
  const commands = (job.steps || []).map((step) => {
    return stepCommandFromRoot(step).trim();
  });
  const firstOf = (candidates) => {
    return commands.findIndex((command) => {
      return candidates.some((candidate) => {
        return command === `cd ${directory} && ${candidate}`;
      });
    });
  };
  const install = firstOf(["npm install", "npm ci"]);
  const tests = firstOf(["npm run test", "npm test"]);

  return install !== -1 && tests > install;
}

// The Node major a job sets up, as a string; undefined if it sets up none.
function nodeMajorOf(job) {
  const setupNode = (job.steps || []).find((step) => {
    return /^actions\/setup-node@/.test(step.uses || "");
  });

  return setupNode ? String(setupNode.with["node-version"]) : undefined;
}

function imageNodeMajor(directory) {
  const from = /^FROM\s+\S*\/node:(\d+)/m.exec(
    read(`${directory}/Dockerfile.tpl`),
  );

  return from ? from[1] : undefined;
}

describe("how a job is read", () => {
  const directory = "agents/SomeAgent";
  const checkout = { uses: "actions/checkout@v4" };
  const install = {
    uses: NPM_INSTALL_ACTION,
    with: { "working-directory": directory },
  };
  const tests = { run: `cd ${directory} && npm run test` };

  test.each([
    ["the workflows' own form", [checkout, install, tests]],
    [
      "an install with the npm ci command",
      [{ ...install, with: { ...install.with, command: "ci" } }, tests],
    ],
    ["a plain install step", [{ run: `cd ${directory} && npm ci` }, tests]],
    [
      "npm test in a working-directory",
      [install, { run: "npm test", "working-directory": directory }],
    ],
  ])("runs the tests: %s", (_name, steps) => {
    expect(jobRunsTests({ steps }, directory)).toBe(true);
  });

  test.each([
    ["no steps at all", []],
    ["an install and no tests", [checkout, install]],
    ["tests and no install", [checkout, tests]],
    ["the install after the tests", [tests, install]],
    [
      "a compile, not the tests",
      [install, { run: `cd ${directory} && npm run compile` }],
    ],
    [
      "another agent's tests",
      [install, { run: "cd agents/Other && npm test" }],
    ],
    ["an install at the root", [{ uses: NPM_INSTALL_ACTION }, tests]],
    ["tests at the root", [install, { run: "npm test" }]],
  ])("does not (negative control): %s", (_name, steps) => {
    expect(jobRunsTests({ steps }, directory)).toBe(false);
  });
});

describe("every agent with npm tests has a workflow that runs them", () => {
  test("the walk finds the Node agents (the checks below are not vacuous)", () => {
    expect(agentsWithTests).toEqual(expect.arrayContaining(NODE_AGENTS));
  });

  test.each(agentsWithTests)(
    "%s: on every pull request and push to master, with the Node major its image runs",
    (directory) => {
      const running = allJobs.filter(({ job }) => {
        return jobRunsTests(job, directory);
      });

      expect({ directory, jobs: running.length > 0 }).toEqual({
        directory,
        jobs: true,
      });

      for (const { where, workflow, job } of running) {
        const triggers = workflow.on || {};

        expect({
          where,
          onPullRequests: Object.keys(triggers).includes("pull_request"),
          onPushToMaster: ((triggers.push || {}).branches || []).includes(
            "master",
          ),
          node: nodeMajorOf(job),
        }).toEqual({
          where,
          onPullRequests: true,
          onPushToMaster: true,
          node: imageNodeMajor(directory),
        });
      }
    },
  );
});

describe("every image that compiles its agent is built on every pull request", () => {
  const buildJobs = readYaml(BUILD_WORKFLOW).jobs;
  const releaseDockerfiles = Object.values(readYaml(RELEASE_WORKFLOW).jobs)
    .flatMap((job) => {
      return commandsMentioning(job, "build_docker_images.sh");
    })
    .map((command) => {
      return flagValue(command, "--dockerfile");
    });

  const pullRequestJobsBuilding = (dockerfile) => {
    return Object.entries(buildJobs).filter(([, job]) => {
      return dockerfileSteps(job).built.some((build) => {
        return build.dockerfile === dockerfile;
      });
    });
  };

  test("the walk finds the Node agents (the checks below are not vacuous)", () => {
    expect(imagesThatCompileTheirAgent).toEqual(
      expect.arrayContaining(NODE_AGENTS),
    );
  });

  test.each(imagesThatCompileTheirAgent)(
    "%s: one job builds the Dockerfile the release builds, without the cache, and pushes nothing",
    (directory) => {
      const dockerfile = `./${directory}/Dockerfile`;
      const jobs = pullRequestJobsBuilding(dockerfile);

      expect(releaseDockerfiles).toContain(dockerfile);
      expect({ dockerfile, jobs: jobs.length }).toEqual({
        dockerfile,
        jobs: 1,
      });

      const [[, job]] = jobs;
      const commands = job.steps.map(stepCommand).join("\n");

      expect(commands).toMatch(/\bdocker build --no-cache\b/);
      expect(commands).not.toMatch(
        /\bdocker (push|login)\b|build_docker_images\.sh/,
      );
      expect(JSON.stringify(job)).not.toContain("secrets.");
    },
  );
});
