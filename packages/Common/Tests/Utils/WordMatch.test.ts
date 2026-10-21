import {
  getEditDistance,
  getMaxTypoDistance,
  getWordVariants,
  isSameWord,
  matchWordWithTypo,
  MIN_TYPO_WORD_LENGTH,
} from "../../Utils/WordMatch";
import * as ComponentSearch from "../../UI/Components/Workflow/ComponentPicker/ComponentSearch";
import { describe, expect, test } from "@jest/globals";

/*
 * Utils/WordMatch: how one typed word matches one word of a name, shared by
 * Search (Cmd/Ctrl+K) and the workflow step pickers. Their own tests pin it
 * through what they find; these pin the words themselves.
 */

describe("getWordVariants", () => {
  test.each([
    ["keys", "key"],
    ["policies", "policy"],
    ["statuses", "status"],
    ["searches", "search"],
    ["incidents", "incident"],
    ["schedules", "schedule"],
  ])("%s may be the plural of %s", (word: string, singular: string) => {
    expect(getWordVariants(word)).toContain(singular);
  });

  test("a short word, or one ending in a double s, is left as it is", () => {
    expect(getWordVariants("bus")).toEqual(["bus"]);
    expect(getWordVariants("sso")).toEqual(["sso"]);
    expect(getWordVariants("access")).toEqual(["access"]);
  });
});

describe("isSameWord", () => {
  test.each([
    ["keys", "key"],
    ["key", "keys"],
    ["policies", "policy"],
    ["statuses", "status"],
    ["runs", "run"],
    ["monitors", "monitor"],
    ["incident", "incident"],
  ])("%s and %s are one word", (a: string, b: string) => {
    expect(isSameWord(a, b)).toBe(true);
    expect(isSameWord(b, a)).toBe(true);
  });

  test.each([
    // Compared whole, never by how they start.
    ["runs", "runners"],
    ["run", "runbooks"],
    ["alert", "alerting"],
    ["rule", "roles"],
    ["access", "acces"],
  ])("%s and %s are two words", (a: string, b: string) => {
    expect(isSameWord(a, b)).toBe(false);
    expect(isSameWord(b, a)).toBe(false);
  });

  test("variants worked out by the caller are used as given", () => {
    expect(isSameWord("keys", "key", ["keys", "key"], ["key"])).toBe(true);
    // Without "key" among them, "keys" is not "key".
    expect(isSameWord("keys", "key", ["keys"], ["key"])).toBe(false);
  });
});

describe("typos", () => {
  test("two letters swapped side by side are one edit", () => {
    expect(getEditDistance("incidnet", "incident", 2)).toBe(1);
    expect(getEditDistance("slakc", "slack", 1)).toBe(1);
  });

  test("the distance stops one past the most it may be", () => {
    expect(getEditDistance("abcd", "wxyz", 1)).toBe(2);
    expect(getEditDistance("a", "abcdef", 2)).toBe(3);
  });

  test("longer words may carry more typos; short ones none", () => {
    expect(MIN_TYPO_WORD_LENGTH).toBe(4);
    expect(getMaxTypoDistance("log")).toBe(0);
    expect(getMaxTypoDistance("slak")).toBe(1);
    expect(getMaxTypoDistance("monitr")).toBe(1);
    expect(getMaxTypoDistance("incidnet")).toBe(2);
  });

  test("a typo of the whole word, or of what has been typed of it", () => {
    expect(matchWordWithTypo("incidnet", "incident")).toBe(true);
    expect(matchWordWithTypo("incidne", "incidents")).toBe(true);
    expect(matchWordWithTypo("log", "lag")).toBe(false);
    expect(matchWordWithTypo("schedule", "monitor")).toBe(false);
  });
});

describe("one implementation for every search", () => {
  test("the workflow step pickers use these very functions", () => {
    expect(ComponentSearch.getWordVariants).toBe(getWordVariants);
    expect(ComponentSearch.getEditDistance).toBe(getEditDistance);
    expect(ComponentSearch.getMaxTypoDistance).toBe(getMaxTypoDistance);
    expect(ComponentSearch.matchWordWithTypo).toBe(matchWordWithTypo);
  });
});
