import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import FieldLabelElement from 'CommonUI/src/Components/Forms/Fields/FieldLabel';
import MonitorStep from 'Common/Types/Monitor/MonitorStep';
import MonitorCriteriaElement from './MonitorCriteria';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import HorizontalRule from 'CommonUI/src/Components/HorizontalRule/HorizontalRule';
import Detail from 'CommonUI/src/Components/Detail/Detail';
import FieldType from 'CommonUI/src/Components/Types/FieldType';

export interface ComponentProps {
    monitorStatusDropdownOptions: Array<DropdownOption>;
    incidentSeverityDropdownOptions: Array<DropdownOption>;
    monitorStep: MonitorStep;
    monitorType: MonitorType;
}

const MonitorStepElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [destinationFieldTitle, setDestinationFieldTitle] =
        useState<string>('URL');
    const [destinationFieldDescription, setDestinationFieldDescription] =
        useState<string>('');

    useEffect(() => {
        if (props.monitorType === MonitorType.API) {
            setDestinationFieldTitle('API URL');
            setDestinationFieldDescription(
                'Whats the URL of the API you want to monitor?'
            );
        } else if (props.monitorType === MonitorType.Website) {
            setDestinationFieldTitle('Website URL');
            setDestinationFieldDescription(
                'Whats the URL of the website you want to monitor?'
            );
        } else if (props.monitorType === MonitorType.Ping) {
            setDestinationFieldTitle('Ping URL');
            setDestinationFieldDescription(
                'Whats the URL of the resource you want to ping?'
            );
        } else if (props.monitorType === MonitorType.IP) {
            setDestinationFieldTitle('IP Address');
            setDestinationFieldDescription(
                'Whats the IP address you want to monitor?'
            );
        }
    }, [props.monitorType]);

    return (
        <div className="mt-5">
            <div className="mt-5">
                <Detail
                    id={'monitor-step'}
                    item={props.monitorStep.data}
                    fields={[
                        {
                            key: 'monitorDestination',
                            title: destinationFieldTitle,
                            description: destinationFieldDescription,
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
                    ]}
                />
            </div>

            <HorizontalRule />

            <div className="mt-5">
                <FieldLabelElement
                    title="Monitor Criteria"
                    isHeading={true}
                    description={
                        'Add Monitoiring Criteria for this monitor. Monitor different properties.'
                    }
                    required={true}
                />
                <MonitorCriteriaElement
                    monitorStatusDropdownOptions={
                        props.monitorStatusDropdownOptions
                    }
                    incidentSeverityDropdownOptions={
                        props.incidentSeverityDropdownOptions
                    }
                    monitorCriteria={props.monitorStep?.data?.monitorCriteria!}
                />
            </div>
        </div>
    );
};

export default MonitorStepElement;
