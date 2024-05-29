import Route from 'Common/Types/API/Route';
import Link from 'CommonUI/src/Components/Link/Link';
import Project from 'Model/Models/Project';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    project: Project;
    onNavigateComplete?: (() => void) | undefined;
}

const ProjectElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    if (props.project && props.project._id) {
        const _id: string = props.project._id
            ? props.project._id.toString()
            : '';
        return (
            <Link
                onNavigateComplete={props.onNavigateComplete}
                className="hover:underline"
                to={new Route(`/dashboard/${_id}`)}
            >
                <span>{props.project.name}</span>
            </Link>
        );
    }

    return <span>{props.project.name}</span>;
};

export default ProjectElement;
