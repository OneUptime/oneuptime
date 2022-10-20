import React, { FunctionComponent, ReactElement } from 'react';
import StatusPage from 'Model/Models/StatusPage';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';

export interface ComponentProps {
    statusPage: StatusPage;
    onNavigateComplete?: (() => void) | undefined;
}

const StatusPageElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (
        props.statusPage._id &&
        (props.statusPage.projectId ||
            (props.statusPage.project && props.statusPage.project._id))
    ) {
        const projectId: string | undefined = props.statusPage.projectId
            ? props.statusPage.projectId.toString()
            : props.statusPage.project
            ? props.statusPage.project._id
            : '';
        return (
            <Link
                onNavigateComplete={props.onNavigateComplete}
                className="underline-on-hover"
                to={
                    new Route(
                        `/dashboard/${projectId}/status-pages/${props.statusPage._id}`
                    )
                }
            >
                <span>{props.statusPage.name}</span>
            </Link>
        );
    }

    return <span>{props.statusPage.name}</span>;
};

export default StatusPageElement;
