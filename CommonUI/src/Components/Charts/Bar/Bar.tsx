import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {}

const LineChart: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    return <div className="h-96 w-full"></div>;
};

export default LineChart;
