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
import SecurityEventConnectorType from "../../Types/SecurityEvent/SecurityEventConnectorType";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

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

/**
 * Managed pull connection for security products other than Google SecOps.
 * Provider-specific settings are kept in configuration; credentialJson is
 * encrypted and write-only. Keeping the lifecycle state common prevents each
 * provider from growing its own scheduler and health contract.
 */
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/security-event-connection"))
@Entity({ name: "SecurityEventConnection" })
@TableMetadata({
  tableName: "SecurityEventConnection",
  singularName: "Security Event Connection",
  pluralName: "Security Event Connections",
  icon: IconProp.ShieldCheck,
  tableDescription:
    "Managed connections to AWS, Microsoft, Cloudflare, CrowdStrike, Google Security Command Center, Okta, and Splunk security event sources.",
})
@TableAccessControl({
  create: adminPermissions,
  read: readPermissions,
  update: adminPermissions,
  delete: adminPermissions,
})
export default class SecurityEventConnection extends BaseModel {
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
    description: "Project that owns this connection.",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "delete",
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
    description: "ID of the project that owns this connection.",
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
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Name,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Friendly name for this connection.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public name?: string = undefined;

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
    title: "Provider",
    description: "Security product this connection reads from.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public provider?: SecurityEventConnectorType = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    title: "Configuration",
    description:
      "Provider-specific non-secret settings such as region, tenant, zone, organization, or base URL.",
  })
  @Column({ type: ColumnType.JSON, nullable: false })
  public configuration?: JSONObject = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: [],
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Credentials JSON",
    description:
      "Provider credentials as JSON. Encrypted at rest and never returned by the API.",
  })
  @Column({ type: ColumnType.VeryLongText, nullable: false })
  public credentialJson?: string = undefined;

  @ColumnAccessControl({ create: adminPermissions, read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Source Fingerprint",
    description:
      "Internal fingerprint used to reset polling state atomically when source settings change.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public sourceFingerprint?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Source Generation",
    description:
      "Internal generation used to separate event identities after the provider or source settings change.",
    defaultValue: 1,
    isDefaultValueColumn: true,
  })
  @Column({ type: ColumnType.Number, nullable: false, default: 1 })
  public sourceGeneration?: number = undefined;

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
    description: "Whether scheduled polling is enabled.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({ type: ColumnType.Boolean, nullable: false, default: true })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Poll Interval (Minutes)",
    description: "How often the provider is polled.",
    defaultValue: 5,
    isDefaultValueColumn: true,
  })
  @Column({ type: ColumnType.Number, nullable: false, default: 5 })
  public pollIntervalInMinutes?: number = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Successful Poll",
    description: "When a complete poll last finished successfully.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastSuccessfulPollAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Event Imported",
    description: "When this connection most recently imported a new event.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastEventIngestedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Last Poll Result",
    description: "Counts and warnings from the latest poll.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public lastPollResult?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Polled At",
    description: "When the latest polling attempt finished.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastPolledAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    encrypted: true,
    title: "Cursor",
    description:
      "Encrypted internal checkpoint for time windows and provider pagination.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public cursor?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Last Error",
    description: "Complete credential-redacted error from the latest poll.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.VeryLongText, nullable: true })
  public lastError?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "User that created this connection.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    { eager: false, nullable: true, onDelete: "SET NULL" },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user that created this connection.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "User that deleted this connection.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    { eager: false, nullable: true, onDelete: "SET NULL" },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user that deleted this connection.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
