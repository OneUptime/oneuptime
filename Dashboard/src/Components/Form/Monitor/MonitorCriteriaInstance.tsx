import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Dropdown, {
    DropdownOption,
    DropdownValue,
} from 'CommonUI/src/Components/Dropdown/Dropdown';
import MonitorCriteriaInstance from 'Common/Types/Monitor/MonitorCriteriaInstance';
import FieldLabelElement from 'CommonUI/src/Components/Forms/Fields/FieldLabel';
import ObjectID from 'Common/Types/ObjectID';
import {
    CriteriaFilter,
    FilterCondition,
} from 'Common/Types/Monitor/CriteriaFilter';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import CriteriaFilters from './CriteriaFilters';
import Button, {
    ButtonSize,
    ButtonStyleType,
} from 'CommonUI/src/Components/Button/Button';
import MonitorCriteriaIncidentsForm from './MonitorCriteriaIncidentsForm';
import { CriteriaIncident } from 'Common/Types/Monitor/CriteriaIncident';
import Radio from 'CommonUI/src/Components/Radio/Radio';
import Toggle from 'CommonUI/src/Components/Toggle/Toggle';
import IconProp from 'Common/Types/Icon/IconProp';
import Input from 'CommonUI/src/Components/Input/Input';
import TextArea from 'CommonUI/src/Components/TextArea/TextArea';
import HorizontalRule from 'CommonUI/src/Components/HorizontalRule/HorizontalRule';
import Dictionary from 'Common/Types/Dictionary';
import MonitorType from 'Common/Types/Monitor/MonitorType';

export interface ComponentProps {
    monitorStatusDropdownOptions: Array<DropdownOption>;
    incidentSeverityDropdownOptions: Array<DropdownOption>;
    monitorType: MonitorType;
    initialValue?: undefined | MonitorCriteriaInstance;
    onChange?: undefined | ((value: MonitorCriteriaInstance) => void);
    onDelete?: undefined | (() => void);
}

const MonitorCriteriaInstanceElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [monitorCriteriaInstance, setMonitorCriteriaInstance] =
        useState<MonitorCriteriaInstance>(
            props.initialValue || new MonitorCriteriaInstance()
        );

    const [defaultMonitorStatusId, setDefaultMonitorStatusId] = useState<
        ObjectID | undefined
    >(monitorCriteriaInstance?.data?.monitorStatusId);

    useEffect(() => {
        if (props.onChange && monitorCriteriaInstance) {
            props.onChange(monitorCriteriaInstance);
        }
    }, [monitorCriteriaInstance]);

    const filterConditionOptions: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(FilterCondition);

    const [errors, setErrors] = useState<Dictionary<string>>({});
    const [touched, setTouched] = useState<Dictionary<boolean>>({});

    useEffect(() => {
        // set first value as default
        if (
            props.monitorStatusDropdownOptions.length > 0 &&
            !defaultMonitorStatusId &&
            props.monitorStatusDropdownOptions[0] &&
            props.monitorStatusDropdownOptions[0].value
        ) {
            setDefaultMonitorStatusId(
                new ObjectID(
                    props.monitorStatusDropdownOptions[0].value.toString()
                )
            );
        }
    }, [props.monitorStatusDropdownOptions]);

    const [showMonitorStatusChangeControl, setShowMonitorStatusChangeControl] =
        useState<boolean>(
            Boolean(props.initialValue?.data?.monitorStatusId?.id) || false
        );
    const [showIncidentControl, setShowIncidentControl] = useState<boolean>(
        (props.initialValue?.data?.incidents?.length || 0) > 0
    );

    return (
        <div className="mt-4">
            <div className="mt-5">
                <FieldLabelElement
                    title={'Criteria Name'}
                    description={
                        'Any friendly name for this criteria, that will help you remember later.'
                    }
                    required={true}
                />
                <Input
                    initialValue={
                        monitorCriteriaInstance?.data?.name?.toString() || ''
                    }
                    onBlur={() => {
                        setTouched({
                            ...touched,
                            name: true,
                        });

                        if (!monitorCriteriaInstance?.data?.name) {
                            setErrors({
                                ...errors,
                                name: 'Name is required',
                            });
                        } else {
                            setErrors({
                                ...errors,
                                name: '',
                            });
                        }
                    }}
                    error={
                        touched['name'] && errors['name']
                            ? errors['name']
                            : undefined
                    }
                    placeholder="Online Criteria"
                    onChange={(value: string) => {
                        if (!value) {
                            setErrors({
                                ...errors,
                                name: 'Name is required',
                            });
                        } else {
                            setErrors({
                                ...errors,
                                name: '',
                            });
                        }

                        monitorCriteriaInstance.setName(value);
                        setMonitorCriteriaInstance(
                            MonitorCriteriaInstance.clone(
                                monitorCriteriaInstance
                            )
                        );
                    }}
                />
            </div>
            <div className="mt-5">
                <FieldLabelElement
                    title={'Criteria Description'}
                    description={
                        'Any friendly description for this criteria, that will help you remember later.'
                    }
                    required={true}
                />
                <TextArea
                    initialValue={
                        monitorCriteriaInstance?.data?.description?.toString() ||
                        ''
                    }
                    onBlur={() => {
                        setTouched({
                            ...touched,
                            description: true,
                        });

                        if (!monitorCriteriaInstance?.data?.description) {
                            setErrors({
                                ...errors,
                                description: 'Description is required',
                            });
                        } else {
                            setErrors({
                                ...errors,
                                description: '',
                            });
                        }
                    }}
                    error={
                        touched['description'] && errors['description']
                            ? errors['description']
                            : undefined
                    }
                    onChange={(value: string) => {
                        if (!value) {
                            setErrors({
                                ...errors,
                                description: 'Description is required',
                            });
                        } else {
                            setErrors({
                                ...errors,
                                description: '',
                            });
                        }
                        monitorCriteriaInstance.setDescription(value);
                        setMonitorCriteriaInstance(
                            MonitorCriteriaInstance.clone(
                                monitorCriteriaInstance
                            )
                        );
                    }}
                    placeholder="This criteria checks if the monitor is online."
                />
            </div>
            <div className="mt-4">
                <FieldLabelElement
                    title="Filter Condition"
                    description="Select All if you want all the criteria to be met. Select any if you like any criteria to be met."
                    required={true}
                />
                <Radio
                    initialValue={filterConditionOptions.find(
                        (i: DropdownOption) => {
                            return (
                                i.value ===
                                (monitorCriteriaInstance?.data
                                    ?.filterCondition || FilterCondition.All)
                            );
                        }
                    )}
                    options={filterConditionOptions}
                    onChange={(
                        value: DropdownValue | Array<DropdownValue> | null
                    ) => {
                        monitorCriteriaInstance.setFilterCondition(
                            value as FilterCondition
                        );
                        setMonitorCriteriaInstance(
                            MonitorCriteriaInstance.clone(
                                monitorCriteriaInstance
                            )
                        );
                    }}
                />
            </div>
            <div className="mt-4">
                <FieldLabelElement
                    title="Filters"
                    required={true}
                    description="Add criteria for different monitor properties."
                />

                <CriteriaFilters
                    monitorType={props.monitorType}
                    initialValue={monitorCriteriaInstance?.data?.filters || []}
                    onChange={(value: Array<CriteriaFilter>) => {
                        monitorCriteriaInstance.setFilters(value);
                        setMonitorCriteriaInstance(
                            MonitorCriteriaInstance.clone(
                                monitorCriteriaInstance
                            )
                        );
                    }}
                />
            </div>

            <div className="mt-4">
                <Toggle
                    initialValue={Boolean(showMonitorStatusChangeControl)}
                    title="When filters match, Change monitor status"
                    onChange={(value: boolean) => {
                        setShowMonitorStatusChangeControl(value);
                        monitorCriteriaInstance.setChangeMonitorStatus(value);

                        if (!value) {
                            monitorCriteriaInstance.setMonitorStatusId(
                                undefined
                            );
                        }

                        setMonitorCriteriaInstance(
                            MonitorCriteriaInstance.clone(
                                monitorCriteriaInstance
                            )
                        );
                    }}
                />
            </div>

            {showMonitorStatusChangeControl && (
                <div className="mt-4">
                    <FieldLabelElement
                        title="Change monitor status to"
                        description="What would like the monitor status to be when the criteria is met?"
                    />
                    <Dropdown
                        initialValue={props.monitorStatusDropdownOptions.find(
                            (i: DropdownOption) => {
                                return (
                                    i.value ===
                                        monitorCriteriaInstance?.data
                                            ?.monitorStatusId?.id || undefined
                                );
                            }
                        )}
                        options={props.monitorStatusDropdownOptions}
                        onChange={(
                            value: DropdownValue | Array<DropdownValue> | null
                        ) => {
                            monitorCriteriaInstance.setMonitorStatusId(
                                value
                                    ? new ObjectID(value.toString())
                                    : undefined
                            );
                            setMonitorCriteriaInstance(
                                MonitorCriteriaInstance.clone(
                                    monitorCriteriaInstance
                                )
                            );
                        }}
                    />
                </div>
            )}

            <div className="mt-4">
                <Toggle
                    initialValue={showIncidentControl}
                    title="When filters match, Create an incident."
                    onChange={(value: boolean) => {
                        setShowIncidentControl(value);
                        monitorCriteriaInstance.setCreateIncidents(value);

                        if (
                            (value &&
                                !monitorCriteriaInstance.data?.incidents) ||
                            monitorCriteriaInstance.data?.incidents?.length ===
                                0
                        ) {
                            monitorCriteriaInstance.setIncidents([
                                {
                                    title: '',
                                    description: '',
                                    incidentSeverityId: undefined,
                                    id: ObjectID.generate().toString(),
                                },
                            ]);
                        }
                        if (!value) {
                            monitorCriteriaInstance.setIncidents([]);
                        }

                        setMonitorCriteriaInstance(
                            MonitorCriteriaInstance.clone(
                                monitorCriteriaInstance
                            )
                        );
                    }}
                />
            </div>

            {showIncidentControl && (
                <div className="mt-4">
                    <FieldLabelElement title="Create Incident" />

                    <MonitorCriteriaIncidentsForm
                        initialValue={
                            monitorCriteriaInstance?.data?.incidents || []
                        }
                        incidentSeverityDropdownOptions={
                            props.incidentSeverityDropdownOptions
                        }
                        onChange={(value: Array<CriteriaIncident>) => {
                            monitorCriteriaInstance.setIncidents(value);
                            setMonitorCriteriaInstance(
                                MonitorCriteriaInstance.clone(
                                    monitorCriteriaInstance
                                )
                            );
                        }}
                    />
                </div>
            )}

            <div className="mt-4 -ml-3">
                <Button
                    onClick={() => {
                        if (props.onDelete) {
                            props.onDelete();
                        }
                    }}
                    buttonSize={ButtonSize.Small}
                    buttonStyle={ButtonStyleType.DANGER_OUTLINE}
                    icon={IconProp.Trash}
                    title="Delete Criteria"
                />
            </div>

            <HorizontalRule />
        </div>
    );
};

export default MonitorCriteriaInstanceElement;
