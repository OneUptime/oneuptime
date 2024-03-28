import React, { FunctionComponent, ReactElement } from 'react';
import {
    AxisBottom,
    AxisLeft,
    AxisType,
    LineChartPoint,
    XValue,
    YValue,
} from 'CommonUI/src/Components/Charts/Line/LineChart';
import OneUptimeDate from 'Common/Types/Date';

export interface ComponentProps {
    points: Array<LineChartPoint>;
    axisBottom: AxisBottom;
    axisLeft: AxisLeft;
}

const MonitorChartTooltip: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const formatAxisValue = (
        value: XValue | YValue,
        type: AxisType
    ): string => {
        if (typeof value === 'number') {
            return value.toFixed(2);
        }

        if (value instanceof Date && type === AxisType.Date) {
            return OneUptimeDate.getDateAsLocalFormattedString(value);
        }

        if (value instanceof Date && type === AxisType.Time) {
            return OneUptimeDate.getLocalHourAndMinuteFromDate(value);
        }

        return value.toString();
    };

    return (
        <div className="bg-white rounded-md shadow-md p-5 text-sm">
            {props.points.map((point: LineChartPoint, index: number) => {
                return (
                    <div key={index} className="space-y-2">
                        <div className="flex">
                            <div className="w-1/2 text-left font-medium">
                                {props.axisLeft.legend}
                            </div>
                            <div className="w-1/2 text-right">
                                {formatAxisValue(
                                    point.y.toString(),
                                    props.axisLeft.type
                                )}
                            </div>
                        </div>
                        <div className="flex">
                            <div className="w-1/2 text-left font-medium">
                                {props.axisBottom.legend}
                            </div>
                            <div className="w-1/2 text-right">
                                {formatAxisValue(
                                    point.x.toString(),
                                    props.axisBottom.type
                                )}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default MonitorChartTooltip;
