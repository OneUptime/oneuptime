import Color, { RGB } from "../../Types/Color";
import Dictionary from "../../Types/Dictionary";
import { getReadableShade, parseColor } from "../ColorContrast";

/*
 * How an email paints a severity, a state or a monitor status: a small dot in
 * the colour the project picked for it, and its name beside the dot in that
 * colour - or, when the colour is too pale to read on the email's light
 * surfaces, in a deeper shade of it. The dot always keeps the colour itself.
 *
 * Every colour here comes from a project's own settings and lands inside an
 * inline style attribute. The Color type stores whatever string it is handed,
 * and the API accepts any string for it, so a colour is never passed on as
 * written: only a hex or rgb() colour this file can read is accepted, and what
 * reaches a template is the #rrggbb this file writes itself. Anything else - a
 * name like "red", a value carrying a ";" or a quote - is no colour at all,
 * and the template falls back to its neutral text.
 */

/*
 * The darkest surface a coloured name sits on in an email: the rollup's
 * severity and state chips (#eef2f7). The detail cards (#f8fafc) and the white
 * rows are lighter, and dark text only gains contrast on a lighter surface, so
 * a shade that reads here reads on every one of them.
 */
export const EMAIL_COLOR_SURFACE: RGB = { red: 238, green: 242, blue: 247 };

// WCAG 2 AA for normal text: the names are set at 12 to 15px.
export const EMAIL_COLOR_TEXT_CONTRAST: number = 4.5;

/*
 * The same cap the Pill puts on a text shade it has to move: a darkened red
 * at full saturation is a neon red, at this it is the brick red a text colour
 * should be. A colour that already reads is kept exactly as it is.
 */
const MAX_TEXT_SATURATION: number = 0.8;

/*
 * The whole value, anchored at both ends. parseColor alone reads only the
 * front of an rgb() value, so "rgb(1, 2, 3); background: url(...)" would get
 * through it.
 */
const SAFE_HEX_PATTERN: RegExp = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const SAFE_RGB_PATTERN: RegExp =
  /^rgba?\(\s*\d{1,3}(?:\s*,\s*|\s+)\d{1,3}(?:\s*,\s*|\s+)\d{1,3}(?:\s*[,/]\s*(?:\d{1,3}(?:\.\d+)?%|\d*\.?\d+))?\s*\)$/;

export interface EmailColorPair {
  // The colour itself, for the dot: always #rrggbb.
  color: string;
  // The colour, or the nearest shade of it that reads: always #rrggbb.
  textColor: string;
}

export default class EmailColorUtil {
  /*
   * The colour as #rrggbb, or null when it is missing or is not a hex or
   * rgb() colour. An alpha channel is dropped: a translucent dot would show
   * whatever happens to be behind it.
   */
  public static sanitize(
    color: Color | string | null | undefined,
  ): string | null {
    if (color === null || color === undefined) {
      return null;
    }

    const value: string = (typeof color === "string" ? color : color.toString())
      .trim()
      .toLowerCase();

    if (!SAFE_HEX_PATTERN.test(value) && !SAFE_RGB_PATTERN.test(value)) {
      return null;
    }

    const rgb: RGB | null = parseColor(value);

    if (!rgb) {
      return null;
    }

    return Color.rgbToColor(rgb).toString();
  }

  /*
   * The dot colour and the text colour for one name, or null when there is
   * no usable colour - in which case the email shows the name as it always
   * did, in its neutral text, with no dot.
   */
  public static getColorPair(
    color: Color | string | null | undefined,
  ): EmailColorPair | null {
    const sanitized: string | null = EmailColorUtil.sanitize(color);

    if (!sanitized) {
      return null;
    }

    const rgb: RGB = parseColor(sanitized)!;

    const textColor: RGB = getReadableShade({
      color: rgb,
      background: EMAIL_COLOR_SURFACE,
      minimumContrast: EMAIL_COLOR_TEXT_CONTRAST,
      maximumSaturation: MAX_TEXT_SATURATION,
    });

    return {
      color: sanitized,
      textColor: Color.rgbToColor(textColor).toString(),
    };
  }

  /*
   * The template variables for the name in `variableName`: for
   * "incidentSeverity", `incidentSeverityColor` (the dot) and
   * `incidentSeverityTextColor` (the name). Empty when there is no usable
   * colour, so a template's `{{#if incidentSeverityColor}}` falls through to
   * the neutral style. Spread into an email's vars beside the name itself.
   */
  public static getTemplateVariables(
    variableName: string,
    color: Color | string | null | undefined,
  ): Dictionary<string> {
    const pair: EmailColorPair | null = EmailColorUtil.getColorPair(color);

    if (!pair) {
      return {};
    }

    return {
      [`${variableName}Color`]: pair.color,
      [`${variableName}TextColor`]: pair.textColor,
    };
  }
}
