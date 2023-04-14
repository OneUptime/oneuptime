import React, { FunctionComponent, ReactElement } from 'react';

import { CriteriaIncident } from 'Common/Types/Monitor/CriteriaIncident';
import ModelForm from 'CommonUI/src/Components/Forms/ModelForm';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import Incident from 'Model/Models/Incident';
import Button from 'CommonUI/src/Components/Button/Button';

export interface ComponentProps {
    initialValue?: undefined | CriteriaIncident;
    onChange?: undefined | ((value: CriteriaIncident) => void);
    onDelete?: undefined | (() => void);
}

const MonitorCriteriaIncidentForm: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div>
            <ModelForm
                modelType={Incident}
                hideSubmitButton={true}
                initialValue={props.initialValue}
                onChange={props.onChange}
                fields={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Title',
                        fieldType: FormFieldSchemaType.Text,
                        stepId: 'incident-details',
                        required: true,
                        placeholder: 'Incident Title',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        stepId: 'incident-details',
                        fieldType: FormFieldSchemaType.LongText,
                        required: true,
                        placeholder: 'Description',
                    },
                    {
                        field: {
                            incidentSeverityId: true,
                        },
                        title: 'Incident Severity',
                        stepId: 'incident-details',
                        description: 'What type of incident is this?',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownModal: {
                            type: IncidentSeverity,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: true,
                        placeholder: 'Incident Severity',
                    },
                ]}
            />

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

export default MonitorCriteriaIncidentForm;
