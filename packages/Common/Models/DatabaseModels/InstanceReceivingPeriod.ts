import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import { Column, Entity, Index } from "typeorm";

/*
 * When this OneUptime instance was receiving data (issue #2825).
 *
 * Every process that takes ingress traffic records, every
 * RECEIVING_HEARTBEAT_INTERVAL_MS, that it is up and can take in and store
 * data (InstanceReceivingHeartbeat). A row is one unbroken stretch of that:
 * the heartbeat moves `lastReceivingAt` forward, and once no process has
 * recorded one for RECEIVING_GAP_THRESHOLD_MS the next heartbeat starts a
 * new row. The time between two rows is time OneUptime was not receiving -
 * a restart, an upgrade, a datastore it could not reach - and
 * ReceivingCoverage keeps that time out of every "silent for too long"
 * verdict and every availability chart.
 *
 * Both columns are written with the database's clock, so replicas whose own
 * clocks disagree still write one consistent timeline. Instance-wide (no
 * project) and internal: root services write and read it, and it has no
 * CRUD API.
 */
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "InstanceReceivingPeriod",
  singularName: "Instance Receiving Period",
  pluralName: "Instance Receiving Periods",
  icon: IconProp.Heartbeat,
  tableDescription:
    "Internal record of the stretches of time this instance was up and receiving data.",
})
@Entity({
  name: "InstanceReceivingPeriod",
})
export default class InstanceReceivingPeriod extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Started At",
    description:
      "The first receiving heartbeat of this stretch: when the instance started receiving again.",
  })
  @Index()
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public startedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Last Receiving At",
    description:
      "The latest receiving heartbeat of this stretch: the instance was receiving at least until then.",
  })
  @Index()
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public lastReceivingAt?: Date = undefined;
}
