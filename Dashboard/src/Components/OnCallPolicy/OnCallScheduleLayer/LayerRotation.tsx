import Recurring from "Common/Types/Events/Recurring";
import RecurringFieldElement from "CommonUI/src/Components/Events/RecurringFieldElement";
import ModelForm, { FormType } from "CommonUI/src/Components/Forms/ModelForm";
import { CustomElementProps } from "CommonUI/src/Components/Forms/Types/Field";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "CommonUI/src/Components/Forms/Types/FormValues";
import OnCallDutyPolicyScheduleLayer from "Common/AppModels/Models/OnCallDutyPolicyScheduleLayer";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  layer: OnCallDutyPolicyScheduleLayer;
  onLayerChange: (layer: OnCallDutyPolicyScheduleLayer) => void;
}

const LayerRotation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelForm<OnCallDutyPolicyScheduleLayer>
      modelType={OnCallDutyPolicyScheduleLayer}
      name="Rotation"
      id="rotation"
      fields={[
        {
          field: {
            rotation: true,
          },
          title: "Rotation Policy",
          fieldType: FormFieldSchemaType.CustomComponent,
          getCustomElement: (
            value: FormValues<OnCallDutyPolicyScheduleLayer>,
            props: CustomElementProps,
          ) => {
            return (
              <RecurringFieldElement
                {...props}
                initialValue={value.rotation as Recurring}
              />
            );
          },
          required: true,
        },
        {
          field: {
            handOffTime: true,
          },
          title: "Hand Off Time",
          fieldType: FormFieldSchemaType.DateTime,
          required: true,
        },
      ]}
      onSuccess={(item: OnCallDutyPolicyScheduleLayer) => {
        props.onLayerChange(item);
      }}
      submitButtonText={"Save Changes"}
      formType={FormType.Update}
      modelIdToEdit={props.layer.id!}
      maxPrimaryButtonWidth={false}
    />
  );
};

export default LayerRotation;
