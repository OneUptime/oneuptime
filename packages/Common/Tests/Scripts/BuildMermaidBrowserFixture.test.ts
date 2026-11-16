import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * BUILD-MERMAID-BROWSER.JS BUILDS ONLY INTO A DIRECTORY OF ITS OWN (#7568).
 *
 * Building moves the new build into place over the directory it was given,
 * deleting whatever that held. A wrong argument, or a caller passing on a
 * path it was handed, would delete that directory and everything in it, as
 * the npm package's build once deleted Common's Scripts (#7547). So it builds
 * into its own directory, Common/build/mermaid-browser, as it always has;
 * and anywhere else only into a directory that is not there yet, is empty,
 * or holds the file a build leaves in each directory it builds into - never
 * Common, the repository it runs from, a directory that holds either, or a
 * directory inside the repository other than under its output/ (where the
 * diagrams suite builds mermaid). It refuses before it builds anything.
 *
 * Every test runs a copy of the script in a throwaway checkout under the
 * temporary directory (checkoutAt) - beside a copy of esbuild-mermaid.js and
 * a stand-in esbuild that answers with a two-file build and notes each build
 * it is asked for - and reads what is left, file by file. No test aims the
 * script at this checkout, or at a directory that holds it: checkoutAt and
 * the helpers below check every place they run or write first
 * (assertOutsideThisCheckout). `/` is put to the guard alone, which builds
 * and deletes nothing.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(COMMON_ROOT, "..", "..");
const SCRIPT: string = path.join(
  COMMON_ROOT,
  "Scripts",
  "build-mermaid-browser.js",
);
const MERMAID_MODULE: string = path.join(
  COMMON_ROOT,
  "UI",
  "esbuild-mermaid.js",
);

// The file a build leaves in each directory it builds into.
const MARKER: string = ".oneuptime-mermaid-build";

// What the stand-in esbuild builds, with the marker: as filesIn lists them.
const BUILT: Array<string> = [
  MARKER,
  "chunks/core-ABCDEFGH.mjs",
  "mermaid.mjs",
];

const STAND_IN_ESBUILD: string = [
  'const fs = require("fs");',
  'const path = require("path");',
  "",
  "// esbuild's build, as build-mermaid-browser.js asks for it: a two-file build.",
  "exports.build = async (options) => {",
  "  if (process.env.MERMAID_FIXTURE_BUILD_LOG) {",
  '    fs.appendFileSync(process.env.MERMAID_FIXTURE_BUILD_LOG, "built\\n");',
  "  }",
  "",
  "  return {",
  "    outputFiles: [",
  "      {",
  '        path: path.join(options.outdir, "mermaid.mjs"),',
  "        text: 'import(\"./chunks/core-ABCDEFGH.mjs\");\\n',",
  "      },",
  "      {",
  '        path: path.join(options.outdir, "chunks", "core-ABCDEFGH.mjs"),',
  '        text: "export default {};\\n",',
  "      },",
  "    ],",
  '    metafile: { inputs: { "node_modules/mermaid/dist/mermaid.core.mjs": {} } },',
  "  };",
  "};",
  "",
].join("\n");

let scratch: string = "";
let runs: number = 0;

beforeAll(() => {
  // Where it really is, so the paths the script names are the ones made here.
  scratch = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-mermaid-fixture-")),
  );
});

afterAll(() => {
  if (scratch) {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    const file: string = path.join(root, name);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// Every file under `directory`, hidden ones included, relative and with forward slashes.
function filesIn(directory: string): Array<string> {
  const files: Array<string> = [];

  const walk: (current: string) => void = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute: string = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(absolute);
      } else {
        files.push(
          path.relative(directory, absolute).split(path.sep).join("/"),
        );
      }
    }
  };

  walk(directory);

  return files.sort();
}

/*
 * Where `location` really is: the deepest part of it that exists, with its
 * symlinks resolved, and the rest of it below that.
 */
function realLocation(location: string): string {
  const below: Array<string> = [];
  let existing: string = path.resolve(location);

  while (!fs.existsSync(existing)) {
    below.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }

  return path.join(fs.realpathSync(existing), ...below);
}

// Whether `location` is `directory` or inside it.
function isIn(directory: string, location: string): boolean {
  const relative: string = path.relative(directory, location);

  return (
    relative.length === 0 ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

/*
 * Throws when `location` is in this checkout, or is a directory that holds
 * it. A test that aimed the script there would lose this checkout's files
 * whenever the guard let it through. checkoutAt and buildIn check each place
 * they write or build before they do.
 */
function assertOutsideThisCheckout(location: string): void {
  const repository: string = fs.realpathSync(REPOSITORY_ROOT);
  const real: string = realLocation(location);

  if (isIn(repository, real) || isIn(real, repository)) {
    throw new Error(
      `${location} is in this checkout, ${REPOSITORY_ROOT}, or holds it: a test here builds and writes only in its scratch directory`,
    );
  }
}

interface Checkout {
  // The checkout's root: the repository its copy of the script runs from.
  root: string;
  common: string;
  script: string;
  // Common/build/mermaid-browser: the build's own directory.
  own: string;
}

/*
 * A checkout at `root`, as CI scratch trees and containers unpack one under
 * the temporary directory: this script and esbuild-mermaid.js copied into
 * its packages/Common, beside some of Common's own files and a stand-in
 * esbuild, and another E2E suite's output under its output/. The copy takes
 * `root` for the repository it runs from.
 */
function checkoutAt(root: string): Checkout {
  const common: string = path.join(root, "packages", "Common");

  assertOutsideThisCheckout(root);
  writeFiles(root, {
    "package.json": '{ "name": "a-checkout" }\n',
    "packages/App/Index.ts": "export {};\n",
    "packages/Common/package.json": '{ "name": "@oneuptime/common" }\n',
    "packages/Common/Scripts/build-mermaid-browser.js": fs.readFileSync(
      SCRIPT,
      "utf8",
    ),
    "packages/Common/Scripts/release.js": "// One of Common's own scripts.\n",
    "packages/Common/UI/esbuild-mermaid.js": fs.readFileSync(
      MERMAID_MODULE,
      "utf8",
    ),
    "packages/Common/UI/Components/Card.tsx": "export {};\n",
    "packages/Common/node_modules/esbuild/package.json":
      '{ "name": "esbuild", "main": "index.js" }\n',
    "packages/Common/node_modules/esbuild/index.js": STAND_IN_ESBUILD,
    "output/playwright/other-suite/test-results/report.json": "{}\n",
  });

  return {
    root,
    common,
    script: path.join(common, "Scripts", "build-mermaid-browser.js"),
    own: path.join(common, "build", "mermaid-browser"),
  };
}

interface BuildRun {
  status: number;
  stdout: string;
  stderr: string;
  // Whether the stand-in esbuild was asked to build.
  built: boolean;
}

/*
 * The checkout's copy of the script, run with Node.js in `cwd` (default: the
 * checkout's Common, as the images run it), with `args`.
 */
function buildIn(
  checkout: Checkout,
  args: Array<string>,
  cwd: string = checkout.common,
): BuildRun {
  assertOutsideThisCheckout(cwd);

  for (const arg of args) {
    assertOutsideThisCheckout(path.resolve(cwd, arg));
  }

  runs++;

  const log: string = path.join(scratch, `build-${runs}.log`);
  const result: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(
    process.execPath,
    [checkout.script, ...args],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, MERMAID_FIXTURE_BUILD_LOG: log },
      timeout: 60000,
      killSignal: "SIGKILL",
    },
  );

  return {
    status: result.status === null ? -1 : result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    built: fs.existsSync(log),
  };
}

/*
 * Runs `program` in a Node.js process of its own with the checkout's copy of
 * the script required as `script` (which builds nothing when required) and
 * `directory` in scope; it prints its answer.
 */
function withScript(
  checkout: Checkout,
  directory: string,
  program: string,
): string {
  const result: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(
    process.execPath,
    [
      "-e",
      [
        `const script = require(${JSON.stringify(checkout.script)});`,
        `const directory = ${JSON.stringify(directory)};`,
        program,
      ].join("\n"),
    ],
    { cwd: checkout.common, encoding: "utf8", timeout: 60000 },
  );

  expect(result.stderr).toBe("");

  return result.stdout;
}

// What the guard alone says of `directory`: "deletable", or why not. It builds and deletes nothing.
function guardSays(checkout: Checkout, directory: string): string {
  return withScript(
    checkout,
    directory,
    [
      "try {",
      "  script.assertDeletable(directory);",
      '  process.stdout.write("deletable");',
      "} catch (error) {",
      "  process.stdout.write(error.message);",
      "}",
    ].join("\n"),
  );
}

let checkouts: number = 0;

// A checkout of its own for each test: a refusal that failed would damage only it.
function freshCheckout(): Checkout {
  checkouts++;

  return checkoutAt(path.join(scratch, `checkout-${checkouts}`));
}

function refusal(directory: string, why: string): string {
  return `Refusing to build mermaid into ${directory}: building there replaces it, deleting what it holds, ${why}`;
}

function insideTheRepository(checkout: Checkout): string {
  return `and it is inside the repository the build runs from, ${checkout.root}, where only ${checkout.own} and the directories under ${path.join(checkout.root, "output")} may be the build's`;
}

const NOT_THE_BUILDS: string = `and it holds files a build did not write: a build leaves ${MARKER} in each directory it builds into (delete a build made before builds left it yourself, and build again)`;

// The script refused `directory` for `why`, before building anything.
function expectRefused(run: BuildRun, directory: string, why: string): void {
  expect(run.stderr).toBe(
    `mermaid could not be built for the docs and the blog: ${refusal(directory, why)}\n`,
  );
  expect(run.status).toBe(1);
  expect(run.stdout).toBe("");
  expect(run.built).toBe(false);
}

// Nothing the build moves aside or stages is left beside `directory`.
function nothingBeside(directory: string): Array<string> {
  if (!fs.existsSync(path.dirname(directory))) {
    return [];
  }

  return fs
    .readdirSync(path.dirname(directory))
    .filter((name: string): boolean => {
      return (
        name.startsWith(`${path.basename(directory)}.partial-`) ||
        name.startsWith(`${path.basename(directory)}.previous-`)
      );
    });
}

describe("the build's own directory", () => {
  test("builds into Common/build/mermaid-browser unless told otherwise, and again over that build", () => {
    const checkout: Checkout = freshCheckout();
    const before: Array<string> = filesIn(checkout.root);

    for (let build: number = 0; build < 2; build++) {
      const run: BuildRun = buildIn(checkout, []);

      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(run.built).toBe(true);
      expect(run.stdout).toContain(
        `Built mermaid for the docs and the blog: 2 files in ${checkout.own}`,
      );
      expect(filesIn(checkout.own)).toEqual(BUILT);
      expect(nothingBeside(checkout.own)).toEqual([]);
    }

    // Everything else in the checkout is as it was.
    expect(
      filesIn(checkout.root).filter((file: string): boolean => {
        return !file.startsWith("packages/Common/build/");
      }),
    ).toEqual(before);
  });

  test("replaces a build an earlier version left there without the file, as an image's or a developer's may be", () => {
    const checkout: Checkout = freshCheckout();

    writeFiles(checkout.own, {
      "mermaid.mjs": "an old entry\n",
      "chunks/old-AAAAAAAA.mjs": "an old chunk\n",
    });

    const run: BuildRun = buildIn(checkout, [checkout.own]);

    expect(run.status).toBe(0);
    expect(filesIn(checkout.own)).toEqual(BUILT);
  });

  test("takes its own directory reached through a symlink for its own", () => {
    const checkout: Checkout = freshCheckout();
    const link: string = path.join(scratch, `link-to-common-${checkouts}`);

    fs.symlinkSync(checkout.common, link, "dir");

    const run: BuildRun = buildIn(checkout, [
      path.join(link, "build", "mermaid-browser"),
    ]);

    expect(run.status).toBe(0);
    expect(filesIn(checkout.own)).toEqual(BUILT);
  });
});

describe("the repository, and Common in it, are never replaced", () => {
  test("refuses the repository, `../..` from Common, and deletes nothing", () => {
    const checkout: Checkout = freshCheckout();
    const before: Array<string> = filesIn(checkout.root);

    expectRefused(
      buildIn(checkout, [checkout.root]),
      checkout.root,
      `and that would delete the repository the build runs from, ${checkout.root}`,
    );
    expectRefused(
      buildIn(checkout, [path.join("..", "..")]),
      checkout.root,
      `and that would delete the repository the build runs from, ${checkout.root}`,
    );
    expect(filesIn(checkout.root)).toEqual(before);
  });

  test("refuses Common, `.`, and the packages directory that holds it, `..`, and deletes nothing", () => {
    const checkout: Checkout = freshCheckout();
    const before: Array<string> = filesIn(checkout.root);

    expectRefused(
      buildIn(checkout, ["."]),
      checkout.common,
      `and that would delete Common, ${checkout.common}`,
    );
    expectRefused(
      buildIn(checkout, [".."]),
      path.dirname(checkout.common),
      `and that would delete Common, ${checkout.common}`,
    );
    expect(filesIn(checkout.root)).toEqual(before);
  });

  test("refuses a directory inside the repository, even a new or an empty one, and deletes nothing", () => {
    const checkout: Checkout = freshCheckout();

    fs.mkdirSync(path.join(checkout.common, "Empty"));

    const before: Array<string> = filesIn(checkout.root);

    for (const directory of [
      // Common's own Scripts, where the npm build's test once built (#7547).
      path.join(checkout.common, "Scripts"),
      path.join(checkout.common, "Scripts", "out"),
      path.join(checkout.common, "UI"),
      path.join(checkout.common, "Empty"),
      // Common's build/, which holds the build's own directory and the npm package's.
      path.join(checkout.common, "build"),
      path.join(checkout.root, "packages", "App"),
      path.join(checkout.root, "not-there-yet"),
    ]) {
      expectRefused(
        buildIn(checkout, [directory]),
        directory,
        insideTheRepository(checkout),
      );
      expect(nothingBeside(directory)).toEqual([]);
    }

    expect(filesIn(checkout.root)).toEqual(before);
  });

  test("refuses a directory that holds the repository, even one a build made, and deletes nothing", () => {
    // A directory a build made, which a checkout was unpacked into since.
    const holder: string = path.join(scratch, `holder-${checkouts}`);
    const builder: Checkout = freshCheckout();

    expect(buildIn(builder, [holder]).status).toBe(0);
    expect(filesIn(holder)).toEqual(BUILT);

    const checkout: Checkout = checkoutAt(path.join(holder, "checkout"));
    const before: Array<string> = filesIn(holder);

    expectRefused(
      buildIn(checkout, [holder]),
      holder,
      `and that would delete the repository the build runs from, ${checkout.root}`,
    );
    expect(filesIn(holder)).toEqual(before);
  });

  test("refuses the checkout's directories reached through a symlink, and leaves the checkout as it was", () => {
    const checkout: Checkout = freshCheckout();
    const link: string = path.join(scratch, `link-to-checkout-${checkouts}`);

    fs.symlinkSync(checkout.root, link, "dir");

    const before: Array<string> = filesIn(checkout.root);
    const scripts: string = path.join(link, "packages", "Common", "Scripts");
    const common: string = path.join(link, "packages", "Common");

    expectRefused(
      buildIn(checkout, [scripts]),
      scripts,
      insideTheRepository(checkout),
    );
    expectRefused(
      buildIn(checkout, [common]),
      common,
      `and that would delete Common, ${checkout.common}`,
    );
    // The link itself is what a build there would replace: it is no build's.
    expectRefused(
      buildIn(checkout, [link]),
      link,
      "and it is not a directory a build made",
    );
    expect(filesIn(checkout.root)).toEqual(before);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });
});

describe("the repository's output/, where the diagrams suite builds mermaid", () => {
  test("builds there into a directory not there yet, and again over that build", () => {
    const checkout: Checkout = freshCheckout();
    const diagrams: string = path.join(
      checkout.root,
      "output",
      "playwright",
      "diagrams-ui",
      "mermaid-browser",
    );

    for (let build: number = 0; build < 2; build++) {
      const run: BuildRun = buildIn(checkout, [diagrams]);

      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(filesIn(diagrams)).toEqual(BUILT);
    }

    // Another suite's output beside it is as it was.
    expect(
      filesIn(path.join(checkout.root, "output", "playwright", "other-suite")),
    ).toEqual(["test-results/report.json"]);
  });

  test("refuses there what another suite wrote, output/ itself, and a build made before builds left the file", () => {
    const checkout: Checkout = freshCheckout();
    const earlier: string = path.join(
      checkout.root,
      "output",
      "playwright",
      "diagrams-ui",
      "mermaid-browser",
    );

    writeFiles(earlier, {
      "mermaid.mjs": "an old entry\n",
      "chunks/old-AAAAAAAA.mjs": "an old chunk\n",
    });

    const before: Array<string> = filesIn(checkout.root);

    for (const directory of [
      path.join(checkout.root, "output", "playwright", "other-suite"),
      earlier,
    ]) {
      expectRefused(buildIn(checkout, [directory]), directory, NOT_THE_BUILDS);
    }

    // output/ itself is no directory under it.
    const output: string = path.join(checkout.root, "output");

    expectRefused(
      buildIn(checkout, [output]),
      output,
      insideTheRepository(checkout),
    );
    expect(filesIn(checkout.root)).toEqual(before);
  });
});

describe("outside the repository, only a directory of the build's own", () => {
  test("builds into a directory not there yet, or an empty one, and again over a build it made there", () => {
    const checkout: Checkout = freshCheckout();
    const notThereYet: string = path.join(
      scratch,
      `elsewhere-${checkouts}`,
      "deep",
      "mermaid",
    );
    const empty: string = fs.mkdtempSync(path.join(scratch, "empty-"));

    for (const directory of [notThereYet, empty]) {
      const run: BuildRun = buildIn(checkout, [directory]);

      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(filesIn(directory)).toEqual(BUILT);
      expect(nothingBeside(directory)).toEqual([]);
    }

    // A file left in a build it made goes with the next build.
    fs.writeFileSync(path.join(empty, "left-over.txt"), "left\n");

    expect(buildIn(checkout, [empty]).status).toBe(0);
    expect(filesIn(empty)).toEqual(BUILT);
  });

  test("refuses a directory that holds files a build did not write, or a file, and deletes nothing", () => {
    const checkout: Checkout = freshCheckout();
    const other: string = fs.mkdtempSync(path.join(scratch, "other-tool-"));

    writeFiles(other, {
      "notes.txt": "Another tool's notes.\n",
      "project/package.json": "{}\n",
    });

    expectRefused(buildIn(checkout, [other]), other, NOT_THE_BUILDS);

    const file: string = path.join(other, "notes.txt");

    expectRefused(
      buildIn(checkout, [file]),
      file,
      "and it is not a directory a build made",
    );
    expect(filesIn(other)).toEqual(["notes.txt", "project/package.json"]);
  });

  test("refuses a symlink where the build would go, and leaves it and what it leads to alone", () => {
    const checkout: Checkout = freshCheckout();
    const elsewhere: string = fs.mkdtempSync(path.join(scratch, "elsewhere-"));
    const real: string = path.join(elsewhere, "real");
    const link: string = path.join(elsewhere, "link");

    // Even to a directory a build made: the link is not one.
    expect(buildIn(checkout, [real]).status).toBe(0);
    fs.symlinkSync(real, link, "dir");

    expectRefused(
      buildIn(checkout, [link]),
      link,
      "and it is not a directory a build made",
    );
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(filesIn(real)).toEqual(BUILT);
  });
});

describe("the guard alone", () => {
  test("refuses `/` and the directory that holds the checkout, building and deleting nothing", () => {
    const checkout: Checkout = freshCheckout();
    const before: Array<string> = filesIn(checkout.root);

    expect(guardSays(checkout, "/")).toBe(
      refusal(
        "/",
        `and that would delete the repository the build runs from, ${checkout.root}`,
      ),
    );
    expect(guardSays(checkout, scratch)).toBe(
      refusal(
        scratch,
        `and that would delete the repository the build runs from, ${checkout.root}`,
      ),
    );
    expect(filesIn(checkout.root)).toEqual(before);
  });

  test("takes the build's own directory and a new one outside the repository as deletable", () => {
    const checkout: Checkout = freshCheckout();

    expect(guardSays(checkout, checkout.own)).toBe("deletable");
    expect(
      guardSays(checkout, path.join(scratch, `new-${checkouts}`, "mermaid")),
    ).toBe("deletable");
  });

  test("writeBundle, required on its own, refuses what the script refuses, and writes nothing", () => {
    const checkout: Checkout = freshCheckout();
    const scripts: string = path.join(checkout.common, "Scripts");
    const before: Array<string> = filesIn(checkout.root);
    const answer: string = withScript(
      checkout,
      scripts,
      [
        "try {",
        "  script.writeBundle(",
        '    { files: [{ path: "mermaid.mjs", text: "new entry" }] },',
        "    directory,",
        "  );",
        '  process.stdout.write("written");',
        "} catch (error) {",
        "  process.stdout.write(error.message);",
        "}",
      ].join("\n"),
    );

    expect(answer).toBe(refusal(scripts, insideTheRepository(checkout)));
    expect(filesIn(checkout.root)).toEqual(before);
    expect(nothingBeside(scripts)).toEqual([]);
  });
});

/*
 * checkoutAt and buildIn check each place they write or build with
 * assertOutsideThisCheckout first, so no test here can aim at this
 * checkout. Checked on the paths alone: nothing is built or written in this
 * checkout to show it.
 */
describe("this checkout", () => {
  test("no test here builds or writes in it, or in a directory that holds it", () => {
    const link: string = path.join(scratch, "link-to-this-checkout");

    fs.symlinkSync(COMMON_ROOT, link, "dir");

    for (const location of [
      // Where the script builds this checkout's mermaid.
      path.join(COMMON_ROOT, "build", "mermaid-browser"),
      path.join(COMMON_ROOT, "Scripts"),
      path.join(COMMON_ROOT, "Scripts", "not-there-yet"),
      COMMON_ROOT,
      REPOSITORY_ROOT,
      path.join(REPOSITORY_ROOT, "output", "playwright"),
      path.dirname(REPOSITORY_ROOT),
      "/",
      // This checkout's Scripts, through a symlink in the scratch directory.
      path.join(link, "Scripts"),
    ]) {
      expect(() => {
        assertOutsideThisCheckout(location);
      }).toThrow(
        `${location} is in this checkout, ${REPOSITORY_ROOT}, or holds it`,
      );
    }

    // Where the tests build and write: the scratch directory.
    expect(() => {
      assertOutsideThisCheckout(path.join(scratch, "checkout", "output"));
    }).not.toThrow();
  });
});
