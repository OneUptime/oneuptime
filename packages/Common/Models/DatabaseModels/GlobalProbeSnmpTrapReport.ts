import Probe, { PROBE_READERS } from "./Probe";
import Project from "./Project";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import ServerOwned from "../../Types/Database/ServerOwned";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { SnmpTrapRefusal } from "../../Types/Probe/SnmpTrapReceiver";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ONE PROJECT'S SHARE OF A GLOBAL PROBE'S SNMP TRAP RECEIVER REPORT
 * (OneUptime issue #11173).
 *
 * A project's own probe keeps its whole report (Probe.snmpTrapReceiver):
 * the SNMPv3 traps it refused, by source address and user name, are all
 * the project's own. A global probe serves many projects, so its report is
 * split as it arrives (Types/Probe/SnmpTrapRefusalShares): the refusals from
 * the addresses of one project's devices on the probe go into that
 * project's row here, and no other project's. The probe row keeps only what
 * belongs to no project - whether its receiver is on, its port and its
 * engine ID (SnmpTrapReceiverUtil.toSharedReport).
 *
 * Read on the project's devices' Overview and Logs, as a project probe's
 * report is, by the same people (PROBE_READERS), and only through the
 * project's own reads: `refusals` is read through no relation. Written only
 * by OneUptime, as the probe reports every thirty seconds, through the
 * service's raw SQL (GlobalProbeSnmpTrapReportService.recordShares), which
 * writes a row only when its share changed and deletes the rows of projects
 * the probe no longer refuses anything for.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: PROBE_READERS,
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/global-probe-snmp-trap-report"))
@Index(["projectId", "probeId"], { unique: true })
@TableMetadata({
  tableName: "GlobalProbeSnmpTrapReport",
  singularName: "Global Probe SNMP Trap Report",
  pluralName: "Global Probe SNMP Trap Reports",
  icon: IconProp.Signal,
  tableDescription:
    "The SNMPv3 traps a global probe refused in the last day from this project's network devices, kept for this project alone. Written by OneUptime as the probe reports them.",
})
@Entity({
  name: "GlobalProbeSnmpTrapReport",
})
export default class GlobalProbeSnmpTrapReport extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: PROBE_READERS,
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
    read: PROBE_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: PROBE_READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "probeId",
    type: TableColumnType.Entity,
    modelType: Probe,
    title: "Probe",
    description: "The global probe that refused these SNMPv3 traps.",
  })
  @ManyToOne(
    () => {
      return Probe;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "probeId" })
  public probe?: Probe = undefined;

  @ColumnAccessControl({
    create: [],
    read: PROBE_READERS,
    update: [],
  })
  // A project's reads go by ("projectId", "probeId") above; a probe's writes by this.
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Probe ID",
    description: "ID of the global probe that refused these SNMPv3 traps.",
    example: "a1b2c3d4-e5f6-7890-ab12-cd3456ef7890",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public probeId?: ObjectID = undefined;

  /*
   * The project's refused SNMPv3 traps, in the report's shape
   * (SnmpTrapRefusal): source address, reason, user name, how many and
   * when, the most recent first. Read by the project's own reads only,
   * never through a relation: what a relation drags along is read by whoever
   * may read the record that names it.
   */
  @ColumnAccessControl({
    create: [],
    read: PROBE_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Refused SNMPv3 Traps",
    description:
      "The SNMPv3 traps the global probe refused in the last day from this project's network devices, by source address, reason and user name. Written by OneUptime.",
    serverOwned: ServerOwned.Always,
    canReadOnRelationQuery: false,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public refusals?: Array<SnmpTrapRefusal> = undefined;
}
