import EventNotes from "../../../Components/EventNotes/EventNotes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import IncidentEpisodeInternalNote from "Common/Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const EpisodePrivateNotes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <EventNotes<IncidentEpisodeInternalNote>
      key={modelId.toString()}
      modelType={IncidentEpisodeInternalNote}
      visibility="private"
      eventNoun="episode"
      parentIdField="incidentEpisodeId"
      parentId={modelId}
      currentProject={props.currentProject}
      /*
       * No attachmentApiPath: episode private notes have no download route,
       * so files attached to one could never be opened again.
       */
      templates={{
        modelType: IncidentNoteTemplate,
        settingsRoute: RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES] as Route,
        ),
      }}
      siblingRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENT_EPISODE_VIEW_PUBLIC_NOTE] as Route,
        { modelId },
      )}
    />
  );
};

export default EpisodePrivateNotes;
