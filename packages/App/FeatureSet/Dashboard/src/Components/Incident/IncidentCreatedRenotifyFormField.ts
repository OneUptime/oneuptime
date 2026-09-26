import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentCreatedRenotify from "Common/Types/StatusPage/IncidentCreatedRenotify";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

/**
 * The "Notify subscribers that this incident was created" checkbox on the
 * incident's 'Visible on Status Page' edit form.
 *
 * An incident declared hidden from status pages has its 'created'
 * notification skipped. When someone later turns visibility on, this box asks
 * whether to send that notification now. Like the "notify about this update"
 * box it is not bound to a column: ModelForm sends a field with an
 * `overrideFieldKey` as a misc data prop, and IncidentService.onBeforeUpdate
 * turns it into a Pending 'created' notification (see IncidentCreatedRenotify).
 * ModelForm only sends it while ticked, so an unticked box asks for nothing.
 *
 * The page offers it only for an incident that could be re-notified at all
 * (hidden, skipped, set to notify, not private), and the box itself only
 * appears once the toggle is switched on and the incident is not being made
 * private in the same edit.
 *
 * `showEvenIfPermissionDoesNotExist` is needed because the form's per-column
 * permission check has no column to look at; the edit button that opens the
 * form is already gated on edit permission.
 */
export const getIncidentCreatedRenotifyFormField: (data: {
  tickedByDefault: boolean;
}) => ModelField<Incident> = (data: {
  tickedByDefault: boolean;
}): ModelField<Incident> => {
  return {
    overrideField: {
      [IncidentCreatedRenotify.miscDataKey]: true,
    },
    overrideFieldKey: IncidentCreatedRenotify.miscDataKey,
    showEvenIfPermissionDoesNotExist: true,
    doNotShowWhenCreating: true,
    title: IncidentCreatedRenotify.formFieldTitle,
    description: IncidentCreatedRenotify.formFieldDescription,
    fieldType: FormFieldSchemaType.Checkbox,
    required: false,
    defaultValue: data.tickedByDefault,
    showIf: (values: FormValues<Incident>): boolean => {
      return isPublishingIncident(values);
    },
  };
};

/*
 * Whether the edit form, as it stands, makes the incident visible on status
 * pages. Making it private in the same edit hides it again (the server forces
 * visibility off for private incidents), so that does not count.
 */
export const isPublishingIncident: (values: FormValues<Incident>) => boolean = (
  values: FormValues<Incident>,
): boolean => {
  const formValues: Record<string, unknown> = values as Record<string, unknown>;

  return (
    formValues["isVisibleOnStatusPage"] === true &&
    formValues["isPrivate"] !== true
  );
};
