import React, { FunctionComponent, ReactElement } from "react";

export interface GanttChartTimelineInterval {
  width: number;
  intervalUnit: string;
  intervalCount: number;
}

export interface ComponentProps {
  timelineInterval: GanttChartTimelineInterval;
}

const TimelineInterval: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div
      className="timeline-interval h-full"
      style={{
        width: `${props.timelineInterval.width}px`,
      }}
    >
      <div className="timeline-interval h-full flex justify-end border-r-2 border-gray-400 border-solid text-xs text-gray-400 font-bold">
        <div className="mr-1">
          {props.timelineInterval.intervalCount}{" "}
          {props.timelineInterval.intervalUnit}
        </div>
      </div>
    </div>
  );
};

export default TimelineInterval;
