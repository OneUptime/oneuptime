import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement } from 'react';
import CircularIconImage from '../../Icon/CircularIconImage';
import { IconProp } from '../../Icon/Icon';

export interface ComponentProps {
    onCreateButtonClicked: () => void;
}

const CreateNewProjectButton: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div
            className="flex items-center p-10 background-primary-on-hover"
            onClick={() => {
                props.onCreateButtonClicked();
            }}
        >
            <CircularIconImage
                icon={IconProp.Add}
                iconColor={new Color('#000')}
                backgroundColor={new Color('#fff')}
            />

            <p className="mb-0">Create New Project</p>
        </div>
    );
};

export default CreateNewProjectButton;
