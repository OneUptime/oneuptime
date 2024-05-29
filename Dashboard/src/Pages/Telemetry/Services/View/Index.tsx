import LabelsElement from '../../../../Components/Label/Labels';
import PageComponentProps from '../../../PageComponentProps';
import ObjectID from 'Common/Types/ObjectID';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Label from 'Model/Models/Label';
import TelemetryService from 'Model/Models/TelemetryService';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';

const ServiceDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(0);

    return (
        <Fragment>
            {/* Service View  */}
            <CardModelDetail<TelemetryService>
                name="Service Details"
                formSteps={[
                    {
                        title: 'Service Info',
                        id: 'service-info',
                    },
                    {
                        title: 'Labels',
                        id: 'labels',
                    },
                ]}
                cardProps={{
                    title: 'Service Details',
                    description: 'Here are more details for this service.',
                }}
                isEditable={true}
                formFields={[
                    {
                        field: {
                            name: true,
                        },
                        stepId: 'service-info',
                        title: 'Name',
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
                        stepId: 'service-info',
                        title: 'Description',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder: 'Description',
                    },
                    {
                        field: {
                            labels: true,
                        },
                        stepId: 'labels',
                        title: 'Labels ',
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
                    modelType: TelemetryService,
                    id: 'model-detail-services',
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
                                item: TelemetryService
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
                                telemetryServiceToken: true,
                            },
                            title: 'Service Token',
                            fieldType: FieldType.HiddenText,
                        },
                    ],
                    modelId: modelId,
                }}
            />
        </Fragment>
    );
};

export default ServiceDelete;
