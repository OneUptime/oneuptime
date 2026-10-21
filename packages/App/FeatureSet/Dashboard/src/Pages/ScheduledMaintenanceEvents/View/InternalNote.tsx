import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getScheduledMaintenancePrivateNoteKind } from "../../../Components/EventNotes/NoteKinds/ScheduledMaintenanceNoteKinds";
import PageComponentProps from "../../PageComponentProps";
import ScheduledMaintenanceInternalNote from "Common/Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const ScheduledMaintenancePrivateNotes: FunctionComponent<
  PageComponentProps
> = (props: PageComponentProps): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <EventNotes<ScheduledMaintenanceInternalNote>
      key={modelId.toString()}
      {...getScheduledMaintenancePrivateNoteKind({
        scheduledMaintenanceId: modelId,
      })}
      currentProject={props.currentProject}
    />
  );
};

export default ScheduledMaintenancePrivateNotes;
