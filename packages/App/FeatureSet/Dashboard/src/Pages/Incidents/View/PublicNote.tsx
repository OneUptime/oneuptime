import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getIncidentPublicNoteKind } from "../../../Components/EventNotes/NoteKinds/IncidentNoteKinds";
import useParentNotifyDefault, {
  PUBLIC_NOTES_LOAD_FAILED,
} from "../../../Components/EventNotes/useParentNotifyDefault";
import PageComponentProps from "../../PageComponentProps";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import ObjectID from "Common/Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import PrivateRecordPublicNotes from "Common/Types/StatusPage/PrivateRecordPublicNotes";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentPublicNotes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const { translateString } = useTranslateValue();

  const { isNotifyingByDefault, isPrivate, error } =
    useParentNotifyDefault<Incident>({
      modelType: Incident,
      id: modelId,
      select: {
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
        isPrivate: true,
      },
      resolve: (incident: Incident | null): boolean => {
        return PublicNoteSubscriberNotificationDefault.shouldNotifyForIncident(
          incident,
        );
      },
      /*
       * A private incident takes no public notes: the page keeps the ones
       * it has and says why there are no new ones.
       */
      resolveIsPrivate: (incident: Incident | null): boolean => {
        return !PrivateRecordPublicNotes.takesPublicNotes(incident);
      },
    });

  if (error) {
    return (
      <ErrorMessage
        message={error}
        whatFailed={translateString(PUBLIC_NOTES_LOAD_FAILED)}
      />
    );
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
        isPrivate,
      })}
      currentProject={props.currentProject}
    />
  );
};

export default IncidentPublicNotes;
