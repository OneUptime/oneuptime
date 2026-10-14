import Handlebars from "handlebars";

/*
 * DIVIDERS BETWEEN THE ROWS OF AN EMAIL'S DETAIL CARD, NEVER AFTER THE LAST.
 *
 * A detail card is the grey box most emails list their details in:
 * Partials/DetailBoxStart, then its rows - DetailBoxField (and the
 * IncidentCustomFieldRows that render through it), StateTransition and
 * StatusTransition - then Partials/DetailBoxEnd. A hairline divider
 * separates one row from the next.
 *
 * Each row used to draw that divider under itself, and a
 * `.st-DetailCard-field:last-child` rule in the <style> block took the last
 * one away again. Inline styles are what every mail client keeps; a <style>
 * block is not: Gmail drops the pseudo-class rule and some clients drop the
 * whole block. Their readers saw the last row's divider sitting on the
 * card's bottom border with nothing after it.
 *
 * So a divider is drawn between two rows and nowhere else: each row draws
 * it ABOVE itself, unless it is the first row of its card. Which row is
 * last cannot be known while it renders - a template's rows are
 * conditional ({{#if}}, {{#ifNotCond}}) and loops ({{#each}}) - but which
 * one is first can: the card counts its rows as they render.
 *
 *   DetailBoxStart   {{detailCardStart}}       opens a card: no rows yet
 *   each row         {{#detailCardDivider}}    renders its block - the
 *                      ...                     divider's style - for every
 *                    {{/detailCardDivider}}    row but the card's first,
 *                                              and counts the row
 *   DetailBoxEnd     {{detailCardEnd}}         closes the card
 *
 * A row calls detailCardDivider exactly once, in the style of its outer
 * element (EmailDetailCardDividers.test.ts holds every row partial to that).
 * A row outside any card has nothing to be divided from and draws none.
 *
 * The count is kept in the Handlebars data frame of the render that draws
 * the card, never in this module: a frame belongs to one render of one
 * email, so two emails - or two recipients of one - never share a count.
 * DetailBoxStart and its rows share that frame: a partial runs in its
 * caller's frame, and a block helper such as {{#each}} gives its block a
 * copy of the frame it starts in, which holds the same card.
 *
 * Production registers these on the Handlebars instance MailService renders
 * with (Utils/Handlebars.ts). A test, harness or preview that renders the
 * templates with an engine of its own registers them with
 * registerEmailDetailCardHelpers. Where they are missing, the partials still
 * render - a block helper Handlebars does not know is read as a value that
 * is not there - just without dividers.
 */

// The key the open card is kept under in a render's data frame.
export const DETAIL_CARD_DATA_KEY: string = "oneuptimeEmailDetailCard";

interface DetailCard {
  // Rows this card has drawn so far.
  rows: number;
  // False once DetailBoxEnd has closed it.
  isOpen: boolean;
}

type HandlebarsEngine = typeof Handlebars;

type DataFrame = Record<string, unknown>;

// The render's data frame a helper was called in, if the render has one.
const dataFrameOf: (options: unknown) => DataFrame | null = (
  options: unknown,
): DataFrame | null => {
  const data: unknown = (options as { data?: unknown } | undefined)?.data;

  return data && typeof data === "object" ? (data as DataFrame) : null;
};

// The card open in a render's data frame, if one is.
const openCardOf: (options: unknown) => DetailCard | null = (
  options: unknown,
): DetailCard | null => {
  const card: unknown = dataFrameOf(options)?.[DETAIL_CARD_DATA_KEY];

  if (!card || typeof card !== "object" || !(card as DetailCard).isOpen) {
    return null;
  }

  return card as DetailCard;
};

/*
 * {{detailCardStart}}: a new card opens in this render, with no rows yet. It
 * prints nothing.
 */
export const detailCardStart: (options: unknown) => string = (
  options: unknown,
): string => {
  const data: DataFrame | null = dataFrameOf(options);

  if (data) {
    const card: DetailCard = { rows: 0, isOpen: true };
    data[DETAIL_CARD_DATA_KEY] = card;
  }

  return "";
};

/*
 * {{#detailCardDivider}}...{{/detailCardDivider}}: the block - a row's
 * divider style - for every row of a card but its first, and nothing for
 * the first row or a row outside any card. Counts the row.
 */
export const detailCardDivider: (
  this: unknown,
  options: Handlebars.HelperOptions,
) => string = function (
  this: unknown,
  options: Handlebars.HelperOptions,
): string {
  const card: DetailCard | null = openCardOf(options);

  if (!card) {
    return "";
  }

  card.rows += 1;

  return card.rows > 1 ? options.fn(this) : "";
};

/*
 * {{detailCardEnd}}: the card is closed, so a row after it is not counted
 * as one of its rows. It prints nothing.
 */
export const detailCardEnd: (options: unknown) => string = (
  options: unknown,
): string => {
  const card: DetailCard | null = openCardOf(options);

  if (card) {
    card.isOpen = false;
  }

  return "";
};

/*
 * Registers detailCardStart, detailCardDivider and detailCardEnd on a
 * Handlebars instance: the global one MailService renders with, or a test's
 * own engine.
 */
export const registerEmailDetailCardHelpers: (
  handlebars: HandlebarsEngine,
) => void = (handlebars: HandlebarsEngine): void => {
  handlebars.registerHelper("detailCardStart", detailCardStart);
  handlebars.registerHelper("detailCardDivider", detailCardDivider);
  handlebars.registerHelper("detailCardEnd", detailCardEnd);
};
