import React, {
    FunctionComponent,
    ReactElement,
} from 'react';
import {
    DropdownOption,
} from 'CommonUI/src/Components/Dropdown/Dropdown';
import MonitorCriteriaInstance from 'Common/Types/Monitor/MonitorCriteriaInstance';
import FieldLabelElement from 'CommonUI/src/Components/Forms/Fields/FieldLabel';

import CriteriaFilters from './CriteriaFilters';

import MonitorCriteriaIncidents from './MonitorCriteriaIncidents';

import HorizontalRule from 'CommonUI/src/Components/HorizontalRule/HorizontalRule';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Detail from 'CommonUI/src/Components/Detail/Detail';

export interface ComponentProps {
    monitorStatusDropdownOptions: Array<DropdownOption>;
    incidentSeverityDropdownOptions: Array<DropdownOption>;
    monitorType: MonitorType;
    monitorCriteriaInstance: MonitorCriteriaInstance;
}

const MonitorCriteriaInstanceElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    return (
        <div className="mt-4">
            <Detail id={"monitor-criteria-instance"}
                item={props.monitorCriteriaInstance.data}
                fields={[{
                    key: 'name',
                    title: "Criteria Name",
                    fieldType: FieldType.Text,
                    placeholder: 'No data entered',
                }, {
                    key: 'description',
                    title: "Criteria Description",
                    fieldType: FieldType.LongText,
                    placeholder: 'No data entered',
                }, {
                    key: 'filterCondition',
                    title: "Filter Condition",
                    fieldType: FieldType.Text,
                    placeholder: 'No data entered',
                },
                ]}
            />

            <div className="mt-4">
                <FieldLabelElement
                    title="Filters"
                    required={true}
                    description="Add criteria for different monitor properties."
                />

                <CriteriaFilters
                    monitorType={props.monitorType}
                    criteriaFilters={props.monitorCriteriaInstance?.data?.filters || []}
                />
            </div>



            <Detail id={"monitor-criteria-instance"}
                item={props.monitorCriteriaInstance.data}
                fields={[{
                    key: 'monitorStatusId',
                    title: "When filters match, change monitor status to",
                    fieldType: FieldType.Dropdown,
                    placeholder: 'Do not change monitor status',
                    dropdownOptions: props.monitorStatusDropdownOptions
                },
                ]}
            />





            <div className="mt-4">
                <FieldLabelElement title="When filters match, Create Incident" />

                <MonitorCriteriaIncidents
                    incidents={
                        props.monitorCriteriaInstance?.data?.incidents || []
                    }
                    incidentSeverityDropdownOptions={
                        props.incidentSeverityDropdownOptions
                    }

                />
            </div>



            <HorizontalRule />
        </div>
    );
};

export default MonitorCriteriaInstanceElement;
