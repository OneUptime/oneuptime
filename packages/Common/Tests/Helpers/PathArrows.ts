import { DrawnLine, ParagraphDirection, drawLine } from "./BidiLayout";

/*
 * THE ARROWS BETWEEN THE STEPS OF A PATH, AND THE WAY EACH POINTS.
 *
 * A path is written with an arrow between its steps: "Admin Dashboard →
 * Settings → API Key". A browser draws "→" and "←" as they are written, in
 * a line read either way: neither is mirrored, as a bracket, ">" or "›" is.
 * So in a line read from the right, "→" points each step back at the one
 * before it, and Arabic and Persian write a path with "←"
 * (Locales/ARABIC.md). Steps in Latin letters inside such a line are drawn
 * from the left, as English draws them, and their arrows stay "→".
 *
 * Read with the copy of the bidi algorithm in BidiLayout: an arrow points
 * back when it is "→" where the line is drawn from the right, or "←" where
 * it is drawn from the left.
 */

export const RIGHTWARDS_ARROW: string = "→";

export const LEFTWARDS_ARROW: string = "←";

// "&rarr;" and "&larr;", by name or by number, as a template writes them.
const ARROW_REFERENCE: RegExp =
  /&(?:rarr|larr|#0*8594|#0*8592|#[xX]0*2192|#[xX]0*2190);/g;

const RIGHTWARDS_REFERENCE: RegExp = /^&(?:rarr|#0*8594|#[xX]0*2192);$/;

/*
 * The text with each arrow a template writes as a character reference
 * written as the arrow a browser draws for it. Every other reference stays
 * as it is.
 */
export const withArrowsDecoded: (text: string) => string = (
  text: string,
): string => {
  return text.replace(ARROW_REFERENCE, (reference: string): string => {
    return RIGHTWARDS_REFERENCE.test(reference)
      ? RIGHTWARDS_ARROW
      : LEFTWARDS_ARROW;
  });
};

export interface PathArrow {
  // Where the arrow is in the line.
  index: number;
  arrow: string;
  // Whether the line is drawn from the right where the arrow is.
  isDrawnFromTheRight: boolean;
  // "→" drawn from the right, or "←" drawn from the left.
  pointsBack: boolean;
}

// What a step of a path holds: a letter or a digit.
const STEP: RegExp = /[\p{L}\p{N}]/u;

/*
 * The arrows of one line, laid out in a paragraph read `direction`, that
 * stand between two steps: with a letter or a digit both before and after
 * them. An arrow with nothing to one side leads a link on or back ("View
 * →", "← Back") and is no path's.
 */
export const getPathArrows: (
  line: string,
  direction: ParagraphDirection,
) => Array<PathArrow> = (
  line: string,
  direction: ParagraphDirection,
): Array<PathArrow> => {
  const arrows: Array<PathArrow> = [];
  let drawn: DrawnLine | null = null;

  for (let index: number = 0; index < line.length; index++) {
    const arrow: string = line.charAt(index);

    if (arrow !== RIGHTWARDS_ARROW && arrow !== LEFTWARDS_ARROW) {
      continue;
    }

    if (!STEP.test(line.slice(0, index)) || !STEP.test(line.slice(index + 1))) {
      continue;
    }

    drawn = drawn ?? drawLine(line, direction);

    const isDrawnFromTheRight: boolean =
      (drawn.levels[index] as number) % 2 === 1;

    arrows.push({
      index,
      arrow,
      isDrawnFromTheRight,
      pointsBack: isDrawnFromTheRight === (arrow === RIGHTWARDS_ARROW),
    });
  }

  return arrows;
};
