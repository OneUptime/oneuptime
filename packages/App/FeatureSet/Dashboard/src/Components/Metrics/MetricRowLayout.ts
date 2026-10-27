/*
 * HOW A METRICS LIST ROW IS LAID OUT (MetricRow).
 *
 * A row names a metric (its name, unit, description and the services that
 * report it) and shows its newest value with a sparkline. The value and the
 * sparkline take about 15rem; side by side with the name on a phone - or in
 * a card beside a resource's side menu, 430px wide at a 768px window - they
 * left the name a few letters, so the row said "conta…" and nothing else
 * (follow-up of #5076, the Docker and Podman Metrics tabs).
 *
 * So the row is a container (`container-type: inline-size`), and the name
 * and the value sit side by side only while the row is at least
 * METRIC_ROW_SIDE_BY_SIDE_MIN_WIDTH_REM wide: narrower, the name and its
 * description take the row's whole width - a long name wraps rather than
 * being cut, after its own dots first (BreakableName: "container.blockio."
 * / "io_service_bytes_recursive", never "io_service_b" / "ytes") - and the
 * sparkline and value sit on a line of their own under them. Keyed to the
 * row's own width, not the window's, because the same list is drawn full
 * width (Metrics) and inside cards beside side menus (a host's, a
 * container's, a cluster's Metrics tab).
 *
 * On that line of their own the sparkline comes first and the newest value
 * follows it, where its line ends. So every row's sparkline starts at the
 * row's own start and every value at the same place after it, whatever the
 * values read ("3.40%" beside "12.5 MB"). The value first put each
 * sparkline wherever its row's number ended, and hovering a point - which
 * shows that point's time under the value - widened the number's column
 * and moved the sparkline out from under the pointer, so near its start it
 * flickered between the point and the row's newest value. Side by side the
 * value stays before the sparkline, at the row's end.
 *
 * Whole two-digit rems only: the Tailwind runtime sorts arbitrary container
 * variants as text, so "9rem" would sort after "36rem".
 *
 * Plain strings, free of React, so App/Tests can read them.
 */

export const METRIC_ROW_SIDE_BY_SIDE_MIN_WIDTH_REM: number = 36;

// The row itself: the container its parts measure.
export const METRIC_ROW_CONTAINER_CLASS_NAME: string =
  "[container-type:inline-size]";

// Stacked by default; side by side from 36rem of row.
export const METRIC_ROW_LAYOUT_CLASS_NAME: string =
  "flex flex-col gap-3 [@container(min-width:36rem)]:flex-row [@container(min-width:36rem)]:items-center [@container(min-width:36rem)]:gap-6";

// The name, unit, description and services.
export const METRIC_ROW_INFO_CLASS_NAME: string =
  "min-w-0 [@container(min-width:36rem)]:flex-1";

/*
 * Stacked, a long name wraps - after its dots, and anywhere only where a
 * part is too long for the line; side by side it keeps to one line.
 */
export const METRIC_ROW_NAME_CLASS_NAME: string =
  "min-w-0 [overflow-wrap:anywhere] font-mono text-sm font-semibold text-gray-900 group-hover:text-indigo-700 [@container(min-width:36rem)]:truncate";

// Two lines stacked, one side by side.
export const METRIC_ROW_DESCRIPTION_CLASS_NAME: string =
  "mt-1 line-clamp-2 text-xs text-gray-500 [@container(min-width:36rem)]:line-clamp-1";

/*
 * The value and sparkline: a line of their own under the name when
 * stacked, the row's end otherwise - never squeezed.
 */
export const METRIC_ROW_VALUE_CLASS_NAME: string =
  "flex flex-shrink-0 items-center gap-4";

/*
 * The sparkline: first on its line when stacked, so it starts where the
 * row does; after the value side by side. Its own width never changes.
 */
export const METRIC_ROW_SPARKLINE_CLASS_NAME: string =
  "flex-shrink-0 order-first [@container(min-width:36rem)]:order-none";

/*
 * The newest value (or the hovered point's, with its time): stacked, the
 * rest of the line after the sparkline, where it may grow without moving
 * it; side by side, its own width before the sparkline, against it. Set
 * against the sparkline on a right-to-left page too: aligned to the line's
 * start and end (text-start, text-end), not to its left and right, which
 * put a Persian value at the far side of its line, away from its
 * sparkline.
 */
export const METRIC_ROW_VALUE_TEXT_CLASS_NAME: string =
  "min-w-0 flex-1 text-start [@container(min-width:36rem)]:flex-none [@container(min-width:36rem)]:text-end";
