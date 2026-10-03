import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import { SubscriberNotificationPreviewRequest } from "Common/Types/StatusPage/SubscriberNotificationPreview";
import {
  INTERNAL_NOTE_TEMPLATES,
  PUBLIC_NOTE_TEMPLATES,
} from "Common/UI/Components/AI/AITemplates";
import React, { ReactElement } from "react";
import { fetchIncidentNoteTemplateVariables } from "../../Incident/IncidentNoteTemplateVariables";
import SubscriberAudienceSummary from "../../Incident/SubscriberAudienceSummary";
import SubscriberNotificationPreviewButton from "../../Incident/SubscriberNotificationPreviewButton";
import { getPublicNotePreviewRequest } from "../../Incident/SubscriberNotificationPreviewRequests";
import SubscriberNotificationPreviewCopy from "../../StatusPage/SubscriberNotificationPreviewCopy";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { EventNoteKind, EventNotesTemplatesConfig } from "../EventNoteKind";
import { getNoteGenerator } from "../GenerateNoteWithAI";

/*
 * An incident's public and private notes, as its Public Notes and Private
 * Notes pages and the Incident Feed's "Add Public Note" / "Add Private Note"
 * all write them.
 */

function getIncidentNoteTemplates(): EventNotesTemplatesConfig {
  return {
    modelType: IncidentNoteTemplate,
    settingsRoute: RouteUtil.populateRouteParams(
      RouteMap[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES] as Route,
    ),
  };
}

export function getIncidentPublicNoteKind(data: {
  incidentId: ObjectID;
  /*
   * Where "Notify status page subscribers" starts: off when the incident
   * was declared without notifying subscribers (or is private)
   * - PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident.
   */
  isNotifyingByDefault: boolean;
}): EventNoteKind<IncidentPublicNote> {
  const incidentId: ObjectID = data.incidentId;

  return {
    modelType: IncidentPublicNote,
    visibility: "public",
    eventNoun: "incident",
    parentIdField: "incidentId",
    parentId: incidentId,
    attachmentApiPath: "/incident-public-note/attachment",
    subscriberNotifications: {
      isNotifyingByDefault: data.isNotifyingByDefault,
      quietDescription:
        PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
      /*
       * Who the note will reach: the status pages this incident's scope
       * lets through, with an "up to" count per channel. Nothing when no
       * subscriber was going to hear about it anyway.
       */
      audienceSummary: (
        <SubscriberAudienceSummary
          request={{ incidentId: incidentId }}
          dataTestId="incident-public-note-audience"
        />
      ),
      /*
       * And what they will be sent: each status page's email, with the note
       * as it is being written.
       */
      renderPreview: (draft: {
        note: string;
        postedAt: Date | null;
      }): ReactElement => {
        const getRequest: () => SubscriberNotificationPreviewRequest | null =
          (): SubscriberNotificationPreviewRequest | null => {
            return getPublicNotePreviewRequest({
              incidentId: incidentId,
              note: draft.note,
              postedAt: draft.postedAt,
            });
          };

        return (
          <SubscriberNotificationPreviewButton
            dataTestId="incident-public-note-preview-notification"
            getRequest={getRequest}
            isDisabled={getRequest() === null}
            disabledReason={
              SubscriberNotificationPreviewCopy.previewButtonDisabledNoNote
            }
          />
        );
      },
      /*
       * A note whose notification went out can be sent again (Resend), one
       * that failed retried; both ask first, naming the status pages the
       * incident's scope reaches now - where it would go, or that it would
       * reach no one.
       */
      resend: {
        audience: (
          <SubscriberAudienceSummary
            request={{ incidentId: incidentId }}
            dataTestId="incident-public-note-resend-audience"
            saysWhenNobodyIsNotified={true}
          />
        ),
      },
    },
    templates: getIncidentNoteTemplates(),
    /*
     * A template's {{incident.title}}-style placeholders are filled in with
     * this incident's values when it is picked.
     */
    templateVariables: () => {
      return fetchIncidentNoteTemplateVariables(incidentId);
    },
    ai: {
      title: "Generate Public Note with AI",
      description:
        "AI will analyze the incident data and generate a customer-facing public note.",
      templates: PUBLIC_NOTE_TEMPLATES,
      generate: getNoteGenerator({
        apiPath: "/incident/generate-note-from-ai",
        eventId: incidentId,
        noteType: "public",
      }),
    },
    siblingRoute: RouteUtil.populateRouteParams(
      RouteMap[PageMap.INCIDENT_VIEW_INTERNAL_NOTE] as Route,
      { modelId: incidentId },
    ),
  };
}

export function getIncidentPrivateNoteKind(data: {
  incidentId: ObjectID;
}): EventNoteKind<IncidentInternalNote> {
  const incidentId: ObjectID = data.incidentId;

  return {
    modelType: IncidentInternalNote,
    visibility: "private",
    eventNoun: "incident",
    parentIdField: "incidentId",
    parentId: incidentId,
    attachmentApiPath: "/incident-internal-note/attachment",
    templates: getIncidentNoteTemplates(),
    /*
     * A template's {{incident.title}}-style placeholders are filled in with
     * this incident's values when it is picked.
     */
    templateVariables: () => {
      return fetchIncidentNoteTemplateVariables(incidentId);
    },
    ai: {
      title: "Generate Private Note with AI",
      description:
        "AI will analyze the incident data and generate an internal technical note.",
      templates: INTERNAL_NOTE_TEMPLATES,
      generate: getNoteGenerator({
        apiPath: "/incident/generate-note-from-ai",
        eventId: incidentId,
        noteType: "internal",
      }),
    },
    siblingRoute: RouteUtil.populateRouteParams(
      RouteMap[PageMap.INCIDENT_VIEW_PUBLIC_NOTE] as Route,
      { modelId: incidentId },
    ),
  };
}
