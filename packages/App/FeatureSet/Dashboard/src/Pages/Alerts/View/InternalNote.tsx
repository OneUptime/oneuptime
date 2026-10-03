import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getAlertPrivateNoteKind } from "../../../Components/EventNotes/NoteKinds/AlertNoteKinds";
import PageComponentProps from "../../PageComponentProps";
import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const AlertPrivateNotes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <EventNotes<AlertInternalNote>
      key={modelId.toString()}
      {...getAlertPrivateNoteKind({ alertId: modelId })}
      currentProject={props.currentProject}
    />
  );
};

export default AlertPrivateNotes;
