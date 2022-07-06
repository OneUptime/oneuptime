import Route from 'Common/Types/API/Route';
import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';
import CircularIconImage from '../../Icon/CircularIconImage';
import { IconProp } from '../../Icon/Icon';
import Link from '../../Link/Link';

export interface ComponentProps {
    title: string;
    route: Route;
    icon: IconProp;
}

const ProjectPickerMenuItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <Link
            to={props.route}
            className="flex items-center p-10 background-primary-on-hover"
        >
            <CircularIconImage
                icon={props.icon}
                iconColor={new Color('#000')}
                backgroundColor={new Color('#fff')}
            />

            <p className="mb-0">{props.title}</p>
        </Link>
    );
};

export default ProjectPickerMenuItem;
