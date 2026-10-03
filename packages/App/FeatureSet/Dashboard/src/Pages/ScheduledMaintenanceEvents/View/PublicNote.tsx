import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getScheduledMaintenancePublicNoteKind } from "../../../Components/EventNotes/NoteKinds/ScheduledMaintenanceNoteKinds";
import useParentNotifyDefault from "../../../Components/EventNotes/useParentNotifyDefault";
import PageComponentProps from "../../PageComponentProps";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ObjectID from "Common/Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const ScheduledMaintenancePublicNotes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const { isNotifyingByDefault, error } =
    useParentNotifyDefault<ScheduledMaintenance>({
      modelType: ScheduledMaintenance,
      id: modelId,
      select: {
        shouldStatusPageSubscribersBeNotifiedOnEventCreated: true,
      },
      resolve: (scheduledMaintenance: ScheduledMaintenance | null): boolean => {
        return PublicNoteSubscriberNotificationDefault.shouldNotifyForScheduledMaintenance(
          scheduledMaintenance,
        );
      },
    });

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isNotifyingByDefault === null) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <EventNotes<ScheduledMaintenancePublicNote>
      /*
       * A new feed per event: a draft started on one maintenance event must
       * never be posted on the next.
       */
      key={modelId.toString()}
      {...getScheduledMaintenancePublicNoteKind({
        scheduledMaintenanceId: modelId,
        isNotifyingByDefault,
      })}
      currentProject={props.currentProject}
    />
  );
};

export default ScheduledMaintenancePublicNotes;
