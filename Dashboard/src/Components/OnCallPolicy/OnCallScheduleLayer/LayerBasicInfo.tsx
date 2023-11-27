import React, { FunctionComponent, ReactElement } from 'react';
import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';

export interface ComponentProps {
    layer: OnCallDutyPolicyScheduleLayer;
    onLayerChange: (layer: OnCallDutyPolicyScheduleLayer) => void;
}

const LayerBasicInfo: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <ModelForm<OnCallDutyPolicyScheduleLayer>
            modelType={OnCallDutyPolicyScheduleLayer}
            name="Basic Info"
            id="Basic Info"
            fields={[
                {
                    field: {
                        name: true,
                    },
                    title: 'Name',
                    fieldType: FormFieldSchemaType.Name,
                    required: true,
                },
                {
                    field: {
                        description: true,
                    },
                    title: 'Description',
                    fieldType: FormFieldSchemaType.LongText,
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

export default LayerBasicInfo;
