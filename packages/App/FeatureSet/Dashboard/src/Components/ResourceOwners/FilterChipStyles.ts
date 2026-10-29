/*
 * The chip's look, in one place because there is now more than one kind of chip
 * in the bar.
 *
 * A date chip that sat a shade off its neighbours would read as a different
 * class of control rather than as the same control over a different column —
 * and the bar's whole claim is that every filter on the list is one of these.
 *
 * A chip is two buttons in one pill (FilterChipButton): the chip itself, which
 * opens its popover, and the clear button beside what it says. The pill is
 * drawn by a wrapper around both, so pointing at the clear button lights the
 * pill as pointing at the chip does.
 */

/*
 * The row the chips sit in: on the card itself, between the card's header
 * and the table, with the space the table's header band needs above it. It
 * used to be a bordered, shadowed box of its own inside the card - a box in
 * a box, with a divider inside it - that drew more than the table did.
 */
export const FACET_FILTER_BAR_CLASS_NAME: string =
  "-mt-1 mb-4 flex flex-wrap items-center gap-x-2 gap-y-2";

/*
 * The row folded, on a phone: a chip that holds no filter is not drawn
 * (FilterChipButton marks each chip data-filter-chip-set), with the place
 * it sits in. What the list is filtered by stays in sight, and so does
 * everything else in the row - "Filter", "Clear all", the rule library's
 * count of rules.
 */
export const FACET_FILTER_BAR_FOLDED_CLASS_NAME: string =
  "[&>*:has([data-filter-chip-set=false])]:hidden";

/*
 * The pill: shape, border, fill and hover. The colours come from below.
 * Never wider than the place it is given (max-w-full): a dropdown chip's
 * place is never wider than the bar (FILTER_CHIP_PLACE_CLASSES).
 *
 * It hangs from the top of its line (align-top), so a chip with a value
 * stands where an empty one does. On the line's baseline, a chip whose
 * value is cut short ("Browser · Chrome", truncate) sat 1px below its
 * neighbours and made its place - and the whole chips row - 1px taller
 * the moment a filter was picked.
 */
export const FILTER_CHIP_BOX_CLASSES: string =
  "relative inline-flex max-w-full rounded-full border align-top transition-all";

/*
 * The chip's own button covers the whole pill: its -1px margin and clear 1px
 * border lie over the pill's border, so its text and its focus ring sit where
 * they sit on a chip that is one button.
 */
export const FILTER_CHIP_TRIGGER_CLASSES: string =
  "group -m-px inline-flex min-w-0 items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-xs font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1";

/*
 * Where a dropdown chip sits in the bar (FilterChipDropdown): its popover
 * hangs from it, and it is never wider than the bar. A chosen value can be
 * long - "Monitor · oneuptime-test - High Node Memory Utilization", picked
 * on the alerts list - and the chip ran past the card's edge on a phone,
 * the whole page scrolling sideways with it.
 */
export const FILTER_CHIP_PLACE_CLASSES: string =
  "relative inline-block min-w-0 max-w-full";

/*
 * What a dropdown chip says - its name, and the value picked: on one line,
 * ending in "..." where the bar ends, the whole of it under the pointer
 * (showFullValueWhenCutShort). The chip's button is still named by all of
 * it.
 */
export const FILTER_CHIP_TEXT_CLASSES: string = "min-w-0 truncate";

export const FILTER_CHIP_ACTIVE_CLASSES: string =
  "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm hover:border-indigo-300 hover:bg-indigo-100";

export const FILTER_CHIP_INACTIVE_CLASSES: string =
  "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50";

/*
 * The popover hangs from the chip's left edge. It is never wider than the
 * screen less the page's margins (a 24rem date range on a 390px phone), and
 * one that would cross the screen's right edge moves left to keep inside it
 * (useChipPopoverShift, FilterChipPopoverPlacement).
 */
export const FILTER_CHIP_POPOVER_CLASSES: string =
  "absolute left-0 top-full z-20 mt-2 max-w-[calc(100vw-2rem)] origin-top-left overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl ring-1 ring-black/5";

/*
 * The empty place the chip's button keeps at its end for the clear button,
 * which is laid over it (right-2.5: the button's px-2.5).
 */
export const FILTER_CHIP_CLEAR_PLACE_CLASSES: string =
  "ml-0.5 inline-flex h-4 w-4 shrink-0";

export const FILTER_CHIP_CLEAR_CLASSES: string =
  "absolute right-2.5 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full text-indigo-400 transition-colors hover:bg-indigo-200 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

export const FILTER_CHIP_OPERATOR_SELECT_CLASSES: string =
  "cursor-pointer rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-medium text-gray-700 hover:border-gray-300 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400";
