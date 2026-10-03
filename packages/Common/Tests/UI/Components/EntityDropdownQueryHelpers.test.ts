import {
  canPickByLabel,
  ENTITY_DROPDOWN_SEARCH_KEY,
  withLabels,
  withSearch,
} from "../../../UI/Components/EntityDropdown/EntityDropdownQuery";
import Search from "../../../Types/BaseDatabase/Search";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAnyOfGroups from "../../../Types/BaseDatabase/IncludesAnyOfGroups";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import { describe, expect, test } from "@jest/globals";

/*
 * The queries an entity dropdown sends for its options: the caller's query,
 * narrowed by what the reader asked for, never with a condition of the
 * caller's replaced.
 */

describe("withSearch", () => {
  test("no text: the caller's query, as it is", () => {
    const query: Record<string, unknown> = { isVerified: true };

    expect(withSearch(query, "domain", "  ")).toEqual({ isVerified: true });
    // A copy: the caller's object is never changed.
    expect(withSearch(query, "domain", "x")).not.toBe(query);
    expect(query).toEqual({ isVerified: true });
  });

  test("text, and no condition of the caller's on the label field: a Search on it, as before", () => {
    const query: Record<string, unknown> = withSearch(
      { isVerified: true },
      "domain",
      "  acme ",
    );

    expect(query["isVerified"]).toBe(true);
    expect(query["domain"]).toBeInstanceOf(Search);
    expect((query["domain"] as Search<string>).toString()).toBe("acme");
    expect(query[ENTITY_DROPDOWN_SEARCH_KEY]).toBeUndefined();
  });

  test("text, and a condition of the caller's on the label field: both, the text as a MultiSearch over that field", () => {
    const callers: EndsWith<string> = new EndsWith(".com");

    const query: Record<string, unknown> = withSearch(
      { domain: callers },
      "domain",
      "acme",
    );

    expect(query["domain"]).toBe(callers);
    expect(query[ENTITY_DROPDOWN_SEARCH_KEY]).toEqual(
      new MultiSearch({ fields: ["domain"], value: "acme" }),
    );
  });

  test("a caller that uses the search key itself keeps it too", () => {
    const query: Record<string, unknown> = withSearch(
      {
        domain: new EndsWith(".com"),
        [ENTITY_DROPDOWN_SEARCH_KEY]: "the caller's",
      },
      "domain",
      "acme",
    );

    expect(query[ENTITY_DROPDOWN_SEARCH_KEY]).toBe("the caller's");
    expect(query[`_${ENTITY_DROPDOWN_SEARCH_KEY}`]).toBeInstanceOf(
      MultiSearch,
    );
  });
});

describe("withLabels", () => {
  test("no condition of the caller's on labels: entries with any of the labels, as before", () => {
    const query: Record<string, unknown> | null = withLabels(
      { disableActiveMonitoring: false },
      ["a", "b"],
    );

    expect(query?.["disableActiveMonitoring"]).toBe(false);
    expect(query?.["labels"]).toEqual(new Includes(["a", "b"]));
  });

  test("the caller's Includes stays: a label from it, and one of the picked ones", () => {
    const query: Record<string, unknown> | null = withLabels(
      { labels: new Includes(["x"]) },
      ["a", "b"],
    );

    expect((query?.["labels"] as IncludesAnyOfGroups).groups).toEqual([
      ["x"],
      ["a", "b"],
    ]);
  });

  test("the caller's groups stay, and the picked labels are one more", () => {
    const query: Record<string, unknown> | null = withLabels(
      { labels: new IncludesAnyOfGroups([["x"], ["y", "z"]]) },
      ["a"],
    );

    expect((query?.["labels"] as IncludesAnyOfGroups).groups).toEqual([
      ["x"],
      ["y", "z"],
      ["a"],
    ]);
  });

  test("a condition a label pick cannot be added to gives no query at all", () => {
    expect(withLabels({ labels: new NotNull() }, ["a"])).toBeNull();
    expect(withLabels({ labels: new IncludesNone(["x"]) }, ["a"])).toBeNull();
  });
});

describe("canPickByLabel", () => {
  test("without a condition on labels, or with one a pick can be added to", () => {
    expect(canPickByLabel({})).toBe(true);
    expect(canPickByLabel({ labels: null })).toBe(true);
    expect(canPickByLabel({ labels: new Includes(["x"]) })).toBe(true);
    expect(
      canPickByLabel({ labels: new IncludesAnyOfGroups([["x"]]) }),
    ).toBe(true);
  });

  test("not with another kind of condition on labels", () => {
    expect(canPickByLabel({ labels: new NotNull() })).toBe(false);
    expect(canPickByLabel({ labels: new IncludesNone(["x"]) })).toBe(false);
  });
});
