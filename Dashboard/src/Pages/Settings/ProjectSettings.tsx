import Project from 'Model/Models/Project';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import DashboardNavigation from '../../Utils/Navigation';
import PageComponentProps from '../PageComponentProps';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Fragment>
            {/* Project Settings View  */}
            <CardModelDetail
                name="Project Details"
                cardProps={{
                    title: 'Project Details',
                    description: 'Here are more details for this Project.',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Project Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Project Name',
                        validation: {
                            minLength: 2,
                        },
                    },
                ]}
                modelDetailProps={{
                    modelType: Project,
                    id: 'model-detail-project',
                    fields: [
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Project ID',
                        },
                        {
                            field: {
                                name: true,
                            },
                            title: 'Project Name',
                        },
                    ],
                    modelId: DashboardNavigation.getProjectId()!,
                }}
            />
        </Fragment>
    );
};

export default Settings;
