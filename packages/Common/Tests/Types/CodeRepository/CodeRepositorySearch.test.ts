import {
  MAX_CODE_REPOSITORY_SEARCH_LENGTH,
  getCodeRepositoryFullName,
  matchesCodeRepositorySearch,
  readCodeRepositorySearch,
} from "../../../Types/CodeRepository/CodeRepositorySearch";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW A SEARCH FINDS ONE OF A PROJECT'S REPOSITORIES (#10764): its name,
 * its "organization/name" on its host, or its description holding what was
 * typed, case aside. The server answers Code's Repositories page and its
 * pickers by this rule, from every repository the reader may read; the
 * pages read the same rule, so a list never finds what the server would
 * not.
 */

const CHECKOUT: {
  name: string;
  organizationName: string;
  repositoryName: string;
  description: string;
} = {
  name: "Checkout API",
  organizationName: "acme",
  repositoryName: "checkout-api-service",
  description: "Takes payments for the storefront.",
};

describe("matchesCodeRepositorySearch", () => {
  test("by its name, case aside", () => {
    expect(matchesCodeRepositorySearch(CHECKOUT, "checkout")).toBe(true);
    expect(matchesCodeRepositorySearch(CHECKOUT, "CHECKOUT api")).toBe(true);
  });

  test("by its organization/name, across the slash", () => {
    expect(matchesCodeRepositorySearch(CHECKOUT, "acme/checkout")).toBe(true);
    expect(matchesCodeRepositorySearch(CHECKOUT, "me/check")).toBe(true);
    expect(matchesCodeRepositorySearch(CHECKOUT, "api-service")).toBe(true);
    expect(matchesCodeRepositorySearch(CHECKOUT, "acme/billing")).toBe(false);
  });

  test("by its description", () => {
    expect(matchesCodeRepositorySearch(CHECKOUT, "payments")).toBe(true);
  });

  test("nothing typed finds every repository; something it holds nowhere finds none", () => {
    expect(matchesCodeRepositorySearch(CHECKOUT, "")).toBe(true);
    expect(matchesCodeRepositorySearch(CHECKOUT, "   ")).toBe(true);
    expect(matchesCodeRepositorySearch(CHECKOUT, "warehouse")).toBe(false);
  });

  test("a repository missing a part is searched by the parts it has", () => {
    expect(matchesCodeRepositorySearch({ name: "web" }, "web")).toBe(true);
    expect(
      matchesCodeRepositorySearch(
        { name: "web", organizationName: "acme" },
        "acme/",
      ),
    ).toBe(false);
    expect(matchesCodeRepositorySearch({}, "web")).toBe(false);
  });
});

describe("getCodeRepositoryFullName", () => {
  test("organization/name, or nothing while either half is not known", () => {
    expect(getCodeRepositoryFullName(CHECKOUT)).toBe(
      "acme/checkout-api-service",
    );
    expect(getCodeRepositoryFullName({ organizationName: "acme" })).toBe("");
    expect(getCodeRepositoryFullName({ repositoryName: "web" })).toBe("");
  });
});

describe("readCodeRepositorySearch", () => {
  test("trimmed, cut to its longest, and nothing for what is not text", () => {
    expect(readCodeRepositorySearch("  acme/web  ")).toBe("acme/web");
    expect(readCodeRepositorySearch(42)).toBe("");
    expect(readCodeRepositorySearch(null)).toBe("");
    expect(readCodeRepositorySearch(undefined)).toBe("");
    expect(
      readCodeRepositorySearch("a".repeat(MAX_CODE_REPOSITORY_SEARCH_LENGTH + 50))
        .length,
    ).toBe(MAX_CODE_REPOSITORY_SEARCH_LENGTH);
  });
});
