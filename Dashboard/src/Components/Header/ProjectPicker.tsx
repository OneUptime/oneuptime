import React, { FunctionComponent, ReactElement } from 'react';
import ProjectPicker from 'CommonUI/src/Components/Header/ProjectPicker/ProjectPicker';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Project from "Common/Models/Project"; 

const DashboardProjectPicker: FunctionComponent = (): ReactElement => {

    const project = new Project();
    project.name = "Sample 1"

    return (
        <ProjectPicker
            selectedProjectName="Project One"
            selectedProjectIcon={IconProp.Folder}
            projects={[project]}
            onCreateProjectButtonClicked = {()=>{}}
        />
    );
};

export default DashboardProjectPicker;
