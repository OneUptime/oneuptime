import React, { FunctionComponent, ReactElement } from 'react';
import { CriteriaIncident } from 'Common/Types/Monitor/CriteriaIncident';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';
import Detail from 'CommonUI/src/Components/Detail/Detail';
import FieldType from 'CommonUI/src/Components/Types/FieldType';

export interface ComponentProps {
    incident: CriteriaIncident;
    incidentSeverityDropdownOptions: Array<DropdownOption>;

}

const MonitorCriteriaIncidentForm: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="mt-4">
            <Detail
                id={"monitor-criteria-instance"}
                item={props.incident}
                fields={[{
                    key: 'title',
                    title: "Incident Title",
                    fieldType: FieldType.Text,
                    placeholder: 'No data entered',
                }, {
                    key: 'description',
                    title: "Incident Description",
                    fieldType: FieldType.LongText,
                    placeholder: 'No data entered',
                }, {
                    key: 'incidentSeverityId',
                    title: "Incident Severity",
                    fieldType: FieldType.Dropdown,
                    placeholder: 'No data entered',
                    dropdownOptions: props.incidentSeverityDropdownOptions,
                },
                ]} />


           

        </div>
    );
};

export default MonitorCriteriaIncidentForm;
