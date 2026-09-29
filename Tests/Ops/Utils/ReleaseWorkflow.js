"use strict";

/**
 * Reads the GitHub workflows that build and release the container images:
 * a job's needs (directly and transitively), the command lines of its steps,
 * and the flags of the Scripts/GHA/build_docker_images.sh and
 * merge_docker_manifests.sh calls in them.
 *
 * These are the helpers KubernetesAiAgentRelease.test.js defines for itself,
 * lifted into a module so each image's release test does not carry its own
 * copy (ResourceAiAgentRelease.test.js is the first to use it). The
 * Kubernetes suite keeps its own copies on purpose: it is pinned as written.
 */

const { spawnSync } = require("child_process");

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

/**
 * Whether a command passes `flag` at all (as `--flag value` or `--flag=value`).
 * @param {string} command
 * @param {string} flag
 * @returns {boolean}
 */
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

/**
 * The --tags of a merge_docker_manifests.sh call, as a list.
 * @param {string} command
 * @returns {Array<string>}
 */
function mergedTags(command) {
  return (flagValue(command, "--tags") || "")
    .split(",")
    .map((tag) => {
      return tag.trim();
    })
    .filter((tag) => {
      return tag.length > 0;
    });
}

/**
 * The platforms of a job's per-architecture matrix, in order.
 * @param {Object} job
 * @returns {Array<string>}
 */
function matrixPlatforms(job) {
  return ((((job || {}).strategy || {}).matrix || {}).include || []).map(
    (leg) => {
      return leg.platform;
    },
  );
}

/**
 * The Dockerfiles a job builds with `docker build -f`, and the ones it warms
 * with warm_base_images.sh, each with the index of the step that does it.
 * @param {Object} job
 * @returns {{built: Array<{dockerfile: string, index: number}>, warmed: Array<{dockerfile: string, index: number}>}}
 */
function dockerfileSteps(job) {
  const built = [];
  const warmed = [];

  ((job && job.steps) || []).forEach((step, index) => {
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
 * A bash array assignment from a script (`NAME=(` ... `)`), evaluated by
 * bash itself so quoting and comments mean what they mean to the script.
 * (The same reader EnterpriseSbomCoverage.test.js uses.)
 * @param {string} script - The script text
 * @param {string} name - The array's name
 * @returns {Array<string>|null} null when the script has no such array
 */
function readBashArray(script, name) {
  const lines = script.split("\n");
  const start = lines.indexOf(`${name}=(`);

  if (start === -1) {
    return null;
  }

  const end = lines.findIndex((line, index) => {
    return index > start && line.trim() === ")";
  });

  if (end === -1) {
    return null;
  }

  const result = spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail\n${lines.slice(start, end + 1).join("\n")}\nfor item in \${${name}[@]+"\${${name}[@]}"}; do printf '%s\\n' "$item"; done`,
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`bash could not read ${name}: ${result.stderr}`);
  }

  return result.stdout.split("\n").filter((item) => {
    return item.length > 0;
  });
}

module.exports = {
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
};
