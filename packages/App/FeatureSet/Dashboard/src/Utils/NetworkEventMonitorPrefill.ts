import Route from "Common/Types/API/Route";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { JSONObject } from "Common/Types/JSON";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorRecommendationSeverityMapper from "Common/Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import NetworkEventAlertTemplates, {
  NetworkEventAlertTemplate,
} from "Common/Types/NetworkEvent/NetworkEventAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import {
  translateTemplate,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  NETWORK_EVENT_ALERT_TEMPLATE_COPY,
  NetworkEventAlertTemplateCopy,
} from "../Components/NetworkEvents/NetworkEventAlertTemplateCopy";
import {
  NetworkEventCopy,
  getNetworkEventCopy,
} from "../Components/NetworkEvents/NetworkEventCopy";
import { LlmMonitorSeedIds } from "./LlmMonitorPrefill";
import PageMap from "./PageMap";
import { RouteUtil } from "./RouteMap";

/*
 * MONITOR CREATE, OPENED ON A NETWORK EVENT ALERT.
 *
 * The Events pages of Network link each alert to Monitor Create with
 * ?networkEventAlert=<id> - a featured template's id, or an event's name -
 * and, from one device's page, ?networkEventDeviceId=<id>. The create page
 * reads the project's statuses and severities, and this builds the monitor
 * from them: a Logs monitor that counts the event, grouped into one alert
 * per device and per thing on it, resolved by the event that says it is
 * over.
 *
 * An alert, not an incident: most of what a device reports is worth a look
 * and not an outage. The incident is filled in and switched off, so a team
 * that wants to page on it flips one switch.
 *
 * One criteria, not a pair: a grouped monitor with nothing to alert on
 * meets no criteria and goes back to its default status, so a "healthy"
 * criteria would never be met.
 *
 * Pure: everything it needs is handed in, so every rule is pinned by tests
 * without mounting the page.
 */

export const NETWORK_EVENT_ALERT_QUERY_PARAM: string = "networkEventAlert";
export const NETWORK_EVENT_DEVICE_QUERY_PARAM: string = "networkEventDeviceId";

export const NETWORK_EVENT_UNKNOWN_ALERT_ERROR: string = translationKey(
  "This link does not point to a network event alert. Open Network > Events and pick one again.",
);

// The same statuses and severities every prefilled monitor is built with.
export type NetworkEventMonitorSeedIds = LlmMonitorSeedIds;

// The device a monitor is for, when it was opened from one device's page.
export interface NetworkEventMonitorDevice {
  id: string;
  name: string;
}

interface MonitorWords {
  monitorName: string;
  monitorDescription: string;
  alertDescription: string;
}

/*
 * What a monitor and its alert are called. A featured template has words
 * of its own; an event has its title and its sentence; a project's own
 * event is called by its name.
 */
function wordsFor(template: NetworkEventAlertTemplate): MonitorWords {
  if (NetworkEventAlertTemplates.isFeatured(template.id)) {
    const copy: NetworkEventAlertTemplateCopy =
      NETWORK_EVENT_ALERT_TEMPLATE_COPY[template.id];

    return {
      monitorName: translateText(copy.monitorName) || copy.monitorName,
      monitorDescription:
        translateText(copy.monitorDescription) || copy.monitorDescription,
      alertDescription:
        translateText(copy.alertDescription) || copy.alertDescription,
    };
  }

  const eventCopy: NetworkEventCopy | null = getNetworkEventCopy(
    template.event,
  );

  if (eventCopy) {
    const title: string = translateText(eventCopy.title) || eventCopy.title;
    const description: string =
      translateText(eventCopy.description) || eventCopy.description;

    return {
      monitorName: title,
      monitorDescription: translateTemplate(
        "Alerts you when a device reports this network event: {{eventTitle}}. One alert per device and per thing the event names.",
        { eventTitle: title },
      ),
      alertDescription: description,
    };
  }

  const eventName: string = template.event || template.id;

  return {
    monitorName: eventName,
    monitorDescription: translateTemplate(
      "Alerts you when a device reports the network event {{eventName}}, once per device.",
      { eventName: eventName },
    ),
    alertDescription: translateTemplate(
      "A device reported the network event {{eventName}}.",
      { eventName: eventName },
    ),
  };
}

export function buildNetworkEventMonitorCriteria(data: {
  template: NetworkEventAlertTemplate;
  words: MonitorWords;
  seeds: NetworkEventMonitorSeedIds;
}): MonitorCriteria {
  const incidentSeverityId: ObjectID | null =
    MonitorRecommendationSeverityMapper.getMappingFromRankedIds(
      data.seeds.rankedIncidentSeverityIds,
    )[data.template.severity] || null;

  const alertSeverityId: ObjectID | null =
    MonitorRecommendationSeverityMapper.getMappingFromRankedIds(
      data.seeds.rankedAlertSeverityIds,
    )[data.template.severity] || null;

  const title: string = data.words.monitorName;
  const description: string = data.words.alertDescription;

  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.seeds.unhealthyMonitorStatusId || undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: data.template.moreThan,
      },
    ],
    incidents: incidentSeverityId
      ? [
          {
            id: ObjectID.generate().toString(),
            title: title,
            description: description,
            incidentSeverityId: incidentSeverityId,
            autoResolveIncident: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    alerts: alertSeverityId
      ? [
          {
            id: ObjectID.generate().toString(),
            title: title,
            description: description,
            alertSeverityId: alertSeverityId,
            autoResolveAlert: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    changeMonitorStatus: Boolean(data.seeds.unhealthyMonitorStatusId),
    createIncidents: false,
    createAlerts: Boolean(alertSeverityId),
    isEnabled: true,
    name: title,
    description: description,
  };

  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = {
    monitorCriteriaInstanceArray: [instance],
  };

  return criteria;
}

/*
 * The initial values of Monitor Create for an alert, or null when the id
 * names neither a featured template nor an event.
 */
export function buildNetworkEventMonitorPrefill(data: {
  alertId: unknown;
  device?: NetworkEventMonitorDevice | null | undefined;
  seeds: NetworkEventMonitorSeedIds;
}): JSONObject | null {
  let template: NetworkEventAlertTemplate | null =
    NetworkEventAlertTemplates.get(data.alertId);

  if (!template) {
    return null;
  }

  if (data.device?.id) {
    template = NetworkEventAlertTemplates.forDevice(template, data.device.id);
  }

  const words: MonitorWords = wordsFor(template);

  const monitorSteps: MonitorSteps = new MonitorSteps();
  const step: MonitorStep | undefined =
    monitorSteps.data?.monitorStepsInstanceArray[0];

  if (!step?.data) {
    return null;
  }

  /*
   * Spread the util's default first: a new MonitorStep leaves logMonitor
   * undefined, and the spread keeps every key the step form expects.
   */
  step.data.logMonitor = {
    ...MonitorStepLogMonitorUtil.getDefault(),
    attributes: template.attributes,
    lastXSecondsOfLogs: template.windowInSeconds,
    groupByAttributes: template.groupByAttributes,
    resolvedByAttributes: template.resolvedByAttributes,
  };

  step.setMonitorCriteria(
    buildNetworkEventMonitorCriteria({
      template: template,
      words: words,
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

  const deviceName: string = data.device?.name?.trim() || "";

  return {
    // "Interface down - Core Switch" on a monitor for one device.
    name: deviceName
      ? `${words.monitorName} - ${deviceName}`
      : words.monitorName,
    description: words.monitorDescription,
    monitorType: MonitorType.Logs,
    monitorSteps: monitorSteps.toJSON(),
  };
}

/*
 * Monitor Create, opened on an alert: a featured template's id or an
 * event's name, for every device or for one.
 */
export function getNetworkEventAlertRoute(
  alertId: string,
  networkDeviceId?: string | undefined,
): Route {
  const query: Record<string, string> = {
    [NETWORK_EVENT_ALERT_QUERY_PARAM]: alertId,
  };

  if (networkDeviceId) {
    query[NETWORK_EVENT_DEVICE_QUERY_PARAM] = networkDeviceId;
  }

  return RouteUtil.getPageRoute(PageMap.MONITOR_CREATE, {
    query: query,
  });
}

// Monitor Create, opened on a Logs monitor with nothing else filled in.
export function getNetworkEventMonitorCreateRoute(): Route {
  return RouteUtil.getPageRoute(PageMap.MONITOR_CREATE, {
    query: {
      monitorType: MonitorType.Logs,
    },
  });
}
