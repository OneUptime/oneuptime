import {
  AFFECTED_RESOURCES_EXPORT_SEPARATOR,
  AFFECTED_RESOURCE_LIST_ORDER,
  AffectedResourceLists,
  getAffectedResourceNames,
  getAffectedResourcesExportValue,
} from "../../FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourceNames";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AffectedResourceNames: the names an Affected Resources cell lists, in its
 * order, for a list's CSV export. The alerts list has no Monitor column - its
 * Affected Resources names the alert's monitor, first - so the file has to
 * name the monitor first too, not last as reading the column's fields in
 * declaration order did.
 *
 * The cell itself is drawn and read beside the export in Common/Tests/App/
 * Dashboard/AlertsTableAffectedResources; here the helper's own rules, and
 * its order against the cell's source.
 */

const CELL_SOURCE: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "AffectedResources",
    "AffectedResourcesCell.tsx",
  ),
  "utf8",
);

// `for (const host of props.hosts || [])`: the list the cell reads next.
const CELL_LIST_LOOP: RegExp = /for \(const \w+ of props\.(\w+) \|\| \[\]\)/g;

function named(...names: Array<string>): Array<{ name: string }> {
  return names.map((name: string): { name: string } => {
    return { name: name };
  });
}

describe("the names an Affected Resources cell lists", () => {
  test("go in the cell's order, list by list, as AffectedResourcesCell reads them", () => {
    const cellOrder: Array<string> = Array.from(
      CELL_SOURCE.matchAll(CELL_LIST_LOOP),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    // Every kind of resource the cell draws, monitors first, cloud resources included.
    expect(cellOrder).toHaveLength(16);
    expect(cellOrder.indexOf("cloudResources")).toBe(
      cellOrder.indexOf("databaseServers") + 1,
    );
    expect(cellOrder[0]).toBe("monitors");
    expect([...AFFECTED_RESOURCE_LIST_ORDER]).toEqual(cellOrder);
  });

  test("start with the monitor, then the rest in the cell's order, whatever order they are given in", () => {
    const lists: AffectedResourceLists = {
      serviceLevelObjectives: named("Checkout availability"),
      services: named("checkout-api"),
      kubernetesClusters: named("oneuptime-test"),
      hosts: named("web-01"),
      monitors: named("oneuptime-test - High Node Memory Utilization"),
    };

    expect(getAffectedResourceNames(lists)).toEqual([
      "oneuptime-test - High Node Memory Utilization",
      "web-01",
      "oneuptime-test",
      "checkout-api",
      "Checkout availability",
    ]);
  });

  test("keep each list's own order", () => {
    expect(
      getAffectedResourceNames({
        hosts: named("web-02", "web-01", "web-03"),
      }),
    ).toEqual(["web-02", "web-01", "web-03"]);
  });

  test("leave out a resource with no name, and trim the rest", () => {
    expect(
      getAffectedResourceNames({
        monitors: [{}, { name: "" }, { name: "   " }],
        hosts: [{ name: "  web-01 " }],
      }),
    ).toEqual(["web-01"]);
  });

  test("list a name once, as the CSV writes any cell built from several fields", () => {
    expect(
      getAffectedResourceNames({
        monitors: named("payments"),
        services: named("payments"),
      }),
    ).toEqual(["payments"]);
  });

  test("are none when nothing is attached", () => {
    expect(getAffectedResourceNames({})).toEqual([]);
    expect(
      getAffectedResourceNames({ monitors: [], hosts: undefined }),
    ).toEqual([]);
  });
});

describe("an Affected Resources cell in a CSV export", () => {
  test("joins the names the way the CSV joins several values", () => {
    expect(AFFECTED_RESOURCES_EXPORT_SEPARATOR).toBe("; ");
    expect(
      getAffectedResourcesExportValue({
        monitors: named("oneuptime-test - High Node Memory Utilization"),
        kubernetesClusters: named("oneuptime-test"),
      }),
    ).toBe("oneuptime-test - High Node Memory Utilization; oneuptime-test");
  });

  test("is empty when nothing is attached", () => {
    expect(getAffectedResourcesExportValue({})).toBe("");
  });

  test("is the monitor alone for an alert linked to nothing else", () => {
    expect(
      getAffectedResourcesExportValue({ monitors: named("Developer portal") }),
    ).toBe("Developer portal");
  });
});
