import React, { FunctionComponent, ReactElement } from 'react';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';
import Workflow from 'Model/Models/Workflow';

export interface ComponentProps {
    workflow: Workflow;
    onNavigateComplete?: (() => void) | undefined;
}

const WorkflowElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (
        props.workflow._id &&
        (props.workflow.projectId ||
            (props.workflow.project && props.workflow.project._id))
    ) {
        const projectId: string | undefined = props.workflow.projectId
            ? props.workflow.projectId.toString()
            : props.workflow.project
            ? props.workflow.project._id
            : '';
        return (
            <Link
                onNavigateComplete={props.onNavigateComplete}
                className="hover:underline"
                to={
                    new Route(
                        `/dashboard/${projectId}/workflows/workflow/${props.workflow._id}`
                    )
                }
            >
                <span>{props.workflow.name}</span>
            </Link>
        );
    }

    return <span>{props.workflow.name}</span>;
};

export default WorkflowElement;
