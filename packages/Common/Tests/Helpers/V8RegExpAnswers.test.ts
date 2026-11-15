import { v8Captures, v8ReadsModifierGroups, v8Tests } from "./V8RegExpAnswers";
import { describe, expect, test } from "@jest/globals";

/*
 * The helper that asks V8 about a written pattern where V8 can answer
 * (issue #8465). Each expectation holds whether or not V8 reads modifier
 * groups right in this jest process, as it must: the process is whatever
 * the suites before this one left it.
 */
describe("V8's answer about a written pattern", () => {
  test("a source with no modifier group is asked of V8, whatever answer is expected", () => {
    expect(
      v8Tests({ source: "a|b", flags: "", text: "c", expected: true }),
    ).toBe(false);
    expect(
      v8Tests({ source: "a|b", flags: "i", text: "B", expected: false }),
    ).toBe(true);
    // (?: is a group, not a modifier group: V8 is asked, and it has no i.
    expect(
      v8Tests({ source: "(?:a|b)", flags: "", text: "B", expected: true }),
    ).toBe(false);
  });

  test("captures come from V8's match for a source with no modifier group", () => {
    expect(
      v8Captures({ source: "(a)(b)?", flags: "", text: "a", expected: ["x"] }),
    ).toEqual(["a", undefined]);
    expect(
      v8Captures({ source: "(a)", flags: "", text: "b", expected: ["x"] }),
    ).toBeUndefined();
  });

  test("a source with a modifier group gets V8's answer where V8 reads one, the expected one elsewhere", () => {
    const reads: boolean = v8ReadsModifierGroups();

    // Right either way: V8 answers so when it reads modifier groups.
    expect(
      v8Tests({ source: "(?i:a|b)", flags: "", text: "B", expected: true }),
    ).toBe(true);
    expect(
      v8Tests({
        source: "x(?-i:a|b)",
        flags: "i",
        text: "XB",
        expected: false,
      }),
    ).toBe(false);
    expect(
      v8Captures({
        source: "((?i:a|b))c",
        flags: "",
        text: "Bc",
        expected: ["B"],
      }),
    ).toEqual(["B"]);
    /*
     * A wrong expectation is caught where V8 can be asked: there V8's own
     * answer, true, comes back, and elsewhere the expected one.
     */
    expect(
      v8Tests({ source: "(?i:a)", flags: "", text: "A", expected: false }),
    ).toBe(reads);
  });
});
