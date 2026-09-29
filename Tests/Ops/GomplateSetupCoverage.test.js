"use strict";

/**
 * Every CI job that reaches Scripts/Install/configure.sh sets up the pinned
 * gomplate first, with .github/actions/setup-gomplate.
 *
 * `npm run prerun` (which `npm run dev`, `force-build` and `update` run too)
 * ends in configure.sh, and configure.sh downloads gomplate from GitHub's
 * release CDN whenever gomplate is not already on PATH. That CDN answers
 * 500/504 in bursts -- from 20 seconds to over a minute, recurring for weeks,
 * and continuously degraded for 50+ minutes on 2026-09-21 -- and
 * configure.sh's curl retries for about 15 seconds. On 2026-09-21 that failed
 * Build's Preinstall, and a Common Test shard through
 * packages/Common/test-setup.sh, which ran prerun at the time: configure.sh
 * exited before it merged config.env, postgres crash-looped without a
 * password, and ten Postgres tests failed fifteen minutes later with a bare
 * ECONNREFUSED.
 *
 * The action puts gomplate on PATH from the Actions cache, checked against a
 * sha256 pinned in the repository, and configure.sh then skips its download.
 * That only helps a job that runs the action before configure.sh, and nothing
 * at runtime notices a job that does not: the download quietly comes back, and
 * the flake with it. So this suite
 *
 *   - walks every job of every workflow and follows what each step runs --
 *     npm scripts (with their pre/post hooks and install lifecycle), shell
 *     scripts in the repository, and the `cd`s in between -- and fails on a
 *     step that reaches configure.sh with no setup-gomplate step before it.
 *     The setup step itself must come after the checkout it needs, on a Linux
 *     runner the action has a pin for. A job that legitimately cannot use it
 *     goes in EXEMPT, by name, with the reason.
 *   - runs configure.sh's setup_gomplate to pin its side of the contract: no
 *     download when gomplate is on PATH.
 *   - holds the action's pinned version to configure.sh's GOMPLATE_VERSION and
 *     its digests to every other gomplate pin in .github, so a version bump
 *     fails on its pull request rather than in the first image build after it
 *     merges (the action also checks the version when it runs).
 *
 * The walk reads commands, it does not run them. It is conservative where it
 * cannot know: a `cd` to a directory it cannot resolve statically counts as
 * the repository root, so `npm run dev` after it counts as the root's.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = ".github/workflows";
const ACTIONS_DIR = ".github/actions";
const CONFIGURE_SH = "Scripts/Install/configure.sh";
const SETUP_GOMPLATE = "./.github/actions/setup-gomplate";
const SETUP_GOMPLATE_ACTION = ".github/actions/setup-gomplate/action.yml";

/*
 * Jobs that reach configure.sh without the setup step, on purpose. Keyed
 * "<workflow file>: <job id>"; the value is why the job cannot use the action.
 * Empty: every such job today runs on a GitHub-hosted Linux runner, which the
 * action has a pinned gomplate for.
 */
const EXEMPT = {};

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readYaml(relativePath) {
  return yaml.load(read(relativePath));
}

/*
 * ---------------------------------------------------------------------------
 * A small, static reading of shell: enough to follow `npm run`, `bash x.sh`
 * and `cd` through a workflow step, an npm script or a repository script.
 * ---------------------------------------------------------------------------
 */

/*
 * The command lines of a script: continuation lines joined, heredoc bodies
 * dropped (they are data, e.g. test-setup.sh's config.env).
 */
function commandLines(text) {
  const joined = text.replace(/\\\r?\n/g, " ").split(/\r?\n/);
  const lines = [];
  let heredocEnd = null;
  for (const line of joined) {
    if (heredocEnd !== null) {
      const body = line.replace(/^\t+/, "").trim();
      if (body === heredocEnd) {
        heredocEnd = null;
      }
      continue;
    }
    lines.push(line);
    const heredoc = line.match(
      /(?:^|[^<])<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/,
    );
    if (heredoc) {
      heredocEnd = heredoc[2];
    }
  }
  return lines;
}

/*
 * Reads an expansion that starts at text[start] ("$(", "${" or "`") and
 * returns the index just past it.
 */
function skipExpansion(text, start) {
  if (text[start] === "`") {
    const end = text.indexOf("`", start + 1);
    return end === -1 ? text.length : end + 1;
  }
  const open = text[start + 1];
  const close = open === "(" ? ")" : "}";
  let depth = 0;
  let quote = null;
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === open) {
      depth++;
    } else if (char === close) {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return text.length;
}

const REDIRECTION = /^(?:\d+|&)?(?:>>?|<<-?|<>|<|>\|)(?:&(?:\d+|-))?/;

/*
 * Splits one command line into simple commands (arrays of words, quotes
 * removed). Command separators, pipes and parentheses end a command;
 * redirections and their targets are dropped; `#` at the start of a word
 * starts a comment. Expansions stay inside their word, so `$(sed ...
 * configure.sh)` is one word and never a command of its own.
 */
function simpleCommands(line) {
  const commands = [[]];
  let word = null;
  let dropNextWord = false;
  const endWord = () => {
    if (word !== null) {
      if (dropNextWord) {
        dropNextWord = false;
      } else {
        commands[commands.length - 1].push(word);
      }
    }
    word = null;
  };
  const endCommand = () => {
    endWord();
    commands.push([]);
  };

  let i = 0;
  while (i < line.length) {
    const char = line[i];
    const rest = line.slice(i);

    if (word === null || /^\d+$/.test(word)) {
      const redirection = rest.match(REDIRECTION);
      if (redirection && !(word !== null && /^&/.test(redirection[0]))) {
        word = null;
        i += redirection[0].length;
        // `2>&1` names no target; `> file` and `<<EOL` do.
        dropNextWord = !/&(?:\d+|-)$/.test(redirection[0]);
        continue;
      }
    }
    if (/\s/.test(char)) {
      endWord();
      i++;
    } else if (char === "#" && word === null) {
      break;
    } else if (/^(?:&&|\|\|)/.test(rest)) {
      endCommand();
      i += 2;
    } else if (";|&()".includes(char)) {
      endCommand();
      i++;
    } else if (char === "'") {
      const end = line.indexOf("'", i + 1);
      const stop = end === -1 ? line.length : end;
      word = (word || "") + line.slice(i + 1, stop);
      i = stop + 1;
    } else if (char === '"') {
      let j = i + 1;
      let value = "";
      while (j < line.length && line[j] !== '"') {
        if (line[j] === "\\" && j + 1 < line.length) {
          value += line[j + 1];
          j += 2;
        } else if (/^(?:\$\(|\$\{|`)/.test(line.slice(j))) {
          const end = skipExpansion(line, j);
          value += line.slice(j, end);
          j = end;
        } else {
          value += line[j];
          j++;
        }
      }
      word = (word || "") + value;
      i = j + 1;
    } else if (/^(?:\$\(|\$\{|`)/.test(rest)) {
      const end = skipExpansion(line, i);
      word = (word || "") + line.slice(i, end);
      i = end;
    } else if (char === "\\" && i + 1 < line.length) {
      word = (word || "") + line[i + 1];
      i += 2;
    } else {
      word = (word || "") + char;
      i++;
    }
  }
  endWord();
  return commands.filter((command) => {
    return command.length > 0;
  });
}

const PREFIX_WORDS = new Set([
  "!",
  "{",
  "}",
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
  "time",
  "exec",
  "nohup",
  "command",
  "builtin",
]);

/*
 * The command a simple command runs, without the words in front of it:
 * variable assignments, shell keywords, `sudo`/`env` and their options.
 */
function commandWords(words) {
  let rest = words;
  for (;;) {
    const [first] = rest;
    if (first === undefined) {
      return rest;
    }
    if (PREFIX_WORDS.has(first) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
      rest = rest.slice(1);
    } else if (first === "sudo" || first === "env") {
      rest = rest.slice(1);
      while (rest.length > 0 && /^-/.test(rest[0])) {
        const option = rest[0];
        rest = rest.slice(1);
        // sudo -u <user>, -g <group>, -C <fd>; env -u <name>, -C <dir>.
        if (/^-[ugCh]$/.test(option)) {
          rest = rest.slice(1);
        }
      }
    } else if (first === "timeout") {
      rest = rest.slice(1);
      while (rest.length > 0 && /^-/.test(rest[0])) {
        rest = rest.slice(1);
      }
      rest = rest.slice(1);
    } else {
      return rest;
    }
  }
}

/*
 * A path as the shell would resolve it from `dir` (repo-relative, "" for the
 * root). Paths rooted at the workspace resolve from the root. Returns null for
 * anything that is not static or leaves the repository.
 */
function resolvePath(dir, target) {
  let base = dir;
  let rest = target;
  const workspace = rest.match(
    /^(?:\$\{\{\s*github\.workspace\s*\}\}|\$\{?GITHUB_WORKSPACE\}?)(?=\/|$)\/?/,
  );
  if (workspace) {
    base = "";
    rest = rest.slice(workspace[0].length);
  }
  if (/[$`~*?]/.test(rest) || path.posix.isAbsolute(rest)) {
    return null;
  }
  const joined = path.posix.normalize(
    path.posix.join(base || ".", rest || "."),
  );
  if (joined === ".." || joined.startsWith("../")) {
    return null;
  }
  return joined === "." ? "" : joined.replace(/\/$/, "");
}

function isFile(root, relativePath) {
  try {
    return fs.statSync(path.join(root, relativePath)).isFile();
  } catch {
    return false;
  }
}

/*
 * The directory npm treats as the project for a command run in `dir`: the
 * nearest one at or above it with a package.json.
 */
function packageDirectory(root, dir) {
  let candidate = dir;
  for (;;) {
    if (isFile(root, path.posix.join(candidate || ".", "package.json"))) {
      return candidate;
    }
    if (candidate === "") {
      return null;
    }
    const parent = path.posix.dirname(candidate);
    candidate = parent === "." ? "" : parent;
  }
}

const INSTALL_LIFECYCLE = [
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "prepare",
  "postprepare",
];

/*
 * The package scripts an npm command runs, in order, and where npm looks for
 * the package: { scripts, prefix } (prefix null when it is the working
 * directory).
 */
function npmScripts(args) {
  const positional = [];
  let prefix = null;
  let ignoreScripts = false;
  let global = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--prefix" || arg === "-C") {
      prefix = args[i + 1] || null;
      i++;
    } else if (arg.startsWith("--prefix=")) {
      prefix = arg.slice("--prefix=".length);
    } else if (arg === "--ignore-scripts") {
      ignoreScripts = true;
    } else if (arg === "-g" || arg === "--global") {
      global = true;
    } else if (arg === "--") {
      positional.push(...args.slice(i + 1));
      break;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }
  const [subcommand, name] = positional;
  const hooks = (script) => {
    return [`pre${script}`, script, `post${script}`];
  };
  let scripts = [];
  if (["run", "run-script", "rum", "urn"].includes(subcommand) && name) {
    scripts = ignoreScripts ? [name] : hooks(name);
  } else if (["start", "stop", "restart"].includes(subcommand)) {
    scripts = ignoreScripts ? [subcommand] : hooks(subcommand);
  } else if (["test", "t", "tst"].includes(subcommand)) {
    scripts = ignoreScripts ? ["test"] : hooks("test");
  } else if (
    ["install", "i", "in", "ci", "clean-install", "add"].includes(subcommand) &&
    !ignoreScripts &&
    !global
  ) {
    scripts = INSTALL_LIFECYCLE;
  } else if (["install-test", "it", "cit"].includes(subcommand)) {
    scripts = ignoreScripts
      ? ["test"]
      : [...INSTALL_LIFECYCLE, ...hooks("test")];
  }
  return { scripts, prefix };
}

/*
 * What `bash`/`sh`/`source` is given: an inline command (`-c`) or a script.
 * Options that take an argument (`-o pipefail`, also inside `-euo`) consume it.
 */
function shellOptionsAndOperand(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (/^[-+][A-Za-z]+$/.test(arg)) {
      const letters = arg.slice(1);
      i += (letters.match(/o/g) || []).length;
      if (letters.includes("c")) {
        return { inline: args[i + 1] || "" };
      }
    } else if (!arg.startsWith("-")) {
      return { script: arg };
    }
  }
  return {};
}

/*
 * Walks `text` as a shell script run from `dir` in the repository at `root`.
 * Returns the chain of commands that ends in running configure.sh, or null.
 * `where` labels this text in that chain.
 */
function reachesConfigure(root, text, dir, where, stack = new Set()) {
  let cwd = dir;
  for (const line of commandLines(text)) {
    for (const words of simpleCommands(line)) {
      const command = commandWords(words);
      if (command.length === 0) {
        continue;
      }
      const [name, ...args] = command;
      const step = `${where}: ${command.join(" ")}`;
      let found = null;

      if (name === "cd" || name === "pushd") {
        const target = args.find((arg) => {
          return !/^-[LPe@]$/.test(arg);
        });
        const resolved =
          target === undefined || target === "-"
            ? null
            : resolvePath(cwd, target);
        // Unknown directories count as the root, the conservative choice.
        cwd = resolved === null ? "" : resolved;
        continue;
      }
      if (name === "popd") {
        cwd = "";
        continue;
      }

      if (name === "npm") {
        found = followNpm(root, args, cwd, stack);
      } else if (["bash", "sh", "dash", "zsh", "source", "."].includes(name)) {
        const operand = shellOptionsAndOperand(args);
        if (operand.inline !== undefined) {
          found = reachesConfigure(
            root,
            operand.inline,
            cwd,
            `${name} -c`,
            stack,
          );
        } else if (operand.script !== undefined) {
          found = followScript(root, operand.script, cwd, stack);
        }
      } else if (name.includes("/")) {
        found = followScript(root, name, cwd, stack);
      }

      if (found) {
        return [step, ...found];
      }
    }
  }
  return null;
}

function followScript(root, target, cwd, stack) {
  const script = resolvePath(cwd, target);
  if (script === null) {
    return null;
  }
  if (script === CONFIGURE_SH) {
    return [];
  }
  const key = `script:${script}:${cwd}`;
  if (stack.has(key) || !isFile(root, script)) {
    return null;
  }
  const text = fs.readFileSync(path.join(root, script), "utf8");
  if (!script.endsWith(".sh") && !/^#!.*\b(?:ba|da|z)?sh\b/.test(text)) {
    return null;
  }
  // A script runs in its caller's working directory, not its own.
  return reachesConfigure(root, text, cwd, script, new Set([...stack, key]));
}

function followNpm(root, args, cwd, stack) {
  const { scripts, prefix } = npmScripts(args);
  if (scripts.length === 0) {
    return null;
  }
  const from = prefix === null ? cwd : resolvePath(cwd, prefix);
  const packageDir = packageDirectory(root, from === null ? "" : from);
  if (packageDir === null) {
    return null;
  }
  const manifest = path.posix.join(packageDir || ".", "package.json");
  const defined =
    JSON.parse(fs.readFileSync(path.join(root, manifest), "utf8")).scripts ||
    {};
  for (const script of scripts) {
    const key = `npm:${manifest}:${script}`;
    if (typeof defined[script] !== "string" || stack.has(key)) {
      continue;
    }
    // npm runs a package's scripts from the package's own directory.
    const found = reachesConfigure(
      root,
      defined[script],
      packageDir,
      `${manifest} "${script}"`,
      new Set([...stack, key]),
    );
    if (found) {
      return found;
    }
  }
  return null;
}

/*
 * ---------------------------------------------------------------------------
 * Workflows.
 * ---------------------------------------------------------------------------
 */

/*
 * What a step runs as shell: its `run`, or the `command` of a
 * nick-fields/retry step.
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

function stepLabel(steps, index) {
  const step = steps[index];
  const name = step.name || step.uses || stepCommand(step).split("\n")[0];
  return `step ${index + 1} (${String(name).trim()})`;
}

function workingDirectory(workflow, job, step) {
  const configured =
    step["working-directory"] ??
    job.defaults?.run?.["working-directory"] ??
    workflow.defaults?.run?.["working-directory"] ??
    "";
  const resolved = resolvePath("", String(configured));
  return resolved === null ? "" : resolved;
}

function usesSetupGomplate(step) {
  return step.uses === SETUP_GOMPLATE;
}

// A checkout of this repository at the workspace root, where `uses: ./...` looks.
function checksOutThisRepository(step) {
  return (
    typeof step.uses === "string" &&
    step.uses.startsWith("actions/checkout@") &&
    !(step.with && (step.with.repository || step.with.path))
  );
}

function runnerLabels(job) {
  const runsOn = job["runs-on"];
  const labels = Array.isArray(runsOn) ? runsOn : [runsOn];
  return labels.flatMap((label) => {
    const matrixKey = String(label).match(
      /^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/,
    );
    if (!matrixKey) {
      return [String(label)];
    }
    const matrix = (job.strategy && job.strategy.matrix) || {};
    const values = [
      ...(Array.isArray(matrix[matrixKey[1]]) ? matrix[matrixKey[1]] : []),
      ...(matrix.include || []).map((entry) => {
        return entry[matrixKey[1]];
      }),
    ].filter((value) => {
      return value !== undefined;
    });
    return values.length > 0 ? values.map(String) : [String(label)];
  });
}

/*
 * Whether every runner the job can land on is Linux, which is all the action
 * has a pinned gomplate for (X64 and ARM64). GitHub-hosted labels only: a
 * self-hosted label says nothing about the OS unless it says "linux".
 */
function runsOnLinux(job) {
  const runsOn = job["runs-on"];
  if (Array.isArray(runsOn)) {
    return runsOn.some((label) => {
      return String(label).toLowerCase() === "linux";
    });
  }
  return runnerLabels(job).every((label) => {
    return /^ubuntu-/.test(label);
  });
}

/*
 * Why a job's gomplate setup is missing or wrong, as sentences; empty when
 * it is right. `root` is the repository the job's commands resolve against.
 */
function setupProblems(root, workflow, job) {
  const steps = job.steps || [];
  const problems = [];
  const setup = steps.findIndex(usesSetupGomplate);

  steps.forEach((step, index) => {
    const chain = reachesConfigure(
      root,
      stepCommand(step),
      workingDirectory(workflow, job, step),
      "run",
    );
    if (chain && (setup === -1 || setup > index)) {
      problems.push(
        `${stepLabel(steps, index)} reaches ${CONFIGURE_SH} with no "${SETUP_GOMPLATE}" step before it: ${chain.join(" -> ")}`,
      );
    }
  });

  if (setup !== -1) {
    /*
     * A setup step that can be skipped or can fail quietly leaves configure.sh
     * to download gomplate itself, on whichever matrix leg that happens.
     */
    const setupStep = steps[setup];
    if (setupStep.if !== undefined) {
      problems.push(
        `${stepLabel(steps, setup)} only runs if ${JSON.stringify(setupStep.if)}, so a run that skips it falls back to configure.sh's own download`,
      );
    }
    if (
      setupStep["continue-on-error"] !== undefined &&
      setupStep["continue-on-error"] !== false
    ) {
      problems.push(
        `${stepLabel(steps, setup)} sets continue-on-error, so a failed setup falls back to configure.sh's own download instead of failing the job`,
      );
    }
    const checkout = steps.findIndex(checksOutThisRepository);
    if (checkout === -1 || checkout > setup) {
      problems.push(
        `${stepLabel(steps, setup)} uses ${SETUP_GOMPLATE} without checking out this repository at the workspace root first, so the action is not there to run`,
      );
    }
    if (!runsOnLinux(job)) {
      problems.push(
        `the job runs on ${JSON.stringify(job["runs-on"])}, and ${SETUP_GOMPLATE} only has a pinned gomplate for Linux runners`,
      );
    }
  }
  return problems;
}

function jobReachesConfigure(root, workflow, job) {
  return (job.steps || []).some((step) => {
    return (
      reachesConfigure(
        root,
        stepCommand(step),
        workingDirectory(workflow, job, step),
        "run",
      ) !== null
    );
  });
}

const workflowFiles = fs
  .readdirSync(path.join(REPO_ROOT, WORKFLOWS_DIR))
  .filter((file) => {
    return /\.ya?ml$/.test(file);
  })
  .sort()
  .map((file) => {
    return `${WORKFLOWS_DIR}/${file}`;
  });

// Every local action's metadata file.
const actionFiles = fs
  .readdirSync(path.join(REPO_ROOT, ACTIONS_DIR))
  .sort()
  .flatMap((name) => {
    return ["action.yml", "action.yaml"].map((file) => {
      return `${ACTIONS_DIR}/${name}/${file}`;
    });
  })
  .filter((file) => {
    return isFile(REPO_ROOT, file);
  });

// [label, workflow, job] for every job that has steps (not a reusable-workflow call).
const allJobs = workflowFiles.flatMap((file) => {
  const workflow = readYaml(file);
  return Object.entries(workflow.jobs || {})
    .filter(([, job]) => {
      return Array.isArray(job.steps);
    })
    .map(([id, job]) => {
      return [`${file}: ${id}`, workflow, job];
    });
});

const reachingJobs = allJobs.filter(([, workflow, job]) => {
  return jobReachesConfigure(REPO_ROOT, workflow, job);
});

/*
 * The jobs to check: those that reach configure.sh (less the exempt ones),
 * and those that use the action, whose setup must be where it can run.
 */
const checkedJobs = allJobs.filter(([label, workflow, job]) => {
  const exempt = Object.prototype.hasOwnProperty.call(EXEMPT, label);
  return (
    job.steps.some(usesSetupGomplate) ||
    (!exempt && jobReachesConfigure(REPO_ROOT, workflow, job))
  );
});

describe("every CI job that reaches configure.sh sets up the pinned gomplate first", () => {
  test("the walk finds the jobs known to run prerun", () => {
    /*
     * A walk that found nothing would pass everything, so hold it to the sites
     * the action was rolled out to: every Build job, every per-arch image
     * build of both release workflows, the npm publish, the release e2e jobs,
     * and the Terraform provider e2e job's `npm run dev`.
     */
    const labels = reachingJobs.map(([label]) => {
      return label;
    });
    const expected = allJobs
      .map(([label]) => {
        return label;
      })
      .filter((label) => {
        return (
          /^\.github\/workflows\/build\.yml: docker-build-/.test(label) ||
          /^\.github\/workflows\/(?:release\.yml|test-release\.yaml): .*-docker-image-build$/.test(
            label,
          ) ||
          /^\.github\/workflows\/release\.yml: (?:publish-npm-packages|test-e2e-release-(?:saas|self-hosted|enterprise))$/.test(
            label,
          ) ||
          /^\.github\/workflows\/test-release\.yaml: test-e2e-test-(?:saas|self-hosted|enterprise)$/.test(
            label,
          ) ||
          label ===
            `${WORKFLOWS_DIR}/terraform-provider-e2e.yml: terraform-e2e-tests`
        );
      });

    /*
     * 34 when this was written: 6 in build.yml, 16 in release.yml, 11 in
     * test-release.yaml and terraform-provider-e2e.yml's one.
     */
    expect(expected.length).toBeGreaterThan(30);
    expect(labels).toEqual(expect.arrayContaining(expected));
  });

  test.each(checkedJobs)("%s", (_label, workflow, job) => {
    expect(setupProblems(REPO_ROOT, workflow, job)).toEqual([]);
  });

  test("every exemption names a job that still needs one, with a reason", () => {
    const stale = Object.entries(EXEMPT).filter(([label, reason]) => {
      const entry = reachingJobs.find(([candidate]) => {
        return candidate === label;
      });
      return (
        !entry ||
        typeof reason !== "string" ||
        reason.trim().length < 20 ||
        setupProblems(REPO_ROOT, entry[1], entry[2]).length === 0
      );
    });

    expect(stale).toEqual([]);
  });

  test("no local composite action reaches configure.sh (the walk does not follow `uses: ./.github/actions/...`)", () => {
    const reaching = actionFiles.filter((file) => {
      const steps = (readYaml(file).runs || {}).steps || [];
      return steps.some((step) => {
        return reachesConfigure(REPO_ROOT, stepCommand(step), "", file);
      });
    });

    expect(actionFiles).toContain(SETUP_GOMPLATE_ACTION);

    expect(reaching).toEqual([]);
  });
});

/*
 * The walk, on a throwaway repository laid out like this one, so each case is
 * a controlled positive or negative.
 */
describe("the walk from a step to configure.sh", () => {
  let root;

  const write = (relativePath, contents) => {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  };

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "gomplate-reach-"));
    write(
      "package.json",
      JSON.stringify({
        scripts: {
          prerun:
            "node ./Scripts/Install/SyncPackageVersions.js && bash ./Scripts/Install/configure.sh",
          dev: "npm run config-to-dev && npm run prerun && docker compose up -d",
          "force-build": "npm run prerun && docker compose build",
          "force-build-dev": "npm run config-to-dev && npm run force-build",
          "config-to-dev": "node ./Scripts/Install/ReplaceValueInConfig.js",
          "status-check": "bash ./Tests/Scripts/status-check.sh",
          "run-e2e": "bash ./packages/E2E/scripts/index.sh",
        },
      }),
    );
    write(CONFIGURE_SH, "#!/usr/bin/env bash\necho configure\n");
    write(
      "Tests/Scripts/status-check.sh",
      "#!/usr/bin/env bash\ncurl -f localhost\n",
    );
    write(
      "packages/Common/package.json",
      JSON.stringify({ scripts: { test: "jest", compile: "tsc" } }),
    );
    write(
      "packages/Common/test-setup.sh",
      "#!/usr/bin/env bash\ncd ../..\ncat <<EOL > config.env\nNODE_ENV=test\nEOL\nnpm run prerun\n",
    );
    write(
      "packages/Probe/package.json",
      JSON.stringify({ scripts: { dev: "nodemon" } }),
    );
    write(
      "packages/E2E/scripts/index.sh",
      '#!/usr/bin/env bash\nROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"\ncd "$ROOT_DIR"\nnpm run dev\n',
    );
    write(
      "packages/Hooks/package.json",
      JSON.stringify({
        scripts: { pretest: "npm --prefix ../.. run prerun", test: "jest" },
      }),
    );
    write(
      "packages/Postinstall/package.json",
      JSON.stringify({
        scripts: { postinstall: "cd ../.. && npm run force-build-dev" },
      }),
    );
    write(
      "packages/Loop/package.json",
      JSON.stringify({ scripts: { a: "npm run b", b: "npm run a" } }),
    );
    write("Scripts/loop.sh", "#!/usr/bin/env bash\nbash ./Scripts/loop.sh\n");
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const reaches = (command, dir = "") => {
    return reachesConfigure(root, command, dir, "run") !== null;
  };

  test.each([
    ["npm run prerun"],
    ['npm run dev --services="app ingress"'],
    ["npm run force-build-dev"],
    ["bash ./Scripts/Install/configure.sh"],
    ["sudo -E bash Scripts/Install/configure.sh"],
    ["./Scripts/Install/configure.sh"],
    ['bash "${GITHUB_WORKSPACE}/Scripts/Install/configure.sh"'],
    ["source Scripts/Install/configure.sh"],
    ['bash -c "npm run prerun"'],
    ["bash -euo pipefail ./Scripts/Install/configure.sh"],
    [
      "set -euo pipefail\nnpm run prerun\nbash ./Tests/Scripts/enable-billing-env-var.sh",
    ],
    ["if ! npm run prerun; then exit 1; fi"],
    ["export $(grep -v '^#' config.env | xargs) && npm run dev"],
    ["CI=true timeout 600 npm run prerun 2>&1 | tee prerun.log"],
    ["cd packages/Common && bash test-setup.sh"],
    ["npm run run-e2e"],
    ['cd "$SOMEWHERE" && npm run dev'],
    ["cd packages/Hooks && npm test"],
    ["cd packages/Postinstall\nnpm ci"],
    ["npm --prefix . run prerun"],
  ])("reaches it: %s", (command) => {
    expect(reaches(command)).toBe(true);
  });

  test("follows a script run from its step's working directory", () => {
    expect(reaches("bash test-setup.sh", "packages/Common")).toBe(true);
    expect(reaches("bash test-setup.sh")).toBe(false);
  });

  test.each([
    [
      `sed -n 's/^GOMPLATE_VERSION="\\([0-9.]*\\)"$/\\1/p' Scripts/Install/configure.sh`,
    ],
    ["GOMPLATE_VERSION=\"$(sed -n 's/x/y/p' Scripts/Install/configure.sh)\""],
    ["grep GOMPLATE_VERSION Scripts/Install/configure.sh"],
    ["cat ./Scripts/Install/configure.sh > /dev/null"],
    ["# npm run prerun"],
    ['echo "run npm run prerun first" >&2'],
    [
      "cat <<EOF > notes.txt\nnpm run prerun\nbash Scripts/Install/configure.sh\nEOF",
    ],
    ["cd packages/Probe && npm run dev"],
    ["cd packages/Common && npm test && npm run compile"],
    ["npm run status-check"],
    ["npm install -g npm@11"],
    ["cd packages/Postinstall && npm ci --ignore-scripts"],
    ["npm run config-to-dev"],
    ["cd packages/Loop && npm run a"],
    ["bash ./Scripts/loop.sh"],
    ["bash ./Scripts/Install/does-not-exist.sh"],
    ["npx eslint Scripts/Install/configure.sh"],
  ])("does not reach it: %s", (command) => {
    expect(reaches(command)).toBe(false);
  });

  test("names the chain it followed", () => {
    expect(
      reachesConfigure(
        root,
        "cd packages/Common && bash test-setup.sh",
        "",
        "run",
      ),
    ).toEqual([
      "run: bash test-setup.sh",
      "packages/Common/test-setup.sh: npm run prerun",
      'package.json "prerun": bash ./Scripts/Install/configure.sh',
    ]);
  });

  describe("and the check built on it", () => {
    const checkout = { uses: "actions/checkout@v4" };
    const setup = { name: "Set up gomplate", uses: SETUP_GOMPLATE };
    const prerun = { name: "Preinstall", run: "npm run prerun" };
    const retried = {
      name: "Preinstall",
      uses: "nick-fields/retry@v3",
      with: { max_attempts: 3, command: "npm run prerun" },
    };
    const problems = (steps, runsOn = "ubuntu-latest", extra = {}) => {
      return setupProblems(root, {}, { "runs-on": runsOn, steps, ...extra });
    };

    test("passes setup-gomplate after the checkout and before prerun", () => {
      expect(problems([checkout, setup, prerun])).toEqual([]);
      expect(problems([checkout, setup, retried])).toEqual([]);
    });

    test("fails prerun with no setup-gomplate step", () => {
      expect(problems([checkout, prerun])).toHaveLength(1);
      expect(problems([checkout, retried])).toHaveLength(1);
    });

    test("fails setup-gomplate after the step that needs it", () => {
      expect(problems([checkout, prerun, setup])).toHaveLength(1);
    });

    test("fails a test-setup.sh step without it, from the working directory", () => {
      const step = {
        run: "bash test-setup.sh",
        "working-directory": "packages/Common",
      };
      expect(problems([checkout, step])).toHaveLength(1);
      expect(
        problems([checkout, { run: "bash test-setup.sh" }], "ubuntu-latest", {
          defaults: { run: { "working-directory": "packages/Common" } },
        }),
      ).toHaveLength(1);
      expect(problems([checkout, setup, step])).toEqual([]);
    });

    test("fails setup-gomplate before the checkout, or after a checkout elsewhere", () => {
      expect(problems([setup, checkout, prerun])).toHaveLength(1);
      expect(
        problems([
          { uses: "actions/checkout@v4", with: { path: "src" } },
          setup,
          prerun,
        ]),
      ).toHaveLength(1);
    });

    test("fails setup-gomplate on a runner it has no pin for", () => {
      expect(problems([checkout, setup, prerun], "macos-latest")).toHaveLength(
        1,
      );
      expect(
        problems([checkout, setup, prerun], "${{ matrix.runner }}", {
          strategy: {
            matrix: {
              include: [
                { runner: "ubuntu-latest" },
                { runner: "windows-latest" },
              ],
            },
          },
        }),
      ).toHaveLength(1);
      expect(
        problems([checkout, setup, prerun], "${{ matrix.runner }}", {
          strategy: {
            matrix: {
              include: [
                { runner: "ubuntu-latest" },
                { runner: "ubuntu-24.04-arm" },
              ],
            },
          },
        }),
      ).toEqual([]);
    });
  });
});

/*
 * configure.sh's half of the contract: with gomplate on PATH it downloads
 * nothing. setup_gomplate runs for real, extracted from configure.sh, on a
 * PATH that holds only the tools it uses plus a curl and a sudo that record
 * their calls and fail.
 */
describe("configure.sh's setup_gomplate", () => {
  const configure = read(CONFIGURE_SH);
  const functionSource = (name) => {
    return (configure.match(
      new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, "m"),
    ) || [""])[0];
  };
  const versionLine = (configure.match(/^GOMPLATE_VERSION=.*$/m) || [""])[0];
  const workspaces = [];

  afterAll(() => {
    for (const dir of workspaces) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function which(tool) {
    const result = spawnSync("bash", ["-c", `command -v ${tool}`], {
      encoding: "utf8",
    });
    return result.stdout.trim();
  }

  function run(withGomplate) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setup-gomplate-"));
    workspaces.push(dir);
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    // Only these tools, so a gomplate installed on this machine is not found.
    for (const tool of ["uname", "mktemp", "rm", "head", "grep"]) {
      fs.symlinkSync(which(tool), path.join(bin, tool));
    }
    for (const tool of ["curl", "sudo"]) {
      fs.writeFileSync(
        path.join(bin, tool),
        `#!${which("bash")}\necho "${tool} $*" >> "$CALLS"\nexit 1\n`,
        { mode: 0o755 },
      );
    }
    if (withGomplate) {
      fs.writeFileSync(
        path.join(bin, "gomplate"),
        `#!${which("bash")}\necho "gomplate $*" >> "$CALLS"\n`,
        { mode: 0o755 },
      );
    }
    const harness = [
      "set -euo pipefail",
      versionLine,
      functionSource("print_info"),
      functionSource("print_error"),
      functionSource("command_exists"),
      functionSource("setup_gomplate"),
      "setup_gomplate",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "harness.sh"), harness);

    const result = spawnSync(which("bash"), [path.join(dir, "harness.sh")], {
      encoding: "utf8",
      env: { PATH: bin, CALLS: path.join(dir, "calls.log"), HOME: dir },
    });
    const log = path.join(dir, "calls.log");
    const calls = fs.existsSync(log)
      ? fs.readFileSync(log, "utf8").trim().split("\n")
      : [];
    return { result, calls };
  }

  test("is found in configure.sh", () => {
    expect(versionLine).toMatch(/^GOMPLATE_VERSION="\d+\.\d+\.\d+"$/);
    expect(functionSource("setup_gomplate")).toContain(
      "if ! command_exists gomplate; then",
    );
    expect(functionSource("command_exists")).toContain("command -v");
  });

  test("downloads nothing when gomplate is on PATH", () => {
    const { result, calls } = run(true);

    expect(result.status).toBe(0);
    expect(calls).toEqual([]);
  });

  test("downloads gomplate from GitHub when it is not (the negative control)", () => {
    const { result, calls } = run(false);
    const version = versionLine.match(/"(.*)"/)[1];

    expect(result.status).not.toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(
      `https://github.com/hairyhenderson/gomplate/releases/download/v${version}/gomplate_`,
    );
  });
});

/*
 * The action's pins. It checks the version at runtime too, but only in a job
 * that runs it -- the image builds after a merge, and the release. Checked
 * here, a bump that forgets the action fails on its own pull request.
 */
describe("the setup-gomplate action pins the gomplate configure.sh pins", () => {
  const action = readYaml(SETUP_GOMPLATE_ACTION);
  const steps = action.runs.steps;
  const pinStep = steps.find((step) => {
    return step.id === "pin";
  });
  const pin = pinStep ? pinStep.run : "";
  const configureVersion = (read(CONFIGURE_SH).match(
    /^GOMPLATE_VERSION="(\d+\.\d+\.\d+)"$/m,
  ) || [])[1];
  const digest = (runnerArch, platform) => {
    const found = pin.match(
      new RegExp(
        `^\\s*Linux/${runnerArch}\\)\\s*\\n\\s*platform="${platform}"\\s*\\n\\s*sha256="([^"]*)"`,
        "m",
      ),
    );
    return found ? found[1] : undefined;
  };

  test("is a composite action with a pin step", () => {
    expect(action.runs.using).toBe("composite");
    expect(pin).not.toBe("");
  });

  test("its pinned version is configure.sh's GOMPLATE_VERSION", () => {
    const pinned = (pin.match(/^\s*pinned_version="([^"]*)"$/m) || [])[1];

    expect(configureVersion).toBeDefined();
    expect(pinned).toBe(configureVersion);
  });

  test("the version it reads out of configure.sh at runtime is that version", () => {
    // Run the action's own line, so a reformatted configure.sh cannot slip by.
    const readsVersion = pin
      .split("\n")
      .map((line) => {
        return line.trim();
      })
      .find((line) => {
        return line.startsWith("version=");
      });

    expect(readsVersion).toBeDefined();

    const result = spawnSync(
      "bash",
      ["-c", `set -euo pipefail\n${readsVersion}\nprintf '%s' "$version"`],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(configureVersion);
  });

  test("it pins a distinct sha256 for Linux X64 and ARM64", () => {
    const amd64 = digest("X64", "linux-amd64");
    const arm64 = digest("ARM64", "linux-arm64");

    expect(amd64).toMatch(/^[0-9a-f]{64}$/);
    expect(arm64).toMatch(/^[0-9a-f]{64}$/);
    expect(amd64).not.toBe(arm64);
  });

  test("every other gomplate pin in .github agrees with it", () => {
    /*
     * test.ops.yaml installs gomplate itself (for the renderer parity check
     * in EnterpriseEditionBuild.test.js, which pins that step) with its own
     * copy of the version and the linux-amd64 digest. It runs no prerun, so
     * it needs no setup step, but two pins of one file must not disagree.
     */
    const pinnedDigests = [
      digest("X64", "linux-amd64"),
      digest("ARM64", "linux-arm64"),
    ];
    const pinnedVersion = (pin.match(/^\s*pinned_version="([^"]*)"$/m) ||
      [])[1];
    const elsewhere = [
      ...workflowFiles,
      ...actionFiles.filter((file) => {
        return file !== SETUP_GOMPLATE_ACTION;
      }),
    ];
    const others = elsewhere.flatMap((file) => {
      const text = read(file);
      return [
        ...[...text.matchAll(/GOMPLATE_[A-Z0-9_]*SHA256="([^"]*)"/g)].map(
          (match) => {
            return [file, "sha256", match[1], pinnedDigests];
          },
        ),
        ...[...text.matchAll(/GOMPLATE_PINNED_VERSION="([^"]*)"/g)].map(
          (match) => {
            return [file, "version", match[1], [pinnedVersion]];
          },
        ),
      ];
    });
    const disagreeing = others.filter(([, , value, expected]) => {
      return !expected.includes(value);
    });

    expect(disagreeing).toEqual([]);
  });

  test("it downloads the pinned version for the runner's platform and verifies it against the pin", () => {
    const fetch = steps.find((step) => {
      return /fetch_pinned_artifact\.sh/.test(step.run || "");
    });

    expect(fetch).toBeDefined();
    expect(fetch.env).toEqual(
      expect.objectContaining({
        GOMPLATE_VERSION: "${{ steps.pin.outputs.version }}",
        GOMPLATE_PLATFORM: "${{ steps.pin.outputs.platform }}",
        GOMPLATE_SHA256: "${{ steps.pin.outputs.sha256 }}",
      }),
    );
    expect(fetch.run).toContain('--sha256 "$GOMPLATE_SHA256"');
    expect(fetch.run).toContain(
      '"https://github.com/hairyhenderson/gomplate/releases/download/v${GOMPLATE_VERSION}/gomplate_${GOMPLATE_PLATFORM}"',
    );
  });
});
