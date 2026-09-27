import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SubscriberNotificationPreviewEvent,
  SubscriberNotificationPreviewRequest,
} from "Common/Types/StatusPage/SubscriberNotificationPreview";
import { getIdsFromFormValue } from "./IncidentStatusPageScopeForm";

/*
 * The 'Preview notification' requests the dashboard sends, from what is on
 * screen: the Declare Incident form's values, or the note being written.
 * Worked out apart from React so the shapes can be tested on their own.
 */

/*
 * The incident being declared, from the Declare Incident form's values in
 * whatever shape the form holds them (ids, models, dropdown options).
 * customFields are the Details step's answers, packed as the form packs them
 * on submit (packCustomFieldFormValues).
 */
export const getIncidentCreatedPreviewRequest: (data: {
  values: Record<string, unknown>;
  customFields: JSONObject | undefined;
}) => SubscriberNotificationPreviewRequest = (data: {
  values: Record<string, unknown>;
  customFields: JSONObject | undefined;
}): SubscriberNotificationPreviewRequest => {
  const values: Record<string, unknown> = data.values;

  return {
    event: SubscriberNotificationPreviewEvent.IncidentCreated,
    incident: {
      title: typeof values["title"] === "string" ? values["title"] : "",
      description:
        typeof values["description"] === "string" ? values["description"] : "",
      incidentSeverityId:
        getIdsFromFormValue(values["incidentSeverity"])[0] || null,
      monitorIds: getIdsFromFormValue(values["monitors"]),
      statusPageIds: getIdsFromFormValue(values["statusPages"]),
      labelIds: getIdsFromFormValue(values["labels"]),
      customFields: data.customFields || {},
      isPrivate: values["isPrivate"] === true,
      // On unless it was switched off, as the form starts it.
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated:
        values["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"] !==
        false,
    },
  };
};

/*
 * A public note being written on an incident, or null while it is blank:
 * there is nothing to preview yet.
 */
export const getPublicNotePreviewRequest: (data: {
  incidentId: ObjectID | string;
  note: string;
  postedAt: Date | null;
}) => SubscriberNotificationPreviewRequest | null = (data: {
  incidentId: ObjectID | string;
  note: string;
  postedAt: Date | null;
}): SubscriberNotificationPreviewRequest | null => {
  if (!data.note || data.note.trim().length === 0) {
    return null;
  }

  return {
    event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
    incidentId: data.incidentId.toString(),
    note: data.note,
    postedAt: data.postedAt,
  };
};
