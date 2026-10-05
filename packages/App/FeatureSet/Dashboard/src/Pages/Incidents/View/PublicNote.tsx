import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getIncidentPublicNoteKind } from "../../../Components/EventNotes/NoteKinds/IncidentNoteKinds";
import useParentNotifyDefault from "../../../Components/EventNotes/useParentNotifyDefault";
import PageComponentProps from "../../PageComponentProps";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import ObjectID from "Common/Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentPublicNotes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const { isNotifyingByDefault, error } = useParentNotifyDefault<Incident>({
    modelType: Incident,
    id: modelId,
    select: {
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
    },
    resolve: (incident: Incident | null): boolean => {
      return PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(
        incident,
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
    <EventNotes<IncidentPublicNote>
      /*
       * A new feed per incident: a draft, a template or an AI draft started
       * on one incident must never be posted on the next.
       */
      key={modelId.toString()}
      {...getIncidentPublicNoteKind({
        incidentId: modelId,
        isNotifyingByDefault,
      })}
      currentProject={props.currentProject}
    />
  );
};

export default IncidentPublicNotes;
