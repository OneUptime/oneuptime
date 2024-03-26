import React, { FunctionComponent, ReactElement } from "react";
import { ResponsiveLine } from "@nivo/line";
import OneUptimeDate from "Common/Types/Date";
import { Indigo500 } from "Common/Types/BrandColors";

export interface ComponentProps {

}

const LineChart: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    const data = [
        {
            id: "Response Time",
            data: [
                { x: OneUptimeDate.getCurrentDate(), y: 10 },
                { x: OneUptimeDate.getSomeMinutesAfter(1), y: 15 },
                { x: OneUptimeDate.getSomeMinutesAfter(2), y: 12 },
                { x: OneUptimeDate.getSomeMinutesAfter(4), y: 8 },
                { x: OneUptimeDate.getSomeMinutesAfter(5), y: 11 },
            ],
        }
    ];


    return (
        <div className="h-96 w-full">

            <ResponsiveLine
                data={data}
                onMouseEnter={(data) => console.log(data)}
                onMouseLeave={(data) => console.log(data)}
                margin={{ bottom: 30, left: 30 }}
                xScale={{
                    type: 'time',
                    min: OneUptimeDate.getCurrentDate(),
                    max: 'auto',
                    precision: 'minute',
                    nice: true,
                    format: "%Y-%m-%d %H:%M:%S",
                }}
                yScale={{
                    type: 'linear',
                    min: 0,
                    max: 'auto',
                    stacked: true,
                    reverse: false
                }}
                xFormat="time:%Y-%m-%d %H:%M:%S"
                axisTop={null}
                axisRight={null}
                axisBottom={{
                    tickSize: 5,
                    tickPadding: 5,
                    tickRotation: 0,
                    legend: 'X axis',
                    legendOffset: 36,
                    legendPosition: 'middle',
                    format: "%H:%M:%S",
                }}
                useMesh={true}
                axisLeft={{
                    tickSize: 5,
                    tickPadding: 5,
                    tickRotation: 0,
                    legend: 'Y axis',
                    legendOffset: -40,
                    legendPosition: 'middle'
                }}
                enableSlices="x"
                sliceTooltip={({ slice }) => (
                    <div
                        style={{
                            background: 'white',
                            padding: '9px 12px',
                            border: '1px solid #ccc',
                        }}
                    >
                        {slice.points.map((point) => (
                            <div
                                key={point.id}
                                style={{
                                    color: Indigo500.toString(), // Set the line color to purple
                                    padding: '3px 0',
                                }}
                            >
                                {point.serieId} [{point.data.xFormatted},{' '}
                                {point.data.yFormatted}]
                            </div>
                        ))}
                    </div>
                )}
                colors={[Indigo500.toString()]} // Set the line color to purple
            />

        </div>
    );
};

export default LineChart;