import PageComponentProps from '../../../PageComponentProps';
import ObjectID from 'Common/Types/ObjectID';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import ResetObjectID from 'CommonUI/src/Components/ResetObjectID/ResetObjectID';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import TelemetryService from 'Model/Models/TelemetryService';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';

const ServiceDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    return (
        <Fragment>
            <CardModelDetail
                name="Data Retention"
                cardProps={{
                    title: 'Telemetry Data Retention',
                    description:
                        'Configure how long you want to keep your telemetry data - like Logs, Metrics, and Traces.',
                }}
                isEditable={true}
                editButtonText="Edit Data Retention"
                formFields={[
                    {
                        field: {
                            retainTelemetryDataForDays: true,
                        },
                        title: 'Telemetry Data Retention (Days)',
                        description:
                            'How long do you want to keep your telemetry data - like Logs, Metrics, and Traces.',
                        fieldType: FormFieldSchemaType.Number,
                        required: true,
                        placeholder: '15',
                    },
                ]}
                modelDetailProps={{
                    modelType: TelemetryService,
                    id: 'model-detail-project',
                    fields: [
                        {
                            field: {
                                retainTelemetryDataForDays: true,
                            },
                            title: 'Telemetry Data Retention (Days)',
                            description:
                                'How long do you want to keep your telemetry data - like Logs, Metrics, and Traces.',
                            fieldType: FieldType.Number,
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <CardModelDetail
                name="Telemetry Service Settings"
                cardProps={{
                    title: 'Telemetry Service Settings',
                    description:
                        'Configure settings for your telemetry service.',
                }}
                isEditable={true}
                editButtonText="Edit Settings"
                formFields={[
                    {
                        field: {
                            serviceColor: true,
                        },
                        title: 'Service Color',
                        description:
                            'Choose a color for your telemetry service.',
                        fieldType: FormFieldSchemaType.Color,
                        required: true,
                        placeholder: '15',
                    },
                ]}
                modelDetailProps={{
                    modelType: TelemetryService,
                    id: 'model-detail-project',
                    fields: [
                        {
                            field: {
                                serviceColor: true,
                            },
                            title: 'Service Color',
                            description: 'Color for your telemetry service.',
                            fieldType: FieldType.Color,
                        },
                    ],
                    modelId: modelId,
                }}
            />

            <ResetObjectID<TelemetryService>
                modelType={TelemetryService}
                fieldName={'telemetryServiceToken'}
                title={'Reset Service Token'}
                description={'Reset the service token to a new value.'}
                modelId={modelId}
            />
        </Fragment>
    );
};

export default ServiceDelete;
