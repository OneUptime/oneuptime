/**
 * How long a chart holds a single click open, waiting to see whether it is
 * really the first half of a double-click.
 *
 * Charts that accept `onTimeRangeReset` have to tell a bucket click apart
 * from a reset gesture, and the browser delivers BOTH clicks of a
 * double-click before it delivers `dblclick` — so the only way a
 * double-click can avoid also pinning a bucket twice is for the click path
 * to wait. Kept just above the ~200ms most platforms use as their
 * double-click threshold, and short enough that a real single click still
 * feels immediate. Charts with no reset handler skip the wait entirely.
 */
export const DOUBLE_CLICK_DISAMBIGUATION_MS: number = 250;
