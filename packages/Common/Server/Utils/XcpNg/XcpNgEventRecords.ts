import { JSONArray, JSONObject } from "../../../Types/JSON";
import {
  XcpNgMessageDefinition,
  XcpNgMessageObjectType,
  getXcpNgMessageSeverityNumber,
} from "../../../Types/XcpNg/XcpNgMessageCatalog";
import {
  XCP_NG_EVENTS_SCOPE_NAME,
  XcpNgBackupStatus,
  XcpNgEventKind,
  XcpNgEventLogAttribute,
  XcpNgMessageState,
} from "../../../Types/XcpNg/XcpNgPoolEvents";
import {
  XcpNgOpenBackupFailure,
  XcpNgOpenMessage,
  XcpNgPoolBackupRunSummary,
} from "../../../Types/XcpNg/XcpNgPoolEventState";
import { XcpNgPoolMessage } from "../../../Types/XcpNg/XcpNgProbeCollection";
import {
  XCP_NG_ID_ATTRIBUTE,
  XCP_NG_POOL_ID_ATTRIBUTE,
  XCP_NG_POOL_NAME_ATTRIBUTE,
  XCP_NG_SCOPE_ATTRIBUTE,
  XEN_ORCHESTRA_NAME_ATTRIBUTE,
  XcpNgDerivedSeries,
  XcpNgLabel,
  XcpNgScope,
} from "../../../Types/XcpNg/XcpNgTelemetry";
import { XcpNgAlarmReading } from "../../../Utils/XcpNg/XenOrchestraRest";

/*
 * ------------------------------------------------------------------
 * A pool's events as OpenTelemetry - pure
 * ------------------------------------------------------------------
 *
 * Every XAPI message and every backup run becomes one log record of its
 * pool: the resource carries the pool's UUID (xcp_ng.pool.id), so the
 * record is the pool's in the Logs explorer and on the pool's Logs page,
 * with the pool's retention, and the alert templates of
 * XcpNgEventAlertTemplates find it by its attributes. A message XAPI no
 * longer lists becomes a second record, "cleared", which resolves the
 * alert the first one opened.
 *
 * The HA plan, the VMs whose backup is overdue and each host's missing
 * patches become derived gauges of the pool (XcpNgDerivedSeries), stamped
 * with xcp_ng.scope and xcp_ng.id as every XCP-ng datapoint is, which the
 * XCP-ng monitor's templates read.
 * ------------------------------------------------------------------
 */

/*
 * A record is dated by the event's own time - the pool master's clock for
 * a message, Xen Orchestra's for a backup run - while that is within this
 * of when OneUptime got it; past it (a clock off by hours, a probe catching
 * up after an outage), by when it arrived, so a monitor's window sees it
 * and its alert opens now. The event's own time is kept in the record.
 */
export const XCP_NG_EVENT_TIME_TOLERANCE_MS: number = 10 * 60 * 1000;

// What a message's object is, for its record and its alert's name.
export interface XcpNgEventObject {
  type: XcpNgMessageObjectType;
  uuid: string;
  // Its name in the pool's inventory, else the start of its UUID.
  name: string;
}

// A record's attribute, as OTLP writes one: every value a string.
function attribute(key: string, value: string | number): JSONObject {
  return { key: key, value: { stringValue: String(value) } };
}

function toUnixNano(date: Date): string {
  return `${Math.max(0, date.getTime())}000000`;
}

function getSeverityText(severityNumber: number): string {
  if (severityNumber >= 21) {
    return "FATAL";
  }
  if (severityNumber >= 17) {
    return "ERROR";
  }
  if (severityNumber >= 13) {
    return "WARN";
  }
  return "INFO";
}

// The time a record is dated by: see XCP_NG_EVENT_TIME_TOLERANCE_MS.
export function getXcpNgEventRecordTime(data: {
  eventTime: Date | null;
  observedAt: Date;
}): Date {
  if (!data.eventTime || isNaN(data.eventTime.getTime())) {
    return data.observedAt;
  }
  const skew: number = Math.abs(
    data.observedAt.getTime() - data.eventTime.getTime(),
  );
  return skew <= XCP_NG_EVENT_TIME_TOLERANCE_MS
    ? data.eventTime
    : data.observedAt;
}

// perfmon's variables that it measures as a fraction of a whole.
const FRACTION_VARIABLES: ReadonlySet<string> = new Set<string>([
  "cpu_usage",
  "mem_usage",
  "fs_usage",
  "log_fs_usage",
  "physical_utilisation",
]);

// "cpu_usage reached 95%" - an ALARM in words.
export function describeXcpNgAlarm(alarm: XcpNgAlarmReading): string {
  if (alarm.value === null) {
    return `${alarm.variable} crossed its threshold`;
  }
  if (FRACTION_VARIABLES.has(alarm.variable)) {
    return `${alarm.variable} reached ${Math.round(alarm.value * 1000) / 10}%`;
  }
  return `${alarm.variable} reached ${Math.round(alarm.value * 100) / 100}`;
}

/*
 * What a message says, in one line: what happened, to what, and XAPI's own
 * words when it has some ("VM crashed: web-01 - VM 'web-01' crashed").
 */
export function describeXcpNgMessage(data: {
  definition: XcpNgMessageDefinition;
  object: XcpNgEventObject;
  body: string;
  alarm: XcpNgAlarmReading | null;
}): string {
  const lead: string = `${data.definition.title}: ${data.object.name}`;

  if (data.alarm) {
    return `${lead} - ${describeXcpNgAlarm(data.alarm)}`;
  }

  const body: string = data.body.trim();
  return body ? `${lead} - ${body}` : lead;
}

// One message, raised: the record the alert templates open their alerts on.
export function buildXcpNgMessageLogRecord(data: {
  message: XcpNgPoolMessage;
  definition: XcpNgMessageDefinition;
  object: XcpNgEventObject;
  alarm: XcpNgAlarmReading | null;
  observedAt: Date;
}): JSONObject {
  const eventTime: Date = new Date(data.message.timestamp);
  const severityNumber: number = getXcpNgMessageSeverityNumber(
    data.definition.priority,
  );

  const attributes: JSONArray = [
    attribute(XcpNgEventLogAttribute.Kind, XcpNgEventKind.Message),
    attribute(XcpNgEventLogAttribute.MessageId, data.message.uuid),
    attribute(XcpNgEventLogAttribute.MessageName, data.message.name),
    attribute(XcpNgEventLogAttribute.MessagePriority, data.definition.priority),
    attribute(XcpNgEventLogAttribute.MessageAlert, data.definition.alert),
    attribute(XcpNgEventLogAttribute.MessageState, XcpNgMessageState.Raised),
    attribute(XcpNgEventLogAttribute.ObjectType, data.object.type),
    attribute(XcpNgEventLogAttribute.ObjectUuid, data.object.uuid),
    attribute(XcpNgEventLogAttribute.ObjectName, data.object.name),
    attribute(XcpNgEventLogAttribute.AlarmVariable, data.alarm?.variable || ""),
    attribute("xcp_ng.message.time", data.message.timestamp),
  ];

  if (data.alarm && data.alarm.value !== null) {
    attributes.push(
      attribute(XcpNgEventLogAttribute.AlarmValue, data.alarm.value),
    );
  }

  return {
    timeUnixNano: toUnixNano(
      getXcpNgEventRecordTime({
        eventTime: eventTime,
        observedAt: data.observedAt,
      }),
    ),
    observedTimeUnixNano: toUnixNano(data.observedAt),
    severityNumber: severityNumber,
    severityText: getSeverityText(severityNumber),
    body: {
      stringValue: describeXcpNgMessage({
        definition: data.definition,
        object: data.object,
        body: data.message.body,
        alarm: data.alarm,
      }),
    },
    attributes: attributes,
  };
}

/*
 * The last open message of an alert's group is gone from XAPI: the record
 * that resolves the alert. It carries the group's attributes as the raised
 * record wrote them - the name it was raised under, even if the object was
 * renamed since - so it lands in the alert's own group.
 */
export function buildXcpNgClearedLogRecord(data: {
  open: XcpNgOpenMessage;
  priority: number;
  observedAt: Date;
}): JSONObject {
  return {
    timeUnixNano: toUnixNano(data.observedAt),
    observedTimeUnixNano: toUnixNano(data.observedAt),
    severityNumber: 9,
    severityText: "INFO",
    body: {
      stringValue: `Cleared: ${data.open.name} on ${data.open.objectName} is no longer listed by XCP-ng`,
    },
    attributes: [
      attribute(XcpNgEventLogAttribute.Kind, XcpNgEventKind.Message),
      attribute(XcpNgEventLogAttribute.MessageId, data.open.id),
      attribute(XcpNgEventLogAttribute.MessageName, data.open.name),
      attribute(XcpNgEventLogAttribute.MessagePriority, data.priority),
      attribute(XcpNgEventLogAttribute.MessageAlert, data.open.alert),
      attribute(XcpNgEventLogAttribute.MessageState, XcpNgMessageState.Cleared),
      attribute(XcpNgEventLogAttribute.ObjectType, data.open.objectType),
      attribute(XcpNgEventLogAttribute.ObjectUuid, data.open.objectUuid),
      attribute(XcpNgEventLogAttribute.ObjectName, data.open.objectName),
      attribute(XcpNgEventLogAttribute.AlarmVariable, data.open.variable || ""),
    ],
  };
}

// The VMs that failed, by name, for an attribute: "web-01, db-02 (+3 more)".
export function listXcpNgFailedVmNames(
  summary: XcpNgPoolBackupRunSummary,
  max: number = 5,
): string {
  const names: Array<string> = summary.problemVms
    .filter((vm: { status: XcpNgBackupStatus }): boolean => {
      return vm.status === XcpNgBackupStatus.Failure;
    })
    .map((vm: { vmName: string }): string => {
      return vm.vmName;
    });
  const shown: Array<string> = names.slice(0, max);
  const more: number = summary.failedVmCount - shown.length;
  return more > 0 ? `${shown.join(", ")} (+${more} more)` : shown.join(", ");
}

// What a run did, in one line: the record's body and the alert's evidence.
export function describeXcpNgBackupRun(data: {
  jobName: string;
  summary: XcpNgPoolBackupRunSummary;
}): string {
  const { jobName, summary } = data;

  switch (summary.status) {
    case XcpNgBackupStatus.Success:
      return `Backup job ${jobName} succeeded: ${summary.vmCount} VM${
        summary.vmCount === 1 ? "" : "s"
      } backed up.`;
    case XcpNgBackupStatus.Skipped:
      return `Backup job ${jobName} skipped ${summary.skippedVmCount || summary.vmCount} VM${
        (summary.skippedVmCount || summary.vmCount) === 1 ? "" : "s"
      }${describeProblems(summary)}`;
    case XcpNgBackupStatus.Interrupted:
      return `Backup job ${jobName} was interrupted${describeProblems(summary)}`;
    case XcpNgBackupStatus.Failure:
    default: {
      const counted: string =
        summary.failedVmCount > 0
          ? `: ${summary.failedVmCount} of ${summary.vmCount} VM${
              summary.vmCount === 1 ? "" : "s"
            } failed`
          : "";
      return `Backup job ${jobName} failed${counted}${describeProblems(summary)}`;
    }
  }
}

function describeProblems(summary: XcpNgPoolBackupRunSummary): string {
  const parts: Array<string> = [];

  if (summary.error) {
    parts.push(summary.error);
  }

  for (const vm of summary.problemVms) {
    parts.push(vm.error ? `${vm.vmName}: ${vm.error}` : vm.vmName);
  }

  return parts.length > 0 ? `. ${parts.join("; ")}` : ".";
}

// One run of a job, for one pool.
export function buildXcpNgBackupLogRecord(data: {
  jobId: string;
  jobName: string;
  mode?: string | undefined;
  summary: XcpNgPoolBackupRunSummary;
  observedAt: Date;
}): JSONObject {
  const ended: Date = new Date(data.summary.endedAt || data.summary.startedAt);
  const severityNumber: number =
    data.summary.status === XcpNgBackupStatus.Failure
      ? 17
      : data.summary.status === XcpNgBackupStatus.Success
        ? 9
        : 13;

  return {
    timeUnixNano: toUnixNano(
      getXcpNgEventRecordTime({
        eventTime: ended,
        observedAt: data.observedAt,
      }),
    ),
    observedTimeUnixNano: toUnixNano(data.observedAt),
    severityNumber: severityNumber,
    severityText: getSeverityText(severityNumber),
    body: {
      stringValue: describeXcpNgBackupRun({
        jobName: data.jobName,
        summary: data.summary,
      }),
    },
    attributes: [
      attribute(XcpNgEventLogAttribute.Kind, XcpNgEventKind.Backup),
      attribute(XcpNgEventLogAttribute.BackupJobId, data.jobId),
      attribute(XcpNgEventLogAttribute.BackupJobName, data.jobName),
      attribute(XcpNgEventLogAttribute.BackupRunId, data.summary.runId),
      attribute(XcpNgEventLogAttribute.BackupStatus, data.summary.status),
      attribute(XcpNgEventLogAttribute.BackupMode, data.mode || ""),
      attribute(XcpNgEventLogAttribute.BackupVmCount, data.summary.vmCount),
      attribute(
        XcpNgEventLogAttribute.BackupFailedVmCount,
        data.summary.failedVmCount,
      ),
      attribute(
        XcpNgEventLogAttribute.BackupFailedVms,
        listXcpNgFailedVmNames(data.summary),
      ),
    ],
  };
}

/*
 * A job ran well again for this pool: the record that resolves the alert
 * an earlier failure of it opened. It carries that failure's own group -
 * the job's name then, and the VMs that failed then - so it lands on that
 * alert, whatever the job is called now.
 */
export function buildXcpNgBackupResolvedLogRecord(data: {
  open: XcpNgOpenBackupFailure;
  summary: XcpNgPoolBackupRunSummary;
  observedAt: Date;
}): JSONObject {
  const ended: Date = new Date(data.summary.endedAt || data.summary.startedAt);

  return {
    timeUnixNano: toUnixNano(
      getXcpNgEventRecordTime({
        eventTime: ended,
        observedAt: data.observedAt,
      }),
    ),
    observedTimeUnixNano: toUnixNano(data.observedAt),
    severityNumber: 9,
    severityText: "INFO",
    body: {
      stringValue: data.open.failedVms
        ? `Backup job ${data.open.jobName} succeeded again: ${data.open.failedVms} backed up.`
        : `Backup job ${data.open.jobName} succeeded again.`,
    },
    attributes: [
      attribute(XcpNgEventLogAttribute.Kind, XcpNgEventKind.Backup),
      attribute(XcpNgEventLogAttribute.BackupJobId, data.open.jobId),
      attribute(XcpNgEventLogAttribute.BackupJobName, data.open.jobName),
      attribute(XcpNgEventLogAttribute.BackupRunId, data.summary.runId),
      attribute(XcpNgEventLogAttribute.BackupStatus, XcpNgBackupStatus.Success),
      attribute(XcpNgEventLogAttribute.BackupFailedVms, data.open.failedVms),
    ],
  };
}

export interface XcpNgEventResource {
  poolIdentifier: string;
  // Xen Orchestra's name for the pool, when it has one.
  reportedName?: string | null | undefined;
  xenOrchestraName?: string | null | undefined;
}

function getResourceAttributes(resource: XcpNgEventResource): JSONArray {
  const attributes: JSONArray = [
    attribute(XCP_NG_POOL_ID_ATTRIBUTE, resource.poolIdentifier),
  ];
  if (resource.reportedName) {
    attributes.push(
      attribute(XCP_NG_POOL_NAME_ATTRIBUTE, resource.reportedName),
    );
  }
  if (resource.xenOrchestraName) {
    attributes.push(
      attribute(XEN_ORCHESTRA_NAME_ATTRIBUTE, resource.xenOrchestraName),
    );
  }
  return attributes;
}

// A pool's records as one OTLP resourceLogs entry.
export function buildXcpNgEventResourceLogs(data: {
  resource: XcpNgEventResource;
  records: Array<JSONObject>;
}): JSONObject {
  return {
    resource: { attributes: getResourceAttributes(data.resource) },
    scopeLogs: [
      {
        scope: { name: XCP_NG_EVENTS_SCOPE_NAME },
        logRecords: data.records,
      },
    ],
  };
}

export interface XcpNgDerivedReadings {
  at: Date;
  // Absent while HA's state is not known.
  ha?:
    | {
        enabled: boolean;
        canTolerateHostFailure: boolean | null;
        hostFailuresToTolerate: number | null;
        planExistsFor: number | null;
      }
    | undefined;
  // The VMs in a scheduled backup job.
  vmBackups: Array<{ vmId: string; vmName: string; overdue: boolean }>;
  // The hosts whose patches were checked.
  hostPatches: Array<{ hostId: string; hostName: string; count: number }>;
}

function gauge(name: string, dataPoints: Array<JSONObject>): JSONObject {
  return { name: name, unit: "1", gauge: { dataPoints: dataPoints } };
}

function point(data: {
  at: Date;
  value: number;
  attributes: JSONArray;
}): JSONObject {
  return {
    timeUnixNano: toUnixNano(data.at),
    asDouble: data.value,
    attributes: data.attributes,
  };
}

/*
 * A pool's derived readings as one OTLP resourceMetrics entry, or null when
 * there is nothing to say.
 */
export function buildXcpNgDerivedResourceMetrics(data: {
  resource: XcpNgEventResource;
  readings: XcpNgDerivedReadings;
}): JSONObject | null {
  const metrics: Array<JSONObject> = [];
  const poolAttributes: JSONArray = [
    attribute(XCP_NG_SCOPE_ATTRIBUTE, XcpNgScope.Pool),
    attribute(XCP_NG_ID_ATTRIBUTE, data.resource.poolIdentifier),
  ];
  const at: Date = data.readings.at;

  if (data.readings.ha) {
    const ha: NonNullable<XcpNgDerivedReadings["ha"]> = data.readings.ha;
    metrics.push(
      gauge(XcpNgDerivedSeries.PoolHaEnabled, [
        point({ at, value: ha.enabled ? 1 : 0, attributes: poolAttributes }),
      ]),
    );
    if (ha.enabled && ha.canTolerateHostFailure !== null) {
      metrics.push(
        gauge(XcpNgDerivedSeries.PoolHaCanTolerateHostFailure, [
          point({
            at,
            value: ha.canTolerateHostFailure ? 1 : 0,
            attributes: poolAttributes,
          }),
        ]),
      );
    }
    if (ha.hostFailuresToTolerate !== null) {
      metrics.push(
        gauge(XcpNgDerivedSeries.PoolHaHostFailuresToTolerate, [
          point({
            at,
            value: ha.hostFailuresToTolerate,
            attributes: poolAttributes,
          }),
        ]),
      );
    }
    if (ha.planExistsFor !== null) {
      metrics.push(
        gauge(XcpNgDerivedSeries.PoolHaPlanExistsFor, [
          point({ at, value: ha.planExistsFor, attributes: poolAttributes }),
        ]),
      );
    }
  }

  if (data.readings.vmBackups.length > 0) {
    metrics.push(
      gauge(
        XcpNgDerivedSeries.VmBackupOverdue,
        data.readings.vmBackups.map(
          (vm: { vmId: string; vmName: string; overdue: boolean }) => {
            return point({
              at,
              value: vm.overdue ? 1 : 0,
              attributes: [
                attribute(XCP_NG_SCOPE_ATTRIBUTE, XcpNgScope.VM),
                attribute(XCP_NG_ID_ATTRIBUTE, vm.vmId),
                attribute(XcpNgLabel.Uuid, vm.vmId),
                attribute(XcpNgLabel.VmName, vm.vmName),
              ],
            });
          },
        ),
      ),
    );
  }

  if (data.readings.hostPatches.length > 0) {
    metrics.push(
      gauge(
        XcpNgDerivedSeries.HostMissingPatches,
        data.readings.hostPatches.map(
          (host: { hostId: string; hostName: string; count: number }) => {
            return point({
              at,
              value: host.count,
              attributes: [
                attribute(XCP_NG_SCOPE_ATTRIBUTE, XcpNgScope.Host),
                attribute(XCP_NG_ID_ATTRIBUTE, host.hostId),
                attribute(XcpNgLabel.Uuid, host.hostId),
                attribute(XcpNgLabel.HostName, host.hostName),
              ],
            });
          },
        ),
      ),
    );
  }

  if (metrics.length === 0) {
    return null;
  }

  return {
    resource: { attributes: getResourceAttributes(data.resource) },
    scopeMetrics: [
      {
        scope: { name: XCP_NG_EVENTS_SCOPE_NAME },
        metrics: metrics,
      },
    ],
  };
}
