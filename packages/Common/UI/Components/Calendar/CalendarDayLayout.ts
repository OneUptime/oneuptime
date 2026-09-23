/*
 * How the week and day views place blocks inside one day's column.
 *
 * react-big-calendar ships two algorithms and neither suits a roster, where
 * blocks are normally back-to-back hand-offs rather than competing meetings:
 *
 *  - "overlap" (its default) puts any two blocks that START within half an hour
 *    of each other side by side, so a short shift and the one after it were
 *    drawn in two narrow, overlapping lanes, as if both people were on call at
 *    once.
 *  - "no-overlap" trims 2px off every block, which opens a visible gap at every
 *    hand-off.
 *
 * It also hands each column every block that touches that DATE, including a
 * block that ends exactly at the column's midnight. That block covers none of
 * the day, but it was still drawn as a 20px sliver labelled "– 12:00 AM" at the
 * top of the column, and it squeezed the block that really starts at midnight
 * into half the width.
 *
 * This layout drops those slivers and gives blocks separate lanes only when they
 * really overlap in time. Blocks that follow one another keep the full width and
 * meet at the minute they hand off.
 */

/*
 * The subset of react-big-calendar's per-column slot metrics this layout reads.
 * Minute positions are whole minutes from the start of the column, clamped to
 * the column; top and height are percentages of the column.
 */
export interface DaySlotRange {
  top: number;
  height: number;
  start: number;
  end: number;
}

export interface DaySlotMetrics {
  getRange: (start: Date, end: Date) => DaySlotRange;
  startsBeforeDay: (date: Date) => boolean;
}

export interface DayEventAccessors<TEvent> {
  start: (event: TEvent) => Date;
  end: (event: TEvent) => Date;
}

export interface DayLayoutInput<TEvent> {
  events: Array<TEvent>;
  slotMetrics: DaySlotMetrics;
  accessors: DayEventAccessors<TEvent>;
}

/*
 * Numbers, not strings: react-big-calendar reads these back and adds the "%"
 * itself. xOffset is the block's left edge.
 */
export interface DayEventStyle {
  top: number;
  height: number;
  width: number;
  xOffset: number;
}

export interface StyledDayEvent<TEvent> {
  event: TEvent;
  style: DayEventStyle;
}

interface PlacedEvent<TEvent> {
  event: TEvent;
  top: number;
  height: number;
  startMinute: number;
  endMinute: number;
  lane: number;
}

/*
 * True when a block that started on an earlier day leaves less than a whole
 * minute of itself in this column: a block ending at this column's midnight,
 * or a few seconds after it. Whole minutes match the grid: a block ending a
 * few seconds after midnight is still a hand-off at midnight, not a shift.
 *
 * Only a tail is ever dropped. A block always stays in the column it starts
 * in, however little of it lands there. A block starting at 11:59 PM keeps
 * a zero-height place at the bottom of its own day. Dropping that too would
 * make a block such as 11:59 PM to 12:00 AM vanish from both days.
 */
export const isSpilloverSliver: <TEvent>(
  event: TEvent,
  slotMetrics: DaySlotMetrics,
  accessors: DayEventAccessors<TEvent>,
) => boolean = <TEvent>(
  event: TEvent,
  slotMetrics: DaySlotMetrics,
  accessors: DayEventAccessors<TEvent>,
): boolean => {
  const start: Date = accessors.start(event);

  if (!slotMetrics.startsBeforeDay(start)) {
    return false;
  }

  const range: DaySlotRange = slotMetrics.getRange(start, accessors.end(event));
  return range.end <= range.start;
};

// Half-open, so a block ending at 17:02 does not overlap one starting at 17:02.
const overlapsInTime: <TEvent>(
  a: PlacedEvent<TEvent>,
  b: PlacedEvent<TEvent>,
) => boolean = <TEvent>(
  a: PlacedEvent<TEvent>,
  b: PlacedEvent<TEvent>,
): boolean => {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
};

const styleCluster: <TEvent>(
  cluster: Array<PlacedEvent<TEvent>>,
) => Array<StyledDayEvent<TEvent>> = <TEvent>(
  cluster: Array<PlacedEvent<TEvent>>,
): Array<StyledDayEvent<TEvent>> => {
  // Each lane holds the minute its latest block ends.
  const laneEnds: Array<number> = [];

  for (const placed of cluster) {
    let lane: number = laneEnds.findIndex((laneEnd: number) => {
      return laneEnd <= placed.startMinute;
    });

    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(placed.endMinute);
    } else {
      laneEnds[lane] = placed.endMinute;
    }

    placed.lane = lane;
  }

  const laneCount: number = laneEnds.length;
  const laneWidth: number = 100 / laneCount;

  return cluster.map((placed: PlacedEvent<TEvent>) => {
    /*
     * Widen into the lanes to the right until one of them is busy while this
     * block runs, so a long shift is not squeezed for its whole length because
     * a short one sat beside it for an hour.
     */
    let spanEnd: number = laneCount;

    for (const other of cluster) {
      if (
        other.lane > placed.lane &&
        other.lane < spanEnd &&
        overlapsInTime(placed, other)
      ) {
        spanEnd = other.lane;
      }
    }

    return {
      event: placed.event,
      style: {
        top: placed.top,
        height: placed.height,
        width: (spanEnd - placed.lane) * laneWidth,
        xOffset: placed.lane * laneWidth,
      },
    };
  });
};

export const layoutDayEvents: <TEvent>(
  input: DayLayoutInput<TEvent>,
) => Array<StyledDayEvent<TEvent>> = <TEvent>(
  input: DayLayoutInput<TEvent>,
): Array<StyledDayEvent<TEvent>> => {
  const placed: Array<PlacedEvent<TEvent>> = [];

  for (const event of input.events) {
    if (isSpilloverSliver(event, input.slotMetrics, input.accessors)) {
      continue;
    }

    const range: DaySlotRange = input.slotMetrics.getRange(
      input.accessors.start(event),
      input.accessors.end(event),
    );

    placed.push({
      event,
      top: range.top,
      height: range.height,
      startMinute: range.start,
      endMinute: range.end,
      lane: 0,
    });
  }

  /*
   * Earliest first, and the longer of two blocks with the same start first, so
   * a later block paints over an earlier one. That matters when a short
   * block's minimum height overhangs the start of the next block: the next
   * block is drawn on top, where it really starts.
   */
  placed.sort((a: PlacedEvent<TEvent>, b: PlacedEvent<TEvent>) => {
    return a.startMinute - b.startMinute || b.endMinute - a.endMinute;
  });

  /*
   * Lanes are shared only within a cluster, meaning blocks linked by a chain of
   * overlaps. Two concurrent blocks in the morning must not narrow the evening.
   */
  const styled: Array<StyledDayEvent<TEvent>> = [];
  let cluster: Array<PlacedEvent<TEvent>> = [];
  let clusterEnd: number = Number.NEGATIVE_INFINITY;

  for (const item of placed) {
    if (cluster.length > 0 && item.startMinute >= clusterEnd) {
      styled.push(...styleCluster(cluster));
      cluster = [];
      clusterEnd = Number.NEGATIVE_INFINITY;
    }

    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinute);
  }

  if (cluster.length > 0) {
    styled.push(...styleCluster(cluster));
  }

  return styled;
};
