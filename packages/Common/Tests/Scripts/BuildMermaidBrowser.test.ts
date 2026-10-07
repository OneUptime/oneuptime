import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  MERMAID_BROWSER_BUILD_DIRECTORY,
  MERMAID_BROWSER_ENTRY,
} from "../../UI/esbuild-mermaid";

/*
 * Common/Scripts/build-mermaid-browser.js writes the mermaid the docs and the
 * blog import - a build of mermaid's ES module source - when the App and Home
 * images are built (their Dockerfiles run it right after Common is copied
 * in), and Common/Server/Utils/VendorAssets.ts serves the directory it wrote.
 * These run the script the way the images do: a node subprocess.
 */

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

  test("writes the entry the views import and its content-hashed chunks, and nothing else", () => {
    const directory: string = path.join(scratch, "first");
    const run: ScriptRun = runScript([directory]);

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(
      /Built mermaid for the docs and the blog: \d+ files/,
    );

    const files: Array<string> = filesIn(directory);

    expect(files).toContain(MERMAID_BROWSER_ENTRY);
    expect(files.length).toBeGreaterThan(50);

    for (const file of files) {
      if (file === MERMAID_BROWSER_ENTRY) {
        continue;
      }

      expect([file, CONTENT_HASHED_CHUNK.test(file)]).toEqual([file, true]);
    }
  });

  test("replaces an earlier build whole, and leaves nothing beside it", () => {
    const directory: string = path.join(scratch, "replaced");

    fs.mkdirSync(path.join(directory, "chunks"), { recursive: true });
    fs.writeFileSync(path.join(directory, "chunks", "stale-AAAAAAAA.mjs"), "");
    fs.writeFileSync(path.join(directory, "left-over.txt"), "");

    const run: ScriptRun = runScript([directory]);

    expect(run.status).toBe(0);

    const files: Array<string> = filesIn(directory);

    expect(files).not.toContain("chunks/stale-AAAAAAAA.mjs");
    expect(files).not.toContain("left-over.txt");
    expect(files).toContain(MERMAID_BROWSER_ENTRY);

    // No staging or previous copy is left next to it.
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
      "process.stdout.write(typeof writeBundle);",
    );

    expect(run.stderr).toBe("");
    expect(run.stdout).toBe("function");
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
      "chunks/old-AAAAAAAA.mjs",
      MERMAID_BROWSER_ENTRY,
    ]);
    expect(
      fs.readFileSync(path.join(directory, MERMAID_BROWSER_ENTRY), "utf8"),
    ).toBe("old entry");
    expect(besides(directory)).toEqual([]);
  });

  test("refuses a file outside its directory, leaving the old build alone", () => {
    const directory: string = path.join(scratch, "guarded");

    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, MERMAID_BROWSER_ENTRY), "old entry");

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
