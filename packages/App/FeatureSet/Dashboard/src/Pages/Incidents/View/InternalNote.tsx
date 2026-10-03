import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getIncidentPrivateNoteKind } from "../../../Components/EventNotes/NoteKinds/IncidentNoteKinds";
import PageComponentProps from "../../PageComponentProps";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentPrivateNotes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <EventNotes<IncidentInternalNote>
      key={modelId.toString()}
      {...getIncidentPrivateNoteKind({ incidentId: modelId })}
      currentProject={props.currentProject}
    />
  );
};

export default IncidentPrivateNotes;
