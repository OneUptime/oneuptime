import EventNotes from "../../../Components/EventNotes/EventNotes";
import { getIncidentEpisodePublicNoteKind } from "../../../Components/EventNotes/NoteKinds/IncidentEpisodeNoteKinds";
import useParentNotifyDefault from "../../../Components/EventNotes/useParentNotifyDefault";
import PageComponentProps from "../../PageComponentProps";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import ObjectID from "Common/Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import PrivateRecordPublicNotes from "Common/Types/StatusPage/PrivateRecordPublicNotes";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const EpisodePublicNotes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const { isNotifyingByDefault, isPrivate, error } =
    useParentNotifyDefault<IncidentEpisode>({
      modelType: IncidentEpisode,
      id: modelId,
      select: {
        shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
        isPrivate: true,
      },
      resolve: (episode: IncidentEpisode | null): boolean => {
        return PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
          episode,
        );
      },
      /*
       * A private episode takes no public notes: the page keeps the ones it
       * has and says why there are no new ones.
       */
      resolveIsPrivate: (episode: IncidentEpisode | null): boolean => {
        return !PrivateRecordPublicNotes.takesPublicNotes(episode);
      },
    });

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (isNotifyingByDefault === null) {
    return <PageLoader isVisible={true} />;
  }

  return (
    <EventNotes<IncidentEpisodePublicNote>
      key={modelId.toString()}
      {...getIncidentEpisodePublicNoteKind({
        incidentEpisodeId: modelId,
        isNotifyingByDefault,
        isPrivate,
      })}
      currentProject={props.currentProject}
    />
  );
};

export default EpisodePublicNotes;
