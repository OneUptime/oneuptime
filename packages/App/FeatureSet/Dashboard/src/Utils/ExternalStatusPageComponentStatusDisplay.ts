import {
  Blue,
  Gray500,
  Green,
  Moroon,
  Orange,
  Red,
  Yellow,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import { ExternalStatusPageComponentStatusValue } from "Common/Utils/Monitor/ExternalStatusPageComponentStatusUtil";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import CriteriaFilterUtil from "./Form/Monitor/CriteriaFilter";

/*
 * HOW AN EXTERNAL STATUS PAGE MONITOR'S COMPONENT STATUS READS ON SCREEN.
 *
 * The probe reports each component's status as a value the Component Status
 * criteria compare ("under_maintenance"). A person picks those criteria by
 * the words of the criteria's Value dropdown ("Under Maintenance"), so the
 * monitor's summary - and Test Monitor's result - names a status by the same
 * words, from the same list (CriteriaFilterUtil), in a colour that says how
 * bad it is.
 */

export interface ExternalStatusPageComponentStatusDisplay {
  // English; the Dashboard draws it in the reader's language.
  label: string;
  color: Color;
}

// Each value's colour: green up, blue planned work, then worse to worst.
const COLORS: ReadonlyArray<[string, Color]> = [
  [ExternalStatusPageComponentStatusValue.Operational, Green],
  [ExternalStatusPageComponentStatusValue.UnderMaintenance, Blue],
  [ExternalStatusPageComponentStatusValue.DegradedPerformance, Yellow],
  [ExternalStatusPageComponentStatusValue.PartialOutage, Orange],
  [ExternalStatusPageComponentStatusValue.MajorOutage, Red],
  [ExternalStatusPageComponentStatusValue.FullOutage, Moroon],
  // What the feed providers report for an item of the last 24 hours.
  ["incident", Orange],
];

// Runs of underscores in a value, read as spaces ("partial_outage").
const UNDERSCORES: RegExp = /_+/g;

/*
 * What the reachability check says of a page it could not read as any
 * known format: only whether it answered.
 */
const REACHABILITY_DISPLAYS: ReadonlyArray<
  [string, ExternalStatusPageComponentStatusDisplay]
> = [
  ["reachable", { label: "Reachable", color: Green }],
  ["unreachable", { label: "Unreachable", color: Red }],
];

/*
 * An Atlassian Statuspage's indicator - which a check reports only when the
 * page's status has no description - read in the components' words.
 */
const INDICATOR_VALUES: ReadonlyArray<[string, string]> = [
  ["none", ExternalStatusPageComponentStatusValue.Operational],
  ["minor", ExternalStatusPageComponentStatusValue.DegradedPerformance],
  ["major", ExternalStatusPageComponentStatusValue.PartialOutage],
  ["critical", ExternalStatusPageComponentStatusValue.MajorOutage],
  ["maintenance", ExternalStatusPageComponentStatusValue.UnderMaintenance],
];

/*
 * The colour of a page's own description of itself - an Atlassian
 * Statuspage's "All Systems Operational", "Partial System Outage" - by the
 * first of these words in it: "Major Service Outage" is red,
 * "Partially Degraded Service" and "Minor Service Outage" yellow, "Service
 * Under Maintenance" blue. Words it does not know stay grey: the words
 * themselves say what they mean.
 */
const DESCRIPTION_COLORS: ReadonlyArray<[string, Color]> = [
  ["maintenance", Blue],
  ["critical", Moroon],
  ["major", Red],
  ["unreachable", Red],
  ["degraded", Yellow],
  ["minor", Yellow],
  ["partial", Orange],
  ["outage", Orange],
  ["operational", Green],
  ["reachable", Green],
];

export default class ExternalStatusPageComponentStatusDisplayUtil {
  public static getDisplay(
    status: string | undefined,
  ): ExternalStatusPageComponentStatusDisplay {
    const value: string = (status || "").trim();

    const option: DropdownOption | undefined =
      CriteriaFilterUtil.getDropdownOptionsByCheckOn({
        checkOn: CheckOn.ExternalStatusPageComponentStatus,
      }).find((item: DropdownOption): boolean => {
        return item.value === value;
      });

    const color: Color =
      COLORS.find((entry: [string, Color]): boolean => {
        return entry[0] === value;
      })?.[1] || Gray500;

    if (option) {
      return { label: option.label, color: color };
    }

    // A status the page does not show, or no status at all.
    if (!value || value === ExternalStatusPageComponentStatusValue.Unknown) {
      return { label: "Unknown", color: Gray500 };
    }

    // Any other word a provider used, as a word: "incident" reads "Incident".
    const words: string = value.replace(UNDERSCORES, " ").trim();

    return {
      label: words.charAt(0).toUpperCase() + words.slice(1),
      color: color,
    };
  }

  /*
   * The page's overall status, read like its components' (getDisplay)
   * instead of as the value a check reports. A value the components share
   * - under_maintenance, which a page whose status is worked out from its
   * components reports - reads by the same words in the same colour; the
   * reachability check's reachable / unreachable and an Atlassian
   * indicator read by their meaning; and a page's own description of
   * itself - an Atlassian Statuspage's "All Systems Operational" - reads as
   * written, in the colour its words name. The criteria still compare the
   * value as the check reported it (see the docs' list of values).
   */
  public static getOverallDisplay(
    status: string | undefined,
  ): ExternalStatusPageComponentStatusDisplay {
    const value: string = (status || "").trim();
    const lowerCased: string = value.toLowerCase();

    const reachability:
      | [string, ExternalStatusPageComponentStatusDisplay]
      | undefined = REACHABILITY_DISPLAYS.find(
      (entry: [string, ExternalStatusPageComponentStatusDisplay]): boolean => {
        return entry[0] === lowerCased;
      },
    );

    if (reachability) {
      return reachability[1];
    }

    const indicator: [string, string] | undefined = INDICATOR_VALUES.find(
      (entry: [string, string]): boolean => {
        return entry[0] === lowerCased;
      },
    );

    const display: ExternalStatusPageComponentStatusDisplay =
      ExternalStatusPageComponentStatusDisplayUtil.getDisplay(
        indicator ? indicator[1] : value,
      );

    // A value the components share, an indicator, or no status at all.
    if (indicator || display.color !== Gray500 || display.label === "Unknown") {
      return display;
    }

    // A page's own words: as written, coloured by what they say.
    const color: Color =
      DESCRIPTION_COLORS.find((entry: [string, Color]): boolean => {
        return lowerCased.includes(entry[0]);
      })?.[1] || Gray500;

    return { label: display.label, color: color };
  }

  /*
   * Whether a component's description only repeats its status: a
   * OneUptime status page's resource describes itself by its status's name
   * ("Operational"), which the status already says. A name of the page's
   * own ("Offline", "Slow") still says something, and stays.
   */
  public static isDescriptionTheStatus(data: {
    description: string | undefined;
    status: string | undefined;
  }): boolean {
    const description: string =
      ExternalStatusPageComponentStatusDisplayUtil.normalize(data.description);

    if (!description) {
      return false;
    }

    return (
      description ===
        ExternalStatusPageComponentStatusDisplayUtil.normalize(data.status) ||
      description ===
        ExternalStatusPageComponentStatusDisplayUtil.normalize(
          ExternalStatusPageComponentStatusDisplayUtil.getDisplay(data.status)
            .label,
        )
    );
  }

  private static normalize(text: string | undefined): string {
    return (text || "").replace(UNDERSCORES, " ").trim().toLowerCase();
  }
}
