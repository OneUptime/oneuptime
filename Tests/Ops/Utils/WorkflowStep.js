"use strict";

/**
 * What a workflow step runs, for the tests that read the workflows.
 *
 * A step runs shell through `run`, or through the `command` input of a
 * nick-fields/retry step. npm dependencies are installed through
 * ./.github/actions/npm-install instead: it runs `npm <command> <args>` in
 * its `working-directory` input, retrying a network failure
 * (Scripts/GHA/npm_install.sh). That action's `command` input is npm's
 * subcommand - `install` or `ci` - and not shell, so a step that uses it is
 * read here as the npm command it runs. Read as a retry step, every install
 * became the bare word "ci" or nothing at all, and the tests that look for
 * installs found none.
 */

const NPM_INSTALL_ACTION = "./.github/actions/npm-install";

/**
 * @param {Object} step
 * @returns {boolean}
 */
function isNpmInstallStep(step) {
  return Boolean(step) && step.uses === NPM_INSTALL_ACTION;
}

/**
 * What a step runs as shell: `run`, the npm command of an npm-install step,
 * or the `command` of a nick-fields/retry step. "" for any other `uses`.
 * @param {Object} step
 * @returns {string}
 */
function stepCommand(step) {
  if (typeof step.run === "string") {
    return step.run;
  }
  if (isNpmInstallStep(step)) {
    const inputs = step.with || {};
    const args = String(inputs.args || "")
      .split(/\s+/)
      .filter((arg) => {
        return arg.length > 0;
      });
    return ["npm", String(inputs.command || "install"), ...args].join(" ");
  }
  if (step.with && typeof step.with.command === "string") {
    return step.with.command;
  }
  return "";
}

/**
 * The directory a step runs in, as written, relative to the repository root:
 * `working-directory` for a `run` step, the input of the same name for an
 * npm-install step. "" when the step names none - the root for an
 * npm-install step, and for a `run` step whatever default the job or the
 * workflow sets (`defaults.run` applies to `run` steps only).
 * @param {Object} step
 * @returns {string}
 */
function stepWorkingDirectory(step) {
  const directory = isNpmInstallStep(step)
    ? (step.with || {})["working-directory"]
    : step["working-directory"];

  if (directory === undefined || directory === null) {
    return "";
  }

  const written = String(directory).replace(/\/+$/, "");
  return written === "." ? "" : written;
}

/**
 * A step's command as one shell line typed at the repository root:
 * `cd <directory> && <command>` when the step names a directory.
 * @param {Object} step
 * @returns {string}
 */
function stepCommandFromRoot(step) {
  const directory = stepWorkingDirectory(step);
  const command = stepCommand(step);
  return directory ? `cd ${directory} && ${command}` : command;
}

module.exports = {
  NPM_INSTALL_ACTION,
  isNpmInstallStep,
  stepCommand,
  stepWorkingDirectory,
  stepCommandFromRoot,
};
