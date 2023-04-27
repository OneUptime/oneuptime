import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import FieldLabelElement from 'CommonUI/src/Components/Forms/Fields/FieldLabel';
import MonitorStep from 'Common/Types/Monitor/MonitorStep';
import MonitorCriteriaElement from './MonitorCriteria';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import HorizontalRule from 'CommonUI/src/Components/HorizontalRule/HorizontalRule';
import Detail from 'CommonUI/src/Components/Detail/Detail';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Field from 'CommonUI/src/Components/Detail/Field';
import MonitorStatus from 'Model/Models/MonitorStatus';
import IncidentSeverity from 'Model/Models/IncidentSeverity';

export interface ComponentProps {
    monitorStatusOptions: Array<MonitorStatus>;
    incidentSeverityOptions: Array<IncidentSeverity>;
    monitorStep: MonitorStep;
    monitorType: MonitorType;
}

const MonitorStepElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [requestDetailsFields, setRequestDetailsFields] = useState<
        Array<Field>
    >([]);

    useEffect(() => {
        let fields: Array<Field> = [];

        if (props.monitorType === MonitorType.API) {
            fields = [
                {
                    key: 'monitorDestination',
                    title: 'API URL',
                    description: 'URL of the API you want to monitor.',
                    fieldType: FieldType.Text,
                    placeholder: 'No data entered',
                },
                {
                    key: 'requestType',
                    title: 'Request Type',
                    description: 'Whats the type of the API request?',
                    fieldType: FieldType.Text,
                    placeholder: 'No data entered',
                },
                {
                    key: 'requestBody',
                    title: 'Request Body',
                    description: 'Request Body to send, if any.',
                    fieldType: FieldType.JSON,
                    placeholder: 'No data entered',
                },
                {
                    key: 'requestHeaders',
                    title: 'Request Headers',
                    description: 'Request Headers to send, if any.',
                    fieldType: FieldType.DictionaryOfStrings,
                    placeholder: 'No data entered',
                },
            ];
        } else if (props.monitorType === MonitorType.Website) {
            fields = [
                {
                    key: 'monitorDestination',
                    title: 'Website URL',
                    description: 'URL of the website you want to monitor.',
                    fieldType: FieldType.Text,
                    placeholder: 'No data entered',
                },
            ];
        } else if (props.monitorType === MonitorType.Ping) {
            fields = [
                {
                    key: 'monitorDestination',
                    title: 'Ping URL',
                    description:
                        'URL of the resources you would like us to ping.',
                    fieldType: FieldType.Text,
                    placeholder: 'No data entered',
                },
            ];
        } else if (props.monitorType === MonitorType.IP) {
            fields = [
                {
                    key: 'monitorDestination',
                    title: 'IP Address',
                    description:
                        'IP Address of the resource you would like us to ping.',
                    fieldType: FieldType.Text,
                    placeholder: 'No data entered',
                },
            ];
        }
        setRequestDetailsFields(fields);
    }, [props.monitorType]);

    return (
        <div className="mt-5">
            <FieldLabelElement
                title={'Request Details'}
                description={
                    'Here is the details of the request we will send to monitor your resource status.'
                }
                required={true}
                isHeading={true}
            />
            <div className="mt-5">
                <Detail
                    id={'monitor-step'}
                    item={props.monitorStep.data}
                    fields={requestDetailsFields}
                />
            </div>

            <HorizontalRule />

            <div className="mt-5">
                <FieldLabelElement
                    title="Criteria"
                    isHeading={true}
                    description={
                        'Criteria we will use to determine if your resource status.'
                    }
                    required={true}
                />

                <MonitorCriteriaElement
                    monitorStatusOptions={props.monitorStatusOptions}
                    incidentSeverityOptions={props.incidentSeverityOptions}
                    monitorCriteria={props.monitorStep?.data?.monitorCriteria!}
                />
            </div>
        </div>
    );
};

export default MonitorStepElement;
