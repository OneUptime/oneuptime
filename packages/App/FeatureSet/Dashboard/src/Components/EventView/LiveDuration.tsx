import OneUptimeDate from "Common/Types/Date";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  TABLE_DURATION_MAX_UNITS,
  getEventDurationText,
} from "../../Utils/EventDuration";

export interface ComponentProps {
  startDate: Date;
  endDate?: Date | undefined; // when undefined, ticks live against "now".
  /*
   * A table's Duration column: the two largest units ("10 days, 23
   * hours"), the whole duration under the pointer.
   */
  isCompact?: boolean | undefined;
}

const LiveDuration: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [now, setNow] = useState<Date>(OneUptimeDate.getCurrentDate());

  useEffect(() => {
    if (props.endDate) {
      return () => {};
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      setNow(OneUptimeDate.getCurrentDate());
    }, 30 * 1000);

    return () => {
      clearInterval(interval);
    };
  }, [props.endDate]);

  const endDate: Date = props.endDate || now;

  const text: string = getEventDurationText(props.startDate, endDate);

  if (props.isCompact) {
    const compactText: string = getEventDurationText(
      props.startDate,
      endDate,
      { maxUnits: TABLE_DURATION_MAX_UNITS },
    );

    return (
      <span
        title={compactText === text ? undefined : text}
        data-testid="live-duration"
      >
        {compactText}
      </span>
    );
  }

  return <span>{text}</span>;
};

export default LiveDuration;
