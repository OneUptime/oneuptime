import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

export type EventStatBarColumns = 1 | 2 | 3 | 4;

export interface ComponentProps {
  columns: EventStatBarColumns;
  children: ReactNode;
  className?: string | undefined;
  /*
   * Names the group for assistive technology, in English: "Incident
   * response times". The bar looks it up in the reader's language where it
   * draws it, as its tiles do their labels.
   */
  ariaLabel?: string | undefined;
  /*
   * Lay the cells out by the bar's own width rather than the window's: a
   * bar beside a side menu whose width the window does not tell (a security
   * case's figures), so four cells go through a 2 x 2 grid until each has
   * room for its label on one line. Left out, the bar follows the window's
   * breakpoints, as it always has.
   */
  isLaidOutByOwnWidth?: boolean | undefined;
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

/*
 * The same, by the bar's own width (isLaidOutByOwnWidth): a cell gets 14rem
 * - "TIME TO ACKNOWLEDGE" on one line beside its icon - before more share a
 * row. The bar's wrapper is the size container these are read against.
 */
const OWN_WIDTH_COLUMN_CLASS_NAMES: Record<EventStatBarColumns, string> = {
  1: "",
  2: "[@container(min-width:28rem)]:grid-cols-2",
  3: "[@container(min-width:42rem)]:grid-cols-3",
  4: "[@container(min-width:28rem)]:grid-cols-2 [@container(min-width:56rem)]:grid-cols-4",
};

export const EVENT_STAT_BAR_OWN_WIDTH_CONTAINER_CLASS_NAME: string =
  "[container-type:inline-size]";

export const getEventStatBarColumnClassName: (
  columns: EventStatBarColumns,
  cellCount: number,
  isLaidOutByOwnWidth?: boolean | undefined,
) => string = (
  columns: EventStatBarColumns,
  cellCount: number,
  isLaidOutByOwnWidth?: boolean | undefined,
): string => {
  /*
   * A caller that leaves out an optional cell must not end up with an empty
   * track, which would show as a blank grey block, so never lay out more
   * columns than there are cells.
   */
  const effectiveColumns: number = Math.max(
    1,
    Math.min(columns, Math.max(cellCount, 1)),
  );

  return (
    isLaidOutByOwnWidth ? OWN_WIDTH_COLUMN_CLASS_NAMES : COLUMN_CLASS_NAMES
  )[effectiveColumns as EventStatBarColumns];
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
  const { translateString } = useTranslateValue();
  const cellCount: number = React.Children.toArray(props.children).length;

  if (cellCount === 0) {
    return <></>;
  }

  const columnClassName: string = getEventStatBarColumnClassName(
    props.columns,
    cellCount,
    props.isLaidOutByOwnWidth,
  );

  const bar: ReactElement = (
    <div
      role={props.ariaLabel ? "group" : undefined}
      aria-label={
        props.ariaLabel
          ? translateString(props.ariaLabel) || props.ariaLabel
          : undefined
      }
      className={`grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm ${columnClassName} ${
        props.className || ""
      }`}
    >
      {props.children}
    </div>
  );

  if (!props.isLaidOutByOwnWidth) {
    return bar;
  }

  // A size container cannot lay out its own grid: its wrapper is the one.
  return (
    <div className={EVENT_STAT_BAR_OWN_WIDTH_CONTAINER_CLASS_NAME}>{bar}</div>
  );
};

export default EventStatBar;
