import React, { FunctionComponent, ReactElement } from 'react';
import Monitor from 'Model/Models/Monitor';

export interface ComponentProps {
    monitor: Monitor;
}

const LabelElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <span>{props.monitor.name}</span>;
};

export default LabelElement;
