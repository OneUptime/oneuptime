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

/*
 * The page's overall status, as the monitor's summary shows it (#5281): it
 * read the value a check reports - "under_maintenance" over components
 * that read "Under Maintenance" - and now reads like the components: the
 * same words and colour for a value they share, the reachability check's
 * and an Atlassian indicator's meaning in words, and a page's own
 * description of itself as written, in the colour its words name.
 */
describe("ExternalStatusPageComponentStatusDisplayUtil.getOverallDisplay", () => {
  function overall(status: string | undefined): {
    label: string;
    color: string;
  } {
    const shown: ExternalStatusPageComponentStatusDisplay =
      ExternalStatusPageComponentStatusDisplayUtil.getOverallDisplay(status);

    return { label: shown.label, color: shown.color.toString() };
  }

  test("a value the components share reads exactly as a component with it does", () => {
    for (const option of DROPDOWN) {
      expect(overall(option.value.toString())).toEqual(
        display(option.value.toString()),
      );
    }

    // What a feed reports for a page with recent items.
    expect(overall("degraded_performance")).toEqual({
      label: "Degraded Performance",
      color: hex(Yellow),
    });
    expect(overall("under_maintenance")).toEqual({
      label: "Under Maintenance",
      color: hex(Blue),
    });
  });

  test("the reachability check's two answers read as what they mean", () => {
    expect(overall("reachable")).toEqual({
      label: "Reachable",
      color: hex(Green),
    });
    expect(overall("unreachable")).toEqual({
      label: "Unreachable",
      color: hex(Red),
    });
    expect(overall(" UNREACHABLE ").label).toBe("Unreachable");
  });

  test.each([
    ["none", "Operational", Green],
    ["minor", "Degraded Performance", Yellow],
    ["major", "Partial Outage", Orange],
    ["critical", "Major Outage", Red],
    ["maintenance", "Under Maintenance", Blue],
  ])(
    "an Atlassian indicator %p, reported when the page has no description, reads %p",
    (indicator: string, label: string, color: Color) => {
      expect(overall(indicator)).toEqual({ label: label, color: hex(color) });
    },
  );

  test.each([
    ["All Systems Operational", Green],
    ["Partially Degraded Service", Yellow],
    ["Minor Service Outage", Yellow],
    ["Partial System Outage", Orange],
    ["Major Service Outage", Red],
    ["Major System Outage", Red],
    ["Critical outage across regions", Moroon],
    ["Service Under Maintenance", Blue],
    ["Operational", Green],
  ])(
    "a page's own description %p reads as written, coloured by its words",
    (description: string, color: Color) => {
      expect(overall(description)).toEqual({
        label: description,
        color: hex(color),
      });
    },
  );

  test("words it does not know stay as written, in grey; no status reads Unknown", () => {
    expect(overall("Alle Systeme betriebsbereit")).toEqual({
      label: "Alle Systeme betriebsbereit",
      color: hex(Gray500),
    });
    expect(overall("planned_window")).toEqual({
      label: "Planned window",
      color: hex(Gray500),
    });

    for (const status of ["unknown", "", "   ", undefined]) {
      expect(overall(status)).toEqual({
        label: "Unknown",
        color: hex(Gray500),
      });
    }
  });

  test("never shows the value a check reports when it has words for it", () => {
    for (const value of [
      ...DROPDOWN.map((option: DropdownOption): string => {
        return option.value.toString();
      }),
      "reachable",
      "unreachable",
      "none",
      "minor",
      "major",
      "critical",
      "maintenance",
    ]) {
      expect(overall(value).label).not.toContain("_");
      expect(overall(value).label).not.toBe(value);
    }
  });
});
