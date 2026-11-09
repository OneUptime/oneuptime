import Dictionary from "../../Types/Dictionary";
import MonitorCriteriaInstance from "../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";

/*
 * WHICH OF ITS INCIDENTS AND ALERTS A MONITOR RESOLVES ON ITS OWN.
 *
 * An incident or alert template on a monitor's criteria can be set to resolve
 * by itself (autoResolveIncident, autoResolveAlert): once a check no longer
 * meets the criteria that opened it, the monitor resolves it. Here, for each
 * criteria, are the templates set so, keyed by the criteria's id - what an
 * open incident or alert is matched against (its createdCriteriaId, and an
 * incident's createdIncidentTemplateId: MonitorIncident and MonitorAlert,
 * isAutoResolveConfiguredForIncident and isAutoResolveConfiguredForAlert).
 *
 * Two things ask: a check result (MonitorResource), which resolves what the
 * monitor no longer meets, and turning monitoring off (MonitorTurnedOff),
 * which resolves what the monitor can no longer resolve itself. Both read it
 * here, so they cannot disagree about which incidents and alerts are the
 * monitor's to resolve.
 *
 * A template that has no id (criteria an API client wrote before the server
 * gave templates ids) is listed as it is, without one: the criteria then
 * counts as resolving its records on its own, and a record that names no
 * template is matched on its criteria alone. A criteria with no id is left
 * out - nothing it opened can name it.
 */

export interface MonitorAutoResolveTemplateIds {
  // A criteria's id, and the ids of its incident templates that resolve on their own.
  incidents: Dictionary<Array<string>>;
  // A criteria's id, and the ids of its alert templates that resolve on their own.
  alerts: Dictionary<Array<string>>;
}

export default class MonitorAutoResolveTemplates {
  // Every criteria of every step of the monitor, in the order of its steps.
  public static getCriteriaInstances(
    monitorSteps: MonitorSteps | null | undefined,
  ): Array<MonitorCriteriaInstance> {
    const steps: Array<MonitorStep> =
      monitorSteps?.data?.monitorStepsInstanceArray || [];

    const criteriaInstances: Array<MonitorCriteriaInstance> = [];

    for (const step of steps) {
      for (const criteriaInstance of step?.data?.monitorCriteria?.data
        ?.monitorCriteriaInstanceArray || []) {
        if (criteriaInstance) {
          criteriaInstances.push(criteriaInstance);
        }
      }
    }

    return criteriaInstances;
  }

  public static fromCriteriaInstances(
    criteriaInstances: Array<MonitorCriteriaInstance>,
  ): MonitorAutoResolveTemplateIds {
    const templateIds: MonitorAutoResolveTemplateIds = {
      incidents: {},
      alerts: {},
    };

    for (const criteriaInstance of criteriaInstances) {
      const criteriaId: string | undefined =
        criteriaInstance?.data?.id?.toString() || undefined;

      if (!criteriaId) {
        continue;
      }

      for (const incidentTemplate of criteriaInstance.data?.incidents || []) {
        if (!incidentTemplate?.autoResolveIncident) {
          continue;
        }

        if (!templateIds.incidents[criteriaId]) {
          templateIds.incidents[criteriaId] = [];
        }

        templateIds.incidents[criteriaId]!.push(incidentTemplate.id);
      }

      for (const alertTemplate of criteriaInstance.data?.alerts || []) {
        if (!alertTemplate?.autoResolveAlert) {
          continue;
        }

        if (!templateIds.alerts[criteriaId]) {
          templateIds.alerts[criteriaId] = [];
        }

        templateIds.alerts[criteriaId]!.push(alertTemplate.id);
      }
    }

    return templateIds;
  }

  public static fromMonitorSteps(
    monitorSteps: MonitorSteps | null | undefined,
  ): MonitorAutoResolveTemplateIds {
    return MonitorAutoResolveTemplates.fromCriteriaInstances(
      MonitorAutoResolveTemplates.getCriteriaInstances(monitorSteps),
    );
  }

  // True when no criteria of the monitor resolves anything on its own.
  public static isEmpty(templateIds: MonitorAutoResolveTemplateIds): boolean {
    return (
      Object.keys(templateIds.incidents).length === 0 &&
      Object.keys(templateIds.alerts).length === 0
    );
  }
}
