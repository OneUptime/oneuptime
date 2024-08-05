import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";

export default interface IncidentGroup {
  incident: Incident;
  incidentSeverity: IncidentSeverity;
  publicNotes?: Array<IncidentPublicNote>;
  incidentState: IncidentState;
  incidentStateTimelines: Array<IncidentStateTimeline>;
  incidentResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID>>;
}
