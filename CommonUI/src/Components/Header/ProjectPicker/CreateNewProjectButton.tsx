
import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp } from '../../Icon/Icon';

export interface ComponentProps {
    onCreateButtonClicked: () => void;
}

const CreateNewProjectButton: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    return ( <li
        className="text-gray-900 relative cursor-default select-none py-2 pl-3 pr-9 bg-gray-200 cursor-pointer"
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
            <span className="font-normal ml-3 block truncate">Create New Project</span>
        </div>
    </li>)

};

export default CreateNewProjectButton;
