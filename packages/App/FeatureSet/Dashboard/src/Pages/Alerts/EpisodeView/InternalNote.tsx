import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getAlertEpisodePrivateNoteKind } from "../../../Components/EventNotes/NoteKinds/AlertEpisodeNoteKinds";
import PageComponentProps from "../../PageComponentProps";
import AlertEpisodeInternalNote from "Common/Models/DatabaseModels/AlertEpisodeInternalNote";
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
      {...getAlertEpisodePrivateNoteKind({ alertEpisodeId: modelId })}
      currentProject={props.currentProject}
    />
  );
};

export default AlertEpisodePrivateNotes;
