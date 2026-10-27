import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import AuditLogAction from "../../../../Types/AuditLog/AuditLogAction";
import Includes from "../../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../../Types/ObjectID";
import { SpanKind } from "../../../../Models/AnalyticsModels/Span";
import {
  EPHEMERAL_PORT_START,
  SWEEP_IGNORED_PORTS,
} from "../../../../Utils/SecurityEvent/TelemetryScan/FlowSignals";
import { AUDIT_SECURITY_RESOURCE_TYPES } from "../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";
import {
  PROMPT_INJECTION_PHRASES,
  TRACE_SCAN_ATTRIBUTES_READ,
  TRACE_SCAN_URL_ATTRIBUTES,
  getTraceScanUrlMarkers,
} from "../../../../Utils/SecurityEvent/TelemetryScan/TraceSignals";
import { getClickhouseDatabaseName } from "../../AnalyticsDatabase/ClusterConfig";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";

/*
 * THE READS OF "YOUR ONEUPTIME DATA", as statements.
 *
 * Every one is one project's (projectId is the first condition), bounded in
 * time twice - by when the data ARRIVED, the window the scan reads, and by
 * when it HAPPENED, which the tables are sorted and partitioned by - and
 * bounded in rows. Only rows that may hold a finding leave the database:
 * the trace and audit reads filter before they page, and the flow and
 * session reads return one summed row per address, pair or user.
 *
 * Built here, apart from the scans, so a test can read each statement
 * without a database (TelemetryScanStatements.test.ts).
 */

// The longest one telemetry read may run.
export const TELEMETRY_SCAN_QUERY_TIME_LIMIT_IN_SECONDS: number = 60;

export interface TelemetryScanWindow {
  projectId: ObjectID;
  // Arrived after this...
  arrivedAfter: Date;
  // ...and at or before this.
  arrivedUntil: Date;
  // Happened at or after this: what the table's sort key prunes on.
  happenedAfter: Date;
}

function tableOf(tableName: AnalyticsTableName): string {
  return `${getClickhouseDatabaseName()}.${tableName}`;
}

function settings(): string {
  return getQuerySettings({
    maxExecutionTimeInSeconds: TELEMETRY_SCAN_QUERY_TIME_LIMIT_IN_SECONDS,
    timeoutOverflowMode: "throw",
  });
}

// Every attribute of a span's URL, as one text the prefilter reads.
function spanUrlText(statement: Statement): void {
  statement.append("concat(");

  TRACE_SCAN_URL_ATTRIBUTES.forEach((key: string, index: number): void => {
    if (index > 0) {
      statement.append(", ' ', ");
    }

    statement.append(
      SQL`attributes[${{ type: TableColumnType.Text, value: key }}]`,
    );
  });

  statement.append(")");
}

/*
 * A page of the spans that arrived in a window and may hold an attack: a
 * server span whose URL holds an attack string or a cloud metadata
 * address, or an LLM span whose prompt holds a prompt-injection phrase.
 * Read in a fixed order, so the same window pages the same way again.
 */
export function buildTraceCandidatesStatement(
  data: TelemetryScanWindow & { limit: number; offset: number },
): Statement {
  const statement: Statement = SQL`SELECT traceId, spanId, parentSpanId, sessionId, name, kind, durationUnixNano, startTime, primaryEntityId, primaryEntityType, isLlmSpan, llmUserMessagePreview, llmUserId, llmSystem, llmRequestModel, llmOperation, mapFilter((key, value) -> has(${{
    type: TableColumnType.ArrayText,
    value: [...TRACE_SCAN_ATTRIBUTES_READ],
  }}, key), attributes) AS attributes FROM `;
  statement.append(tableOf(AnalyticsTableName.Span));
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND startTime >= ${{
      type: TableColumnType.Date,
      value: data.happenedAfter,
    }} AND createdAt > ${{
      type: TableColumnType.Date,
      value: data.arrivedAfter,
    }} AND createdAt <= ${{
      type: TableColumnType.Date,
      value: data.arrivedUntil,
    }} AND retentionDate >= now() AND ((kind = ${{
      type: TableColumnType.Text,
      value: SpanKind.Server,
    }} AND multiSearchAnyCaseInsensitive(`,
  );
  spanUrlText(statement);
  statement.append(
    SQL`, ${{
      type: TableColumnType.ArrayText,
      value: getTraceScanUrlMarkers(),
    }})) OR (isLlmSpan = 1 AND multiSearchAnyCaseInsensitive(llmUserMessagePreview, ${{
      type: TableColumnType.ArrayText,
      value: [...PROMPT_INJECTION_PHRASES],
    }}))) ORDER BY createdAt ASC, traceId ASC, spanId ASC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }} OFFSET ${{
      type: TableColumnType.Number,
      value: Math.max(0, Math.trunc(data.offset)),
    }}`,
  );
  statement.append(settings());

  return statement;
}

function flowWhere(statement: Statement, data: TelemetryScanWindow): void {
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND flowStartAt >= ${{
      type: TableColumnType.Date,
      value: data.happenedAfter,
    }} AND ingestedAt > ${{
      type: TableColumnType.Date,
      value: data.arrivedAfter,
    }} AND ingestedAt <= ${{
      type: TableColumnType.Date,
      value: data.arrivedUntil,
    }}`,
  );
}

// The ports below this are services'; the ones above are clients' own.
const SERVICE_PORT_CONDITION: string = `dstPort > 0 AND dstPort < ${Math.trunc(
  EPHEMERAL_PORT_START,
)}`;

/*
 * One row per source and destination pair that reached at least `minPorts`
 * service ports of the destination in the window.
 */
export function buildPortScanStatement(
  data: TelemetryScanWindow & { minPorts: number; limit: number },
): Statement {
  // The condition is this file's own constant, so it is appended as text.
  const statement: Statement = SQL`SELECT srcIp, dstIp, `;
  statement.append(
    `uniqExactIf(dstPort, ${SERVICE_PORT_CONDITION}) AS ports, groupUniqArrayIf(10)(dstPort, ${SERVICE_PORT_CONDITION}) AS samplePorts, `,
  );
  statement.append(
    "count() AS flows, sum(octets) AS bytes, sum(packets) AS packets, min(flowStartAt) AS firstSeen, max(flowEndAt) AS lastSeen, any(toString(networkDeviceId)) AS deviceId FROM ",
  );
  statement.append(tableOf(AnalyticsTableName.NetworkFlow));
  flowWhere(statement, data);
  statement.append(
    SQL` GROUP BY srcIp, dstIp HAVING ports >= ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.minPorts)),
    }} ORDER BY ports DESC, srcIp ASC, dstIp ASC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(settings());

  return statement;
}

/*
 * One row per source and service port that reached at least `minHosts`
 * hosts on it in the window - the ports clients reach many hosts on every
 * day left out.
 */
export function buildNetworkSweepStatement(
  data: TelemetryScanWindow & { minHosts: number; limit: number },
): Statement {
  const ignoredPorts: string = SWEEP_IGNORED_PORTS.map((port: number) => {
    return String(Math.trunc(port));
  }).join(", ");

  const statement: Statement = SQL`SELECT srcIp, dstPort, uniqExact(dstIp) AS hosts, groupUniqArray(10)(dstIp) AS sampleHosts, count() AS flows, sum(octets) AS bytes, sum(packets) AS packets, min(flowStartAt) AS firstSeen, max(flowEndAt) AS lastSeen, any(toString(networkDeviceId)) AS deviceId FROM `;
  statement.append(tableOf(AnalyticsTableName.NetworkFlow));
  flowWhere(statement, data);
  statement.append(
    ` AND ${SERVICE_PORT_CONDITION} AND dstPort NOT IN (${ignoredPorts})`,
  );
  statement.append(
    SQL` GROUP BY srcIp, dstPort HAVING hosts >= ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.minHosts)),
    }} ORDER BY hosts DESC, srcIp ASC, dstPort ASC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(settings());

  return statement;
}

/*
 * One row per source and destination pair that moved at least `minBytes`
 * in the window, with the port and protocol that carried the most of it.
 */
export function buildLargeTransferStatement(
  data: TelemetryScanWindow & { minBytes: number; limit: number },
): Statement {
  const statement: Statement = SQL`SELECT srcIp, dstIp, sum(octets) AS bytes, sum(packets) AS packets, count() AS flows, argMax(dstPort, octets) AS topPort, argMax(protocol, octets) AS topProtocol, min(flowStartAt) AS firstSeen, max(flowEndAt) AS lastSeen, any(toString(networkDeviceId)) AS deviceId FROM `;
  statement.append(tableOf(AnalyticsTableName.NetworkFlow));
  flowWhere(statement, data);
  statement.append(
    SQL` GROUP BY srcIp, dstIp HAVING bytes >= ${{
      type: TableColumnType.BigNumber,
      value: Math.max(1, Math.trunc(data.minBytes)),
    }} ORDER BY bytes DESC, srcIp ASC, dstIp ASC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(settings());

  return statement;
}

// The addresses of a window, the busiest first: what threat intel is asked about.
export function buildFlowAddressesStatement(
  data: TelemetryScanWindow & { limit: number },
): Statement {
  const statement: Statement = SQL`SELECT address, count() AS flows FROM (SELECT arrayJoin([srcIp, dstIp]) AS address FROM `;
  statement.append(tableOf(AnalyticsTableName.NetworkFlow));
  flowWhere(statement, data);
  statement.append(
    SQL`) GROUP BY address ORDER BY flows DESC, address ASC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(settings());

  return statement;
}

// The window's traffic with the given addresses, one row per pair and port.
export function buildFlowsOfAddressesStatement(
  data: TelemetryScanWindow & { addresses: Array<string>; limit: number },
): Statement {
  const statement: Statement = SQL`SELECT srcIp, dstIp, dstPort AS topPort, protocol AS topProtocol, sum(octets) AS bytes, sum(packets) AS packets, count() AS flows, min(flowStartAt) AS firstSeen, max(flowEndAt) AS lastSeen, any(toString(networkDeviceId)) AS deviceId FROM `;
  statement.append(tableOf(AnalyticsTableName.NetworkFlow));
  flowWhere(statement, data);
  statement.append(
    SQL` AND (srcIp IN (${{
      type: TableColumnType.Text,
      value: new Includes(data.addresses),
    }}) OR dstIp IN (${{
      type: TableColumnType.Text,
      value: new Includes(data.addresses),
    }})) GROUP BY srcIp, dstIp, dstPort, protocol ORDER BY bytes DESC, srcIp ASC, dstIp ASC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(settings());

  return statement;
}

/*
 * A page of the audit records that arrived in a window and are about
 * something security cares for (AUDIT_SECURITY_RESOURCE_TYPES), in a fixed
 * order.
 */
export function buildAuditRecordsStatement(
  data: Omit<TelemetryScanWindow, "happenedAfter"> & {
    limit: number;
    offset: number;
  },
): Statement {
  const statement: Statement = SQL`SELECT _id, createdAt, resourceType, resourceId, resourceName, action, userId, userName, userEmail, userType, apiKeyId, apiKeyName, mcpClientName, workflowName FROM `;
  statement.append(tableOf(AnalyticsTableName.AuditLog));
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND createdAt > ${{
      type: TableColumnType.Date,
      value: data.arrivedAfter,
    }} AND createdAt <= ${{
      type: TableColumnType.Date,
      value: data.arrivedUntil,
    }} AND resourceType IN (${{
      type: TableColumnType.Text,
      value: new Includes([...AUDIT_SECURITY_RESOURCE_TYPES]),
    }}) AND retentionDate >= now() ORDER BY createdAt ASC, _id ASC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }} OFFSET ${{
      type: TableColumnType.Number,
      value: Math.max(0, Math.trunc(data.offset)),
    }}`,
  );
  statement.append(settings());

  return statement;
}

// One row per actor that deleted at least `minDeletes` records in the window.
export function buildMassDeleteStatement(
  data: Omit<TelemetryScanWindow, "happenedAfter"> & {
    minDeletes: number;
    limit: number;
  },
): Statement {
  const statement: Statement = SQL`SELECT toString(userId) AS actorUserId, any(userName) AS actorUserName, any(userEmail) AS actorUserEmail, any(userType) AS actorUserType, toString(apiKeyId) AS actorApiKeyId, any(apiKeyName) AS actorApiKeyName, count() AS deletes, groupUniqArray(5)(resourceType) AS sampleResourceTypes, min(createdAt) AS firstAt, max(createdAt) AS lastAt FROM `;
  statement.append(tableOf(AnalyticsTableName.AuditLog));
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND createdAt > ${{
      type: TableColumnType.Date,
      value: data.arrivedAfter,
    }} AND createdAt <= ${{
      type: TableColumnType.Date,
      value: data.arrivedUntil,
    }} AND action = ${{
      type: TableColumnType.Text,
      value: AuditLogAction.Delete,
    }} AND retentionDate >= now() GROUP BY userId, apiKeyId HAVING deletes >= ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.minDeletes)),
    }} ORDER BY deletes DESC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(settings());

  return statement;
}

/*
 * The identified users with sessions from two or more countries that
 * started since `startedAfter`, one of which arrived in the window - each
 * with the sessions, newest version of each read (the table keeps every
 * version of a session; argMax by version is the latest).
 */
export function buildRumUserCountriesStatement(
  data: Omit<TelemetryScanWindow, "happenedAfter"> & {
    startedAfter: Date;
    sessionsPerUser: number;
    limit: number;
  },
): Statement {
  // An aggregate's own parameter is a literal: a number of this file's, as text.
  const statement: Statement = SQL`SELECT userKey, `;
  statement.append(
    `groupArray(${Math.max(2, Math.trunc(data.sessionsPerUser))})(tuple(sessionId, applicationId, country, sessionStart, browser, os)) AS sessions `,
  );
  statement.append(
    "FROM (SELECT sessionId, toString(rumApplicationId) AS applicationId, argMax(identifiedUserKey, version) AS userKey, argMax(countryCode, version) AS country, min(startTime) AS sessionStart, argMax(browserName, version) AS browser, argMax(osName, version) AS os, max(createdAt) AS arrivedAt FROM ",
  );
  statement.append(tableOf(AnalyticsTableName.RumSession));
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND startTime >= ${{
      type: TableColumnType.Date,
      value: data.startedAfter,
    }} AND startTime <= ${{
      type: TableColumnType.Date,
      value: data.arrivedUntil,
    }} AND retentionDate >= now() GROUP BY rumApplicationId, sessionId) WHERE userKey != '' AND country != '' GROUP BY userKey HAVING uniqExact(country) >= 2 AND max(arrivedAt) > ${{
      type: TableColumnType.Date,
      value: data.arrivedAfter,
    }} ORDER BY max(arrivedAt) DESC LIMIT ${{
      type: TableColumnType.Number,
      value: Math.max(1, Math.trunc(data.limit)),
    }}`,
  );
  statement.append(settings());

  return statement;
}
