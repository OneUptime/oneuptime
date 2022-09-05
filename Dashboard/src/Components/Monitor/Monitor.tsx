import React, { FunctionComponent, ReactElement } from 'react';
import Monitor from 'Model/Models/Monitor';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';

export interface ComponentProps {
    monitor: Monitor;
    onNavigateComplete?: (() => void) | undefined; 
}

const MonitorElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    if (props.monitor._id && (props.monitor.projectId || (props.monitor.project && props.monitor.project._id))) {
        const projectId = props.monitor.projectId ?  props.monitor.projectId.toString() : (props.monitor.project && props.monitor.project._id)
        return <Link onNavigateComplete={props.onNavigateComplete} className="underline-on-hover" to={new Route(`/dashboard/${projectId}/monitors/${props.monitor._id}`)}><span>{props.monitor.name}</span></Link>
    }

    return <span>{props.monitor.name}</span>;
};

export default MonitorElement;
