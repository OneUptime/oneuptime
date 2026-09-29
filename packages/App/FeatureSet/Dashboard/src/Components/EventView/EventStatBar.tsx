import React, { FunctionComponent, ReactElement, ReactNode } from "react";

export type EventStatBarColumns = 1 | 2 | 3 | 4;

export interface ComponentProps {
  columns: EventStatBarColumns;
  children: ReactNode;
  className?: string | undefined;
  // Names the group for assistive technology, e.g. "Incident timing".
  ariaLabel?: string | undefined;
}

/*
 * Literal class names per column count - never built by string
 * interpolation - so the Tailwind scanner can see every one of them. Four
 * cells in one row are too narrow beside the side menu at tablet widths, so
 * that layout goes through a 2 x 2 grid before it spreads out.
 */
const COLUMN_CLASS_NAMES: Record<EventStatBarColumns, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

export const getEventStatBarColumnClassName: (
  columns: EventStatBarColumns,
  cellCount: number,
) => string = (columns: EventStatBarColumns, cellCount: number): string => {
  /*
   * A caller that leaves out an optional cell must not end up with an empty
   * track, which would show as a blank grey block, so never lay out more
   * columns than there are cells.
   */
  const effectiveColumns: number = Math.max(
    1,
    Math.min(columns, Math.max(cellCount, 1)),
  );

  return COLUMN_CLASS_NAMES[effectiveColumns as EventStatBarColumns];
};

/*
 * One card holding a row of headline numbers (time to acknowledge, duration,
 * ...). Its cells are EventStatTile variant="segment". The dividers are the
 * card's own background showing through a 1px grid gap rather than border
 * utilities on the cells: that draws a hairline between every pair of
 * neighbours whether the cells sit in one row, one column or a 2 x 2 grid.
 */
const EventStatBar: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const cellCount: number = React.Children.toArray(props.children).length;

  if (cellCount === 0) {
    return <></>;
  }

  const columnClassName: string = getEventStatBarColumnClassName(
    props.columns,
    cellCount,
  );

  return (
    <div
      role={props.ariaLabel ? "group" : undefined}
      aria-label={props.ariaLabel}
      className={`grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm ${columnClassName} ${
        props.className || ""
      }`}
    >
      {props.children}
    </div>
  );
};

export default EventStatBar;
