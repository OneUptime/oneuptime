import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import {
  SECURITY_EVENT_LATE_ARRIVAL_IN_SECONDS,
  SECURITY_EVENT_LATE_ARRIVAL_KEPT_DAYS,
} from "../../Types/SecurityEvent/SecurityEventLateArrival";

/**
 * Security events that arrived more than a day after they happened, which
 * no detection rule's run judges (#10491; the why is in
 * Types/SecurityEvent/SecurityEventLateArrival). One row per project,
 * source and day they arrived, so Detection Rules can say how many, from
 * which sources and when they happened, without reading the events.
 *
 * Populated by `SecurityEventLateArrivalV1_mv`, which fires on every insert
 * into SecurityEventItemV1 and keeps only the rows written later than
 * SECURITY_EVENT_LATE_ARRIVAL_IN_SECONDS after they happened: the
 * complement, to the second, of the bound a rule's run holds every event
 * to (`time >= createdAt - toIntervalSecond(86400)`,
 * DetectionArrivalRead.isDetectionArrivalCandidate). Every writer of
 * security events is counted, with nothing added to any of them.
 *
 * Each row holds AggregateFunction states: count, and the earliest and
 * latest time the events happened and arrived - finalized with
 * countMerge / minMerge / maxMerge (SecurityEventLateArrivalService).
 *
 * primaryEntityId is kept so a read made for a person counts only the
 * sources that person may read (TelemetryReadAccess). No CRUD API is
 * exposed; it is read through SecurityEventLateArrivalService alone.
 */
export default class SecurityEventLateArrival extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project (tenant key, replicated from the event)",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
    });

    const dayColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "day",
      title: "Day",
      description:
        "The day the events arrived (toDate(createdAt)). Drives the table TTL.",
      required: true,
      type: TableColumnType.Date,
    });

    const primaryEntityIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityId",
        title: "Source ID",
        description:
          "The resource the events are attributed to (replicated from the event), so a read for a person counts only the sources they may read.",
        required: true,
        type: TableColumnType.ObjectID,
      });

    const vendorNameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "vendorName",
      title: "Vendor",
      description: "Vendor of the product that produced the events",
      required: true,
      type: TableColumnType.Text,
      isLowCardinality: true,
    });

    const productNameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "productName",
      title: "Product",
      description: "Product that produced the events",
      required: true,
      type: TableColumnType.Text,
      isLowCardinality: true,
    });

    const eventCountStateColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "eventCountState",
        title: "Event Count (state)",
        description:
          "AggregateFunction(count) state - the events that arrived late. Read via countMerge(eventCountState).",
        required: true,
        type: TableColumnType.AggregateFunction,
        aggregateFunctionDefinition: "count",
      });

    const happenedFromStateColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "happenedFromState",
        title: "Happened From (state)",
        description:
          "AggregateFunction(min) state of the events' time - when the earliest happened. Read via minMerge(happenedFromState).",
        required: true,
        type: TableColumnType.AggregateFunction,
        aggregateFunctionDefinition: "min, DateTime64(9)",
      });

    const happenedToStateColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "happenedToState",
        title: "Happened To (state)",
        description:
          "AggregateFunction(max) state of the events' time - when the latest happened. Read via maxMerge(happenedToState).",
        required: true,
        type: TableColumnType.AggregateFunction,
        aggregateFunctionDefinition: "max, DateTime64(9)",
      });

    const arrivedFromStateColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "arrivedFromState",
        title: "Arrived From (state)",
        description:
          "AggregateFunction(min) state of the events' createdAt - when the first arrived. Read via minMerge(arrivedFromState).",
        required: true,
        type: TableColumnType.AggregateFunction,
        aggregateFunctionDefinition: "min, DateTime",
      });

    const arrivedToStateColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "arrivedToState",
        title: "Arrived To (state)",
        description:
          "AggregateFunction(max) state of the events' createdAt - when the last arrived. Read via maxMerge(arrivedToState).",
        required: true,
        type: TableColumnType.AggregateFunction,
        aggregateFunctionDefinition: "max, DateTime",
      },
    );

    super({
      tableName: AnalyticsTableName.SecurityEventLateArrival,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Security Event Late Arrival",
      pluralName: "Security Event Late Arrivals",
      tableColumns: [
        projectIdColumn,
        dayColumn,
        primaryEntityIdColumn,
        vendorNameColumn,
        productNameColumn,
        eventCountStateColumn,
        happenedFromStateColumn,
        happenedToStateColumn,
        arrivedFromStateColumn,
        arrivedToStateColumn,
      ],
      projections: [],
      /*
       * Applied idempotently by the analytics schema sync on every boot
       * (AnalyticsTableManagement.createMaterializedViews), after every
       * table is created. The filter is the complement of a rule's run's
       * bound, so an event is either judged by a run or counted here.
       */
      materializedViews: [
        {
          name: `${AnalyticsTableName.SecurityEventLateArrival}_mv`,
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS ${AnalyticsTableName.SecurityEventLateArrival}_mv
TO ${AnalyticsTableName.SecurityEventLateArrival}
AS
SELECT
  projectId,
  toDate(createdAt) AS day,
  primaryEntityId,
  vendorName,
  productName,
  countState() AS eventCountState,
  minState(time) AS happenedFromState,
  maxState(time) AS happenedToState,
  minState(createdAt) AS arrivedFromState,
  maxState(createdAt) AS arrivedToState
FROM ${AnalyticsTableName.SecurityEvent}
WHERE time < createdAt - toIntervalSecond(${SECURITY_EVENT_LATE_ARRIVAL_IN_SECONDS})
GROUP BY projectId, day, primaryEntityId, vendorName, productName`,
        },
      ],
      /*
       * A read is one project's last week (SecurityEventLateArrivalService):
       * project, then day, so it touches a few granules.
       */
      sortKeys: [
        "projectId",
        "day",
        "primaryEntityId",
        "vendorName",
        "productName",
      ],
      primaryKeys: [
        "projectId",
        "day",
        "primaryEntityId",
        "vendorName",
        "productName",
      ],
      partitionKey: "toYYYYMM(day)",
      // A project's rows on one shard, so its read merges them locally.
      shardingKey: "cityHash64(projectId)",
      tableSettings: "ttl_only_drop_parts = 1",
      ttlExpression: `day + INTERVAL ${SECURITY_EVENT_LATE_ARRIVAL_KEPT_DAYS} DAY`,
      includeBaseColumns: false,
      defaultSortColumn: "day",
    });
  }
}
