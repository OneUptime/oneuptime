"use strict";

/**
 * No tracked text file may contain a raw NUL byte.
 *
 * Git calls a file with a NUL byte binary, so every diff of it shows as
 * "Binary files differ": a reviewer cannot see what a pull request changed
 * there, and nothing warns them. Code that needs a NUL character (a join key
 * that cannot occur in the joined values, a sentinel to split on) writes the
 * escape `\u0000` instead, which compiles to the same character.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".go",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".tpl",
  ".txt",
  ".yaml",
  ".yml",
]);

function trackedTextFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr}`);
  }
  return result.stdout.split("\0").filter((file) => {
    return TEXT_FILE_EXTENSIONS.has(path.extname(file).toLowerCase());
  });
}

function linesWithNulBytes(buffer) {
  const lines = [];
  let line = 1;
  for (let index = 0; index < buffer.length; index++) {
    if (buffer[index] === 0x0a) {
      line++;
    } else if (buffer[index] === 0x00 && lines[lines.length - 1] !== line) {
      lines.push(line);
    }
  }
  return lines;
}

describe("tracked text files", () => {
  test("hold no raw NUL bytes, so git diffs them as text", () => {
    const files = trackedTextFiles();
    expect(files.length).toBeGreaterThan(1000);

    const offenders = [];
    for (const file of files) {
      const absolutePath = path.join(REPO_ROOT, file);
      if (!fs.existsSync(absolutePath)) {
        continue;
      }
      const lines = linesWithNulBytes(fs.readFileSync(absolutePath));
      if (lines.length > 0) {
        offenders.push(`${file}:${lines.join(",")}`);
      }
    }

    // Write `\u0000` in the string, template or regex literal instead.
    expect(offenders).toEqual([]);
  });
});

describe("linesWithNulBytes", () => {
  test("reports each line holding a NUL byte once", () => {
    expect(
      linesWithNulBytes(Buffer.from("a\nb\u0000c\u0000\nd\n\u0000", "utf8")),
    ).toEqual([2, 4]);
  });

  test("reports nothing for an escaped NUL", () => {
    expect(linesWithNulBytes(Buffer.from("`${a}\\u0000${b}`\n"))).toEqual([]);
  });
});
