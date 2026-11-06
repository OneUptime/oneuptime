"use strict";

/**
 * Reads OneUptime's Iron Bank projects (IronBank/<Project>) and the Dockerfiles
 * their release images are built from, for IronBankApp.test.js and
 * IronBankProjects.test.js.
 *
 * A project's Dockerfile and its release's are read the same way, as
 * DockerfileTemplate.js reads every image's: stages, and each stage's
 * instructions with comments dropped and continuations joined. These helpers
 * take those instructions apart further: ENV and LABEL pairs, the commands of
 * the RUN instructions (split at &&), the packages they install or remove, and
 * what the COPY instructions copy.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");

const { render, parseStages, instructions } = require("./DockerfileTemplate");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/*
 * git, which says what a clone of the repository holds; failing loudly when it
 * cannot run, rather than passing on nothing.
 */
function git(args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.error) {
    throw new Error(`Could not run git ${args.join(" ")}: ${result.error}`);
  }
  return result;
}

/*
 * `git check-ignore` exits 0 for an ignored path and 1 for one that is not,
 * including one a later negation rescues.
 */
function isGitIgnored(relativePath) {
  const result = git(["check-ignore", "--quiet", "--no-index", relativePath]);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed for ${relativePath}`);
  }
  return result.status === 0;
}

/*
 * `ENV KEY=value` / `LABEL key="value"` instructions as an object, one pair
 * per instruction (every Dockerfile here writes them so).
 */
function pairs(lines, keyword) {
  const values = {};
  for (const line of lines) {
    if (!line.startsWith(`${keyword} `)) {
      continue;
    }
    const match = new RegExp(`^${keyword} ([^=\\s]+)=("[^"]*"|\\S+)$`).exec(
      line,
    );
    if (!match) {
      throw new Error(`Not one ${keyword} pair: ${line}`);
    }
    values[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
  }
  return values;
}

function all(lines, keyword) {
  return lines.filter((line) => {
    return line.startsWith(`${keyword} `);
  });
}

function last(lines, keyword) {
  const found = all(lines, keyword);
  return found.length > 0 ? found[found.length - 1] : null;
}

/*
 * The commands of a stage's RUN instructions, split at &&.
 */
function commands(lines) {
  return all(lines, "RUN").flatMap((line) => {
    return line
      .slice("RUN ".length)
      .split(" && ")
      .map((command) => {
        return command.trim();
      });
  });
}

/*
 * The packages a list of commands installs (apk add, apt-get install) and
 * removes (apk del, apt-get purge). A package file a command installs by its
 * path (/tmp/msodbcsql18.deb) counts as the package it is named for.
 */
function packages(commandList) {
  const installed = new Set();
  const removed = new Set();
  for (const command of commandList) {
    const words = command.split(/\s+/).filter((word) => {
      return !/^[A-Z_]+=/.test(word);
    });
    const verb = `${words[0]} ${words[1]}`;
    const target = {
      "apk add": installed,
      "apt-get install": installed,
      "apk del": removed,
      "apt-get purge": removed,
    }[verb];
    if (!target) {
      continue;
    }
    for (const word of words.slice(2)) {
      if (!word.startsWith("-")) {
        target.add(path.basename(word).replace(/\.deb$/, ""));
      }
    }
  }
  return { installed, removed };
}

/*
 * The ARGs before the first FROM, which only the FROM lines can read.
 */
function globalArgs(text) {
  const args = {};
  for (const line of text.split("\n")) {
    if (/^\s*FROM\s/i.test(line)) {
      break;
    }
    const match = /^ARG (\w+)=(\S+)$/.exec(line.trim());
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

/*
 * What COPY instructions copy, as {from, sources, destination}: `from` is the
 * stage or image (--from), or null for the build context.
 */
function copies(lines) {
  return all(lines, "COPY").map((line) => {
    const words = line.split(/\s+/).slice(1);
    const flags = words.filter((word) => {
      return word.startsWith("--");
    });
    const paths = words.filter((word) => {
      return !word.startsWith("--");
    });
    const from = flags.find((flag) => {
      return flag.startsWith("--from=");
    });
    return {
      from: from ? from.slice("--from=".length) : null,
      sources: paths.slice(0, -1),
      destination: paths[paths.length - 1],
    };
  });
}

/*
 * The stages of a Dockerfile.tpl as `npm run prerun` renders it for
 * production, on a machine without operator certificates (as CI is).
 */
function templateStages(template) {
  return parseStages(
    render(read(template), "production", {
      fileExists: () => {
        return false;
      },
    }),
  );
}

/**
 * One Iron Bank project, read.
 * @param {string} name - Its folder under IronBank/
 */
function readProject(name) {
  const directory = `IronBank/${name}`;
  const dockerfileText = read(`${directory}/Dockerfile`);
  const manifestText = read(`${directory}/hardening_manifest.yaml`);
  const stages = parseStages(dockerfileText);
  const finalStage = stages[stages.length - 1];

  return {
    name,
    directory,
    dockerfileText,
    manifestText,
    manifest: yaml.load(manifestText),
    stages,
    finalStage,
    releaseStage: stages.find((stage) => {
      return stage.name === "release";
    }),
    finalInstructions: instructions(finalStage.body),
    args: globalArgs(dockerfileText),
  };
}

module.exports = {
  REPO_ROOT,
  read,
  git,
  isGitIgnored,
  pairs,
  all,
  last,
  commands,
  packages,
  globalArgs,
  copies,
  templateStages,
  readProject,
};
