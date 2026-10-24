import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import AuditLogExportDestinationType from "../../Types/AuditLog/Export/AuditLogExportDestinationType";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import TableEditionAccessControl from "../../Types/Database/AccessControl/TableEditionAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Where the audit log goes, and how far it has got: one destination (an S3
 * bucket, a webhook, a syslog receiver...) the Enterprise Edition's exporter
 * sends every new audit log entry to, a batch at a time, from the moment the
 * export is saved (or from an earlier date, for a backfill).
 *
 * A row with a projectId exports that project's entries only, and is set up
 * by the project's owners and admins (Settings > Audit Logs > Export). A row
 * without one exports every project's entries, and is the instance's: only
 * a master admin creates one, in the Admin Dashboard
 * (AuditLogExportService refuses anyone else a row without a project).
 *
 * Who may set one up is the project's owners and admins alone: an export
 * sends everything the audit log knows - who changed what, with the values
 * before and after - to a place of the exporter's choosing.
 *
 * This is enterprise configuration (TableEditionAccessControl): creating or
 * changing one needs the Enterprise Edition and a license that includes
 * audit logs, while reading and deleting never do, so an installation that
 * left the Enterprise Edition can still see what it set up and remove it.
 * The exporter itself lives in ee/ (ee/Server/AuditLogExport); the
 * Community Edition has none, and nothing is exported there.
 *
 * The destination decides which keys `config` and `secrets` carry
 * (AuditLogExportDestinationCatalog); the server checks them on save, so an
 * export that stores is one the exporter can send to. `secrets` is
 * encrypted at rest and never returned by the API.
 *
 * Everything below `secrets` is the exporter's bookkeeping, written by
 * OneUptime alone: where it has got to (the cursor: the time and id of the
 * last entry delivered), how many entries it has delivered, when it last
 * succeeded, and - while the destination is failing - why, since when and
 * when it tries again.
 */
const adminPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

/*
 * The exporter's bookkeeping: rewritten on every batch, so the audit trail
 * tracks what a person changes about an export and never the cursor.
 */
export const AUDIT_LOG_EXPORT_BOOKKEEPING_COLUMNS: Array<string> = [
  "cursorCreatedAt",
  "cursorEntryId",
  "exportedEntryCount",
  "lastExportedAt",
  "lastAttemptAt",
  "lastError",
  "failingSince",
  "consecutiveFailureCount",
  "nextAttemptAt",
];

@TableEditionAccessControl({
  requiresEnterprise: true,
})
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Enterprise,
  read: PlanType.Enterprise,
  update: PlanType.Enterprise,
  delete: PlanType.Enterprise,
  /*
   * Kept after a downgrade, and stops exporting until the project is back
   * on the plan: readable on every plan, to see what stopped, switch it
   * off and delete it.
   */
  readableBelowPlan: true,
})
@EnableAuditLog({
  ignoreColumns: AUDIT_LOG_EXPORT_BOOKKEEPING_COLUMNS,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/audit-log-export"))
@Entity({
  name: "AuditLogExport",
})
@TableMetadata({
  tableName: "AuditLogExport",
  singularName: "Audit Log Export",
  pluralName: "Audit Log Exports",
  icon: IconProp.CloudArrowUp,
  tableDescription:
    "Where the audit log is exported: S3 or S3-compatible storage, Google Cloud Storage, Azure Blob Storage, a webhook or a syslog receiver.",
})
@TableAccessControl({
  create: adminPermissions,
  read: adminPermissions,
  delete: adminPermissions,
  update: adminPermissions,
})
export default class AuditLogExport extends BaseModel {
  @ColumnAccessControl({
    create: adminPermissions,
    read: adminPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description:
      "The project whose audit log is exported. Empty for an export of the whole instance.",
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
    read: adminPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description:
      "ID of the project whose audit log is exported. Empty for an export of the whole instance.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: adminPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Name,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "A name for this export, such as Compliance archive.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: adminPermissions,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Destination",
    description:
      "Where entries are sent: s3, s3-compatible, google-cloud-storage, azure-blob-storage, webhook or syslog. Fixed once created.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public destinationType?: AuditLogExportDestinationType = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: adminPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Configuration",
    description:
      "The destination's settings that are not secret, such as the bucket and the region. Keys are defined by the destination.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public config?: JSONObject = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: [],
    update: adminPermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Credentials",
    description:
      "The destination's secrets, such as an access key's secret, as a JSON object. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public secrets?: string = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: adminPermissions,
    update: adminPermissions,
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Enabled",
    description: "Whether entries are exported. A paused export keeps its place.",
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
    create: adminPermissions,
    read: adminPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Export From",
    description:
      "Entries recorded from this time on are exported. Empty on create means from now; an earlier date also sends the entries kept since then.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public startsAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: adminPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Exported Up To",
    description: "When the last entry delivered was recorded: where the next batch starts.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public cursorCreatedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: adminPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Last Exported Entry ID",
    description:
      "The ID of the last entry delivered, which orders the entries recorded in the same second.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cursorEntryId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: adminPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    title: "Entries Exported",
    description: "How many entries have been delivered so far.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({ type: ColumnType.Number, nullable: false, default: 0 })
  public exportedEntryCount?: number = undefined;

  @ColumnAccessControl({ create: [], read: adminPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Exported At",
    description: "When entries were last delivered.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastExportedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: adminPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Attempt At",
    description: "When OneUptime last tried to deliver entries.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastAttemptAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: adminPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Last Error",
    canReadOnRelationQuery: true,
    description:
      "Why the last delivery failed, with credentials redacted. Cleared by the next delivery that succeeds.",
  })
  @Column({ type: ColumnType.VeryLongText, nullable: true })
  public lastError?: string = undefined;

  @ColumnAccessControl({ create: [], read: adminPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Failing Since",
    description: "When deliveries started failing. Cleared by the next delivery that succeeds.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public failingSince?: Date = undefined;

  @ColumnAccessControl({ create: [], read: adminPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    title: "Failures In A Row",
    description: "How many deliveries in a row have failed. It sets how long the next retry waits.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({ type: ColumnType.Number, nullable: false, default: 0 })
  public consecutiveFailureCount?: number = undefined;

  @ColumnAccessControl({ create: [], read: adminPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Next Attempt At",
    description:
      "While deliveries fail: when OneUptime tries again. Saving the export's settings tries again at once.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public nextAttemptAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: adminPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who created this export.",
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
    read: adminPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this export.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: adminPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this export.",
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
    read: adminPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this export.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
