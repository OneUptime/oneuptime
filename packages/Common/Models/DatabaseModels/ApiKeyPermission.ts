import ApiKey from "./ApiKey";
import ApiKeyCustomRole from "./ApiKeyCustomRole";
import CustomRole from "./CustomRole";
import CustomRolePermission from "./CustomRolePermission";
import Label from "./Label";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
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

@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
  // What a leftover API key can do: readable on every plan.
  readableBelowPlan: true,
  /*
   * A block permission restricts the key: deleting one gives the key more,
   * so below the plan these are not deleted one by one (delete the key).
   */
  deleteStaysGated: true,
})
@EnableDocumentation()
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditProjectApiKeyPermissions,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ReadProjectApiKey,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteProjectApiKey,
    Permission.EditProjectApiKeyPermissions,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditProjectApiKeyPermissions,
  ],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/api-key-permission"))
@Entity({
  name: "ApiKeyPermission",
})
@TableMetadata({
  tableName: "ApiKeyPermission",
  singularName: "API Key Permission",
  pluralName: "API Key Permissions",
  icon: IconProp.Lock,
  tableDescription: "Permissions for your API Keys",
})
/*
 * One thing an API key may do (or, as a block, may never do): a permission,
 * and the labels it is limited to.
 *
 * Most are given to the key directly. The rest come with a custom role
 * given to the key (ApiKeyCustomRole): the key holds a copy of each of the
 * role's permissions, marked with the role, the role given to the key and
 * the role's own row it copies, kept equal to the role by OneUptime
 * (Server/Utils/CustomRole/CustomRoleSync). A copy is read like any other
 * row - the key may do what it says - and is changed or removed only
 * through its role (ApiKeyPermissionService.assertNoRoleCopies).
 */
export default class APIKeyPermission extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKeyPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    /*
     * A permission row stays with the API key it was created for, under
     * either name: apiKeyId is not updatable, and neither is the relation.
     */
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "apiKeyId",
    type: TableColumnType.Entity,
    modelType: ApiKey,
    title: "Api Key",
    description: "Relation to API Key resource in which this object belongs",
    example: "Production API Key",
  })
  @ManyToOne(
    () => {
      return ApiKey;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "apiKeyId" })
  public apiKey?: ApiKey = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKeyPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "API Key ID",
    description: "ID of API Key resource in which this object belongs",
    example: "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public apiKeyId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKeyPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
    example: "My Production Project",
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKeyPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
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
    example: "a3f9c8e2-d4b6-4a7c-9e5f-1a2b3c4d5e6f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
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
    example: "admin@company.com",
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
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "c8f5e0a2-d4b7-4a8d-9e3f-2a3b4c5d6e7f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
    example: "admin@company.com",
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
    example: "d9a6f1b3-e5c8-4b9e-af4d-3b4c5d6e7f8a",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKeyPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKeyPermissions,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Permission,
    title: "Permission",
    description:
      "Permission. You can find list of permissions on the Permissions page.",
    example: "ProjectOwner",
  })
  /*
   * Once per key among the permissions given to it directly, and once per
   * custom role given to it among that role's copies: a key may hold a
   * permission of its own beside a role's copy of it, and two roles that
   * both hold it - each copy goes with its own role.
   */
  @UniqueColumnBy(["apiKeyId", "apiKeyCustomRoleId"])
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public permission?: Permission = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKeyPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKeyPermissions,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description: "Relation to Labels Array where this permission is scoped at.",
    example: [{ name: "Production" }, { name: "Critical" }],
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "ApiKeyPermissionLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "apiKeyPermissionId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKeyPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectApiKeyPermissions,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isBlockPermission?: boolean = undefined;

  /*
   * The custom role this permission came with, when it came with one.
   * A key given a role holds a copy of each of the role's permissions that
   * applies to a key, marked with the role, the role given to the key
   * (apiKeyCustomRoleId) and the role's own row it copies
   * (customRolePermissionId). OneUptime writes and removes them as the role
   * changes (CustomRoleSync); no request may set them, and a copy is
   * changed or removed only through its role. Each goes with what it names
   * (ON DELETE CASCADE). A permission given to the key directly names none
   * of them.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "customRoleId",
    type: TableColumnType.Entity,
    modelType: CustomRole,
    title: "Custom Role",
    description:
      "The custom role this permission comes from. Empty when the permission was given to the API key directly. Change it on the role.",
    example: "Incident Responder",
  })
  @ManyToOne(
    () => {
      return CustomRole;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "customRoleId" })
  public customRole?: CustomRole = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Custom Role ID",
    description:
      "ID of the custom role this permission comes from. Empty when the permission was given to the API key directly.",
    example: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public customRoleId?: ObjectID = undefined;

  // The custom role given to the key that brought this permission.
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "apiKeyCustomRoleId",
    type: TableColumnType.Entity,
    modelType: ApiKeyCustomRole,
    title: "API Key Custom Role",
    description:
      "The custom role given to the API key that brought this permission. Empty when the permission was given to the API key directly.",
    example: "Incident Responder",
  })
  @ManyToOne(
    () => {
      return ApiKeyCustomRole;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "apiKeyCustomRoleId" })
  public apiKeyCustomRole?: ApiKeyCustomRole = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "API Key Custom Role ID",
    description:
      "ID of the custom role given to the API key that brought this permission. Empty when the permission was given to the API key directly.",
    example: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public apiKeyCustomRoleId?: ObjectID = undefined;

  // The custom role's own permission this one copies.
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "customRolePermissionId",
    type: TableColumnType.Entity,
    modelType: CustomRolePermission,
    title: "Custom Role Permission",
    description:
      "The custom role's own permission this one copies. Empty when the permission was given to the API key directly.",
    example: "IncidentMember",
  })
  @ManyToOne(
    () => {
      return CustomRolePermission;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "customRolePermissionId" })
  public customRolePermission?: CustomRolePermission = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadProjectApiKey,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Custom Role Permission ID",
    description:
      "ID of the custom role's own permission this one copies. Empty when the permission was given to the API key directly.",
    example: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public customRolePermissionId?: ObjectID = undefined;
}
