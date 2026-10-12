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
 * Pure: no DOM, no React Flow.
 */

import { WORKFLOW_NODE_WIDTH } from "./NodePlacement";

// The narrowest column an output gets, and the widest one a long name gets.
export const MIN_OUTPUT_COLUMN_WIDTH: number = 72;
export const MAX_OUTPUT_COLUMN_WIDTH: number = 160;

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

  const columnWidth: number = Math.min(
    MAX_OUTPUT_COLUMN_WIDTH,
    Math.max(
      MIN_OUTPUT_COLUMN_WIDTH,
      Math.ceil(longest * CHARACTER_WIDTH) + COLUMN_PADDING,
    ),
  );

  const width: number = columnWidth * count;

  return {
    widerCardWidth: width > WORKFLOW_NODE_WIDTH ? width : null,
    dotLeftPercents: titles.map((_title: string, index: number): number => {
      return ((index + 0.5) / count) * 100;
    }),
  };
};
