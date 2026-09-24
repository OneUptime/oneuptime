import EventNotes from "../../../Components/EventNotes/EventNotes";
import useParentNotifyDefault from "../../../Components/EventNotes/useParentNotifyDefault";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const EpisodePublicNotes: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const { isNotifyingByDefault, error } =
    useParentNotifyDefault<IncidentEpisode>({
      modelType: IncidentEpisode,
      id: modelId,
      select: {
        shouldStatusPageSubscribersBeNotifiedOnEpisodeCreated: true,
      },
      resolve: (episode: IncidentEpisode | null): boolean => {
        return PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode(
          episode,
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
    <EventNotes<IncidentEpisodePublicNote>
      key={modelId.toString()}
      modelType={IncidentEpisodePublicNote}
      visibility="public"
      eventNoun="episode"
      parentIdField="incidentEpisodeId"
      parentId={modelId}
      currentProject={props.currentProject}
      attachmentApiPath="/incident-episode-public-note/attachment"
      subscriberNotifications={{
        isNotifyingByDefault,
        quietDescription:
          PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
      }}
      templates={{
        modelType: IncidentNoteTemplate,
        settingsRoute: RouteUtil.populateRouteParams(
          RouteMap[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES] as Route,
        ),
      }}
      siblingRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENT_EPISODE_VIEW_INTERNAL_NOTE] as Route,
        { modelId },
      )}
    />
  );
};

export default EpisodePublicNotes;
