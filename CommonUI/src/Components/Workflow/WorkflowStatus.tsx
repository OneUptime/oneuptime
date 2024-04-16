import { Green500, Red500, Yellow500 } from 'Common/Types/BrandColors';
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
        return <Pill color={Green500} text="Success" />;
    }
    if (props.status === WorkflowStatus.Running) {
        return <Pill color={Yellow500} text="Running" />;
    }
    if (props.status === WorkflowStatus.Scheduled) {
        return <Pill color={Yellow500} text="Scheduled" />;
    }
    if (props.status === WorkflowStatus.Error) {
        return <Pill color={Red500} text="Error" />;
    }

    if (props.status === WorkflowStatus.Timeout) {
        return <Pill color={Red500} text="Timeout" />;
    }

    if (props.status === WorkflowStatus.WorkflowCountExceeded) {
        return <Pill color={Red500} text="Execution Exceeded Current Plan" />;
    }

    return <Pill color={Yellow500} text="Unknown" />;
};

export default WorkflowStatusElement;
