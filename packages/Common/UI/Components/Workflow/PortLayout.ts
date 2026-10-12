/*
 * Where a step card draws its outputs: the names in a row along the bottom
 * of the card, each over its dot.
 *
 * The row is split into equal columns, one per output, and each dot sits in
 * the middle of its column, so a name is always right above the dot it names.
 * Positions are fractions of the card's width, which holds whatever the card
 * is drawn at. The card is 16rem wide, wider when its outputs' names need
 * more room - a Switch / Case's cases, named after their values - up to a
 * column's widest; a longer name is cut short, and its tooltip has it whole.
 *
 * A card never grows past MAX_OUTPUT_CARD_WIDTH, though: a Switch / Case with
 * many long cases would otherwise be wider than the canvas can show even
 * zoomed all the way out, and fitting the workflow to the screen would show a
 * slice of its middle. Past that, the columns narrow instead, down to the
 * narrowest, and the names are cut shorter.
 *
 * Pure: no DOM, no React Flow.
 */

import { WORKFLOW_NODE_WIDTH } from "./NodePlacement";
import { MAX_SWITCH_CASES } from "../../../Types/Workflow/Components/Switch";

// The narrowest column an output gets, and the widest one a long name gets.
export const MIN_OUTPUT_COLUMN_WIDTH: number = 72;
export const MAX_OUTPUT_COLUMN_WIDTH: number = 160;

/*
 * The widest a card gets: the most outputs a step can have - a Switch /
 * Case's every case and Default - in the narrowest columns. React Flow zooms
 * out to half size at most, so the widest card still fits a laptop's canvas.
 */
export const MAX_OUTPUT_CARD_WIDTH: number =
  (MAX_SWITCH_CASES + 1) * MIN_OUTPUT_COLUMN_WIDTH;

/*
 * A name's width, roughly, at the 11px medium weight the card draws names in:
 * about 6.5 pixels a character, and some room either side.
 */
const CHARACTER_WIDTH: number = 6.5;
const COLUMN_PADDING: number = 20;

export interface OutputLayout {
  /*
   * The card's width in pixels, when its outputs need it wider than a card
   * is. Null for a card of the usual width, which stays 16rem.
   */
  widerCardWidth: number | null;
  // Each output's dot, from the card's left edge, as a percentage.
  dotLeftPercents: Array<number>;
}

type GetOutputLayoutFunction = (titles: Array<string>) => OutputLayout;

export const getOutputLayout: GetOutputLayoutFunction = (
  titles: Array<string>,
): OutputLayout => {
  const count: number = titles.length;

  if (count === 0) {
    return { widerCardWidth: null, dotLeftPercents: [] };
  }

  const longest: number = Math.max(
    ...titles.map((title: string): number => {
      return Array.from(title || "").length;
    }),
  );

  const neededColumnWidth: number = Math.min(
    MAX_OUTPUT_COLUMN_WIDTH,
    Math.max(
      MIN_OUTPUT_COLUMN_WIDTH,
      Math.ceil(longest * CHARACTER_WIDTH) + COLUMN_PADDING,
    ),
  );

  // Narrower columns once the card would be wider than any card gets.
  const columnWidth: number = Math.max(
    MIN_OUTPUT_COLUMN_WIDTH,
    Math.min(neededColumnWidth, Math.floor(MAX_OUTPUT_CARD_WIDTH / count)),
  );

  const width: number = columnWidth * count;

  return {
    widerCardWidth: width > WORKFLOW_NODE_WIDTH ? width : null,
    dotLeftPercents: titles.map((_title: string, index: number): number => {
      return ((index + 0.5) / count) * 100;
    }),
  };
};
