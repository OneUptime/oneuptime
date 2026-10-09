import {
  getEditDistance,
  getMaxTypoDistance,
  getWordVariants,
  isSameWord,
  matchWordWithTypo,
} from "../../Utils/WordMatch";
import { describe, expect, test } from "@jest/globals";

/*
 * Utils/WordMatch at its edges: every variant a word yields, the edit
 * distance on empty and equal words and at its cut-off, and where a typo
 * stops being forgiven. WordMatch.test.ts pins the everyday words.
 */

describe("getWordVariants, every variant", () => {
  test("a word ending in -ies yields -y, -i and -ie forms", () => {
    expect(getWordVariants("policies")).toEqual([
      "policies",
      "policy",
      "polici",
      "policie",
    ]);
  });

  test("a word ending in -es yields the word without -es and without -s", () => {
    expect(getWordVariants("statuses")).toEqual([
      "statuses",
      "status",
      "statuse",
    ]);
    expect(getWordVariants("boxes")).toEqual(["boxes", "box", "boxe"]);
  });

  test("a word ending in -sses drops -es but keeps its double s", () => {
    expect(getWordVariants("classes")).toEqual(["classes", "class", "classe"]);
  });

  test("a plain -s plural yields only the singular", () => {
    expect(getWordVariants("keys")).toEqual(["keys", "key"]);
    expect(getWordVariants("abcs")).toEqual(["abcs", "abc"]);
  });

  test("the word itself always comes first", () => {
    for (const word of ["dies", "monitors", "policy", "a", ""]) {
      expect(getWordVariants(word)[0]).toBe(word);
    }
  });

  test("words of three letters or fewer are never cut", () => {
    expect(getWordVariants("ies")).toEqual(["ies"]);
    expect(getWordVariants("yes")).toEqual(["yes"]);
    expect(getWordVariants("is")).toEqual(["is"]);
    expect(getWordVariants("")).toEqual([""]);
  });

  test("a four-letter -ies word is cut every way", () => {
    expect(getWordVariants("dies")).toEqual(["dies", "dy", "di", "die"]);
  });

  test("a word not ending in s has no other variant", () => {
    expect(getWordVariants("incident")).toEqual(["incident"]);
    expect(getWordVariants("policy")).toEqual(["policy"]);
  });

  test("variants are listed once each", () => {
    for (const word of ["policies", "statuses", "classes", "keys", "dies"]) {
      const variants: Array<string> = getWordVariants(word);

      expect(new Set(variants).size).toBe(variants.length);
    }
  });
});

describe("isSameWord, edge cases", () => {
  test("a word is the same as itself, however short", () => {
    expect(isSameWord("", "")).toBe(true);
    expect(isSameWord("a", "a")).toBe(true);
    expect(isSameWord("ss", "ss")).toBe(true);
  });

  test("an -es plural matches its singular", () => {
    expect(isSameWord("boxes", "box")).toBe(true);
    expect(isSameWord("classes", "class")).toBe(true);
  });

  test("two plurals of one singular match each other", () => {
    expect(isSameWord("policies", "policys")).toBe(true);
  });

  test("is case sensitive: callers lower-case first", () => {
    expect(isSameWord("Keys", "key")).toBe(false);
    expect(isSameWord("KEY", "key")).toBe(false);
  });

  test("an empty word matches no other word", () => {
    expect(isSameWord("", "a")).toBe(false);
    expect(isSameWord("keys", "")).toBe(false);
  });
});

describe("getEditDistance, edge cases", () => {
  test("equal words are zero edits apart", () => {
    expect(getEditDistance("", "", 0)).toBe(0);
    expect(getEditDistance("monitor", "monitor", 0)).toBe(0);
    expect(getEditDistance("monitor", "monitor", 2)).toBe(0);
  });

  test("from nothing, every letter is an insertion", () => {
    expect(getEditDistance("", "ab", 2)).toBe(2);
    expect(getEditDistance("ab", "", 2)).toBe(2);
  });

  test("a length difference beyond the limit stops at once", () => {
    expect(getEditDistance("", "abc", 2)).toBe(3);
    expect(getEditDistance("abcdef", "a", 1)).toBe(2);
  });

  test("counts one insertion, deletion or replacement as one edit", () => {
    expect(getEditDistance("abd", "abcd", 2)).toBe(1);
    expect(getEditDistance("abcd", "abd", 2)).toBe(1);
    expect(getEditDistance("abc", "abd", 2)).toBe(1);
  });

  test("a swap of two neighbouring letters is one edit", () => {
    expect(getEditDistance("ab", "ba", 1)).toBe(1);
    expect(getEditDistance("abc", "acb", 1)).toBe(1);
  });

  test("the classic kitten to sitting is three edits", () => {
    expect(getEditDistance("kitten", "sitting", 3)).toBe(3);
    expect(getEditDistance("sitting", "kitten", 3)).toBe(3);
  });

  test("is the same in both directions", () => {
    const pairs: Array<[string, string]> = [
      ["incident", "incidnet"],
      ["schedule", "shcedule"],
      ["monitor", "monitors"],
      ["alert", "alrt"],
    ];

    for (const [a, b] of pairs) {
      expect(getEditDistance(a, b, 3)).toBe(getEditDistance(b, a, 3));
    }
  });

  test("a swap is not edited again after it: ca to abc is three, not two", () => {
    /*
     * The optimal-string-alignment form: a swapped pair is not then edited
     * further, so "ca" -> "ac" -> "abc" does not count as two edits.
     */
    expect(getEditDistance("ca", "abc", 3)).toBe(3);
  });

  test("with a limit of zero any difference is one past it", () => {
    expect(getEditDistance("abc", "abd", 0)).toBe(1);
    expect(getEditDistance("abc", "xyz", 0)).toBe(1);
  });

  test("never reports more than one past the limit", () => {
    expect(getEditDistance("abcdefgh", "zyxwvuts", 2)).toBe(3);
    expect(getEditDistance("aaaa", "bbbb", 1)).toBe(2);
  });
});

describe("getMaxTypoDistance, edge cases", () => {
  test("follows the word's length", () => {
    expect(getMaxTypoDistance("")).toBe(0);
    expect(getMaxTypoDistance("abc")).toBe(0);
    expect(getMaxTypoDistance("abcd")).toBe(1);
    expect(getMaxTypoDistance("abcdefg")).toBe(1);
    expect(getMaxTypoDistance("abcdefgh")).toBe(2);
    expect(getMaxTypoDistance("a".repeat(40))).toBe(2);
  });
});

describe("matchWordWithTypo, edge cases", () => {
  test("a short token is never matched as a typo, even of itself", () => {
    // Exact matches are the caller's job; this only forgives typos.
    expect(matchWordWithTypo("log", "log")).toBe(false);
    expect(matchWordWithTypo("", "")).toBe(false);
  });

  test("a long enough token matches itself", () => {
    expect(matchWordWithTypo("slack", "slack")).toBe(true);
  });

  test("a missing letter in a four-letter token is forgiven", () => {
    expect(matchWordWithTypo("slak", "slack")).toBe(true);
  });

  test("a typo in the start of a longer word is forgiven", () => {
    expect(matchWordWithTypo("monti", "monitoring")).toBe(true);
    expect(matchWordWithTypo("monit", "monitoring")).toBe(true);
  });

  test("a token longer than the word may still be a typo of it", () => {
    expect(matchWordWithTypo("incidents", "incident")).toBe(true);
  });

  test("an eight-letter token is forgiven two typos, not three", () => {
    expect(matchWordWithTypo("abcdefxy", "abcdefgh")).toBe(true);
    expect(matchWordWithTypo("abcdewxy", "abcdefgh")).toBe(false);
  });

  test("a seven-letter token is forgiven one typo, not two", () => {
    expect(matchWordWithTypo("monitxr", "monitor")).toBe(true);
    expect(matchWordWithTypo("monixxr", "monitor")).toBe(false);
  });

  test("an unrelated word of similar length is not a typo", () => {
    expect(matchWordWithTypo("alert", "event")).toBe(false);
    expect(matchWordWithTypo("team", "user")).toBe(false);
  });
});
