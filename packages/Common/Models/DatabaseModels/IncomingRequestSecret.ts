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
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A secret that requests to the project's Incoming Request monitors must
 * carry while the project requires one (Project.requireIncomingRequestSecret,
 * issue #7526; Types/Monitor/IncomingMonitor/IncomingRequestSecret says why
 * and how it is sent).
 *
 * A project keeps a list rather than one secret so a secret can be replaced
 * without a moment in which senders are refused: create the new one, move
 * the senders to it, then delete the old one once its Last Used At stops
 * moving. Any one of them is accepted.
 *
 * Owners and admins alone may see or change them: the requirement exists so
 * the people who run the project can secure every monitor's URL whoever
 * configures the monitors, and a member who could read the secrets, or
 * delete them, could undo that.
 */
const SECRET_MANAGERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: SECRET_MANAGERS,
  read: SECRET_MANAGERS,
  delete: SECRET_MANAGERS,
  update: SECRET_MANAGERS,
})
@CrudApiEndpoint(new Route("/incoming-request-secret"))
@TableMetadata({
  tableName: "IncomingRequestSecret",
  singularName: "Incoming Request Secret",
  pluralName: "Incoming Request Secrets",
  icon: IconProp.Key,
  tableDescription:
    "A secret that requests to the project's Incoming Request monitors must send, in the X-OneUptime-Secret header or as a Bearer token, while the project requires one.",
})
@Entity({
  name: "IncomingRequestSecret",
})
export default class IncomingRequestSecret extends BaseModel {
  @ColumnAccessControl({
    create: SECRET_MANAGERS,
    read: SECRET_MANAGERS,
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
    create: SECRET_MANAGERS,
    read: SECRET_MANAGERS,
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
    create: SECRET_MANAGERS,
    read: SECRET_MANAGERS,
    update: SECRET_MANAGERS,
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
   * IncomingRequestSecretRules. Owners and admins read it back to configure
   * a sender. It cannot be changed: a different value is a different secret,
   * created beside this one so senders can move without being refused.
   */
  @ColumnAccessControl({
    create: SECRET_MANAGERS,
    read: SECRET_MANAGERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Secret",
    description:
      "The value senders send in the X-OneUptime-Secret header, or as a Bearer token in the Authorization header. Leave it empty and OneUptime generates a strong one. Set your own with 16 to 256 characters: letters, digits and keyboard symbols, no spaces. It cannot be changed after the secret is created - create a new secret instead.",
    example: "4f1c2a9be0d34c6f8a7b5e3d2c1b0a99",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public secretValue?: string = undefined;

  /*
   * Written by the ingest path only, at most every five minutes
   * (IncomingRequestSecretPolicy.recordUse), hence `create: []` and
   * `update: []`: it answers "is anything still sending this secret?",
   * which a value someone could set by hand would not.
   */
  @ColumnAccessControl({
    create: [],
    read: SECRET_MANAGERS,
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
    create: SECRET_MANAGERS,
    read: SECRET_MANAGERS,
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
    create: SECRET_MANAGERS,
    read: SECRET_MANAGERS,
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

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
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
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
