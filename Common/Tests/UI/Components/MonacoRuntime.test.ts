import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The build copies monaco-editor's min/vs next to each frontend bundle and
 * MonacoLoader points @monaco-editor/loader at it, so the version we install is
 * the version that actually runs in the browser. The loader resolves init()
 * with whatever the AMD module `vs/editor/editor.main` exports, and that shape
 * is not stable across Monaco releases: 0.53 and 0.54 nest the API under
 * `exports.m`, which leaves `monaco.editor` undefined and makes every editor
 * throw "Cannot read properties of undefined (reading 'getModel')" instead of
 * mounting.
 *
 * Pinning to the version the loader itself would have fetched keeps the local
 * copy behaving exactly like the CDN load it replaced. These tests fail if the
 * two ever drift - notably if @monaco-editor/react is upgraded without moving
 * monaco-editor to match.
 */

type ReadInstalledVersion = (packageName: string) => string;

const readInstalledVersion: ReadInstalledVersion = (
  packageName: string,
): string => {
  const packageJsonPath: string = require.resolve(
    `${packageName}/package.json`,
  );

  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version;
};

type ReadLoaderDefaultVersion = () => string;

/*
 * @monaco-editor/loader ships its default CDN path as a plain string literal in
 * its config module. Reading the version out of it is how we learn which Monaco
 * build the loader was written against.
 */
const readLoaderDefaultVersion: ReadLoaderDefaultVersion = (): string => {
  const loaderRoot: string = path.dirname(
    require.resolve("@monaco-editor/loader/package.json"),
  );
  const configPath: string = path.join(
    loaderRoot,
    "lib",
    "cjs",
    "config",
    "index.js",
  );

  expect(fs.existsSync(configPath)).toBe(true);

  const source: string = fs.readFileSync(configPath, "utf8");
  const match: RegExpMatchArray | null = source.match(
    /monaco-editor@([\d.]+)\/min\/vs/,
  );

  expect(match).not.toBeNull();

  return match![1] as string;
};

describe("Monaco runtime", () => {
  test("installs the monaco-editor build @monaco-editor/loader expects", () => {
    expect(readInstalledVersion("monaco-editor")).toBe(
      readLoaderDefaultVersion(),
    );
  });

  test("ships the files the loader asks for by path", () => {
    const monacoRoot: string = path.dirname(
      require.resolve("monaco-editor/package.json"),
    );

    /*
     * The loader builds a script tag for `${paths.vs}/loader.js` and then
     * require()s `vs/editor/editor.main`. Everything else Monaco pulls in is
     * relative to those two, so a missing one is the difference between a
     * working editor and a silent 404 on an air-gapped install.
     */
    for (const asset of ["loader.js", "editor/editor.main.js"]) {
      expect(fs.existsSync(path.join(monacoRoot, "min", "vs", asset))).toBe(
        true,
      );
    }
  });
});
