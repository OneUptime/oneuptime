import Project from 'Common/Models/Project';
import Route from 'Common/Types/API/Route';
import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';
import CircularIconImage from '../../Icon/CircularIconImage';
import { IconProp } from '../../Icon/Icon';
import Link from '../../Link/Link';

export interface ComponentProps {
    icon: IconProp;
    onProjectSelected: (project: Project) => void;
    project: Project
}

const ProjectPickerMenuItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const title = props.project.name!
    const route = new Route(
        '/dashboard/' +
        props.project.id?.toString()
    )

    return (
        <Link
            to={route}
            className="flex items-center p-10 background-primary-on-hover"
            onClick={() => {
                props.onProjectSelected(props.project);
            }}
        >
            <CircularIconImage
                icon={props.icon}
                iconColor={new Color('#000')}
                backgroundColor={new Color('#fff')}
            />

            <p className="mb-0">{title}</p>
        </Link>
    );
};

export default ProjectPickerMenuItem;
