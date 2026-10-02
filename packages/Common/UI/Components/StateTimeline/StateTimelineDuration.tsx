import useLiveDuration, {
  LiveDuration,
  LiveDurationDate,
} from "../../Utils/UseLiveDuration";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  startDate: LiveDurationDate;
  // Absent while the state is still in effect: the duration then counts up.
  endDate?: LiveDurationDate | undefined;
}

/*
 * A timeline row's duration. A finished row reads start to end; the row that
 * is still in effect counts up every second, worded exactly like the
 * finished ones ("2 mins 54 secs").
 *
 * This is its own component so the ticking stays here: the second-by-second
 * re-render is this one <time>, never the table around it.
 *
 * The live one is a `timer` - the ARIA role for a count of elapsed time -
 * whose implicit live region is off, spelled out here: a screen reader reads
 * it when it gets to it rather than announcing every second.
 */
const StateTimelineDuration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const duration: LiveDuration = useLiveDuration({
    startDate: props.startDate,
    endDate: props.endDate,
  });

  if (duration.durationInSeconds === null) {
    return (
      <span data-testid="state-timeline-duration" className="text-gray-400">
        -
      </span>
    );
  }

  return (
    <time
      data-testid="state-timeline-duration"
      data-live={duration.isLive ? "true" : "false"}
      dateTime={`PT${duration.durationInSeconds}S`}
      role={duration.isLive ? "timer" : undefined}
      aria-live={duration.isLive ? "off" : undefined}
      // Even-width digits, so the live count does not shuffle as it ticks.
      className={duration.isLive ? "tabular-nums text-gray-900" : undefined}
    >
      {duration.formattedDuration}
    </time>
  );
};

export default StateTimelineDuration;
