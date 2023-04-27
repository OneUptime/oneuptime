import React, { FunctionComponent, ReactElement } from 'react';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';
import MonitorCriteriaInstance from 'Common/Types/Monitor/MonitorCriteriaInstance';
import FieldLabelElement, { Size } from 'CommonUI/src/Components/Detail/FieldLabel';

import CriteriaFilters from './CriteriaFilters';

import MonitorCriteriaIncidents from './MonitorCriteriaIncidents';

import HorizontalRule from 'CommonUI/src/Components/HorizontalRule/HorizontalRule';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Detail from 'CommonUI/src/Components/Detail/Detail';

export interface ComponentProps {
    monitorStatusDropdownOptions: Array<DropdownOption>;
    incidentSeverityDropdownOptions: Array<DropdownOption>;
    isLastCriteria: boolean;
    monitorCriteriaInstance: MonitorCriteriaInstance;
}

const MonitorCriteriaInstanceElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="mt-4">
            <Detail
                id={'monitor-criteria-instance'}
                item={props.monitorCriteriaInstance.data}
                showDetailsInNumberOfColumns={2}
                fields={[
                    {
                        key: 'name',
                        title: 'Criteria Name',
                        fieldType: FieldType.Text,
                        placeholder: 'No data entered',
                    },
                    {
                        key: 'description',
                        title: 'Criteria Description',
                        fieldType: FieldType.LongText,
                        placeholder: 'No data entered',
                    },
                ]}
            />

            <div className="mt-4">
                <FieldLabelElement
                    title={`Filters - ${props.monitorCriteriaInstance.data?.filterCondition} of these should match for this criteria to be met:`}
                    required={true}
                    description=""
                    size={Size.Medium}
                />

                <CriteriaFilters
                    criteriaFilters={
                        props.monitorCriteriaInstance?.data?.filters || []
                    }
                />
            </div>

            <Detail
                id={'monitor-criteria-instance'}
                item={props.monitorCriteriaInstance.data}
                fields={[
                    {
                        key: 'monitorStatusId',
                        title: 'When filters match, change monitor status to',
                        fieldType: FieldType.Dropdown,
                        placeholder: 'Do not change monitor status',
                        dropdownOptions: props.monitorStatusDropdownOptions,
                        fieldTitleSize: Size.Medium
                    },
                ]}
            />

            <div className="mt-4">
                <FieldLabelElement title="When filters match, create this incident:" size={Size.Medium} />

                <MonitorCriteriaIncidents
                    incidents={
                        props.monitorCriteriaInstance?.data?.incidents || []
                    }
                    incidentSeverityDropdownOptions={
                        props.incidentSeverityDropdownOptions
                    }
                />
            </div>

            {!props.isLastCriteria && <HorizontalRule />}
        </div>
    );
};

export default MonitorCriteriaInstanceElement;
