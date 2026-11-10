import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import Permission from "../../Types/Permission";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import RumApplication from "../DatabaseModels/RumApplication";
import {
  PRODUCT_ANALYTICS_IDENTIFIED_PREFIX,
  PRODUCT_ANALYTICS_RETENTION_MONTHS,
  PRODUCT_ANALYTICS_TABLET_MIN_SHORT_SIDE,
  PRODUCT_ANALYTICS_VISITOR_PREFIX,
} from "../../Types/Rum/ProductAnalytics";

/*
 * Product analytics, one row per session (issue #6444).
 *
 * Filled by RumProductAnalyticsSessionV1_mv, below, from every insert into
 * RumSessionV1: the provisional header a session's first chunk writes, the
 * one the finalizer writes when it ends, and the copies pinning writes. Each
 * insert becomes a row keyed by the session; the AggregatingMergeTree folds
 * a session's rows into one, every measure by max (or by union for the
 * pages), so a later, fuller write always wins and a repeated one changes
 * nothing. The session's start is part of the key: ingest clamps it once and
 * every write of a session carries the same value.
 *
 * What is copied is the session's summary, never its recording: who (the
 * signed-in user's key - an HMAC, never the reference itself - and the
 * browser's anonymous visitor id), on what (device type, browser, operating
 * system, country, app version), where (the entry page and the pages
 * visited, as the recorder scrubbed them) and how it went (length, pages,
 * errors, frustration). The signed-in user's readable reference is not
 * copied at all: it stays on the recording's own header, under the
 * recording's retention (see RumProductAnalyticsUserV1).
 *
 * Kept for PRODUCT_ANALYTICS_RETENTION_MONTHS calendar months by monthly
 * partition, apart from the recording's own retention - the point of the
 * table is to answer "how many people came this month" and "when did this
 * person first come" after the recordings are gone. replayRetentionDate
 * says until when the recording itself is kept, so a page can offer to
 * watch only what still exists. An erasure request removes a subject's rows
 * here as well (Workers/Jobs/Rum/ProcessSessionErasureRequests).
 *
 * Read only by Common/Server/Utils/RumProductAnalytics; no CRUD API, no MCP.
 */

/* ---- The expressions both product analytics views file a session by. ---- */

/*
 * The person a session belongs to: the signed-in user it named, else the
 * browser it came from, else nobody (''). Spelled over RumSessionV1's own
 * columns, for the views; the reads spell the same rule over the folded
 * columns of this table (RumProductAnalyticsReadService).
 */
export const PRODUCT_ANALYTICS_SOURCE_PERSON_KEY_SQL: string = `if(identifiedUserKey != '', concat('${PRODUCT_ANALYTICS_IDENTIFIED_PREFIX}', identifiedUserKey), if(visitorId != '', concat('${PRODUCT_ANALYTICS_VISITOR_PREFIX}', visitorId), ''))`;

/*
 * desktop, mobile or tablet. The browser recorder already says which; the
 * mobile recorder says ios or android, and a screen whose shorter side is
 * PRODUCT_ANALYTICS_TABLET_MIN_SHORT_SIDE points or more is a tablet's.
 * Anything else is not reported ('').
 */
export const PRODUCT_ANALYTICS_SOURCE_DEVICE_TYPE_SQL: string = `multiIf(deviceType IN ('ios', 'android'), if(least(viewportWidth, viewportHeight) >= ${PRODUCT_ANALYTICS_TABLET_MIN_SHORT_SIDE}, 'tablet', 'mobile'), deviceType IN ('desktop', 'mobile', 'tablet'), toString(deviceType), '')`;

/* A mobile app reports its own name as the browser: there is no browser. */
export const PRODUCT_ANALYTICS_SOURCE_BROWSER_SQL: string = `if(recorderKind = 'rn-view-tree' OR browserName = 'Unknown', '', toString(browserName))`;

/* The family alone: a mobile app reports "iOS 17.2", the browser "iOS". */
export const PRODUCT_ANALYTICS_SOURCE_OS_SQL: string = `multiIf(osName = 'Unknown', '', recorderKind = 'rn-view-tree', splitByChar(' ', toString(osName))[1], toString(osName))`;

/* A mobile app reports its version as the browser version; a web page has none. */
export const PRODUCT_ANALYTICS_SOURCE_APP_VERSION_SQL: string = `if(recorderKind = 'rn-view-tree' AND browserVersion != 'unknown', toString(browserVersion), '')`;

/* The path of the first page (app://<app>/<screen> for a mobile app). */
export const PRODUCT_ANALYTICS_SOURCE_ENTRY_PAGE_SQL: string = `path(entryUrl)`;

/*
 * The frustration total Session Replay counts: the four built-in signals
 * and the application's own signals that counted as frustration
 * (SessionReplayReadService's FRUSTRATION_TOTAL_EXPRESSION).
 */
export const PRODUCT_ANALYTICS_SOURCE_FRUSTRATION_SQL: string = `toInt32(rageClickCount + deadClickCount + errorClickCount + refreshRageCount + customSignalFrustrationCount)`;

/* TTL of both tables: the first day of the PRODUCT_ANALYTICS_RETENTION_MONTHS-th month after. */
export const PRODUCT_ANALYTICS_SESSION_TTL: string = `toStartOfMonth(startTime) + INTERVAL ${PRODUCT_ANALYTICS_RETENTION_MONTHS} MONTH DELETE`;

/*
 * Reading product analytics is listing sessions: the same permissions as
 * Session Replay's session list and Users page (RumSession's table read
 * ACL), checked by the routes, which are this table's only reader.
 */
export const PRODUCT_ANALYTICS_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.ReadRumSessionReplay,
  Permission.ReadRumSessionReplayPayload,
];

const accessControl: {
  read: Array<Permission>;
  create: Array<Permission>;
  update: Array<Permission>;
} = {
  read: PRODUCT_ANALYTICS_READ_PERMISSIONS,
  /* Written by the view alone. */
  create: [],
  update: [],
};

type MeasureDefinition = {
  key: string;
  title: string;
  description: string;
  type: TableColumnType;
  simpleAggregateFunction: string;
  bloomFilter?: boolean;
};

const MEASURES: Array<MeasureDefinition> = [
  {
    key: "endTime",
    title: "End Time",
    description: "When the session's last chunk arrived",
    type: TableColumnType.DateTime64,
    simpleAggregateFunction: "max",
  },
  {
    key: "durationMs",
    title: "Duration (ms)",
    description: "Wall-clock length of the session; 0 until it is finished",
    type: TableColumnType.BigNumber,
    simpleAggregateFunction: "max",
  },
  {
    key: "pageCount",
    title: "Page Count",
    description: "Pages (route changes) the session visited",
    type: TableColumnType.Number,
    simpleAggregateFunction: "max",
  },
  {
    key: "errorCount",
    title: "Error Count",
    description: "Uncaught errors and unhandled rejections in the session",
    type: TableColumnType.Number,
    simpleAggregateFunction: "max",
  },
  {
    key: "frustrationCount",
    title: "Frustration Count",
    description:
      "Rage, dead and error clicks, refresh rage and the application's own frustration signals",
    type: TableColumnType.Number,
    simpleAggregateFunction: "max",
  },
  {
    key: "identifiedUserKey",
    title: "Identified User Key",
    description:
      "HMAC of the signed-in user's reference under the project's salt; '' for a visitor who did not sign in. The erasure subject key.",
    type: TableColumnType.Text,
    simpleAggregateFunction: "max",
    bloomFilter: true,
  },
  {
    key: "visitorId",
    title: "Visitor ID",
    description:
      "The recorder's random per-browser visitor id; '' from a recorder that predates it",
    type: TableColumnType.Text,
    simpleAggregateFunction: "max",
    bloomFilter: true,
  },
  {
    key: "deviceType",
    title: "Device Type",
    description: "desktop, mobile or tablet; '' when not reported",
    type: TableColumnType.Text,
    simpleAggregateFunction: "max",
  },
  {
    key: "browserName",
    title: "Browser",
    description: "Browser family; '' for a mobile app or an unknown browser",
    type: TableColumnType.Text,
    simpleAggregateFunction: "max",
  },
  {
    key: "osName",
    title: "Operating System",
    description: "Operating system family, without its version",
    type: TableColumnType.Text,
    simpleAggregateFunction: "max",
  },
  {
    key: "countryCode",
    title: "Country Code",
    description: "ISO country derived at ingest; the IP itself is never stored",
    type: TableColumnType.Text,
    simpleAggregateFunction: "max",
  },
  {
    key: "appVersion",
    title: "App Version",
    description: "The mobile app's version; '' for a web page",
    type: TableColumnType.Text,
    simpleAggregateFunction: "max",
  },
  {
    key: "entryPage",
    title: "Entry Page",
    description:
      "Path of the session's first page, as the recorder scrubbed it",
    type: TableColumnType.Text,
    simpleAggregateFunction: "max",
  },
  {
    key: "pages",
    title: "Pages",
    description:
      "Distinct scrubbed paths the session visited (at most the 500 the finalizer keeps)",
    type: TableColumnType.ArrayText,
    simpleAggregateFunction: "groupUniqArrayArray",
  },
  {
    key: "isFinalized",
    title: "Is Finalized",
    description:
      "True once the session finished and its length and counts are final",
    type: TableColumnType.Boolean,
    simpleAggregateFunction: "max",
  },
  {
    key: "replayRetentionDate",
    title: "Replay Retention Date",
    description:
      "Until when the recording itself is kept (the latest of its copies)",
    type: TableColumnType.Date,
    simpleAggregateFunction: "max",
  },
];

/*
 * A row is about one RUM application, and rumApplicationId names nothing
 * else, so a member whose grants reach only some applications reads only
 * theirs (the routes check the same application before they read).
 */
@OwnedThrough("rumApplicationId", RumApplication, { onlyParentModels: true })
export default class RumProductAnalyticsSession extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
      accessControl: accessControl,
    });

    const rumApplicationIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "rumApplicationId",
        title: "RUM Application ID",
        description: "RUM application the session belongs to",
        required: true,
        type: TableColumnType.ObjectID,
        accessControl: accessControl,
      });

    const startTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "startTime",
      title: "Start Time",
      description:
        "Server-clamped session start, the same on every write of a session",
      required: true,
      type: TableColumnType.DateTime64,
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      accessControl: accessControl,
    });

    const sessionIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "sessionId",
      title: "Session ID",
      description: "Client-generated 32-hex session identifier",
      required: true,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
      skipIndex: {
        name: "idx_session_id",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: accessControl,
    });

    const measureColumns: Array<AnalyticsTableColumn> = MEASURES.map(
      (measure: MeasureDefinition): AnalyticsTableColumn => {
        return new AnalyticsTableColumn({
          key: measure.key,
          title: measure.title,
          description: measure.description,
          required: true,
          type: measure.type,
          simpleAggregateFunction: measure.simpleAggregateFunction,
          codec: { codec: "ZSTD", level: 1 },
          skipIndex: measure.bloomFilter
            ? {
                name: `idx_${measure.key.toLowerCase()}`,
                type: SkipIndexType.BloomFilter,
                params: [0.01],
                granularity: 1,
              }
            : undefined,
          accessControl: accessControl,
        });
      },
    );

    super({
      tableName: AnalyticsTableName.RumProductAnalyticsSession,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Product Analytics Session",
      pluralName: "Product Analytics Sessions",
      accessControl: {
        read: PRODUCT_ANALYTICS_READ_PERMISSIONS,
        create: [],
        update: [],
        delete: [],
      },
      /* The plan Session Replay needs, as the sessions come from it. */
      tableBillingAccessControl: {
        create: PlanType.Growth,
        read: PlanType.Growth,
        update: PlanType.Growth,
        delete: PlanType.Growth,
      },
      tableColumns: [
        projectIdColumn,
        rumApplicationIdColumn,
        startTimeColumn,
        sessionIdColumn,
        ...measureColumns,
      ],
      projections: [],
      materializedViews: [
        {
          name: "RumProductAnalyticsSessionV1_mv",
          /*
           * One FROM and no subquery: in cluster mode the view is rewritten
           * to read the local RumSessionV1 and write the local copy of this
           * table (applyClusterToMaterializedViewQuery), so both live on the
           * same shard - this table is sharded by the session, as
           * RumSessionV1 is.
           */
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS RumProductAnalyticsSessionV1_mv
TO RumProductAnalyticsSessionV1
AS
SELECT
  projectId,
  rumApplicationId,
  startTime,
  sessionId,
  maxSimpleState(endTime) AS endTime,
  maxSimpleState(toInt64(durationMs)) AS durationMs,
  maxSimpleState(pageCount) AS pageCount,
  maxSimpleState(errorCount) AS errorCount,
  maxSimpleState(${PRODUCT_ANALYTICS_SOURCE_FRUSTRATION_SQL}) AS frustrationCount,
  maxSimpleState(identifiedUserKey) AS identifiedUserKey,
  maxSimpleState(visitorId) AS visitorId,
  maxSimpleState(${PRODUCT_ANALYTICS_SOURCE_DEVICE_TYPE_SQL}) AS deviceType,
  maxSimpleState(${PRODUCT_ANALYTICS_SOURCE_BROWSER_SQL}) AS browserName,
  maxSimpleState(${PRODUCT_ANALYTICS_SOURCE_OS_SQL}) AS osName,
  maxSimpleState(toString(countryCode)) AS countryCode,
  maxSimpleState(${PRODUCT_ANALYTICS_SOURCE_APP_VERSION_SQL}) AS appVersion,
  maxSimpleState(${PRODUCT_ANALYTICS_SOURCE_ENTRY_PAGE_SQL}) AS entryPage,
  groupUniqArrayArraySimpleState(routes) AS pages,
  maxSimpleState(isFinalized) AS isFinalized,
  maxSimpleState(retentionDate) AS replayRetentionDate
FROM RumSessionV1
GROUP BY projectId, rumApplicationId, startTime, sessionId`,
        },
      ],
      /*
       * Every read is one application over a range of session starts, so
       * the key leads with both; sessionId last makes the key the session.
       */
      sortKeys: ["projectId", "rumApplicationId", "startTime", "sessionId"],
      primaryKeys: ["projectId", "rumApplicationId", "startTime", "sessionId"],
      partitionKey: "toYYYYMM(startTime)",
      shardingKey: "cityHash64(projectId, sessionId)",
      /*
       * Every row of a monthly partition expires on the same day, so whole
       * parts are dropped rather than rewritten row by row.
       */
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: PRODUCT_ANALYTICS_SESSION_TTL,
      includeBaseColumns: false,
      defaultSortColumn: "startTime",
    });
  }
}
