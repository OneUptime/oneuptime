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
import Button from 'CommonUI/src/Components/Button/Button';
import MonitorCriteriaIncidentsForm from './MonitorCriteriaIncidentsForm';
import { CriteriaIncident } from 'Common/Types/Monitor/CriteriaIncident';

export interface ComponentProps {
    monitorStatusDropdownOptions: Array<DropdownOption>;
    initialValue?: undefined | MonitorCriteriaInstance;
    onChange?: undefined | ((value: MonitorCriteriaInstance) => void);
    onDelete?: undefined | (() => void);
}

const MonitorCriteriaInstanceElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [monitorCriteriaInstance, setMonitorCriteriaInstance] = useState<
        MonitorCriteriaInstance | undefined
    >(props.initialValue);

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

    return (
        <div>
            <div>
                <FieldLabelElement title="Monitor Status" />
                <Dropdown
                    initialValue={props.monitorStatusDropdownOptions.find(
                        (i: DropdownOption) => {
                            return (
                                i.value ===
                                monitorCriteriaInstance?.data?.monitorStatusId
                                    .id
                            );
                        }
                    )}
                    options={props.monitorStatusDropdownOptions}
                    onChange={(
                        value: DropdownValue | Array<DropdownValue> | null
                    ) => {
                        setMonitorCriteriaInstance(
                            new MonitorCriteriaInstance().fromJSON({
                                monitorStatusId: new ObjectID(
                                    value?.toString() || ''
                                ),
                                filters:
                                    monitorCriteriaInstance?.data?.filters ||
                                    [],
                                filterCondition:
                                    monitorCriteriaInstance?.data
                                        ?.filterCondition ||
                                    FilterCondition.All,
                                createIncidents:
                                    monitorCriteriaInstance?.data
                                        ?.createIncidents || [],
                            })
                        );
                    }}
                />
            </div>
            <div>
                <FieldLabelElement title="Filter Condition" />
                <Dropdown
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
                        setMonitorCriteriaInstance(
                            new MonitorCriteriaInstance().fromJSON({
                                monitorStatusId:
                                    monitorCriteriaInstance?.data
                                        ?.monitorStatusId ||
                                    defaultMonitorStatusId,
                                filters:
                                    monitorCriteriaInstance?.data?.filters ||
                                    [],
                                filterCondition: value || FilterCondition.All,
                                createIncidents:
                                    monitorCriteriaInstance?.data
                                        ?.createIncidents || [],
                            })
                        );
                    }}
                />
            </div>
            <div>
                <FieldLabelElement title="Filters" />

                <CriteriaFilters
                    initialValue={monitorCriteriaInstance?.data?.filters || []}
                    onChange={(value: Array<CriteriaFilter>) => {
                        setMonitorCriteriaInstance(
                            new MonitorCriteriaInstance().fromJSON({
                                monitorStatusId:
                                    monitorCriteriaInstance?.data
                                        ?.monitorStatusId ||
                                    defaultMonitorStatusId,
                                filters: value,
                                filterCondition:
                                    monitorCriteriaInstance?.data
                                        ?.filterCondition ||
                                    FilterCondition.All,
                                createIncidents:
                                    monitorCriteriaInstance?.data
                                        ?.createIncidents || [],
                            })
                        );
                    }}
                />
            </div>

            <div>
                <FieldLabelElement title="Create Incident" />

                <MonitorCriteriaIncidentsForm
                    initialValue={
                        monitorCriteriaInstance?.data?.createIncidents || []
                    }
                    onChange={(value: Array<CriteriaIncident>) => {
                        setMonitorCriteriaInstance(
                            new MonitorCriteriaInstance().fromJSON({
                                monitorStatusId:
                                    monitorCriteriaInstance?.data
                                        ?.monitorStatusId ||
                                    defaultMonitorStatusId,
                                filters:
                                    monitorCriteriaInstance?.data?.filters ||
                                    [],
                                filterCondition:
                                    monitorCriteriaInstance?.data
                                        ?.filterCondition ||
                                    FilterCondition.All,
                                createIncidents: value || [],
                            })
                        );
                    }}
                />
            </div>

            <div>
                <Button
                    onClick={() => {
                        if (props.onDelete) {
                            props.onDelete();
                        }
                    }}
                    title="Delete"
                />
            </div>
        </div>
    );
};

export default MonitorCriteriaInstanceElement;
