import Color from "../../../Types/Color";
import { DISTINCT_COLORS } from "../../../Utils/DistinctColor";
import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * The ready colors a color field offers before anything else.
 *
 * A color field used to open on a saturation square, a hue strip and a box for
 * a hex code - a tool for someone who already knows the code they want. Most
 * people want "a green one", so the field now leads with a row of swatches to
 * click, each with a name a screen reader can say and a colorblind reader can
 * hover, and keeps the fine picker behind "Custom color" for an exact brand
 * color.
 *
 * The swatches are Utils/DistinctColor's palette, the colors OneUptime picks
 * for a new record (CreateFormDefaults): no black, white or grey, every one
 * readable on both themes, no two in the same hue family. A Create form's
 * color therefore always starts on one of these swatches, already ticked.
 *
 * Pure and React-free, so a plain .ts test or another component (the on-call
 * layer avatars) can read the same list.
 */

export interface ColorSwatchOption {
  // English. Looked up through the translator where it is shown.
  name: string;
  // Lowercase #rrggbb.
  hex: string;
}

/*
 * Plain names, not Tailwind's: "Blue" for sky-600 and "Orange" for amber-600,
 * because the swatch is what people see and the name is what they say.
 */
export const DISTINCT_COLOR_NAMES: Readonly<Record<string, string>> = {
  "#6366f1": translationKey("Indigo"),
  "#d97706": translationKey("Orange"),
  "#0d9488": translationKey("Teal"),
  "#ec4899": translationKey("Pink"),
  "#65a30d": translationKey("Lime"),
  "#0284c7": translationKey("Blue"),
  "#ef4444": translationKey("Red"),
  "#a855f7": translationKey("Purple"),
  "#16a34a": translationKey("Green"),
  "#d946ef": translationKey("Magenta"),
};

/*
 * In the palette's own order - the order new records are given them - so the
 * colors next to each other in the row are far apart on the color wheel.
 */
export const COLOR_PICKER_SWATCHES: ReadonlyArray<ColorSwatchOption> =
  DISTINCT_COLORS.map((color: Color): ColorSwatchOption => {
    const hex: string = color.toString().toLowerCase();

    return {
      name: DISTINCT_COLOR_NAMES[hex] || hex,
      hex: hex,
    };
  });
