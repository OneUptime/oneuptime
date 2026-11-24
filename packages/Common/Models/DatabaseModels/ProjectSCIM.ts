import Project from "./Project";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import TableEditionAccessControl from "../../Types/Database/AccessControl/TableEditionAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ServerOwned from "../../Types/Database/ServerOwned";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import HashedString from "../../Types/HashedString";
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

@TableEditionAccessControl({
  requiresEnterprise: true,
})
@TableBillingAccessControl({
  create: PlanType.Scale,
  read: PlanType.Scale,
  update: PlanType.Scale,
  delete: PlanType.Scale,
  /*
   * Kept after a downgrade, but stops provisioning until the project is
   * back on the plan (Types/Billing/PlanCutoffCredentials): readable on
   * every plan, to see what stopped and delete it.
   */
  readableBelowPlan: true,
})
@TenantColumn("projectId")
/*
 * Created and changed by a project owner only, here and on every column:
 * through its Groups endpoints a connection can add people to any team,
 * Owners included, so saving one takes the access that could invite people
 * to every team (Server/Utils/SsoProviderTeamGrant). Reading and deleting
 * are unchanged.
 */
@TableAccessControl({
  create: [Permission.ProjectOwner],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadProjectSSO,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteProjectSSO,
  ],
  update: [Permission.ProjectOwner],
})
@CrudApiEndpoint(new Route("/project-scim"))
@TableMetadata({
  tableName: "ProjectSCIM",
  singularName: "SCIM",
  pluralName: "SCIM",
  icon: IconProp.Lock,
  tableDescription: "Manage SCIM auto-provisioning for your project",
})
@Entity({
  name: "ProjectSCIM",
})
export default class ProjectSCIM extends BaseModel {
  @ColumnAccessControl({
    create: [Permission.ProjectOwner],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectSSO,
    ],
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
    create: [Permission.ProjectOwner],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectSSO,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectSSO,
    ],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Any friendly name for this SCIM configuration",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectSSO,
    ],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description to help you remember",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  /*
   * The token is what the identity provider adds people to teams with - its
   * Groups endpoints reach every team - so setting it takes the access that
   * saving the connection takes (Server/Utils/SsoProviderTeamGrant): a
   * project owner's.
   *
   * Kept only as its hash (#9012: PresentedKey.toStoredHash, written by
   * DatabaseService whatever writes it), so a backup or a database dump
   * holds no token, and nobody reads it back, a master admin included. It is
   * pasted once into the identity provider: the create that makes the
   * connection answers it once, and Reset Bearer Token makes a new one. A
   * token stored as written before is hashed in place by the
   * PresentedKeys:ProtectAtRest job, and keeps working throughout: a
   * request's token is matched by its hash, in the query, and as written
   * until then (SCIMAuthorization.findConnection).
   */
  @ColumnAccessControl({
    create: [Permission.ProjectOwner],
    read: [],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    secret: true,
    presentedKey: true,
    required: true,
    type: TableColumnType.HashedString,
    title: "Bearer Token",
    description:
      "The bearer token the identity provider signs in to SCIM with. Write-only: OneUptime keeps only its hash, and answers it once, to the create that makes the connection. Leave it out and OneUptime makes one; a new value replaces it, and the one before stops working.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    transformer: HashedString.getDatabaseTransformer(),
  })
  public bearerToken?: HashedString = undefined;

  /*
   * OAuth 2.0 client credentials (RFC 6749, section 4.4), for identity
   * providers that will not keep a long-lived bearer token - Microsoft Entra
   * ID's application gallery among them. The client ID is the connection's
   * id; the client secret is made by OneUptime, shown once, and kept only as
   * its SHA-256 hash. A secret works for a year. Replacing it keeps the one
   * before working until that one expires or is deleted, so the identity
   * provider can be moved to the new secret without a gap. Like the bearer
   * token, they are a project owner's to make, replace and see. The token
   * endpoint and the SCIM routes read these as root (ee/Server/Identity/
   * Utils/SCIMOAuth.ts).
   */
  @ColumnAccessControl({
    create: [Permission.ProjectOwner],
    read: [],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    required: false,
    hideColumnInDocumentation: true,
    type: TableColumnType.LongText,
    title: "OAuth Client Secret Hash",
    description:
      "SHA-256 hash of the connection's OAuth 2.0 client secret. The secret itself is shown once, when it is made, and never kept.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public oauthClientSecretHash?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner],
    read: [Permission.ProjectOwner],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "OAuth Client Secret Expires At",
    description:
      "When the connection's OAuth 2.0 client secret stops working. No access token is issued with an expired secret.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public oauthClientSecretExpiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner],
    read: [],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    required: false,
    hideColumnInDocumentation: true,
    type: TableColumnType.LongText,
    title: "Previous OAuth Client Secret Hash",
    description:
      "SHA-256 hash of the client secret the current one replaced, which keeps working until it expires or is deleted.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public oauthPreviousClientSecretHash?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner],
    read: [Permission.ProjectOwner],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Previous OAuth Client Secret Expires At",
    description:
      "When the previous OAuth 2.0 client secret stops working, unless it is deleted before.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public oauthPreviousClientSecretExpiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectSSO,
    ],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Team,
    title: "Default Teams",
    description: "Default teams that new users will be added to via SCIM",
  })
  @ManyToMany(
    () => {
      return Team;
    },
    { eager: false },
  )
  @JoinTable({
    name: "ProjectScimTeam",
    inverseJoinColumn: {
      name: "teamId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "projectScimId",
      referencedColumnName: "_id",
    },
  })
  public teams?: Array<Team> = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectSSO,
    ],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Auto Provision Users",
    description: "Automatically create users when they are added via SCIM",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public autoProvisionUsers?: boolean = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectSSO,
    ],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Auto Deprovision Users",
    description: "Automatically remove users when they are removed via SCIM",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public autoDeprovisionUsers?: boolean = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectSSO,
    ],
    update: [Permission.ProjectOwner],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Enable Push Groups",
    description: "Enable push groups provisioning instead of default teams",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public enablePushGroups?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectSSO,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectSSO,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
