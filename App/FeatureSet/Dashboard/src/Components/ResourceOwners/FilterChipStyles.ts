/*
 * The chip's look, in one place because there is now more than one kind of chip
 * in the bar.
 *
 * A date chip that sat a shade off its neighbours would read as a different
 * class of control rather than as the same control over a different column —
 * and the bar's whole claim is that every filter on the list is one of these.
 */

export const FILTER_CHIP_BASE_CLASSES: string =
  "group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1";

export const FILTER_CHIP_ACTIVE_CLASSES: string =
  "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm hover:border-indigo-300 hover:bg-indigo-100";

export const FILTER_CHIP_INACTIVE_CLASSES: string =
  "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50";

export const FILTER_CHIP_POPOVER_CLASSES: string =
  "absolute left-0 top-full z-20 mt-2 origin-top-left overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl ring-1 ring-black/5";

export const FILTER_CHIP_CLEAR_CLASSES: string =
  "ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-indigo-400 transition-colors hover:bg-indigo-200 hover:text-indigo-900 focus:outline-none";

export const FILTER_CHIP_OPERATOR_SELECT_CLASSES: string =
  "cursor-pointer rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-medium text-gray-700 hover:border-gray-300 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400";
