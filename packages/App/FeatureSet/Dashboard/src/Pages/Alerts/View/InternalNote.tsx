import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getNoteGenerator } from "../../../Components/EventNotes/GenerateNoteWithAI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { INTERNAL_NOTE_TEMPLATES } from "Common/UI/Components/AI/AITemplates";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const AlertPrivateNotes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <EventNotes<AlertInternalNote>
      key={modelId.toString()}
      modelType={AlertInternalNote}
      visibility="private"
      eventNoun="alert"
      parentIdField="alertId"
      parentId={modelId}
      currentProject={props.currentProject}
      attachmentApiPath="/alert-internal-note/attachment"
      templates={{
        modelType: AlertNoteTemplate,
        settingsRoute: RouteUtil.populateRouteParams(
          RouteMap[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES] as Route,
        ),
      }}
      ai={{
        title: "Generate Private Note with AI",
        description:
          "AI will analyze the alert data and generate an internal technical note.",
        templates: INTERNAL_NOTE_TEMPLATES,
        // Alerts only have private notes, so their endpoint takes no type.
        generate: getNoteGenerator({
          apiPath: "/alert/generate-note-from-ai",
          eventId: modelId,
        }),
      }}
    />
  );
};

export default AlertPrivateNotes;
