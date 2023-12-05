import React, { FunctionComponent, ReactElement } from 'react';
import OnCallDutyPolicyScheduleLayer from 'Model/Models/OnCallDutyPolicyScheduleLayer';
import ModelForm, { FormType } from 'CommonUI/src/Components/Forms/ModelForm';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import RestrictionTimesFieldElement from './RestrictionTimesFieldElement';
import FormValues from 'CommonUI/src/Components/Forms/Types/FormValues';
import { CustomElementProps } from 'CommonUI/src/Components/Forms/Types/Field';
import RestrictionTimes from 'Common/Types/OnCallDutyPolicy/RestrictionTimes';

export interface ComponentProps {
    layer: OnCallDutyPolicyScheduleLayer;
    onLayerChange: (layer: OnCallDutyPolicyScheduleLayer) => void;
}

const LayerReestrictionTimes: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <ModelForm<OnCallDutyPolicyScheduleLayer>
            modelType={OnCallDutyPolicyScheduleLayer}
            name="Restriction Times"
            id="restriction-times"
            fields={[
                {
                    field: {
                        restrictionTimes: true,
                    },
                    title: 'Restriction Times',
                    fieldType: FormFieldSchemaType.CustomComponent,
                    required: true,
                    getCustomElement: (
                        value: FormValues<OnCallDutyPolicyScheduleLayer>,
                        props: CustomElementProps
                    ) => {
                        return (
                            <RestrictionTimesFieldElement
                                {...props}
                                value={
                                    value.restrictionTimes as RestrictionTimes
                                }
                            />
                        );
                    },
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

export default LayerReestrictionTimes;
