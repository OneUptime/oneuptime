import {
  Argument,
  ComponentInputType,
} from "../../../Types/Workflow/Component";
import {
  AFFECTED_RESOURCES_ARGUMENT_ID,
  MAX_AFFECTED_RESOURCE_REFERENCE_LENGTH,
  MAX_AFFECTED_RESOURCE_REFERENCES,
  MAX_LINKED_AFFECTED_RESOURCES,
  getAffectedResourcesArgument,
  getAffectedResourcesSettingTableNames,
  readAffectedResourceReferences,
} from "../../../Types/Workflow/AffectedResourcesSetting";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * Create One Incident's and Create One Alert's Affected Resources setting
 * (issue #5341): an alert from another tool names the router, switch or
 * host it is about - "WAN-RTR-01", "10.0.4.1" - and the workflow links it
 * by that, not by a OneUptime ID nobody receiving a webhook knows. The
 * setting is what the step's dialog offers; the references are what the
 * server looks up. Its value can be a webhook's text of any length, so it
 * is read in one pass, in time in line with its length.
 */

describe("the setting", () => {
  test.each([
    ["Incident", "incident"],
    ["Alert", "alert"],
  ])(
    "%s's Create One step offers it: optional text, saying what it takes and where monitors go",
    (tableName: string, noun: string) => {
      const setting: Argument = getAffectedResourcesArgument(tableName)!;

      expect(setting).toEqual({
        id: AFFECTED_RESOURCES_ARGUMENT_ID,
        name: "Affected Resources",
        type: ComponentInputType.Text,
        required: false,
        description: `Names, addresses or IDs of the hosts, network devices, clusters, databases or services this ${noun} is about, separated by commas. Each one found is linked. Monitors go in JSON Object.`,
        placeholder: "Example: WAN-RTR-01, 10.0.4.1",
      });
    },
  );

  test("no other table has it - a maintenance event, a monitor, nothing at all", () => {
    for (const tableName of [
      "ScheduledMaintenance",
      "Monitor",
      "Host",
      "",
      undefined,
    ]) {
      expect(getAffectedResourcesArgument(tableName)).toBeNull();
    }
  });

  test("the tables with it are incidents and alerts", () => {
    expect(getAffectedResourcesSettingTableNames()).toEqual([
      "Alert",
      "Incident",
    ]);
  });

  test("its id is the one the step reads", () => {
    expect(AFFECTED_RESOURCES_ARGUMENT_ID).toBe("affectedResources");
  });

  test("the limits: 25 references, 50 resources, 200 characters a reference", () => {
    expect(MAX_AFFECTED_RESOURCE_REFERENCES).toBe(25);
    expect(MAX_LINKED_AFFECTED_RESOURCES).toBe(50);
    expect(MAX_AFFECTED_RESOURCE_REFERENCE_LENGTH).toBe(200);
  });
});

describe("readAffectedResourceReferences - what the setting names", () => {
  test("splits at commas, semicolons and line breaks, trimmed, in the order written", () => {
    expect(
      readAffectedResourceReferences(
        " WAN-RTR-01, 10.0.4.1;core-sw-01\nedge-fw-01\r\nap3.office.example ",
      ),
    ).toEqual({
      references: [
        "WAN-RTR-01",
        "10.0.4.1",
        "core-sw-01",
        "edge-fw-01",
        "ap3.office.example",
      ],
      leftOut: 0,
    });
  });

  test("keeps a name with spaces in it whole", () => {
    expect(
      readAffectedResourceReferences("Office AP 3rd floor, payments api")
        .references,
    ).toEqual(["Office AP 3rd floor", "payments api"]);
  });

  test("drops empty entries", () => {
    expect(
      readAffectedResourceReferences(",, ;\n\n , WAN-RTR-01 ,,").references,
    ).toEqual(["WAN-RTR-01"]);
  });

  test("names a resource once, whatever its case, as first written", () => {
    expect(
      readAffectedResourceReferences("WAN-RTR-01, wan-rtr-01, Wan-Rtr-01, x")
        .references,
    ).toEqual(["WAN-RTR-01", "x"]);
  });

  test(`looks up the first ${MAX_AFFECTED_RESOURCE_REFERENCES}, and says how many more there were`, () => {
    const all: Array<string> = Array.from(
      { length: 40 },
      (_value: unknown, index: number): string => {
        return `device-${index}`;
      },
    );

    const read: { references: Array<string>; leftOut: number } =
      readAffectedResourceReferences(all.join(", "));

    expect(read.references).toEqual(
      all.slice(0, MAX_AFFECTED_RESOURCE_REFERENCES),
    );
    expect(read.leftOut).toBe(40 - MAX_AFFECTED_RESOURCE_REFERENCES);
  });

  test("a repeat past the limit is not counted as left out", () => {
    const first: Array<string> = Array.from(
      { length: MAX_AFFECTED_RESOURCE_REFERENCES },
      (_value: unknown, index: number): string => {
        return `device-${index}`;
      },
    );

    expect(
      readAffectedResourceReferences(
        [...first, "DEVICE-0", "device-1"].join(","),
      ).leftOut,
    ).toBe(0);
  });

  test(`cuts a reference to ${MAX_AFFECTED_RESOURCE_REFERENCE_LENGTH} characters`, () => {
    const long: string = "x".repeat(5000);

    expect(readAffectedResourceReferences(long).references).toEqual([
      "x".repeat(MAX_AFFECTED_RESOURCE_REFERENCE_LENGTH),
    ]);
  });

  test("an earlier step's list gives its entries, and a number its digits", () => {
    expect(
      readAffectedResourceReferences([
        "WAN-RTR-01",
        "core-sw-01, core-sw-02",
        42,
      ]).references,
    ).toEqual(["WAN-RTR-01", "core-sw-01", "core-sw-02", "42"]);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty text", ""],
    ["spaces", "   "],
    ["an object", { name: "WAN-RTR-01" }],
    ["true", true],
    ["a number that is not one", NaN],
    ["infinity", Infinity],
    ["an empty list", []],
    ["a list of objects", [{ name: "WAN-RTR-01" }, null]],
  ])("%s names nothing", (_what: string, value: unknown) => {
    expect(readAffectedResourceReferences(value)).toEqual({
      references: [],
      leftOut: 0,
    });
  });

  test("a webhook's text of any length is read in time in line with its length", () => {
    // The worst case for a split by hand: separators and spaces, alternating.
    const text: string = " ,".repeat(200000) + "x".repeat(400000);

    const timed: FastestRun<{ references: Array<string>; leftOut: number }> =
      fastestRun({
        run: (): { references: Array<string>; leftOut: number } => {
          return readAffectedResourceReferences(text);
        },
        limitInMs: 2000,
      });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result.references).toEqual([
      "x".repeat(MAX_AFFECTED_RESOURCE_REFERENCE_LENGTH),
    ]);
  });

  test("a text of a great many short entries is read in time too, keeping the first ones", () => {
    const text: string = Array.from(
      { length: 100000 },
      (_value: unknown, index: number): string => {
        return `d${index}`;
      },
    ).join(";");

    const timed: FastestRun<{ references: Array<string>; leftOut: number }> =
      fastestRun({
        run: (): { references: Array<string>; leftOut: number } => {
          return readAffectedResourceReferences(text);
        },
        limitInMs: 2000,
      });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result.references[0]).toBe("d0");
    expect(timed.result.references).toHaveLength(
      MAX_AFFECTED_RESOURCE_REFERENCES,
    );
    expect(timed.result.leftOut).toBe(
      100000 - MAX_AFFECTED_RESOURCE_REFERENCES,
    );
  });
});
