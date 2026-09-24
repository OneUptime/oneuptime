import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getNoteGenerator } from "../../../Components/EventNotes/GenerateNoteWithAI";
import useParentNotifyDefault from "../../../Components/EventNotes/useParentNotifyDefault";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import { PUBLIC_NOTE_TEMPLATES } from "Common/UI/Components/AI/AITemplates";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const ScheduledMaintenancePublicNotes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const { isNotifyingByDefault, error } =
    useParentNotifyDefault<ScheduledMaintenance>({
      modelType: ScheduledMaintenance,
      id: modelId,
      select: {
        shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
      },
      resolve: (scheduledMaintenance: ScheduledMaintenance | null): boolean => {
        return PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
          scheduledMaintenance,
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
    <EventNotes<ScheduledMaintenancePublicNote>
      /*
       * A new feed per event: a draft started on one maintenance event must
       * never be posted on the next.
       */
      key={modelId.toString()}
      modelType={ScheduledMaintenancePublicNote}
      visibility="public"
      eventNoun="scheduled maintenance event"
      parentIdField="scheduledMaintenanceId"
      parentId={modelId}
      currentProject={props.currentProject}
      attachmentApiPath="/scheduled-maintenance-public-note/attachment"
      subscriberNotifications={{
        isNotifyingByDefault,
        quietDescription:
          PublicNoteSubscriberNotificationDefault.quietScheduledMaintenanceDescription,
      }}
      templates={{
        modelType: ScheduledMaintenanceNoteTemplate,
        settingsRoute: RouteUtil.populateRouteParams(
          RouteMap[
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES
          ] as Route,
        ),
      }}
      ai={{
        title: "Generate Public Note with AI",
        description:
          "AI will analyze the scheduled maintenance data and generate a customer-facing public note.",
        templates: PUBLIC_NOTE_TEMPLATES,
        generate: getNoteGenerator({
          apiPath: "/scheduled-maintenance/generate-note-from-ai",
          eventId: modelId,
          noteType: "public",
        }),
      }}
      siblingRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE] as Route,
        { modelId },
      )}
    />
  );
};

export default ScheduledMaintenancePublicNotes;
