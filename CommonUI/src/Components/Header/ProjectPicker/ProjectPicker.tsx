import Color from 'Common/Types/Color';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import useComponentOutsideClick from '../../../Types/UseComponentOutsideClick';
import CircularIconImage from '../../Icon/CircularIconImage';
import Icon, { IconProp } from '../../Icon/Icon';
import Project from "Common/Models/Project";
import ProjectPickerMenu from './ProjectPickerMenu';
import ProjectPickerMenuItem from './ProjectPickerMenuItem';
import Route from 'Common/Types/API/Route';
import CreateNewProjectButton from './CreateNewProjectButton';

export interface ComponentProps {
    projects: Array<Project>;
    selectedProjectIcon: IconProp;
    selectedProjectName: string;
    onCreateProjectButtonClicked: () => void;
}

const ProjectPicker: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const { ref, isComponentVisible, setIsComponentVisible } =
        useComponentOutsideClick(false);

    const [filterValue, setFilterValue] = useState<string>('');

    return (
        <div className="d-inline-block dropdown">
            <button
                onClick={() => {
                    setIsComponentVisible(!isComponentVisible);
                }}
                id="page-header-user-dropdown"
                aria-haspopup="true"
                className="btn header-item flex items-center pr-30"
                aria-expanded="false"
                style={{
                    paddingLeft: "0px",
                    marginLeft: "-8px"
                }}
            >
                <CircularIconImage
                    icon={props.selectedProjectIcon}
                    iconColor={new Color('#000')}
                    backgroundColor={new Color('#fff')}
                />
                <h6 className="mb-0">{props.selectedProjectName}</h6>
                <Icon icon={IconProp.ChevronDown} />
            </button>
            <div ref={ref}>{isComponentVisible && <ProjectPickerMenu onFilter={(value) => { setFilterValue(value.trim()) }}>
                <>
                    {props.projects && props.projects.length > 0 ?
                        props.projects.filter((project) => {
                            if (!filterValue) {
                                return true;
                            }
                            return project.name && project.name.toLowerCase().includes(filterValue);
                        })
                            .map((project: Project, i: number) => {
                                return (<ProjectPickerMenuItem
                                    key={i}
                                    title={project.name!}
                                    route={new Route('/')}
                                    icon={IconProp.Folder}
                                />)
                            }) : <></>}
                </>
                <CreateNewProjectButton onCreateButtonClicked={() => {
                    setIsComponentVisible(false);
                    props.onCreateProjectButtonClicked();
                }} />
            </ProjectPickerMenu>}</div>
        </div>
    );
};

export default ProjectPicker;
