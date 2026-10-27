import {
  PublishingCopy,
  getPublishAtError,
  isPublishingAtATime,
} from "./ScheduledMaintenancePublishing";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

/*
 * Publish At, asked after its question - Publish on Status Pages, Right away
 * or At a date and time - which the forms ask with
 * getColumnChoiceField(PUBLISH_CHOICE) (ScheduledMaintenancePublishing).
 * Create Scheduled Maintenance Event holds the two first in its folded
 * Subscriber Notifications section; the event's own Edit draws them open on
 * its Status Pages step.
 *
 * Publish At is the column the answer writes. It is always registered, so
 * the form loads it and sends what the answer wrote: drawn only for At a
 * date and time, where it is required and must come before the event
 * starts, and hidden - holding none - for Right away.
 */
export interface PublishAtFormFieldOptions {
  stepId: string;
  // The section it folds into with its question; drawn open when left out.
  collapsibleSection?: FormFieldCollapsibleSection<ScheduledMaintenance>;
}

export const getPublishAtFormField: (
  options: PublishAtFormFieldOptions,
) => ModelField<ScheduledMaintenance> = (
  options: PublishAtFormFieldOptions,
): ModelField<ScheduledMaintenance> => {
  return {
    field: {
      publishOnStatusPageAt: true,
    },
    title: PublishingCopy.publishAtTitle,
    stepId: options.stepId,
    ...(options.collapsibleSection
      ? { collapsibleSection: options.collapsibleSection }
      : {}),
    fieldType: FormFieldSchemaType.DateTime,
    placeholder: PublishingCopy.publishAtPlaceholder,
    // The answer says what it is for; the column describes the API's view.
    hideColumnDescription: true,
    required: (values: FormValues<ScheduledMaintenance>): boolean => {
      return isPublishingAtATime(values);
    },
    showIf: (values: FormValues<ScheduledMaintenance>): boolean => {
      return isPublishingAtATime(values);
    },
    customValidation: (
      values: FormValues<ScheduledMaintenance>,
    ): string | null => {
      return getPublishAtError(values);
    },
  };
};

export default getPublishAtFormField;
