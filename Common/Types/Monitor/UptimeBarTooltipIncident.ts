import Color from "../Color";
import ObjectID from "../ObjectID";

export default interface UptimeBarTooltipIncident {
  id: string;
  title: string;
  declaredAt: Date;
  incidentSeverity?:
    | {
        name: string;
        color: Color;
      }
    | undefined;
  currentIncidentState?:
    | {
        name: string;
        color: Color;
      }
    | undefined;
  monitorIds: Array<ObjectID>;
}
