import Log from "Common/Models/AnalyticsModels/Log";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  getAwsLogGroupAttributes,
  getAwsLogGroupResource,
} from "Common/Types/Cloud/CloudLogGroups";
import { CLOUD_CONNECTION_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudConnectionTelemetry";
import { inferCloudWatchLogSeverity } from "Common/Types/Cloud/CloudWatchLogSeverity";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { RESOURCE_FACET_CATALOG_KEYS } from "Common/Types/Telemetry/ResourceFacetCatalog";

/*
 * WHAT THE AWS CONNECTION'S STREAM DELIVERED FROM CLOUDWATCH LOGS, AS THE
 * FIREHOSE INGEST WRITES IT, AND THE LOGS VIEWER'S READS OF IT.
 *
 * Each row is a log line of a log group, under the connection's telemetry
 * service ("AWS 123456789012", the service a connection's stream writes
 * into: CloudConnectionService.ensureTelemetryService), with the resource
 * attributes the ingest stamps (CloudWatchLogs.buildResourceLogs): the
 * service, the cloud, the connection, the account, the Region, the log
 * group, and what the log group rules say of the group - computed here by
 * the very rules (CloudLogGroups.getAwsLogGroupAttributes), so a rule that
 * changes changes the rows. A resource's Logs tab finds its rows by
 * resource.cloud.resource_id: the fixture's resources carry the id the
 * rules give their groups (logGroupResourceId).
 *
 *   - orders-db, a PostgreSQL instance in eu-west-1: its postgresql log of
 *     the last hour, in RDS for PostgreSQL's own line format;
 *   - nightly-export, a function in us-east-1 that stopped reporting three
 *     days ago: its last two runs, the last of them timing out.
 *
 * The reads are answered the way the server answers them (BaseAnalyticsAPI,
 * TelemetryAPI): the list one row past its page (hasMore), the count
 * exactly, the histogram per bucket and severity, the facets by severity
 * and service - every resource facet empty, as the project's facet lists
 * hold no rows a stream's logs belong to - and the attribute keys and
 * values. A read the fixture does not model lands on `unhandled`.
 */

export const STREAM_ACCOUNT_ID = "123456789012";
export const STREAM_CONNECTION_ID = "20000000-0000-4000-8000-000000000001";
export const STREAM_SERVICE_ID = "21000000-0000-4000-8000-000000000001";
// The connection's telemetry service is named after the connection.
export const STREAM_SERVICE_NAME = "AWS 123456789012";

export const ORDERS_DB_LOG_GROUP = "/aws/rds/instance/orders-db/postgresql";
export const ORDERS_DB_REGION = "eu-west-1";
export const NIGHTLY_EXPORT_LOG_GROUP = "/aws/lambda/nightly-export";
export const NIGHTLY_EXPORT_REGION = "us-east-1";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/*
 * The id the log group rules give a group's resource: the one the
 * resource's row must carry for its Logs tab to find the group's rows.
 */
export function logGroupResourceId(logGroup, region) {
  const filed = getAwsLogGroupResource({
    logGroup,
    accountId: STREAM_ACCOUNT_ID,
    region,
  });
  if (!filed) {
    throw new Error(`No rule files ${logGroup}`);
  }
  return filed.resource.providerResourceId;
}

// "2026-11-06 09:58:12 UTC": the time RDS for PostgreSQL writes first.
function postgresTime(time) {
  return `${new Date(time).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function isoTime(time) {
  return new Date(time).toISOString();
}

/*
 * RDS for PostgreSQL's log_line_prefix, which RDS fixes:
 * "%t:%r:%u@%d:[%p]:" - time, client, user@database, process.
 */
function postgresLine(time, session, level, message) {
  return `${postgresTime(time)}:${session}:${level}:  ${message}`;
}

const APP_SESSION = "10.0.1.23(52344):orders_app@orders:[23817]";
const OTHER_APP_SESSION = "10.0.2.41(40112):orders_app@orders:[24102]";
const REPORT_SESSION = "10.0.1.88(52390):report_ro@orders:[24420]";
const CHECKPOINTER = ":@:[6045]";
const AUTOVACUUM = ":@:[27710]";

/*
 * The database's last hour, oldest first: the minutes ago each line was
 * written, its level as PostgreSQL writes it, and its message.
 */
const ORDERS_DB_LINES = [
  [58, CHECKPOINTER, "LOG", "checkpoint starting: time"],
  [
    55,
    CHECKPOINTER,
    "LOG",
    "checkpoint complete: wrote 1823 buffers (11.1%); 0 WAL file(s) added, 0 removed, 1 recycled; write=181.552 s, sync=0.004 s, total=181.568 s",
  ],
  [
    52,
    APP_SESSION,
    "LOG",
    "connection authorized: user=orders_app database=orders application_name=orders-api SSL enabled (protocol=TLSv1.3, cipher=TLS_AES_256_GCM_SHA384, bits=256)",
  ],
  [
    49,
    APP_SESSION,
    "LOG",
    "duration: 812.403 ms  statement: SELECT id, status, total FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50",
  ],
  [
    46,
    AUTOVACUUM,
    "LOG",
    'automatic vacuum of table "orders.public.order_items": index scans: 1',
  ],
  [
    43,
    APP_SESSION,
    "LOG",
    "duration: 2384.112 ms  statement: SELECT o.id, o.total FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.customer_id = $1",
  ],
  [
    41,
    REPORT_SESSION,
    "FATAL",
    'password authentication failed for user "report_ro"',
  ],
  [
    41,
    REPORT_SESSION,
    "DETAIL",
    'Connection matched pg_hba.conf line 13: "hostssl all all 0.0.0.0/0 md5"',
  ],
  [37, APP_SESSION, "WARNING", "there is no transaction in progress"],
  [33, CHECKPOINTER, "LOG", "checkpoint starting: time"],
  [
    30,
    CHECKPOINTER,
    "LOG",
    "checkpoint complete: wrote 2210 buffers (13.5%); 0 WAL file(s) added, 0 removed, 2 recycled; write=179.904 s, sync=0.006 s, total=179.921 s",
  ],
  [24, OTHER_APP_SESSION, "ERROR", "deadlock detected"],
  [
    24,
    OTHER_APP_SESSION,
    "DETAIL",
    "Process 24102 waits for ShareLock on transaction 9123411; blocked by process 23817.",
  ],
  [
    24,
    OTHER_APP_SESSION,
    "STATEMENT",
    "UPDATE inventory SET reserved = reserved + 1 WHERE sku = $1",
  ],
  [
    21,
    OTHER_APP_SESSION,
    "ERROR",
    'duplicate key value violates unique constraint "orders_idempotency_key"',
  ],
  [
    16,
    APP_SESSION,
    "LOG",
    "duration: 3105.877 ms  statement: UPDATE orders SET status = 'shipped' WHERE id = ANY($1)",
  ],
  [11, AUTOVACUUM, "LOG", 'automatic analyze of table "orders.public.orders"'],
  [
    7,
    OTHER_APP_SESSION,
    "ERROR",
    "canceling statement due to statement timeout",
  ],
  [
    4,
    APP_SESSION,
    "LOG",
    "disconnection: session time: 0:48:12.211 user=orders_app database=orders host=10.0.1.23 port=52344",
  ],
  [2, CHECKPOINTER, "LOG", "checkpoint starting: time"],
];

/*
 * nightly-export's last two runs, three and four days ago: the minutes
 * after the run's first line each was written, and its message as the
 * Node.js runtime writes it.
 */
const NIGHTLY_EXPORT_RUNS = [
  [
    [
      0,
      "START RequestId: 5f1e2d3c-1a2b-4c5d-8e9f-0a1b2c3d4e5f Version: $LATEST",
    ],
    [
      0.1,
      "{time}\t5f1e2d3c-1a2b-4c5d-8e9f-0a1b2c3d4e5f\tINFO\tExporting 18,204 orders to s3://acme-exports/orders/",
    ],
    [
      11.4,
      "{time}\t5f1e2d3c-1a2b-4c5d-8e9f-0a1b2c3d4e5f\tINFO\tExported 18,204 orders in 11 parts",
    ],
    [11.5, "END RequestId: 5f1e2d3c-1a2b-4c5d-8e9f-0a1b2c3d4e5f"],
    [
      11.5,
      "REPORT RequestId: 5f1e2d3c-1a2b-4c5d-8e9f-0a1b2c3d4e5f\tDuration: 684012.35 ms\tBilled Duration: 684013 ms\tMemory Size: 1024 MB\tMax Memory Used: 611 MB",
    ],
  ],
  [
    [
      0,
      "START RequestId: 9a8b7c6d-2b3c-4d5e-9f0a-1b2c3d4e5f6a Version: $LATEST",
    ],
    [
      0.1,
      "{time}\t9a8b7c6d-2b3c-4d5e-9f0a-1b2c3d4e5f6a\tINFO\tExporting 61,377 orders to s3://acme-exports/orders/",
    ],
    [
      9.2,
      "{time}\t9a8b7c6d-2b3c-4d5e-9f0a-1b2c3d4e5f6a\tWARN\tPart 7 of 37 took 41 s: the bucket is throttling writes",
    ],
    [
      15,
      "{time}\t9a8b7c6d-2b3c-4d5e-9f0a-1b2c3d4e5f6a\tERROR\tTask timed out after 900.00 seconds",
    ],
    [15, "END RequestId: 9a8b7c6d-2b3c-4d5e-9f0a-1b2c3d4e5f6a"],
    [
      15,
      "REPORT RequestId: 9a8b7c6d-2b3c-4d5e-9f0a-1b2c3d4e5f6a\tDuration: 900000.00 ms\tBilled Duration: 900000 ms\tMemory Size: 1024 MB\tMax Memory Used: 1024 MB\tStatus: timeout",
    ],
  ],
];

// The ids and identities of the rows: stable, and real uuids.
function rowId(group, index) {
  return `30a00000-0000-4000-8000-${String(group * 1000 + index).padStart(12, "0")}`;
}

// The resource attributes the Firehose ingest stamps on a group's logs.
function resourceAttributes(logGroup, region) {
  const filed = getAwsLogGroupAttributes({
    logGroup,
    accountId: STREAM_ACCOUNT_ID,
    region,
  });
  const attributes = {
    "resource.service.name": STREAM_SERVICE_NAME,
    "resource.cloud.provider": "aws",
    [`resource.${CLOUD_CONNECTION_ID_ATTRIBUTE}`]: STREAM_CONNECTION_ID,
    "resource.cloud.account.id": STREAM_ACCOUNT_ID,
    "resource.cloud.region": region,
    "resource.aws.log.group.name": logGroup,
    // The service the ingest files the rows under, as it stamps every row.
    "oneuptime.service.id": STREAM_SERVICE_ID,
    "oneuptime.service.name": STREAM_SERVICE_NAME,
  };
  for (const [key, value] of Object.entries(filed)) {
    attributes[`resource.${key}`] = value;
  }
  return attributes;
}

/*
 * The severity the ingest stores for a line: the number the line says
 * (CloudWatchLogSeverity), bucketed as OtelLogsIngestService.getSeverityText
 * buckets it.
 */
function severityOf(body) {
  const said = inferCloudWatchLogSeverity(body);
  const number = said ? said.number : 0;
  if (number >= 21) {
    return LogSeverity.Fatal;
  }
  if (number >= 17) {
    return LogSeverity.Error;
  }
  if (number >= 13) {
    return LogSeverity.Warning;
  }
  if (number >= 9) {
    return LogSeverity.Information;
  }
  if (number >= 5) {
    return LogSeverity.Debug;
  }
  return number >= 1 ? LogSeverity.Trace : LogSeverity.Unspecified;
}

function row(data) {
  return {
    _id: rowId(data.group, data.index),
    projectId: new ObjectID(data.projectId),
    time: new Date(data.time),
    body: data.body,
    severityText: severityOf(data.body),
    primaryEntityId: new ObjectID(STREAM_SERVICE_ID),
    primaryEntityType: ServiceType.OpenTelemetry,
    traceId: "",
    spanId: "",
    attributes: {
      ...resourceAttributes(data.logGroup, data.region),
      "aws.log.stream.name": data.stream,
      "aws.log.event.id": `${3800000000000000 + data.group * 1000 + data.index}`,
    },
  };
}

/*
 * Every row the stream delivered, for a page loaded at `now`: one now for
 * every time the fixture stamps, so a line written "2 minutes ago" stays
 * inside "Past 1 Hour" while a test runs.
 */
export function buildStreamedLogs(projectId, now) {
  const rows = [];

  ORDERS_DB_LINES.forEach(([minutesAgo, session, level, message], index) => {
    const time = now - minutesAgo * MINUTE - index * 1000;
    rows.push(
      row({
        projectId,
        group: 1,
        index,
        time,
        logGroup: ORDERS_DB_LOG_GROUP,
        region: ORDERS_DB_REGION,
        stream: "orders-db.0",
        body: postgresLine(time, session, level, message),
      }),
    );
  });

  // Its last runs started at 02:00 UTC three and four days ago.
  const lastRunStart = Math.floor((now - 3 * DAY) / DAY) * DAY + 2 * HOUR;
  NIGHTLY_EXPORT_RUNS.forEach((lines, run) => {
    const start = lastRunStart - (NIGHTLY_EXPORT_RUNS.length - 1 - run) * DAY;
    const stream = `${new Date(start).toISOString().slice(0, 10).split("-").join("/")}/[$LATEST]6f0e1d2c3b4a59687${run}`;
    lines.forEach(([minutesIn, message], index) => {
      const time = start + minutesIn * MINUTE;
      rows.push(
        row({
          projectId,
          group: 2 + run,
          index,
          time,
          logGroup: NIGHTLY_EXPORT_LOG_GROUP,
          region: NIGHTLY_EXPORT_REGION,
          stream,
          body: message.split("{time}").join(isoTime(time)),
        }),
      );
    });
  });

  return rows;
}

/*
 * ---------------------------------------------------------------------------
 * The logs viewer's reads, answered as the server answers them.
 * ---------------------------------------------------------------------------
 */

function toTime(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

// An attributes filter's value as the viewer sent it: a string, or { value }.
function attributeValue(value) {
  if (value && typeof value === "object" && "value" in value) {
    return String(value.value);
  }
  return String(value);
}

function matchesAttributes(item, attributes) {
  return Object.entries(attributes || {}).every(([key, value]) => {
    return String((item.attributes || {})[key]) === attributeValue(value);
  });
}

function isInWindow(item, start, end) {
  const time = toTime(item.time);
  return time >= start && time <= end;
}

// A list or count query (AnalyticsModelAPI) over the rows, or null with why.
function rowsOfQuery(rows, query) {
  const unmodelled = [];
  let start = -Infinity;
  let end = Infinity;
  const conditions = { ...(query || {}) };

  if (conditions.time instanceof InBetween) {
    start = toTime(conditions.time.startValue);
    end = toTime(conditions.time.endValue);
  } else if (conditions.time !== undefined) {
    unmodelled.push("time");
  }
  delete conditions.time;

  const attributes = conditions.attributes;
  delete conditions.attributes;
  delete conditions.projectId;

  for (const [key, value] of Object.entries(conditions)) {
    if (value === undefined) {
      continue;
    }
    if (key === "severityText" && typeof value === "string") {
      continue;
    }
    unmodelled.push(key);
  }

  const found = rows.filter((item) => {
    return (
      isInWindow(item, start, end) &&
      matchesAttributes(item, attributes) &&
      (typeof conditions.severityText !== "string" ||
        item.severityText === conditions.severityText)
    );
  });

  return { rows: found, unmodelled };
}

function sortByTime(rows, sort) {
  const order = sort && sort.time === SortOrder.Ascending ? 1 : -1;
  return [...rows].sort((left, right) => {
    return order * (toTime(left.time) - toTime(right.time));
  });
}

function projected(item, select) {
  if (!select) {
    return Object.assign(new Log(), item);
  }
  const out = { _id: item._id };
  for (const key of Object.keys(select)) {
    if (item[key] !== undefined) {
      out[key] = item[key];
    }
  }
  return Object.assign(new Log(), out);
}

/*
 * POST /log/get-list: one row past the page is read, so `count` is a lower
 * bound while more follow (hasMore), as BaseAnalyticsAPI answers it.
 */
export function listStreamedLogs(rows, options, unhandled) {
  const { rows: found, unmodelled } = rowsOfQuery(rows, options.query);
  for (const field of unmodelled) {
    unhandled.push({ kind: "log.getList", field });
  }
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);
  const sorted = sortByTime(found, options.sort);
  const page = sorted.slice(skip, skip + limit);
  const hasMore = sorted.length > skip + limit;
  return {
    data: page.map((item) => {
      return projected(item, options.select);
    }),
    count: skip + page.length + (hasMore ? 1 : 0),
    skip,
    limit,
    hasMore,
  };
}

// POST /log/count: how many rows the query matches, exactly.
export function countStreamedLogs(rows, query, unhandled) {
  const { rows: found, unmodelled } = rowsOfQuery(rows, query);
  for (const field of unmodelled) {
    unhandled.push({ kind: "log.count", field });
  }
  return found.length;
}

/*
 * The filters a histogram or facets request carries, beside its window and
 * shape: the ones the fixture models. Anything else lands on `unhandled`.
 */
const BODY_FILTERS = {
  attributes: (item, attributes) => {
    return matchesAttributes(item, attributes);
  },
  severityTexts: (item, severities) => {
    return severities.includes(item.severityText || LogSeverity.Unspecified);
  },
  excludedSeverityTexts: (item, severities) => {
    return !severities.includes(item.severityText || LogSeverity.Unspecified);
  },
  serviceIds: (item, ids) => {
    return ids.map(String).includes(String(item.primaryEntityId));
  },
  excludedServiceIds: (item, ids) => {
    return !ids.map(String).includes(String(item.primaryEntityId));
  },
  bodySearchText: (item, text) => {
    return String(item.body || "")
      .toLowerCase()
      .includes(String(text || "").toLowerCase());
  },
};

const REQUEST_SHAPE_FIELDS = new Set([
  "startTime",
  "endTime",
  "bucketSizeInMinutes",
  "facetKeys",
  "facetSearchText",
  "limit",
]);

function bodyRows(rows, body, path, unhandled) {
  const start = toTime(body.startTime);
  const end = toTime(body.endTime);
  const active = [];
  for (const [key, value] of Object.entries(body || {})) {
    if (
      REQUEST_SHAPE_FIELDS.has(key) ||
      value === undefined ||
      value === null
    ) {
      continue;
    }
    if (!BODY_FILTERS[key]) {
      unhandled.push({ kind: "api", path, filter: key });
      continue;
    }
    active.push([BODY_FILTERS[key], value]);
  }
  return rows.filter((item) => {
    return (
      isInWindow(item, start, end) &&
      active.every(([test, value]) => {
        return test(item, value);
      })
    );
  });
}

// TelemetryAPI's computeDefaultBucketSize.
function defaultBucketSizeInMinutes(start, end) {
  const minutes = (end - start) / MINUTE;
  if (minutes <= 60) {
    return 1;
  }
  if (minutes <= 360) {
    return 5;
  }
  if (minutes <= 1440) {
    return 15;
  }
  if (minutes <= 10080) {
    return 60;
  }
  if (minutes <= 43200) {
    return 360;
  }
  return 1440;
}

// A DateTime as ClickHouse's JSON output writes it: "2026-09-21 11:20:00".
function clickHouseDateTime(time) {
  return new Date(time).toISOString().slice(0, 19).replace("T", " ");
}

const SEVERITY_ORDER = Object.values(LogSeverity);

/*
 * POST /telemetry/logs/histogram (LogAggregationService.getHistogram): a
 * count per bucket and severity that has rows, in time order.
 */
export function streamedLogsHistogram(rows, body, unhandled) {
  const start = toTime(body.startTime);
  const end = toTime(body.endTime);
  const bucketSizeInMinutes =
    Number(body.bucketSizeInMinutes) || defaultBucketSizeInMinutes(start, end);
  const bucketMs = bucketSizeInMinutes * MINUTE;
  const counts = new Map();
  for (const item of bodyRows(
    rows,
    body,
    "/telemetry/logs/histogram",
    unhandled,
  )) {
    const bucket = Math.floor(toTime(item.time) / bucketMs) * bucketMs;
    const severity = item.severityText || LogSeverity.Unspecified;
    const key = `${bucket}|${severity}`;
    if (!counts.has(key)) {
      counts.set(key, { bucket, severity, count: 0 });
    }
    counts.get(key).count += 1;
  }
  const buckets = Array.from(counts.values())
    .sort((left, right) => {
      return (
        left.bucket - right.bucket ||
        SEVERITY_ORDER.indexOf(left.severity) -
          SEVERITY_ORDER.indexOf(right.severity)
      );
    })
    .map((entry) => {
      return {
        time: clickHouseDateTime(entry.bucket),
        severity: entry.severity,
        count: entry.count,
      };
    });
  return { bucketSizeInMinutes, buckets };
}

function countBy(items, valueOf) {
  const counts = new Map();
  for (const item of items) {
    const value = valueOf(item);
    if (value === undefined || value === null || value === "") {
      continue;
    }
    counts.set(String(value), (counts.get(String(value)) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => {
      return { value, count };
    })
    .sort((left, right) => {
      return right.count - left.count || left.value.localeCompare(right.value);
    });
}

/*
 * POST /telemetry/logs/facets: severity and the Service facet counted, and
 * every resource facet empty - the project has none of those resources a
 * stream's logs belong to (its Cloud Resources facet lists environments,
 * which it has none of: ResourceFacetResolver).
 */
export function streamedLogsFacets(rows, body, unhandled) {
  const found = bodyRows(rows, body, "/telemetry/logs/facets", unhandled);
  const facets = {};
  for (const key of body.facetKeys || []) {
    if (key === "severityText") {
      facets[key] = countBy(found, (item) => {
        return item.severityText || LogSeverity.Unspecified;
      });
    } else if (key === "primaryEntityId") {
      facets[key] = [
        {
          value: STREAM_SERVICE_ID,
          count: found.length,
          displayName: STREAM_SERVICE_NAME,
        },
      ];
    } else if (RESOURCE_FACET_CATALOG_KEYS.includes(key)) {
      facets[key] = [];
    } else {
      unhandled.push({
        kind: "api",
        path: "/telemetry/logs/facets",
        facetKey: key,
      });
      facets[key] = [];
    }
  }
  return { facets, timedOutFacets: [] };
}

// POST /telemetry/logs/get-attributes: every key the rows carry.
export function streamedLogsAttributeKeys(rows) {
  const keys = new Set();
  for (const item of rows) {
    for (const key of Object.keys(item.attributes || {})) {
      keys.add(key);
    }
  }
  return { attributes: Array.from(keys).sort() };
}

// POST /telemetry/logs/get-attribute-values: one key's values, most first.
export function streamedLogsAttributeValues(rows, body) {
  return {
    values: countBy(rows, (item) => {
      return (item.attributes || {})[body.attributeKey];
    }).map((entry) => {
      return entry.value;
    }),
  };
}
