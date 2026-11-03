import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import CloudAccount from "../DatabaseModels/CloudAccount";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";

/*
 * What a cloud account cost: one figure per day, service, Region and, where
 * the cloud says it, resource - as each cloud's own billing reports it (AWS
 * Cost Explorer, Azure Cost Management, a Google Cloud billing export in
 * BigQuery), read by the account's cloud connection (CloudConnectionLanes'
 * costs lane). Costs are before credits and refunds.
 *
 * A day is read many times: today's cost grows all day, and a cloud
 * corrects the days before it for a while. The table only ever appends, so
 * the writer never writes a figure twice: it reads what is stored for the
 * window (one sum per day and series) and writes only the DIFFERENCE
 * between the cloud's figure and that sum (CloudCostWriter). The sum of a
 * day's rows is then always the cloud's latest figure - a lost write is
 * made up on the next read, a doubled one taken back with a negative row -
 * and every read of the table is a plain sum.
 *
 * Its own table, not the metrics': a year of daily rows would keep a part
 * of every daily partition of the metrics alive for as long (SloHistory
 * says why). Monthly partitions, kept CLOUD_COST_HISTORY_DAYS.
 *
 * Read through the account the cost belongs to: a caller whose grants are
 * limited to labels reads the costs of the accounts those reach.
 */

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadCloudResource,
];

// Written by the server only (the costs lane), never by a caller.
const createPermissions: Array<Permission> = [];

function column(data: {
  key: string;
  title: string;
  description: string;
  type: TableColumnType;
  isLowCardinality?: boolean | undefined;
  isTenantId?: boolean | undefined;
  defaultValue?: string | number | undefined;
  skipIndex?:
    | {
        name: string;
        type: SkipIndexType;
        params: Array<number>;
        granularity: number;
      }
    | undefined;
}): AnalyticsTableColumn {
  return new AnalyticsTableColumn({
    key: data.key,
    title: data.title,
    description: data.description,
    required: true,
    type: data.type,
    ...(data.isLowCardinality ? { isLowCardinality: true } : {}),
    ...(data.isTenantId ? { isTenantId: true } : {}),
    ...(data.defaultValue !== undefined
      ? { defaultValue: data.defaultValue }
      : {}),
    ...(data.skipIndex ? { skipIndex: data.skipIndex } : {}),
    accessControl: {
      read: readPermissions,
      create: createPermissions,
      update: [],
    },
  });
}

@OwnedThrough("cloudAccountId", CloudAccount, { onlyParentModels: true })
export default class CloudCost extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: AnalyticsTableName.CloudCost,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Cloud Cost",
      pluralName: "Cloud Costs",
      crudApiPath: new Route("/cloud-cost"),
      enableDocumentation: true,
      tableDescription:
        "What each connected cloud account cost: one figure per day, service, Region and, where the cloud reports it, resource, from AWS Cost Explorer, Azure Cost Management or a Google Cloud billing export. Before credits and refunds. Query sums through /aggregate.",
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
        delete: [],
      },
      tableColumns: [
        column({
          key: "projectId",
          title: "Project ID",
          description: "ID of project",
          type: TableColumnType.ObjectID,
          isTenantId: true,
        }),
        column({
          key: "cloudAccountId",
          title: "Cloud Account ID",
          description:
            "ID of the CloudAccount the cost belongs to: the AWS account, Azure subscription or Google Cloud project billed for it.",
          type: TableColumnType.ObjectID,
        }),
        column({
          key: "cloudConnectionId",
          title: "Cloud Connection ID",
          description: "ID of the CloudConnection that read the cost.",
          type: TableColumnType.ObjectID,
        }),
        column({
          key: "provider",
          title: "Cloud Provider",
          description: "aws, azure or gcp.",
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        column({
          key: "accountId",
          title: "Account",
          description:
            "The account's id in its cloud: an AWS account id, an Azure subscription id or a Google Cloud project id.",
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        column({
          key: "day",
          title: "Day",
          description: "The UTC day the cost is for, at its start.",
          type: TableColumnType.Date,
        }),
        column({
          key: "service",
          title: "Service",
          description:
            'The cloud service billed, as its billing names it: "Amazon Elastic Compute Cloud - Compute", "Virtual Machines", "Compute Engine".',
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        column({
          key: "region",
          title: "Region",
          description:
            "The Region the cost was incurred in; empty for a global service or a cost no Region is given for.",
          type: TableColumnType.Text,
          isLowCardinality: true,
          defaultValue: "",
        }),
        column({
          key: "resourceId",
          title: "Resource",
          description:
            "The resource the cost is for, as its cloud names it - an ARM id in lower case, a full resource name - matching the resource's Provider Resource ID (getCloudCostResourceKey); empty for a cost the cloud does not attribute to one resource.",
          type: TableColumnType.Text,
          defaultValue: "",
          skipIndex: {
            name: "idx_resource_id",
            type: SkipIndexType.BloomFilter,
            params: [0.01],
            granularity: 1,
          },
        }),
        column({
          key: "cost",
          title: "Cost",
          description:
            "The amount this row adds to the day's figure for its series; the sum of a series' rows for a day is the cloud's latest figure for it.",
          type: TableColumnType.Decimal,
        }),
        column({
          key: "currency",
          title: "Currency",
          description: 'The currency the cost is in, e.g. "USD".',
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        column({
          key: "readAt",
          title: "Read At",
          description: "When the cloud connection read the figure.",
          type: TableColumnType.Date,
        }),
      ],
      projections: [],
      sortKeys: ["projectId", "cloudAccountId", "day", "service"],
      primaryKeys: ["projectId", "cloudAccountId", "day", "service"],
      /*
       * Monthly partitions: a day's rows of every account share their
       * day's month, so the fixed-interval TTL below expires whole
       * partitions cleanly under ttl_only_drop_parts.
       */
      partitionKey: "toYYYYMM(day)",
      // One account's costs on one shard: every read sums an account's rows.
      shardingKey: "cityHash64(projectId, cloudAccountId)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "day + INTERVAL 400 DAY",
      defaultSortColumn: "day",
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get cloudAccountId(): ObjectID | undefined {
    return this.getColumnValue("cloudAccountId") as ObjectID | undefined;
  }

  public set cloudAccountId(v: ObjectID | undefined) {
    this.setColumnValue("cloudAccountId", v);
  }

  public get cloudConnectionId(): ObjectID | undefined {
    return this.getColumnValue("cloudConnectionId") as ObjectID | undefined;
  }

  public set cloudConnectionId(v: ObjectID | undefined) {
    this.setColumnValue("cloudConnectionId", v);
  }

  public get provider(): string | undefined {
    return this.getColumnValue("provider") as string | undefined;
  }

  public set provider(v: string | undefined) {
    this.setColumnValue("provider", v);
  }

  public get accountId(): string | undefined {
    return this.getColumnValue("accountId") as string | undefined;
  }

  public set accountId(v: string | undefined) {
    this.setColumnValue("accountId", v);
  }

  public get day(): Date | undefined {
    return this.getColumnValue("day") as Date | undefined;
  }

  public set day(v: Date | undefined) {
    this.setColumnValue("day", v);
  }

  public get service(): string | undefined {
    return this.getColumnValue("service") as string | undefined;
  }

  public set service(v: string | undefined) {
    this.setColumnValue("service", v);
  }

  public get region(): string | undefined {
    return this.getColumnValue("region") as string | undefined;
  }

  public set region(v: string | undefined) {
    this.setColumnValue("region", v);
  }

  public get resourceId(): string | undefined {
    return this.getColumnValue("resourceId") as string | undefined;
  }

  public set resourceId(v: string | undefined) {
    this.setColumnValue("resourceId", v);
  }

  public get cost(): number | undefined {
    return this.getColumnValue("cost") as number | undefined;
  }

  public set cost(v: number | undefined) {
    this.setColumnValue("cost", v);
  }

  public get currency(): string | undefined {
    return this.getColumnValue("currency") as string | undefined;
  }

  public set currency(v: string | undefined) {
    this.setColumnValue("currency", v);
  }

  public get readAt(): Date | undefined {
    return this.getColumnValue("readAt") as Date | undefined;
  }

  public set readAt(v: Date | undefined) {
    this.setColumnValue("readAt", v);
  }
}
