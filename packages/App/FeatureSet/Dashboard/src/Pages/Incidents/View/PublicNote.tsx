import EventNotes from "../../../Components/EventNotes/EventNotes";
import SubscriberAudienceSummary from "../../../Components/Incident/SubscriberAudienceSummary";
import SubscriberNotificationPreviewButton from "../../../Components/Incident/SubscriberNotificationPreviewButton";
import { getPublicNotePreviewRequest } from "../../../Components/Incident/SubscriberNotificationPreviewRequests";
import SubscriberNotificationPreviewCopy from "../../../Components/StatusPage/SubscriberNotificationPreviewCopy";
import { SubscriberNotificationPreviewRequest } from "Common/Types/StatusPage/SubscriberNotificationPreview";
import { fetchIncidentNoteTemplateVariables } from "../../../Components/Incident/IncidentNoteTemplateVariables";
import { getNoteGenerator } from "../../../Components/EventNotes/GenerateNoteWithAI";
import useParentNotifyDefault from "../../../Components/EventNotes/useParentNotifyDefault";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import { PUBLIC_NOTE_TEMPLATES } from "Common/UI/Components/AI/AITemplates";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentPublicNotes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const { isNotifyingByDefault, error } = useParentNotifyDefault<Incident>({
    modelType: Incident,
    id: modelId,
    select: {
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
    },
    resolve: (incident: Incident | null): boolean => {
      return PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(
        incident,
      );
    },
  });

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isNotifyingByDefault === null) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <EventNotes<IncidentPublicNote>
      /*
       * A new feed per incident: a draft, a template or an AI draft started
       * on one incident must never be posted on the next.
       */
      key={modelId.toString()}
      modelType={IncidentPublicNote}
      visibility="public"
      eventNoun="incident"
      parentIdField="incidentId"
      parentId={modelId}
      currentProject={props.currentProject}
      attachmentApiPath="/incident-public-note/attachment"
      subscriberNotifications={{
        isNotifyingByDefault,
        quietDescription:
          PublicNoteSubscriberNotificationDefault.quietIncidentDescription,
        /*
         * Who the note will reach: the status pages this incident's scope
         * lets through, with an "up to" count per channel.
         */
        audienceSummary: (
          <SubscriberAudienceSummary
            request={{ incidentId: modelId }}
            dataTestId="incident-public-note-audience"
          />
        ),
        /*
         * And what they will be sent: each status page's email, with the
         * note as it is being written.
         */
        renderPreview: (draft: {
          note: string;
          postedAt: Date | null;
        }): ReactElement => {
          const getRequest: () => SubscriberNotificationPreviewRequest | null =
            (): SubscriberNotificationPreviewRequest | null => {
              return getPublicNotePreviewRequest({
                incidentId: modelId,
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
         * A note whose notification went out can be sent again (Resend),
         * one that failed retried; both ask first, naming the status pages
         * the incident's scope reaches now - where it would go.
         */
        resend: {
          audience: (
            <SubscriberAudienceSummary
              request={{ incidentId: modelId }}
              dataTestId="incident-public-note-resend-audience"
            />
          ),
        },
      }}
      templates={{
        modelType: IncidentNoteTemplate,
        settingsRoute: RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES] as Route,
        ),
      }}
      /*
       * A template's {{incident.title}}-style placeholders are filled in with
       * this incident's values when it is picked.
       */
      templateVariables={() => {
        return fetchIncidentNoteTemplateVariables(modelId);
      }}
      ai={{
        title: "Generate Public Note with AI",
        description:
          "AI will analyze the incident data and generate a customer-facing public note.",
        templates: PUBLIC_NOTE_TEMPLATES,
        generate: getNoteGenerator({
          apiPath: "/incident/generate-note-from-ai",
          eventId: modelId,
          noteType: "public",
        }),
      }}
      siblingRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENT_VIEW_INTERNAL_NOTE] as Route,
        { modelId },
      )}
    />
  );
};

export default IncidentPublicNotes;
