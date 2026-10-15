import { JSONObject } from "../../Types/JSON";
import FilterCondition from "../../Types/Filter/FilterCondition";
import { CheckOn, CriteriaFilter } from "../../Types/Monitor/CriteriaFilter";
import { CriteriaAlert } from "../../Types/Monitor/CriteriaAlert";
import { CriteriaIncident } from "../../Types/Monitor/CriteriaIncident";
import MonitorCriteriaInstance from "../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import ObjectID from "../../Types/ObjectID";

/*
 * WHAT A NETWORK DEVICE MONITOR TEMPLATE RAISES, IN PLAIN TERMS.
 *
 * Picking a template for five hundred imported devices is picking what
 * pages people, five hundred times over, so the Review dialog shows what the
 * template does before anything is created (OneUptime issue #4815): each of
 * its checks, whether it opens an incident or an alert and at what
 * severity, whether it changes the monitor's status, and - because a device
 * that answers ping but not SNMP is pinged rather than walked - whether it
 * can fire on such a device at all.
 *
 * Read straight from the template's criteria, so the preview cannot claim
 * something the monitors will not do. Pure: ids are handed back for the
 * caller to name (severities, statuses, on-call policies), and nothing here
 * reads a database.
 */

/*
 * The checks a ping-only poll answers. A device with no SNMP credentials is
 * pinged and nothing else, so every other Network Device check reads a walk
 * that never happens and is not evaluated - never "met", never "healthy".
 * Only the reachability verdict - the same one the device's own status is -
 * is there to read.
 */
export const PING_ONLY_EVALUATED_CHECKS: ReadonlyArray<CheckOn> = [
  CheckOn.SnmpIsOnline,
];

export interface MonitorCriteriaAlertSummary {
  id: string;
  // The criterion's own name, or "" when it has none (the caller numbers it).
  name: string;
  description: string;
  isEnabled: boolean;
  /*
   * Opens an incident when met: the criterion asks for incidents AND names
   * at least one - an empty list fires nothing whatever the switch says.
   */
  raisesIncident: boolean;
  incidentSeverityIds: Array<string>;
  raisesAlert: boolean;
  alertSeverityIds: Array<string>;
  changesStatus: boolean;
  monitorStatusId?: string | undefined;
  // Every on-call policy its incidents and alerts page, each once.
  onCallPolicyIds: Array<string>;
  // What it checks, in the order its filters are written.
  checks: Array<CheckOn>;
  // Whether it can be met on a device that is pinged and not walked.
  isEvaluatedOnPingOnlyDevices: boolean;
}

export interface MonitorTemplateAlertSummary {
  // Every criterion of every step, in evaluation order.
  criteria: Array<MonitorCriteriaAlertSummary>;
  // Some enabled criterion opens an incident.
  raisesIncidents: boolean;
  raisesAlerts: boolean;
  // ...on a device that answers ping only.
  raisesIncidentsOnPingOnlyDevices: boolean;
  raisesAlertsOnPingOnlyDevices: boolean;
}

function readSteps(
  monitorSteps: MonitorSteps | JSONObject | null | undefined,
): Array<MonitorStep> {
  if (!monitorSteps) {
    return [];
  }

  try {
    const steps: MonitorSteps =
      monitorSteps instanceof MonitorSteps
        ? monitorSteps
        : MonitorSteps.fromJSON(monitorSteps as JSONObject);

    return steps.data?.monitorStepsInstanceArray || [];
  } catch {
    // A template whose steps cannot be read raises nothing anyone can name.
    return [];
  }
}

function idsOf(values: Array<ObjectID | string | undefined | null>): Array<string> {
  const ids: Array<string> = [];

  for (const value of values) {
    const id: string = value ? value.toString().trim() : "";

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/*
 * Whether a criterion can be met on a device that is only pinged. Its
 * filters are joined by its condition: with All, every filter must be
 * evaluated, so one walk-only filter keeps the criterion from ever being met;
 * with Any, one reachability filter is enough.
 */
export function isCriterionEvaluatedOnPingOnlyDevices(data: {
  checks: ReadonlyArray<CheckOn | undefined>;
  filterCondition: FilterCondition | undefined;
}): boolean {
  const checks: Array<CheckOn | undefined> = [...data.checks];

  if (checks.length === 0) {
    return false;
  }

  const isPingOnlyCheck: (check: CheckOn | undefined) => boolean = (
    check: CheckOn | undefined,
  ): boolean => {
    return Boolean(check && PING_ONLY_EVALUATED_CHECKS.includes(check));
  };

  if (data.filterCondition === FilterCondition.Any) {
    return checks.some(isPingOnlyCheck);
  }

  return checks.every(isPingOnlyCheck);
}

export function summarizeMonitorCriteria(
  instance: MonitorCriteriaInstance,
  index: number,
): MonitorCriteriaAlertSummary {
  const data: MonitorCriteriaInstance["data"] = instance.data;
  const incidents: Array<CriteriaIncident> = data?.incidents || [];
  const alerts: Array<CriteriaAlert> = data?.alerts || [];
  const filters: Array<CriteriaFilter> = data?.filters || [];

  const raisesIncident: boolean = Boolean(
    data?.createIncidents && incidents.length > 0,
  );
  const raisesAlert: boolean = Boolean(data?.createAlerts && alerts.length > 0);

  const checks: Array<CheckOn> = filters
    .map((filter: CriteriaFilter): CheckOn => {
      return filter.checkOn;
    })
    .filter((check: CheckOn | undefined): boolean => {
      return Boolean(check);
    });

  const onCallPolicyIds: Array<string> = idsOf([
    ...(raisesIncident
      ? incidents.flatMap((incident: CriteriaIncident) => {
          return incident.onCallPolicyIds || [];
        })
      : []),
    ...(raisesAlert
      ? alerts.flatMap((alert: CriteriaAlert) => {
          return alert.onCallPolicyIds || [];
        })
      : []),
  ]);

  const summary: MonitorCriteriaAlertSummary = {
    id: data?.id || `criteria-${index}`,
    name: (data?.name || "").trim(),
    description: (data?.description || "").trim(),
    // Only an explicit false switches a criterion off.
    isEnabled: data?.isEnabled !== false,
    raisesIncident: raisesIncident,
    incidentSeverityIds: raisesIncident
      ? idsOf(
          incidents.map((incident: CriteriaIncident) => {
            return incident.incidentSeverityId;
          }),
        )
      : [],
    raisesAlert: raisesAlert,
    alertSeverityIds: raisesAlert
      ? idsOf(
          alerts.map((alert: CriteriaAlert) => {
            return alert.alertSeverityId;
          }),
        )
      : [],
    changesStatus: Boolean(data?.changeMonitorStatus && data?.monitorStatusId),
    onCallPolicyIds: onCallPolicyIds,
    checks: checks,
    isEvaluatedOnPingOnlyDevices: isCriterionEvaluatedOnPingOnlyDevices({
      checks: checks,
      filterCondition: data?.filterCondition,
    }),
  };

  if (summary.changesStatus && data?.monitorStatusId) {
    summary.monitorStatusId = data.monitorStatusId.toString();
  }

  return summary;
}

export function summarizeMonitorTemplateAlerts(
  monitorSteps: MonitorSteps | JSONObject | null | undefined,
): MonitorTemplateAlertSummary {
  const criteria: Array<MonitorCriteriaAlertSummary> = [];

  for (const step of readSteps(monitorSteps)) {
    const instances: Array<MonitorCriteriaInstance> =
      step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

    for (const instance of instances) {
      criteria.push(summarizeMonitorCriteria(instance, criteria.length));
    }
  }

  const enabled: Array<MonitorCriteriaAlertSummary> = criteria.filter(
    (criterion: MonitorCriteriaAlertSummary): boolean => {
      return criterion.isEnabled;
    },
  );

  return {
    criteria: criteria,
    raisesIncidents: enabled.some((criterion: MonitorCriteriaAlertSummary) => {
      return criterion.raisesIncident;
    }),
    raisesAlerts: enabled.some((criterion: MonitorCriteriaAlertSummary) => {
      return criterion.raisesAlert;
    }),
    raisesIncidentsOnPingOnlyDevices: enabled.some(
      (criterion: MonitorCriteriaAlertSummary) => {
        return criterion.raisesIncident && criterion.isEvaluatedOnPingOnlyDevices;
      },
    ),
    raisesAlertsOnPingOnlyDevices: enabled.some(
      (criterion: MonitorCriteriaAlertSummary) => {
        return criterion.raisesAlert && criterion.isEvaluatedOnPingOnlyDevices;
      },
    ),
  };
}
