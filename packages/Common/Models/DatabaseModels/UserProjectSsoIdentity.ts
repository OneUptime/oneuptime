import Project from "./Project";
import ProjectSSO from "./ProjectSso";
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
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * "Through this SAML provider, this account is this person in the identity
 * provider": the immutable object ID Microsoft Entra ID sends for them (the
 * objectidentifier claim, sent by default), bound to the account at its
 * first sign-in through the provider.
 *
 * A SAML sign-in names the account by email address, and an address is not
 * a person: in Entra ID another user can come to hold it - renamed, or a
 * mail attribute an admin or the user edited. Once an account is bound, a
 * sign-in through the provider that asserts its address with another object
 * ID is refused, so whoever holds the address next cannot sign in as the
 * account. A response without the claim (any identity provider but Entra
 * ID, unless configured to send it) is matched by address alone, as before.
 *
 * The binding is for the person's time in the project: it goes when they
 * leave it (ProjectLeaveAccessCleanup) and with the provider (the foreign
 * key cascades), so coming back, or a new provider, binds afresh.
 *
 * Internal and root-only: there is no CRUD API.
 */
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Index(
  "IDX_UserProjectSsoIdentity_projectSsoId_userId",
  ["projectSsoId", "userId"],
  {
    unique: true,
    where: '"deletedAt" IS NULL',
  },
)
@TableMetadata({
  tableName: "UserProjectSsoIdentity",
  singularName: "Project SSO Identity",
  pluralName: "Project SSO Identities",
  icon: IconProp.Lock,
  tableDescription:
    "Binds an account to the identity provider's immutable ID for the person it signed in as through a project's SAML provider.",
})
@Entity({
  name: "UserProjectSsoIdentity",
})
export default class UserProjectSsoIdentity extends BaseModel {
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
    description: "The account that is bound.",
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
    description: "ID of the account that is bound.",
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
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description:
      "The project whose SAML provider the account signs in through.",
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
    description:
      "ID of the project whose SAML provider the account signs in through.",
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
    manyToOneRelationColumn: "projectSsoId",
    type: TableColumnType.Entity,
    modelType: ProjectSSO,
    title: "Project SSO",
    description: "The SAML provider the binding holds for.",
  })
  @ManyToOne(
    () => {
      return ProjectSSO;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectSsoId" })
  public projectSso?: ProjectSSO = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Project SSO ID",
    description: "ID of the SAML provider the binding holds for.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectSsoId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Object ID",
    description:
      "The identity provider's immutable ID for the person: Microsoft Entra ID's object ID, a GUID kept in lower case.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public objectId?: string = undefined;
}
