import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import { MonitorCriteriaInstanceType } from "Common/Types/Monitor/MonitorCriteriaInstance";

/*
 * WHAT A RECOVERY RESOLVES, AS A GROUPED INCOMING REQUEST CRITERIA'S FORM
 * SAYS IT (issue #10550).
 *
 * A criteria that groups its incidents and alerts by a payload field can
 * name a recovery field and value. A request that reports a value recovered
 * resolves that value's incident and alert - each only when its template
 * resolves on its own: Auto Resolve Incident or Auto Resolve Alert, folded
 * under More fields in the incident's or alert's form. The default offline
 * criteria starts with both on; an incident or alert added to a criteria
 * starts with them off.
 *
 * The grouping settings said "Resolves an incident when requestBody.status
 * equals resolved" whatever the switches said, and never named an alert. A
 * customer whose criteria raised alerts, added that way, saw every
 * SolarWinds Orion reset leave its alert open. So the form says what a
 * recovery resolves, and names what it leaves open with the switch that
 * would resolve it (MonitorCriteriaInstance.tsx), from this.
 */

export interface GroupingRecovery {
  // A recovery field and a value are named: a request can report recovered.
  isNamed: boolean;
  /*
   * What the criteria opens, each of whose templates resolves on its own:
   * a recovery resolves it.
   */
  resolvesIncidents: boolean;
  resolvesAlerts: boolean;
  /*
   * What the criteria opens with a template that does not resolve on its
   * own: a recovery leaves it open, until its switch is on.
   */
  leavesIncidentsOpen: boolean;
  leavesAlertsOpen: boolean;
}

export type GroupingRecoveryCriteria = Pick<
  MonitorCriteriaInstanceType,
  | "incidentGrouping"
  | "createIncidents"
  | "createAlerts"
  | "incidents"
  | "alerts"
>;

export function getGroupingRecovery(
  criteria: GroupingRecoveryCriteria | undefined,
): GroupingRecovery {
  const grouping: GroupingRecoveryCriteria["incidentGrouping"] =
    criteria?.incidentGrouping;

  // As the form keeps them: an emptied field is left out, never "".
  const isNamed: boolean = Boolean(
    grouping?.groupByJSONPath?.trim() &&
      grouping.resolvedWhenJSONPath?.trim() &&
      grouping.resolvedWhenValue,
  );

  const incidents: Array<CriteriaIncident> = criteria?.incidents || [];
  const alerts: Array<CriteriaAlert> = criteria?.alerts || [];

  const opensIncidents: boolean =
    isNamed && criteria?.createIncidents === true && incidents.length > 0;
  const opensAlerts: boolean =
    isNamed && criteria?.createAlerts === true && alerts.length > 0;

  const leavesIncidentsOpen: boolean =
    opensIncidents &&
    incidents.some((incident: CriteriaIncident): boolean => {
      return !incident.autoResolveIncident;
    });
  const leavesAlertsOpen: boolean =
    opensAlerts &&
    alerts.some((alert: CriteriaAlert): boolean => {
      return !alert.autoResolveAlert;
    });

  return {
    isNamed: isNamed,
    resolvesIncidents: opensIncidents && !leavesIncidentsOpen,
    resolvesAlerts: opensAlerts && !leavesAlertsOpen,
    leavesIncidentsOpen: leavesIncidentsOpen,
    leavesAlertsOpen: leavesAlertsOpen,
  };
}

// The criteria's incidents, each set to resolve on its own.
export function withIncidentsResolvingOnTheirOwn(
  incidents: Array<CriteriaIncident>,
): Array<CriteriaIncident> {
  return incidents.map((incident: CriteriaIncident): CriteriaIncident => {
    return { ...incident, autoResolveIncident: true };
  });
}

// The criteria's alerts, each set to resolve on its own.
export function withAlertsResolvingOnTheirOwn(
  alerts: Array<CriteriaAlert>,
): Array<CriteriaAlert> {
  return alerts.map((alert: CriteriaAlert): CriteriaAlert => {
    return { ...alert, autoResolveAlert: true };
  });
}
