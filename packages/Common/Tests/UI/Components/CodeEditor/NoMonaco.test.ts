import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The code editor was Monaco: a multi-megabyte runtime copied next to every
 * frontend bundle at build time, loaded asynchronously at run time through a
 * build-defined path, and pinned to a version its loader could unwrap. It was
 * replaced by CodeEditor's textarea over a highlight.js layer, and every
 * piece of that plumbing went with it. These guards keep any of it from
 * quietly coming back - a stray import would drag the package back into
 * every bundle, and a lockfile entry would put it back in every image.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SOURCE_EXTENSIONS: Array<string> = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

// Generated output, dependencies and test fixtures: never application source.
const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "output",
  "public",
  ".git",
];

const MENTIONS_MONACO: RegExp = /monaco/i;

const MONACO_IMPORT: RegExp =
  /(?:\bfrom\s+|\brequire\(\s*|\bimport\(\s*|\bimport\s+)["'](?:monaco-editor|@monaco-editor\/[^"']*)(?:\/[^"']*)?["']/;

type WalkFunction = (
  directory: string,
  accept: (file: string) => boolean,
  skip: Array<string>,
) => Array<string>;

const walk: WalkFunction = (
  directory: string,
  accept: (file: string) => boolean,
  skip: Array<string>,
): Array<string> => {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!skip.includes(entry.name)) {
        found.push(...walk(full, accept, skip));
      }

      continue;
    }

    if (entry.isFile() && accept(full)) {
      found.push(full);
    }
  }

  return found;
};

type RelativeFunction = (file: string) => string;

const relative: RelativeFunction = (file: string): string => {
  return path.relative(REPOSITORY_ROOT, file);
};

describe("Monaco is gone for good", () => {
  test("the repository root is where this test thinks it is", () => {
    // Every guard below walks from here; a wrong root would pass vacuously.
    expect(
      fs.existsSync(
        path.join(REPOSITORY_ROOT, "packages", "Common", "package.json"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(REPOSITORY_ROOT, "packages", "App"))).toBe(
      true,
    );
  });

  test("no application source imports monaco-editor or @monaco-editor/*", () => {
    const roots: Array<string> = [
      path.join(REPOSITORY_ROOT, "packages"),
      path.join(REPOSITORY_ROOT, "ee"),
    ].filter((root: string): boolean => {
      // CI runs the core suites with ee/ deleted.
      return fs.existsSync(root);
    });

    const sources: Array<string> = roots.flatMap((root: string) => {
      return walk(
        root,
        (file: string): boolean => {
          return SOURCE_EXTENSIONS.includes(path.extname(file));
        },
        SKIPPED_DIRECTORIES,
      );
    });

    // The walk found the editor itself, so it is really looking at the tree.
    expect(sources.map(relative)).toContain(
      path.join(
        "packages",
        "Common",
        "UI",
        "Components",
        "CodeEditor",
        "CodeEditor.tsx",
      ),
    );

    const offenders: Array<string> = sources
      .filter((file: string): boolean => {
        return MONACO_IMPORT.test(fs.readFileSync(file, "utf8"));
      })
      .map(relative);

    expect(offenders).toEqual([]);
  });

  test("the import pattern would catch every way of pulling Monaco in", () => {
    for (const line of [
      'import Editor from "@monaco-editor/react";',
      "import { loader } from '@monaco-editor/react';",
      'import * as monaco from "monaco-editor";',
      'import "monaco-editor/esm/vs/editor/editor.api";',
      'const loader = require("@monaco-editor/loader");',
      'const monaco = await import("monaco-editor");',
      'export { default } from "@monaco-editor/react";',
    ]) {
      expect([line, MONACO_IMPORT.test(line)]).toEqual([line, true]);
    }

    // Prose about Monaco is fine; only an import is a dependency.
    expect(MONACO_IMPORT.test("// The editor used to be Monaco.")).toBe(false);
  });

  test("Common declares neither Monaco package", () => {
    const packageJson: {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    } = JSON.parse(
      fs.readFileSync(
        path.join(REPOSITORY_ROOT, "packages", "Common", "package.json"),
        "utf8",
      ),
    );

    const declared: Array<string> = [
      ...Object.keys(packageJson.dependencies || {}),
      ...Object.keys(packageJson.devDependencies || {}),
      ...Object.keys(packageJson.peerDependencies || {}),
    ];

    expect(declared).toContain("highlight.js");
    expect(
      declared.filter((name: string): boolean => {
        return name === "monaco-editor" || name.startsWith("@monaco-editor/");
      }),
    ).toEqual([]);
  });

  test("no lockfile in the repository still resolves Monaco", () => {
    /*
     * Every package that links Common mirrors Common's dependency list in its
     * own lockfile, so a leftover entry there is Monaco still being installed.
     */
    const lockfiles: Array<string> = walk(
      REPOSITORY_ROOT,
      (file: string): boolean => {
        return path.basename(file) === "package-lock.json";
      },
      ["node_modules", ".git", ".claude", "output"],
    );

    expect(lockfiles.map(relative)).toContain(
      path.join("packages", "Common", "package-lock.json"),
    );

    const offenders: Array<string> = lockfiles
      .filter((file: string): boolean => {
        return MENTIONS_MONACO.test(fs.readFileSync(file, "utf8"));
      })
      .map(relative);

    expect(offenders).toEqual([]);
  });

  test("the frontend build neither copies a Monaco runtime nor defines its path", () => {
    const buildConfig: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages",
        "Common",
        "UI",
        "esbuild-config.js",
      ),
      "utf8",
    );

    expect(buildConfig).not.toMatch(/copyMonacoAssets/);
    expect(buildConfig).not.toMatch(/MONACO_ASSET_PATH/);
    expect(buildConfig).not.toMatch(/assets\/monaco/);
    expect(buildConfig).not.toMatch(
      /resolvePackageRoot\(\s*["']monaco-editor["']\s*\)/,
    );
  });

  test("the Monaco loader module is gone", () => {
    expect(
      fs.existsSync(
        path.join(
          REPOSITORY_ROOT,
          "packages",
          "Common",
          "UI",
          "Components",
          "CodeEditor",
          "MonacoLoader.ts",
        ),
      ),
    ).toBe(false);
  });
});
