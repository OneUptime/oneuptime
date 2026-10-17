import Color from "../../Types/Color";
import {
  getStatusTextColorOnDark,
  getUptimeBarEdgeOnDark,
} from "../../Utils/StatusPage/StatusColorsOnDark";
import { CSSProperties } from "react";

/*
 * Status colours drawn the right way in both themes, as the Pill draws its
 * colours (Components/Pill/PillColors): the light theme's colour is written
 * inline, as it always was, so nothing changes where Theme.css is not loaded
 * or the page is light; the dark theme's rides along as a custom property,
 * and a rule in Theme.css that keys off the element's data attribute swaps
 * it in under html.dark. The colours themselves are worked out in
 * Utils/StatusPage/StatusColorsOnDark.
 *
 * Spread the props onto the element: <span {...getStatusTextProps(color)}>.
 */

export type ThemedStyle = CSSProperties & {
  [customProperty: `--${string}`]: string;
};

/*
 * Each name has a type of its own, the one string it is, so a style or a
 * props object keyed by it keeps its exact key.
 */
export type StatusTextAttribute = "data-ou-status-text";
export type StatusTextDarkProperty = "--ou-status-text-dark";
export type UptimeBarEdgeAttribute = "data-ou-bar-edge";
export type UptimeBarEdgeDarkProperty = "--ou-bar-edge-dark";

export const STATUS_TEXT_ATTRIBUTE: StatusTextAttribute = "data-ou-status-text";
export const STATUS_TEXT_DARK_PROPERTY: StatusTextDarkProperty =
  "--ou-status-text-dark";

export const UPTIME_BAR_EDGE_ATTRIBUTE: UptimeBarEdgeAttribute =
  "data-ou-bar-edge";
export const UPTIME_BAR_EDGE_DARK_PROPERTY: UptimeBarEdgeDarkProperty =
  "--ou-bar-edge-dark";

export interface ThemedProps {
  style: ThemedStyle;
  [dataAttribute: `data-${string}`]: string;
}

/*
 * Text in a status colour - a status's name, an uptime percentage, a
 * group's rollup: the colour as picked on the light theme, and on the dark
 * theme the nearest lighter shade of it that reads on a dark card.
 */
export function getStatusTextProps(
  color: Color | string | null | undefined,
  style?: CSSProperties | undefined,
): ThemedProps {
  const light: string = color ? color.toString() : "";
  const dark: string | null = getStatusTextColorOnDark(color);

  if (!dark) {
    return { style: { ...style, ...(light ? { color: light } : {}) } };
  }

  return {
    [STATUS_TEXT_ATTRIBUTE]: "",
    style: {
      ...style,
      color: light,
      [STATUS_TEXT_DARK_PROPERTY]: dark,
    },
  };
}

/*
 * An uptime bar: its colour exactly as picked, in both themes, and on the
 * dark theme an edge in a lighter shade of it when the colour alone would
 * not stand out from the dark card.
 */
export function getUptimeBarProps(
  color: Color | string,
  style?: CSSProperties | undefined,
): ThemedProps {
  const edge: string | null = getUptimeBarEdgeOnDark(color);
  const barStyle: ThemedStyle = {
    ...style,
    backgroundColor: color.toString(),
  };

  if (!edge) {
    return { style: barStyle };
  }

  return {
    [UPTIME_BAR_EDGE_ATTRIBUTE]: "",
    style: {
      ...barStyle,
      [UPTIME_BAR_EDGE_DARK_PROPERTY]: edge,
    },
  };
}
