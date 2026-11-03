"use strict";

/**
 * Reads what a release workflow's e2e job boots: the compose files of its
 * `docker compose ... up -d` step, the OneUptime images they run, the
 * APP_TAG each step names and the one its pin step writes, and the tags a
 * build job's amd64 leg pushes (Scripts/GHA/build_docker_images.sh run for
 * real with a fake docker that records each call).
 *
 * Lifted from TestReleaseE2eImages.test.js, which held test-release.yaml's
 * e2e jobs to their builds' -amd64 tags first, so ReleaseE2eImages.test.js can
 * hold release.yml's the same way. TestReleaseE2eImages keeps its own copies:
 * it is pinned as written.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const { callsFor, flagValue, stepCommand } = require("./ReleaseWorkflow");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BUILD_SCRIPT = "Scripts/GHA/build_docker_images.sh";

// What ${{needs.read-version.outputs.major_minor}} stands for in these suites.
const VERSION = "9.9.9";
const VERSION_EXPRESSION =
  /\$\{\{\s*needs\.read-version\.outputs\.major_minor\s*\}\}/g;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/**
 * Text with the version expression filled in.
 * @param {string} text
 * @returns {string}
 */
function withVersion(text) {
  return String(text).replace(VERSION_EXPRESSION, VERSION);
}

const START_LINE = /docker compose [^\n]*\bup\b[^\n]*\s-d\b/;

/**
 * The compose files a job's `docker compose ... up ... -d` boots its stack with.
 * @param {Object} job
 * @returns {Array<string>}
 */
function startedStack(job) {
  const start = (job.steps || []).map(stepCommand).find((command) => {
    return START_LINE.test(command);
  });
  if (!start) {
    throw new Error("the job has no `docker compose ... up -d` step");
  }
  const line = start.split("\n").find((candidate) => {
    return START_LINE.test(candidate);
  });
  return [...line.matchAll(/-f (\S+\.ya?ml)/g)].map((match) => {
    return match[1];
  });
}

/**
 * The OneUptime images a stack runs, as written in the compose files
 * ("oneuptime/app:${APP_TAG}"), each file's services over the last's, none
 * behind a profile, each image once.
 * @param {Array<string>} composeFiles
 * @returns {Array<string>}
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
  return [
    ...new Set(
      Object.values(services)
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
        }),
    ),
  ].sort();
}

/**
 * The image's name in a reference: "app" for "oneuptime/app:${APP_TAG}".
 * @param {string} reference
 * @returns {string}
 */
function imageName(reference) {
  return /oneuptime\/([a-z0-9-]+):/.exec(reference)[1];
}

/**
 * The APP_TAG a job boots, as each of its steps names it: every
 * `export APP_TAG=` line and the App image its edition check pulls, with the
 * version filled in.
 * @param {Object} job
 * @returns {Array<string>}
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
 * The job's step that pins APP_TAG into config.env.
 * @param {Object} job
 * @returns {Object}
 */
function pinStep(job) {
  const pin = (job.steps || []).find((step) => {
    return /^Pin APP_TAG/.test(step.name || "");
  });
  if (!pin) {
    throw new Error("the job has no step that pins APP_TAG");
  }
  return pin;
}

/**
 * The APP_TAG the job's pin step writes into config.env: the step's script,
 * run by bash in an empty directory, read back.
 * @param {Object} job
 * @param {string} workDir
 * @returns {string}
 */
function pinnedTag(job, workDir) {
  const dir = fs.mkdtempSync(path.join(workDir, "pin-"));
  const result = spawnSync("bash", ["-c", withVersion(pinStep(job).run)], {
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

/**
 * A folder with a fake docker in bin/ that appends each call's arguments,
 * one a line, to $FAKE_DOCKER_LOG and succeeds, and a stand-in Dockerfile
 * (the tags do not depend on what is built; a stage named enterprise only
 * changes how the editions are told apart).
 * @param {string} workDir
 * @returns {{bin: string, dockerfile: string}}
 */
function recordingDocker(workDir) {
  const bin = path.join(workDir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, "docker"),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$@" >>"$FAKE_DOCKER_LOG"\nexit 0\n',
    { mode: 0o755 },
  );
  const dockerfile = path.join(workDir, "Dockerfile");
  fs.writeFileSync(dockerfile, "FROM scratch\n");
  return { bin, dockerfile };
}

// One log a run: the same image's leg may be run more than once.
let legRuns = 0;

/**
 * Every tag build_docker_images.sh pushes for `image`'s amd64 leg, called with
 * the flags its build job in `jobs` passes, the version filled in: both
 * passes, community and enterprise.
 * @param {Object<string, Object>} jobs
 * @param {string} image
 * @param {string} workDir - holds recordingDocker's bin/ and Dockerfile
 * @returns {Array<string>}
 */
function amd64LegPushes(jobs, image, workDir) {
  const buildJob = jobs[`${image}-docker-image-build`];
  const [call] = callsFor({ build: buildJob }, "build_docker_images.sh", image);
  const command = withVersion(call.command);
  legRuns += 1;
  const log = path.join(workDir, `docker-${image}-${legRuns}`);
  const args = [
    path.join(REPO_ROOT, BUILD_SCRIPT),
    "--image",
    image,
    "--version",
    flagValue(command, "--version"),
    "--dockerfile",
    path.join(workDir, "Dockerfile"),
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
    throw new Error(`${BUILD_SCRIPT} failed: ${result.stdout}${result.stderr}`);
  }
  const tags = [];
  const words = fs.readFileSync(log, "utf8").split("\n");
  words.forEach((word, index) => {
    if (word === "--tag") {
      tags.push(words[index + 1]);
    }
  });
  return tags;
}

module.exports = {
  REPO_ROOT,
  VERSION,
  withVersion,
  startedStack,
  stackImages,
  imageName,
  tagsNamed,
  pinStep,
  pinnedTag,
  recordingDocker,
  amd64LegPushes,
};
