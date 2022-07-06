import Route from 'Common/Types/API/Route';
import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';
import CircularIconImage from '../../Icon/CircularIconImage';
import { IconProp } from '../../Icon/Icon';
import Link from '../../Link/Link';

const CreateNewProjectButton: FunctionComponent = (): ReactElement => {
    return (
        <Link
            to={new Route('/')}
            className="flex items-center p-10 background-primary-on-hover"
        >
            <CircularIconImage
                icon={IconProp.Add}
                iconColor={new Color('#000')}
                backgroundColor={new Color('#fff')}
            />

            <p className="mb-0">Create New Project</p>
        </Link>
    );
};

export default CreateNewProjectButton;
