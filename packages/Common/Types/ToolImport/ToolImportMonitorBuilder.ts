import HTTPMethod from "../API/HTTPMethod";
import Hostname from "../API/Hostname";
import URL from "../API/URL";
import FilterCondition from "../Filter/FilterCondition";
import IP from "../IP/IP";
import { CriteriaAlert } from "../Monitor/CriteriaAlert";
import { CheckOn, CriteriaFilter, FilterType } from "../Monitor/CriteriaFilter";
import { CriteriaIncident } from "../Monitor/CriteriaIncident";
import DnsRecordType from "../Monitor/DnsMonitor/DnsRecordType";
import MonitorCriteria from "../Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../Monitor/MonitorCriteriaInstance";
import MonitorStep from "../Monitor/MonitorStep";
import { MonitorStepDnsMonitorUtil } from "../Monitor/MonitorStepDnsMonitor";
import MonitorSteps from "../Monitor/MonitorSteps";
import MonitorType, { MonitorTypeHelper } from "../Monitor/MonitorType";
import ObjectID from "../ObjectID";
import Port from "../Port";
import MonitorDestinationUtil, {
  ParsedMonitorDestination,
} from "../../Utils/Monitor/MonitorDestinationUtil";
import {
  isDefaultStatusCodeRanges,
  LOWEST_STATUS_CODE,
  TOOL_IMPORT_MAX_TIMEOUT_SECONDS,
  toHeartbeatMinutes,
  toMonitoringInterval,
} from "./ToolImportMonitorRules";
import {
  ImportedKeyword,
  ImportedMonitor,
  ImportedStatusCodeRange,
} from "./ToolImportSnapshot";

/*
 * WHAT A MONITOR OF AN UPTIME TOOL BECOMES IN ONEUPTIME.
 *
 * The import creates each monitor the way the Create Monitor form would:
 * the same monitor type, the project's own statuses and severities, and the
 * form's default criteria for that type - "offline" opens an incident and
 * changes the monitor's status, "online" puts it back, an SSL certificate
 * monitor warns before its certificate expires. Only what the tool set
 * differently is changed: the status codes that count as up, the keyword a
 * page must (or must not) contain, how long a heartbeat may stay silent,
 * how many days ahead a certificate warning comes. So an imported monitor
 * reads like a hand-made one, and says "up" when the tool said "up".
 *
 * Pure: the applier hands it the project's statuses and severities, and
 * the tests hold every monitor type it builds to MonitorStep's own
 * validation.
 */

// A DNS name may end in the root's dot ("example.com.").
const TRAILING_DOT: RegExp = /\.$/;

// The project's statuses and severities, picked as the Create Monitor form picks them.
export interface ToolImportMonitorDefaults {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  // The project's "warning" alert severity, for expiry warnings.
  warningAlertSeverityId?: ObjectID | undefined;
}

export interface ToolImportBuiltMonitor {
  monitorType: MonitorType;
  // None for a Manual monitor: it has no checks.
  monitorSteps?: MonitorSteps | undefined;
  // A cron expression, for the monitor types probes check.
  monitoringInterval?: string | undefined;
}

/*
 * The monitor types an import creates. Anything else an adapter met has no
 * monitorType, and the preview names it as not brought over.
 */
export const TOOL_IMPORT_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.Ping,
  MonitorType.Port,
  MonitorType.SSLCertificate,
  MonitorType.DNS,
  MonitorType.IncomingRequest,
  MonitorType.Manual,
];

// The monitor types whose destination is a URL, a host, or a name to look up.
const NEEDS_DESTINATION: ReadonlyArray<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.Ping,
  MonitorType.Port,
  MonitorType.SSLCertificate,
  MonitorType.DNS,
];

/*
 * Why a monitor cannot be built, in the address's own words, or null when
 * it can: what the planner checks before it offers a monitor, so the
 * import never fails on an address the preview called fine.
 */
export function getToolImportMonitorProblem(
  monitor: ImportedMonitor,
): "type" | "address" | null {
  if (!monitor.monitorType) {
    return "type";
  }

  if (!TOOL_IMPORT_MONITOR_TYPES.includes(monitor.monitorType)) {
    return "type";
  }

  if (!NEEDS_DESTINATION.includes(monitor.monitorType)) {
    return null;
  }

  if (!monitor.destination || !monitor.destination.trim()) {
    return "address";
  }

  if (monitor.monitorType === MonitorType.DNS) {
    return isLookupName(monitor.destination) ? null : "address";
  }

  if (monitor.monitorType === MonitorType.Port && !isPort(monitor.port)) {
    return "address";
  }

  const parsed: ParsedMonitorDestination = MonitorDestinationUtil.parse({
    value: monitor.destination,
    monitorType: monitor.monitorType,
  });

  if (parsed.error || !parsed.destination) {
    return "address";
  }

  // Probes check web addresses over http and https only.
  if (parsed.destination instanceof URL) {
    const protocol: string = monitor.destination.trim().toLowerCase();

    if (!protocol.startsWith("http://") && !protocol.startsWith("https://")) {
      return "address";
    }
  }

  return null;
}

/*
 * What a monitor checks, written one way for every tool and for the
 * project's own monitors, so the same check is recognised wherever it was
 * made: the URL as URL writes it, a host lowercased (with its port, for a
 * Port monitor), a DNS name with its record type. Null for a monitor that
 * checks no address (a heartbeat, a manual monitor).
 */
export function getToolImportMonitorMatchKey(data: {
  monitorType: MonitorType | string | null;
  destination?: string | undefined;
  port?: number | undefined;
  dnsRecordType?: DnsRecordType | string | undefined;
}): string | null {
  const destination: string = (data.destination || "").trim();

  if (!data.monitorType || !destination) {
    return null;
  }

  switch (data.monitorType) {
    case MonitorType.Website:
    case MonitorType.API:
    case MonitorType.SSLCertificate: {
      try {
        return URL.fromString(
          MonitorDestinationUtil.toUrlWithBracketedIpv6Host(destination),
        )
          .toString()
          .toLowerCase();
      } catch {
        return destination.toLowerCase();
      }
    }
    case MonitorType.Port:
      return `${destination.toLowerCase()}:${data.port ?? ""}`;
    case MonitorType.DNS:
      return `${destination.toLowerCase().replace(TRAILING_DOT, "")} ${
        data.dnsRecordType || DnsRecordType.A
      }`;
    default:
      return destination.toLowerCase();
  }
}

const LOOKUP_NAME: RegExp =
  /^(?=.{1,253}$)([A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?\.)*[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?\.?$/;

function isLookupName(value: string): boolean {
  return LOOKUP_NAME.test(value.trim());
}

function isPort(value: number | undefined): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
  );
}

/*
 * The monitor, ready for MonitorService.create: its type, its steps with
 * their criteria, and how often probes check it. Throws when the monitor
 * cannot be built - getToolImportMonitorProblem says when beforehand.
 */
export function buildToolImportMonitor(data: {
  monitor: ImportedMonitor;
  defaults: ToolImportMonitorDefaults;
}): ToolImportBuiltMonitor {
  const monitor: ImportedMonitor = data.monitor;
  const problem: "type" | "address" | null =
    getToolImportMonitorProblem(monitor);

  if (problem) {
    throw new Error(
      problem === "type"
        ? `OneUptime has no monitor for ${monitor.sourceType} checks.`
        : `OneUptime cannot read the address ${monitor.destination || ""}.`,
    );
  }

  const monitorType: MonitorType = monitor.monitorType!;

  if (monitorType === MonitorType.Manual) {
    return { monitorType: monitorType };
  }

  const name: string = monitor.name;

  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: name,
    monitorType: monitorType,
    onlineMonitorStatusId: data.defaults.onlineMonitorStatusId,
    offlineMonitorStatusId: data.defaults.offlineMonitorStatusId,
    defaultIncidentSeverityId: data.defaults.defaultIncidentSeverityId,
    defaultAlertSeverityId: data.defaults.defaultAlertSeverityId,
    warningAlertSeverityId: data.defaults.warningAlertSeverityId,
  });

  applyDestination(step, monitor, monitorType);
  applyRequest(step, monitor, monitorType);

  if (monitor.timeoutSeconds && monitor.timeoutSeconds > 0) {
    step.setRequestTimeoutInMs(
      Math.round(
        Math.min(monitor.timeoutSeconds, TOOL_IMPORT_MAX_TIMEOUT_SECONDS) *
          1000,
      ),
    );
  }

  const criteria: MonitorCriteria | null = buildCriteria({
    monitor: monitor,
    monitorType: monitorType,
    defaults: data.defaults,
    defaultCriteria: step.data!.monitorCriteria,
  });

  if (criteria) {
    step.setMonitorCriteria(criteria);
  }

  const problemOfStep: string | null = MonitorStep.getValidationError(
    step,
    monitorType,
  );

  if (problemOfStep) {
    throw new Error(problemOfStep);
  }

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: data.defaults.onlineMonitorStatusId,
  };

  return {
    monitorType: monitorType,
    monitorSteps: steps,
    monitoringInterval: MonitorTypeHelper.isProbableMonitor(monitorType)
      ? toMonitoringInterval(monitor.intervalSeconds).cron
      : undefined,
  };
}

function applyDestination(
  step: MonitorStep,
  monitor: ImportedMonitor,
  monitorType: MonitorType,
): void {
  if (monitorType === MonitorType.DNS) {
    step.setDnsMonitor({
      ...MonitorStepDnsMonitorUtil.getDefault(),
      queryName: monitor.destination!.trim().replace(TRAILING_DOT, ""),
      recordType: monitor.dnsRecordType || DnsRecordType.A,
      hostname: monitor.dnsServer || "",
    });
    return;
  }

  if (!NEEDS_DESTINATION.includes(monitorType)) {
    return;
  }

  const parsed: ParsedMonitorDestination = MonitorDestinationUtil.parse({
    value: monitor.destination!,
    monitorType: monitorType,
  });

  step.setMonitorDestination(
    parsed.destination as URL | IP | Hostname | undefined,
  );

  if (monitorType === MonitorType.Port) {
    step.setPort(new Port(monitor.port!));
  }
}

function applyRequest(
  step: MonitorStep,
  monitor: ImportedMonitor,
  monitorType: MonitorType,
): void {
  if (monitorType !== MonitorType.Website && monitorType !== MonitorType.API) {
    return;
  }

  /*
   * A Website monitor sends GET, or HEAD when the tool did; an API monitor
   * whatever the tool sent, with its headers and body.
   */
  const method: HTTPMethod = monitor.httpMethod || HTTPMethod.GET;

  step.setRequestType(
    monitorType === MonitorType.Website && method !== HTTPMethod.HEAD
      ? HTTPMethod.GET
      : method,
  );

  if (monitorType === MonitorType.API) {
    if (
      monitor.requestHeaders &&
      Object.keys(monitor.requestHeaders).length > 0
    ) {
      step.setRequestHeaders({ ...monitor.requestHeaders });
    }

    if (monitor.requestBody) {
      step.setRequestBody(monitor.requestBody);
    }
  }

  if (monitor.followRedirects === false) {
    step.setDoNotFollowRedirects(true);
  }
}

/*
 * The criteria, when the tool set something the defaults do not say;
 * null keeps the defaults the step was made with.
 */
function buildCriteria(data: {
  monitor: ImportedMonitor;
  monitorType: MonitorType;
  defaults: ToolImportMonitorDefaults;
  defaultCriteria: MonitorCriteria;
}): MonitorCriteria | null {
  switch (data.monitorType) {
    case MonitorType.Website:
    case MonitorType.API:
      return buildHttpCriteria(data);
    case MonitorType.IncomingRequest:
      return buildHeartbeatCriteria(data);
    case MonitorType.SSLCertificate:
      return withCertificateWarningDays(data);
    default:
      return null;
  }
}

function onlineCriteria(data: {
  name: string;
  description: string;
  monitorStatusId: ObjectID;
  filters: Array<CriteriaFilter>;
}): MonitorCriteriaInstance {
  const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  criteria.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.monitorStatusId,
    filterCondition: FilterCondition.All,
    filters: data.filters,
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    name: data.name,
    description: data.description,
  };

  return criteria;
}

function offlineCriteria(data: {
  monitorName: string;
  name: string;
  description: string;
  incidentDescription: string;
  defaults: ToolImportMonitorDefaults;
  filters: Array<CriteriaFilter>;
}): MonitorCriteriaInstance {
  const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  const incident: CriteriaIncident = {
    title: `${data.monitorName} is offline`,
    description: data.incidentDescription,
    incidentSeverityId: data.defaults.defaultIncidentSeverityId,
    autoResolveIncident: true,
    id: ObjectID.generate().toString(),
    onCallPolicyIds: [],
  };

  const alert: CriteriaAlert = {
    title: `${data.monitorName} is offline`,
    description: data.incidentDescription,
    alertSeverityId: data.defaults.defaultAlertSeverityId,
    autoResolveAlert: true,
    id: ObjectID.generate().toString(),
    onCallPolicyIds: [],
  };

  criteria.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.defaults.offlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: data.filters,
    incidents: [incident],
    alerts: [alert],
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: false,
    name: data.name,
    description: data.description,
  };

  return criteria;
}

function keywordFilters(keyword: ImportedKeyword | undefined): {
  online: Array<CriteriaFilter>;
  offline: Array<CriteriaFilter>;
} {
  if (!keyword || !keyword.value) {
    return { online: [], offline: [] };
  }

  return {
    online: [
      {
        checkOn: CheckOn.ResponseBody,
        filterType: keyword.isPresent
          ? FilterType.Contains
          : FilterType.NotContains,
        value: keyword.value,
      },
    ],
    offline: [
      {
        checkOn: CheckOn.ResponseBody,
        filterType: keyword.isPresent
          ? FilterType.NotContains
          : FilterType.Contains,
        value: keyword.value,
      },
    ],
  };
}

function statusCodeFilters(
  range: ImportedStatusCodeRange,
): Array<CriteriaFilter> {
  return [
    {
      checkOn: CheckOn.ResponseStatusCode,
      filterType: FilterType.GreaterThanOrEqualTo,
      value: range.from,
    },
    {
      checkOn: CheckOn.ResponseStatusCode,
      filterType: FilterType.LessThan,
      value: range.to + 1,
    },
  ];
}

function describeRange(range: ImportedStatusCodeRange): string {
  return range.from === range.to
    ? `${range.from}`
    : `${range.from} to ${range.to}`;
}

/*
 * Website and API monitors. Up is "answers, with a status code that counts
 * as up, and (with a keyword) the keyword where it should be"; down is
 * everything else.
 *
 *  - The usual codes (every 2xx and 3xx) and no keyword: the defaults, as
 *    the Create Monitor form makes them.
 *  - One range of codes: offline first, as the defaults are - not
 *    answering, a code below or above the range, or the keyword where it
 *    should not be - then online.
 *  - Several ranges (200 to 299 and 401, say): one online criteria per
 *    range, then one offline criteria for everything else. Only the first
 *    criteria that matches is acted on, so the online ones come first; the
 *    offline one then needs only "not answering, or answering at all".
 */
function buildHttpCriteria(data: {
  monitor: ImportedMonitor;
  defaults: ToolImportMonitorDefaults;
}): MonitorCriteria | null {
  const monitor: ImportedMonitor = data.monitor;
  const keyword: {
    online: Array<CriteriaFilter>;
    offline: Array<CriteriaFilter>;
  } = keywordFilters(monitor.keyword);
  const hasKeyword: boolean = keyword.online.length > 0;
  const ranges: Array<ImportedStatusCodeRange> =
    monitor.acceptedStatusCodes && monitor.acceptedStatusCodes.length > 0
      ? monitor.acceptedStatusCodes
      : [{ from: 200, to: 399 }];

  if (isDefaultStatusCodeRanges(ranges) && !hasKeyword) {
    return null;
  }

  const name: string = monitor.name;
  const keywordWords: string = hasKeyword
    ? monitor.keyword!.isPresent
      ? `, and the page contains "${monitor.keyword!.value}"`
      : `, and the page does not contain "${monitor.keyword!.value}"`
    : "";

  const criteria: MonitorCriteria = new MonitorCriteria();

  if (ranges.length === 1) {
    const range: ImportedStatusCodeRange = ranges[0]!;

    criteria.data = {
      monitorCriteriaInstanceArray: [
        offlineCriteria({
          monitorName: name,
          name: `Check if ${name} is offline`,
          description: `${name} is offline when it does not answer, answers with a status code outside ${describeRange(range)}${
            hasKeyword
              ? monitor.keyword!.isPresent
                ? `, or the page does not contain "${monitor.keyword!.value}"`
                : `, or the page contains "${monitor.keyword!.value}"`
              : ""
          }`,
          incidentDescription: `${name} is not responding, or is not responding the way it should.`,
          defaults: data.defaults,
          filters: [
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.False,
              value: undefined,
            },
            {
              checkOn: CheckOn.ResponseStatusCode,
              filterType: FilterType.LessThan,
              value: range.from,
            },
            {
              checkOn: CheckOn.ResponseStatusCode,
              filterType: FilterType.GreaterThan,
              value: range.to,
            },
            ...keyword.offline,
          ],
        }),
        onlineCriteria({
          name: `Check if ${name} is online`,
          description: `${name} is online when it answers with a status code from ${describeRange(range)}${keywordWords}`,
          monitorStatusId: data.defaults.onlineMonitorStatusId,
          filters: [
            {
              checkOn: CheckOn.IsOnline,
              filterType: FilterType.True,
              value: undefined,
            },
            ...statusCodeFilters(range),
            ...keyword.online,
          ],
        }),
      ],
    };

    return criteria;
  }

  criteria.data = {
    monitorCriteriaInstanceArray: [
      ...ranges.map(
        (range: ImportedStatusCodeRange): MonitorCriteriaInstance => {
          return onlineCriteria({
            name: `Check if ${name} is online (${describeRange(range)})`,
            description: `${name} is online when it answers with a status code from ${describeRange(range)}${keywordWords}`,
            monitorStatusId: data.defaults.onlineMonitorStatusId,
            filters: [
              {
                checkOn: CheckOn.IsOnline,
                filterType: FilterType.True,
                value: undefined,
              },
              ...statusCodeFilters(range),
              ...keyword.online,
            ],
          });
        },
      ),
      offlineCriteria({
        monitorName: name,
        name: `Check if ${name} is offline`,
        description: `${name} is offline when it does not answer, or answers in a way the criteria above do not count as online`,
        incidentDescription: `${name} is not responding, or is not responding the way it should.`,
        defaults: data.defaults,
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            value: undefined,
          },
          // Any answer at all: the lowest status code there is.
          {
            checkOn: CheckOn.ResponseStatusCode,
            filterType: FilterType.GreaterThanOrEqualTo,
            value: LOWEST_STATUS_CODE,
          },
        ],
      }),
    ],
  };

  return criteria;
}

/*
 * A heartbeat: a job pings the monitor's address, and the monitor is down
 * once no ping has come for the time the tool allowed. The defaults for an
 * Incoming Request monitor look for "error" in what is sent instead, which
 * is not what a heartbeat means.
 */
function buildHeartbeatCriteria(data: {
  monitor: ImportedMonitor;
  defaults: ToolImportMonitorDefaults;
}): MonitorCriteria {
  const name: string = data.monitor.name;
  const minutes: number = toHeartbeatMinutes(
    data.monitor.heartbeatTimeoutSeconds ||
      data.monitor.intervalSeconds ||
      60 * 60,
  );

  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = {
    monitorCriteriaInstanceArray: [
      offlineCriteria({
        monitorName: name,
        name: `Check if ${name} is offline`,
        description: `${name} is offline when no heartbeat has arrived for ${minutes} minutes`,
        incidentDescription: `No heartbeat from ${name} has arrived for ${minutes} minutes.`,
        defaults: data.defaults,
        filters: [
          {
            checkOn: CheckOn.IncomingRequest,
            filterType: FilterType.NotRecievedInMinutes,
            value: minutes,
          },
        ],
      }),
      onlineCriteria({
        name: `Check if ${name} is online`,
        description: `${name} is online while a heartbeat arrives at least every ${minutes} minutes`,
        monitorStatusId: data.defaults.onlineMonitorStatusId,
        filters: [
          {
            checkOn: CheckOn.IncomingRequest,
            filterType: FilterType.RecievedInMinutes,
            value: minutes,
          },
        ],
      }),
    ],
  };

  return criteria;
}

/*
 * An SSL Certificate monitor's "expires soon" warning, as many days ahead
 * as the tool warned; the rest of the defaults as they are.
 */
function withCertificateWarningDays(data: {
  monitor: ImportedMonitor;
  defaultCriteria: MonitorCriteria;
}): MonitorCriteria | null {
  const days: number | undefined = data.monitor.certificateExpiryWarningDays;

  if (!days || days <= 0 || !Number.isFinite(days)) {
    return null;
  }

  for (const instance of data.defaultCriteria.data
    ?.monitorCriteriaInstanceArray || []) {
    for (const filter of instance.data?.filters || []) {
      if (filter.checkOn === CheckOn.ExpiresInDays) {
        filter.value = Math.round(days);
        instance.data!.description = `This criteria checks if the ${data.monitor.name} SSL certificate is valid but expires in ${Math.round(days)} days or less`;
      }
    }
  }

  return data.defaultCriteria;
}
