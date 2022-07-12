import React, { FunctionComponent, ReactElement, useState } from 'react';
import ProjectPicker from 'CommonUI/src/Components/Header/ProjectPicker/ProjectPicker';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Project from 'Common/Models/Project';
import ModelFromModal from 'CommonUI/src/Components/ModelFormModal/ModelFormModal';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import ProjectUtil from "CommonUI/src/Utils/Project";
import { useEffect } from 'react';

export interface ComponentProps {
    projects: Array<Project>;
}

const DashboardProjectPicker: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {
    const project: Project = new Project();
    project.name = 'Sample 1';

    const [showModel, setShowModel] = useState<boolean>(false);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);

    useEffect(() => {
        setSelectedProject(ProjectUtil.getCurrentProject())
    }, []);

    useEffect(() => {
        ProjectUtil.setCurrentProject(project);
    }, [selectedProject]);

    return (
        <>
            <ProjectPicker
                selectedProjectName={selectedProject?.name || ''}
                selectedProjectIcon={IconProp.Folder}
                projects={props.projects}
                onCreateProjectButtonClicked={() => {
                    setShowModel(true);
                }}
            />
            {showModel ? (
                <ModelFromModal<Project>
                    title="Create New Project"
                    onClose={() => {
                        setShowModel(false);
                    }}
                    submitButtonText="Create Project"
                    onSuccess={(project: Project) => {
                        setSelectedProject(project);
                        setShowModel(false);
                    }}
                    formProps={{
                        model: new Project(),
                        id: 'create-project-from',
                        fields: [
                            {
                                field: {
                                    name: true,
                                },
                                validation: {
                                    minLength: 6,
                                },
                                fieldType: FormFieldSchemaType.Text,
                                placeholder: 'Acme',
                                title: 'Project Name',
                                required: true,
                            },
                        ],
                        formType: FormType.Create,
                    }}
                />
            ) : (
                <></>
            )}
        </>
    );
};

export default DashboardProjectPicker;
