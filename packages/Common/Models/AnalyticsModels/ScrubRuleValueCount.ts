import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import ObjectID from "../../Types/ObjectID";

/*
 * HOW MANY VALUES EACH SCRUB RULE CHANGED, BY SERVICE AND VERSION, EACH
 * HOUR (#10366).
 *
 * Ingest's scrub engines (Server/Utils/Telemetry/ScrubEngine) tell the rule
 * counter (Server/Utils/Telemetry/ScrubRuleValueCounter) each value a log
 * or trace scrub rule redacted, masked or hashed; it adds them up in memory
 * and writes one row per project, rule, kind of record, service, version
 * and hour through the telemetry fan-in writer, every few seconds - so a
 * busy rule is a handful of rows an hour, never a row a value. Rows of the
 * same key fold as they merge: their counts summed, the latest time a value
 * changed kept.
 *
 * Read by the scrub rule lists (how many values a rule changed this week,
 * by service and version) and by #10368, which proves a leak stopped at its
 * source when a service's new version changes nothing more. Kept 90 days.
 * No API reads the table itself: the rule lists ask a route that checks
 * the person may read scrub rules (Server/API/ScrubRuleValueCountsAPI), so
 * the model has no crudApiPath, MCP tools or documentation, and stays out
 * of the AnalyticsModels registry. Its service is registered with
 * AnalyticsServices only so boot creates the table.
 */

export const SCRUB_RULE_VALUE_COUNT_RETENTION_IN_DAYS: number = 90;

// Nobody reads or writes a row through the generic API: ingest and the route, as the server.
const NO_ONE: ColumnAccessControl = {
  read: [],
  create: [],
  update: [],
};

export default class ScrubRuleValueCount extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "The project whose scrub rule changed the values.",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
      accessControl: NO_ONE,
    });

    const scrubRuleIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "scrubRuleId",
      title: "Scrub Rule ID",
      description: "The log or trace scrub rule that changed the values.",
      required: true,
      type: TableColumnType.ObjectID,
      accessControl: NO_ONE,
    });

    const signalColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "signal",
      title: "Signal",
      description: 'The kind of record: "log" or "trace".',
      required: true,
      type: TableColumnType.Text,
      isLowCardinality: true,
      accessControl: NO_ONE,
    });

    const serviceIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "serviceId",
      title: "Service ID",
      description:
        "The service the records were sent under (their primaryEntityId), in lower case; empty for records stored under none.",
      required: true,
      type: TableColumnType.Text,
      accessControl: NO_ONE,
    });

    const serviceVersionColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "serviceVersion",
        title: "Service Version",
        description:
          "The records' service.version, as their resource sent it; empty when it sent none.",
        required: true,
        type: TableColumnType.Text,
        accessControl: NO_ONE,
      },
    );

    const hourColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "hour",
      title: "Hour",
      description:
        "The start of the hour the values were changed in. Drives the table's 90-day TTL.",
      required: true,
      type: TableColumnType.Date,
      accessControl: NO_ONE,
    });

    const valueCountColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "valueCount",
      title: "Value Count",
      description:
        "How many values the rule changed. SimpleAggregateFunction(sum), so merged rows add up.",
      required: true,
      type: TableColumnType.UInt64,
      simpleAggregateFunction: "sum",
      accessControl: NO_ONE,
    });

    const lastChangedAtColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "lastChangedAt",
      title: "Last Changed At",
      description:
        "The last time in the hour the rule changed a value. SimpleAggregateFunction(max), so merged rows keep the latest.",
      required: true,
      type: TableColumnType.Date,
      simpleAggregateFunction: "max",
      accessControl: NO_ONE,
    });

    super({
      tableName: AnalyticsTableName.ScrubRuleValueCount,
      // Rows of one key fold as they merge: counts summed, the latest time kept.
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Scrub Rule Value Count",
      pluralName: "Scrub Rule Value Counts",
      enableMCP: false,
      enableDocumentation: false,
      accessControl: {
        read: [],
        create: [],
        update: [],
        delete: [],
      },
      tableDescription:
        "How many values each log or trace scrub rule changed, by service and service version, an hour a row, kept 90 days. Read through the scrub rule lists.",
      tableColumns: [
        projectIdColumn,
        scrubRuleIdColumn,
        signalColumn,
        serviceIdColumn,
        serviceVersionColumn,
        hourColumn,
        valueCountColumn,
        lastChangedAtColumn,
      ],
      projections: [],
      /*
       * A read names the project and its rules, then a time range: they lead
       * the key. The rest keeps each service's and version's rows apart.
       */
      sortKeys: [
        "projectId",
        "scrubRuleId",
        "hour",
        "signal",
        "serviceId",
        "serviceVersion",
      ],
      primaryKeys: ["projectId", "scrubRuleId", "hour"],
      // A month's rows expire together, so a whole partition is dropped, never rewritten.
      partitionKey: "toYYYYMM(hour)",
      tableSettings: "ttl_only_drop_parts = 1",
      ttlExpression: `hour + INTERVAL ${SCRUB_RULE_VALUE_COUNT_RETENTION_IN_DAYS} DAY DELETE`,
      includeBaseColumns: false,
      defaultSortColumn: "hour",
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get scrubRuleId(): ObjectID | undefined {
    return this.getColumnValue("scrubRuleId") as ObjectID | undefined;
  }

  public set scrubRuleId(v: ObjectID | undefined) {
    this.setColumnValue("scrubRuleId", v);
  }

  public get signal(): string | undefined {
    return this.getColumnValue("signal") as string | undefined;
  }

  public set signal(v: string | undefined) {
    this.setColumnValue("signal", v);
  }

  public get serviceId(): string | undefined {
    return this.getColumnValue("serviceId") as string | undefined;
  }

  public set serviceId(v: string | undefined) {
    this.setColumnValue("serviceId", v);
  }

  public get serviceVersion(): string | undefined {
    return this.getColumnValue("serviceVersion") as string | undefined;
  }

  public set serviceVersion(v: string | undefined) {
    this.setColumnValue("serviceVersion", v);
  }

  public get hour(): Date | undefined {
    return this.getColumnValue("hour") as Date | undefined;
  }

  public set hour(v: Date | undefined) {
    this.setColumnValue("hour", v);
  }

  public get valueCount(): number | undefined {
    return this.getColumnValue("valueCount") as number | undefined;
  }

  public set valueCount(v: number | undefined) {
    this.setColumnValue("valueCount", v);
  }

  public get lastChangedAt(): Date | undefined {
    return this.getColumnValue("lastChangedAt") as Date | undefined;
  }

  public set lastChangedAt(v: Date | undefined) {
    this.setColumnValue("lastChangedAt", v);
  }
}
