import React, { FunctionComponent, ReactElement } from 'react';
import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';

export interface ComponentProps {
    layer: OnCallDutyPolicyScheduleLayer;
    onLayerChange: (layer: OnCallDutyPolicyScheduleLayer) => void;
}

const LayerStartsAt: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <ModelForm<OnCallDutyPolicyScheduleLayer>
            modelType={OnCallDutyPolicyScheduleLayer}
            name="Start Time"
            id="start-time"
            fields={[
                {
                    field: {
                        startsAt: true,
                    },
                    title: 'Starts At',
                    fieldType: FormFieldSchemaType.DateTime,
                    required: true,
                },
            ]}
            onSuccess={(item: OnCallDutyPolicyScheduleLayer) => {
                props.onLayerChange(item);
            }}
            submitButtonText={'Save Changes'}
            formType={FormType.Update}
            modelIdToEdit={props.layer.id!}
            maxPrimaryButtonWidth={false}
        />
    );
};

export default LayerStartsAt;
