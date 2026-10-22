import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ARCHIVED_FACET_GROUP,
  ARCHIVED_FACET_SELECT,
  getArchivableValueFacetOptions,
} from "../../FeatureSet/Dashboard/src/Components/ArchivableValue/ArchivedValueFacetOptions";
import { FilterChipDropdownOption } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";

/*
 * A list's filter chips over values that can be archived (a state, a
 * severity, a monitor status, a label): every value is offered - old
 * records keep an archived one and stay findable by it - but the archived
 * ones come last, under an "Archived" heading, so nobody wonders why a
 * value no form offers any more is listed, or mistakes it for one in use.
 *
 * The heading is the chip's group, which FilterChipDropdown translates
 * (Common/Tests/App/Dashboard/FilterChipArchivedGroup draws it).
 */

interface Value {
  _id: string;
  name: string;
  isArchived?: boolean | undefined;
}

const toOption: (value: Value) => FilterChipDropdownOption = (
  value: Value,
): FilterChipDropdownOption => {
  return { value: value._id, label: value.name, color: "#9ca3af" };
};

const labelsOf: (options: Array<FilterChipDropdownOption>) => Array<string> = (
  options: Array<FilterChipDropdownOption>,
): Array<string> => {
  return options.map((option: FilterChipDropdownOption): string => {
    return option.label;
  });
};

describe("getArchivableValueFacetOptions", () => {
  const values: Array<Value> = [
    { _id: "1", name: "Critical" },
    { _id: "2", name: "[DONOTUSE] Very critical", isArchived: true },
    { _id: "3", name: "Major", isArchived: false },
    { _id: "4", name: "Old severity", isArchived: true },
    { _id: "5", name: "Minor" },
  ];

  test("offers every value, the archived ones last", () => {
    expect(
      labelsOf(getArchivableValueFacetOptions({ values, toOption })),
    ).toEqual([
      "Critical",
      "Major",
      "Minor",
      "[DONOTUSE] Very critical",
      "Old severity",
    ]);
  });

  test("puts the archived ones under the Archived heading, and nothing else", () => {
    const options: Array<FilterChipDropdownOption> =
      getArchivableValueFacetOptions({ values, toOption });

    expect(ARCHIVED_FACET_GROUP).toBe("Archived");

    for (const option of options) {
      const isArchived: boolean =
        option.label === "[DONOTUSE] Very critical" ||
        option.label === "Old severity";

      expect({ label: option.label, group: option.group }).toEqual({
        label: option.label,
        group: isArchived ? "Archived" : undefined,
      });
    }
  });

  test("keeps the list's own order within each part", () => {
    const reversed: Array<Value> = [...values].reverse();

    expect(
      labelsOf(getArchivableValueFacetOptions({ values: reversed, toOption })),
    ).toEqual([
      "Minor",
      "Major",
      "Critical",
      "Old severity",
      "[DONOTUSE] Very critical",
    ]);
  });

  test("a project with nothing archived reads as before: no heading", () => {
    const live: Array<Value> = values.filter((value: Value): boolean => {
      return !value.isArchived;
    });

    const options: Array<FilterChipDropdownOption> =
      getArchivableValueFacetOptions({ values: live, toOption });

    expect(labelsOf(options)).toEqual(["Critical", "Major", "Minor"]);
    expect(
      options.some((option: FilterChipDropdownOption): boolean => {
        return Boolean(option.group);
      }),
    ).toBe(false);
  });

  test("reads the archive switch it selects", () => {
    expect(ARCHIVED_FACET_SELECT).toEqual({ isArchived: true });
  });
});

/*
 * Every list filter over an archivable value reads the archive switch and
 * groups with the helper: Incidents (state, severity), Alerts (state,
 * severity), Monitors (status), Scheduled Maintenance (state), Network Sites
 * (status) and every list's Labels chip (useResourceOwners).
 */
describe("the lists' filters", () => {
  const DASHBOARD: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
  );

  const LOADERS: Array<{ file: string; count: number }> = [
    { file: "Components/Incident/IncidentsTable.tsx", count: 2 },
    { file: "Components/Alert/AlertsTable.tsx", count: 2 },
    { file: "Components/Monitor/MonitorTable.tsx", count: 1 },
    {
      file: "Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx",
      count: 1,
    },
    { file: "Pages/NetworkSite/Sites.tsx", count: 1 },
    { file: "Components/ResourceOwners/useResourceOwners.tsx", count: 1 },
  ];

  const occurrences: (text: string, part: string) => number = (
    text: string,
    part: string,
  ): number => {
    return text.split(part).length - 1;
  };

  test.each(LOADERS)(
    "$file lists archived values last, under Archived",
    ({ file, count }: { file: string; count: number }) => {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD, file),
        "utf8",
      );

      expect({
        file,
        grouped: occurrences(source, "getArchivableValueFacetOptions({"),
        selected: occurrences(source, "...ARCHIVED_FACET_SELECT"),
      }).toEqual({ file, grouped: count, selected: count });
    },
  );
});
