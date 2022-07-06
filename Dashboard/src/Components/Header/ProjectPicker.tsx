import React, { FunctionComponent, ReactElement, useState } from 'react';
import ProjectPicker from 'CommonUI/src/Components/Header/ProjectPicker/ProjectPicker';
import { IconProp } from 'CommonUI/src/Components/Icon/Icon';
import Project from "Common/Models/Project";
import ModelFromModal from "CommonUI/src/Components/ModelFormModal/ModelFormModal";
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import { JSONObject } from 'Common/Types/JSON';

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
            {showModel ? <ModelFromModal<Project>
                title="Create New Project"
                onClose={() => {
                    setShowModel(false);
                }}
                submitButtonText="Create Project"
                onSubmit={() => {

                }}
                formProps={
                    {
                        model: new Project(),
                        id: "create-project-from",
                        fields: [
                            {
                                field: {
                                    name: true,
                                },
                                validation: {
                                    minLength: 6,
                                },
                                fieldType:
                                    FormFieldSchemaType.Text,
                                placeholder:
                                    'Acme',
                                title: 'Project Name',
                                required: true,
                            }
                        ],
                        formType: FormType.Create,
                        onSuccess: (_value: JSONObject) => {
                            
                        }
                    }
                }
            /> : <></>}
        </>
    );
};

export default DashboardProjectPicker;
