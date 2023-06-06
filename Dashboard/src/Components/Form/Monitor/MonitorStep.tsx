import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import FieldLabelElement from 'CommonUI/src/Components/Forms/Fields/FieldLabel';
import Button, { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import MonitorStep from 'Common/Types/Monitor/MonitorStep';
import Input from 'CommonUI/src/Components/Input/Input';
import MonitorCriteriaElement from './MonitorCriteria';
import MonitorCriteria from 'Common/Types/Monitor/MonitorCriteria';
import Dropdown, {
    DropdownOption,
    DropdownValue,
} from 'CommonUI/src/Components/Dropdown/Dropdown';
import URL from 'Common/Types/API/URL';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import HTTPMethod from 'Common/Types/API/HTTPMethod';
import IP from 'Common/Types/IP/IP';
import DictionaryOfStrings from 'CommonUI/src/Components/Dictionary/DictionaryOfStrings';
import Dictionary from 'Common/Types/Dictionary';
import CodeEditor from 'CommonUI/src/Components/CodeEditor/CodeEditor';
import CodeType from 'Common/Types/Code/CodeType';
import HorizontalRule from 'CommonUI/src/Components/HorizontalRule/HorizontalRule';
import Exception from 'Common/Types/Exception/Exception';
import Hostname from 'Common/Types/API/Hostname';

export interface ComponentProps {
    monitorStatusDropdownOptions: Array<DropdownOption>;
    incidentSeverityDropdownOptions: Array<DropdownOption>;
    initialValue?: undefined | MonitorStep;
    onChange?: undefined | ((value: MonitorStep) => void);
    // onDelete?: undefined | (() => void);
    monitorType: MonitorType;
}

const MonitorStepElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [
        showAdvancedOptionsRequestBodyAndHeaders,
        setShowAdvancedOptionsRequestBodyAndHeaders,
    ] = useState<boolean>(false);

    const [monitorStep, setMonitorStep] = useState<MonitorStep>(
        props.initialValue || new MonitorStep()
    );

    useEffect(() => {
        if (props.onChange && monitorStep) {
            props.onChange(monitorStep);
        }
    }, [monitorStep]);

    const [errors, setErrors] = useState<Dictionary<string>>({});
    const [touched, setTouched] = useState<Dictionary<boolean>>({});

    const [destinationFieldTitle, setDestinationFieldTitle] =
        useState<string>('URL');
    const [destinationFieldDescription, setDestinationFieldDescription] =
        useState<string>('');
    const requestTypeDropdownOptions: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(HTTPMethod);

    const [destinationInputValue, setDestinationInputValue] = useState<string>(
        props.initialValue?.data?.monitorDestination?.toString() || ''
    );

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
            setDestinationFieldTitle('Ping Hostname or IP address');
            setDestinationFieldDescription(
                'Whats the Hostname or IP address of the resource you want to ping?'
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
                <FieldLabelElement
                    title={destinationFieldTitle}
                    description={destinationFieldDescription}
                    required={true}
                />
                <Input
                    initialValue={destinationInputValue}
                    onBlur={() => {
                        setTouched({
                            ...touched,
                            destination: true,
                        });

                        if (
                            !monitorStep?.data?.monitorDestination?.toString()
                        ) {
                            setErrors({
                                ...errors,
                                destination: 'Destination is required',
                            });
                        } else {
                            setErrors({
                                ...errors,
                                destination: '',
                            });
                            setDestinationInputValue(
                                monitorStep?.data?.monitorDestination?.toString()
                            );
                        }
                    }}
                    error={
                        touched['destination'] && errors['destination']
                            ? errors['destination']
                            : undefined
                    }
                    onChange={(value: string) => {
                        let destination: IP | URL | Hostname | undefined = undefined;

                        try {
                            if (props.monitorType === MonitorType.IP) {
                                destination = IP.fromString(value);
                            } else if (props.monitorType === MonitorType.Ping) {
                                if (IP.isIP(value)) {
                                    destination = IP.fromString(value);
                                } else {
                                    destination = Hostname.fromString(value);
                                }
                            } else if (
                                props.monitorType === MonitorType.Website
                            ) {
                                destination = URL.fromString(value);
                            } else if (props.monitorType === MonitorType.API) {
                                destination = URL.fromString(value);
                            }

                            setErrors({
                                ...errors,
                                destination: '',
                            });
                        } catch (err) {
                            if (err instanceof Exception) {
                                setErrors({
                                    ...errors,
                                    destination: err.message,
                                });
                            } else {
                                setErrors({
                                    ...errors,
                                    destination: 'Invalid Destination',
                                });
                            }
                        }

                        if (destination) {
                            monitorStep.setMonitorDestination(destination);
                        }

                        setDestinationInputValue(value);
                        setMonitorStep(MonitorStep.clone(monitorStep));
                    }}
                />
            </div>
            {props.monitorType === MonitorType.API && (
                <div className="mt-5">
                    <FieldLabelElement
                        title={'API Request Type'}
                        description={'Whats the type of the API request?'}
                        required={true}
                    />
                    <Dropdown
                        initialValue={requestTypeDropdownOptions.find(
                            (i: DropdownOption) => {
                                return (
                                    i.value ===
                                    (monitorStep?.data?.requestType ||
                                        HTTPMethod.GET)
                                );
                            }
                        )}
                        options={requestTypeDropdownOptions}
                        onChange={(
                            value: DropdownValue | Array<DropdownValue> | null
                        ) => {
                            monitorStep.setRequestType(
                                (value?.toString() as HTTPMethod) ||
                                    HTTPMethod.GET
                            );
                            setMonitorStep(MonitorStep.clone(monitorStep));
                        }}
                    />
                </div>
            )}

            {!showAdvancedOptionsRequestBodyAndHeaders &&
                props.monitorType === MonitorType.API && (
                    <div className="mt-1 -ml-3">
                        <Button
                            title="Advanced: Add Request Headers and Body"
                            buttonStyle={ButtonStyleType.SECONDARY_LINK}
                            onClick={() => {
                                setShowAdvancedOptionsRequestBodyAndHeaders(
                                    true
                                );
                            }}
                        />
                    </div>
                )}
            {showAdvancedOptionsRequestBodyAndHeaders &&
                props.monitorType === MonitorType.API && (
                    <div className="mt-5">
                        <FieldLabelElement
                            title={'Request Headers'}
                            description={'Request Headers to send, if any.'}
                            required={false}
                        />
                        <DictionaryOfStrings
                            addButtonSuffix="Request Header"
                            keyPlaceholder={'Header Name'}
                            valuePlaceholder={'Header Value'}
                            initialValue={
                                monitorStep.data?.requestHeaders || {}
                            }
                            onChange={(value: Dictionary<string>) => {
                                monitorStep.setRequestHeaders(value);
                                setMonitorStep(MonitorStep.clone(monitorStep));
                            }}
                        />
                    </div>
                )}

            {showAdvancedOptionsRequestBodyAndHeaders &&
                props.monitorType === MonitorType.API && (
                    <div className="mt-5">
                        <FieldLabelElement
                            title={'Request Body (in JSON)'}
                            description={
                                'Request Body to send in JSON, if any.'
                            }
                            required={false}
                        />
                        <CodeEditor
                            type={CodeType.JSON}
                            onBlur={() => {
                                setTouched({
                                    ...touched,
                                    requestBody: true,
                                });
                            }}
                            error={
                                touched['requestBody'] && errors['requestBody']
                                    ? errors['requestBody']
                                    : undefined
                            }
                            initialValue={monitorStep.data?.requestBody}
                            onChange={(value: string) => {
                                try {
                                    JSON.parse(value);
                                    setErrors({
                                        ...errors,
                                        requestBody: '',
                                    });
                                } catch (err) {
                                    setErrors({
                                        ...errors,
                                        requestBody: 'Invalid JSON',
                                    });
                                }

                                monitorStep.setRequestBody(value);
                                setMonitorStep(MonitorStep.clone(monitorStep));
                            }}
                        />
                    </div>
                )}

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
                    monitorType={props.monitorType}
                    monitorStatusDropdownOptions={
                        props.monitorStatusDropdownOptions
                    }
                    incidentSeverityDropdownOptions={
                        props.incidentSeverityDropdownOptions
                    }
                    initialValue={monitorStep?.data?.monitorCriteria}
                    onChange={(value: MonitorCriteria) => {
                        monitorStep.setMonitorCriteria(value);
                        setMonitorStep(MonitorStep.clone(monitorStep));
                    }}
                />
            </div>

            {/* <div className='mt-5 -ml-3'>
                <Button
                    onClick={() => {
                        if (props.onDelete) {
                            props.onDelete();
                        }
                    }}
                    buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                    buttonSize={ButtonSize.Small}
                    title="Delete Monitor Step"
                />
            </div> */}
        </div>
    );
};

export default MonitorStepElement;
