/*
 * THE SMALL LABELS OF THE ON-CALL PAGES - "On call right now", "Who gets
 * paged", "Cannot be paged", "Notification methods", a timeline's "Schedule"
 * column - in the reading's own case.
 *
 * They were letter-spaced capitals, as no other label in the product is any
 * more (#5282's Final schedule, #5412's UI review): capitals shout over the
 * words they label, spell a team's or a schedule's own name as nobody typed
 * it, and Persian, Hindi, Chinese, Japanese and Korean have none - beside
 * them the English labels read as a different kind of text. Grey-500, where
 * a label sits on white: grey-400 there is too pale to read.
 *
 * App's OnCallNoLetterSpacedCapitals holds every on-call component and page
 * to it.
 */

// A label over a part of a card, with an icon or a count beside it, or alone.
export const ON_CALL_SECTION_LABEL_CLASS_NAME: string =
  "flex items-center gap-1.5 text-xs font-semibold";

// Its colour on white.
export const ON_CALL_SECTION_LABEL_COLOR_CLASS_NAME: string = "text-gray-500";

// A label over a part of a card, in its colour: the usual case.
export const ON_CALL_SECTION_LABEL_ON_WHITE_CLASS_NAME: string = `${ON_CALL_SECTION_LABEL_CLASS_NAME} ${ON_CALL_SECTION_LABEL_COLOR_CLASS_NAME}`;

// A small table's column heading, as the labels around it read.
export const ON_CALL_COLUMN_HEADING_CLASS_NAME: string =
  "text-xs font-medium text-gray-500";

/*
 * A word in a small tag after a name - "On call now", "You", "No one on
 * call" - in the reading's own case, at a size a phone still reads.
 */
export const ON_CALL_TAG_TEXT_CLASS_NAME: string =
  "whitespace-nowrap text-[11px] font-semibold";
