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
    expect(
      fs.readdirSync(scratch).filter((name: string): boolean => {
        return name.startsWith("replaced.");
      }),
    ).toEqual([]);
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
