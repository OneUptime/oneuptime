import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { JSONObject } from "../../Types/JSON";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { SecurityTelemetrySourceKind } from "../../Types/SecurityEvent/SecurityTelemetrySource";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Turning it on decides which telemetry becomes security data, so it sits
 * with the tiers that connect security sources; every Security tier can
 * read how it is doing.
 */
const adminPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
];

/*
 * "Your OneUptime data" as security sources: one row per project per kind
 * of telemetry beyond logs (Types/SecurityEvent/SecurityTelemetrySource) -
 * traces, network flows, the audit log, session replays. While one is on, a
 * Workers job reads what arrived of that kind for what an attack leaves in
 * it (Server/Utils/SecurityEvent/TelemetryScan) and stores each finding as
 * a security event, so the detection rules run on data the project
 * already has. "Your logs" keeps its own record (SecurityLogSource).
 *
 * The scan reads what arrived since `cursor`, a window at a time; the
 * counts of the last scan are kept so the Connections page can say what it
 * found.
 */
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/security-telemetry-source"))
@Entity({
  name: "SecurityTelemetrySource",
})
@TableMetadata({
  tableName: "SecurityTelemetrySource",
  singularName: "Security Telemetry Source",
  pluralName: "Security Telemetry Sources",
  icon: IconProp.Signal,
  tableDescription:
    "Whether OneUptime looks for security events in one kind of telemetry the project already sends it - traces, network flows, the audit log or session replays - and what the last look found.",
})
@TableAccessControl({
  create: adminPermissions,
  read: readPermissions,
  delete: adminPermissions,
  update: adminPermissions,
})
export default class SecurityTelemetrySource extends BaseModel {
  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project whose telemetry is read.",
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
    create: adminPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project whose telemetry is read.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Kind",
    description:
      "Which telemetry this source reads: 'traces', 'network-flows', 'audit-log' or 'rum-sessions'. Fixed once created.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public kind?: SecurityTelemetrySourceKind = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Enabled",
    description:
      "Whether OneUptime looks for security events in this kind of the project's telemetry.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    title: "Cursor",
    required: false,
    type: TableColumnType.LongText,
    description:
      "The time up to which this telemetry has been read, as an ISO string: the end of the last window the scan finished.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public cursor?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Scanned At",
    description: "When this telemetry was last read.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastScannedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Event Found At",
    description: "When a security event was last found in this telemetry.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastEventFoundAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Last Scan Result",
    description:
      "What the last scan read and found: the records read, the security events found, and how many of each signal.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public lastScanResult?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    title: "Last Error",
    required: false,
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: true,
    description:
      "Why the last scan failed, if it did. Cleared by the next scan that succeeds.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public lastError?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who turned this source on.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who turned this source on.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this source.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this source.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
