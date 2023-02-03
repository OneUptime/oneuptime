import type { FunctionComponent, ReactElement } from 'react';
import React from 'react';
import ProjectPickerFilterBox from './ProjectPickerFilterBox';

export interface ComponentProps {
    children: ReactElement | Array<ReactElement>;
    onFilter: (value: string) => void;
}

const ProjectPickerMenu: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <ul
            className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm"
            role="listbox"
            aria-labelledby="listbox-label"
            aria-activedescendant="listbox-option-3"
        >
            <ProjectPickerFilterBox
                key={2}
                onChange={(value: string) => {
                    props.onFilter(value);
                }}
            />
            {props.children}
        </ul>
    );
};

export default ProjectPickerMenu;
