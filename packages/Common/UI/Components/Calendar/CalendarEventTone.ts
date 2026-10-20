import Color, { RGB } from "../../../Types/Color";
import { composite, parseColor } from "../../../Utils/ColorContrast";
import { DARK_THEME_CARD } from "../../../Utils/StatusPage/StatusColorsOnDark";
import { getPillColors, PillColors } from "../Pill/PillColors";
import { CSSProperties } from "react";

/*
 * How a calendar block is painted.
 *
 *   - Solid: the event's colour fills the block, with black or white text on
 *     it. The on-call schedules draw people this way: each person is their
 *     colour, and the colours are picked to be told apart.
 *   - Soft: the block is a pale wash of the colour, with a stripe of it down
 *     the left edge and its text in a deeper shade of it - the way a Pill
 *     draws a state (Pill/PillColors). For colours that are states, which are
 *     often black, grey or a pale amber: a month of solid black blocks is
 *     mostly black, and a state's colour then reads the same in the
 *     calendar as in the list beside it.
 *   - Overlay: an event from another calendar, drawn beside a page's own -
 *     a public holiday or a change freeze on the maintenance calendar. Pale
 *     stripes of its colour on the card, a dashed edge, its text in a deeper
 *     shade: there to be seen, plainly not one of the page's own events, and
 *     nothing to open. Set on the event (CalendarEvent.appearance), so one
 *     calendar can hold both.
 */
export enum CalendarEventAppearance {
  Solid = "solid",
  Soft = "soft",
  Overlay = "overlay",
}

// The class a soft block carries; Theme.css swaps in its dark tone by it.
export const SOFT_EVENT_CLASS_NAME: string = "oneuptime-calendar-event--soft";

// The class an overlay block carries; Theme.css swaps in its dark tone by it.
export const OVERLAY_EVENT_CLASS_NAME: string =
  "oneuptime-calendar-event--overlay";

/*
 * The dark theme's tone, as custom properties on the block's inline style.
 * Each name has a type of its own, the one string it is, so a style keyed
 * by it keeps its exact key (as StatusColorStyle's names do).
 */
export type SoftEventDarkBackgroundProperty = "--ou-calendar-event-dark-bg";
export type SoftEventDarkTextProperty = "--ou-calendar-event-dark-text";
export type SoftEventDarkShadowProperty = "--ou-calendar-event-dark-shadow";

export const SOFT_EVENT_DARK_BACKGROUND_PROPERTY: SoftEventDarkBackgroundProperty =
  "--ou-calendar-event-dark-bg";
export const SOFT_EVENT_DARK_TEXT_PROPERTY: SoftEventDarkTextProperty =
  "--ou-calendar-event-dark-text";
export const SOFT_EVENT_DARK_SHADOW_PROPERTY: SoftEventDarkShadowProperty =
  "--ou-calendar-event-dark-shadow";

// The stripe down a soft block's left edge, in px.
export const SOFT_EVENT_STRIPE_WIDTH_PX: number = 3;

// An overlay block's dark tone, as custom properties as a soft block's is.
export type OverlayEventDarkBackgroundProperty =
  "--ou-calendar-overlay-dark-bg";
export type OverlayEventDarkImageProperty = "--ou-calendar-overlay-dark-image";
export type OverlayEventDarkTextProperty = "--ou-calendar-overlay-dark-text";
export type OverlayEventDarkBorderProperty =
  "--ou-calendar-overlay-dark-border";

export const OVERLAY_EVENT_DARK_BACKGROUND_PROPERTY: OverlayEventDarkBackgroundProperty =
  "--ou-calendar-overlay-dark-bg";
export const OVERLAY_EVENT_DARK_IMAGE_PROPERTY: OverlayEventDarkImageProperty =
  "--ou-calendar-overlay-dark-image";
export const OVERLAY_EVENT_DARK_TEXT_PROPERTY: OverlayEventDarkTextProperty =
  "--ou-calendar-overlay-dark-text";
export const OVERLAY_EVENT_DARK_BORDER_PROPERTY: OverlayEventDarkBorderProperty =
  "--ou-calendar-overlay-dark-border";

// The width of an overlay block's stripes, and of the gaps between them, in px.
export const OVERLAY_EVENT_STRIPE_PX: number = 4;

// What the calendar's blocks sit on: a white card, or the dark theme's card.
const LIGHT_SURFACE: RGB = { red: 255, green: 255, blue: 255 };

export type SoftEventStyle = CSSProperties & {
  [customProperty: `--${string}`]: string;
};

/*
 * A pill's wash is see-through, which is right on a card. A calendar block
 * sits on the grid's lines - the hours of a week, the days a long event
 * crosses - which would show through it, so the wash is laid onto the
 * surface it sits on: one opaque colour.
 */
export function getOpaqueWash(wash: string, surface: RGB): string {
  const rgb: RGB | null = parseColor(wash);

  if (!rgb) {
    return wash;
  }

  const open: number = wash.indexOf("(");
  const close: number = wash.lastIndexOf(")");
  const parts: Array<string> =
    open !== -1 && close > open ? wash.slice(open + 1, close).split(",") : [];
  const alpha: number = parts.length === 4 ? Number(parts[3]) : 1;

  if (!Number.isFinite(alpha) || alpha >= 1) {
    return Color.rgbToColor(rgb).toString().toLowerCase();
  }

  return Color.rgbToColor(composite(rgb, Math.max(0, alpha), surface))
    .toString()
    .toLowerCase();
}

function getShadow(stripe: string, ring: string): string {
  return `inset ${SOFT_EVENT_STRIPE_WIDTH_PX}px 0 0 ${stripe}, inset 0 0 0 1px ${ring}`;
}

// Diagonal stripes of `stripe` on `surface`.
function getStripes(stripe: string, surface: string): string {
  return `repeating-linear-gradient(135deg, ${stripe} 0px, ${stripe} ${OVERLAY_EVENT_STRIPE_PX}px, ${surface} ${OVERLAY_EVENT_STRIPE_PX}px, ${surface} ${OVERLAY_EVENT_STRIPE_PX * 2}px)`;
}

/*
 * An overlay block's style: the light theme's tone inline, the dark theme's
 * as custom properties Theme.css swaps in under html.dark - as a soft
 * block's, so it is right in the grid and in the "+N more" list alike.
 */
export function getOverlayEventStyle(
  color: Color | string | null | undefined,
): SoftEventStyle {
  const colors: PillColors = getPillColors(color);
  const lightSurface: string = Color.rgbToColor(LIGHT_SURFACE)
    .toString()
    .toLowerCase();
  const darkSurface: string = Color.rgbToColor(DARK_THEME_CARD)
    .toString()
    .toLowerCase();

  return {
    backgroundColor: lightSurface,
    backgroundImage: getStripes(
      getOpaqueWash(colors.light.backgroundColor, LIGHT_SURFACE),
      lightSurface,
    ),
    color: colors.light.textColor,
    border: `1px dashed ${colors.light.dotColor}`,
    [OVERLAY_EVENT_DARK_BACKGROUND_PROPERTY]: darkSurface,
    [OVERLAY_EVENT_DARK_IMAGE_PROPERTY]: getStripes(
      getOpaqueWash(colors.dark.backgroundColor, DARK_THEME_CARD),
      darkSurface,
    ),
    [OVERLAY_EVENT_DARK_TEXT_PROPERTY]: colors.dark.textColor,
    [OVERLAY_EVENT_DARK_BORDER_PROPERTY]: `1px dashed ${colors.dark.dotColor}`,
  };
}

/*
 * A soft block's style: the light theme's tone written inline, so the block
 * is right wherever it is drawn - in the grid, or in the "+N more" list that
 * react-big-calendar draws outside it - and the dark theme's riding along as
 * custom properties that Theme.css swaps in under html.dark.
 */
export function getSoftEventStyle(
  color: Color | string | null | undefined,
): SoftEventStyle {
  const colors: PillColors = getPillColors(color);

  return {
    backgroundColor: getOpaqueWash(colors.light.backgroundColor, LIGHT_SURFACE),
    color: colors.light.textColor,
    boxShadow: getShadow(colors.light.dotColor, colors.light.ringColor),
    [SOFT_EVENT_DARK_BACKGROUND_PROPERTY]: getOpaqueWash(
      colors.dark.backgroundColor,
      DARK_THEME_CARD,
    ),
    [SOFT_EVENT_DARK_TEXT_PROPERTY]: colors.dark.textColor,
    [SOFT_EVENT_DARK_SHADOW_PROPERTY]: getShadow(
      colors.dark.dotColor,
      colors.dark.ringColor,
    ),
  };
}
