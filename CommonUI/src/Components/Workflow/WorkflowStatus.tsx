import { Green, Red, Yellow } from 'Common/Types/BrandColors';
import React, { FunctionComponent, ReactElement } from 'react';
import WorkflowStatus from 'Common/Types/Workflow/WorkflowStatus';
import Pill from '../Pill/Pill';

export interface ComponentProps {
    status: WorkflowStatus;
}

const WorkflowStatusElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (props.status === WorkflowStatus.Success) {
        return <Pill color={Green} text="Success" />;
    }
    if (props.status === WorkflowStatus.Running) {
        return <Pill color={Yellow} text="Running" />;
    }
    if (props.status === WorkflowStatus.Scheduled) {
        return <Pill color={Yellow} text="Scheduled" />;
    }
    if (props.status === WorkflowStatus.Error) {
        return <Pill color={Red} text="Error" />;
    }

    if (props.status === WorkflowStatus.Timeout) {
        return <Pill color={Red} text="Timeout" />;
    }

    return <Pill color={Yellow} text="Unknown" />;
};

export default WorkflowStatusElement;
