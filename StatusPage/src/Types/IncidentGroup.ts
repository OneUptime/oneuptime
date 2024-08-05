import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import Incident from "Common/AppModels/Models/Incident";
import IncidentPublicNote from "Common/AppModels/Models/IncidentPublicNote";
import IncidentSeverity from "Common/AppModels/Models/IncidentSeverity";
import IncidentState from "Common/AppModels/Models/IncidentState";
import IncidentStateTimeline from "Common/AppModels/Models/IncidentStateTimeline";
import StatusPageResource from "Common/AppModels/Models/StatusPageResource";

export default interface IncidentGroup {
  incident: Incident;
  incidentSeverity: IncidentSeverity;
  publicNotes?: Array<IncidentPublicNote>;
  incidentState: IncidentState;
  incidentStateTimelines: Array<IncidentStateTimeline>;
  incidentResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID>>;
}
