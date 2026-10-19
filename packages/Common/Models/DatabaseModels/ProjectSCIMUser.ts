import Project from "./Project";
import ProjectSCIM from "./ProjectSCIM";
import User from "./User";
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
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * "This project SCIM connection has provisioned this account, and this is the
 * user its identity provider has on record."
 *
 * A SCIM user is the identity provider's record of a person, and it outlives
 * the person's access: an identity provider deactivates a user (`active`
 * false) and expects to find them again, inactive, when it looks them up -
 * Okta to reactivate them, Microsoft Entra ID's gallery validation to check
 * the deactivation. OneUptime's access is team membership, which a
 * deactivation takes away, so the record has to be kept apart from it: one
 * row per connection and account, with what the identity provider last sent
 * - its userName, externalId, names and emails - and whether it has the
 * person active.
 *
 * What the identity provider sent is what the SCIM user answers with. The
 * OneUptime account itself changes only as ProjectSCIMAccountPolicy allows:
 * on the hosted service SCIM never changes an account's sign-in address, so
 * a new userName or email is kept here and not applied to the account.
 *
 * A row goes when the identity provider deletes the user, and with its
 * connection, project or account. Internal and root-only: there is no CRUD
 * API.
 */
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Index(
  "IDX_ProjectSCIMUser_projectScimId_userId",
  ["projectScimId", "userId"],
  {
    unique: true,
    where: '"deletedAt" IS NULL',
  },
)
@TableMetadata({
  tableName: "ProjectSCIMUser",
  singularName: "SCIM User",
  pluralName: "SCIM Users",
  icon: IconProp.User,
  tableDescription:
    "A user a project's SCIM connection provisioned: whether the identity provider has them active, and what it sent for them.",
})
@Entity({
  name: "ProjectSCIMUser",
})
export default class ProjectSCIMUser extends BaseModel {
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
    description: "The project the connection belongs to.",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: false,
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
    description: "ID of the project the connection belongs to.",
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
    manyToOneRelationColumn: "projectScimId",
    type: TableColumnType.Entity,
    modelType: ProjectSCIM,
    title: "SCIM Connection",
    description: "The connection that provisioned the user.",
  })
  @ManyToOne(
    () => {
      return ProjectSCIM;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectScimId" })
  public projectScim?: ProjectSCIM = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "SCIM Connection ID",
    description: "ID of the connection that provisioned the user.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectScimId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "The OneUptime account the SCIM user is.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "User ID",
    description: "ID of the OneUptime account the SCIM user is.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    title: "Active",
    description:
      "Whether the identity provider has the user active (SCIM's active attribute).",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isActive?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "User Name",
    description:
      "The userName the identity provider sent, as it sent it. Usually the account's email address.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public userName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "External ID",
    description:
      "The identity provider's own id for the user (SCIM's externalId), as it sent it.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public externalId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "SCIM Attributes",
    description:
      "The rest of what the identity provider last sent for the user: displayName, name and emails.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public scimAttributes?: JSONObject = undefined;
}
