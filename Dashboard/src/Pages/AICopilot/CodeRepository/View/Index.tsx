import LabelsElement from '../../../../Components/Label/Labels';
import PageComponentProps from '../../../PageComponentProps';
import ObjectID from 'Common/Types/ObjectID';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import CodeRepository from 'Model/Models/CodeRepository';
import Label from 'Model/Models/Label';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';

const StatusPageView: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID();

    return (
        <Fragment>
            {/* CodeRepository View  */}
            <CardModelDetail<CodeRepository>
                name="Git Repository > Repository Details"
                cardProps={{
                    title: 'Repository Details',
                    description: 'Here are more details for this repository.',
                }}
                formSteps={[
                    {
                        title: 'Repository Info',
                        id: 'repository-info',
                    },
                    {
                        title: 'Labels',
                        id: 'labels',
                    },
                ]}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        stepId: 'repository-info',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'Service Name',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        stepId: 'repository-info',
                        title: 'Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder: 'Description',
                    },
                    {
                        field: {
                            labels: true,
                        },
                        title: 'Labels ',
                        stepId: 'labels',
                        description:
                            'Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Label,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Labels',
                    },
                ]}
                modelDetailProps={{
                    showDetailsInNumberOfColumns: 2,
                    modelType: CodeRepository,
                    id: 'model-detail-service-catalog',
                    fields: [
                        {
                            field: {
                                _id: true,
                            },
                            title: 'Service ID',
                        },
                        {
                            field: {
                                name: true,
                            },
                            title: 'Service Name',
                        },
                        {
                            field: {
                                labels: {
                                    name: true,
                                    color: true,
                                },
                            },
                            title: 'Labels',
                            fieldType: FieldType.Element,
                            getElement: (
                                item: CodeRepository
                            ): ReactElement => {
                                return (
                                    <LabelsElement
                                        labels={item['labels'] || []}
                                    />
                                );
                            },
                        },
                        {
                            field: {
                                description: true,
                            },
                            title: 'Description',
                        },
                        {
                            field: {
                                secretToken: true,
                            },
                            title: 'Secret Token',
                            fieldType: FieldType.HiddenText,
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </Fragment>
    );
};

export default StatusPageView;