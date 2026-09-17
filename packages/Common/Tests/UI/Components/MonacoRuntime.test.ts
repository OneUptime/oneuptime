import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The build copies monaco-editor's min/vs next to each frontend bundle and
 * MonacoLoader points @monaco-editor/loader at it, so the version we install is
 * the version that actually runs in the browser.
 *
 * The loader resolves init() with whatever the AMD module `vs/editor/editor.main`
 * exports, and that shape is not stable across Monaco releases. 0.53 and 0.54
 * nest the API under `exports.m`; against a loader that does not unwrap that,
 * `monaco.editor` comes back undefined and every editor throws
 * "Cannot read properties of undefined (reading 'getModel')" instead of
 * mounting - with the assets all serving 200, so nothing else looks wrong.
 *
 * @monaco-editor/loader learned to unwrap it in 1.7.0. These tests fail if the
 * two are ever moved into a combination that cannot work.
 */

// [from, to) - the Monaco releases whose AMD module nests the API under `exports.m`.
const NESTED_API_RANGE: { from: string; to: string } = {
  from: "0.53.0",
  to: "0.55.0",
};

// The first @monaco-editor/loader that unwraps `exports.m`.
const LOADER_UNWRAPS_FROM: string = "1.7.0";

type ReadVersion = (packageName: string) => string;

const readVersion: ReadVersion = (packageName: string): string => {
  return JSON.parse(
    fs.readFileSync(require.resolve(`${packageName}/package.json`), "utf8"),
  ).version;
};

type Compare = (a: string, b: string) => number;

const compare: Compare = (a: string, b: string): number => {
  const left: Array<number> = a.split(".").map(Number);
  const right: Array<number> = b.split(".").map(Number);

  for (let i: number = 0; i < 3; i++) {
    const difference: number = (left[i] || 0) - (right[i] || 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
};

describe("Monaco runtime", () => {
  test("does not pair a nested-API Monaco with a loader that cannot unwrap it", () => {
    const monacoVersion: string = readVersion("monaco-editor");
    const loaderVersion: string = readVersion("@monaco-editor/loader");

    const nestsApi: boolean =
      compare(monacoVersion, NESTED_API_RANGE.from) >= 0 &&
      compare(monacoVersion, NESTED_API_RANGE.to) < 0;

    if (!nestsApi) {
      return;
    }

    expect({
      monacoVersion,
      loaderVersion,
      unwrapsNestedApi: compare(loaderVersion, LOADER_UNWRAPS_FROM) >= 0,
    }).toEqual({
      monacoVersion,
      loaderVersion,
      unwrapsNestedApi: true,
    });
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

  test("does not bring a second copy of anything Common already depends on", () => {
    /*
     * Monaco releases from 0.55 on depend on marked and dompurify, both of which
     * Common already pins at the top level. npm nests Monaco's own copies
     * because it pins them exactly, so the top-level pin does not reach them and
     * the tree ends up carrying two versions - the older one being whatever
     * Monaco vendored at release time.
     */
    const monacoDependencies: Array<string> = Object.keys(
      JSON.parse(
        fs.readFileSync(require.resolve("monaco-editor/package.json"), "utf8"),
      ).dependencies || {},
    );

    const commonDependencies: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../../package.json"), "utf8"),
    ).dependencies;

    expect(
      monacoDependencies.filter((name: string) => {
        return Boolean(commonDependencies[name]);
      }),
    ).toEqual([]);
  });
});
