import { MORE_FIELDS_SECTION_TITLE } from "./FoldedSectionTitles";

/*
 * How a fold is drawn (FoldedSection). React-free, so a form's field types
 * (Forms/Types/Field) can name it.
 *
 *   - "card": a framed block - a header with the title, what is inside as
 *     pills and chips, and a chevron at its end. A page's More settings,
 *     among the page's cards (AdvancedPageSection), and the sections a form
 *     folds that are named for what they hold ("Subscriber Notifications",
 *     "Add a public note", "Layout").
 *   - "line": one quiet line of text - a small chevron, the title as a
 *     link, and what is inside after it ("More fields · Description,
 *     Labels") - with no frame, no icon tile and no pills. Open, the fields
 *     follow the line as part of the form, not as a box of their own.
 *
 * Every More fields fold is the line, wherever it is drawn: a form's
 * (getAdvancedFormSection) and a hand-built editor's (a FoldedSection
 * titled MORE_FIELDS_SECTION_TITLE, as the monitor form draws its own). The
 * maintainer, on the card it used to be: "Can we make this more subtle,
 * this needs to be done across the project for more fields. Takes up too
 * much real estate right now." The look goes with the name, the way side
 * menus fold their sections by title (SideMenuSectionState), so no editor
 * has to remember it and none can draw a More fields card.
 */
export type FoldedSectionVariant = "card" | "line";

export const FOLDED_SECTION_CARD: FoldedSectionVariant = "card";

export const FOLDED_SECTION_LINE: FoldedSectionVariant = "line";

export type GetFoldedSectionVariantFunction = (data: {
  // The English title the fold is given (looked up when it is drawn).
  title: string;
  // What the fold asks for; left out, a card.
  variant?: FoldedSectionVariant | undefined;
}) => FoldedSectionVariant;

// The look a fold is drawn with: More fields is always the line.
export const getFoldedSectionVariant: GetFoldedSectionVariantFunction = (data: {
  title: string;
  variant?: FoldedSectionVariant | undefined;
}): FoldedSectionVariant => {
  if (data.title === MORE_FIELDS_SECTION_TITLE) {
    return FOLDED_SECTION_LINE;
  }

  return data.variant || FOLDED_SECTION_CARD;
};
