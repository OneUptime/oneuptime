import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getNoteGenerator } from "../../../Components/EventNotes/GenerateNoteWithAI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import ScheduledMaintenanceInternalNote from "Common/Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { INTERNAL_NOTE_TEMPLATES } from "Common/UI/Components/AI/AITemplates";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const ScheduledMaintenancePrivateNotes: FunctionComponent<
  PageComponentProps
> = (props: PageComponentProps): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <EventNotes<ScheduledMaintenanceInternalNote>
      key={modelId.toString()}
      modelType={ScheduledMaintenanceInternalNote}
      visibility="private"
      eventNoun="scheduled maintenance event"
      parentIdField="scheduledMaintenanceId"
      parentId={modelId}
      currentProject={props.currentProject}
      attachmentApiPath="/scheduled-maintenance-internal-note/attachment"
      templates={{
        modelType: ScheduledMaintenanceNoteTemplate,
        settingsRoute: RouteUtil.populateRouteParams(
          RouteMap[
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES
          ] as Route,
        ),
      }}
      ai={{
        title: "Generate Private Note with AI",
        description:
          "AI will analyze the scheduled maintenance data and generate an internal technical note.",
        templates: INTERNAL_NOTE_TEMPLATES,
        generate: getNoteGenerator({
          apiPath: "/scheduled-maintenance/generate-note-from-ai",
          eventId: modelId,
          noteType: "internal",
        }),
      }}
      siblingRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE] as Route,
        { modelId },
      )}
    />
  );
};

export default ScheduledMaintenancePrivateNotes;
