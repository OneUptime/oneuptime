import {
  Blue500,
  Gray500,
  Green,
  Red,
  Yellow,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";

/*
 * WHAT A CHIP MEANS, NOT WHAT COLOUR IT IS.
 *
 * The same idea - a coloured status or label chip - was drawn four ways: a
 * Pill, a StatusBadge with a gradient and bold text, a Badge with a shadow,
 * and some three hundred spans written by hand, half of them rounded-full and
 * the rest rounded-md, each with its own greens (#9137). One page could show
 * "Active" in two shapes and two greens, and the dark theme handled each of
 * them differently.
 *
 * A chip that says how something is doing names its tone, and the Pill paints
 * it: the colour below, its wash, its ring and a text shade worked out to
 * read at 4.5:1 or better on the light theme's white and the dark theme's
 * slate (PillColors). A chip in a colour someone picked (a label's, a
 * state's, a severity's) still passes that colour.
 *
 * - Neutral: a plain fact or a tag. "Default", "3 rules", "Beta".
 * - Info: something worth knowing that needs nothing. "Running", "Scheduled".
 * - Success: it works. "Enabled", "Connected", "Passed".
 * - Warning: it needs a look soon. "Expiring", "Degraded", "Not connected".
 * - Danger: it broke. "Failed", "Offline", "Error".
 * - Paused: someone chose to switch it off. "Disabled", "Paused",
 *   "Archived". Grey, never red: red is for what broke, never for a choice
 *   (Docs/ux/README.md#side-menus, #9126). Its dot is a hollow ring - a
 *   light that is off - so it is not mistaken for a Neutral fact.
 */
export enum PillTone {
  Neutral = "neutral",
  Info = "info",
  Success = "success",
  Warning = "warning",
  Danger = "danger",
  Paused = "paused",
}

/*
 * The colours are the stock ones pages already passed to a Pill for these
 * states (Green for Enabled, Red for Error, Yellow for a warning, Gray500 for
 * nothing to see), so a page that moves from a colour to a tone looks the same.
 */
export const PILL_TONE_COLORS: Readonly<Record<PillTone, Color>> =
  Object.freeze({
    [PillTone.Neutral]: Gray500,
    [PillTone.Info]: Blue500,
    [PillTone.Success]: Green,
    [PillTone.Warning]: Yellow,
    [PillTone.Danger]: Red,
    [PillTone.Paused]: Gray500,
  });

export function getPillToneColor(tone: PillTone | undefined): Color {
  return PILL_TONE_COLORS[tone || PillTone.Neutral];
}
