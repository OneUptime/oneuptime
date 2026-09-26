import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentScopeAddedPagesNotification from "Common/Types/StatusPage/IncidentScopeAddedPagesNotification";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  AddedPagesNotificationIncident,
  getAddedStatusPageIds,
  wouldQueueAddedPagesNotification,
} from "./IncidentStatusPageScopeForm";

/**
 * The "Send the incident-created notification to newly added pages" checkbox
 * on the incident's 'Status Page Scope' edit form.
 *
 * Subscribers of a status page hear about an incident once, when it is
 * created, so a page added to an incident's scope later would never hear
 * about it at all. Ticked (the default), the incident's 'created'
 * notification is queued again, and the Incident:SendNotificationToSubscribers
 * job sends it to the pages it has no record of telling
 * (Incident.statusPagesNotifiedOnCreation) - the added ones. Pages that were
 * already told are not told twice.
 *
 * Like the other notification checkboxes it is not bound to a column:
 * ModelForm sends a field with an `overrideFieldKey` as a misc data prop, and
 * IncidentService.onBeforeUpdate acts on it (see
 * IncidentScopeAddedPagesNotification). It only shows while ticking it would
 * send something - the form adds a page that was not told yet, and the
 * server would queue the notification for it (wouldQueueAddedPagesNotification)
 * - so the form never offers a box that does nothing.
 *
 * `showEvenIfPermissionDoesNotExist` is needed because the form's per-column
 * permission check has no column to look at; the edit button that opens the
 * form is already gated on edit permission.
 */
export const getIncidentScopeAddedPagesFormField: (data: {
  // The incident as the card loaded it.
  loadedIncident: AddedPagesNotificationIncident;
}) => ModelField<Incident> = (data: {
  loadedIncident: AddedPagesNotificationIncident;
}): ModelField<Incident> => {
  return {
    overrideField: {
      [IncidentScopeAddedPagesNotification.miscDataKey]: true,
    },
    overrideFieldKey: IncidentScopeAddedPagesNotification.miscDataKey,
    showEvenIfPermissionDoesNotExist: true,
    doNotShowWhenCreating: true,
    title: IncidentScopeAddedPagesNotification.formFieldTitle,
    description: IncidentScopeAddedPagesNotification.formFieldDescription,
    fieldType: FormFieldSchemaType.Checkbox,
    required: false,
    defaultValue: true,
    showIf: (values: FormValues<Incident>): boolean => {
      return wouldQueueAddedPagesNotification({
        incident: data.loadedIncident,
        formValue: (values as Record<string, unknown>)["statusPages"],
      });
    },
  };
};

// Whether the edit form, as it stands, adds a page to the loaded scope.
export const isAddingStatusPages: (data: {
  loadedStatusPages: unknown;
  values: FormValues<Incident>;
}) => boolean = (data: {
  loadedStatusPages: unknown;
  values: FormValues<Incident>;
}): boolean => {
  return (
    getAddedStatusPageIds({
      before: data.loadedStatusPages,
      after: (data.values as Record<string, unknown>)["statusPages"],
    }).length > 0
  );
};
