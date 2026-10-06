"use strict";

/**
 * Where the repository is checked out must not decide which tests run.
 *
 * jest tests each entry of testPathIgnorePatterns, modulePathIgnorePatterns,
 * transformIgnorePatterns, coveragePathIgnorePatterns and
 * watchPathIgnorePatterns, as a regular expression, against a file's ABSOLUTE
 * path - so an unanchored entry also matches the directories above the
 * checkout. packages/Common's "dist" did exactly that in a Claude Code
 * worktree at .claude/worktrees/distracted-dhawan-5e965a: jest reported
 * "testPathIgnorePatterns: node_modules, dist - 0 matches" and exited 1 with
 * no tests found, as App, Probe, Runner and TestServer did too. Worktree names
 * are random adjective-name pairs (distant-, distinct-, ...), and Home's
 * "build", BrowserRecorder's "public" and a "node_modules/" transform
 * allowlist fail the same way under the right parent directory.
 *
 * So every entry is anchored: to a path segment ("/dist/") when it means a
 * directory wherever it appears, or to the config's root ("<rootDir>/build/")
 * when it means the package's own. This suite reads every jest config in the
 * repository, places it in a plainly named checkout and in one whose
 * directory names contain those words, and fails if any entry gives a
 * tracked file a different verdict in the two.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// The jest options whose entries are regexes over absolute file paths.
const PATH_PATTERN_OPTIONS = [
  "testPathIgnorePatterns",
  "modulePathIgnorePatterns",
  "transformIgnorePatterns",
  "coveragePathIgnorePatterns",
  "watchPathIgnorePatterns",
];

const PLAIN_CHECKOUT = "/home/ci/oneuptime";

/*
 * The words ignore patterns name, each inside a longer directory name the way
 * "distracted-dhawan-5e965a" holds "dist" - never a whole segment. A checkout
 * under a directory named exactly "dist" is still caught by "/dist/", as one
 * under "node_modules" is by jest's own default "/node_modules/".
 */
const HOSTILE_CHECKOUT = [
  "/home/ci",
  "old_node_modules",
  "distracted-dhawan-5e965a",
  "public_html",
  "rebuild-coverage",
  "library-output",
  "oneuptime",
].join("/");

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  return result.stdout.split("\0").filter((file) => {
    return file !== "" && fs.existsSync(path.join(REPO_ROOT, file));
  });
}

const TRACKED_FILES = trackedFiles();

// A tracked jest config's options, or undefined when the file holds none.
function readJestConfig(file) {
  const absolutePath = path.join(REPO_ROOT, file);
  if (path.basename(file) === "package.json") {
    const text = fs.readFileSync(absolutePath, "utf8");
    return text.includes('"jest"') ? JSON.parse(text).jest : undefined;
  }
  switch (path.extname(file)) {
    case ".json":
      return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    case ".js":
    case ".cjs":
      return require(absolutePath);
    default:
      // Teach this suite the new format rather than let a config skip it.
      throw new Error(`${file}: no reader for this jest config format`);
  }
}

function projectName(project) {
  const displayName = project.displayName;
  return typeof displayName === "object" ? displayName.name : displayName;
}

/*
 * Every jest config in the repository, plus each inline project of one: a
 * project carries its own patterns and its own rootDir, which defaults to the
 * directory of the config that lists it.
 */
async function jestConfigs() {
  const configs = [];
  for (const file of TRACKED_FILES) {
    const name = path.basename(file);
    if (!/^jest\.config\.[a-z]+$/.test(name) && name !== "package.json") {
      continue;
    }
    let options = readJestConfig(file);
    if (typeof options === "function") {
      options = await options();
    }
    if (!options) {
      continue;
    }
    const configDir = path.dirname(path.join(REPO_ROOT, file));
    configs.push({
      name: file,
      rootDir: path.resolve(configDir, options.rootDir || "."),
      options,
    });
    for (const project of options.projects || []) {
      if (typeof project === "object") {
        configs.push({
          name: `${file} (project ${projectName(project)})`,
          rootDir: path.resolve(configDir, project.rootDir || "."),
          options: project,
        });
      }
    }
  }
  return configs;
}

// The tracked files under rootDir, relative to it.
function trackedFilesUnder(rootDir) {
  const prefix = path.relative(REPO_ROOT, rootDir);
  if (prefix.startsWith("..") || path.isAbsolute(prefix)) {
    throw new Error(`${rootDir} is outside the repository`);
  }
  if (prefix === "") {
    return TRACKED_FILES;
  }
  return TRACKED_FILES.filter((file) => {
    return file.startsWith(`${prefix}/`);
  }).map((file) => {
    return file.slice(prefix.length + 1);
  });
}

// Where rootDir sits when the repository is checked out at `checkout`.
function rootIn(checkout, rootDir) {
  return path.posix.join(checkout, path.relative(REPO_ROOT, rootDir));
}

// What jest builds from an entry: <rootDir> substituted, then a RegExp.
function compile(pattern, rootDir) {
  return new RegExp(
    pattern.replace(/<rootDir>/g, () => {
      return rootDir;
    }),
  );
}

/*
 * The files, relative to rootDir, that `pattern` treats differently in
 * HOSTILE_CHECKOUT than in PLAIN_CHECKOUT.
 */
function filesTheCheckoutDecides(pattern, rootDir, relativePaths) {
  const plainRoot = rootIn(PLAIN_CHECKOUT, rootDir);
  const hostileRoot = rootIn(HOSTILE_CHECKOUT, rootDir);
  const plain = compile(pattern, plainRoot);
  const hostile = compile(pattern, hostileRoot);
  return relativePaths.filter((relativePath) => {
    return (
      plain.test(`${plainRoot}/${relativePath}`) !==
      hostile.test(`${hostileRoot}/${relativePath}`)
    );
  });
}

describe("jest path patterns", () => {
  let configs = [];

  beforeAll(async () => {
    configs = await jestConfigs();
  });

  test("are read from every jest config, inline projects included", () => {
    // Guards the guard: a reader that found nothing would pass the check below.
    expect(
      configs.map((config) => {
        return config.name;
      }),
    ).toEqual(
      expect.arrayContaining([
        "packages/Common/jest.config.json",
        "packages/App/jest.config.json",
        "ee/jest.config.js (project ui)",
        "packages/MobileApp/jest.config.js (project android)",
      ]),
    );
  });

  test("give each tracked file the same verdict wherever the repository is checked out", () => {
    const offenders = [];
    let entries = 0;
    for (const { name, rootDir, options } of configs) {
      const files = trackedFilesUnder(rootDir);
      for (const option of PATH_PATTERN_OPTIONS) {
        for (const pattern of options[option] || []) {
          entries++;
          const decided = filesTheCheckoutDecides(pattern, rootDir, files);
          if (decided.length > 0) {
            offenders.push(
              `${name} ${option} ${JSON.stringify(pattern)}: ${decided.length} of ${files.length} files, e.g. ${decided[0]}`,
            );
          }
        }
      }
    }
    expect(entries).toBeGreaterThan(30);

    /*
     * Anchor the entry: "/dist/" for a directory wherever it appears,
     * "<rootDir>/build/" for the package's own.
     */
    expect(offenders).toEqual([]);
  });
});

describe("filesTheCheckoutDecides", () => {
  const COMMON_DIR = path.join(REPO_ROOT, "packages", "Common");

  test.each([
    "dist",
    "node_modules",
    "build",
    "public",
    "node_modules/(?!(uuid|yaml)/)",
  ])("catches the unanchored %j", (pattern) => {
    expect(
      filesTheCheckoutDecides(pattern, COMMON_DIR, ["Tests/Example.test.ts"]),
    ).toEqual(["Tests/Example.test.ts"]);
  });

  test.each([
    ["/dist/", "build/dist/Index.js"],
    ["/node_modules/", "node_modules/yaml/index.js"],
    ["<rootDir>/build/", "build/dist/Index.js"],
    ["<rootDir>/public/", "public/dist/Bundle.js"],
    ["/node_modules/(?!(uuid|yaml)/)", "node_modules/bullmq/index.js"],
  ])("passes the anchored %j, which still ignores %s", (pattern, ignored) => {
    const files = ["Tests/Example.test.ts", ignored];
    expect(filesTheCheckoutDecides(pattern, COMMON_DIR, files)).toEqual([]);

    const hostileRoot = rootIn(HOSTILE_CHECKOUT, COMMON_DIR);
    expect(
      files.filter((file) => {
        return compile(pattern, hostileRoot).test(`${hostileRoot}/${file}`);
      }),
    ).toEqual([ignored]);
  });
});
