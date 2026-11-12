/*
 * A STATUS PAGE RESOURCE'S NAME, CUT SHORT WHERE ITS BOX ENDS.
 *
 * Status Page > Resources names each resource by its monitor's (or monitor
 * group's) link, handed in by the Dashboard (getResourceElement). With the
 * monitor groups feature off, the link draws its name alone inside a flex
 * span - <span class="flex"> name</span>, the bare shape a record link with
 * no icon draws, as table cells read it - and text-overflow does not reach
 * the anonymous item a flex container makes of its text: a long name was
 * clipped mid-letter with no "...". Laid out as a block, that span puts the
 * name back in an inline formatting context, where truncation means what
 * it says, and it takes its holder's reading direction and alignment (the
 * Dashboard's StatusPageResourceName sets them by the name's own words).
 *
 * Only that bare flex span: with monitor groups on, each name is drawn
 * beside its kind's icon, in a row whose name is a line of its own that
 * cuts itself short (the Dashboard's RecordLinkName). Laid out as a block
 * too, that row put its icon on a line of its own above the name. The
 * selector matches a class attribute that is exactly "flex", never the
 * icon row's "inline-flex ...".
 */
export const RESOURCE_BARE_NAME_CLASS_NAME: string =
  "[&_span[class=flex]]:block [&_span[class=flex]]:truncate";

/*
 * The name on a grid's chip (ResourceGrid): one line that ends in "...",
 * as a list's row draws it (ResourceList's RESOURCE_ROW_NAME_CLASS_NAME),
 * in the chip's smaller type.
 */
export const RESOURCE_CHIP_NAME_CLASS_NAME: string = `truncate font-medium text-gray-900 ${RESOURCE_BARE_NAME_CLASS_NAME}`;

/*
 * A chip's words in a grid's cell (ResourceGrid): its name and the name it
 * is shown under. A table's column is as wide as the longest line in it,
 * and these are lines that do not wrap, so a long name widened its column
 * instead of ending in "...": the grid ran past its card at any width, the
 * next column was cut off mid-word, and on an Arabic or Persian phone,
 * where the grid scrolls from the right, an English name showed its end
 * and not its start. Contained in the inline axis (contain: inline-size),
 * the words never size their column: it is as wide as its heading and its
 * share of the grid, and a name too long for it ends in "..." at its own
 * end, the whole of it on hover.
 */
export const RESOURCE_CHIP_TEXT_CLASS_NAME: string =
  "min-w-0 flex-1 [contain:inline-size]";
