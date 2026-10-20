import Color from "Common/Types/Color";
import {
  ThemedStyle,
  getStatusTextProps,
} from "Common/UI/Utils/StatusColorStyle";

/*
 * A severity pill on the incident list and alert list widgets: the
 * severity's name in its own colour, framed in it, on a faint tint of it.
 *
 * On the dark theme - a reader's own, and a public dashboard's - the name
 * takes the nearest lighter shade of the colour that reads on the dark card
 * (StatusColorStyle.getStatusTextProps, as a status page's status text
 * does): a severity's colour is picked for the light page, and the dark red
 * of a critical one read at 3.4:1 on the dark card. The light page is drawn
 * exactly as before.
 *
 * A severity with no colour is drawn in the neutral greys, as classes the
 * dark theme remaps (Common/UI/Styles/Theme.css) - the same greys the light
 * page had, where inline ones left a light box on the dark card.
 */

export const SEVERITY_PILL_CLASS_NAME: string =
  "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border";

export const SEVERITY_PILL_NEUTRAL_CLASS_NAME: string =
  "text-gray-500 border-gray-200 bg-gray-50";

export interface SeverityPillProps {
  className: string;
  style: ThemedStyle;
  [dataAttribute: `data-${string}`]: string;
}

export const getSeverityPillProps: (
  color: Color | string | null | undefined,
) => SeverityPillProps = (
  color: Color | string | null | undefined,
): SeverityPillProps => {
  const hex: string = color ? color.toString() : "";

  if (!hex) {
    return {
      className: `${SEVERITY_PILL_CLASS_NAME} ${SEVERITY_PILL_NEUTRAL_CLASS_NAME}`,
      style: { fontSize: "10px" },
    };
  }

  return {
    className: SEVERITY_PILL_CLASS_NAME,
    ...getStatusTextProps(hex, {
      fontSize: "10px",
      borderColor: hex,
      backgroundColor: `${hex}10`,
    }),
  };
};
