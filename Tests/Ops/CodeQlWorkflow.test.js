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
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
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

describe(WORKFLOW, () => {
  test("scans pull requests, nightly, and on demand - not pushes", () => {
    expect(Object.keys(triggers).sort()).toEqual(
      ["pull_request", "schedule", "workflow_dispatch"].sort(),
    );
    expect(triggers.schedule).toHaveLength(1);
  });

  test("analyses what default setup did, the way it did", () => {
    // From the repository's default setup analyses (build-mode per language).
    expect(analyze.strategy.matrix.include).toEqual([
      { language: "actions", "build-mode": "none" },
      { language: "go", "build-mode": "autobuild" },
      { language: "javascript-typescript", "build-mode": "none" },
    ]);
  });

  test("uploads under default setup's categories, so its alerts carry over", () => {
    const upload = analyze.steps.find((step) => {
      return /^github\/codeql-action\/analyze@/.test(step.uses || "");
    });

    expect(upload.with.category).toBe("/language:${{ matrix.language }}");
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
