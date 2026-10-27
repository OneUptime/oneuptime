import Color from "../../../Types/Color";
import {
  getPillColors,
  getPillToneStyle,
  PillColors,
  PillStyle,
} from "../Pill/PillColors";
import { CSSProperties } from "react";

/*
 * The colours the uptime history's tooltip and day dialog draw a day's
 * events in: an incident's severity and state, a scheduled maintenance
 * event's state, and the count over each kind's list.
 *
 * Those colours are the project's to pick, and many are light - the stock
 * "Ongoing" amber, a "Resolved" green, the maintenance blue - so a name
 * written in its own colour on a wash of it read at 1.5:1 to 3.2:1, under
 * WCAG's 4.5:1 for text this small. These are the Pill's tones instead
 * (Pill/PillColors): the wash of the colour, and text in the nearest deeper
 * shade of it that reads at 4.5:1 or more on that wash, with a set of its
 * own for the dark theme, which html.dark [data-ou-pill] in Theme.css swaps
 * in. No ring: these are the tooltip's compact chips and the counts beside
 * a list's heading, not pills; the day dialog draws its states as Pills.
 */
export interface UptimeDayToneProps {
  "data-ou-pill": string;
  style: PillStyle;
}

export const getUptimeDayToneProps: (
  color: Color | string,
  style?: CSSProperties | undefined,
) => UptimeDayToneProps = (
  color: Color | string,
  style?: CSSProperties | undefined,
): UptimeDayToneProps => {
  const colors: PillColors = getPillColors(color);

  return {
    "data-ou-pill": "",
    style: {
      // The dark theme's shadow too: none.
      ...getPillToneStyle(colors, { boxShadow: "none" }),
      boxShadow: "none",
      ...style,
    },
  };
};

/*
 * The red of a day's incidents, as the maintenance blue is a day's planned
 * work (HistoryChartBarColors' MAINTENANCE_MARK_COLOR): the icon over their
 * list, and their count's tone.
 */
export const INCIDENT_MARK_COLOR: Color = new Color("#DC2626");

// How many events a list holds, beside its heading.
export const UPTIME_DAY_COUNT_STYLE: CSSProperties = {
  fontWeight: 600,
  borderRadius: "9999px",
  lineHeight: "1.6",
};
