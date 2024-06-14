import OneUptimeDate from "Common/Types/Date";
import {
  AxisBottom,
  AxisLeft,
  AxisType,
  LineChartPoint,
  XValue,
  YValue,
} from "CommonUI/src/Components/Charts/Line/LineChart";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  points: Array<LineChartPoint>;
  axisBottom: AxisBottom;
  axisLeft: AxisLeft;
}

const MonitorChartTooltip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type FormatAxisValueFunction = (
    value: XValue | YValue,
    type: AxisType,
  ) => string;

  const formatAxisValue: FormatAxisValueFunction = (
    value: XValue | YValue,
    type: AxisType,
  ): string => {
    if (typeof value === "number") {
      return value.toFixed(2);
    }

    if (type === AxisType.Date) {
      return OneUptimeDate.getDateAsLocalFormattedString(value);
    }

    if (type === AxisType.Time) {
      return OneUptimeDate.getLocalHourAndMinuteFromDate(value);
    }

    return value.toString();
  };

  return (
    <div className="bg-white rounded-md shadow-md p-5 text-sm space-y-2">
      {props.points.map((point: LineChartPoint, index: number) => {
        return (
          <div key={index} className="space-y-1">
            <div className="font-medium flex">
              <div>
                <div
                  className="w-3 h-3 mr-2 mt-1 rounded-full"
                  style={{
                    backgroundColor: point.seriesColor.toString(),
                  }}
                ></div>
              </div>
              {point.seriesName}
            </div>
            <div className="flex text-gray-600 text-xs">
              <div className="w-1/2 text-left font-medium">
                {props.axisLeft.legend}
              </div>
              <div className="w-1/2 text-right">
                {formatAxisValue(point.y.toString(), props.axisLeft.type)}
              </div>
            </div>
            <div className="flex text-gray-600 text-xs">
              <div className="w-1/2 text-left font-medium">
                {props.axisBottom.legend}
              </div>
              <div className="w-1/2 text-right">
                {formatAxisValue(point.x.toString(), props.axisBottom.type)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default MonitorChartTooltip;
