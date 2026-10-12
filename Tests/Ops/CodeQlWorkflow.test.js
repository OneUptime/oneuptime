"use strict";

/**
 * .github/workflows/codeql.yml is CodeQL's advanced setup, written to replace
 * the default setup configured in the repository's settings (see its header
 * for why, and for the two settings that switch it on).
 *
 * It is a like-for-like replacement except for when it runs, and both halves
 * matter: the same languages, build modes and categories as default setup, or
 * the alerts default setup raised would not carry over to it; and never on a
 * push to master, which is the scan it exists to drop. It must also stay
 * inert until default setup is off, because GitHub refuses an advanced
 * setup's results while default setup is on - after the analysis has run.
 *
 * It reads one thing default setup cannot: .github/codeql/codeql-config.yml,
 * whose paths-ignore leaves out the third-party files vendored for offline
 * installs. That list must only ever name directories of third-party files,
 * documented as such, or it would hide OneUptime's own code from code
 * scanning: each directory it names needs a README that says so and lists
 * every file in it with its source.
 *
 * When the repository gains a language, default setup starts scanning it by
 * itself, as it did python on 4 October 2026; this setup scans only what its
 * matrix lists. So these tests read git's index for code in every language
 * CodeQL analyses: each such language is scanned, or left out with the
 * reason (LEFT_OUT_LANGUAGES), and each language scanned has code for its
 * analysis to read - an analysis that finds none fails.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOW = ".github/workflows/codeql.yml";
const CONFIG_FILE = ".github/codeql/codeql-config.yml";
// The guard that reads product code the way code scanning does.
const PRODUCT_CODE_GUARD = "packages/Common/Tests/Helpers/CodeScanning.ts";
// Where code scanning's open alerts in vendored code were (#1722, #1750-#1753).
const VENDORED_TAILWIND =
  "packages/Common/Server/Static/Vendor/tailwind/tailwind-3.4.5.js";

const workflow = yaml.load(
  fs.readFileSync(path.join(REPO_ROOT, WORKFLOW), "utf8"),
);
// js-yaml reads `on` as a string key.
const triggers = workflow.on;
const analyze = workflow.jobs.analyze;
const config = yaml.load(
  fs.readFileSync(path.join(REPO_ROOT, CONFIG_FILE), "utf8"),
);
const ignoredPaths = config["paths-ignore"];

// A character a paths-ignore entry reads as a pattern, not as a path.
const PATTERN_CHARACTER = /[*?[\]!+\\]/;
const SECTION_HEADING = /^## /m;
const BACKTICKED_PATH = /^`([^`]+)`$/;
const THIRD_PARTY = /third-party/i;
const VENDORED = /vendored/i;
// A ${{ matrix.<key> }} expression in a workflow value.
const MATRIX_EXPRESSION = /\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/g;

/*
 * What the repository's default setup scans, and how: the languages
 * `gh api repos/OneUptime/oneuptime/code-scanning/default-setup` listed on
 * 12 October 2026 (actions, go, javascript-typescript - which it also lists
 * as javascript and typescript - and python), each with the build mode of
 * its analyses on master. Python is interpreted, so none is the only build
 * mode CodeQL has for it.
 */
const DEFAULT_SETUP_MATRIX = [
  { language: "actions", "build-mode": "none" },
  { language: "go", "build-mode": "autobuild" },
  { language: "javascript-typescript", "build-mode": "none" },
  { language: "python", "build-mode": "none" },
];
// The categories of default setup's analyses on master, one per language.
const DEFAULT_SETUP_CATEGORIES = [
  "/language:actions",
  "/language:go",
  "/language:javascript-typescript",
  "/language:python",
];

/*
 * Languages CodeQL analyses that the repository holds code in, but neither
 * default setup nor this setup scans, each with the reason. Default setup
 * tries each language GitHub detects in the repository, and goes back to the
 * languages it had when that first analysis fails. Add a language here only
 * with a reason as plain as these.
 */
const LEFT_OUT_LANGUAGES = {
  "c-cpp":
    "The Probe's two native helpers for synthetic monitors (packages/Probe/Utils/Monitors/SyntheticRuntime/Native). Default setup tried C/C++ on 15 September 2026, with autobuild, and the analysis failed.",
  csharp:
    "Only an example app, Examples/otel-dotnet. GitHub's language detection does not count it, so default setup never tried C#.",
  "java-kotlin":
    "The Android module of the React Native session replay SDK (packages/App/FeatureSet/MobileRecorder/android). Default setup tried Java/Kotlin on 14 September 2026, with autobuild, and the analysis failed.",
  swift:
    "The iOS module of the same SDK (packages/App/FeatureSet/MobileRecorder/ios). Default setup tried Swift on 14 September 2026, with autobuild on macOS, and the analysis failed.",
};

/*
 * The extensions of the source files CodeQL reads as each language it
 * analyses, from the "Supported languages and frameworks" page of CodeQL's
 * documentation (.cjs from the JavaScript extractor's own list). The
 * project, manifest and markup files it also recognizes (.csproj, .sln,
 * .xaml, Cargo.toml), and the templates and data files the JavaScript
 * extractor reads (HTML, EJS, Handlebars, JSON, YAML, XML), are no language's
 * code of their own; GitHub Actions is read from where workflows and actions
 * live, below.
 * Objective-C, which the session replay SDK's iOS module also holds, is not
 * a language CodeQL analyses.
 */
const SOURCE_EXTENSIONS = {
  "c-cpp": [
    ".c",
    ".cc",
    ".cpp",
    ".cxx",
    ".c++",
    ".h",
    ".hh",
    ".hpp",
    ".hxx",
    ".h++",
  ],
  csharp: [".cs", ".cshtml"],
  go: [".go"],
  "java-kotlin": [".java", ".kt"],
  "javascript-typescript": [
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".es",
    ".es6",
    ".vue",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
  ],
  python: [".py"],
  ruby: [".rb", ".erb", ".gemspec"],
  rust: [".rs"],
  swift: [".swift"],
};
// The Ruby files CodeQL knows by their name rather than an extension.
const RUBY_FILE_NAMES = ["Gemfile"];
// A workflow: a YAML file directly in .github/workflows.
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;
// An action's metadata, wherever the action lives.
const ACTION_METADATA_FILE = /(^|\/)action\.ya?ml$/;
// How many of a language's files a failure names.
const FILES_NAMED = 5;

/*
 * Whether a paths-ignore entry names one path of the repository exactly: no
 * pattern characters, nothing relative, no trailing slash. A pattern could
 * reach code nobody meant to leave out, and the checks below could not tell
 * which directory it names.
 */
function isPlainPath(entry) {
  return (
    typeof entry === "string" &&
    entry !== "" &&
    !PATTERN_CHARACTER.test(entry) &&
    !entry.startsWith("/") &&
    !entry.endsWith("/") &&
    !entry.split("/").includes("..") &&
    path.posix.normalize(entry) === entry
  );
}

/*
 * The rows of a README's "## Contents" table, as { path, source }: the
 * backticked path in the first cell (a folder's ends with "/") and what the
 * second cell says it is. The header and separator rows name no path.
 */
function contentsOf(readme) {
  const section = readme.split(SECTION_HEADING).find((part) => {
    return part.startsWith("Contents\n");
  });
  const rows = [];

  for (const line of (section || "").split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => {
        return cell.trim();
      });
    const named = cells.length >= 2 ? BACKTICKED_PATH.exec(cells[0]) : null;

    if (named) {
      rows.push({ path: named[1], source: cells[1] });
    }
  }

  return rows;
}

// Every file under a directory but its README, by its path from there.
function filesUnder(directory, prefix = "") {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix + entry.name;

    if (entry.isDirectory()) {
      files.push(
        ...filesUnder(path.join(directory, entry.name), `${relativePath}/`),
      );
    } else if (relativePath !== "README.md") {
      files.push(relativePath);
    }
  }

  return files.sort();
}

// Whether a row of a Contents table names a file: itself, or its folder.
function names(row, file) {
  return row.path.endsWith("/") ? file.startsWith(row.path) : row.path === file;
}

/*
 * The files of a directory its README's Contents does not name, with a
 * source, as third-party files: what code scanning would skip unaccounted for.
 */
function undocumentedFiles(directory) {
  const rows = contentsOf(
    fs.readFileSync(path.join(directory, "README.md"), "utf8"),
  ).filter((row) => {
    return row.source !== "";
  });

  return filesUnder(directory).filter((file) => {
    return !rows.some((row) => {
      return names(row, file);
    });
  });
}

// What a README's Contents names that its directory does not hold.
function missingContents(directory) {
  const files = filesUnder(directory);

  return contentsOf(fs.readFileSync(path.join(directory, "README.md"), "utf8"))
    .filter((row) => {
      return !files.some((file) => {
        return names(row, file);
      });
    })
    .map((row) => {
      return row.path;
    });
}

// A workflow value with each ${{ matrix.<key> }} in it read off one entry.
function withMatrixValues(text, entry) {
  return text.replace(MATRIX_EXPRESSION, (expression, key) => {
    return String(entry[key]);
  });
}

// The languages the matrix scans, in its order.
function scannedLanguages() {
  return analyze.strategy.matrix.include.map((entry) => {
    return entry.language;
  });
}

/*
 * The repository's files, as git's index lists them: what a checkout, and so
 * code scanning, sees. Without git there is nothing to check, so a missing
 * git fails these tests rather than letting them pass.
 */
function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean);
  } catch (error) {
    throw new Error(
      `Could not run \`git ls-files\` in ${REPO_ROOT}: these tests read git's index, so they need a git checkout. ${String(error)}`,
    );
  }
}

// The language CodeQL reads a file of the repository as, or null for none.
function codeQlLanguageOf(file) {
  if (WORKFLOW_FILE.test(file) || ACTION_METADATA_FILE.test(file)) {
    return "actions";
  }

  if (RUBY_FILE_NAMES.includes(path.posix.basename(file))) {
    return "ruby";
  }

  const extension = path.posix.extname(file).toLowerCase();
  const language = Object.keys(SOURCE_EXTENSIONS).find((candidate) => {
    return SOURCE_EXTENSIONS[candidate].includes(extension);
  });

  return language || null;
}

// Whether code scanning skips a file: it is under a path of paths-ignore.
function isSkippedByCodeScanning(file) {
  return ignoredPaths.some((ignored) => {
    return file === ignored || file.startsWith(`${ignored}/`);
  });
}

/*
 * The languages CodeQL analyses that the given files hold code in, each with
 * its files, leaving out the files under the paths code scanning skips.
 */
function languagesIn(files) {
  const languages = {};

  for (const file of files) {
    const language = isSkippedByCodeScanning(file)
      ? null
      : codeQlLanguageOf(file);

    if (language) {
      if (!languages[language]) {
        languages[language] = [];
      }

      languages[language].push(file);
    }
  }

  return languages;
}

/*
 * The languages files hold code in that a matrix neither scans nor leaves out
 * with a reason - what default setup would start scanning by itself - each
 * with the first of its files.
 */
function languagesUnaccountedFor(languages, scanned, leftOut) {
  return Object.keys(languages)
    .filter((language) => {
      return !scanned.includes(language) && !Object.hasOwn(leftOut, language);
    })
    .sort()
    .map((language) => {
      return [language, languages[language].slice(0, FILES_NAMED)];
    });
}

describe(WORKFLOW, () => {
  test("scans pull requests, nightly, and on demand - not pushes", () => {
    expect(Object.keys(triggers).sort()).toEqual(
      ["pull_request", "schedule", "workflow_dispatch"].sort(),
    );
    expect(triggers.schedule).toHaveLength(1);
  });

  test("analyses what default setup did, the way it did", () => {
    // Every language default setup scans, python included: switching loses none.
    expect(analyze.strategy.matrix.include).toEqual(DEFAULT_SETUP_MATRIX);
  });

  test("uploads under default setup's categories, so its alerts carry over", () => {
    const upload = analyze.steps.find((step) => {
      return /^github\/codeql-action\/analyze@/.test(step.uses || "");
    });

    expect(upload.with.category).toBe("/language:${{ matrix.language }}");
  });

  test("uploads each language under the category default setup uses for it, python's under /language:python", () => {
    /*
     * A pull request without an analysis under one of master's categories
     * is reported as missing that configuration, and the category's alerts
     * would no longer be compared with master's.
     */
    const upload = analyze.steps.find((step) => {
      return /^github\/codeql-action\/analyze@/.test(step.uses || "");
    });

    expect(
      analyze.strategy.matrix.include.map((entry) => {
        return withMatrixValues(upload.with.category, entry);
      }),
    ).toEqual(DEFAULT_SETUP_CATEGORIES);
  });

  test("initializes each language with its build mode and the default query suite", () => {
    const init = analyze.steps.find((step) => {
      return /^github\/codeql-action\/init@/.test(step.uses || "");
    });

    expect(init.with).toEqual({
      languages: "${{ matrix.language }}",
      "build-mode": "${{ matrix.build-mode }}",
      "config-file": `./${CONFIG_FILE}`,
    });
    expect(
      fs.statSync(path.join(REPO_ROOT, init.with["config-file"])).isFile(),
    ).toBe(true);
  });

  test("runs nothing until the repository variable says default setup is off", () => {
    expect(analyze.if).toBe("vars.CODEQL_ADVANCED_SETUP == 'true'");
  });

  test("may write security events, and nothing else beyond reading", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(analyze.permissions).toEqual({
      actions: "read",
      contents: "read",
      "security-events": "write",
    });
  });
});

describe(`${WORKFLOW}: the languages it scans`, () => {
  // The languages CodeQL analyses that the repository holds code in.
  let repositoryLanguages = {};

  beforeAll(() => {
    repositoryLanguages = languagesIn(trackedFiles());
  });

  test("scans every language CodeQL analyses that the repository holds code in, or leaves it out with the reason", () => {
    /*
     * Default setup would start scanning a language like that by itself;
     * this setup scans only what its matrix lists.
     */
    expect(
      languagesUnaccountedFor(
        repositoryLanguages,
        scannedLanguages(),
        LEFT_OUT_LANGUAGES,
      ),
    ).toEqual([]);
  });

  test("each language it scans has code for its analysis to read, outside the paths code scanning skips", () => {
    // An analysis that finds no code fails, on every pull request.
    for (const language of scannedLanguages()) {
      expect([
        language,
        (repositoryLanguages[language] || []).length > 0,
      ]).toEqual([language, true]);
    }
  });

  test("reports any language it scans once the matrix drops it, as it would have reported python from 4 October 2026", () => {
    for (const language of scannedLanguages()) {
      const others = scannedLanguages().filter((scanned) => {
        return scanned !== language;
      });

      expect(
        languagesUnaccountedFor(
          repositoryLanguages,
          others,
          LEFT_OUT_LANGUAGES,
        ).map(([unscanned]) => {
          return unscanned;
        }),
      ).toEqual([language]);
    }
  });

  test("leaves out only languages the repository holds code in and default setup does not scan, each with the reason", () => {
    const defaultSetupLanguages = DEFAULT_SETUP_MATRIX.map((entry) => {
      return entry.language;
    });

    expect(Object.keys(LEFT_OUT_LANGUAGES).length).toBeGreaterThan(0);

    for (const [language, reason] of Object.entries(LEFT_OUT_LANGUAGES)) {
      expect([
        language,
        scannedLanguages().includes(language),
        defaultSetupLanguages.includes(language),
      ]).toEqual([language, false, false]);
      // A language whose code is gone comes off the list with it.
      expect([
        language,
        (repositoryLanguages[language] || []).length > 0,
      ]).toEqual([language, true]);
      expect([
        language,
        typeof reason === "string" && reason.trim().length > 0,
      ]).toEqual([language, true]);
    }
  });
});

describe(CONFIG_FILE, () => {
  test("only leaves directories out: no queries, packs, filters or threat models of its own", () => {
    /*
     * Any of those would change what default setup analysed - its default
     * query suite and remote threat model - and its alerts would no longer
     * carry over.
     */
    expect(Object.keys(config)).toEqual(["paths-ignore"]);
  });

  test("leaves out the third-party browser assets vendored for offline installs, and nothing else", () => {
    expect(ignoredPaths).toEqual(["packages/Common/Server/Static/Vendor"]);
  });

  test("leaves out the vendored Tailwind build, where code scanning's open alerts in vendored code were", () => {
    expect(
      ignoredPaths.filter((ignored) => {
        return VENDORED_TAILWIND.startsWith(`${ignored}/`);
      }),
    ).toEqual(["packages/Common/Server/Static/Vendor"]);
    expect(fs.existsSync(path.join(REPO_ROOT, VENDORED_TAILWIND))).toBe(true);
  });

  test("names each directory by its plain path, and each is a directory of the repository", () => {
    for (const ignored of ignoredPaths) {
      expect([ignored, isPlainPath(ignored)]).toEqual([ignored, true]);
      expect([
        ignored,
        fs.statSync(path.join(REPO_ROOT, ignored)).isDirectory(),
      ]).toEqual([ignored, true]);
    }
  });

  test("leaves out only directories whose README says they hold vendored third-party files that code scanning skips", () => {
    for (const ignored of ignoredPaths) {
      const readmePath = path.join(REPO_ROOT, ignored, "README.md");

      expect([ignored, fs.existsSync(readmePath)]).toEqual([ignored, true]);

      const readme = fs.readFileSync(readmePath, "utf8");

      expect([
        ignored,
        THIRD_PARTY.test(readme),
        VENDORED.test(readme),
      ]).toEqual([ignored, true, true]);
      // So whoever reads the directory knows code scanning does not.
      expect([ignored, readme.includes(CONFIG_FILE)]).toEqual([ignored, true]);
    }
  });

  test("every file of a directory it leaves out is named, with its source, in that directory's README", () => {
    /*
     * The list cannot grow to hide OneUptime's own code, and neither can the
     * directories on it: a file added to one without its line in the README's
     * Contents fails here.
     */
    for (const ignored of ignoredPaths) {
      const directory = path.join(REPO_ROOT, ignored);

      expect(filesUnder(directory).length).toBeGreaterThan(0);
      expect([ignored, undocumentedFiles(directory)]).toEqual([ignored, []]);
    }
  });

  test("every file a README of a directory it leaves out names is there", () => {
    for (const ignored of ignoredPaths) {
      const directory = path.join(REPO_ROOT, ignored);

      expect(
        contentsOf(fs.readFileSync(path.join(directory, "README.md"), "utf8"))
          .length,
      ).toBeGreaterThan(0);
      expect([ignored, missingContents(directory)]).toEqual([ignored, []]);
    }
  });

  test("the product code guard reads this list, so it skips exactly what code scanning skips", () => {
    expect(
      fs
        .readFileSync(path.join(REPO_ROOT, PRODUCT_CODE_GUARD), "utf8")
        .includes(`"${CONFIG_FILE}"`),
    ).toBe(true);
  });
});

describe("the checks on the directories code scanning leaves out", () => {
  let root = "";

  // A directory holding the files given, by their paths from it.
  function directoryWith(name, files) {
    const directory = path.join(root, name);

    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(directory, file)), {
        recursive: true,
      });
      fs.writeFileSync(path.join(directory, file), text);
    }

    return directory;
  }

  const README = [
    "# Vendored scripts",
    "",
    "Third-party scripts, vendored as published.",
    "",
    "## Contents",
    "",
    "| Path            | Source            |",
    "| --------------- | ----------------- |",
    "| `chart/`        | chart.js 4, npm   |",
    "| `lib/plot.js`   | plot.js 2.1, npm  |",
    "| `lib/table.js`  |                   |",
    "",
    "## Refreshing",
    "",
    "| `notes.js` | not in Contents |",
    "",
  ].join("\n");

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codeql-vendored-"));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("a README's Contents is read from its table, with each file's source", () => {
    expect(contentsOf(README)).toEqual([
      { path: "chart/", source: "chart.js 4, npm" },
      { path: "lib/plot.js", source: "plot.js 2.1, npm" },
      { path: "lib/table.js", source: "" },
    ]);
    expect(contentsOf("# A README with no Contents\n")).toEqual([]);
  });

  test("a file the Contents does not name, or names without a source, is undocumented", () => {
    const directory = directoryWith("vendored", {
      "README.md": README,
      "chart/chart.umd.js": "",
      "chart/locales/fr.js": "",
      "lib/plot.js": "",
      "lib/table.js": "",
      "notes.js": "",
      "own-code.ts": "",
    });

    expect(undocumentedFiles(directory)).toEqual([
      "lib/table.js",
      "notes.js",
      "own-code.ts",
    ]);
    expect(missingContents(directory)).toEqual([]);
  });

  test("a file the Contents names that is not there is reported", () => {
    const directory = directoryWith("upgraded", {
      "README.md": README,
      "chart/chart.umd.js": "",
      "lib/plot-2.2.js": "",
    });

    expect(missingContents(directory)).toEqual(["lib/plot.js", "lib/table.js"]);
  });

  test("an entry is a plain path only without pattern characters, relative steps or a trailing slash", () => {
    expect(isPlainPath("packages/Common/Server/Static/Vendor")).toBe(true);

    for (const entry of [
      "",
      "**/Vendor",
      "packages/*/Vendor",
      "packages/Common/Server/Static/Vendor/",
      "./packages/Common/Server/Static/Vendor",
      "../Vendor",
      "/packages/Common/Server/Static/Vendor",
      "packages/Common/../Common/Server/Static/Vendor",
      "packages//Common",
      "packages\\Common",
      "packages/[Cc]ommon",
      42,
    ]) {
      expect([entry, isPlainPath(entry)]).toEqual([entry, false]);
    }
  });
});

describe("the checks on the languages files hold code in", () => {
  test("a file is read as the language CodeQL reads it as, by where it is, its name or its extension", () => {
    for (const [file, language] of [
      [".github/workflows/codeql.yml", "actions"],
      [".github/workflows/test.ops.yaml", "actions"],
      [".github/actions/npm-install/action.yml", "actions"],
      ["Scripts/GHA/publish/action.yaml", "actions"],
      // GitHub runs only the workflows directly in .github/workflows.
      [".github/workflows/templates/job.yml", null],
      [".github/codeql/codeql-config.yml", null],
      [".github/dependabot.yml", null],
      ["Scripts/GHA/publish/my-action.yml", null],
      ["HelmChart/Public/oneuptime/values.yaml", null],
      [
        "packages/Probe/Utils/Monitors/SyntheticRuntime/Native/synthetic-no-sync.c",
        "c-cpp",
      ],
      ["agents/ebpf/probe.h", "c-cpp"],
      ["agents/ebpf/probe.cpp", "c-cpp"],
      ["agents/ebpf/probe.c++", "c-cpp"],
      ["Examples/otel-dotnet/Program.cs", "csharp"],
      ["Examples/otel-dotnet/Views/Home/Index.cshtml", "csharp"],
      ["Examples/otel-dotnet/otel-dotnet.csproj", null],
      ["Examples/otel-dotnet/App.xaml", null],
      ["agents/InfrastructureAgent/agent.go", "go"],
      [
        "packages/App/FeatureSet/MobileRecorder/android/src/main/java/com/oneuptime/replay/OneUptimeReplayPackage.java",
        "java-kotlin",
      ],
      ["android/app/src/main/java/com/example/MainActivity.kt", "java-kotlin"],
      ["packages/App/FeatureSet/MobileRecorder/android/build.gradle", null],
      ["packages/Common/Types/Date.ts", "javascript-typescript"],
      [
        "packages/App/FeatureSet/Dashboard/src/App.tsx",
        "javascript-typescript",
      ],
      ["Tests/Ops/CodeQlWorkflow.test.js", "javascript-typescript"],
      [
        "packages/Probe/Tests/TestingUtils/FakeTcpdump.cjs",
        "javascript-typescript",
      ],
      ["Scripts/build.mjs", "javascript-typescript"],
      ["src/Widget.jsx", "javascript-typescript"],
      ["src/config.mts", "javascript-typescript"],
      ["src/config.cts", "javascript-typescript"],
      ["src/Widget.vue", "javascript-typescript"],
      ["Tests/Ops/agent-ebpf-e2e/analyze.py", "python"],
      ["Tests/Ops/agent-ebpf-e2e/tests/test_analyze.py", "python"],
      ["Gemfile", "ruby"],
      ["docs/Gemfile", "ruby"],
      ["lib/tasks/seed.rb", "ruby"],
      ["app/views/index.html.erb", "ruby"],
      ["oneuptime.gemspec", "ruby"],
      /*
       * GitHub's language detection counts a podspec as Ruby, so default
       * setup tried Ruby on 14 September 2026, the day this one arrived -
       * but it is not a file CodeQL reads as Ruby, and that analysis failed.
       */
      [
        "packages/App/FeatureSet/MobileRecorder/OneUptimeReactNativeReplay.podspec",
        null,
      ],
      ["agents/collector/src/main.rs", "rust"],
      ["agents/collector/Cargo.toml", null],
      [
        "packages/App/FeatureSet/MobileRecorder/ios/OneUptimeReplayViewTreeModule.swift",
        "swift",
      ],
      // Objective-C is not a language CodeQL analyses.
      [
        "packages/App/FeatureSet/MobileRecorder/ios/OneUptimeReplayViewTreeModule.m",
        null,
      ],
      ["packages/Home/Views/index.ejs", null],
      ["packages/App/FeatureSet/Notification/Templates/Welcome.hbs", null],
      ["packages/Home/Static/index.html", null],
      ["package.json", null],
      ["README.md", null],
      ["packages/App/Dockerfile", null],
      ["Scripts/Install/configure.sh", null],
      ["Terraform/main.tf", null],
      [".gitignore", null],
    ]) {
      expect([file, codeQlLanguageOf(file)]).toEqual([file, language]);
    }
  });

  test("files under a path code scanning skips hold no language's code, but a path that only begins the same way does", () => {
    expect(
      languagesIn([
        "packages/Common/Server/Static/Vendor/README.md",
        "packages/Common/Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
        "packages/Common/Server/Static/Vendor/highlight/languages/go.min.js",
      ]),
    ).toEqual({});
    expect(
      languagesIn([
        "packages/Common/Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
        "packages/Common/Server/Static/VendorAssets.js",
        "packages/Common/Server/Utils/VendorAssets.ts",
        "packages/Common/Server/Static/Vendor.py",
      ]),
    ).toEqual({
      "javascript-typescript": [
        "packages/Common/Server/Static/VendorAssets.js",
        "packages/Common/Server/Utils/VendorAssets.ts",
      ],
      python: ["packages/Common/Server/Static/Vendor.py"],
    });
  });

  test("files are grouped by language, in the order git lists them, leaving out files of no language", () => {
    expect(
      languagesIn([
        ".github/workflows/build.yml",
        "README.md",
        "Tests/Ops/agent-ebpf-e2e/analyze.py",
        "agents/InfrastructureAgent/agent.go",
        "packages/Common/Types/Date.ts",
        "Tests/Ops/agent-ebpf-e2e/tests/test_analyze.py",
        "package.json",
      ]),
    ).toEqual({
      actions: [".github/workflows/build.yml"],
      python: [
        "Tests/Ops/agent-ebpf-e2e/analyze.py",
        "Tests/Ops/agent-ebpf-e2e/tests/test_analyze.py",
      ],
      go: ["agents/InfrastructureAgent/agent.go"],
      "javascript-typescript": ["packages/Common/Types/Date.ts"],
    });
    expect(languagesIn([])).toEqual({});
  });

  test("a language files hold code in that a matrix neither scans nor leaves out is reported, with its first files", () => {
    const languages = languagesIn([
      ".github/workflows/build.yml",
      "packages/Common/Types/Date.ts",
      "agents/InfrastructureAgent/agent.go",
      "Tests/Ops/agent-ebpf-e2e/analyze.py",
      "Tests/Ops/agent-ebpf-e2e/tests/test_analyze.py",
      "agents/collector/src/main.rs",
      "packages/App/FeatureSet/MobileRecorder/ios/OneUptimeReplayViewTreeModule.swift",
      "packages/App/FeatureSet/MobileRecorder/ios/OneUptimeReplayViewTreeModule.m",
    ]);
    const leftOut = { swift: "The iOS module of a mobile SDK." };

    // The matrix as it was before python: python and rust go unscanned.
    expect(
      languagesUnaccountedFor(
        languages,
        ["actions", "go", "javascript-typescript"],
        leftOut,
      ),
    ).toEqual([
      [
        "python",
        [
          "Tests/Ops/agent-ebpf-e2e/analyze.py",
          "Tests/Ops/agent-ebpf-e2e/tests/test_analyze.py",
        ],
      ],
      ["rust", ["agents/collector/src/main.rs"]],
    ]);
    expect(
      languagesUnaccountedFor(
        languages,
        ["actions", "go", "javascript-typescript", "python", "rust"],
        leftOut,
      ),
    ).toEqual([]);
    // Left out without its entry, swift is reported too.
    expect(
      languagesUnaccountedFor(
        languages,
        ["actions", "go", "javascript-typescript", "python", "rust"],
        {},
      ),
    ).toEqual([
      [
        "swift",
        [
          "packages/App/FeatureSet/MobileRecorder/ios/OneUptimeReplayViewTreeModule.swift",
        ],
      ],
    ]);
  });

  test("a failure names a language's first files, not all of them", () => {
    const files = Array.from({ length: FILES_NAMED + 3 }, (unused, index) => {
      return `agents/collector/src/module${index}.rs`;
    });

    expect(languagesUnaccountedFor(languagesIn(files), [], {})).toEqual([
      ["rust", files.slice(0, FILES_NAMED)],
    ]);
  });

  test("a value's matrix expressions are read off a matrix entry, every one of them", () => {
    const entry = { language: "python", "build-mode": "none" };

    expect(withMatrixValues("/language:${{ matrix.language }}", entry)).toBe(
      "/language:python",
    );
    expect(
      withMatrixValues(
        "${{matrix.language}}-${{ matrix.build-mode }}-${{ matrix.language }}",
        entry,
      ),
    ).toBe("python-none-python");
    expect(withMatrixValues("/language:javascript", entry)).toBe(
      "/language:javascript",
    );
  });
});
