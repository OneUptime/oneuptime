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
import SecurityEventDestinationProvider from "../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import SecurityEventDestinationScope from "../../Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Sending a project's security events out of OneUptime, with a credential
 * that writes into someone's SIEM, is the same decision as connecting a
 * source: the Admin tiers plus SecurityAdmin. Every Security tier can see
 * where events go and whether they get there; the credential is write-only.
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
 * A SIEM OneUptime sends the project's security events to - Google SecOps
 * first (SecurityEventDestinationProvider). A Workers job sends every
 * enabled destination what arrived since its cursor, a window at a time:
 * the project's detections, or all its security events (sendScope),
 * converted to what the SIEM reads (UDM for Google SecOps). Events imported
 * from the same product are never sent back to it.
 *
 * The provider decides which keys `config` and `secrets` carry
 * (SecurityEventDestinationCatalog); the server checks them on save, so a
 * destination that stores is one the job can send to.
 */
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/security-event-destination"))
@Entity({
  name: "SecurityEventDestination",
})
@TableMetadata({
  tableName: "SecurityEventDestination",
  singularName: "Security Event Destination",
  pluralName: "Security Event Destinations",
  icon: IconProp.PaperAirplane,
  tableDescription:
    "SIEMs such as Google SecOps that receive the project's detections, or all its security events, from OneUptime.",
})
@TableAccessControl({
  create: adminPermissions,
  read: readPermissions,
  delete: adminPermissions,
  update: adminPermissions,
})
export default class SecurityEventDestination extends BaseModel {
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
    description: "Relation to the project whose events are sent.",
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
    description: "ID of the project whose events are sent.",
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
    description: "Friendly name for this destination.",
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
    update: adminPermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "What this destination is for.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

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
    description:
      "Which SIEM this destination sends to, e.g. 'google-secops'. Fixed once created.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public provider?: SecurityEventDestinationProvider = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Configuration",
    description:
      "Provider-specific settings that are not secret, such as the region and the instance. Keys are defined by the provider catalog.",
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
    required: true,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Credentials",
    description:
      "Provider-specific secrets, such as a service account key, as a JSON object. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public secrets?: string = undefined;

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
    description: "Whether events are sent to this destination.",
    defaultValue: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "What to Send",
    description:
      "'detections' sends what OneUptime found (its detection rules' and threat intel's matches and imported alerts); 'all-events' sends every security event.",
    defaultValue: SecurityEventDestinationScope.Detections,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityEventDestinationScope.Detections,
  })
  public sendScope?: SecurityEventDestinationScope = undefined;

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
      "The time up to which events have been sent, as an ISO string: the end of the last window delivered.",
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
    title: "Last Attempt At",
    description: "When OneUptime last tried to send to this destination.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastAttemptAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Sent At",
    description: "When events were last delivered to this destination.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastSentAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Last Send Result",
    description:
      "What the last attempt sent: events delivered, events the SIEM refused, and the window they came from.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public lastSendResult?: JSONObject = undefined;

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
      "Why the last attempt failed, with credentials redacted, if it did. Cleared by the next attempt that succeeds.",
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
    description: "Relation to the user who created this destination.",
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
    description: "ID of the user who created this destination.",
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
    description: "Relation to the user who deleted this destination.",
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
    description: "ID of the user who deleted this destination.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
