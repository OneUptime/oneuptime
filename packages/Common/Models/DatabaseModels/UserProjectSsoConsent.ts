import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * "The owner of this account's mailbox has agreed that this project's single
 * sign-on may sign them in."
 *
 * A project's SAML or OIDC identity provider is configured by that project's
 * admins, not by whoever runs this instance, so the email address it asserts
 * is only that customer's word. On a multi-tenant instance that word cannot be
 * enough to sign somebody in: an admin who controls their own IdP could assert
 * any address and receive a session for the matching account -- an account
 * whose other projects belong to other customers.
 *
 * So on the hosted service the first project-SSO sign-in to an account stops
 * and emails the address instead, and one of these rows is written only when
 * the link in that email is used. Nothing a project admin controls can write
 * one: not the IdP, not SCIM (which can add an existing user to a project's
 * teams), not an invitation. That is why this is its own table rather than an
 * inference from team membership.
 *
 * Internal and root-only: there is no CRUD API.
 */
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Index("IDX_UserProjectSsoConsent_userId_projectId", ["userId", "projectId"], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@TableMetadata({
  tableName: "UserProjectSsoConsent",
  singularName: "Project SSO Consent",
  pluralName: "Project SSO Consents",
  icon: IconProp.Lock,
  tableDescription:
    "Records that a user confirmed, from their mailbox, that a project's single sign-on may sign them in.",
})
@Entity({
  name: "UserProjectSsoConsent",
})
export default class UserProjectSsoConsent extends BaseModel {
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
    description: "The account that consented.",
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
    description: "ID of the account that consented.",
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
    description: "The project whose single sign-on may sign this user in.",
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
      "ID of the project whose single sign-on may sign this user in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;
}
