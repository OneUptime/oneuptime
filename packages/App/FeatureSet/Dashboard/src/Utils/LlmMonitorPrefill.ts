import Route from "Common/Types/API/Route";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { JSONObject } from "Common/Types/JSON";
import { CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import LlmMonitorTemplates, {
  LlmMonitorTemplate,
  LlmMonitorTemplateFilter,
} from "Common/Types/Monitor/LlmMonitor/LlmMonitorTemplates";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorRecommendationSeverityMapper from "Common/Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import ObjectID from "Common/Types/ObjectID";
import {
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  LLM_MONITOR_TEMPLATE_COPY,
  LlmMonitorTemplateCopy,
} from "../Components/LlmAlerts/LlmMonitorTemplateCopy";
import PageMap from "./PageMap";
import { RouteUtil } from "./RouteMap";

/*
 * MONITOR CREATE, OPENED ON AN AI ALERT TEMPLATE.
 *
 * The Alerts tab of AI / LLM links each template to Monitor Create with
 * ?llmMonitorTemplate=<id>. The create page reads the project's statuses
 * and severities, and this builds the monitor from them: an AI / LLM
 * monitor with the template's "what counts as bad", and the criteria pair
 * every curated template ships - an unhealthy criteria that raises an
 * alert which resolves itself, and its healthy mirror that brings the
 * monitor back.
 *
 * An alert, not an incident: a quality problem is worth a look and rarely
 * an outage. The incident is filled in and switched off, so a team that
 * wants to page on it flips one switch.
 *
 * Pure: everything it needs is handed in, so every rule is pinned by tests
 * without mounting the page.
 */

export const LLM_MONITOR_TEMPLATE_QUERY_PARAM: string = "llmMonitorTemplate";

export const LLM_MONITOR_UNKNOWN_TEMPLATE_ERROR: string = translationKey(
  "This link does not point to an AI alert. Open the Alerts tab of AI / LLM and pick one again.",
);

/*
 * The project's statuses and severities the criteria are built with. A
 * project missing one gets criteria that leave that part off rather than
 * criteria that cannot be saved.
 */
export interface LlmMonitorSeedIds {
  operationalMonitorStatusId: ObjectID | null;
  /*
   * The status the monitor shows while answers are bad: the first status
   * that is neither operational nor offline (Degraded in a new project),
   * else the offline one. A misbehaving AI is degraded, not down.
   */
  unhealthyMonitorStatusId: ObjectID | null;
  // Most severe first.
  rankedIncidentSeverityIds: Array<ObjectID>;
  rankedAlertSeverityIds: Array<ObjectID>;
}

function toCriteriaFilters(
  filters: Array<LlmMonitorTemplateFilter>,
): Array<CriteriaFilter> {
  return filters.map((filter: LlmMonitorTemplateFilter): CriteriaFilter => {
    return {
      checkOn: filter.checkOn,
      filterType: filter.filterType,
      value: filter.value,
    };
  });
}

export function buildLlmMonitorCriteria(data: {
  template: LlmMonitorTemplate;
  copy: LlmMonitorTemplateCopy;
  seeds: LlmMonitorSeedIds;
}): MonitorCriteria {
  const severityIds: {
    incident: ObjectID | null;
    alert: ObjectID | null;
  } = {
    incident:
      MonitorRecommendationSeverityMapper.getMappingFromRankedIds(
        data.seeds.rankedIncidentSeverityIds,
      )[data.template.severity] || null,
    alert:
      MonitorRecommendationSeverityMapper.getMappingFromRankedIds(
        data.seeds.rankedAlertSeverityIds,
      )[data.template.severity] || null,
  };

  const title: string =
    translateText(data.copy.monitorName) || data.copy.monitorName;
  const description: string =
    translateText(data.copy.alertDescription) || data.copy.alertDescription;

  const unhealthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  unhealthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.seeds.unhealthyMonitorStatusId || undefined,
    filterCondition: FilterCondition.All,
    filters: toCriteriaFilters(data.template.unhealthyFilters),
    incidents: severityIds.incident
      ? [
          {
            id: ObjectID.generate().toString(),
            title: title,
            description: description,
            incidentSeverityId: severityIds.incident,
            autoResolveIncident: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    alerts: severityIds.alert
      ? [
          {
            id: ObjectID.generate().toString(),
            title: title,
            description: description,
            alertSeverityId: severityIds.alert,
            autoResolveAlert: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    changeMonitorStatus: Boolean(data.seeds.unhealthyMonitorStatusId),
    createIncidents: false,
    createAlerts: Boolean(severityIds.alert),
    isEnabled: true,
    name: title,
    description: description,
  };

  const healthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  healthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.seeds.operationalMonitorStatusId || undefined,
    filterCondition: FilterCondition.Any,
    filters: toCriteriaFilters(data.template.healthyFilters),
    incidents: [],
    alerts: [],
    changeMonitorStatus: Boolean(data.seeds.operationalMonitorStatusId),
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: translateText("Healthy") || "Healthy",
    description:
      translateText("The AI is answering well.") ||
      "The AI is answering well.",
  };

  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return criteria;
}

/*
 * The initial values of Monitor Create for a template, or null when the id
 * is not a template.
 */
export function buildLlmMonitorPrefill(data: {
  templateId: unknown;
  seeds: LlmMonitorSeedIds;
}): JSONObject | null {
  const template: LlmMonitorTemplate | null = LlmMonitorTemplates.get(
    data.templateId,
  );

  if (!template) {
    return null;
  }

  const copy: LlmMonitorTemplateCopy = LLM_MONITOR_TEMPLATE_COPY[template.id];

  const monitorSteps: MonitorSteps = new MonitorSteps();
  const step: MonitorStep | undefined =
    monitorSteps.data?.monitorStepsInstanceArray[0];

  if (!step?.data) {
    return null;
  }

  step.setLlmMonitor(template.step);
  step.setMonitorCriteria(
    buildLlmMonitorCriteria({
      template: template,
      copy: copy,
      seeds: data.seeds,
    }),
  );

  /*
   * A prefilled MonitorSteps must carry its default status itself: the
   * steps form only fills it in when it bootstraps WITHOUT an initial value.
   */
  if (data.seeds.operationalMonitorStatusId) {
    monitorSteps.setDefaultMonitorStatusId(
      data.seeds.operationalMonitorStatusId,
    );
  }

  return {
    name: translateText(copy.monitorName) || copy.monitorName,
    description:
      translateText(copy.monitorDescription) || copy.monitorDescription,
    monitorType: MonitorType.Llm,
    monitorSteps: monitorSteps.toJSON(),
  };
}

// Monitor Create, opened on a template.
export function getLlmMonitorTemplateRoute(templateId: string): Route {
  return RouteUtil.getPageRoute(PageMap.MONITOR_CREATE, {
    query: {
      [LLM_MONITOR_TEMPLATE_QUERY_PARAM]: templateId,
    },
  });
}

// Monitor Create, opened on an AI / LLM monitor with nothing else filled in.
export function getLlmMonitorCreateRoute(): Route {
  return RouteUtil.getPageRoute(PageMap.MONITOR_CREATE, {
    query: {
      monitorType: MonitorType.Llm,
    },
  });
}
