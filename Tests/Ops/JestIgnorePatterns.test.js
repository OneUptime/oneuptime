"use strict";

/**
 * Jest matches its path-ignoring options against ABSOLUTE paths: jest-config
 * replaces <rootDir> as text, joins each list with "|", and tests every
 * file's full path against the result. An entry written as a bare name -
 * "dist", "build", "public", "node_modules" - therefore also matches the
 * directories the checkout happens to live under.
 *
 * A git worktree at .claude/worktrees/distracted-dhawan-5e965a matched
 * "dist". Common's jest found no tests at all, even one named on the command
 * line ("testPathIgnorePatterns: node_modules, dist - 0 matches"), and App's
 * `npm test`, which passes --passWithNoTests, passed having run nothing.
 *
 * So an entry must match whole path segments: "/dist/" for a name at any
 * depth, "<rootDir>/build/" for one directory of the package. This suite
 * reads every jest config in the repository and pins that
 *
 *   - moving the checkout under directories whose names merely contain an
 *     ignored word changes nothing a config ignores;
 *   - inside a package, such a directory is not ignored either;
 *   - what each package does mean to ignore - its build output, installed
 *     dependencies, and the recorder suites App leaves to their own configs
 *     - still is, wherever the checkout lives.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// The options jest-config turns into expressions over absolute paths.
const PATH_PATTERN_OPTIONS = [
  "testPathIgnorePatterns",
  "modulePathIgnorePatterns",
  "transformIgnorePatterns",
  "coveragePathIgnorePatterns",
  "watchPathIgnorePatterns",
];

// jest's own default, used when a config leaves testPathIgnorePatterns unset.
const DEFAULT_TEST_PATH_IGNORE_PATTERNS = ["/node_modules/"];

// A checkout whose path names nothing any config ignores.
const PLAIN_CHECKOUT = "/repo";

// Where this was found: "dist" matched the worktree's name.
const REPORTED_CHECKOUT =
  "/Users/dev/oneuptime/.claude/worktrees/distracted-dhawan-5e965a";

/*
 * Paths, relative to a project's rootDir, that it must never collect a test
 * from. Every project must also skip installed dependencies.
 */
const DEPENDENCY_TEST = "node_modules/some-package/Tests/Fixture.test.ts";
const MUST_STAY_IGNORED = {
  // tsc writes build/dist (each tsconfig's outDir).
  "packages/Common/jest.config.json": ["build/dist/Tests/Fixture.test.ts"],
  "packages/App/jest.config.json": [
    "build/dist/Tests/Fixture.test.ts",
    // Each recorder has its own jest config, environment and dependencies.
    "FeatureSet/BrowserRecorder/Tests/Fixture.test.ts",
    "FeatureSet/MobileRecorder/Tests/Fixture.test.ts",
  ],
  "packages/Home/jest.config.json": ["build/dist/Tests/Fixture.test.ts"],
  "packages/Probe/jest.config.json": ["build/dist/Tests/Fixture.test.ts"],
  "packages/Runner/jest.config.json": ["build/dist/Tests/Fixture.test.ts"],
  "packages/TestServer/jest.config.json": ["build/dist/Tests/Fixture.test.ts"],
  "packages/CLI/jest.config.json": ["build/dist/Tests/Fixture.test.ts"],
  // esbuild writes the recorder bundle to public/.
  "packages/App/FeatureSet/BrowserRecorder/jest.config.json": [
    "public/dist/Tests/Fixture.test.ts",
  ],
  "ee/jest.config.js": [
    "build/Tests/Server/Fixture.test.ts",
    "build/Tests/UI/Fixture.test.ts",
  ],
};

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  return result.stdout.split("\0").filter(Boolean);
}

/*
 * Every jest config and the projects it defines, each with its rootDir
 * resolved the way jest resolves it. A config whose `projects` are objects
 * is checked project by project. Configs this suite cannot load (ESM or
 * TypeScript) are returned so the suite can refuse them rather than skip.
 */
function readJestProjects(files) {
  const projects = [];
  const unreadable = [];

  for (const file of files) {
    const base = path.basename(file);
    const absolutePath = path.join(REPO_ROOT, file);
    let config = null;

    if (base === "jest.config.json") {
      config = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    } else if (base === "jest.config.js" || base === "jest.config.cjs") {
      config = require(absolutePath);
    } else if (/^jest\.config\.[cm]?ts$|^jest\.config\.mjs$/.test(base)) {
      unreadable.push(file);
    } else if (base === "package.json") {
      config = JSON.parse(fs.readFileSync(absolutePath, "utf8")).jest || null;
    }

    if (!config) {
      continue;
    }

    const configDir = path.dirname(absolutePath);
    const rootDir = config.rootDir
      ? path.resolve(configDir, config.rootDir)
      : configDir;
    const objectProjects = (config.projects || []).filter((project) => {
      return typeof project === "object";
    });

    for (const options of objectProjects.length > 0
      ? objectProjects
      : [config]) {
      const displayName = options.displayName
        ? ` (${options.displayName.name || options.displayName})`
        : "";
      projects.push({
        file,
        name: `${file}${displayName}`,
        rootDir: options.rootDir
          ? path.resolve(rootDir, options.rootDir)
          : rootDir,
        options,
      });
    }
  }

  return { projects, unreadable };
}

// The project's rootDir as it would be in a checkout at `checkout`.
function relocatedRootDir(project, checkout) {
  return path.join(checkout, path.relative(REPO_ROOT, project.rootDir));
}

/*
 * One option's entries, as jest-config builds them for the project checked
 * out at `checkout`. A JavaScript config may have baked the real checkout's
 * path into an entry; that moves with the checkout too.
 */
function compile(patterns, project, checkout) {
  const rootDir = relocatedRootDir(project, checkout);
  return new RegExp(
    patterns
      .map((pattern) => {
        return pattern
          .split(REPO_ROOT)
          .join(checkout)
          .replace(/<rootDir>/g, rootDir);
      })
      .join("|"),
  );
}

function patternLists(project) {
  return PATH_PATTERN_OPTIONS.filter((option) => {
    return (project.options[option] || []).length > 0;
  }).map((option) => {
    return { option, patterns: project.options[option] };
  });
}

// Every word an entry names: "dist", "node_modules", "BrowserRecorder", ...
function wordsIn(patterns) {
  const words = new Set();
  for (const pattern of patterns) {
    for (const word of pattern
      .replace(/<rootDir>/g, "")
      .match(/[A-Za-z][A-Za-z0-9_]*/g) || []) {
      words.add(word);
    }
  }
  return Array.from(words);
}

// Directory names that hold the word - at their end, start, middle - without being it.
function lookalikes(word) {
  return [`re${word}`, `${word}er`, `re${word}er`];
}

/*
 * A checkout under a directory of every lookalike of every word the
 * projects' entries name - the general form of distracted-dhawan-5e965a.
 */
function lookalikeCheckout(projects) {
  const words = new Set();
  for (const project of projects) {
    for (const { patterns } of patternLists(project)) {
      for (const word of wordsIn(patterns)) {
        words.add(word);
      }
    }
  }
  return `/${Array.from(words).flatMap(lookalikes).join("/")}`;
}

// A checkout path short enough to read in a failure message.
function shortened(checkout) {
  const segments = checkout.split("/");
  return segments.length > 8
    ? `${segments.slice(0, 8).join("/")}/...`
    : checkout;
}

// The project's files that `patterns` decide differently in the two checkouts.
function changedVerdicts(patterns, project, projectFiles, checkout) {
  const plain = compile(patterns, project, PLAIN_CHECKOUT);
  const moved = compile(patterns, project, checkout);
  const plainRoot = relocatedRootDir(project, PLAIN_CHECKOUT);
  const movedRoot = relocatedRootDir(project, checkout);

  return projectFiles.filter((file) => {
    return (
      plain.test(`${plainRoot}/${file}`) !== moved.test(`${movedRoot}/${file}`)
    );
  });
}

/*
 * Entries whose verdict on one of the project's files changes when the
 * checkout moves from PLAIN_CHECKOUT to `checkout`. Each option is first
 * checked whole, as jest uses it, and only taken apart when it changes.
 */
function checkoutDependentEntries(project, projectFiles, checkout) {
  const offenders = [];

  for (const { option, patterns } of patternLists(project)) {
    if (
      changedVerdicts(patterns, project, projectFiles, checkout).length === 0
    ) {
      continue;
    }
    for (const pattern of patterns) {
      const changed = changedVerdicts(
        [pattern],
        project,
        projectFiles,
        checkout,
      );
      if (changed.length > 0) {
        const example =
          changed.find((file) => {
            return /\.test\.[jt]sx?$/.test(file);
          }) || changed[0];
        offenders.push(
          `${project.name} ${option} ${JSON.stringify(pattern)}: ${changed.length} file(s) change verdict under ${shortened(checkout)}, e.g. ${example}`,
        );
      }
    }
  }

  return offenders;
}

/*
 * Entries that ignore a directory of the package whose name only contains
 * an ignored word: "<rootDir>/build" ignores <rootDir>/builder/ too.
 */
function lookalikeDirectoryEntries(project) {
  const offenders = [];
  const rootDir = relocatedRootDir(project, PLAIN_CHECKOUT);

  for (const { option, patterns } of patternLists(project)) {
    for (const pattern of patterns) {
      const expression = compile([pattern], project, PLAIN_CHECKOUT);
      for (const directory of wordsIn([pattern]).flatMap(lookalikes)) {
        const file = path.join(rootDir, directory, "Fixture.test.ts");
        if (expression.test(file)) {
          offenders.push(
            `${project.name} ${option} ${JSON.stringify(pattern)}: ignores ${path.relative(rootDir, file)}`,
          );
        }
      }
    }
  }

  return offenders;
}

/*
 * Whether jest would skip collecting a test at `file` (relative to the
 * project's rootDir) in a checkout at `checkout`: testPathIgnorePatterns
 * skips it, and modulePathIgnorePatterns keeps it out of the haste map
 * jest collects tests from.
 */
function isTestIgnored(project, file, checkout) {
  const absolutePath = path.join(relocatedRootDir(project, checkout), file);
  const testPathIgnorePatterns =
    project.options.testPathIgnorePatterns || DEFAULT_TEST_PATH_IGNORE_PATTERNS;
  const modulePathIgnorePatterns =
    project.options.modulePathIgnorePatterns || [];

  return [testPathIgnorePatterns, modulePathIgnorePatterns].some((patterns) => {
    return (
      patterns.length > 0 &&
      compile(patterns, project, checkout).test(absolutePath)
    );
  });
}

describe("jest configs", () => {
  const files = trackedFiles();
  const { projects, unreadable } = readJestProjects(
    files.filter((file) => {
      return /(^|\/)(jest\.config\.[a-z]+|package\.json)$/.test(file);
    }),
  );
  const checkouts = [REPORTED_CHECKOUT, lookalikeCheckout(projects)];

  function filesOf(project) {
    const prefix = `${path.relative(REPO_ROOT, project.rootDir)}/`;
    return files
      .filter((file) => {
        return prefix === "/" || file.startsWith(prefix);
      })
      .map((file) => {
        return prefix === "/" ? file : file.slice(prefix.length);
      });
  }

  test("are all read by this suite", () => {
    expect(unreadable).toEqual([]);
    expect(
      projects.map((project) => {
        return project.file;
      }),
    ).toEqual(expect.arrayContaining(Object.keys(MUST_STAY_IGNORED)));
    expect(
      projects
        .filter((project) => {
          return project.file === "ee/jest.config.js";
        })
        .map((project) => {
          return project.name;
        }),
    ).toEqual(["ee/jest.config.js (server)", "ee/jest.config.js (ui)"]);
  });

  test("ignore the same files wherever the checkout lives", () => {
    const offenders = [];
    for (const project of projects) {
      const projectFiles = filesOf(project);
      for (const checkout of checkouts) {
        offenders.push(
          ...checkoutDependentEntries(project, projectFiles, checkout),
        );
      }
    }

    // Anchor the entry to whole path segments: "/dist/" or "<rootDir>/dist/".
    expect(offenders).toEqual([]);
  });

  test("do not ignore a directory whose name only contains an ignored word", () => {
    const offenders = [];
    for (const project of projects) {
      offenders.push(...lookalikeDirectoryEntries(project));
    }

    // End a directory entry with "/": "<rootDir>/build/", not "<rootDir>/build".
    expect(offenders).toEqual([]);
  });

  test("still skip build output, dependencies and the recorder suites", () => {
    const missed = [];
    for (const project of projects) {
      const ignoredFiles = [
        DEPENDENCY_TEST,
        ...(MUST_STAY_IGNORED[project.file] || []),
      ];
      for (const checkout of [PLAIN_CHECKOUT, ...checkouts]) {
        for (const file of ignoredFiles) {
          if (!isTestIgnored(project, file, checkout)) {
            missed.push(
              `${project.name}: ${file} under ${shortened(checkout)}`,
            );
          }
        }
      }
    }

    expect(missed).toEqual([]);
  });
});

describe("the checks themselves", () => {
  const project = (options) => {
    return {
      file: "packages/Fixture/jest.config.json",
      name: "packages/Fixture/jest.config.json",
      rootDir: path.join(REPO_ROOT, "packages", "Fixture"),
      options,
    };
  };
  const projectFiles = ["Tests/Fixture.test.ts", "build/dist/Fixture.js"];

  test("catch a bare name, which matches the checkout's directories", () => {
    const fixture = project({
      testPathIgnorePatterns: ["node_modules", "dist"],
    });

    expect(
      checkoutDependentEntries(fixture, projectFiles, REPORTED_CHECKOUT),
    ).toEqual([
      expect.stringContaining('testPathIgnorePatterns "dist": 1 file(s)'),
    ]);
    expect(
      checkoutDependentEntries(
        fixture,
        projectFiles,
        lookalikeCheckout([fixture]),
      ),
    ).toEqual([
      expect.stringContaining('"node_modules": 2 file(s)'),
      expect.stringContaining('"dist": 1 file(s)'),
    ]);
  });

  test("catch an entry anchored on one side only", () => {
    // "<rootDir>/build" also ignores <rootDir>/builder/.
    const leftOnly = project({ modulePathIgnorePatterns: ["<rootDir>/build"] });

    expect(lookalikeDirectoryEntries(leftOnly)).toEqual([
      expect.stringContaining('"<rootDir>/build": ignores builder/'),
    ]);

    // "node_modules/..." also matches a checkout under renode_modules/.
    const rightOnly = project({
      transformIgnorePatterns: ["node_modules/(?!(uuid)/)"],
    });

    expect(
      checkoutDependentEntries(
        rightOnly,
        projectFiles,
        lookalikeCheckout([rightOnly]),
      ),
    ).toEqual([
      expect.stringContaining(
        'transformIgnorePatterns "node_modules/(?!(uuid)/)": 2 file(s)',
      ),
    ]);
    expect(lookalikeDirectoryEntries(rightOnly)).toEqual([
      expect.stringContaining("ignores renode_modules/"),
    ]);
  });

  test("pass entries anchored to whole path segments", () => {
    const fixture = project({
      testPathIgnorePatterns: ["/node_modules/", "/dist/", "<rootDir>/build/"],
      transformIgnorePatterns: ["/node_modules/(?!(uuid)/)"],
      modulePathIgnorePatterns: ["<rootDir>/build/"],
    });

    for (const checkout of [REPORTED_CHECKOUT, lookalikeCheckout([fixture])]) {
      expect(checkoutDependentEntries(fixture, projectFiles, checkout)).toEqual(
        [],
      );
    }
    expect(lookalikeDirectoryEntries(fixture)).toEqual([]);
    expect(
      isTestIgnored(fixture, "build/dist/Tests/X.test.ts", PLAIN_CHECKOUT),
    ).toBe(true);
    expect(isTestIgnored(fixture, "Tests/dist/X.test.ts", PLAIN_CHECKOUT)).toBe(
      true,
    );
    expect(isTestIgnored(fixture, "Tests/X.test.ts", REPORTED_CHECKOUT)).toBe(
      false,
    );
  });
});
