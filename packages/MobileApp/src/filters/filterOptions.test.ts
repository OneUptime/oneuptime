import { describe, expect, test } from "@jest/globals";
import {
  getSelectedNames,
  getVisibleOptions,
  type FilterOption,
  type VisibleOptions,
} from "./filterOptions";

/*
 * Which values a section of the filter sheet shows. A picked value must
 * never vanish from under the reader's finger, a long list must stay short
 * and searchable, and the project's own order (severities most severe
 * first) is kept.
 */

function option(id: string, label: string, detail?: string): FilterOption {
  return { id: id, label: label, detail: detail };
}

function many(count: number): Array<FilterOption> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return option(`id-${index}`, `Label ${index}`);
  });
}

describe("getVisibleOptions", () => {
  test("a short section shows every value, in order, with no search", () => {
    const options: Array<FilterOption> = [
      option("critical", "Critical"),
      option("major", "Major"),
      option("minor", "Minor"),
    ];
    const visible: VisibleOptions = getVisibleOptions(options, [], "");
    expect(
      visible.options.map((value: FilterOption) => {
        return value.id;
      }),
    ).toEqual(["critical", "major", "minor"]);
    expect(visible.searchable).toBe(false);
    expect(visible.hiddenCount).toBe(0);
  });

  test("picked values come first", () => {
    const options: Array<FilterOption> = [
      option("critical", "Critical"),
      option("major", "Major"),
      option("minor", "Minor"),
    ];
    const visible: VisibleOptions = getVisibleOptions(options, ["minor"], "");
    expect(
      visible.options.map((value: FilterOption) => {
        return value.id;
      }),
    ).toEqual(["minor", "critical", "major"]);
  });

  test("a long section is cut at the limit, says how many more, and can be searched", () => {
    const visible: VisibleOptions = getVisibleOptions(many(40), [], "", 16);
    expect(visible.options).toHaveLength(16);
    expect(visible.hiddenCount).toBe(24);
    expect(visible.searchable).toBe(true);
  });

  test("search narrows a long section by label or detail", () => {
    const options: Array<FilterOption> = [
      ...many(20),
      option("u-1", "Priya Shah", "priya@example.test"),
      option("u-2", "Jordan Lee", "jordan@example.test"),
    ];
    expect(
      getVisibleOptions(options, [], "priya", 16).options.map(
        (value: FilterOption) => {
          return value.id;
        },
      ),
    ).toEqual(["u-1"]);
    expect(
      getVisibleOptions(options, [], "jordan@", 16).options.map(
        (value: FilterOption) => {
          return value.id;
        },
      ),
    ).toEqual(["u-2"]);
  });

  test("a picked value stays while a search hides the rest", () => {
    const options: Array<FilterOption> = [
      ...many(20),
      option("u-1", "Priya Shah"),
    ];
    const visible: VisibleOptions = getVisibleOptions(
      options,
      ["id-3"],
      "priya",
      16,
    );
    expect(
      visible.options.map((value: FilterOption) => {
        return value.id;
      }),
    ).toEqual(["id-3", "u-1"]);
  });

  test("picked values take their room from the limit, and are never cut", () => {
    const picked: Array<string> = ["id-0", "id-1", "id-2"];
    const visible: VisibleOptions = getVisibleOptions(many(40), picked, "", 5);
    expect(
      visible.options.map((value: FilterOption) => {
        return value.id;
      }),
    ).toEqual(["id-0", "id-1", "id-2", "id-3", "id-4"]);
    expect(visible.hiddenCount).toBe(35);
  });

  test("a search in a short section is ignored: it has no search box", () => {
    const options: Array<FilterOption> = [option("a", "Alpha")];
    expect(getVisibleOptions(options, [], "zzz").options).toHaveLength(1);
  });
});

describe("getSelectedNames", () => {
  test("names in the project's order, unknown ids left out", () => {
    const options: Array<FilterOption> = [
      option("critical", "Critical"),
      option("major", "Major"),
    ];
    expect(getSelectedNames(options, ["major", "critical", "gone"])).toEqual([
      "Critical",
      "Major",
    ]);
  });
});
