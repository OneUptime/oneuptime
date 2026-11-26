import Label from "./Label";
import Monitor from "./Monitor";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import { INCOMING_REQUEST_SECRET_DEFAULT_ACCESS } from "../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import MonitorSecretAccess from "../../Types/Monitor/MonitorSecretAccess";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

/*
 * A secret that requests to the project's Incoming Request monitors must
 * carry while the project requires one (Project.requireIncomingRequestSecret,
 * issue #7526; Types/Monitor/IncomingMonitor/IncomingRequestSecret says why
 * and how it is sent).
 *
 * A project keeps a list rather than one secret so a secret can be replaced
 * without a moment in which senders are refused: create the new one, move
 * the senders to it, then delete the old one once its Last Used At stops
 * moving. Any one of them that covers the monitor is accepted.
 *
 * A secret covers every Incoming Request monitor of the project unless it is
 * limited to some (monitorAccess, issue #8501): a project whose tenants each
 * send their own secret keeps tenant A's secret from being accepted by
 * tenant B's monitors.
 *
 * Owners and admins manage them, and so does a custom role given the four
 * Incoming Request Secret permissions (issue #8502) - no built-in role below
 * the admins holds them. The requirement exists so the people who run the
 * project can secure every monitor's URL whoever configures the monitors,
 * and a member who could read the secrets, or delete them, could undo that:
 * so reading them, the value included, is a permission of its own.
 */
const SECRET_CREATORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateIncomingRequestSecret,
];

const SECRET_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadIncomingRequestSecret,
];

const SECRET_EDITORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditIncomingRequestSecret,
];

const SECRET_DELETERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.DeleteIncomingRequestSecret,
];

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: SECRET_CREATORS,
  read: SECRET_READERS,
  delete: SECRET_DELETERS,
  update: SECRET_EDITORS,
})
@CrudApiEndpoint(new Route("/incoming-request-secret"))
@TableMetadata({
  tableName: "IncomingRequestSecret",
  singularName: "Incoming Request Secret",
  pluralName: "Incoming Request Secrets",
  icon: IconProp.Key,
  tableDescription:
    "A secret that requests to the project's Incoming Request monitors must send while the project requires one: in the X-OneUptime-Secret header, as a Bearer token, or as a signature of the request's body.",
})
@Entity({
  name: "IncomingRequestSecret",
})
export default class IncomingRequestSecret extends BaseModel {
  @ColumnAccessControl({
    create: SECRET_CREATORS,
    read: SECRET_READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
    create: SECRET_CREATORS,
    read: SECRET_READERS,
    update: [],
  })
  @Index()
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
    create: SECRET_CREATORS,
    read: SECRET_READERS,
    update: SECRET_EDITORS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "What the secret is for, so you can tell it apart from the project's other incoming request secrets - the senders that use it, say.",
    example: "Production heartbeats",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  /*
   * The secret itself, encrypted at rest. Generated when it is left empty
   * (IncomingRequestSecretService), or the value someone typed, held to
   * IncomingRequestSecretRules - such as the signing secret a service like
   * Slack or Stripe generates, to check its signatures with. Whoever may read
   * the secrets reads it back to configure a sender. It cannot be changed: a
   * different value is a different secret, created beside this one so
   * senders can move without being refused.
   */
  @ColumnAccessControl({
    create: SECRET_CREATORS,
    read: SECRET_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Secret",
    description:
      "The value senders send in the X-OneUptime-Secret header or as a Bearer token in the Authorization header, or sign each request's body with (X-OneUptime-Signature, or GitHub's, Slack's or Stripe's signature). Leave it empty and OneUptime generates a strong one. Set your own with 16 to 256 characters: letters, digits and keyboard symbols, no spaces. It cannot be changed after the secret is created - create a new secret instead.",
    example: "4f1c2a9be0d34c6f8a7b5e3d2c1b0a99",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public secretValue?: string = undefined;

  /*
   * Which Incoming Request monitors accept this secret (issue #8501), by the
   * rule monitor secrets keep (MonitorSecretAccess): every monitor of the
   * project, the ones listed in `monitors`, or the ones carrying one of
   * `labels`. All Monitors is the default - what every secret did before
   * the column existed, and what the migration gives them - so a project
   * that never limits one sees no change. Only the list of the mode is read
   * (IncomingRequestSecretService empties the other), and a request that
   * sends a secret its monitor is not covered by is refused as if it had
   * sent a wrong one.
   */
  @ColumnAccessControl({
    create: SECRET_CREATORS,
    read: SECRET_READERS,
    update: SECRET_EDITORS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(MonitorSecretAccess),
    title: "Monitor Access",
    description:
      "Which Incoming Request monitors accept this secret. All Monitors: every one in this project, including monitors created later. Specific Monitors: only the monitors in Monitors. Monitors With Labels: monitors that carry at least one of the labels in Labels. Setting this empties whichever of Monitors and Labels it does not use.",
    defaultValue: INCOMING_REQUEST_SECRET_DEFAULT_ACCESS,
    example: MonitorSecretAccess.SpecificMonitors,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: INCOMING_REQUEST_SECRET_DEFAULT_ACCESS,
  })
  public monitorAccess?: MonitorSecretAccess = undefined;

  @ColumnAccessControl({
    create: SECRET_CREATORS,
    read: SECRET_READERS,
    update: SECRET_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Monitor,
    title: "Monitors",
    description:
      "The Incoming Request monitors that accept this secret when Monitor Access is Specific Monitors. Ignored otherwise.",
    example: '["5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e"]',
  })
  @ManyToMany(
    () => {
      return Monitor;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncomingRequestSecretMonitor",
    inverseJoinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incomingRequestSecretId",
      referencedColumnName: "_id",
    },
  })
  public monitors?: Array<Monitor> = undefined;

  @ColumnAccessControl({
    create: SECRET_CREATORS,
    read: SECRET_READERS,
    update: SECRET_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "When Monitor Access is Monitors With Labels, the Incoming Request monitors that carry at least one of these labels accept this secret. Ignored otherwise.",
    example: '["5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e"]',
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncomingRequestSecretLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incomingRequestSecretId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  /*
   * Written by the ingest path only, at most every five minutes
   * (IncomingRequestSecretPolicy.recordUse), hence `create: []` and
   * `update: []`: it answers "is anything still sending this secret?",
   * which a value someone could set by hand would not.
   */
  @ColumnAccessControl({
    create: [],
    read: SECRET_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Used At",
    description:
      "About when a request was last accepted with this secret, to the nearest five minutes. Empty means none has been accepted with it yet. Use it to find secrets that are safe to delete.",
    example: "2026-11-15T09:30:00Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastUsedAt?: Date = undefined;

  @ColumnAccessControl({
    create: SECRET_CREATORS,
    read: SECRET_READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
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
    create: SECRET_CREATORS,
    read: SECRET_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
