import { FeedHealth } from "./CalendarFeedUtil";

/*
 * How a calendar link card lays out its body, shared by the personal link
 * (PersonalCalendarFeedCard) and the shared ones (SharedCalendarFeedCard) so
 * the two read as one family.
 *
 * The subscribe options and the status side by side once the card is wide
 * enough for both - from xl, where the card is about 900px with a side menu
 * beside it - three fifths and two fifths; one above the other below that,
 * subscribing first.
 */
export const FEED_BODY_GRID_CLASS_NAME: string =
  "grid grid-cols-1 gap-6 xl:grid-cols-5";

export const FEED_SUBSCRIBE_COLUMN_CLASS_NAME: string = "min-w-0 xl:col-span-3";

export const FEED_STATUS_COLUMN_CLASS_NAME: string = "min-w-0 xl:col-span-2";

// A link that cannot be shown has no subscribe options: the status has the row.
export const FEED_STATUS_FULL_WIDTH_CLASS_NAME: string =
  "min-w-0 xl:col-span-5";

/*
 * A button that starts a column of text inside the card - Generate calendar
 * link and Publish shared link in the empty panel, Enable link and
 * Regenerate link in the status - lines up with the text above it. Button
 * keeps a left margin for a dialog's footer from md up (md:ml-3), which set
 * each of them 12px in from the text it belongs to.
 */
export const FEED_PANEL_BUTTON_CLASS_NAME: string = "md:!ml-0";

/*
 * A state that needs the reader's attention - off, unreadable, never read in
 * two days - puts the status first while the two columns are stacked, so a
 * phone shows the problem before the options it affects.
 */
export const FEED_ATTENTION_FIRST_CLASS_NAME: string = "max-xl:order-first";

export const isAttentionHealth: (health: FeedHealth) => boolean = (
  health: FeedHealth,
): boolean => {
  return (
    health === FeedHealth.Disabled ||
    health === FeedHealth.NeedsRegeneration ||
    health === FeedHealth.NotFetched
  );
};

// The status column's classes for a link in this state.
export const getFeedStatusColumnClassName: (data: {
  hasLink: boolean;
  health: FeedHealth;
}) => string = (data: { hasLink: boolean; health: FeedHealth }): string => {
  const column: string = data.hasLink
    ? FEED_STATUS_COLUMN_CLASS_NAME
    : FEED_STATUS_FULL_WIDTH_CLASS_NAME;

  return isAttentionHealth(data.health)
    ? `${column} ${FEED_ATTENTION_FIRST_CLASS_NAME}`
    : column;
};
