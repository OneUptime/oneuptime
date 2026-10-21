import CurrentlyActiveIndicator from "./CurrentlyActiveIndicator";
import { PillSize } from "../Pill/Pill";
import OneUptimeDate from "../../../Types/Date";
import {
  LiveDurationDate,
  parseLiveDurationDate,
} from "../../Utils/UseLiveDuration";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  endDate: LiveDurationDate;
  indicatorSize?: PillSize | undefined;
}

/*
 * When a timeline row ended: the date and time, formatted exactly as the
 * table formats a DateTime column - or, for the row that has not ended, the
 * pulsing "Currently Active" marker. Paired with StateTimelineDuration, which
 * treats the same rows as live, so the two cells can never disagree.
 */
const StateTimelineEndsAt: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const endDate: Date | null = parseLiveDurationDate(props.endDate);

  if (!endDate) {
    return <CurrentlyActiveIndicator size={props.indicatorSize} />;
  }

  return (
    <time data-testid="state-timeline-ends-at" dateTime={endDate.toISOString()}>
      {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(endDate, false)}
    </time>
  );
};

export default StateTimelineEndsAt;
