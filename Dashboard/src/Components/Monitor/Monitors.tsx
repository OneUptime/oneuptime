import Monitor from 'Model/Models/Monitor';
import React, { FunctionComponent, ReactElement } from 'react';
import MonitorElement from './Monitor';

export interface ComponentProps {
    monitors: Array<Monitor>;
    onNavigateComplete?: (() => void) | undefined; 
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
                return <span key={i}>
                    <MonitorElement monitor={monitor} onNavigateComplete={props.onNavigateComplete} />
                    {i !== props.monitors.length -1  && <span>,&nbsp;</span>}
                </span>
            })}
        </div>
    );
};

export default MonitorsElement;
