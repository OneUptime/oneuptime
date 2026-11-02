/*
 * How Connected Signals lays out an entry - a record it names, and a value
 * it found in the logs and traces - so the two read as one list: an icon in
 * its square, the name beside it, and the entry's facts in a column under
 * the name, their labels lined up down the card.
 *
 * React-free, so the components and the tests that measure them read the
 * very same classes.
 */

/*
 * An entry's text column: its name, its sentence and its facts. The size
 * container a fact's row reads, so the row lays out by the entry's own
 * width, not the window's.
 */
export const CONNECTED_RECORD_TEXT_CLASS_NAME: string =
  "min-w-0 flex-1 [container-type:inline-size]";

/*
 * A fact's row: its label above its items in a narrow entry (a phone, a
 * case beside its side menu on a tablet), beside them from 32rem of the
 * entry's own width (the event drawer, a laptop's page) - so the labels
 * line up down the card and the items read as a column.
 */
export const CONNECTED_FACT_ROW_CLASS_NAME: string =
  "grid grid-cols-1 gap-x-4 gap-y-1 [@container(min-width:32rem)]:grid-cols-[11rem_minmax(0,1fr)]";

// An entry's icon, in its square beside the name.
export const CONNECTED_ENTRY_ICON_CLASS_NAME: string =
  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-50 ring-1 ring-inset ring-gray-200";
