import Project from 'Model/Models/Project';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import CardModelDetail from 'CommonUI/src/Components/ModelDetail/CardModelDetail';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import DashboardNavigation from '../../Utils/Navigation';
import PageComponentProps from '../PageComponentProps';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Alert, { AlertType } from 'CommonUI/src/Components/Alerts/Alert';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Fragment>
            <Alert
                type={AlertType.DANGER}
                strongTitle="Please note"
                title="Changing the data retention settings will impact your billing. Please refer to the pricing page at https://oneuptime.com/pricing for more details."
            />

            {/* Project Settings View  */}
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
                    modelType: Project,
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
                    modelId: DashboardNavigation.getProjectId()!,
                }}
            />
        </Fragment>
    );
};

export default Settings;
