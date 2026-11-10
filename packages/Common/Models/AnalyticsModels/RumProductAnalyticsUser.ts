import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import {
  PRODUCT_ANALYTICS_READ_PERMISSIONS,
  PRODUCT_ANALYTICS_SOURCE_DEVICE_TYPE_SQL,
} from "./RumProductAnalyticsSession";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import Permission from "../../Types/Permission";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import RumApplication from "../DatabaseModels/RumApplication";
import {
  PRODUCT_ANALYTICS_IDENTIFIED_PREFIX,
  PRODUCT_ANALYTICS_RETENTION_MONTHS,
  PRODUCT_ANALYTICS_VISITOR_PREFIX,
} from "../../Types/Rum/ProductAnalytics";

/*
 * Product analytics, one row per person per calendar month (issue #6444).
 *
 * What makes "new", "returning", "dormant" and "total" users cheap: whether
 * someone came before a range, and when they last came, is one row per
 * month they came in rather than every session they had. Filled by
 * RumProductAnalyticsUserV1_mv, below, from the FINISHED session headers
 * the finalizer writes into RumSessionV1 - not the provisional one a
 * session's first chunk writes - because a person who signs in during a
 * session is only known as that user once the session is finished: filed
 * from the first chunk, the same visit would also make up an anonymous
 * visitor who never came back. A session still recording is counted from
 * RumProductAnalyticsSessionV1 instead, which every write fills. Pinned
 * copies are left out: they repeat a session already counted.
 *
 * A person is the signed-in user a session named, else the browser it came
 * from ("u:" + the user key's HMAC, "v:" + the visitor id); a session with
 * neither is nobody's and is not filed here.
 *
 * The month is part of the key, so a person's months never merge into one
 * row: reads fold them with min, max and the -Merge combinators. That is
 * what lets a whole month be dropped PRODUCT_ANALYTICS_RETENTION_MONTHS
 * after it with the session rows of the same month, and keeps every
 * partition's rows expiring on one day.
 *
 * Who a signed-in user is - the readable reference identify() was given -
 * is deliberately NOT kept here: this table outlives the recordings by
 * months, and a name or an email kept as long would be a disclosure Session
 * Replay never made. The people list shows the reference from the
 * recordings still kept (RumSessionV1, under its own retention and its own
 * column ACL), and the one-way key alone once they are gone. An erasure
 * request for the user removes their rows here too.
 */

const accessControl: {
  read: Array<Permission>;
  create: Array<Permission>;
  update: Array<Permission>;
} = {
  read: PRODUCT_ANALYTICS_READ_PERMISSIONS,
  create: [],
  update: [],
};

/* argMax over the session's start: the latest session's value wins. */
const LATEST_STRING_STATE: string = "argMax, String, DateTime64(9)";

/* Read through its RUM application, like RumProductAnalyticsSession. */
@OwnedThrough("rumApplicationId", RumApplication, { onlyParentModels: true })
export default class RumProductAnalyticsUser extends AnalyticsBaseModel {
  public constructor() {
    const keyColumns: Array<AnalyticsTableColumn> = [
      new AnalyticsTableColumn({
        key: "projectId",
        title: "Project ID",
        description: "ID of project",
        required: true,
        type: TableColumnType.ObjectID,
        isTenantId: true,
        accessControl: accessControl,
      }),
      new AnalyticsTableColumn({
        key: "rumApplicationId",
        title: "RUM Application ID",
        description: "RUM application the person used",
        required: true,
        type: TableColumnType.ObjectID,
        accessControl: accessControl,
      }),
      new AnalyticsTableColumn({
        key: "personKey",
        title: "Person Key",
        description: `${PRODUCT_ANALYTICS_IDENTIFIED_PREFIX} and the signed-in user's key, or ${PRODUCT_ANALYTICS_VISITOR_PREFIX} and the browser's visitor id`,
        required: true,
        type: TableColumnType.Text,
        codec: { codec: "ZSTD", level: 1 },
        accessControl: accessControl,
      }),
      new AnalyticsTableColumn({
        key: "month",
        title: "Month",
        description:
          "First day of the month the sessions started in (UTC); drives the monthly partition and the TTL",
        required: true,
        type: TableColumnType.Date,
        accessControl: accessControl,
      }),
    ];

    const measureColumns: Array<AnalyticsTableColumn> = [
      new AnalyticsTableColumn({
        key: "firstSeen",
        title: "First Seen",
        description: "Start of the person's first finished session that month",
        required: true,
        type: TableColumnType.DateTime64,
        simpleAggregateFunction: "min",
        accessControl: accessControl,
      }),
      new AnalyticsTableColumn({
        key: "lastSeen",
        title: "Last Seen",
        description: "Start of the person's last finished session that month",
        required: true,
        type: TableColumnType.DateTime64,
        simpleAggregateFunction: "max",
        accessControl: accessControl,
      }),
      new AnalyticsTableColumn({
        key: "sessions",
        title: "Sessions",
        description:
          "AggregateFunction(uniq) of the month's session ids. Read via uniqMerge(sessions).",
        required: true,
        type: TableColumnType.AggregateFunction,
        aggregateFunctionDefinition: "uniq, String",
        accessControl: accessControl,
      }),
      new AnalyticsTableColumn({
        key: "deviceType",
        title: "Device Type",
        description:
          "Device type of the person's latest session that month (argMax state)",
        required: true,
        type: TableColumnType.AggregateFunction,
        aggregateFunctionDefinition: LATEST_STRING_STATE,
        accessControl: accessControl,
      }),
      new AnalyticsTableColumn({
        key: "countryCode",
        title: "Country Code",
        description:
          "Country of the person's latest session that month (argMax state)",
        required: true,
        type: TableColumnType.AggregateFunction,
        aggregateFunctionDefinition: LATEST_STRING_STATE,
        accessControl: accessControl,
      }),
    ];

    super({
      tableName: AnalyticsTableName.RumProductAnalyticsUser,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Product Analytics User",
      pluralName: "Product Analytics Users",
      accessControl: {
        read: PRODUCT_ANALYTICS_READ_PERMISSIONS,
        create: [],
        update: [],
        delete: [],
      },
      tableBillingAccessControl: {
        create: PlanType.Growth,
        read: PlanType.Growth,
        update: PlanType.Growth,
        delete: PlanType.Growth,
      },
      tableColumns: [...keyColumns, ...measureColumns],
      projections: [],
      materializedViews: [
        {
          name: "RumProductAnalyticsUserV1_mv",
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS RumProductAnalyticsUserV1_mv
TO RumProductAnalyticsUserV1
AS
SELECT
  projectId,
  rumApplicationId,
  if(identifiedUserKey != '', concat('${PRODUCT_ANALYTICS_IDENTIFIED_PREFIX}', identifiedUserKey), concat('${PRODUCT_ANALYTICS_VISITOR_PREFIX}', visitorId)) AS personKey,
  toStartOfMonth(startTime) AS month,
  minSimpleState(startTime) AS firstSeen,
  maxSimpleState(startTime) AS lastSeen,
  uniqState(sessionId) AS sessions,
  argMaxStateIf(${PRODUCT_ANALYTICS_SOURCE_DEVICE_TYPE_SQL}, startTime, deviceType != '') AS deviceType,
  argMaxStateIf(toString(countryCode), startTime, countryCode != '') AS countryCode
FROM RumSessionV1
WHERE isFinalized = 1 AND isPinnedCopy = 0 AND (identifiedUserKey != '' OR visitorId != '')
GROUP BY projectId, rumApplicationId, personKey, month`,
        },
      ],
      /*
       * A person's months sit together, so one person's history is a
       * narrow range of the key; the month last keeps the months apart.
       */
      sortKeys: ["projectId", "rumApplicationId", "personKey", "month"],
      primaryKeys: ["projectId", "rumApplicationId", "personKey", "month"],
      partitionKey: "toYYYYMM(month)",
      shardingKey: "cityHash64(projectId, personKey)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: `month + INTERVAL ${PRODUCT_ANALYTICS_RETENTION_MONTHS} MONTH DELETE`,
      includeBaseColumns: false,
      defaultSortColumn: "month",
    });
  }
}
