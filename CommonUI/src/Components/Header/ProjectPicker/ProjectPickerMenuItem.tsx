import Project from 'Model/Models/Project';
import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';
import Icon, { IconProp } from '../../Icon/Icon';
import Navigation from '../../../Utils/Navigation';

export interface ComponentProps {
    icon: IconProp;
    onProjectSelected: (project: Project) => void;
    project: Project;
}

const ProjectPickerMenuItem: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const title: string = props.project.name!;
    const route: Route = new Route(
        '/dashboard/' + props.project.id?.toString()
    );

    return (
        <li
            className="text-gray-900 relative cursor-default select-none py-2 pl-3 pr-9 cursor-pointer hover:bg-gray-50"
            id="listbox-option-0"
            role="option"
            onClick={() => {
                props.onProjectSelected(props.project);
                Navigation.navigate(route);
            }}
        >
            <div className="flex items-center">
                <Icon
                    icon={props.icon}
                    className="h-6 w-6 flex-shrink-0 rounded-full"
                />
                <span className="cursor-pointer text-gray-500 hover:bg-gray-50 hover:text-gray-900 rounded-md py-2 px-3 inline-flex items-center text-sm font-medium block truncate">{title}</span>
            </div>
        </li>
    );
};

export default ProjectPickerMenuItem;
