import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getNoteGenerator } from "../../../Components/EventNotes/GenerateNoteWithAI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { INTERNAL_NOTE_TEMPLATES } from "Common/UI/Components/AI/AITemplates";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentPrivateNotes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <EventNotes<IncidentInternalNote>
      key={modelId.toString()}
      modelType={IncidentInternalNote}
      visibility="private"
      eventNoun="incident"
      parentIdField="incidentId"
      parentId={modelId}
      currentProject={props.currentProject}
      attachmentApiPath="/incident-internal-note/attachment"
      templates={{
        modelType: IncidentNoteTemplate,
        settingsRoute: RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES] as Route,
        ),
      }}
      ai={{
        title: "Generate Private Note with AI",
        description:
          "AI will analyze the incident data and generate an internal technical note.",
        templates: INTERNAL_NOTE_TEMPLATES,
        generate: getNoteGenerator({
          apiPath: "/incident/generate-note-from-ai",
          eventId: modelId,
          noteType: "internal",
        }),
      }}
      siblingRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENT_VIEW_PUBLIC_NOTE] as Route,
        { modelId },
      )}
    />
  );
};

export default IncidentPrivateNotes;
