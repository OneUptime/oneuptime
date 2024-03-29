import React, { FunctionComponent, ReactElement } from 'react';
import MonitorStatus from 'Model/Models/MonitorStatus';

export interface ComponentProps {
    monitorStatus: MonitorStatus;
}

const TeamElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <span>{props.monitorStatus.name}</span>;
};

export default TeamElement;
