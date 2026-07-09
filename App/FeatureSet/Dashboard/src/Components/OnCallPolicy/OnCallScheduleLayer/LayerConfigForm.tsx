import LayerDateTimeFieldElement from "./LayerDateTimeFieldElement";
import RestrictionTimesFieldElement from "./RestrictionTimesFieldElement";
import Recurring from "Common/Types/Events/Recurring";
import RestrictionTimes, {
  RestrictionType,
} from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
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
  /*
   * Schedule timezone — rotation start, hand-off and restriction times are all
   * entered/displayed/enforced as wall-clock in it (audit F1). All three route
   * through the same re-anchoring so "what you type" matches "what the engine
   * enforces" regardless of the configuring admin's browser zone.
   */
  timezone?: string | undefined;
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
          fieldType: FormFieldSchemaType.CustomComponent,
          required: true,
          getCustomElement: (
            value: FormValues<OnCallDutyPolicyScheduleLayer>,
            fieldProps: CustomElementProps,
          ) => {
            return (
              <LayerDateTimeFieldElement
                {...fieldProps}
                value={value.startsAt as Date}
                timezone={props.timezone}
              />
            );
          },
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
          fieldType: FormFieldSchemaType.CustomComponent,
          required: true,
          getCustomElement: (
            value: FormValues<OnCallDutyPolicyScheduleLayer>,
            fieldProps: CustomElementProps,
          ) => {
            return (
              <LayerDateTimeFieldElement
                {...fieldProps}
                value={value.handOffTime as Date}
                timezone={props.timezone}
              />
            );
          },
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
                timezone={props.timezone}
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

        /*
         * Reject a zero-length Daily restriction window (From == To). Such a
         * window is active 0 seconds/day, so the layer produces no on-call
         * events and silently pages nobody for its coverage — with no error at
         * save time (audit F22). Weekly windows are intentionally NOT validated
         * here (a start day/time after the end is a supported wrap-around).
         */
        const restrictionTimes: RestrictionTimes | undefined =
          values.restrictionTimes as RestrictionTimes | undefined;

        if (
          restrictionTimes &&
          restrictionTimes.restictionType === RestrictionType.Daily &&
          restrictionTimes.dayRestrictionTimes &&
          restrictionTimes.dayRestrictionTimes.startTime &&
          restrictionTimes.dayRestrictionTimes.endTime
        ) {
          const restrictionStart: Date = OneUptimeDate.fromString(
            restrictionTimes.dayRestrictionTimes.startTime as any,
          );
          const restrictionEnd: Date = OneUptimeDate.fromString(
            restrictionTimes.dayRestrictionTimes.endTime as any,
          );

          // Compare time-of-day; a matching From/To is a zero-length window.
          if (
            restrictionStart.getHours() === restrictionEnd.getHours() &&
            restrictionStart.getMinutes() === restrictionEnd.getMinutes() &&
            restrictionStart.getSeconds() === restrictionEnd.getSeconds()
          ) {
            errors["restrictionTimes"] =
              "The restriction 'From' and 'To' times cannot be the same. Choose a window with a positive duration (or set the restriction to None for 24/7 coverage).";
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
