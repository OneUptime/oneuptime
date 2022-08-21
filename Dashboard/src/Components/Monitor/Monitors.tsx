import Monitor from 'Model/Models/Monitor';
import React, { FunctionComponent, ReactElement } from 'react';
import MonitorElement from './Monitor';

export interface ComponentProps {
    monitors: Array<Monitor>;
}

const MonitorsElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (!props.monitors || props.monitors.length === 0) {
        return <p>No monitors.</p>;
    }

    return (
        <div>
            {props.monitors.map((monitor: Monitor, i: number) => {
                return (<MonitorElement monitor={monitor} key={i} />);
            })}
        </div>
    );
};

export default MonitorsElement;
