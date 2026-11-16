// Scripts/Lint/LintByProject.js: which files it lints, how it groups them
// into one ESLint process per TypeScript project, and what it exits with.
//
// One `npx eslint` over the files a branch changed in App, the Dashboard and
// Common holds the program of each at once, and ran out of an 8 GB heap on
// the 51 files of #7353 (#6848). `npm run lint:changed` lints those files
// with one ESLint process per project instead. These tests hold:
//   - the arguments: --changed[=<ref>], paths after --, ESLint's options;
//   - the changed files, in a throwaway git repository: committed, staged,
//     unstaged and untracked, never deleted, ignored or changed only on the
//     branch compared with;
//   - the grouping, in a throwaway tree of tsconfig.json files: the nearest
//     one that includes a file, else the next one up, else none;
//   - the script itself, run on planted files in two projects of their own
//     inside the repository: two ESLint processes, a lint error and a typed
//     rule's error named with their file, and the exit codes.
//
// Run: node --test Scripts/Lint/Tests/ (the js-lint job runs it before the
// lint). Needs the root's dependencies (npm install at the root).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const LintByProject = require("../LintByProject.js");

const {
  DEFAULT_BASE,
  REPO_ROOT,
  UsageError,
  parseArguments,
  changedFiles,
  filesAt,
  projectOf,
  filesByProject,
} = LintByProject;

const SCRIPT = path.join(__dirname, "..", "LintByProject.js");

const toPosix = (p) => {
  return p.split(path.sep).join("/");
};

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test.describe("parseArguments", () => {
  test.it("with nothing, the whole repository", () => {
    assert.deepEqual(parseArguments([]), {
      listProjects: false,
      changedSince: null,
      paths: null,
      eslintArgs: [],
    });
  });

  test.it(
    "--changed compares with origin/main, --changed=<ref> with the ref, the last one winning",
    () => {
      assert.equal(DEFAULT_BASE, "origin/main");
      assert.equal(parseArguments(["--changed"]).changedSince, "origin/main");
      assert.equal(
        parseArguments(["--changed=upstream/main"]).changedSince,
        "upstream/main",
      );
      // npm run lint:changed -- --changed=upstream/main
      assert.equal(
        parseArguments(["--changed", "--changed=upstream/main"]).changedSince,
        "upstream/main",
      );
    },
  );

  test.it(
    "passes everything else to ESLint, and takes every argument after -- as a path",
    () => {
      assert.deepEqual(
        parseArguments(["--fix", "--cache", "--", "a.ts", "--b.ts", "dir"]),
        {
          listProjects: false,
          changedSince: null,
          paths: ["a.ts", "--b.ts", "dir"],
          eslintArgs: ["--fix", "--cache"],
        },
      );
      assert.deepEqual(
        parseArguments(["--changed", "--fix", "--format", "json"]).eslintArgs,
        ["--fix", "--format", "json"],
      );
    },
  );

  test.it("--list-projects goes with any of them", () => {
    assert.equal(
      parseArguments(["--list-projects", "--changed"]).listProjects,
      true,
    );
    assert.deepEqual(parseArguments(["--list-projects", "--", "a.ts"]).paths, [
      "a.ts",
    ]);
  });

  test.it(
    "refuses --changed with paths, -- with no path, and --changed= with no ref or one git would read as an option",
    () => {
      for (const argv of [
        ["--changed", "--", "a.ts"],
        ["--"],
        ["--changed="],
        ["--changed=--output=/tmp/x"],
        ["--changed=-p"],
      ]) {
        assert.throws(
          () => {
            return parseArguments(argv);
          },
          UsageError,
          argv.join(" "),
        );
      }
    },
  );
});

test.describe("changedFiles", () => {
  const ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: "Lint Test",
    GIT_AUTHOR_EMAIL: "lint-test@example.com",
    GIT_COMMITTER_NAME: "Lint Test",
    GIT_COMMITTER_EMAIL: "lint-test@example.com",
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  let repo;
  let branchPoint;

  const run = (...args) => {
    const result = spawnSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      { cwd: repo, env: ENV, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const commitAll = (message) => {
    run("add", "-A");
    run("commit", "-q", "-m", message);
  };

  test.before(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "lint-by-project-git-"));
    run("init", "-q", "-b", "main");
    for (const name of [
      "kept.ts",
      "edited.ts",
      "deleted.ts",
      "renamed.ts",
      "unstaged.ts",
      "sub/nested.ts",
    ]) {
      write(path.join(repo, name), `export const name: string = "${name}";\n`);
    }
    write(path.join(repo, ".gitignore"), "ignored.ts\nbuild/\n");
    commitAll("base");
    branchPoint = run("rev-parse", "HEAD");

    // main moves on after the branch point: none of it is the branch's.
    write(path.join(repo, "kept.ts"), "export const moved: number = 1;\n");
    write(path.join(repo, "main-only.ts"), "export const m: number = 1;\n");
    commitAll("main moves on");
    run("update-ref", "refs/remotes/origin/main", "HEAD");
    run("reset", "-q", "--hard", branchPoint);
    run("checkout", "-q", "-b", "feature");

    write(path.join(repo, "edited.ts"), "export const edited: number = 2;\n");
    commitAll("edit");
    run("rm", "-q", "deleted.ts");
    commitAll("delete");
    run("mv", "renamed.ts", "moved.ts");
    commitAll("rename");
    write(path.join(repo, "sub/nested.ts"), "export const n: number = 3;\n");
    commitAll("nested");

    write(path.join(repo, "staged.ts"), "export const s: number = 4;\n");
    run("add", "staged.ts");
    write(path.join(repo, "unstaged.ts"), "export const u: number = 5;\n");
    write(path.join(repo, "untracked.ts"), "export const t: number = 6;\n");
    write(path.join(repo, "with space.ts"), "export const w: number = 7;\n");
    write(path.join(repo, "ignored.ts"), "export const i: number = 8;\n");
    write(path.join(repo, "build", "out.ts"), "export const o: number = 9;\n");
  });

  test.after(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test.it(
    "lists what the branch changed since its merge base: committed, staged, unstaged and untracked",
    () => {
      const { mergeBase, files } = changedFiles("origin/main", repo);

      assert.equal(mergeBase, branchPoint);
      assert.deepEqual(
        files.map((file) => {
          return toPosix(path.relative(repo, file));
        }),
        [
          "edited.ts",
          "moved.ts",
          "staged.ts",
          "sub/nested.ts",
          "unstaged.ts",
          "untracked.ts",
          "with space.ts",
        ],
      );
      for (const file of files) {
        assert.ok(path.isAbsolute(file), file);
      }
    },
  );

  test.it(
    "never a deleted file, a renamed file's old path, an ignored file, or what only the branch compared with changed",
    () => {
      const listed = changedFiles("origin/main", repo).files.map((file) => {
        return path.basename(file);
      });

      for (const name of [
        "deleted.ts",
        "renamed.ts",
        "ignored.ts",
        "out.ts",
        "kept.ts",
        "main-only.ts",
      ]) {
        assert.ok(!listed.includes(name), name);
      }
    },
  );

  test.it(
    "from a directory below the top level, only that directory's files, still as absolute paths",
    () => {
      assert.deepEqual(
        changedFiles("origin/main", path.join(repo, "sub")).files,
        [path.join(repo, "sub", "nested.ts")],
      );
    },
  );

  test.it(
    "says how to get the branch compared with when the checkout does not have it",
    () => {
      assert.throws(
        () => {
          return changedFiles("origin/no-such-branch", repo);
        },
        (error) => {
          return (
            error instanceof UsageError &&
            /origin\/no-such-branch/.test(error.message) &&
            /git fetch origin main/.test(error.message) &&
            /--changed=<branch>/.test(error.message)
          );
        },
      );
    },
  );
});

test.describe("projectOf and filesByProject", () => {
  let root;
  const at = (relativePath) => {
    return path.join(root, relativePath);
  };

  test.before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lint-by-project-tree-"));
    // The root's program: everything but lonely/.
    write(
      at("tsconfig.json"),
      JSON.stringify({ include: ["**/*.ts"], exclude: ["lonely"] }),
    );
    write(at("top.ts"), "");
    // A package whose program is its src/ only: its Tests/ go up a level...
    write(at("pkg/tsconfig.json"), JSON.stringify({ include: ["src"] }));
    write(at("pkg/src/a.ts"), "");
    write(at("pkg/src/deep/b.ts"), "");
    write(at("pkg/Tests/c.ts"), "");
    // ... unless they have one of their own, as Common's and CLI's do.
    write(at("pkg/Tests/Own/tsconfig.json"), JSON.stringify({}));
    write(at("pkg/Tests/Own/d.ts"), "");
    write(at("lonely/e.ts"), "");
  });

  test.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test.it("is the nearest tsconfig.json that includes the file", () => {
    assert.equal(projectOf(at("pkg/src/a.ts"), root), at("pkg/tsconfig.json"));
    assert.equal(
      projectOf(at("pkg/src/deep/b.ts"), root),
      at("pkg/tsconfig.json"),
    );
    assert.equal(
      projectOf(at("pkg/Tests/Own/d.ts"), root),
      at("pkg/Tests/Own/tsconfig.json"),
    );
  });

  test.it("is the next one up when the nearest leaves the file out", () => {
    assert.equal(projectOf(at("pkg/Tests/c.ts"), root), at("tsconfig.json"));
    assert.equal(projectOf(at("top.ts"), root), at("tsconfig.json"));
  });

  test.it("is null when none includes it", () => {
    assert.equal(projectOf(at("lonely/e.ts"), root), null);
  });

  test.it(
    "groups files by project, projects in name order and the files in none last, each group in the order given",
    () => {
      const groups = filesByProject(
        [
          "lonely/e.ts",
          "pkg/src/deep/b.ts",
          "top.ts",
          "pkg/Tests/Own/d.ts",
          "pkg/src/a.ts",
          "pkg/Tests/c.ts",
        ].map(at),
        root,
      );

      assert.deepEqual(
        [...groups].map(([project, files]) => {
          return [
            project === null ? null : toPosix(path.relative(root, project)),
            files.map((file) => {
              return toPosix(path.relative(root, file));
            }),
          ];
        }),
        [
          ["pkg/Tests/Own/tsconfig.json", ["pkg/Tests/Own/d.ts"]],
          ["pkg/tsconfig.json", ["pkg/src/deep/b.ts", "pkg/src/a.ts"]],
          ["tsconfig.json", ["top.ts", "pkg/Tests/c.ts"]],
          [null, ["lonely/e.ts"]],
        ],
      );
    },
  );

  test.it(
    "puts the repository's own files in their packages' projects, never in the root's",
    () => {
      const groups = filesByProject(
        [
          "packages/Common/Server/Infrastructure/Postgres/OnlineDdl.ts",
          "packages/Common/Tests/Server/Infrastructure/Postgres/SchemaMigrationsOnlineDdl.test.ts",
          "packages/App/FeatureSet/Dashboard/src/Components/AIChat/useAiChat.ts",
        ].map((relativePath) => {
          return path.join(REPO_ROOT, relativePath);
        }),
      );

      assert.deepEqual(
        [...groups.keys()].map((project) => {
          return toPosix(path.relative(REPO_ROOT, project));
        }),
        [
          "packages/App/FeatureSet/Dashboard/tsconfig.json",
          "packages/Common/Tests/Server/tsconfig.json",
          "packages/Common/tsconfig.json",
        ],
      );
    },
  );
});

test.describe("filesAt", () => {
  test.it(
    "takes files and directories, relative to where the command was typed, and refuses what is missing or outside the repository",
    async () => {
      const lintDirectory = path.join(REPO_ROOT, "Scripts", "Lint");
      const { files, named } = await filesAt(
        ["LintByProject.js", "Tests"],
        lintDirectory,
      );

      assert.ok(files.includes(path.join(lintDirectory, "LintByProject.js")));
      assert.ok(files.includes(__filename));
      assert.deepEqual(
        [...named],
        [path.join(lintDirectory, "LintByProject.js")],
      );

      await assert.rejects(
        filesAt(["no-such-file.ts"], lintDirectory),
        (error) => {
          return (
            error instanceof UsageError &&
            /No such file or directory: no-such-file\.ts/.test(error.message)
          );
        },
      );
      await assert.rejects(filesAt([os.tmpdir()], REPO_ROOT), (error) => {
        return (
          error instanceof UsageError &&
          /Not in this repository/.test(error.message)
        );
      });
    },
  );
});

/*
 * The script itself, on planted files in two projects of their own inside
 * the repository (ESLint lints only what is under its config's directory):
 * the same eslint.config.js, rules and typed linting as any other file.
 */
test.describe("the script, on planted files", () => {
  let fixture;
  let relativeFixture;

  const lint = (...args) => {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, npm_lifecycle_event: "" },
    });
  };
  const project = (name) => {
    return `${relativeFixture}/${name}/tsconfig.json`;
  };

  test.before(() => {
    fixture = fs.mkdtempSync(
      path.join(REPO_ROOT, "Scripts", "Lint", "Tests", "LintByProjectFixture-"),
    );
    relativeFixture = toPosix(path.relative(REPO_ROOT, fixture));
    const tsconfig = JSON.stringify({
      compilerOptions: {
        target: "es2022",
        module: "commonjs",
        strict: true,
        noEmit: true,
        types: [],
      },
      include: ["*.ts"],
    });
    write(path.join(fixture, "one", "tsconfig.json"), tsconfig);
    write(path.join(fixture, "two", "tsconfig.json"), tsconfig);
    write(
      path.join(fixture, "one", "clean.ts"),
      "export const answer: number = 42;\n",
    );
    // An error only a rule with type information finds.
    write(
      path.join(fixture, "one", "awaits.ts"),
      "export async function wait(): Promise<number> {\n  return await 42;\n}\n",
    );
    write(
      path.join(fixture, "two", "var.ts"),
      "export var answer: number = 42;\n",
    );
    write(path.join(fixture, "two", "plain.js"), "var ignored = 1;\n");
  });

  test.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  test.it("a clean file: one ESLint run, in its project, exit 0", () => {
    const result = lint("--", `${relativeFixture}/one/clean.ts`);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /1 files to lint, in 1 project\n/);
    assert.ok(
      result.stderr.includes(`[lint] ${project("one")}: 1 files\n`),
      result.stderr,
    );
    assert.ok(!result.stderr.includes(project("two")), result.stderr);
  });

  test.it(
    "a directory across two projects: one ESLint run each, every error named with its file, exit 1",
    () => {
      const result = lint("--", relativeFixture);

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /3 files to lint, in 2 projects\n/);
      assert.ok(
        result.stderr.includes(`[lint] ${project("one")}: 2 files\n`),
        result.stderr,
      );
      assert.ok(
        result.stderr.includes(`[lint] ${project("two")}: 1 files\n`),
        result.stderr,
      );
      assert.match(result.stderr, /one\/tsconfig\.json: 2 files: exit 1 in /);
      assert.match(result.stderr, /two\/tsconfig\.json: 1 files: exit 1 in /);

      const report = result.stdout;
      assert.ok(
        report.includes(path.join(fixture, "one", "awaits.ts")),
        report,
      );
      assert.match(report, /@typescript-eslint\/await-thenable/);
      assert.ok(report.includes(path.join(fixture, "two", "var.ts")), report);
      assert.match(report, /no-var/);
      assert.ok(!report.includes("clean.ts"), report);
      // A .js file in a directory named is not linted, and not worth naming.
      assert.ok(!report.includes("plain.js"), report);
      assert.ok(!result.stderr.includes("plain.js"), result.stderr);
    },
  );

  test.it("passes ESLint's options to every run", () => {
    const result = lint(
      "--format",
      "json",
      "--",
      `${relativeFixture}/one/awaits.ts`,
      `${relativeFixture}/two/var.ts`,
    );

    assert.equal(result.status, 1, result.stderr);
    const reports = result.stdout
      .trim()
      .split("\n")
      .map((line) => {
        return JSON.parse(line);
      });
    assert.deepEqual(
      reports.map((report) => {
        return report.map((entry) => {
          return [path.basename(entry.filePath), entry.errorCount > 0];
        });
      }),
      [[["awaits.ts", true]], [["var.ts", true]]],
    );
  });

  test.it(
    "a file eslint.config.js ignores, named: left out and said so, exit 0",
    () => {
      const result = lint("--", `${relativeFixture}/two/plain.js`);

      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stderr, /0 files to lint, in 0 projects\n/);
      assert.ok(
        result.stderr.includes(
          `[lint] Left out, as eslint.config.js ignores them: ${relativeFixture}/two/plain.js\n`,
        ),
        result.stderr,
      );
    },
  );

  test.it("a path that does not exist: says so, exit 2", () => {
    const result = lint("--", `${relativeFixture}/one/missing.ts`);

    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(
      result.stderr,
      /\[lint\] No such file or directory: .*one\/missing\.ts\n/,
    );
  });

  test.it("--list-projects groups the files and lints nothing", () => {
    const result = lint("--list-projects", "--", relativeFixture);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      [
        `${project("one")}: 2 files`,
        `  ${relativeFixture}/one/awaits.ts`,
        `  ${relativeFixture}/one/clean.ts`,
        `${project("two")}: 1 files`,
        `  ${relativeFixture}/two/var.ts`,
        "",
      ].join("\n"),
    );
  });
});

test.describe("the root's npm scripts", () => {
  const scripts = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  ).scripts;

  test.it(
    "lint:changed and fix-lint:changed lint the changed files by project, with lint's 12 GB heap, which the caller's NODE_OPTIONS can change",
    () => {
      assert.equal(
        scripts["lint:changed"],
        'export NODE_OPTIONS="--max-old-space-size=12288${NODE_OPTIONS:+ $NODE_OPTIONS}" && node ./Scripts/Lint/LintByProject.js --changed',
      );
      assert.equal(
        scripts["fix-lint:changed"],
        'export NODE_OPTIONS="--max-old-space-size=12288${NODE_OPTIONS:+ $NODE_OPTIONS}" && node ./Scripts/Lint/LintByProject.js --changed --fix',
      );
    },
  );

  test.it(
    "lint and fix-lint still lint the whole repository, with the same heap",
    () => {
      for (const name of ["lint", "fix-lint"]) {
        assert.match(
          scripts[name],
          /node \.\/Scripts\/Lint\/LintByProject\.js /,
        );
        assert.match(scripts[name], /--max-old-space-size=12288\b/);
        assert.doesNotMatch(scripts[name], /--changed/);
      }
    },
  );

  test.it(
    "a later --max-old-space-size wins, so the caller's NODE_OPTIONS can change the heap",
    () => {
      const heapOf = (nodeOptions) => {
        const run = spawnSync(
          process.execPath,
          [
            "-e",
            "process.stdout.write(String(require('v8').getHeapStatistics().heap_size_limit))",
          ],
          {
            encoding: "utf8",
            env: { ...process.env, NODE_OPTIONS: nodeOptions },
          },
        );
        assert.equal(run.status, 0, run.stderr);
        return Number(run.stdout);
      };

      assert.ok(
        heapOf("--max-old-space-size=12288 --max-old-space-size=2048") <
          heapOf("--max-old-space-size=12288"),
      );
    },
  );
});
