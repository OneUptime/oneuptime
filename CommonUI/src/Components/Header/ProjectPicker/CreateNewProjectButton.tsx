import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp } from '../../Icon/Icon';

export interface ComponentProps {
    onCreateButtonClicked: () => void;
}

const CreateNewProjectButton: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <li
            className="text-gray-900 relative cursor-default select-none py-2 pl-3 pr-9 bg-gray-100 cursor-pointer hover:bg-gray-200 hover:text-gray-900 text-gray-500 -mb-1"
            id="listbox-option-0"
            role="option"
            onClick={() => {
                props.onCreateButtonClicked();
            }}
        >
            <div className="flex items-center">
                <Icon
                    icon={IconProp.Add}
                    className="h-6 w-6 flex-shrink-0 rounded-full"
                />
                <span className="cursor-pointer rounded-md py-2 px-3 inline-flex items-center text-sm font-medium block truncate">
                    Create New Project
                </span>
            </div>
        </li>
    );
};

export default CreateNewProjectButton;
