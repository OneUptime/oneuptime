import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import { Column, Entity, Index } from "typeorm";

export enum InstanceHealthLogEventType {
  ClickHouseCapacityNotification = "ClickHouseCapacityNotification",
  ClickHouseDataPruning = "ClickHouseDataPruning",
}

export enum InstanceHealthLogStatus {
  NotificationActive = "NotificationActive",
  Resolved = "Resolved",
  Running = "Running",
  WaitingForReclaim = "WaitingForReclaim",
  Succeeded = "Succeeded",
  Partial = "Partial",
  TargetUnreachable = "TargetUnreachable",
  Failed = "Failed",
}

const decimalNumberTransformer: {
  to: (value: number | null | undefined) => number | null | undefined;
  from: (value: string | number | null | undefined) => number | undefined;
} = {
  to: (value: number | null | undefined): number | null | undefined => {
    return value;
  },
  from: (value: string | number | null | undefined): number | undefined => {
    if (value === undefined || value === null) {
      return undefined;
    }

    return typeof value === "number" ? value : Number(value);
  },
};

/*
 * Internal, instance-wide audit trail for capacity notifications and automatic
 * ClickHouse pruning. It intentionally has no CRUD API: root services write
 * it and the custom master-admin health endpoint reads it.
 */
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "InstanceHealthLog",
  singularName: "Instance Health Log",
  pluralName: "Instance Health Logs",
  icon: IconProp.Logs,
  tableDescription:
    "Internal log of instance capacity notifications and automatic data-pruning work.",
})
@Entity({
  name: "InstanceHealthLog",
})
@Index(["eventType", "createdAt"])
export default class InstanceHealthLog extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Event Type",
    description: "The instance-health event represented by this log entry.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public eventType?: InstanceHealthLogEventType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description: "Current or final status of the instance-health work.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: InstanceHealthLogStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    title: "Message",
    description: "Human-readable summary of the event or work performed.",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public message?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Completed At",
    description: "When this instance-health operation reached a final state.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public completedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Next Check At",
    description:
      "Earliest time capacity should be checked again while ClickHouse reclaims inactive parts.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public nextCheckAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Capacity Before (%)",
    description: "Highest ClickHouse node capacity before the operation.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalNumberTransformer,
  })
  public capacityBeforePercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Capacity After (%)",
    description: "Highest ClickHouse node capacity after the operation.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalNumberTransformer,
  })
  public capacityAfterPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Threshold (%)",
    description: "Configured capacity threshold used for this event.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public thresholdPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Target (%)",
    description: "Configured capacity target for pruning work.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public targetPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigNumber,
    title: "Estimated Freed Bytes",
    description: "Estimated number of bytes freed by the pruning work.",
  })
  @Column({
    nullable: true,
    type: ColumnType.BigNumber,
    transformer: {
      to: (value: number | undefined): string | undefined => {
        if (value === undefined || value === null) {
          return undefined;
        }

        return value.toString();
      },
      from: (value: string | undefined): number | undefined => {
        if (value === undefined || value === null) {
          return undefined;
        }

        return Number(value);
      },
    },
  })
  public estimatedFreedBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Metadata",
    description:
      "Structured details about affected nodes, tables, partitions, and errors.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public metadata?: JSONObject = undefined;
}
