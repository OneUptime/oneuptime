/*
 * How a table draws its header row, its rows and its cells (Table,
 * TableHeader, TableRow and the TableSkeletonRows a table shows while it
 * loads) - every ModelTable in the product, and the plain Tables beside
 * them.
 *
 * "How can we improve the UI of the model table so we make it easier for
 * people to understand and use, and make it cleaner and more modern?" - the
 * maintainer, on the Incidents list, whose "Incident Number" header broke
 * over two lines in bold black, whose every row repeated "No labels
 * attached." and "No owners.", whose cells were all a medium-weight grey,
 * and whose Duration ("10 days, 23 hours, 31 minutes") and resource names
 * pushed the table past the card's edge: the Actions column - each row's
 * View and its ⋯ - sat out of sight, to the right.
 *
 * What a table looks like now, and where each piece lives:
 *
 *   - The header row is quiet: the column names as the page writes them, in
 *     small grey type (text-xs, font-medium, gray-500) on a light band, and
 *     never broken over two lines. The column a list is sorted by is named
 *     in the reading colour with an arrow; any other sortable column shows a
 *     faint pair of arrows under the pointer.
 *   - A row's values are in the reading size (text-sm) on a 24px line
 *     (leading-6), regular weight, gray-700. A cell starts at its row's top
 *     (align-top), so a row whose resources take three lines still reads its
 *     other values on its first line, beside the first resource.
 *   - Rows are ruled off with the hairline a detail card rules its rows
 *     with (border-gray-100). A row lights up under the pointer, a row that
 *     opens its record takes the pointer's hand, and a ticked row keeps a
 *     light indigo wash.
 *   - The first cell of a row starts where the card's own text does (24px
 *     in, under the card's title), and the last cell ends as far in from the
 *     right edge. Between two columns there is 24px.
 *   - A value too long for its column is cut short with an ellipsis at
 *     20rem and shows in full under the pointer. A column of prose opts into
 *     wrapping instead (Column.wrapContent).
 *   - A table wider than its card gives way before it scrolls
 *     (useTableScrollState): its header's names may break between words
 *     (TABLE_HEADER_WRAP_ATTRIBUTE), then its long values are cut short a
 *     little more, never below 8rem (TABLE_VALUE_GIVE_ATTRIBUTE). Beside a
 *     side menu at 1280px a card is about 940px wide, and table after
 *     table - incidents, alerts, Runners, AI rules in German - ran under its
 *     sticky Actions column for a header of two words or a name 30px too
 *     long.
 *   - When the columns are wider than the card even so, the rows scroll
 *     sideways and the Actions column stays at the card's right edge, ruled
 *     off from the cells that pass under it - each row's View and ⋯ are
 *     never out of sight. When they fit, the header row stays under the
 *     page's top bar while a long page scrolls.
 *
 * Separate borders (border-separate, border-spacing-0) rather than
 * collapsed ones: a collapsed border belongs to the table's grid, not to a
 * cell, so it stays behind when a sticky cell moves, and a row's own border
 * (divide-y) is not drawn at all in the separate model. So every rule here
 * is a cell's own border.
 *
 * React-free on purpose: App's tests import it, and the skeleton rows lay
 * themselves out by the same rules as the rows they stand in for.
 */

export const TABLE_CLASS_NAME: string =
  "min-w-full border-separate border-spacing-0";

/*
 * Where a cell is in its row, counting every cell the row draws: a drag
 * grip and a select box come before the columns, and the Actions column is
 * a column.
 */
export interface TableCellPosition {
  isFirst: boolean;
  isLast: boolean;
}

/*
 * A cell's padding on the left and right: 24px at the row's two ends, so
 * the first value starts under the card's title and the last one ends as
 * far in from the card's edge; 12px everywhere else, 24px between two
 * columns.
 */
export const TABLE_CELL_EDGE_PADDING_LEFT_CLASS_NAME: string = "pl-6";
export const TABLE_CELL_EDGE_PADDING_RIGHT_CLASS_NAME: string = "pr-6";
export const TABLE_CELL_INNER_PADDING_LEFT_CLASS_NAME: string = "pl-3";
export const TABLE_CELL_INNER_PADDING_RIGHT_CLASS_NAME: string = "pr-3";

export const getTableCellPaddingClassName: (
  position: TableCellPosition,
) => string = (position: TableCellPosition): string => {
  return [
    position.isFirst
      ? TABLE_CELL_EDGE_PADDING_LEFT_CLASS_NAME
      : TABLE_CELL_INNER_PADDING_LEFT_CLASS_NAME,
    position.isLast
      ? TABLE_CELL_EDGE_PADDING_RIGHT_CLASS_NAME
      : TABLE_CELL_INNER_PADDING_RIGHT_CLASS_NAME,
  ].join(" ");
};

/*
 * A header cell (<th>): the band, ruled above and below, its text small,
 * grey and on one line. Its padding is on what it holds - the sort button
 * takes the whole cell, so the whole cell sorts.
 */
export const TABLE_HEADER_CELL_CLASS_NAME: string =
  "border-y border-gray-200 bg-gray-50 p-0 text-left align-middle text-xs font-medium text-gray-500";

/*
 * What a header cell holds: the column's name (and its sort arrow, and its
 * (i)) on one line. "Incident Number" broke over two lines in bold black,
 * the header row twice as tall as it needed to be.
 */
export const TABLE_HEADER_CONTENT_CLASS_NAME: string =
  "flex w-full items-center gap-1 whitespace-nowrap py-2.5";

/*
 * ...unless the table would otherwise run past its card: then the table
 * carries TABLE_HEADER_WRAP_ATTRIBUTE (useTableScrollState) and a name
 * breaks between its words, never inside one - "Project / Default" over a
 * column of ticks rather than the rows scrolling sideways under the sticky
 * Actions column. A header wider than every value under it was the column's
 * width: "Poll Interval (Minutes)" over "5", "Übereinstimmungskriterien"
 * beside it in German.
 */
export const TABLE_HEADER_WRAP_ATTRIBUTE: string = "data-wrap-headers";

export const TABLE_HEADER_CONTENT_WRAP_CLASS_NAME: string =
  "[[data-wrap-headers=true]_&]:whitespace-normal";

/*
 * The header row stays under the page's top bar (MasterPage publishes its
 * height as --app-header-height) while a long page scrolls - only while the
 * table is as wide as the card: when its rows scroll sideways the table is a
 * scroll box of its own, and a header stuck to the page could not scroll
 * with them (see useTableScrollState).
 */
export const TABLE_STICKY_HEADER_TOP_CLASS_NAME: string =
  "top-[var(--app-header-height,0px)]";

export const TABLE_STICKY_HEADER_CELL_CLASS_NAME: string = `sticky ${TABLE_STICKY_HEADER_TOP_CLASS_NAME} z-[2]`;

// A sortable column's name: the whole cell is the button.
export const TABLE_SORT_BUTTON_CLASS_NAME: string =
  "group/sort cursor-pointer text-left font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500";

/*
 * The column the list is sorted by: its name in the reading colour. Any
 * other sortable column's name is the band's grey until it is pointed at.
 */
export const TABLE_SORTED_COLUMN_CLASS_NAME: string = "text-gray-900";

export const TABLE_UNSORTED_COLUMN_CLASS_NAME: string =
  "text-gray-500 hover:text-gray-900";

// The arrow beside the sorted column's name.
export const TABLE_SORT_ARROW_CLASS_NAME: string =
  "h-3.5 w-3.5 flex-none text-gray-700";

/*
 * The faint pair of arrows a sortable column shows under the pointer, so a
 * header that can sort says so before it is clicked.
 */
export const TABLE_SORT_HINT_CLASS_NAME: string =
  "h-3.5 w-3.5 flex-none text-gray-400 opacity-0 transition-opacity duration-150 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100";

/*
 * A row (<tr>): white, so the cells that stick at its end (bg-inherit) are
 * as opaque as the row they belong to; lit under the pointer. A row that is
 * ticked keeps a light indigo wash, and does not flash grey under the
 * pointer.
 */
export const TABLE_ROW_CLASS_NAME: string =
  "bg-white transition-colors duration-150 hover:bg-gray-50";

export const TABLE_SELECTED_ROW_CLASS_NAME: string =
  "bg-indigo-50 transition-colors duration-150";

// A row that opens its record when it is clicked.
export const TABLE_CLICKABLE_ROW_CLASS_NAME: string = "cursor-pointer";

/*
 * A body cell (<td>): the reading size on a 24px line.
 */
export const TABLE_BODY_CELL_CLASS_NAME: string =
  "py-3 align-top text-sm leading-6";

/*
 * Its words: regular weight, gray-700 - the values were all a medium-weight
 * gray-500, names and dates alike, so nothing in a row stood out and
 * nothing read as plain text.
 */
export const TABLE_CELL_TEXT_CLASS_NAME: string = "font-normal text-gray-700";

/*
 * The row's first column - in almost every list the record's name - in the
 * reading colour and a step heavier, so the eye finds each row by it, as a
 * list in Linear or Vercel leads with its name.
 */
export const TABLE_PRIMARY_CELL_TEXT_CLASS_NAME: string =
  "font-medium text-gray-900";

/*
 * The hairline under a row. Left off the last row: the footer's own rule
 * is right under it.
 */
export const TABLE_ROW_RULE_CLASS_NAME: string = "border-b border-gray-100";

/*
 * The cells before the columns: a drag grip (28px tall, so 10px above and
 * below it make the row's 48px) and a select box (on the row's 24px line).
 */
export const TABLE_DRAG_HANDLE_CELL_CLASS_NAME: string =
  "w-px whitespace-nowrap py-2.5 align-top";

export const TABLE_SELECT_CELL_CLASS_NAME: string =
  "w-px whitespace-nowrap py-3 align-top";

/*
 * The header's select-all box, on the band's 36px: its 24px line, 6px above
 * and below.
 */
export const TABLE_HEADER_SELECT_CELL_CLASS_NAME: string =
  "w-px whitespace-nowrap py-1.5";

/*
 * The Actions column (a row's View and ⋯). Its header cell keeps the band's
 * colour; a row's cell takes its row's (bg-inherit), so it is as opaque as
 * the row - white, lit under the pointer, washed when ticked.
 *
 * It sticks at the table's right edge, and only matters when the rows
 * scroll sideways: then the cells passing under it are cut off by a rule
 * and a soft shadow on its left (TABLE_STUCK_END_CELL_CLASS_NAME), so the
 * row's View and ⋯ are always in sight.
 */
export const TABLE_STICKY_END_HEADER_CELL_CLASS_NAME: string =
  "sticky right-0 z-[3]";

export const TABLE_STICKY_END_BODY_CELL_CLASS_NAME: string =
  "sticky right-0 z-[1] bg-inherit";

export const TABLE_STUCK_END_CELL_CLASS_NAME: string =
  "border-l border-gray-200 shadow-[-8px_0_12px_-10px_rgba(15,23,42,0.18)]";

/*
 * The 30px row button and ⋯ sit centred on the row's 24px line: 3px above
 * and below it are taken back, so a row of one line is 48px tall with or
 * without its buttons. leading-none: the ⋯'s box would otherwise add the
 * cell's line spacing under its button, and stand 2px taller than it.
 */
export const TABLE_ACTIONS_CONTENT_CLASS_NAME: string =
  "-my-[3px] leading-none";

/*
 * How wide a one-line value may grow before it is cut short with an
 * ellipsis. A name, a title, a resource or a URL used to widen its column to
 * the whole value - one long status page name made a table 1400px wide in a
 * 1200px card, its Actions column out of sight.
 *
 * The cap is a fixed length, not a share of the table: a table cell's width
 * is worked out from its content's, and a percentage of a width that is not
 * known yet does not hold anything back. It is always drawn together with
 * the clip and the ellipsis (TABLE_CELL_TRUNCATE_CLASS_NAMES): a cap on a
 * line that does not wrap, without a clip, is how a sentence came to be
 * painted over the cells beside it (OneUptime issue #3585).
 *
 * overflow-x-clip rather than overflow-hidden: a clip in one direction
 * leaves the other alone, so a pill's ring, an avatar lifted under the
 * pointer and a focus ring above and below a link still show.
 */
export const TABLE_CELL_MAX_WIDTH_CLASS_NAME: string = "max-w-[20rem]";

/*
 * A record's link (a monitor, a host, a cluster - MonitorElement and its
 * fourteen siblings) draws its icon and name in a flex row: <span
 * class="flex"><div><svg/></div> name</span>. No ellipsis reaches the text
 * of a flex row, so a long name was cut off mid-letter at the cell's edge.
 * In a table's cell that row is laid out as a line of text instead - the
 * icon an inline box, centred on the name - and the name ends in "...".
 * Matched on that exact class, so a flex row of any other shape is left
 * alone.
 */
export const TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES: string =
  "[&_span[class=flex]]:inline [&_span[class=flex]>div]:inline-block [&_span[class=flex]>div]:align-middle";

/*
 * A one-line value's parts on the row's 24px line. A page that draws its
 * value as <span className="text-sm ...">router</span> - a key in a mono
 * font, a count, a status word, some thirty columns - brings text-sm's 20px
 * line with it, and set at the top of the row's 24px line its words stood
 * 2px above the values beside them. Its line is the row's again; a part
 * laid out as a box of its own (a pill, a label, an avatar: inline-flex,
 * inline-block) keeps its own height.
 */
export const TABLE_CELL_PART_LINE_CLASS_NAME: string =
  "[&>:is(span,p,div,a):not([class*=inline-])]:leading-6";

export const TABLE_CELL_TRUNCATE_CLASS_NAMES: string = `overflow-x-clip text-ellipsis ${TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES} ${TABLE_CELL_PART_LINE_CLASS_NAME}`;

/*
 * The narrowest a column of prose (Column.wrapContent) is drawn. When the
 * columns are wider than the card, a table gives every column the least
 * room its content can take - for a sentence that wraps, its longest word -
 * and a description stood two words wide, five lines tall. 10rem is no
 * wider than the narrowest cap a page gives such a column (max-w-48).
 */
export const TABLE_WRAP_CELL_MIN_WIDTH_CLASS_NAME: string = "min-w-[10rem]";

/*
 * What a cell holds sits at the top of the row's 24px line: a pill (23px)
 * or an avatar set on the text's baseline pushed the line a pixel or two
 * taller, and every row with one stood taller than the rows without.
 */
export const TABLE_CELL_CONTENT_ALIGN_CLASS_NAME: string = "[&>*]:align-top";

/*
 * The value of a row's name - its first column, drawn as a line of text -
 * while its table fits its card (data-fill="true", set on the value by
 * useTableScrollState): it loses the 20rem cap and may break anywhere for
 * the table's measuring - so its column claims the room the whole name
 * would take, and gives way where the room runs out - while only its first
 * line is shown, ending in an ellipsis where it is cut short. So a long
 * name uses the room its row has and is cut short only where its column
 * ends, never at 20rem with half the row empty; and a column of prose
 * beside it keeps its share. A long name gives way before the table
 * scrolls sideways - down to 10rem, the floor a column of prose has; when
 * even that does not fit, the rows scroll and the name keeps its 20rem cap,
 * since the table is wider than the card anyway.
 */
export const TABLE_PRIMARY_FILL_CONTENT_CLASS_NAME: string =
  "data-[fill=true]:max-w-none data-[fill=true]:min-w-[10rem] data-[fill=true]:whitespace-normal data-[fill=true]:[overflow-wrap:anywhere] data-[fill=true]:line-clamp-1";

/*
 * A value that may be cut short a little more when its table would
 * otherwise run past its card (useTableScrollState marks it with
 * TABLE_VALUE_GIVE_ATTRIBUTE). Only a value wider than the floor is cut
 * short, never below it, and the table then shares out the room it has:
 * each value keeps as much of itself as the others leave it, and shows the
 * rest under the pointer (FullValueTitle). A value of a line of text ("line")
 * wraps anywhere for the table's measuring and shows only its first line,
 * as a row's name does; a list or a pill ("box" - TableColumnListComponent,
 * Pill, each of whose items ends in "..." of its own) is laid out in a grid
 * of one column that it shrinks in. Dates, numbers, ticks and colours are
 * never cut short, and a column a page sized itself keeps its size.
 */
export const TABLE_VALUE_ATTRIBUTE: string = "data-table-value";

export const TABLE_VALUE_GIVE_ATTRIBUTE: string = "data-give";

// The least a value is cut short to: 8rem.
export const TABLE_VALUE_GIVE_FLOOR_IN_PX: number = 128;

export const TABLE_VALUE_GIVE_CLASS_NAME: string = [
  "data-[give=line]:min-w-[8rem] data-[give=line]:whitespace-normal data-[give=line]:[overflow-wrap:anywhere] data-[give=line]:line-clamp-1",
  "data-[give=box]:grid data-[give=box]:min-w-[8rem] data-[give=box]:grid-cols-1 data-[give=box]:justify-items-start [&[data-give=box]>*]:min-w-0 [&[data-give=box]>*]:max-w-full",
].join(" ");

/*
 * What a list or a pill carries to say its words end in "..." of their own
 * where its box ends, so a value made only of such parts can be cut short
 * as a box (TABLE_VALUE_GIVE_CLASS_NAME).
 */
export const TABLE_SHRINKABLE_ATTRIBUTE: string = "data-table-shrinks";

/*
 * Whether a column's own content classes already name a width cap - a page
 * that measured its columns (McpServer's "max-w-[10rem] 2xl:max-w-[18rem]").
 * Two max-w-* utilities on one element are resolved by the stylesheet's
 * order, not the order they are written in, so the table's own cap is left
 * off and the page's is kept.
 */
export const hasMaxWidthClassName: (
  className: string | undefined,
) => boolean = (className: string | undefined): boolean => {
  return namesUtility(className, "max-w-");
};

/*
 * And whether they name a floor of their own - the On-Call logs' "Triggered
 * By" title, never narrower than 12rem beside the side menu. Two min-w-*
 * utilities on one element are resolved the same way, so the table's own
 * 10rem floor for a column of prose is left off and the page's is kept.
 */
export const hasMinWidthClassName: (
  className: string | undefined,
) => boolean = (className: string | undefined): boolean => {
  return namesUtility(className, "min-w-");
};

// Whether a class string holds a utility of this kind, under any variant.
function namesUtility(className: string | undefined, prefix: string): boolean {
  if (!className) {
    return false;
  }

  return className.split(" ").some((token: string): boolean => {
    const utility: string = token.slice(token.lastIndexOf(":") + 1);

    return utility.startsWith(prefix);
  });
}

/*
 * One item of a list in a cell (TableColumnListComponent - a row's
 * resources, monitors or teams): on its own line, cut short with an
 * ellipsis when it is wider than the column - a record's link laid out as
 * a line of text, so its name ends in "..." rather than mid-letter
 * (TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES).
 */
export const TABLE_LIST_ITEM_CLASS_NAME: string = `truncate ${TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES}`;

/*
 * The same item in a field of a phone's card (TableCardContext): the card
 * gives it the screen's width and no pointer shows a name cut short in
 * full, so a long name runs onto the next line beside its icon, as in a
 * detail card. On the alerts list, whose Affected Resources is the one
 * place a row names its monitor, a phone read "oneuptime-test - High Node
 * Memory Utili..." and no more. A name with no place to break (a host's
 * address) breaks anywhere rather than push the card past the screen's
 * edge.
 */
export const TABLE_CARD_LIST_ITEM_CLASS_NAME: string =
  "[overflow-wrap:anywhere]";

/*
 * On a phone a row is a card: the column names over their values, as a
 * detail card writes its fields (the same quiet name, the same reading
 * value), with the row's controls at its top.
 *
 * The rows run to the card's edges there too (TABLE_SCROLL_BOX_CLASS_NAME),
 * their rules and a ticked row's wash across the whole card, and their text
 * starts where the card's own does: 20px in, the card's padding on a phone.
 * They were inset another 16px inside the card's padding - a list in a box,
 * its names 16px right of the card's title and filters, and 32px narrower.
 */
export const TABLE_MOBILE_ROW_CLASS_NAME: string =
  "bg-white px-5 py-4 transition-colors duration-150";

/*
 * A ticked card: its light indigo wash in place of the white, not on top
 * of it - in the dark theme bg-white is painted with !important, and the
 * wash written beside it never showed.
 */
export const TABLE_MOBILE_SELECTED_ROW_CLASS_NAME: string =
  "bg-indigo-50 px-5 py-4 transition-colors duration-150";

/*
 * The box the table is drawn in reaches the card's edges, as a card's ruled
 * body does (Card/CardSurface's CARD_RULED_BODY_CLASS_NAME): through the
 * card's padding, 20px on a phone and 24px from md up. Its rows' ends pad
 * their text back to where the card's own text starts. relative: the box
 * is the containing block of what is positioned absolutely inside it - a
 * screen reader's words (sr-only) in a cell scrolled out of sight - so its
 * scroll clips them; without it they widened the whole page.
 */
export const TABLE_SCROLL_BOX_CLASS_NAME: string = "relative -mx-5 md:-mx-6";

/*
 * The footer under the rows reaches the card's edges and its bottom the
 * same way, its pagination bar padded to the card's text
 * (Pagination's DefaultPaginationSize).
 */
export const TABLE_FOOTER_BLEED_CLASS_NAME: string = "-mx-5 -mb-6 md:-mx-6";

/*
 * A field of a card: its name over its value. A field whose value is only
 * the quiet dash is left out - TableRow leaves out the empty values it can
 * tell before they are drawn, and this the ones a page's own element draws
 * (a record's labels, its owners), which say they are empty only once
 * drawn.
 */
export const TABLE_MOBILE_FIELD_CLASS_NAME: string =
  "flex flex-col [&:has(>dd>[data-testid=table-empty-value]:only-child)]:hidden";

export const TABLE_MOBILE_FIELD_NAME_CLASS_NAME: string =
  "text-xs font-medium text-gray-500";

export const TABLE_MOBILE_FIELD_VALUE_CLASS_NAME: string =
  "min-w-0 break-words text-sm leading-6 text-gray-900";
