import {
  Amber600,
  Fuchsia500,
  Green600,
  Indigo500,
  Lime600,
  Pink500,
  Purple500,
  Red500,
  Sky600,
  Teal600,
} from "../Types/BrandColors";
import Color, { RGB } from "../Types/Color";
import { parseColor } from "./ColorContrast";

/*
 * Colours OneUptime picks for a new record, so nobody has to.
 *
 * A label, an incident state or severity, a monitor status, an incident role
 * and a status page's bar colour rule each need a colour, and the forms that
 * create them used to open with an empty picker and refuse to save until one
 * was chosen - a decision with no wrong answer, asked before anything else
 * could happen. Now the form starts with a colour already picked: one the
 * records beside it do not use yet, so a new state does not come out the
 * same red as the one above it. It is a starting point - the field stays,
 * and any colour can be picked instead.
 *
 * The palette is curated rather than the whole of BrandColors (whose
 * BrightColors starts with black and holds greys):
 *
 *   - no black, white or grey - a record coloured grey looks disabled, and
 *     black disappears in the dark theme;
 *   - every colour shows on both themes: at least 3:1 against the white card
 *     and against the dark theme's surface (WCAG's minimum for a coloured
 *     dot or swatch), which is why the yellows, greens and blues are the
 *     tailwind -600 shade, not the -500 one;
 *   - no two colours share a hue family: each is at least SIMILAR_HUE_DEGREES
 *     from every other one, so "a colour no row uses" really looks different;
 *   - listed in the order they are picked: each next one sits far round the
 *     colour wheel from the one before, so consecutive records stand apart.
 *
 * Pure, and free of database and React imports: the dashboard's forms and
 * the server's services pick from the same palette.
 */

export const DISTINCT_COLORS: ReadonlyArray<Color> = [
  Indigo500,
  Amber600,
  Teal600,
  Pink500,
  Lime600,
  Sky600,
  Red500,
  Purple500,
  Green600,
  Fuchsia500,
];

/*
 * Two colours whose hues are closer than this read as the same colour - a
 * red and a slightly different red - whatever their lightness.
 */
export const SIMILAR_HUE_DEGREES: number = 20;

/*
 * A colour whose channels differ by less than this share of their range is
 * a grey to the eye - black, white, slate - and has no hue to clash with.
 */
export const NEUTRAL_CHROMA: number = 0.16;

type HueFunction = (color: Color | string | null | undefined) => number | null;

/**
 * The colour's hue in degrees (0 to 360, red at 0), or null for a grey and
 * for anything that is not a colour.
 */
export const getColorHue: HueFunction = (
  color: Color | string | null | undefined,
): number | null => {
  const rgb: RGB | null = parseColor(color);

  if (!rgb) {
    return null;
  }

  const red: number = rgb.red / 255;
  const green: number = rgb.green / 255;
  const blue: number = rgb.blue / 255;
  const max: number = Math.max(red, green, blue);
  const min: number = Math.min(red, green, blue);
  const chroma: number = max - min;

  if (chroma < NEUTRAL_CHROMA) {
    return null;
  }

  let hue: number;

  if (max === red) {
    hue = ((green - blue) / chroma) % 6;
  } else if (max === green) {
    hue = (blue - red) / chroma + 2;
  } else {
    hue = (red - green) / chroma + 4;
  }

  return (hue * 60 + 360) % 360;
};

type HueDistanceFunction = (first: number, second: number) => number;

// The shorter way round the colour wheel.
const getHueDistance: HueDistanceFunction = (
  first: number,
  second: number,
): number => {
  const distance: number = Math.abs(first - second) % 360;

  return Math.min(distance, 360 - distance);
};

type AreSimilarColorsFunction = (
  first: Color | string | null | undefined,
  second: Color | string | null | undefined,
) => boolean;

/**
 * Whether two colours read as the same colour: hues closer than
 * SIMILAR_HUE_DEGREES. A grey is similar to nothing.
 */
export const areSimilarColors: AreSimilarColorsFunction = (
  first: Color | string | null | undefined,
  second: Color | string | null | undefined,
): boolean => {
  const firstHue: number | null = getColorHue(first);
  const secondHue: number | null = getColorHue(second);

  if (firstHue === null || secondHue === null) {
    return false;
  }

  return getHueDistance(firstHue, secondHue) < SIMILAR_HUE_DEGREES;
};

type PickDistinctColorFunction = (
  colorsInUse?: ReadonlyArray<Color | string | null | undefined>,
) => Color;

/**
 * The colour for a new record: the first colour of the palette that none of
 * `colorsInUse` (the colours of the records beside it) looks like. When every
 * one is taken, the one the fewest of them look like - so a long list of
 * labels goes round the palette evenly instead of repeating its first colour.
 * Greys, empty values and anything that is not a colour are ignored.
 */
export const pickDistinctColor: PickDistinctColorFunction = (
  colorsInUse?: ReadonlyArray<Color | string | null | undefined>,
): Color => {
  const used: Array<Color | string> = (colorsInUse || []).filter(
    (color: Color | string | null | undefined): color is Color | string => {
      return getColorHue(color) !== null;
    },
  );

  let best: Color = DISTINCT_COLORS[0]!;
  let bestCount: number = Number.POSITIVE_INFINITY;

  for (const candidate of DISTINCT_COLORS) {
    const count: number = used.filter((color: Color | string): boolean => {
      return areSimilarColors(candidate, color);
    }).length;

    // Earlier in the palette wins a tie.
    if (count < bestCount) {
      best = candidate;
      bestCount = count;
    }

    if (count === 0) {
      break;
    }
  }

  // A copy: the palette's own colours are shared.
  return new Color(best.toString());
};

type PickRandomDistinctColorFunction = () => Color;

/**
 * Any colour of the palette, at random: for a record created where the
 * records beside it are not at hand - a service a caller sent no colour for.
 */
export const pickRandomDistinctColor: PickRandomDistinctColorFunction =
  (): Color => {
    const index: number = Math.min(
      Math.floor(Math.random() * DISTINCT_COLORS.length),
      DISTINCT_COLORS.length - 1,
    );

    return new Color(DISTINCT_COLORS[index]!.toString());
  };

type PickColorForNameFunction = (name: string) => Color;

/**
 * A colour for a record a machine creates by name - a label promoted from a
 * telemetry attribute - that is the same for the same name in every process,
 * so two workers creating it at once agree. The on-call screens colour each
 * person the same way, from their user id (Dashboard LayerUserColors).
 */
export const pickColorForName: PickColorForNameFunction = (
  name: string,
): Color => {
  let hash: number = 0;

  for (let index: number = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }

  return new Color(
    DISTINCT_COLORS[Math.abs(hash) % DISTINCT_COLORS.length]!.toString(),
  );
};
