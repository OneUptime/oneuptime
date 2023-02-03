import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import type Project from 'Model/Models/Project';
import Link from 'CommonUI/src/Components/Link/Link';
import Route from 'Common/Types/API/Route';

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
                className="underline-on-hover"
                to={new Route(`/dashboard/${_id}`)}
            >
                <span>{props.project.name}</span>
            </Link>
        );
    }

    return <span>{props.project.name}</span>;
};

export default ProjectElement;
