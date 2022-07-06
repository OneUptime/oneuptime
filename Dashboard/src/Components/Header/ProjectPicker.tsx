import React, { FunctionComponent, ReactElement, useState } from 'react';
import ProjectPicker from 'CommonUI/src/Components/Header/ProjectPicker/ProjectPicker';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Project from "Common/Models/Project";
import ModelFromModal from "CommonUI/src/Components/ModelFormModal/ModelFormModal";

const DashboardProjectPicker: FunctionComponent = (): ReactElement => {

    const project = new Project();
    project.name = "Sample 1"

    const [showModel, setShowModel] = useState<boolean>(false);


    return (
        <>
            <ProjectPicker
                selectedProjectName="Project One"
                selectedProjectIcon={IconProp.Folder}
                projects={[project]}
                onCreateProjectButtonClicked={() => {
                    setShowModel(true);
                }}
            />
            {showModel ? <ModelFromModal
                title="Create New Project"
                onClose={() => {
                    setShowModel(false);
                }}
                submitButtonText="Create Project"
                onSubmit={() => {

                }}
            ><div></div></ModelFromModal> : <></>}
        </>
    );
};

export default DashboardProjectPicker;
