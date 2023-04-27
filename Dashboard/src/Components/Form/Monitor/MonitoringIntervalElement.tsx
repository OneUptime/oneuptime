import React, { FunctionComponent, ReactElement } from 'react';
import MonitoringIntrerval from './MonitorInterval';

export interface ComponentProps {
    monitoringInterval: string;
}

const MonitoringIntervalElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    if(props.monitoringInterval){
        return <div>
            {MonitoringIntrerval.find((item) => item.value === props.monitoringInterval)?.label}
        </div>
    }

    return (
        <div>No interval defined</div>
    );
};

export default MonitoringIntervalElement;
