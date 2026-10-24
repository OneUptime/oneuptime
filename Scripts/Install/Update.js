// The first step of `npm run update`: brings a Docker Compose install's files
// up to date - the branch it follows, then config.env - before the new images
// are pulled and npm start starts them.

const fs = require("fs");
const { spawnSync } = require("child_process");
const {
  mergeEnvTemplate,
  describeEnterpriseImageTagChanges,
} = require("./MergeEnvTemplate");
const { ok, warn, stop } = require("./StartOutput");

/*
 * WHY
 *
 * `npm run update` used to start with `npm run prerun`, which runs
 * Scripts/Install/configure.sh: a developer's setup that asks for the sudo
 * password, installs gomplate and ts-node machine-wide and renders every
 * Dockerfile.tpl - none of which an install that pulls released images
 * needs. Of what it did, an update needs two things, and this does only
 * those, as the user who runs it:
 *
 *   - `git pull --ff-only` on the branch the install follows (release, as the
 *     Docker Compose guide clones it), so the compose files match the images
 *     about to be pulled. A checkout at a fixed commit - a release tag an
 *     operator pinned - is left where it is, and said so. A pull that cannot
 *     fast-forward (files changed by hand) stops the update before anything
 *     is pulled or restarted.
 *   - Scripts/Install/MergeEnvTemplate.js: the settings config.example.env
 *     gained are added to config.env, with their defaults; the operator's own
 *     values stay.
 *
 * npm run update then pulls the images and runs npm start, which checks the
 * server and gives every new placeholder secret its own value.
 */

const runGitCommand = (args, options) => {
  return spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
};

const succeeded = (result) => {
  return Boolean(result) && !result.error && result.status === 0;
};

/*
 * Pulls the branch the checkout follows. Returns "pulled", "not-a-checkout",
 * "detached" or "failed".
 */
const pullRepository = (options) => {
  const runGit = options.runGit || runGitCommand;
  const log = options.log || console.log;
  const cwd = options.cwd;

  if (!succeeded(runGit(["rev-parse", "--is-inside-work-tree"], { cwd }))) {
    log(
      warn(
        "This folder is not a git checkout, so its files were not updated: only config.env and the images are.",
      ),
    );
    return "not-a-checkout";
  }

  const branch = runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd,
  });

  if (!succeeded(branch)) {
    log(
      warn(
        "This checkout is at a fixed commit, not on a branch, so it was not pulled. To update, check out the release branch (git checkout release) and run npm run update again; to keep this version, set APP_TAG in config.env to it.",
      ),
    );
    return "detached";
  }

  const name = String(branch.stdout || "").trim();

  if (!succeeded(runGit(["pull", "--ff-only"], { cwd, inherit: true }))) {
    log(
      stop(
        `git pull could not bring ${name} up to date, so nothing was updated or restarted. Files changed in this folder by hand are the usual reason (git status shows them): put them in docker-compose.override.yml or config.env instead, then run npm run update again.`,
      ),
    );
    return "failed";
  }

  log(ok(`Pulled the latest ${name}.`));
  return "pulled";
};

/*
 * Adds what config.example.env gained to config.env (MergeEnvTemplate.js).
 * Returns whether it wrote config.env.
 */
const mergeConfig = (options) => {
  const fileSystem = options.fileSystem || fs;
  const log = options.log || console.log;
  const configPath = `${options.cwd}/config.env`;
  const templatePath = `${options.cwd}/config.example.env`;

  // npm start makes config.env from the template when there is none.
  if (
    !fileSystem.existsSync(configPath) ||
    !fileSystem.existsSync(templatePath)
  ) {
    return false;
  }

  const before = fileSystem.readFileSync(configPath, "utf8");
  const merged = mergeEnvTemplate(
    fileSystem.readFileSync(templatePath, "utf8"),
    before,
  );

  if (merged.carriedOver.length > 0) {
    log(
      ok(
        `Kept ${merged.carriedOver.length} renamed setting(s) at their existing values: ${merged.carriedOver.join(", ")}.`,
      ),
    );
  }

  if (merged.imageTagChanges.length > 0) {
    log(describeEnterpriseImageTagChanges(merged.imageTagChanges));
  }

  if (merged.contents === before) {
    return false;
  }

  fileSystem.writeFileSync(configPath, merged.contents);
  log(
    ok(
      "Added the settings config.example.env gained to config.env, with their defaults. Your own values stay.",
    ),
  );

  return true;
};

/*
 * Runs both. Returns the exit code: 1 when the pull failed, so npm run
 * update stops before it pulls images or restarts anything.
 */
const run = (options) => {
  const given = options || {};
  const cwd = given.cwd || process.cwd();
  const log = given.log || console.log;

  log("Updating OneUptime:");

  const pulled = pullRepository({ cwd, log, runGit: given.runGit });

  if (pulled === "failed") {
    return 1;
  }

  mergeConfig({ cwd, log, fileSystem: given.fileSystem });

  return 0;
};

/*
 * Run as a script (`node ./Scripts/Install/Update.js` from the repository
 * root) by `npm run update`. Requiring it, as the tests do, only exports the
 * functions.
 */
if (require.main === module) {
  process.exitCode = run();
}

module.exports = {
  pullRepository,
  mergeConfig,
  run,
};
