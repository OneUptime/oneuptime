import RestrictionTimesFieldElement from "./RestrictionTimesFieldElement";
import Recurring from "Common/Types/Events/Recurring";
import RestrictionTimes from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import RecurringFieldElement from "Common/UI/Components/Events/RecurringFieldElement";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  layer: OnCallDutyPolicyScheduleLayer;
  onLayerChange: (layer: OnCallDutyPolicyScheduleLayer) => void;
}

/*
 * A single form that edits every configuration field of a layer (name,
 * description, rotation start, rotation interval, hand-off time and active-hour
 * restrictions) with ONE save button.
 *
 * This replaces the previous design where each of these was its own ModelForm
 * with its own "Save Changes" button. Splitting them meant a user had to save
 * four separate forms to configure a single layer, and each form re-fetched the
 * model on save which could clobber unsaved edits in the sibling forms.
 */
const LayerConfigForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelForm<OnCallDutyPolicyScheduleLayer>
      modelType={OnCallDutyPolicyScheduleLayer}
      name="Layer Configuration"
      /*
       * Unique per layer: several layers can be expanded at once, and a static
       * id would produce duplicate DOM ids (and colliding submit-button ids).
       */
      id={`layer-configuration-${props.layer.id?.toString() || "new"}`}
      fields={[
        {
          field: {
            name: true,
          },
          sectionTitle: "Layer details",
          sectionDescription:
            "Give this layer a clear name so your team knows what it covers.",
          title: "Layer name",
          fieldType: FormFieldSchemaType.Name,
          placeholder: "e.g. Weekday Primary",
          required: true,
        },
        {
          field: {
            description: true,
          },
          title: "Description",
          description: "Optional. Explain the purpose of this layer.",
          fieldType: FormFieldSchemaType.LongText,
          placeholder: "What is this layer responsible for?",
          required: false,
        },
        {
          field: {
            startsAt: true,
          },
          sectionTitle: "Rotation schedule",
          sectionDescription:
            "Control when this layer starts and how often on-call duty hands off between users.",
          title: "Rotation starts at",
          description:
            "The date and time this layer's on-call rotation begins.",
          fieldType: FormFieldSchemaType.DateTime,
          required: true,
        },
        {
          field: {
            rotation: true,
          },
          title: "Rotate every",
          description:
            "How often on-call duty passes to the next user in this layer.",
          fieldType: FormFieldSchemaType.CustomComponent,
          getCustomElement: (
            value: FormValues<OnCallDutyPolicyScheduleLayer>,
            fieldProps: CustomElementProps,
          ) => {
            return (
              <RecurringFieldElement
                {...fieldProps}
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
          title: "First hand-off time",
          description:
            "The date and time of the first hand-off to the next user. Hand-offs then repeat every rotation interval.",
          fieldType: FormFieldSchemaType.DateTime,
          required: true,
        },
        {
          field: {
            restrictionTimes: true,
          },
          sectionTitle: "Active hours",
          sectionDescription:
            "Limit the hours this layer is on call. Outside these hours, lower layers take over.",
          title: "Restrictions",
          fieldType: FormFieldSchemaType.CustomComponent,
          required: true,
          getCustomElement: (
            value: FormValues<OnCallDutyPolicyScheduleLayer>,
            fieldProps: CustomElementProps,
          ) => {
            return (
              <RestrictionTimesFieldElement
                {...fieldProps}
                value={value.restrictionTimes as RestrictionTimes}
              />
            );
          },
        },
      ]}
      onValidate={(values: FormValues<OnCallDutyPolicyScheduleLayer>) => {
        const errors: JSONObject = {};

        const startsAt: Date | undefined = values.startsAt as Date | undefined;
        const handOffTime: Date | undefined = values.handOffTime as
          | Date
          | undefined;

        /*
         * The first hand-off must not precede the rotation start. A hand-off
         * before the start is almost always a misconfiguration (the engine
         * silently moves it forward to the first real boundary, which is
         * confusing). We intentionally allow hand-off == start, and we do NOT
         * validate weekly restriction windows here — a "start day/time after
         * end day/time" window is a supported wrap-around (e.g. Fri -> Mon)
         * coverage feature, not an error.
         */
        if (startsAt && handOffTime) {
          const start: Date = OneUptimeDate.fromString(startsAt as any);
          const handoff: Date = OneUptimeDate.fromString(handOffTime as any);

          if (OneUptimeDate.isBefore(handoff, start)) {
            errors["handOffTime"] =
              "The first hand-off time must be at or after the rotation start.";
          }
        }

        return errors;
      }}
      onSuccess={(item: OnCallDutyPolicyScheduleLayer) => {
        props.onLayerChange(item);
      }}
      submitButtonText={"Save Layer"}
      formType={FormType.Update}
      modelIdToEdit={props.layer.id!}
      maxPrimaryButtonWidth={false}
    />
  );
};

export default LayerConfigForm;
