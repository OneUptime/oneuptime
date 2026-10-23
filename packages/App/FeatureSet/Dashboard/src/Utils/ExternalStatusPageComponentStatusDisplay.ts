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
