import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";

export default interface EpisodeGroup {
  episode: IncidentEpisode;
  incidentSeverity: IncidentSeverity;
  publicNotes?: Array<IncidentEpisodePublicNote>;
  incidentState: IncidentState;
  episodeStateTimelines: Array<IncidentEpisodeStateTimeline>;
  episodeResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID>>;
}
