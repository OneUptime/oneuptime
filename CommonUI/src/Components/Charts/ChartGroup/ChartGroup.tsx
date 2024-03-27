import React, { FunctionComponent, ReactElement } from 'react';

export enum ChartGroupInterval {
    ONE_HOUR = '1 hour',
}

export interface ComponentProps {
    charts: Array<ReactElement>;
    interval: ChartGroupInterval;
}

const ChartGroup: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div>
            {props.charts.map((chart, index) => {
                return <div key={index}>{chart}</div>;
            })}
        </div>
    );
};

export default ChartGroup;
