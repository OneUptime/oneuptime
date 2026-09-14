import { describe, expect, test } from "@jest/globals";
import { matchesSearch } from "./search";

describe("Response inbox search", () => {
  test("a query can combine case-insensitive title, project and reference terms", () => {
    expect(
      matchesSearch("  CHECKOUT production #42 ", [
        "Checkout latency",
        "Acme Production",
        "#42",
      ]),
    ).toBe(true);
    expect(
      matchesSearch("checkout staging", [
        "Checkout latency",
        "Acme Production",
      ]),
    ).toBe(false);
  });

  test("IDs and numeric references are searchable without optional metadata", () => {
    expect(matchesSearch("42", [undefined, null, 42])).toBe(true);
    expect(matchesSearch("monitor-9", ["monitor-9", undefined])).toBe(true);
    expect(matchesSearch("missing", [undefined, null])).toBe(false);
  });

  test("empty and whitespace-only searches show every item", () => {
    expect(matchesSearch("", [])).toBe(true);
    expect(matchesSearch("   ", ["Any title"])).toBe(true);
  });

  test("search treats punctuation as text and never interprets a regular expression", () => {
    expect(matchesSearch("[api]", ["[api] unavailable"])).toBe(true);
    expect(matchesSearch(".*", ["Everything is fine"])).toBe(false);
  });
});
