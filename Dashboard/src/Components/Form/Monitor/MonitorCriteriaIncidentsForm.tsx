import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import MonitorCriteriaIncidentForm from './MonitorCriteriaIncidentForm';
import { CriteriaIncident } from 'Common/Types/Monitor/CriteriaIncident';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';
import ObjectID from 'Common/Types/ObjectID';

export interface ComponentProps {
    initialValue: Array<CriteriaIncident> | undefined;
    onChange?: undefined | ((value: Array<CriteriaIncident>) => void);
    incidentSeverityDropdownOptions: Array<DropdownOption>;
}

const MonitorCriteriaIncidentsForm: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [incidents, setIncidents] = React.useState<Array<CriteriaIncident>>(
        props.initialValue || [
            {
                title: '',
                description: '',
                incidentSeverityId: undefined,
                id: ObjectID.generate().toString(),
            },
        ]
    );

    useEffect(() => {
        if (incidents && props.onChange) {
            props.onChange(incidents);
        }
    }, [incidents]);

    return (
        <div className="mt-4">
            {incidents.map((i: CriteriaIncident, index: number) => {
                return (
                    <MonitorCriteriaIncidentForm
                        key={index}
                        incidentSeverityDropdownOptions={
                            props.incidentSeverityDropdownOptions
                        }
                        initialValue={i}
                        // onDelete={() => {
                        //     // remove the criteria filter
                        //     const index: number = incidents.indexOf(i);
                        //     const newIncidents: Array<CriteriaIncident> = [
                        //         ...incidents,
                        //     ];
                        //     newIncidents.splice(index, 1);
                        //     setIncidents(newIncidents);
                        // }}
                        onChange={(value: CriteriaIncident) => {
                            const index: number = incidents.indexOf(i);
                            const newIncidents: Array<CriteriaIncident> = [
                                ...incidents,
                            ];
                            newIncidents[index] = value;
                            setIncidents(newIncidents);
                        }}
                    />
                );
            })}

            {/** Future Proofing */}
            {/* <Button
                title="Add Incident"
                onClick={() => {
                    const newIncidents: Array<CriteriaIncident> = [
                        ...incidents,
                    ];
                    newIncidents.push({
                        title: '',
                        description: '',
                        incidentSeverityId: undefined,
                    });
                }}
            /> */}
        </div>
    );
};

export default MonitorCriteriaIncidentsForm;
