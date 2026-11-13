import { formatHandOffInstant } from "./LayerSummary";
import OneUptimeDate from "Common/Types/Date";
import DirectionArrow from "Common/UI/Components/DirectionArrow/DirectionArrow";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A HAND-OFF'S TWO MOMENTS, IN A LIST OF THEM: "Mon, Nov 4, 9:00 AM ->
 * Mon, Nov 11, 9:00 AM".
 *
 * The lists of an on-call schedule's hand-offs - the Final schedule's
 * Upcoming hand-offs, a layer's Upcoming shifts, the overrides in force -
 * say their zone once (beside View as; on the Schedule timezone card), and
 * almost every moment in them is of this year. So each moment leaves the
 * zone out, and its year too unless it falls in another year
 * (formatHandOffInstant): "Mon, Nov 4, 2026, 9:00 AM PST -> Mon, Nov 11,
 * 2026, 9:00 AM PST" took three lines of a phone, the year and the zone said
 * twice on every row.
 *
 * Each moment stays on one line, and the arrow stays with the first: a row
 * too narrow for both breaks only after the arrow, one moment a line - never
 * inside a moment.
 */
export const HAND_OFF_MOMENT_CLASS_NAME: string = "whitespace-nowrap";

export interface ComponentProps {
  start: Date;
  end: Date;
  // The zone the list says once; the viewer's without one.
  timezone?: string | undefined;
  // When the list is read, for which moments are of this year.
  now?: Date | undefined;
}

const HandOffTimes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const now: Date = props.now || OneUptimeDate.getCurrentDate();

  return (
    <span data-testid="hand-off-times">
      <span
        className={HAND_OFF_MOMENT_CLASS_NAME}
        data-testid="hand-off-moment"
      >
        <bdi>{formatHandOffInstant(props.start, props.timezone, now)}</bdi>
        <DirectionArrow className="ml-1 text-gray-300" />
      </span>{" "}
      <span
        className={HAND_OFF_MOMENT_CLASS_NAME}
        data-testid="hand-off-moment"
      >
        <bdi>{formatHandOffInstant(props.end, props.timezone, now)}</bdi>
      </span>
    </span>
  );
};

export default HandOffTimes;
