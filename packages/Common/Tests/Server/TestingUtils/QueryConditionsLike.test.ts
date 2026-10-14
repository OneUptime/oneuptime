/*
 * The text searches, as TestingUtils/QueryConditions answers them for a
 * suite that stubs a service's findBy over rows it keeps: "contains"
 * (QueryHelper.search) and "every word, anywhere" (QueryHelper.searchAllWords).
 *
 * The helper stands in for Postgres, so it has to read a pattern the way
 * ILIKE does - or a suite built on it would pass a search the database
 * answers differently.
 */

import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import {
  isQueryCondition,
  matchesLikePattern,
  meetsCondition,
} from "./QueryConditions";
import { describe, expect, test } from "@jest/globals";

describe("an ILIKE pattern", () => {
  test("% is any run of characters, none included, and case does not count", () => {
    expect(matchesLikePattern("%data%", "Database is down")).toBe(true);
    expect(matchesLikePattern("%DOWN%", "Database is down")).toBe(true);
    expect(matchesLikePattern("%down", "Database is down")).toBe(true);
    expect(matchesLikePattern("data%", "Database is down")).toBe(true);
    expect(matchesLikePattern("%up%", "Database is down")).toBe(false);
    // Without a %, the whole value has to be the pattern.
    expect(matchesLikePattern("data", "Database")).toBe(false);
    expect(matchesLikePattern("database", "Database")).toBe(true);
  });

  test("_ is any one character, and exactly one", () => {
    expect(matchesLikePattern("%db_1%", "on db-1 today")).toBe(true);
    expect(matchesLikePattern("%db_1%", "on db_1 today")).toBe(true);
    expect(matchesLikePattern("%db_1%", "on db1 today")).toBe(false);
    expect(matchesLikePattern("%db_1%", "on db--1 today")).toBe(false);
  });

  test("a backslash makes the %, _ or backslash after it itself", () => {
    expect(matchesLikePattern("%100\\%%", "CPU at 100% again")).toBe(true);
    expect(matchesLikePattern("%100\\%%", "CPU at 1000 again")).toBe(false);
    expect(matchesLikePattern("%db\\_1%", "on db_1")).toBe(true);
    expect(matchesLikePattern("%db\\_1%", "on db-1")).toBe(false);
    expect(matchesLikePattern("%C:\\\\temp%", "in C:\\temp now")).toBe(true);
  });

  test("everything else is itself, whatever a regular expression would make of it", () => {
    expect(matchesLikePattern("%a.c%", "abc")).toBe(false);
    expect(matchesLikePattern("%a.c%", "a.c")).toBe(true);
    expect(matchesLikePattern("%(x[1]+y)*%", "f(x[1]+y)*2")).toBe(true);
    expect(matchesLikePattern("%^$|?{}%", "is ^$|?{} odd")).toBe(true);
  });

  test("a value of several lines is searched whole", () => {
    expect(matchesLikePattern("%second%", "first\nsecond\nthird")).toBe(true);
  });
});

describe("the two text searches", () => {
  test("every word, anywhere: each has to be there, in any order, read as typed", () => {
    const words: unknown = QueryHelper.searchAllWords(["database", "down"]);

    expect(isQueryCondition(words)).toBe(true);
    expect(meetsCondition(words, "Database is down")).toBe(true);
    expect(meetsCondition(words, "Down again: the database")).toBe(true);
    expect(meetsCondition(words, "Database replica lag")).toBe(false);

    // What was typed is escaped, so it means itself.
    expect(
      meetsCondition(QueryHelper.searchAllWords(["100%"]), "at 1000"),
    ).toBe(false);
    expect(
      meetsCondition(QueryHelper.searchAllWords(["100%"]), "at 100%"),
    ).toBe(true);
  });

  test("no words at all matches nothing", () => {
    expect(meetsCondition(QueryHelper.searchAllWords([]), "anything")).toBe(
      false,
    );
    expect(meetsCondition(QueryHelper.searchAllWords(["  "]), "anything")).toBe(
      false,
    );
  });

  test("contains: one run of characters, with % and _ left as the wildcards they are", () => {
    const contains: unknown = QueryHelper.search("Data");

    expect(meetsCondition(contains, "the database")).toBe(true);
    expect(meetsCondition(contains, "the cache")).toBe(false);
    // QueryHelper.search does not escape: a % typed there is still "anything".
    expect(meetsCondition(QueryHelper.search("100%"), "at 1000")).toBe(true);
  });

  test("a plain value is no condition", () => {
    expect(isQueryCondition("database")).toBe(false);
    expect(isQueryCondition(8)).toBe(false);
    expect(isQueryCondition(undefined)).toBe(false);
  });
});
