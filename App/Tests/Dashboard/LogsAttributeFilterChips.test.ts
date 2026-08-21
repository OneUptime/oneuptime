import { describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import EndsWith from "Common/Types/BaseDatabase/EndsWith";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Search from "Common/Types/BaseDatabase/Search";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import { DictionaryEntryValue } from "Common/UI/Components/Dictionary/DictionaryFilterOperator";
import { ActiveFilter } from "Common/UI/Components/LogsViewer/types";
import { buildAttributeFilterChips } from "../../FeatureSet/Dashboard/src/Components/Logs/LogsAttributeFilterChips";

/*
 * The chips the logs viewer pins for `logQuery.attributes`. The log monitor's
 * criteria form writes those attributes, and everything except the implicit
 * `=` operator is stored as an operator object — so this is the seam where a
 * filter stops being a query value and becomes text on screen. Getting it
 * wrong is what threw "Objects are not valid as a React child (found: object
 * with keys {_values})" inside the Edit Monitor modal.
 */

function chipsFor(
  attributes: Dictionary<DictionaryEntryValue>,
): Array<ActiveFilter> {
  return buildAttributeFilterChips(attributes);
}

function onlyChip(attributes: Dictionary<DictionaryEntryValue>): ActiveFilter {
  const chips: Array<ActiveFilter> = chipsFor(attributes);

  expect(chips).toHaveLength(1);

  return chips[0]!;
}

describe("buildAttributeFilterChips", () => {
  test("no attributes means no chips", () => {
    expect(buildAttributeFilterChips(undefined)).toEqual([]);
    expect(buildAttributeFilterChips({})).toEqual([]);
  });

  test("a plain equality filter reads as key: value", () => {
    const chip: ActiveFilter = onlyChip({ logtype: "web" });

    expect(chip).toEqual({
      facetKey: "attributes.logtype",
      value: "web",
      displayKey: "logtype",
      displayValue: "web",
      readOnly: true,
    });
  });

  test("the operator filter from the bug report becomes text", () => {
    const chip: ActiveFilter = onlyChip({ logtype: new Includes(["web"]) });

    expect(chip.displayValue).toBe("is any of web");
    expect(typeof chip.displayValue).toBe("string");
    expect(typeof chip.value).toBe("string");
  });

  test.each([
    ["is none of web, api", new IncludesNone(["web", "api"])],
    ["contains web", new Search<string>("web")],
    ["starts with web", new StartsWith<string>("web")],
    ["ends with web", new EndsWith<string>("web")],
    ["does not equal web", new NotEqual<string>("web")],
    ["greater than 5", new GreaterThan<number>(5)],
    ["is empty", new IsNull()],
    ["is not empty", new NotNull()],
  ])("renders %p", (expected: string, value: DictionaryEntryValue) => {
    expect(onlyChip({ logtype: value }).displayValue).toBe(expected);
  });

  test("every chip carries a string value, whatever the operator", () => {
    /*
     * `ActiveFilter.value` is not only shown — it is the React key and the
     * argument the remove handler is called with. An object there is a broken
     * key and a broken removal, on top of the render throw.
     */
    const chips: Array<ActiveFilter> = chipsFor({
      a: "plain",
      b: new Includes(["web"]),
      c: new Search<string>("api"),
      d: new IsNull(),
      e: 42,
      f: true,
    });

    expect(chips).toHaveLength(6);

    for (const chip of chips) {
      expect(typeof chip.value).toBe("string");
      expect(typeof chip.displayValue).toBe("string");
      expect(chip.displayValue).not.toContain("[object Object]");
    }
  });

  test("values read back from a saved monitor render too", () => {
    /*
     * A saved monitor comes back as the `{_type, value}` JSON shape rather
     * than a hydrated instance, so opening an existing monitor takes this
     * path — which is how someone hits the crash without touching the
     * dropdown at all.
     */
    const chip: ActiveFilter = onlyChip({
      logtype: { _type: "Includes", value: ["web", "api"] } as never,
    });

    expect(chip.displayValue).toBe("is any of web, api");
  });

  test("known resource keys get their friendly label", () => {
    expect(
      onlyChip({ "resource.k8s.cluster.name": "eks-non-prod" }).displayKey,
    ).toBe("Cluster");
    expect(onlyChip({ "resource.k8s.pod.name": "api-0" }).displayKey).toBe(
      "Pod",
    );
  });

  test("an unknown key keeps its own name", () => {
    expect(onlyChip({ "http.method": "GET" }).displayKey).toBe("http.method");
  });

  test("chips are always facet-scoped under attributes.", () => {
    const chips: Array<ActiveFilter> = chipsFor({
      logtype: new Search<string>("web"),
      "resource.k8s.pod.name": "api-0",
    });

    expect(
      chips.map((chip: ActiveFilter) => {
        return chip.facetKey;
      }),
    ).toEqual(["attributes.logtype", "attributes.resource.k8s.pod.name"]);
  });

  test("every chip is read-only — these come from the host page, not the user", () => {
    for (const chip of chipsFor({ a: "x", b: new Includes(["y"]) })) {
      expect(chip.readOnly).toBe(true);
    }
  });
});
