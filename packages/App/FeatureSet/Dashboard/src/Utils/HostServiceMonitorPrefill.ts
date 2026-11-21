import Route from "Common/Types/API/Route";
import ColumnLength from "Common/Types/Database/ColumnLength";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { JSONObject } from "Common/Types/JSON";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import { buildHostMonitorConfig } from "Common/Types/Monitor/HostAlertTemplates";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepHostMonitor from "Common/Types/Monitor/MonitorStepHostMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import {
  getGlobalTranslator,
  TemplateValues,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  SERVICE_NAME_ATTR,
  WINDOWS_SERVICE_METRIC_NAME,
} from "../Pages/Host/Utils/WindowsServices";
import {
  SYSTEMD_UNIT_ACTIVE_STATE_ATTR,
  SYSTEMD_UNIT_NAME_ATTR,
  SYSTEMD_UNIT_STATE_METRIC_NAME,
} from "../Pages/Host/Utils/SystemdUnits";
import { MonitorSeedIds } from "./MonitorSeedIds";
import PageMap from "./PageMap";
import { RouteUtil } from "./RouteMap";

/*
 * MONITOR CREATE, OPENED FROM A SERVICE ON A HOST (#10296).
 *
 * A host's Windows service page and its systemd unit page link to Monitor
 * Create with the host's id and the service's name
 * (getHostServiceMonitorRoute). This reads that link and builds the monitor
 * from it: a Host monitor of that host - the worker reads only its metrics,
 * and the host stays bound by its id through a rename
 * (InfrastructureResourceBinding) - whose one query reads the state the host's
 * collector reports for that one service, by its name.
 *
 * The state, and what "running" is:
 *
 *   Windows  windows.service.status, one gauge per service with its `name`.
 *            The value is the Service Control Manager's state:
 *            1 Stopped, 2 Start Pending, 3 Stop Pending, 4 Running,
 *            5 Continue Pending, 6 Pause Pending, 7 Paused. Running is 4,
 *            in the middle, so no "greater than" or "less than" says "not
 *            running": every other state is below 4 or above it, and
 *            "Not Equal To 4" says it (#10449).
 *   systemd  systemd.unit.state, a state set: one point per active_state per
 *            scrape, 1 on the state the unit is in and 0 on the rest. Read
 *            on active_state "active", it is 1 while the unit is active and
 *            0 in every other state (inactive, failed, activating...).
 *
 * The query reads each minute's highest value. A minute is "running" when
 * the service ran in it and was in no state above Running (on Windows, the
 * pause states), so a service that stops is acted on after a whole minute
 * of not running, and one that starts again is seen in the minute it did.
 *
 * The criteria, in the order they are checked - only the first one that
 * matches acts (an ungrouped monitor):
 *
 *   1. Running: the service was running in a minute of the time range
 *      (Equal To, Any Value) - online.
 *   2. Not running: it was not, in any minute (every other state: Not Equal
 *      To the running value, Any Value) - offline, and an incident. Checked
 *      after 1, so it is reached only when no minute of the time range had
 *      the service running: "not running for the whole time range", as
 *      OneUptime's sustained criteria read, and a restart that is over
 *      within the time range opens nothing. Before the criteria form offered
 *      Not Equal To for a metric (#10449) this was two filters, either of
 *      which matched - below Running, or above it - which matched exactly
 *      the same minutes; a monitor saved then keeps them.
 *   3. Stopped reporting: no state arrived in the whole time range (Has No
 *      Data) - offline, and an incident of its own. The service was removed
 *      or renamed, or excluded from the collector's services, or the host
 *      or its collector stopped sending. Either way nothing can say the
 *      service runs, and a monitor that stayed green would be the one lie
 *      it must not tell; an infrastructure monitor's own default is this
 *      rule. Its own incident says what happened, instead of a "not
 *      running" the monitor cannot know.
 *
 * With data, 1 or 2 always matches; without, 3 does: the monitor never falls
 * to "no criteria met". The two that open incidents use the project's most
 * severe incident severity and resolve themselves, as a new monitor's
 * default offline criteria do; their alerts are filled in and switched off.
 * Everything can be changed in the form before it is saved.
 *
 * Pure: everything it needs is handed in, so every rule is pinned by tests
 * without mounting the page.
 */

export enum HostServiceKind {
  WindowsService = "WindowsService",
  SystemdUnit = "SystemdUnit",
}

// The query parameters the link carries.
export const HOST_SERVICE_MONITOR_QUERY_PARAMS: {
  hostId: string;
  windowsService: string;
  systemdUnit: string;
} = {
  hostId: "hostId",
  windowsService: "windowsService",
  systemdUnit: "systemdUnit",
};

// A Windows service's name and a systemd unit's are at most 256 characters.
export const MAX_HOST_SERVICE_NAME_LENGTH: number = 256;

// How far back each check looks: OneUptime's sustained window for "down".
export const HOST_SERVICE_MONITOR_ROLLING_TIME: RollingTime =
  RollingTime.Past5Minutes;

/*
 * What a service's state is on each kind of host: the metric, the attribute
 * that names the service (as ingest stores it), what the query narrows the
 * metric to besides, and the value that says it is running. Any other value
 * says it is not (Not Equal To it).
 */
export interface HostServiceStateDefinition {
  metricName: string;
  nameAttribute: string;
  stateAttributes: Record<string, string>;
  runningValue: number;
  // The query's variable, which the criteria compare.
  metricAlias: string;
}

export const HOST_SERVICE_STATES: Record<
  HostServiceKind,
  HostServiceStateDefinition
> = {
  [HostServiceKind.WindowsService]: {
    metricName: WINDOWS_SERVICE_METRIC_NAME,
    nameAttribute: SERVICE_NAME_ATTR,
    stateAttributes: {},
    // SERVICE_RUNNING; every other state is below it (1-3) or above it (5-7).
    runningValue: 4,
    metricAlias: "service_status",
  },
  [HostServiceKind.SystemdUnit]: {
    metricName: SYSTEMD_UNIT_STATE_METRIC_NAME,
    nameAttribute: SYSTEMD_UNIT_NAME_ATTR,
    stateAttributes: { [SYSTEMD_UNIT_ACTIVE_STATE_ATTR]: "active" },
    // 1 while the unit is active, 0 in every other state.
    runningValue: 1,
    metricAlias: "unit_active",
  },
};

// The monitor's name, for either kind.
export const HOST_SERVICE_MONITOR_NAME: string = translationKey(
  "{{serviceName}} on {{hostName}}",
);

/*
 * The words of the monitor and its criteria, in the language of the person
 * creating it. A service's name goes only into titles and names, which are
 * plain text: never into an incident's description, which is drawn as
 * Markdown.
 */
export interface HostServiceMonitorWords {
  monitorDescription: string;
  running: string;
  runningDescription: string;
  notRunning: string;
  notRunningDescription: string;
  notRunningIncident: string;
  notReporting: string;
  notReportingDescription: string;
  notReportingIncident: string;
}

export const HOST_SERVICE_MONITOR_WORDS: Record<
  HostServiceKind,
  HostServiceMonitorWords
> = {
  [HostServiceKind.WindowsService]: {
    monitorDescription: translationKey(
      "Opens an incident when the Windows service {{serviceName}} on {{hostName}} is not running, or when its status stops arriving.",
    ),
    running: translationKey("{{serviceName}} is running on {{hostName}}"),
    runningDescription: translationKey(
      "Reported Running (status 4) at least once in the time range.",
    ),
    notRunning: translationKey(
      "{{serviceName}} is not running on {{hostName}}",
    ),
    notRunningDescription: translationKey(
      "Never reported Running in the time range: it was stopped, paused, or stuck starting or stopping.",
    ),
    notRunningIncident: translationKey(
      "This Windows service has not been running for the whole time range. Check it with Get-Service or in the Services console, read the System event log for why it stopped, and start it again. The incident resolves on its own once it runs.",
    ),
    notReporting: translationKey(
      "{{serviceName}} stopped reporting on {{hostName}}",
    ),
    notReportingDescription: translationKey(
      "No status arrived in the time range: the service was removed or renamed, or the host or its collector stopped sending.",
    ),
    notReportingIncident: translationKey(
      "OneUptime received no status for this Windows service for the whole time range. It was removed or renamed on the host, or the host or its OpenTelemetry Collector stopped sending: if the host's other pages are quiet too, start with the host. The incident resolves on its own once its status arrives again.",
    ),
  },
  [HostServiceKind.SystemdUnit]: {
    monitorDescription: translationKey(
      "Opens an incident when the systemd unit {{unitName}} on {{hostName}} is not active, or when its state stops arriving.",
    ),
    running: translationKey("{{unitName}} is active on {{hostName}}"),
    runningDescription: translationKey(
      "Reported active at least once in the time range.",
    ),
    notRunning: translationKey("{{unitName}} is not active on {{hostName}}"),
    notRunningDescription: translationKey(
      "Never reported active in the time range: it was inactive, failed, or stuck activating or deactivating.",
    ),
    notRunningIncident: translationKey(
      "This systemd unit has not been active for the whole time range. On the host, systemctl status and journalctl -u with its name say why; start it again with systemctl start. The incident resolves on its own once it is active.",
    ),
    notReporting: translationKey(
      "{{unitName}} stopped reporting on {{hostName}}",
    ),
    notReportingDescription: translationKey(
      "No state arrived in the time range: the unit was removed or renamed, or the host or its collector stopped sending.",
    ),
    notReportingIncident: translationKey(
      "OneUptime received no state for this systemd unit for the whole time range. It was removed or renamed on the host, or the host or its OpenTelemetry Collector stopped sending: if the host's other pages are quiet too, start with the host. The incident resolves on its own once its state arrives again.",
    ),
  },
};

// Why Monitor Create shows no form for a link it cannot read.
export const HOST_SERVICE_MONITOR_LINK_ERROR: string = translationKey(
  "This link does not point to a service on a host. Open the service's page again and choose Create Monitor.",
);

export const HOST_SERVICE_MONITOR_HOST_GONE_ERROR: string = translationKey(
  "The host this monitor was to be created for no longer exists.",
);

export interface HostServiceMonitorLink {
  hostId: string;
  kind: HostServiceKind;
  // As the host's collector reports it: the metric is matched on it exactly.
  serviceName: string;
}

// What the builders need of the host.
export interface HostServiceMonitorHost {
  id?: string | undefined;
  // Its host.name, as its metrics carry it.
  hostIdentifier: string;
  // The name it is shown by; its identifier when it has none.
  name?: string | undefined;
}

// Monitor Create, opened on a monitor of this service on this host.
export function getHostServiceMonitorRoute(
  link: HostServiceMonitorLink,
): Route {
  return RouteUtil.getPageRoute(PageMap.MONITOR_CREATE, {
    query: {
      [HOST_SERVICE_MONITOR_QUERY_PARAMS.hostId]: link.hostId,
      [link.kind === HostServiceKind.WindowsService
        ? HOST_SERVICE_MONITOR_QUERY_PARAMS.windowsService
        : HOST_SERVICE_MONITOR_QUERY_PARAMS.systemdUnit]: link.serviceName,
    },
  });
}

// Whether Monitor Create was opened from a service's page at all.
export function isHostServiceMonitorAddress(
  getParam: (name: string) => string | null,
): boolean {
  return Object.values(HOST_SERVICE_MONITOR_QUERY_PARAMS).some(
    (name: string): boolean => {
      return getParam(name) !== null;
    },
  );
}

/*
 * The link's service, or null when the address is not one: a host id, and
 * exactly one service - a Windows service or a systemd unit. The name is
 * kept as written, spaces and case included: the metric is matched on it
 * exactly.
 */
export function readHostServiceMonitorLink(
  getParam: (name: string) => string | null,
): HostServiceMonitorLink | null {
  const hostId: string = (
    getParam(HOST_SERVICE_MONITOR_QUERY_PARAMS.hostId) || ""
  ).trim();

  if (!ObjectID.isValidUUID(hostId)) {
    return null;
  }

  const windowsService: string =
    getParam(HOST_SERVICE_MONITOR_QUERY_PARAMS.windowsService) || "";
  const systemdUnit: string =
    getParam(HOST_SERVICE_MONITOR_QUERY_PARAMS.systemdUnit) || "";

  if (Boolean(windowsService.trim()) === Boolean(systemdUnit.trim())) {
    return null;
  }

  const serviceName: string = windowsService.trim()
    ? windowsService
    : systemdUnit;

  if (serviceName.length > MAX_HOST_SERVICE_NAME_LENGTH) {
    return null;
  }

  return {
    hostId: hostId,
    kind: windowsService.trim()
      ? HostServiceKind.WindowsService
      : HostServiceKind.SystemdUnit,
    serviceName: serviceName,
  };
}

// The host's name as the monitor names it.
export function getHostServiceMonitorHostName(
  host: HostServiceMonitorHost,
): string {
  return (host.name || "").trim() || host.hostIdentifier.trim();
}

/*
 * The step: the host, bound by its id, and one query - the service's state,
 * each minute's highest value, over the past five minutes.
 */
export function buildHostServiceMonitorStep(data: {
  kind: HostServiceKind;
  serviceName: string;
  host: HostServiceMonitorHost;
}): MonitorStepHostMonitor {
  const state: HostServiceStateDefinition = HOST_SERVICE_STATES[data.kind];

  const hostMonitor: MonitorStepHostMonitor = buildHostMonitorConfig({
    hostIdentifier: data.host.hostIdentifier,
    metricName: state.metricName,
    metricAlias: state.metricAlias,
    rollingTime: HOST_SERVICE_MONITOR_ROLLING_TIME,
    aggregationType: MetricsAggregationType.Max,
    attributes: {
      [state.nameAttribute]: data.serviceName,
      ...state.stateAttributes,
    },
  });

  if (data.host.id && ObjectID.isValidUUID(data.host.id)) {
    hostMonitor.resourceId = data.host.id;
  }

  return hostMonitor;
}

// One comparison of the service's state, read over its time range.
function stateFilter(data: {
  state: HostServiceStateDefinition;
  filterType: FilterType;
}): CriteriaFilter {
  return {
    checkOn: CheckOn.MetricValue,
    filterType: data.filterType,
    value:
      FilterType.IsEmpty === data.filterType
        ? undefined
        : data.state.runningValue,
    metricMonitorOptions: {
      metricAlias: data.state.metricAlias,
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    },
  };
}

function wordsOf(data: {
  kind: HostServiceKind;
  serviceName: string;
  hostName: string;
  translator: Translator;
}): HostServiceMonitorWords & { monitorName: string } {
  const words: HostServiceMonitorWords = HOST_SERVICE_MONITOR_WORDS[data.kind];
  const values: TemplateValues = {
    serviceName: data.serviceName,
    unitName: data.serviceName,
    hostName: data.hostName,
  };

  const filled: (template: string) => string = (template: string): string => {
    return data.translator.translateTemplate(template, values);
  };

  return {
    monitorName: filled(HOST_SERVICE_MONITOR_NAME),
    monitorDescription: filled(words.monitorDescription),
    running: filled(words.running),
    runningDescription: filled(words.runningDescription),
    notRunning: filled(words.notRunning),
    notRunningDescription: filled(words.notRunningDescription),
    notRunningIncident: filled(words.notRunningIncident),
    notReporting: filled(words.notReporting),
    notReportingDescription: filled(words.notReportingDescription),
    notReportingIncident: filled(words.notReportingIncident),
  };
}

/*
 * A criteria that takes the monitor offline and opens an incident that
 * resolves itself, with the alert filled in and switched off: a new
 * monitor's default offline criteria. A project missing a status or a
 * severity gets a criteria that leaves that part off rather than one that
 * cannot be saved.
 */
function offlineCriteria(data: {
  filters: Array<CriteriaFilter>;
  name: string;
  description: string;
  incidentDescription: string;
  seeds: MonitorSeedIds;
}): MonitorCriteriaInstance {
  const incidentSeverityId: ObjectID | null =
    data.seeds.rankedIncidentSeverityIds[0] || null;
  const alertSeverityId: ObjectID | null =
    data.seeds.rankedAlertSeverityIds[0] || null;

  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.seeds.offlineMonitorStatusId || undefined,
    filterCondition: FilterCondition.Any,
    filters: data.filters,
    incidents: incidentSeverityId
      ? [
          {
            id: ObjectID.generate().toString(),
            title: data.name,
            description: data.incidentDescription,
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
            title: data.name,
            description: data.incidentDescription,
            alertSeverityId: alertSeverityId,
            autoResolveAlert: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    changeMonitorStatus: Boolean(data.seeds.offlineMonitorStatusId),
    createIncidents: Boolean(incidentSeverityId),
    createAlerts: false,
    isEnabled: true,
    name: data.name,
    description: data.description,
  };

  return instance;
}

export function buildHostServiceMonitorCriteria(data: {
  kind: HostServiceKind;
  serviceName: string;
  hostName: string;
  seeds: MonitorSeedIds;
  translator?: Translator | undefined;
}): MonitorCriteria {
  const state: HostServiceStateDefinition = HOST_SERVICE_STATES[data.kind];
  const words: HostServiceMonitorWords = wordsOf({
    kind: data.kind,
    serviceName: data.serviceName,
    hostName: data.hostName,
    translator: data.translator || getGlobalTranslator(),
  });

  const running: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  running.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.seeds.operationalMonitorStatusId || undefined,
    filterCondition: FilterCondition.Any,
    filters: [stateFilter({ state: state, filterType: FilterType.EqualTo })],
    incidents: [],
    alerts: [],
    changeMonitorStatus: Boolean(data.seeds.operationalMonitorStatusId),
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: words.running,
    description: words.runningDescription,
  };

  const notRunning: MonitorCriteriaInstance = offlineCriteria({
    filters: [stateFilter({ state: state, filterType: FilterType.NotEqualTo })],
    name: words.notRunning,
    description: words.notRunningDescription,
    incidentDescription: words.notRunningIncident,
    seeds: data.seeds,
  });

  const notReporting: MonitorCriteriaInstance = offlineCriteria({
    filters: [stateFilter({ state: state, filterType: FilterType.IsEmpty })],
    name: words.notReporting,
    description: words.notReportingDescription,
    incidentDescription: words.notReportingIncident,
    seeds: data.seeds,
  });

  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = {
    // Running first: the order is part of the rule (see the top of the file).
    monitorCriteriaInstanceArray: [running, notRunning, notReporting],
  };

  return criteria;
}

// Monitor.name is a ShortText column.
function clampMonitorName(name: string): string {
  const characters: Array<string> = Array.from(name.trim());

  return characters.length > ColumnLength.ShortText
    ? characters.slice(0, ColumnLength.ShortText).join("").trim()
    : name.trim();
}

/*
 * Monitor Create's initial values for the link: a Host monitor of the host
 * that watches the service. Null when the host has no host name to read
 * its metrics by.
 */
export function buildHostServiceMonitorPrefill(data: {
  link: HostServiceMonitorLink;
  host: HostServiceMonitorHost;
  seeds: MonitorSeedIds;
  translator?: Translator | undefined;
}): JSONObject | null {
  if (!data.host.hostIdentifier.trim() || !data.link.serviceName.trim()) {
    return null;
  }

  const translator: Translator = data.translator || getGlobalTranslator();
  const monitorSteps: MonitorSteps = new MonitorSteps();
  const step: MonitorStep | undefined =
    monitorSteps.data?.monitorStepsInstanceArray[0];

  if (!step?.data) {
    return null;
  }

  const hostName: string = getHostServiceMonitorHostName(data.host);

  step.setHostMonitor(
    buildHostServiceMonitorStep({
      kind: data.link.kind,
      serviceName: data.link.serviceName,
      host: { ...data.host, id: data.host.id || data.link.hostId },
    }),
  );

  step.setMonitorCriteria(
    buildHostServiceMonitorCriteria({
      kind: data.link.kind,
      serviceName: data.link.serviceName,
      hostName: hostName,
      seeds: data.seeds,
      translator: translator,
    }),
  );

  /*
   * A prefilled MonitorSteps must carry its default status itself: the steps
   * form only fills it in when it bootstraps WITHOUT an initial value.
   */
  if (data.seeds.operationalMonitorStatusId) {
    monitorSteps.setDefaultMonitorStatusId(
      data.seeds.operationalMonitorStatusId,
    );
  }

  const words: HostServiceMonitorWords & { monitorName: string } = wordsOf({
    kind: data.link.kind,
    serviceName: data.link.serviceName,
    hostName: hostName,
    translator: translator,
  });

  return {
    name: clampMonitorName(words.monitorName),
    description: words.monitorDescription,
    monitorType: MonitorType.Host,
    monitorSteps: monitorSteps.toJSON(),
  };
}
