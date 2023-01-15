import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import useComponentOutsideClick from '../../../Types/UseComponentOutsideClick';
import Icon, { IconProp } from '../../Icon/Icon';
import Project from 'Model/Models/Project';
import ProjectPickerMenu from './ProjectPickerMenu';
import ProjectPickerMenuItem from './ProjectPickerMenuItem';
import CreateNewProjectButton from './CreateNewProjectButton';

export interface ComponentProps {
    projects: Array<Project>;
    selectedProjectIcon: IconProp;
    selectedProjectName: string;
    onCreateProjectButtonClicked: () => void;
    onProjectSelected: (project: Project) => void;
}

const ProjectPicker: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const { ref, isComponentVisible, setIsComponentVisible } =
        useComponentOutsideClick(false);

    const [isDropdownVisible, setDropdownVisible] = useState<boolean>(false);

    const [filterValue, setFilterValue] = useState<string>('');

    useEffect(() => {
        setDropdownVisible(isComponentVisible);
    }, [isComponentVisible]);

    return (
        <div className="w-64">
            <div className="relative mt-3 w-full">
                <button
                    onClick={() => {
                        setIsComponentVisible(!isDropdownVisible);
                    }}
                    type="button"
                    className="relative w-full cursor-default rounded-md border border-gray-300 bg-white py-2 pl-3 pr-10 text-left shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm"
                    aria-haspopup="listbox"
                    aria-expanded="true"
                    aria-labelledby="listbox-label"
                >
                    <span className="flex items-center">
                        <Icon
                            icon={props.selectedProjectIcon}
                            className="h-6 w-6 flex-shrink-0 rounded-full"
                        />

                        <span className="ml-3 block truncate">
                            {props.selectedProjectName}
                        </span>
                    </span>
                    <span className="pointer-events-none absolute inset-y-0 right-0 ml-3 flex items-center pr-2">
                        <Icon
                            icon={IconProp.UpDownArrow}
                            className="h-5 w-5 text-gray-400"
                        />
                    </span>
                </button>
                <div ref={ref}>
                    {isComponentVisible && (
                        <ProjectPickerMenu
                            onFilter={(value: string) => {
                                setFilterValue(value.trim());
                            }}
                        >
                            <>
                                {props.projects && props.projects.length > 0 ? (
                                    props.projects
                                        .filter((project: Project) => {
                                            if (!filterValue) {
                                                return true;
                                            }
                                            return (
                                                project.name &&
                                                project.name
                                                    .toLowerCase()
                                                    .includes(filterValue)
                                            );
                                        })
                                        .map((project: Project, i: number) => {
                                            return (
                                                <ProjectPickerMenuItem
                                                    key={i}
                                                    project={project}
                                                    onProjectSelected={(
                                                        project: Project
                                                    ) => {
                                                        props.onProjectSelected(
                                                            project
                                                        );
                                                    }}
                                                    icon={IconProp.Folder}
                                                />
                                            );
                                        })
                                ) : (
                                    <></>
                                )}
                            </>
                            <CreateNewProjectButton
                                onCreateButtonClicked={() => {
                                    setIsComponentVisible(false);
                                    props.onCreateProjectButtonClicked();
                                }}
                            />
                        </ProjectPickerMenu>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProjectPicker;
