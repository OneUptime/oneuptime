// Lint the repository one TypeScript project at a time.
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
// A file that no nearer tsconfig.json's program contains lands in the
// repository-root tsconfig.json's, which has no "include" and so is the whole
// monorepo. packages/Common/Tests and packages/CLI/Tests used to, excluded by
// their package's tsconfig; each now has a Tests/tsconfig.json of its own.
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
//   - a last run lints `.` minus every path the per-project runs covered, so a
//     file this script did not foresee is still linted, exactly once.
//
// Usage: node Scripts/Lint/LintByProject.js [eslint options...]
//        node Scripts/Lint/LintByProject.js --list-projects
//   Options are passed to every ESLint run (e.g. --cache, --fix, --debug,
//   --format). The runs are sequential, so with --cache they share one cache
//   file; ESLint does not prune entries for files a run did not lint.
//   --list-projects prints the grouping and lints nothing.
// The exit code is the highest one any run returned.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const resolveFromRoot = (request) => {
  return require.resolve(request, { paths: [REPO_ROOT] });
};
const ts = require(resolveFromRoot("typescript"));
const { ESLint } = require(resolveFromRoot("eslint"));
const ESLINT_BIN = path.join(
  path.dirname(resolveFromRoot("eslint/package.json")),
  "bin",
  "eslint.js",
);

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
function projectOf(file) {
  let dir = path.dirname(file);
  for (;;) {
    const configPath = path.join(dir, "tsconfig.json");
    if (fs.existsSync(configPath) && rootFilesOf(configPath).has(file)) {
      return configPath;
    }
    if (dir === REPO_ROOT) {
      return null;
    }
    dir = path.dirname(dir);
  }
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

async function main() {
  const userArgs = process.argv.slice(2);
  const files = await listLintableFiles();
  const groups = pathsByProject(files);
  const projects = [...groups.keys()]
    .filter((project) => {
      return project !== null;
    })
    .sort();

  if (userArgs.includes("--list-projects")) {
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
    return;
  }

  let exitCode = 0;
  const covered = [];
  for (const project of projects) {
    const { paths, fileCount } = groups.get(project);
    const name = toPosix(path.relative(REPO_ROOT, project));
    exitCode = Math.max(
      exitCode,
      runEslint(
        `${name}: ${fileCount} files`,
        [...paths, "--no-error-on-unmatched-pattern"],
        userArgs,
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
      userArgs,
    ),
  );
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`${(error && error.stack) || error}\n`);
  process.exitCode = 2;
});
