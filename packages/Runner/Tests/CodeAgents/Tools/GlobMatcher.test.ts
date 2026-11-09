/*
 * The glob patterns of find_files and search_files (issue #6441). The
 * pattern is the model's and the paths the repository's, so the matcher
 * builds no regular expression from them: these pin what each piece of a
 * glob means, and that a hostile pattern costs no more than the product of
 * the lengths.
 */

import GlobMatcher from "../../../CodeAgents/Tools/GlobMatcher";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

function matches(
  pattern: string,
  relativePath: string,
  ignoreCase: boolean = false,
): boolean {
  return new GlobMatcher(pattern, { ignoreCase }).matches(relativePath);
}

describe("GlobMatcher", () => {
  test.each([
    // A pattern without a "/" matches a file's name wherever it is.
    ["*.ts", "src/deep/file.ts", true],
    ["*.ts", "file.ts", true],
    ["*.ts", "src/file.tsx", false],
    ["user*", "src/models/userService.ts", true],
    ["*.test.ts", "src/a.test.ts", true],
    ["*.test.ts", "src/a.ts", false],
    // "?" is one character.
    ["file?.ts", "file1.ts", true],
    ["file?.ts", "file10.ts", false],
    // Sets, ranges and negated sets.
    ["file[12].ts", "file2.ts", true],
    ["file[12].ts", "file3.ts", false],
    ["file[a-c].ts", "fileb.ts", true],
    ["file[!a-c].ts", "fileb.ts", false],
    ["file[!a-c].ts", "filez.ts", true],
    // An unclosed "[" is the character itself.
    ["file[.ts", "file[.ts", true],
    // Braces: either, nested.
    ["*.{ts,tsx}", "src/App.tsx", true],
    ["*.{ts,tsx}", "src/App.js", false],
    ["{src,lib}/**/*.{ts,{js,mjs}}", "lib/a/b.mjs", true],
    // A pattern with a "/" matches the path from the folder searched.
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/deep/a.ts", false],
    ["src/**/*.ts", "src/a.ts", true],
    ["src/**/*.ts", "src/deep/deeper/a.ts", true],
    ["src/**/*.ts", "lib/src/a.ts", false],
    ["**/test/*.py", "a/b/test/x.py", true],
    ["**/test/*.py", "test/x.py", true],
    ["src/**", "src/a/b/c.txt", true],
    ["./src/*.ts", "src/a.ts", true],
    // A folder named like a pattern, matched by a set.
    ["app/[[]id]/*.tsx", "app/[id]/page.tsx", true],
  ])(
    "%s against %s: %s",
    (pattern: string, relativePath: string, expected: boolean) => {
      expect(matches(pattern, relativePath)).toBe(expected);
    },
  );

  test("case is matched unless it is ignored", () => {
    expect(matches("*.MD", "docs/Guide.md")).toBe(false);
    expect(matches("*.MD", "docs/Guide.md", true)).toBe(true);
    expect(matches("Docs/**/*.md", "docs/a/Guide.md", true)).toBe(true);
  });

  test("tells a glob from plain text", () => {
    expect(GlobMatcher.isGlob("**/*.ts")).toBe(true);
    expect(GlobMatcher.isGlob("file?.ts")).toBe(true);
    expect(GlobMatcher.isGlob("[ab]")).toBe(true);
    expect(GlobMatcher.isGlob("{a,b}")).toBe(true);
    expect(GlobMatcher.isGlob("src/checkout.ts")).toBe(false);
  });

  test("an empty path never matches", () => {
    expect(matches("*", "")).toBe(false);
  });

  /*
   * A backtracking regular expression built from this pattern would take
   * exponential time against this name; the two-pointer walk takes
   * milliseconds.
   */
  test("a pattern of many stars against a long name answers at once", () => {
    const pattern: string = `${"*a".repeat(40)}*b`;
    const name: string = "a".repeat(5000);

    // Each attempt builds its matchers anew: nothing is remembered between them.
    const timed: FastestRun<Array<boolean>> = fastestRun({
      run: (): Array<boolean> => {
        return [
          matches(pattern, name),
          matches(`src/${"**/".repeat(30)}x.ts`, `src/${"d/".repeat(200)}y.ts`),
        ];
      },
      limitInMs: 2000,
    });

    expect(timed.result).toEqual([false, false]);
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("braces that would write out a huge number of patterns are held to a few", () => {
    const pattern: string =
      "{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}{a,b}";

    const timed: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        return matches(pattern, "aaaaaa");
      },
      limitInMs: 2000,
    });

    expect(timed.result).toBe(false);
    expect(timed.inMs).toBeLessThan(2000);
  });
});
