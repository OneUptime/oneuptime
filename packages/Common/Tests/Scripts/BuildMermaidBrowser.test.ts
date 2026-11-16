import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  MERMAID_BROWSER_BUILD_DIRECTORY,
  MERMAID_BROWSER_ENTRY,
  isMermaidBrowserFile,
} from "../../UI/esbuild-mermaid";

/*
 * Common/Scripts/build-mermaid-browser.js writes the mermaid the docs and the
 * blog import - a build of mermaid's ES module source - when the App and Home
 * images are built (their Dockerfiles run it right after Common is copied
 * in), and Common/Server/Utils/VendorAssets.ts serves the directory it wrote.
 * These run the script the way the images do: a node subprocess.
 *
 * It replaces the directory it builds into, so it builds only into one of
 * its own: BuildMermaidBrowserFixture.test.ts runs copies of it in throwaway
 * checkouts to show what it refuses (#7568).
 */

// The file a build leaves in each directory it builds into, to know it as its own.
const BUILD_MARKER: string = ".oneuptime-mermaid-build";

const SCRIPT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "Scripts",
  "build-mermaid-browser.js",
);

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..");

// chunks/<name>-<HASH>.mjs, as esbuild-mermaid.js names them.
const CONTENT_HASHED_CHUNK: RegExp =
  /^chunks\/[A-Za-z0-9._-]+-[A-Z0-9]{8,}\.mjs$/;

interface ScriptRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(args: Array<string>): ScriptRun {
  const result: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(
    process.execPath,
    [SCRIPT, ...args],
    { cwd: COMMON_ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );

  return {
    status: result.status === null ? -1 : result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/*
 * writeBundle on its own: a node subprocess requires the script (which builds
 * nothing when required rather than run) and runs `program` with fs,
 * writeBundle and directory in scope.
 */
function runWriteBundle(directory: string, program: string): ScriptRun {
  const result: childProcess.SpawnSyncReturns<string> = childProcess.spawnSync(
    process.execPath,
    [
      "-e",
      [
        'const fs = require("fs");',
        `const { writeBundle } = require(${JSON.stringify(SCRIPT)});`,
        `const directory = ${JSON.stringify(directory)};`,
        program,
      ].join("\n"),
    ],
    { cwd: COMMON_ROOT, encoding: "utf8" },
  );

  return {
    status: result.status === null ? -1 : result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

// What sits next to `directory` under its name: a staging or previous copy.
function besides(directory: string): Array<string> {
  const prefix: string = `${path.basename(directory)}.`;

  return fs
    .readdirSync(path.dirname(directory))
    .filter((name: string): boolean => {
      return name.startsWith(prefix);
    });
}

// Every file under `directory`, relative and with forward slashes.
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

describe("build-mermaid-browser.js", () => {
  let scratch: string;

  beforeAll(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-diagrams-"));
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  test("writes to Common/build/mermaid-browser unless told otherwise", () => {
    expect(MERMAID_BROWSER_BUILD_DIRECTORY).toBe(
      path.join(COMMON_ROOT, "build", "mermaid-browser"),
    );
    // The script's only default is that constant.
    expect(fs.readFileSync(SCRIPT, "utf8")).toContain(
      "process.argv[2] || MERMAID_BROWSER_BUILD_DIRECTORY",
    );
  });

  test("writes the entry the views import, its content-hashed chunks and the file that makes the directory its own, and nothing else", () => {
    const directory: string = path.join(scratch, "first");
    const run: ScriptRun = runScript([directory]);

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(
      /Built mermaid for the docs and the blog: \d+ files/,
    );

    const files: Array<string> = filesIn(directory);

    expect(files).toContain(MERMAID_BROWSER_ENTRY);
    expect(files).toContain(BUILD_MARKER);
    expect(files.length).toBeGreaterThan(50);

    for (const file of files) {
      if (file === MERMAID_BROWSER_ENTRY || file === BUILD_MARKER) {
        continue;
      }

      expect([file, CONTENT_HASHED_CHUNK.test(file)]).toEqual([file, true]);
    }

    // The marker is no file of the build: VendorAssets never serves it.
    expect(isMermaidBrowserFile(BUILD_MARKER)).toBe(false);
  });

  test("replaces an earlier build whole, and leaves nothing beside it", () => {
    const directory: string = path.join(scratch, "replaced");

    // An earlier build: its stale chunk, a file left over, and the marker.
    fs.mkdirSync(path.join(directory, "chunks"), { recursive: true });
    fs.writeFileSync(path.join(directory, "chunks", "stale-AAAAAAAA.mjs"), "");
    fs.writeFileSync(path.join(directory, "left-over.txt"), "");
    fs.writeFileSync(path.join(directory, BUILD_MARKER), "an earlier build\n");

    const run: ScriptRun = runScript([directory]);

    expect(run.status).toBe(0);

    const files: Array<string> = filesIn(directory);

    expect(files).not.toContain("chunks/stale-AAAAAAAA.mjs");
    expect(files).not.toContain("left-over.txt");
    expect(files).toContain(MERMAID_BROWSER_ENTRY);
    expect(files).toContain(BUILD_MARKER);

    // No staging or previous copy is left next to it.
    expect(besides(directory)).toEqual([]);
  });

  test("refuses, before it builds anything, a directory it did not build, and deletes nothing", () => {
    const directory: string = path.join(scratch, "another-tool");

    fs.mkdirSync(path.join(directory, "data"), { recursive: true });
    fs.writeFileSync(path.join(directory, "notes.txt"), "Another tool's.\n");
    fs.writeFileSync(path.join(directory, "data", "state.json"), "{}\n");

    const run: ScriptRun = runScript([directory]);

    expect(run.status).toBe(1);
    expect(run.stderr).toBe(
      `mermaid could not be built for the docs and the blog: Refusing to build mermaid into ${directory}: building there replaces it, deleting what it holds, and it holds files a build did not write: a build leaves ${BUILD_MARKER} in each directory it builds into (delete a build made before builds left it yourself, and build again)\n`,
    );
    // Nothing was built, written or deleted.
    expect(run.stdout).toBe("");
    expect(filesIn(directory)).toEqual(["data/state.json", "notes.txt"]);
    expect(besides(directory)).toEqual([]);
  });

  test("writeBundle, required on its own, refuses what the script refuses, and writes nothing", () => {
    const directory: string = path.join(scratch, "another-tool-again");

    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "notes.txt"), "Another tool's.\n");

    const run: ScriptRun = runWriteBundle(
      directory,
      String.raw`
        try {
          writeBundle(
            { files: [{ path: "mermaid.mjs", text: "new entry" }] },
            directory,
          );
          process.stdout.write("no error");
        } catch (error) {
          process.stdout.write(error.message);
        }
      `,
    );

    expect(run.stderr).toBe("");
    expect(run.stdout).toContain(`Refusing to build mermaid into ${directory}`);
    expect(filesIn(directory)).toEqual(["notes.txt"]);
    expect(besides(directory)).toEqual([]);
  });

  test("builds the same bytes every time, so every image serves the same chunk names", () => {
    const first: string = path.join(scratch, "first");
    const second: string = path.join(scratch, "second");

    if (!fs.existsSync(first)) {
      expect(runScript([first]).status).toBe(0);
    }

    expect(runScript([second]).status).toBe(0);
    expect(filesIn(second)).toEqual(filesIn(first));

    for (const file of filesIn(first)) {
      expect([
        file,
        fs
          .readFileSync(path.join(first, file))
          .equals(fs.readFileSync(path.join(second, file))),
      ]).toEqual([file, true]);
    }
  });

  test("builds nothing when it is required rather than run", () => {
    const directory: string = path.join(scratch, "required");
    const run: ScriptRun = runWriteBundle(
      directory,
      [
        `const script = require(${JSON.stringify(SCRIPT)});`,
        "process.stdout.write(",
        "  [typeof writeBundle, typeof script.assertDeletable, script.BUILD_MARKER_NAME].join(' '),",
        ");",
      ].join("\n"),
    );

    expect(run.stderr).toBe("");
    expect(run.stdout).toBe(`function function ${BUILD_MARKER}`);
    expect(fs.existsSync(directory)).toBe(false);
  });

  test("puts the old build back when the new one cannot be moved into place", () => {
    const directory: string = path.join(scratch, "kept");

    fs.mkdirSync(path.join(directory, "chunks"), { recursive: true });
    fs.writeFileSync(path.join(directory, MERMAID_BROWSER_ENTRY), "old entry");
    fs.writeFileSync(
      path.join(directory, "chunks", "old-AAAAAAAA.mjs"),
      "old chunk",
    );
    fs.writeFileSync(path.join(directory, BUILD_MARKER), "the old build\n");

    // The move of the new build into place fails; every other rename works.
    const run: ScriptRun = runWriteBundle(
      directory,
      String.raw`
        const rename = fs.renameSync;
        fs.renameSync = (from, to) => {
          if (from.includes(".partial-")) {
            throw new Error("the move failed");
          }
          return rename(from, to);
        };
        try {
          writeBundle(
            { files: [{ path: "mermaid.mjs", text: "new entry" }] },
            directory,
          );
          process.stdout.write("no error");
        } catch (error) {
          process.stdout.write(error.message);
        }
      `,
    );

    expect(run.stderr).toBe("");
    expect(run.stdout).toBe("the move failed");
    expect(filesIn(directory)).toEqual([
      BUILD_MARKER,
      "chunks/old-AAAAAAAA.mjs",
      MERMAID_BROWSER_ENTRY,
    ]);
    expect(fs.readFileSync(path.join(directory, BUILD_MARKER), "utf8")).toBe(
      "the old build\n",
    );
    expect(
      fs.readFileSync(path.join(directory, MERMAID_BROWSER_ENTRY), "utf8"),
    ).toBe("old entry");
    expect(besides(directory)).toEqual([]);
  });

  test("refuses a file outside its directory, leaving the old build alone", () => {
    const directory: string = path.join(scratch, "guarded");

    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, MERMAID_BROWSER_ENTRY), "old entry");
    fs.writeFileSync(path.join(directory, BUILD_MARKER), "the old build\n");

    const run: ScriptRun = runWriteBundle(
      directory,
      String.raw`
        try {
          writeBundle(
            {
              files: [
                { path: "mermaid.mjs", text: "new entry" },
                { path: "../escaped.mjs", text: "escaped" },
              ],
            },
            directory,
          );
          process.stdout.write("no error");
        } catch (error) {
          process.stdout.write(error.message);
        }
      `,
    );

    expect(run.stdout).toContain("Refusing to write ../escaped.mjs");
    expect(fs.existsSync(path.join(scratch, "escaped.mjs"))).toBe(false);
    expect(
      fs.readFileSync(path.join(directory, MERMAID_BROWSER_ENTRY), "utf8"),
    ).toBe("old entry");
    expect(besides(directory)).toEqual([]);
  });

  test("fails, and says why, when it cannot write the build", () => {
    // A file where its parent directory should be.
    const blocker: string = path.join(scratch, "not-a-directory");
    fs.writeFileSync(blocker, "");

    const run: ScriptRun = runScript([path.join(blocker, "mermaid-browser")]);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(
      "mermaid could not be built for the docs and the blog",
    );
  });
});
