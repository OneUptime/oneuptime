import { SpanKind } from "../../../../../Models/AnalyticsModels/Span";
import AnalyticsTableName from "../../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  ProxyKind,
  getProxyKind,
  getProxyOfAddresses,
} from "../../../../../Utils/SecurityCase/ProxyAddresses";
import { readClickhouseTime } from "../../../../../Utils/SecurityCase/SecurityCaseStoryItems";
import { canonicalAddress } from "../../../../../Utils/SecurityCase/SecurityConnectionMatch";
import LogService from "../../../../Services/LogService";
import SpanService from "../../../../Services/SpanService";
import {
  QuerySettingsOptions,
  getQuerySettings,
} from "../../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../../AnalyticsDatabase/Statement";

/*
 * THE APP'S OWN REQUESTS FROM ONE ADDRESS, as its traces and logs show them
 * (#10340): whether an address still reaches the app - and so whether a
 * block of it holds, made in OneUptime or by hand anywhere - and how far
 * each of its requests got.
 *
 *   traces  the app's server spans whose client address is the address:
 *           client.address, or http.client_ip from older instrumentation.
 *           net.peer.ip, network.peer.address and net.sock.peer.addr are
 *           left out: they are the socket's peer, which is the load balancer
 *           in front of most apps, never a visitor (TraceSignals reads them
 *           to name a principal, not here);
 *   logs    the access log lines from the address: a line that starts with
 *           it (the common and combined formats), a JSON line that names it
 *           under a client field (WebAttackLogParser's JSON_CLIENT_FIELDS),
 *           or a line whose attributes do. A line that only mentions the
 *           address - a firewall's own "denied 203.0.113.7" - is no request
 *           that reached the app.
 *
 * How far a request got is its HTTP status: 4xx turned away by the app,
 * 2xx and 3xx answered, 5xx (or a failed span with no status) broke
 * something. A request whose answer cannot be read is counted apart, never
 * as turned away.
 *
 * Each read is bounded (a project, an address, a window of at most a few
 * days) and stops with an error when it runs out of time, so a read that
 * could not finish is never read as "no requests".
 */

// How long one read may run, and that it fails when it runs out.
export const ADDRESS_REQUESTS_READ_LIMIT: QuerySettingsOptions = {
  maxExecutionTimeInSeconds: 30,
  timeoutOverflowMode: "throw",
};

// The most traces a reading keeps of the requests that got past the app's checks.
export const ADDRESS_REQUESTS_MAX_TRACES: number = 20;

// The most client addresses a coverage read names.
export const COVERAGE_TOP_ADDRESSES: number = 5;

// The span attributes a visitor's address is read from, newest convention first.
export const SPAN_CLIENT_ADDRESS_ATTRIBUTES: ReadonlyArray<string> = [
  "client.address",
  "http.client_ip",
];

// The log attributes a visitor's address is read from.
export const LOG_CLIENT_ADDRESS_ATTRIBUTES: ReadonlyArray<string> = [
  "client.address",
  "http.client_ip",
  "remote_addr",
  "client_ip",
];

// The JSON fields an access log line names its client's address under.
export const LOG_JSON_CLIENT_FIELDS: ReadonlyArray<string> = [
  "remote_addr",
  "client_ip",
  "clientIp",
  "remoteAddr",
  "remote_ip",
  "client.address",
  "ip",
];

// A request's HTTP status, from its span: 0 when it has none.
const SPAN_STATUS: string =
  "toUInt16OrZero(if(attributes['http.response.status_code'] != '', attributes['http.response.status_code'], attributes['http.status_code']))";

/*
 * A request's HTTP status, from its log line: its attributes, else the
 * status after a common or combined format line's request ('"GET / HTTP/1.1"
 * 404 512'), else a JSON line's status field. 0 when it names none.
 */
const LOG_STATUS: string = `toUInt16OrZero(multiIf(attributes['http.response.status_code'] != '', attributes['http.response.status_code'], attributes['http.status_code'] != '', attributes['http.status_code'], extract(body, '" ([1-5][0-9][0-9]) ') != '', extract(body, '" ([1-5][0-9][0-9]) '), extract(body, '"(?:status|status_code)"\\\\s*:\\\\s*"?([1-5][0-9][0-9])')))`;

/*
 * The parts of a reading each source fills, over one window and one moment
 * asked about (`since`: the step was done then).
 */
export interface AddressRequestsSourceReading {
  total: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  // Requests after `since`, and the first of them.
  afterSince: number;
  firstAfterSince: Date | null;
  // How far they got.
  rejected: number;
  through: number;
  unknown: number;
  // Of those past the app's checks, the ones after `since`, and the first of them.
  throughAfterSince: number;
  firstThroughAfterSince: Date | null;
  // Requests in the last half hour.
  recent: number;
  throughTraceIds: Array<string>;
}

// What OneUptime can see of the app's requests by address, when it saw none from this one.
export enum AddressCoverage {
  // It sees requests by address: the address just never reached the app.
  Sees = "Sees",
  // No traces or logs from the app at all.
  NoTelemetry = "NoTelemetry",
  // The app's server spans say no client's address.
  NoClientAddress = "NoClientAddress",
  // The client addresses the traces carry are all Cloudflare's.
  ProxyAddresses = "ProxyAddresses",
  // They are all private: a load balancer's.
  LoadBalancerAddresses = "LoadBalancerAddresses",
}

export interface AddressCoverageReading {
  coverage: AddressCoverage;
  // The client addresses the app's traces carried in the last hour, the most first.
  topAddresses: Array<string>;
  addressCount: number;
}

export interface AddressRequestsReading extends AddressRequestsSourceReading {
  address: string;
  windowStart: Date;
  windowEnd: Date;
  since: Date | null;
}

export const EMPTY_SOURCE_READING: AddressRequestsSourceReading = {
  total: 0,
  firstSeenAt: null,
  lastSeenAt: null,
  afterSince: 0,
  firstAfterSince: null,
  rejected: 0,
  through: 0,
  unknown: 0,
  throughAfterSince: 0,
  firstThroughAfterSince: null,
  recent: 0,
  throughTraceIds: [],
};

// The counts and moments both sources share, written the same for each.
function appendAggregates(data: {
  statement: Statement;
  timeColumn: string;
  status: string;
  hasErrorColumn: boolean;
  since: Date | null;
  recentSince: Date;
}): void {
  const time: string = data.timeColumn;
  /*
   * Past the app's checks: answered (2xx, 3xx), or broke something (5xx, or
   * a failed span that says no status).
   */
  const through: string = `((${data.status} >= 200 AND ${data.status} < 400) OR ${data.status} >= 500${
    data.hasErrorColumn ? ` OR (${data.status} = 0 AND statusCode = 2)` : ""
  })`;
  const unknown: string = `(${data.status} = 0${
    data.hasErrorColumn ? " AND statusCode != 2" : ""
  })`;
  // A moment never asked about compares as the epoch: every request is after it.
  const since: Date = data.since || new Date(0);

  data.statement.append(
    `count() AS total, min(${time}) AS firstSeen, max(${time}) AS lastSeen, `,
  );
  data.statement.append(SQL`countIf(`);
  data.statement.append(`${time} > `);
  data.statement.append(
    SQL`${{ type: TableColumnType.DateTime64, value: since }}) AS afterSince, minIf(`,
  );
  data.statement.append(`${time}, ${time} > `);
  data.statement.append(
    SQL`${{ type: TableColumnType.DateTime64, value: since }}) AS firstAfterSince, `,
  );
  data.statement.append(
    `countIf(${data.status} >= 400 AND ${data.status} < 500) AS rejected, countIf(${through}) AS through, countIf(${unknown}) AS unknown, countIf(${through} AND ${time} > `,
  );
  data.statement.append(
    SQL`${{ type: TableColumnType.DateTime64, value: since }}) AS throughAfterSince, minIf(`,
  );
  data.statement.append(`${time}, ${through} AND ${time} > `);
  data.statement.append(
    SQL`${{ type: TableColumnType.DateTime64, value: since }}) AS firstThroughAfterSince, countIf(`,
  );
  data.statement.append(`${time} >= `);
  data.statement.append(
    SQL`${{ type: TableColumnType.DateTime64, value: data.recentSince }}) AS recent, `,
  );
  // A parametric aggregate's size is a constant of the statement, never a parameter.
  data.statement.append(
    `groupUniqArrayIf(${ADDRESS_REQUESTS_MAX_TRACES})(traceId, ${through} AND traceId != '') AS throughTraceIds`,
  );
}

/*
 * The app's server spans whose client address is the address, over the
 * window: how many, when, how far they got.
 */
export function buildSpanRequestsStatement(data: {
  projectId: ObjectID;
  address: string;
  start: Date;
  end: Date;
  since: Date | null;
  recentSince: Date;
}): Statement {
  const statement: Statement = SQL`SELECT `;

  appendAggregates({
    statement,
    timeColumn: "startTime",
    status: SPAN_STATUS,
    hasErrorColumn: true,
    since: data.since,
    recentSince: data.recentSince,
  });

  statement.append(` FROM ${AnalyticsTableName.Span}`);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND startTime >= ${{
      type: TableColumnType.DateTime64,
      value: data.start,
    }} AND startTime <= ${{
      type: TableColumnType.DateTime64,
      value: data.end,
    }} AND kind = ${{
      type: TableColumnType.Text,
      value: SpanKind.Server,
    }} AND (`,
  );

  SPAN_CLIENT_ADDRESS_ATTRIBUTES.forEach(
    (attribute: string, index: number): void => {
      statement.append(index === 0 ? "" : " OR ");
      statement.append(
        SQL`attributes[${{ type: TableColumnType.Text, value: attribute }}] = ${{
          type: TableColumnType.Text,
          value: data.address,
        }}`,
      );
    },
  );

  statement.append(")");
  statement.append(getQuerySettings(ADDRESS_REQUESTS_READ_LIMIT));

  return statement;
}

/*
 * The JSON a line names its client under, for an address: each field
 * written as a JSON encoder writes it, with and without a space after its
 * colon.
 */
export function getLogJsonClientNeedles(address: string): Array<string> {
  return LOG_JSON_CLIENT_FIELDS.flatMap((field: string): Array<string> => {
    return [`"${field}":"${address}"`, `"${field}": "${address}"`];
  });
}

// The app's access log lines from the address, over the window.
export function buildLogRequestsStatement(data: {
  projectId: ObjectID;
  address: string;
  start: Date;
  end: Date;
  since: Date | null;
  recentSince: Date;
}): Statement {
  const statement: Statement = SQL`SELECT `;

  appendAggregates({
    statement,
    timeColumn: "time",
    status: LOG_STATUS,
    hasErrorColumn: false,
    since: data.since,
    recentSince: data.recentSince,
  });

  statement.append(` FROM ${AnalyticsTableName.Log}`);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: data.start,
    }} AND time <= ${{
      type: TableColumnType.DateTime64,
      value: data.end,
    }} AND (`,
  );

  LOG_CLIENT_ADDRESS_ATTRIBUTES.forEach(
    (attribute: string, index: number): void => {
      statement.append(index === 0 ? "" : " OR ");
      statement.append(
        SQL`attributes[${{ type: TableColumnType.Text, value: attribute }}] = ${{
          type: TableColumnType.Text,
          value: data.address,
        }}`,
      );
    },
  );

  /*
   * A line that names the address in its body - the body's token index
   * reads only the granules that hold its parts - and names it as a
   * client: first, or under a JSON client field.
   */
  statement.append(
    SQL` OR (position(body, ${{
      type: TableColumnType.Text,
      value: data.address,
    }}) > 0 AND (startsWith(body, ${{
      type: TableColumnType.Text,
      value: `${data.address} `,
    }}) OR multiSearchAny(body, ${{
      type: TableColumnType.ArrayText,
      value: getLogJsonClientNeedles(data.address),
    }}))))`,
  );
  statement.append(getQuerySettings(ADDRESS_REQUESTS_READ_LIMIT));

  return statement;
}

/*
 * What the app's server spans of the last hour say of client addresses: how
 * many there were, how many named a client, and the addresses they named
 * the most.
 */
export function buildSpanCoverageStatement(data: {
  projectId: ObjectID;
  since: Date;
}): Statement {
  const client: string =
    "if(attributes['client.address'] != '', attributes['client.address'], attributes['http.client_ip'])";
  const statement: Statement = SQL`SELECT count() AS serverSpans, `;

  statement.append(
    `countIf(${client} != '') AS withAddress, uniqIf(${client}, ${client} != '') AS addressCount, topKIf(${COVERAGE_TOP_ADDRESSES})(${client}, ${client} != '') AS topAddresses FROM ${AnalyticsTableName.Span}`,
  );
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND startTime >= ${{
      type: TableColumnType.DateTime64,
      value: data.since,
    }} AND kind = ${{
      type: TableColumnType.Text,
      value: SpanKind.Server,
    }}`,
  );
  statement.append(getQuerySettings(ADDRESS_REQUESTS_READ_LIMIT));

  return statement;
}

// Whether the app sent any log line in the last hour.
export function buildLogCoverageStatement(data: {
  projectId: ObjectID;
  since: Date;
}): Statement {
  const statement: Statement = SQL`SELECT count() AS logs FROM `;

  statement.append(AnalyticsTableName.Log);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND time >= ${{
      type: TableColumnType.DateTime64,
      value: data.since,
    }}`,
  );
  statement.append(getQuerySettings(ADDRESS_REQUESTS_READ_LIMIT));

  return statement;
}

function readCount(value: JSONValue | undefined): number {
  const count: number = Number(value);

  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

// A moment ClickHouse wrote, null for none - min/max of no rows is the epoch.
function readMoment(value: JSONValue | undefined): Date | null {
  const time: Date | null = readClickhouseTime(value);

  return time && time.getTime() > 0 ? time : null;
}

// One source's row, read back.
export function readSourceRow(
  row: JSONObject | undefined,
): AddressRequestsSourceReading {
  if (!row || readCount(row["total"]) === 0) {
    return { ...EMPTY_SOURCE_READING, throughTraceIds: [] };
  }

  const traceIds: JSONValue | undefined = row["throughTraceIds"];

  return {
    total: readCount(row["total"]),
    firstSeenAt: readMoment(row["firstSeen"]),
    lastSeenAt: readMoment(row["lastSeen"]),
    afterSince: readCount(row["afterSince"]),
    firstAfterSince: readMoment(row["firstAfterSince"]),
    rejected: readCount(row["rejected"]),
    through: readCount(row["through"]),
    unknown: readCount(row["unknown"]),
    throughAfterSince: readCount(row["throughAfterSince"]),
    firstThroughAfterSince: readMoment(row["firstThroughAfterSince"]),
    recent: readCount(row["recent"]),
    throughTraceIds: Array.isArray(traceIds)
      ? (traceIds as Array<JSONValue>)
          .filter((traceId: JSONValue): boolean => {
            return typeof traceId === "string" && traceId.length > 0;
          })
          .map((traceId: JSONValue): string => {
            return String(traceId);
          })
          .slice(0, ADDRESS_REQUESTS_MAX_TRACES)
      : [],
  };
}

function earliest(left: Date | null, right: Date | null): Date | null {
  if (!left || !right) {
    return left || right;
  }

  return left.getTime() <= right.getTime() ? left : right;
}

function latest(left: Date | null, right: Date | null): Date | null {
  if (!left || !right) {
    return left || right;
  }

  return left.getTime() >= right.getTime() ? left : right;
}

/*
 * Traces and logs, read as one. A request an app both traced and logged is
 * counted in each, so the larger of each count stands for it rather than
 * their sum; the moments are the earliest and latest either saw.
 */
export function mergeSourceReadings(
  spans: AddressRequestsSourceReading,
  logs: AddressRequestsSourceReading,
): AddressRequestsSourceReading {
  return {
    total: Math.max(spans.total, logs.total),
    firstSeenAt: earliest(spans.firstSeenAt, logs.firstSeenAt),
    lastSeenAt: latest(spans.lastSeenAt, logs.lastSeenAt),
    afterSince: Math.max(spans.afterSince, logs.afterSince),
    firstAfterSince: earliest(spans.firstAfterSince, logs.firstAfterSince),
    rejected: Math.max(spans.rejected, logs.rejected),
    through: Math.max(spans.through, logs.through),
    unknown: spans.total >= logs.total ? spans.unknown : logs.unknown,
    throughAfterSince: Math.max(
      spans.throughAfterSince,
      logs.throughAfterSince,
    ),
    firstThroughAfterSince: earliest(
      spans.firstThroughAfterSince,
      logs.firstThroughAfterSince,
    ),
    recent: Math.max(spans.recent, logs.recent),
    throughTraceIds: Array.from(
      new Set([...spans.throughTraceIds, ...logs.throughTraceIds]),
    ).slice(0, ADDRESS_REQUESTS_MAX_TRACES),
  };
}

/*
 * What OneUptime can see of the app's requests by address, from the last
 * hour's server spans and logs: why it saw none from an address.
 */
export function getAddressCoverage(data: {
  serverSpans: number;
  withAddress: number;
  topAddresses: Array<string>;
  logs: number;
}): AddressCoverage {
  if (data.serverSpans === 0) {
    return data.logs === 0 ? AddressCoverage.NoTelemetry : AddressCoverage.Sees;
  }

  if (data.withAddress === 0) {
    return AddressCoverage.NoClientAddress;
  }

  switch (getProxyOfAddresses(data.topAddresses)) {
    case ProxyKind.Cloudflare:
      return AddressCoverage.ProxyAddresses;
    case ProxyKind.LoadBalancer:
      return AddressCoverage.LoadBalancerAddresses;
    default:
      return AddressCoverage.Sees;
  }
}

// Whether the address is itself a proxy's: Cloudflare's, in front of the app.
export function isProxyAddress(address: string): boolean {
  return getProxyKind(address) === ProxyKind.Cloudflare;
}

// The rows an analytics statement read, through the service of its table.
export async function readAnalyticsRows(
  service: { executeQuery: (statement: Statement) => Promise<unknown> },
  statement: Statement,
): Promise<Array<JSONObject>> {
  const result: { json: <T>() => Promise<T> } = (await service.executeQuery(
    statement,
  )) as { json: <T>() => Promise<T> };
  const response: { data?: Array<JSONObject> } = await result.json<{
    data?: Array<JSONObject>;
  }>();

  return response.data || [];
}

const readRows: typeof readAnalyticsRows = readAnalyticsRows;

export default class AddressRequests {
  /*
   * The app's requests from an address over a window, traces and logs as
   * one. Throws when either could not be read: a check that cannot read its
   * data says it cannot tell.
   */
  public static async read(data: {
    projectId: ObjectID;
    address: string;
    start: Date;
    end: Date;
    since: Date | null;
    recentSince: Date;
  }): Promise<AddressRequestsReading> {
    const address: string = canonicalAddress(data.address) || data.address;
    const input: {
      projectId: ObjectID;
      address: string;
      start: Date;
      end: Date;
      since: Date | null;
      recentSince: Date;
    } = { ...data, address };

    const [spanRows, logRows]: [Array<JSONObject>, Array<JSONObject>] =
      await Promise.all([
        readRows(SpanService, buildSpanRequestsStatement(input)),
        readRows(LogService, buildLogRequestsStatement(input)),
      ]);

    return {
      ...mergeSourceReadings(
        readSourceRow(spanRows[0]),
        readSourceRow(logRows[0]),
      ),
      address,
      windowStart: data.start,
      windowEnd: data.end,
      since: data.since,
    };
  }

  // How many requests from the address reached the app in an hour: the hour before it went quiet.
  public static async countInWindow(data: {
    projectId: ObjectID;
    address: string;
    start: Date;
    end: Date;
  }): Promise<number> {
    const reading: AddressRequestsReading = await this.read({
      ...data,
      since: null,
      recentSince: data.end,
    });

    return reading.total;
  }

  // What OneUptime can see of the app's requests by address, over the last hour before `now`.
  public static async readCoverage(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<AddressCoverageReading> {
    const since: Date = new Date(data.now.getTime() - 60 * 60 * 1000);
    const [spanRows, logRows]: [Array<JSONObject>, Array<JSONObject>] =
      await Promise.all([
        readRows(
          SpanService,
          buildSpanCoverageStatement({ projectId: data.projectId, since }),
        ),
        readRows(
          LogService,
          buildLogCoverageStatement({ projectId: data.projectId, since }),
        ),
      ]);
    const spans: JSONObject = spanRows[0] || {};
    const topAddresses: Array<string> = Array.isArray(spans["topAddresses"])
      ? (spans["topAddresses"] as Array<JSONValue>)
          .filter((value: JSONValue): boolean => {
            return typeof value === "string" && value.length > 0;
          })
          .map((value: JSONValue): string => {
            return String(value);
          })
      : [];

    return {
      coverage: getAddressCoverage({
        serverSpans: readCount(spans["serverSpans"]),
        withAddress: readCount(spans["withAddress"]),
        topAddresses,
        logs: readCount((logRows[0] || {})["logs"]),
      }),
      topAddresses,
      addressCount: readCount(spans["addressCount"]),
    };
  }
}
