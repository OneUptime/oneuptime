import React, {
    FunctionComponent,
    ReactElement,
    useState,
    useEffect,
} from 'react';
import ProjectPicker from 'CommonUI/src/Components/Header/ProjectPicker/ProjectPicker';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Project from 'Model/Models/Project';
import ModelFormModal from 'CommonUI/src/Components/ModelFormModal/ModelFormModal';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import ProjectUtil from 'CommonUI/src/Utils/Project';

export interface ComponentProps {
    projects: Array<Project>;
    onProjectSelected: (project: Project) => void;
}

const DashboardProjectPicker: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [showModel, setShowModel] = useState<boolean>(false);
    const [selectedProject, setSelectedProject] = useState<Project | null>(
        null
    );

    useEffect(() => {
        const currentProject: Project | null = ProjectUtil.getCurrentProject();
        setSelectedProject(currentProject);
        if (currentProject && props.onProjectSelected) {
            props.onProjectSelected(currentProject);
        }
    }, []);

    useEffect(() => {
        if (selectedProject) {
            ProjectUtil.setCurrentProject(selectedProject);
            if (props.onProjectSelected) {
                props.onProjectSelected(selectedProject);
            }
        }
    }, [selectedProject]);

    useEffect(() => {
        if (
            props.projects &&
            props.projects.length > 0 &&
            !selectedProject &&
            props.projects[0]
        ) {
            setSelectedProject(props.projects[0]);
        }
    }, [props.projects]);

    return (
        <>
            <ProjectPicker
                selectedProjectName={selectedProject?.name || ''}
                selectedProjectIcon={IconProp.Folder}
                projects={props.projects}
                onCreateProjectButtonClicked={() => {
                    setShowModel(true);
                }}
                onProjectSelected={(project: Project) => {
                    setSelectedProject(project);
                }}
            />
            {showModel ? (
                <ModelFormModal<Project>
                    modelType={Project}
                    title="Create New Project"
                    onClose={() => {
                        setShowModel(false);
                    }}
                    submitButtonText="Create Project"
                    onSuccess={(project: Project) => {
                        setSelectedProject(project);
                        if (project && props.onProjectSelected) {
                            props.onProjectSelected(project);
                        }
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
