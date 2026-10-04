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

// The pill: shape, border, fill and hover. The colours come from below.
export const FILTER_CHIP_BOX_CLASSES: string =
  "relative inline-flex rounded-full border transition-all";

/*
 * The chip's own button covers the whole pill: its -1px margin and clear 1px
 * border lie over the pill's border, so its text and its focus ring sit where
 * they sit on a chip that is one button.
 */
export const FILTER_CHIP_TRIGGER_CLASSES: string =
  "group -m-px inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-xs font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1";

export const FILTER_CHIP_ACTIVE_CLASSES: string =
  "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm hover:border-indigo-300 hover:bg-indigo-100";

export const FILTER_CHIP_INACTIVE_CLASSES: string =
  "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50";

export const FILTER_CHIP_POPOVER_CLASSES: string =
  "absolute left-0 top-full z-20 mt-2 origin-top-left overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl ring-1 ring-black/5";

/*
 * The empty place the chip's button keeps at its end for the clear button,
 * which is laid over it (right-2.5: the button's px-2.5).
 */
export const FILTER_CHIP_CLEAR_PLACE_CLASSES: string =
  "ml-0.5 inline-flex h-4 w-4";

export const FILTER_CHIP_CLEAR_CLASSES: string =
  "absolute right-2.5 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full text-indigo-400 transition-colors hover:bg-indigo-200 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

export const FILTER_CHIP_OPERATOR_SELECT_CLASSES: string =
  "cursor-pointer rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-medium text-gray-700 hover:border-gray-300 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400";
