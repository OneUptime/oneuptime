import EventNotes from "../../../Components/EventNotes/EventNotes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import AlertEpisodeInternalNote from "Common/Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const AlertEpisodePrivateNotes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <EventNotes<AlertEpisodeInternalNote>
      key={modelId.toString()}
      modelType={AlertEpisodeInternalNote}
      visibility="private"
      eventNoun="episode"
      parentIdField="alertEpisodeId"
      parentId={modelId}
      currentProject={props.currentProject}
      /*
       * No attachmentApiPath: episode private notes have no download route,
       * so files attached to one could never be opened again.
       */
      templates={{
        modelType: AlertNoteTemplate,
        settingsRoute: RouteUtil.populateRouteParams(
          RouteMap[PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES] as Route,
        ),
      }}
    />
  );
};

export default AlertEpisodePrivateNotes;
