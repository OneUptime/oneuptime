import Monitor from "./Monitor";
import Project from "./Project";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * WHICH NETWORK DEVICES A NETWORK DEVICE MONITOR WATCHES.
 *
 * One row for each device a Network Device monitor's steps name
 * (`monitorSteps...networkDeviceMonitor.networkDeviceId`), so a device's poll
 * and its traps find the monitors to evaluate by the device
 * (NetworkDeviceWalkUtil.findMonitorsWatchingDevices) instead of reading the
 * steps of every Network Device monitor in the project, as they did on every
 * poll and every trap.
 *
 * Postgres keeps it, not the app: triggers on "Monitor" rewrite a monitor's
 * rows whenever its steps, type or project change, and the foreign key
 * removes them with the monitor (migration AddMonitorNetworkDevice). So every
 * write keeps it right - a hooked or a hook-free one, a data migration, a
 * server of the previous release during a rolling upgrade - in the same
 * transaction as the write. Nothing in the app writes it.
 *
 * `networkDeviceId` has no foreign key on purpose: a step may name a device
 * that was deleted, or never existed, and the monitor must still save. Such a
 * row stays until the monitor's steps change, which is what lets the stale
 * poll check find monitors that watch a device that no longer exists.
 *
 * Internal: no API, no permission reads it. Root reads only.
 */
@TenantColumn("projectId")
@Index(["monitorId", "networkDeviceId"], { unique: true })
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "MonitorNetworkDevice",
  singularName: "Monitor Network Device",
  pluralName: "Monitor Network Devices",
  icon: IconProp.Signal,
  tableDescription:
    "The network devices each Network Device monitor watches, kept by the database from the monitor's steps.",
})
@Entity({
  name: "MonitorNetworkDevice",
})
export default class MonitorNetworkDevice extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Project ID",
    description:
      "ID of the project of the monitor, which is the project the device must be in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "monitorId",
    type: TableColumnType.Entity,
    modelType: Monitor,
    title: "Monitor",
    description: "The Network Device monitor whose steps name the device.",
  })
  @ManyToOne(
    () => {
      return Monitor;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "monitorId" })
  public monitor?: Monitor = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Monitor ID",
    description:
      "ID of the Network Device monitor whose steps name the device.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public monitorId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Network Device ID",
    description:
      "ID of the network device a step of the monitor names. Not a foreign key: the device may have been deleted.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public networkDeviceId?: ObjectID = undefined;
}
