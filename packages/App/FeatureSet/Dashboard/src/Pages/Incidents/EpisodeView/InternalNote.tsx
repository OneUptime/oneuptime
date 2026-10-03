import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getIncidentEpisodePrivateNoteKind } from "../../../Components/EventNotes/NoteKinds/IncidentEpisodeNoteKinds";
import PageComponentProps from "../../PageComponentProps";
import IncidentEpisodeInternalNote from "Common/Models/DatabaseModels/IncidentEpisodeInternalNote";
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
      {...getIncidentEpisodePrivateNoteKind({ incidentEpisodeId: modelId })}
      currentProject={props.currentProject}
    />
  );
};

export default EpisodePrivateNotes;
