import ExternalStatusPageComponentStatusDisplayUtil, {
  ExternalStatusPageComponentStatusDisplay,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ExternalStatusPageComponentStatusDisplay";
import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  Blue,
  Gray500,
  Green,
  Moroon,
  Orange,
  Red,
  Yellow,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { CheckOn } from "../../../Types/Monitor/CriteriaFilter";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { ExternalStatusPageComponentStatusValue } from "../../../Utils/Monitor/ExternalStatusPageComponentStatusUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * How an External Status Page monitor's component status reads on screen
 * (Dashboard Utils/ExternalStatusPageComponentStatusDisplay): in the words
 * of the Component Status criteria's Value dropdown - the words a person
 * picks a criteria by - and in a colour that says how bad it is. The value
 * the criteria compare ("under_maintenance") is never what a person reads.
 */

const DROPDOWN: Array<DropdownOption> =
  CriteriaFilterUtil.getDropdownOptionsByCheckOn({
    checkOn: CheckOn.ExternalStatusPageComponentStatus,
  });

function display(status: string | undefined): {
  label: string;
  color: string;
} {
  const shown: ExternalStatusPageComponentStatusDisplay =
    ExternalStatusPageComponentStatusDisplayUtil.getDisplay(status);

  return { label: shown.label, color: shown.color.toString() };
}

function hex(color: Color): string {
  return color.toString();
}

describe("ExternalStatusPageComponentStatusDisplayUtil.getDisplay", () => {
  test("reads each value the criteria can pick by the dropdown's own label", () => {
    expect(DROPDOWN.length).toBe(6);

    for (const option of DROPDOWN) {
      expect({
        value: option.value,
        label: display(option.value.toString()).label,
      }).toEqual({ value: option.value, label: option.label });
    }
  });

  test.each([
    [ExternalStatusPageComponentStatusValue.Operational, Green],
    [ExternalStatusPageComponentStatusValue.UnderMaintenance, Blue],
    [ExternalStatusPageComponentStatusValue.DegradedPerformance, Yellow],
    [ExternalStatusPageComponentStatusValue.PartialOutage, Orange],
    [ExternalStatusPageComponentStatusValue.MajorOutage, Red],
    [ExternalStatusPageComponentStatusValue.FullOutage, Moroon],
    [ExternalStatusPageComponentStatusValue.Unknown, Gray500],
  ])("colours %s %p", (value: string, color: Color) => {
    expect(display(value).color).toBe(hex(color));
  });

  test("gives every value the criteria can pick a colour of its own", () => {
    const colors: Array<string> = DROPDOWN.map(
      (option: DropdownOption): string => {
        return display(option.value.toString()).color;
      },
    );

    expect(new Set(colors).size).toBe(colors.length);
    expect(colors).not.toContain(hex(Gray500));
  });

  test("a status the page does not show, or none at all, reads Unknown in grey", () => {
    for (const status of [
      ExternalStatusPageComponentStatusValue.Unknown,
      "",
      "   ",
      undefined,
    ]) {
      expect(display(status)).toEqual({
        label: "Unknown",
        color: hex(Gray500),
      });
    }
  });

  test("any other word a provider reports reads as a word, in grey unless it is a feed's incident", () => {
    expect(display("incident")).toEqual({
      label: "Incident",
      color: hex(Orange),
    });
    expect(display("maintenance")).toEqual({
      label: "Maintenance",
      color: hex(Gray500),
    });
    expect(display("planned__downtime")).toEqual({
      label: "Planned downtime",
      color: hex(Gray500),
    });
  });

  test("compares the value exactly, as the criteria do", () => {
    // A provider's "Operational" is not the value "operational".
    expect(display("Operational")).toEqual({
      label: "Operational",
      color: hex(Gray500),
    });
    expect(display(" under_maintenance ").label).toBe("Under Maintenance");
  });
});

describe("ExternalStatusPageComponentStatusDisplayUtil.isDescriptionTheStatus", () => {
  test.each([
    // A OneUptime status page's resource describes itself by its status.
    ["Operational", "operational", true],
    ["operational", "operational", true],
    ["Under Maintenance", "under_maintenance", true],
    ["  Partial Outage ", "partial_outage", true],
    ["degraded performance", "degraded_performance", true],
    ["Degraded_Performance", "degraded_performance", true],
    // The page's own words say something the status does not.
    ["Under maintenance: Database upgrade", "under_maintenance", false],
    ["Offline", "major_outage", false],
    ["Degraded", "degraded_performance", false],
    ["Real time HTTP callbacks", "operational", false],
    // Nothing to compare.
    ["", "operational", false],
    [undefined, "operational", false],
  ])(
    "%p beside %p repeats it: %p",
    (description: string | undefined, status: string, expected: boolean) => {
      expect(
        ExternalStatusPageComponentStatusDisplayUtil.isDescriptionTheStatus({
          description,
          status,
        }),
      ).toBe(expected);
    },
  );
});
