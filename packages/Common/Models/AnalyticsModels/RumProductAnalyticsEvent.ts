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
import { PRODUCT_ANALYTICS_RETENTION_MONTHS } from "../../Types/Rum/ProductAnalytics";
import { PRODUCT_ANALYTICS_READ_PERMISSIONS } from "./RumProductAnalyticsSession";

/*
 * Product analytics events (issue #6444, part two): one row per event a RUM
 * recorder sent from a session - the session starting, a page viewed, a
 * track() call - whether or not Session Replay recorded the session.
 *
 * Written by the product analytics ingest worker
 * (App/FeatureSet/Telemetry/Services/ProductAnalyticsEventIngestService),
 * read only by Common/Server/Utils/RumProductAnalytics/
 * RumProductAnalyticsEventReadService: event trends and breakdowns,
 * funnels and retention. No CRUD API, no MCP.
 *
 * Who an event belongs to is resolved when it is READ, the way part one
 * files a session: the signed-in user the session named - at any point in
 * it, so the events before a sign-in in that session count for the user
 * too - else the browser's anonymous visitor id. So a row keeps both keys
 * as they were when the event was sent: identifiedUserKey (the one-way
 * HMAC of the reference identify() gave, only when the application
 * captures identity - never the reference) and visitorId.
 *
 * userProperties are the identify() traits the application listed for
 * analytics, and nothing else; they are kept like the rest of the row, for
 * PRODUCT_ANALYTICS_RETENTION_MONTHS calendar months by monthly partition,
 * and an erasure request removes a subject's rows here as well
 * (RumProductAnalyticsErasure).
 *
 * A plain MergeTree: an event happens once. A batch a recorder sent twice
 * (a retry after a lost answer) is refused at ingest by its batch id, so
 * the table is never asked to fold repeats.
 */

const accessControl: {
  read: Array<Permission>;
  create: Array<Permission>;
  update: Array<Permission>;
} = {
  read: PRODUCT_ANALYTICS_READ_PERMISSIONS,
  /* Written by the ingest worker alone. */
  create: [],
  update: [],
};

/* TTL: the first day of the PRODUCT_ANALYTICS_RETENTION_MONTHS-th month after. */
export const PRODUCT_ANALYTICS_EVENT_TTL: string = `toStartOfMonth(time) + INTERVAL ${PRODUCT_ANALYTICS_RETENTION_MONTHS} MONTH DELETE`;

type TextColumnDefinition = {
  key: string;
  title: string;
  description: string;
  isLowCardinality?: boolean;
  bloomFilter?: boolean;
};

const TEXT_COLUMNS: Array<TextColumnDefinition> = [
  {
    key: "sessionId",
    title: "Session ID",
    description: "Client-generated 32-hex session identifier",
    bloomFilter: true,
  },
  {
    key: "visitorId",
    title: "Visitor ID",
    description:
      "The recorder's random per-browser anonymous visitor id; '' when the event carried none",
    bloomFilter: true,
  },
  {
    key: "identifiedUserKey",
    title: "Identified User Key",
    description:
      "HMAC of the signed-in user's reference under the project's salt, as the event was sent; '' when nobody was signed in or the application does not capture identity. The erasure subject key.",
    bloomFilter: true,
  },
  {
    key: "page",
    title: "Page",
    description:
      "Path of the page (a mobile app's screen) the event happened on, without its query or fragment",
  },
  {
    key: "deviceType",
    title: "Device Type",
    description: "desktop, mobile or tablet; '' when not reported",
    isLowCardinality: true,
  },
  {
    key: "browserName",
    title: "Browser",
    description: "Browser family; '' for a mobile app or an unknown browser",
    isLowCardinality: true,
  },
  {
    key: "osName",
    title: "Operating System",
    description: "Operating system family, without its version",
    isLowCardinality: true,
  },
  {
    key: "countryCode",
    title: "Country Code",
    description: "ISO country derived at ingest; the IP itself is never stored",
    isLowCardinality: true,
  },
  {
    key: "appVersion",
    title: "App Version",
    description: "The mobile app's version; '' for a web page",
    isLowCardinality: true,
  },
];

/*
 * A row is about one RUM application, and rumApplicationId names nothing
 * else, so a member whose grants reach only some applications reads only
 * theirs (the routes check the same application before they read).
 */
@OwnedThrough("rumApplicationId", RumApplication, { onlyParentModels: true })
export default class RumProductAnalyticsEvent extends AnalyticsBaseModel {
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
        description: "RUM application the event belongs to",
        required: true,
        type: TableColumnType.ObjectID,
        accessControl: accessControl,
      });

    const kindColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "kind",
      title: "Kind",
      description:
        "session (a session started), page (a page or screen was viewed) or custom (the application called track())",
      required: true,
      type: TableColumnType.Text,
      isLowCardinality: true,
      accessControl: accessControl,
    });

    const nameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "name",
      title: "Name",
      description:
        "The event's name as track() gave it, the page's path for a page view, '' for a session start",
      required: true,
      type: TableColumnType.Text,
      codec: { codec: "ZSTD", level: 1 },
      accessControl: accessControl,
    });

    const timeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "time",
      title: "Time",
      description:
        "When the event happened, on the server's clock (the recorder's time moved by its clock's offset)",
      required: true,
      type: TableColumnType.DateTime64,
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      accessControl: accessControl,
    });

    const textColumns: Array<AnalyticsTableColumn> = TEXT_COLUMNS.map(
      (column: TextColumnDefinition): AnalyticsTableColumn => {
        return new AnalyticsTableColumn({
          key: column.key,
          title: column.title,
          description: column.description,
          required: true,
          defaultValue: "",
          type: TableColumnType.Text,
          isLowCardinality: column.isLowCardinality || false,
          codec: column.isLowCardinality
            ? undefined
            : { codec: "ZSTD", level: 1 },
          skipIndex: column.bloomFilter
            ? {
                name: `idx_${column.key.toLowerCase()}`,
                type: SkipIndexType.BloomFilter,
                params: [0.01],
                granularity: 1,
              }
            : undefined,
          accessControl: accessControl,
        });
      },
    );

    const propertiesColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "properties",
      title: "Properties",
      description:
        "The properties track() gave the event, as strings, under the track() caps",
      required: true,
      defaultValue: {},
      type: TableColumnType.MapStringString,
      codec: { codec: "ZSTD", level: 3 },
      accessControl: accessControl,
    });

    const userPropertiesColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "userProperties",
        title: "User Properties",
        description:
          "The identify() traits the application listed for product analytics, and no others; empty when nobody was signed in",
        required: true,
        defaultValue: {},
        type: TableColumnType.MapStringString,
        codec: { codec: "ZSTD", level: 3 },
        accessControl: accessControl,
      });

    super({
      tableName: AnalyticsTableName.RumProductAnalyticsEvent,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Product Analytics Event",
      pluralName: "Product Analytics Events",
      accessControl: {
        read: PRODUCT_ANALYTICS_READ_PERMISSIONS,
        create: [],
        update: [],
        delete: [],
      },
      /* The plan Session Replay needs: the recorders send these. */
      tableBillingAccessControl: {
        create: PlanType.Growth,
        read: PlanType.Growth,
        update: PlanType.Growth,
        delete: PlanType.Growth,
      },
      tableColumns: [
        projectIdColumn,
        rumApplicationIdColumn,
        kindColumn,
        nameColumn,
        timeColumn,
        ...textColumns,
        propertiesColumn,
        userPropertiesColumn,
      ],
      projections: [],
      /*
       * Every read is one application's events of one or a few names over
       * a range of time - a trend, a breakdown, a funnel's steps, a
       * retention's start and return - so the key leads with the
       * application and the event, then the time.
       */
      sortKeys: ["projectId", "rumApplicationId", "kind", "name", "time"],
      primaryKeys: ["projectId", "rumApplicationId", "kind", "name", "time"],
      partitionKey: "toYYYYMM(time)",
      /* A session's events on one shard, so a funnel reads them together. */
      shardingKey: "cityHash64(projectId, sessionId)",
      /*
       * Every row of a monthly partition expires on the same day, so whole
       * parts are dropped rather than rewritten row by row.
       */
      tableSettings: "ttl_only_drop_parts = 1",
      ttlExpression: PRODUCT_ANALYTICS_EVENT_TTL,
      includeBaseColumns: false,
      defaultSortColumn: "time",
    });
  }
}
