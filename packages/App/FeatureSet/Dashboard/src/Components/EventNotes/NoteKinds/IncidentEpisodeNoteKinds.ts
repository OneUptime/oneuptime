import IncidentEpisodeInternalNote from "Common/Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PublicNoteSubscriberNotificationDefault from "Common/Types/StatusPage/PublicNoteSubscriberNotificationDefault";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { EventNoteKind, EventNotesTemplatesConfig } from "../EventNoteKind";

/*
 * An incident episode's public and private notes, as its Public Notes and
 * Private Notes pages and the Episode Feed's "Add Public Note" / "Add
 * Private Note" all write them. Episodes use the incidents' note templates
 * and have no Draft with AI.
 */

function getIncidentEpisodeNoteTemplates(): EventNotesTemplatesConfig {
  return {
    modelType: IncidentNoteTemplate,
    settingsRoute: RouteUtil.populateRouteParams(
      RouteMap[PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES] as Route,
    ),
  };
}

export function getIncidentEpisodePublicNoteKind(data: {
  incidentEpisodeId: ObjectID;
  /*
   * Where "Notify status page subscribers" starts: off when the episode
   * was created without notifying subscribers
   * - PublicNoteSubscriberNotificationDefault.shouldNotifyForIncidentEpisode.
   */
  isNotifyingByDefault: boolean;
}): EventNoteKind<IncidentEpisodePublicNote> {
  const incidentEpisodeId: ObjectID = data.incidentEpisodeId;

  return {
    modelType: IncidentEpisodePublicNote,
    visibility: "public",
    eventNoun: "episode",
    parentIdField: "incidentEpisodeId",
    parentId: incidentEpisodeId,
    attachmentApiPath: "/incident-episode-public-note/attachment",
    subscriberNotifications: {
      isNotifyingByDefault: data.isNotifyingByDefault,
      quietDescription:
        PublicNoteSubscriberNotificationDefault.quietIncidentEpisodeDescription,
    },
    templates: getIncidentEpisodeNoteTemplates(),
    siblingRoute: RouteUtil.populateRouteParams(
      RouteMap[PageMap.INCIDENT_EPISODE_VIEW_INTERNAL_NOTE] as Route,
      { modelId: incidentEpisodeId },
    ),
  };
}

export function getIncidentEpisodePrivateNoteKind(data: {
  incidentEpisodeId: ObjectID;
}): EventNoteKind<IncidentEpisodeInternalNote> {
  const incidentEpisodeId: ObjectID = data.incidentEpisodeId;

  return {
    modelType: IncidentEpisodeInternalNote,
    visibility: "private",
    eventNoun: "episode",
    parentIdField: "incidentEpisodeId",
    parentId: incidentEpisodeId,
    /*
     * No attachmentApiPath: episode private notes have no download route, so
     * files attached to one could never be opened again.
     */
    templates: getIncidentEpisodeNoteTemplates(),
    siblingRoute: RouteUtil.populateRouteParams(
      RouteMap[PageMap.INCIDENT_EPISODE_VIEW_PUBLIC_NOTE] as Route,
      { modelId: incidentEpisodeId },
    ),
  };
}
