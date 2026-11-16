// Lint the repository, or the files a branch changed, one TypeScript project
// at a time.
//
// eslint.config.js lints with type information (typescript-eslint's
// projectService). TypeScript's project service gives every file the program
// of the nearest tsconfig.json that contains it -- walking up to an ancestor
// tsconfig.json when the nearest one excludes it -- and typescript-eslint keeps
// every program it has built until ESLint exits. A single `eslint .` therefore
// ends up holding all of the repository's programs at once. Together they
// outgrew the 16 GB GitHub runner, and the js-lint job was OOM-killed mid-run
// ("Killed", then "The runner has received a shutdown signal", then "The
// operation was canceled.").
//
// The same holds for a handful of files: `npx eslint` over the files a branch
// changed in App, the Dashboard and Common builds the program of each, and a
// branch touching several of them runs out of the heap. On 2026-11-16 the 51
// TypeScript files of #7353 (Common, four Common test folders, App, the
// Dashboard and the Admin Dashboard) ran ESLint out of an 8 GB heap in 76 s,
// at 8.9 GB (#6848). Linted with --changed, or with their paths after --,
// they are grouped by project too, one ESLint process per group: ten of
// them, the largest at 6.9 GB, 3m53s in all. `npm run lint:changed` gives
// each the 12 GB heap `npm run lint` gives the same programs.
//
// A file that no nearer tsconfig.json's program contains lands in the
// repository-root tsconfig.json's, which has no "include" and so is the whole
// monorepo: 29,574 files on 2026-11-10, more than an ESLint process holds in
// its 12 GB heap. packages/Common/Tests and packages/CLI/Tests used to,
// excluded by their package's tsconfig, and so did the TypeScript under the
// repository's own Tests from 2026-11-05; each now has a tsconfig.json of its
// own, as any folder of TypeScript outside the packages needs.
// --list-projects lists under "tsconfig.json" the files that may land there
// (see projectOf).
//
// This script works out which project each lintable file lands in and runs
// ESLint once per project, one after another, so each ESLint process builds
// and holds just that one program. Nothing about what is linted changes:
//   - the same eslint.config.js and rules apply to every file;
//   - the project service still picks each file's program itself, exactly as
//     under `eslint .` -- the grouping here only decides which files share a
//     process, so a file grouped wrongly costs memory, never correctness;
//   - linting the whole repository, a last run lints `.` minus every path the
//     per-project runs covered, so a file this script did not foresee is
//     still linted, exactly once.
//
// Usage: node Scripts/Lint/LintByProject.js [eslint options...]
//        node Scripts/Lint/LintByProject.js --changed[=<ref>] [eslint options...]
//        node Scripts/Lint/LintByProject.js [eslint options...] -- <path>...
//        node Scripts/Lint/LintByProject.js --list-projects [--changed | -- <path>...]
//   With neither --changed nor paths, the whole repository is linted
//   (`npm run lint`, `npm run fix-lint`).
//   --changed lints the files that differ from where the branch left
//   origin/main (its merge base with it): committed, staged, unstaged and
//   untracked, but not deleted (`npm run lint:changed`, `npm run
//   fix-lint:changed`). --changed=<ref> compares with another branch.
//   After --, the files and directories given are linted, relative to the
//   directory the command was typed in.
//   Either way only what eslint.config.js lints is linted: an ignored file,
//   a .js file say, is left out rather than passed to ESLint. The checkout
//   linted is the one this script is in, so a copy of the repository under
//   .claude/worktrees lints its own files with its own config, which ignores
//   the worktrees only of the checkout around it.
//   Options are passed to every ESLint run (e.g. --cache, --fix, --debug,
//   --format). The runs are sequential, so with --cache they share one cache
//   file; ESLint does not prune entries for files a run did not lint.
//   --list-projects prints the grouping and lints nothing.
// The exit code is the highest one any run returned: 1 when a file has a
// lint error, 2 when ESLint could not run (or was killed, out of memory say),
// or when what to lint could not be worked out.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const resolveFromRoot = (request) => {
  try {
    return require.resolve(request, { paths: [REPO_ROOT] });
  } catch (error) {
    throw new Error(
      `${request} is not installed at ${REPO_ROOT}: run npm install there first (${error.message})`,
    );
  }
};
const ts = require(resolveFromRoot("typescript"));
const { ESLint } = require(resolveFromRoot("eslint"));
const ESLINT_BIN = path.join(
  path.dirname(resolveFromRoot("eslint/package.json")),
  "bin",
  "eslint.js",
);

// What --changed compares with when no <ref> is given.
const DEFAULT_BASE = "origin/main";

const LINTABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
]);
// Never linted (ESLint's own defaults), and far too big to walk.
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);
/*
 * ESLint answers isPathIgnored for files, not directories, so a directory is
 * asked about through a file inside it: one that eslint.config.js ignores as
 * a whole (build output, .claude/worktrees copies of the repository, ...) is
 * not walked. A file this skips by mistake is still linted by the last run.
 */
const DIRECTORY_PROBE_FILE = "__lint_by_project_probe__.ts";

const toPosix = (p) => {
  return p.split(path.sep).join("/");
};

class UsageError extends Error {}

/*
 * [--list-projects] [--changed[=<ref>]] [eslint options...] [-- <path>...]
 * Everything that is not this script's own goes to ESLint, up to a `--`,
 * after which every argument is a path.
 */
function parseArguments(argv) {
  const parsed = {
    listProjects: false,
    changedSince: null,
    paths: null,
    eslintArgs: [],
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") {
      parsed.paths = argv.slice(index + 1);
      break;
    }
    if (arg === "--list-projects") {
      parsed.listProjects = true;
    } else if (arg === "--changed") {
      parsed.changedSince = DEFAULT_BASE;
    } else if (arg.startsWith("--changed=")) {
      const base = arg.slice("--changed=".length);
      if (!base) {
        throw new UsageError(
          "--changed= needs the branch to compare with, e.g. --changed=origin/main",
        );
      }
      parsed.changedSince = base;
    } else {
      parsed.eslintArgs.push(arg);
    }
  }
  if (parsed.changedSince !== null && parsed.paths !== null) {
    throw new UsageError(
      "Lint the changed files (--changed) or the paths after --, not both.",
    );
  }
  if (parsed.paths !== null && parsed.paths.length === 0) {
    throw new UsageError("Name at least one file or directory after --.");
  }
  return parsed;
}

function git(args, cwd) {
  const run = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error) {
    throw new Error(
      `could not run git ${args.join(" ")}: ${run.error.message}`,
    );
  }
  if (run.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(run.stderr || "").trim() || `exit ${run.status}`}`,
    );
  }
  return run.stdout;
}

/*
 * The files of `root` that differ from the merge base of HEAD and `base`:
 * committed on the branch, staged, unstaged, and untracked (but not ignored
 * by git), as absolute paths. Deleted files are left out; a renamed one is
 * its new path.
 */
function changedFiles(base, root = REPO_ROOT) {
  let topLevel;
  let mergeBase;
  try {
    topLevel = git(["rev-parse", "--show-toplevel"], root).trim();
    mergeBase = git(["merge-base", base, "HEAD"], topLevel).trim();
  } catch (error) {
    throw new UsageError(
      `Cannot tell what this branch changed since ${base}: ${error.message}\n` +
        `Fetch it (git fetch origin main), or compare with another branch: --changed=<branch>.`,
    );
  }
  // Both list paths from the top level (git runs there), never quoted (-z).
  const listed = [
    git(
      [
        "diff",
        "--name-only",
        "-z",
        "--no-renames",
        "--diff-filter=d",
        mergeBase,
      ],
      topLevel,
    ),
    git(["ls-files", "--others", "--exclude-standard", "-z"], topLevel),
  ].join("\0");
  /*
   * git names the top level by its real path; the files are returned under
   * `root` as the caller wrote it, which may run through a symlink.
   */
  const rootFromTopLevel = toPosix(
    path.relative(fs.realpathSync(topLevel), fs.realpathSync(root)),
  );
  const files = new Set();
  for (const relativePath of listed.split("\0")) {
    if (!relativePath) {
      continue;
    }
    let underRoot = relativePath;
    if (rootFromTopLevel) {
      if (!relativePath.startsWith(`${rootFromTopLevel}/`)) {
        continue;
      }
      underRoot = relativePath.slice(rootFromTopLevel.length + 1);
    }
    const absolute = path.join(root, underRoot);
    if (fs.existsSync(absolute)) {
      files.add(absolute);
    }
  }
  return { mergeBase, files: [...files].sort() };
}

function isInside(file, root) {
  const relative = path.relative(root, file);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/*
 * The files named, and the lintable files in the directories named (minus
 * the directories eslint.config.js ignores), as absolute paths resolved from
 * `cwd`; `named` holds the ones named one by one. A path that does not
 * exist, or that is outside `root`, is a usage error.
 */
async function filesAt(paths, cwd, root = REPO_ROOT) {
  const eslint = new ESLint({ cwd: root });
  const missing = [];
  const outside = [];
  const files = new Set();
  const named = new Set();
  const walk = async (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          !SKIPPED_DIRECTORIES.has(entry.name) &&
          !(await eslint.isPathIgnored(path.join(full, DIRECTORY_PROBE_FILE)))
        ) {
          await walk(full);
        }
      } else if (
        entry.isFile() &&
        LINTABLE_EXTENSIONS.has(path.extname(entry.name))
      ) {
        files.add(full);
      }
    }
  };
  for (const given of paths) {
    const absolute = path.resolve(cwd, given);
    if (!fs.existsSync(absolute)) {
      missing.push(given);
    } else if (absolute !== root && !isInside(absolute, root)) {
      outside.push(given);
    } else if (fs.statSync(absolute).isDirectory()) {
      await walk(absolute);
    } else {
      files.add(absolute);
      named.add(absolute);
    }
  }
  if (missing.length > 0 || outside.length > 0) {
    throw new UsageError(
      [
        ...missing.map((given) => {
          return `No such file or directory: ${given}`;
        }),
        ...outside.map((given) => {
          return `Not in this repository (${root}): ${given}`;
        }),
      ].join("\n"),
    );
  }
  return { files: [...files].sort(), named };
}

/*
 * The files ESLint would lint if it were given them: a lintable extension,
 * and not ignored by eslint.config.js (which ignores every .js file, for
 * one). The lintable kinds it ignores are returned apart (`ignored`), so the
 * caller can say what it left out; other files (Markdown, JSON) are dropped.
 */
async function splitLintable(files, root = REPO_ROOT) {
  const eslint = new ESLint({ cwd: root });
  const candidates = files.filter((file) => {
    return LINTABLE_EXTENSIONS.has(path.extname(file));
  });
  const isIgnored = await Promise.all(
    candidates.map((file) => {
      return eslint.isPathIgnored(file);
    }),
  );
  return {
    lintable: candidates.filter((_file, index) => {
      return !isIgnored[index];
    }),
    ignored: candidates.filter((_file, index) => {
      return isIgnored[index];
    }),
  };
}

// Every file ESLint would lint for `eslint .`, as absolute paths.
async function listLintableFiles() {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const candidates = [];
  const walk = async (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          !SKIPPED_DIRECTORIES.has(entry.name) &&
          !(await eslint.isPathIgnored(path.join(full, DIRECTORY_PROBE_FILE)))
        ) {
          await walk(full);
        }
      } else if (
        entry.isFile() &&
        LINTABLE_EXTENSIONS.has(path.extname(entry.name))
      ) {
        candidates.push(full);
      }
    }
  };
  await walk(REPO_ROOT);
  const ignored = await Promise.all(
    candidates.map((file) => {
      return eslint.isPathIgnored(file);
    }),
  );
  return candidates.filter((_file, index) => {
    return !ignored[index];
  });
}

// tsconfig.json path -> Set of the root files its program is built from.
const rootFilesByConfig = new Map();
function rootFilesOf(configPath) {
  if (!rootFilesByConfig.has(configPath)) {
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: () => {},
    });
    rootFilesByConfig.set(
      configPath,
      new Set(
        (parsed ? parsed.fileNames : []).map((file) => {
          return path.resolve(file);
        }),
      ),
    );
  }
  return rootFilesByConfig.get(configPath);
}

/*
 * The tsconfig.json whose program the project service puts a file in: the
 * nearest one that includes it, else the next one up. (The service also
 * accepts a nearer tsconfig.json whose program merely imports the file; that
 * is not visible without building the program. Such a file is grouped with
 * the ancestor project instead -- harmless, see the header.) null: no
 * tsconfig.json in the repository includes the file.
 */
function projectOf(file, root = REPO_ROOT) {
  let dir = path.dirname(file);
  for (;;) {
    const configPath = path.join(dir, "tsconfig.json");
    if (fs.existsSync(configPath) && rootFilesOf(configPath).has(file)) {
      return configPath;
    }
    if (dir === root || dir === path.dirname(dir)) {
      return null;
    }
    dir = path.dirname(dir);
  }
}

/*
 * The files by the project each lands in (projectOf): the projects in name
 * order, then the files no project includes, under null.
 */
function filesByProject(files, root = REPO_ROOT) {
  const groups = new Map();
  for (const file of files) {
    const project = projectOf(file, root);
    if (!groups.has(project)) {
      groups.set(project, []);
    }
    groups.get(project).push(file);
  }
  const projects = [...groups.keys()]
    .filter((project) => {
      return project !== null;
    })
    .sort();
  if (groups.has(null)) {
    projects.push(null);
  }
  return new Map(
    projects.map((project) => {
      return [project, groups.get(project)];
    }),
  );
}

/*
 * The fewest paths (directories, or single files) that cover exactly each
 * project's files: a directory whose lintable files all belong to one
 * project is passed whole.
 */
function pathsByProject(files) {
  const root = { dirs: new Map(), files: [], projects: new Set() };
  for (const file of files) {
    const project = projectOf(file);
    const parts = toPosix(path.relative(REPO_ROOT, file)).split("/");
    let node = root;
    node.projects.add(project);
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) {
        node.dirs.set(part, {
          dirs: new Map(),
          files: [],
          projects: new Set(),
        });
      }
      node = node.dirs.get(part);
      node.projects.add(project);
    }
    node.files.push({ name: parts[parts.length - 1], project });
  }
  const result = new Map(); // project -> { paths: [], fileCount }
  const add = (project, relativePath, count) => {
    if (!result.has(project)) {
      result.set(project, { paths: [], fileCount: 0 });
    }
    result.get(project).paths.push(relativePath);
    result.get(project).fileCount += count;
  };
  const countFiles = (node) => {
    let count = node.files.length;
    for (const child of node.dirs.values()) {
      count += countFiles(child);
    }
    return count;
  };
  const visit = (node, relativeDir) => {
    if (node.projects.size === 1) {
      add([...node.projects][0], relativeDir || ".", countFiles(node));
      return;
    }
    for (const { name, project } of node.files) {
      add(project, relativeDir ? `${relativeDir}/${name}` : name, 1);
    }
    for (const [name, child] of node.dirs) {
      visit(child, relativeDir ? `${relativeDir}/${name}` : name);
    }
  };
  visit(root, "");
  return result;
}

// An --ignore-pattern that matches exactly this path (and all under it).
function ignorePatternFor(relativePath) {
  if (relativePath === ".") {
    return "**";
  }
  const escaped = relativePath.replace(/[\\*?[\]{}()!+@,]/g, "\\$&");
  return fs.statSync(path.join(REPO_ROOT, relativePath)).isDirectory()
    ? `${escaped}/**`
    : escaped;
}

function projectName(project) {
  return project === null
    ? "files in no project"
    : toPosix(path.relative(REPO_ROOT, project));
}

function runEslint(label, eslintArgs, userArgs) {
  const args = [ESLINT_BIN, ...eslintArgs, ...userArgs];
  const started = Date.now();
  process.stderr.write(`\n[lint] ${label}\n`);
  const run = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (run.error) {
    process.stderr.write(
      `[lint] ${label}: could not start ESLint: ${run.error.message}\n`,
    );
    return 2;
  }
  if (run.status === null) {
    process.stderr.write(
      `[lint] ${label}: ESLint was killed by ${run.signal} after ${seconds}s\n`,
    );
    return 2;
  }
  process.stderr.write(`[lint] ${label}: exit ${run.status} in ${seconds}s\n`);
  return run.status;
}

// The whole repository: every project's paths, then the rest (`npm run lint`).
async function lintRepository({ listProjects, eslintArgs }) {
  const files = await listLintableFiles();
  const groups = pathsByProject(files);
  const projects = [...groups.keys()]
    .filter((project) => {
      return project !== null;
    })
    .sort();

  if (listProjects) {
    for (const project of [...projects, null]) {
      const { paths, fileCount } = groups.get(project) || {
        paths: [],
        fileCount: 0,
      };
      const name = project
        ? toPosix(path.relative(REPO_ROOT, project))
        : "(no project)";
      process.stdout.write(`${name}: ${fileCount} files\n`);
      for (const relativePath of paths) {
        process.stdout.write(`  ${relativePath}\n`);
      }
    }
    return 0;
  }

  let exitCode = 0;
  const covered = [];
  for (const project of projects) {
    const { paths, fileCount } = groups.get(project);
    exitCode = Math.max(
      exitCode,
      runEslint(
        `${projectName(project)}: ${fileCount} files`,
        [...paths, "--no-error-on-unmatched-pattern"],
        eslintArgs,
      ),
    );
    covered.push(...paths);
  }

  // Everything else: files in no project, and any file ESLint lints that the
  // walk above did not list.
  const ignoreArgs = covered.flatMap((relativePath) => {
    return ["--ignore-pattern", ignorePatternFor(relativePath)];
  });
  exitCode = Math.max(
    exitCode,
    runEslint(
      "files outside the projects above",
      [".", ...ignoreArgs, "--no-error-on-unmatched-pattern"],
      eslintArgs,
    ),
  );
  return exitCode;
}

/*
 * The files a branch changed, or the paths given: one ESLint run per project.
 * `shown(file)` says whether a file eslint.config.js ignores is worth naming
 * as left out (a changed .js file is; one of a directory named is not).
 */
async function lintFiles(
  files,
  { listProjects, eslintArgs, described, shown },
) {
  const { lintable, ignored } = await splitLintable(files);
  const groups = filesByProject(lintable);
  const leftOut = ignored.filter(shown);

  process.stderr.write(
    `[lint] ${described}: ${lintable.length} files to lint, in ${groups.size} ${
      groups.size === 1 ? "project" : "projects"
    }\n`,
  );
  if (leftOut.length > 0) {
    process.stderr.write(
      `[lint] Left out, as eslint.config.js ignores them: ${leftOut
        .slice(0, 5)
        .map((file) => {
          return toPosix(path.relative(REPO_ROOT, file));
        })
        .join(
          ", ",
        )}${leftOut.length > 5 ? ` and ${leftOut.length - 5} more` : ""}\n`,
    );
  }

  if (listProjects) {
    for (const [project, projectFiles] of groups) {
      process.stdout.write(
        `${project === null ? "(no project)" : projectName(project)}: ${projectFiles.length} files\n`,
      );
      for (const file of projectFiles) {
        process.stdout.write(`  ${toPosix(path.relative(REPO_ROOT, file))}\n`);
      }
    }
    return 0;
  }

  let exitCode = 0;
  for (const [project, projectFiles] of groups) {
    exitCode = Math.max(
      exitCode,
      runEslint(
        `${projectName(project)}: ${projectFiles.length} files`,
        projectFiles.map((file) => {
          return toPosix(path.relative(REPO_ROOT, file));
        }),
        eslintArgs,
      ),
    );
  }
  return exitCode;
}

async function main(argv) {
  const options = parseArguments(argv);

  if (options.changedSince !== null) {
    const { mergeBase, files } = changedFiles(options.changedSince);
    return await lintFiles(files, {
      ...options,
      described: `changed since ${options.changedSince} (merge base ${mergeBase.slice(0, 12)})`,
      shown: () => {
        return true;
      },
    });
  }

  if (options.paths !== null) {
    /*
     * npm runs a script from the package's directory, and says in INIT_CWD
     * where it was typed; run any other way, that is the working directory.
     */
    const cwd =
      process.env["npm_lifecycle_event"] && process.env["INIT_CWD"]
        ? process.env["INIT_CWD"]
        : process.cwd();
    const { files, named } = await filesAt(options.paths, cwd);
    return await lintFiles(files, {
      ...options,
      described: `${options.paths.length} ${options.paths.length === 1 ? "path" : "paths"} given`,
      shown: (file) => {
        return named.has(file);
      },
    });
  }

  return await lintRepository(options);
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      process.stderr.write(
        `${error instanceof UsageError ? `[lint] ${error.message}` : (error && error.stack) || error}\n`,
      );
      process.exitCode = 2;
    },
  );
}

module.exports = {
  DEFAULT_BASE,
  REPO_ROOT,
  UsageError,
  parseArguments,
  changedFiles,
  filesAt,
  splitLintable,
  projectOf,
  filesByProject,
  pathsByProject,
  main,
};
