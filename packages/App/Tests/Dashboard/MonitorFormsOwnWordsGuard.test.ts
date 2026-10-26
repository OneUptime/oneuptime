import { describe, expect, test } from "@jest/globals";
import { FoundDescription, scanProductDescriptions } from "./DescriptionScan";

/*
 * The forms of the Monitors product - monitors, their criteria and
 * settings, probes, monitor secrets, templates, label and owner rules, and
 * monitor groups - say what each field is for in their own words, or say
 * nothing.
 *
 * A form field with no description of its own shows its model column's
 * (BasicModelForm), written for the API reference and never translated:
 * "Probe Icon" under a field titled Probe Logo, "Name of the Monitor
 * Template" under Template Name, "Any friendly name for this monitor",
 * "Friendly description that will help you remember", and the cron
 * expressions of the API's monitoring interval under a dropdown of
 * intervals. The monitors simplicity audit (#4964) left those for later;
 * each field now carries a line of its own (translated with the rest of the
 * form) or turns the column's off (Field.hideColumnDescription) where its
 * title, its placeholder or its section already say it. This keeps it so:
 * a field added to these forms later says what it is for, or says nothing.
 *
 * SettingsFormsOwnWordsGuard holds the settings and admin area to the same
 * rule; DescriptionScan finds the fields that fall back to their column's
 * description (kind "column").
 */

// The Monitors product: its pages, and the components only it draws.
const AREA: ReadonlyArray<RegExp> = [
  /^packages\/App\/FeatureSet\/Dashboard\/src\/Pages\/(Monitor|MonitorGroup)\//,
  /^packages\/App\/FeatureSet\/Dashboard\/src\/Components\/(Monitor|MonitorGroup|MonitorSecret|MonitorStatus|Probe)\//,
  /^packages\/App\/FeatureSet\/Dashboard\/src\/Components\/Form\/Monitor\//,
];

const ALL_DESCRIPTIONS: Array<FoundDescription> = scanProductDescriptions();

function isInArea(description: FoundDescription): boolean {
  return AREA.some((area: RegExp): boolean => {
    return area.test(description.where);
  });
}

describe("the Monitors product's forms say what each field is for in their own words", () => {
  test("the scan reads the area: what each part draws is found", () => {
    const own: Array<FoundDescription> = ALL_DESCRIPTIONS.filter(
      (description: FoundDescription): boolean => {
        return description.kind !== "column" && isInArea(description);
      },
    );

    // Pages and components of every part of the area are read.
    for (const part of [
      "/Pages/Monitor/",
      "/Pages/MonitorGroup/",
      "/Components/Form/Monitor/",
      "/Components/Monitor/",
    ]) {
      expect({
        part,
        found: own.some((description: FoundDescription): boolean => {
          return description.where.includes(part);
        }),
      }).toEqual({ part, found: true });
    }
  });

  test("no field falls back to its column's API description", () => {
    expect(
      ALL_DESCRIPTIONS.filter((description: FoundDescription): boolean => {
        return description.kind === "column" && isInArea(description);
      }).map((description: FoundDescription): string => {
        return `${description.where}: "${description.text}" (from ${description.writtenAt}) - give the field a short description of its own, or hideColumnDescription: true`;
      }),
    ).toEqual([]);
  });

  test("Probe Logo no longer says only Probe Icon, on any of its forms", () => {
    expect(
      ALL_DESCRIPTIONS.filter((description: FoundDescription): boolean => {
        return description.text.trim() === "Probe Icon";
      }).map((description: FoundDescription): string => {
        return description.where;
      }),
    ).toEqual([]);
  });
});
