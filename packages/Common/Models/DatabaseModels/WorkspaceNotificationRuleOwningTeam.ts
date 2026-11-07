import WorkspaceNotificationRule from "./WorkspaceNotificationRule";
import Project from "./Project";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnsTogether from "../../Types/Database/UniqueColumnsTogether";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A TEAM THAT OWNS A WORKSPACE NOTIFICATION RULE. A rule with owning teams is
 * changed and deleted only with the permissions of the teams that own it,
 * and by the project's owners and admins; everyone who may read rules still
 * reads it. A rule with none is managed by everyone who may change rules.
 * Server/Types/Database/Permissions/TeamOwnedRulePermission holds the rule,
 * for the rule and for these rows alike: only the teams that own a rule add
 * or remove its owning teams.
 *
 * Not an owner table of the Owned scope (OwnerTableRegistry): a team that
 * owns a rule is who may change it, not whose records a grant scoped to
 * Owned reaches.
 */
@CanAccessIfCanReadOn("workspaceNotificationRule")
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRuleOwningTeam,
  ],
  read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRuleOwningTeam,
  ],
  delete: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.DeleteWorkspaceNotificationRuleOwningTeam,
  ],
  update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditWorkspaceNotificationRuleOwningTeam,
  ],
})
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
  // Readable after a downgrade, as the rules it owns are.
  readableBelowPlan: true,
})
@CrudApiEndpoint(new Route("/workspace-notification-rule-owning-team"))
@TableMetadata({
  tableName: "WorkspaceNotificationRuleOwningTeam",
  singularName: "Workspace Notification Rule Owning Team",
  pluralName: "Workspace Notification Rule Owning Teams",
  icon: IconProp.Logs,
  tableDescription:
    "Teams that own a workspace notification rule: only their members, and project admins, can change or delete it.",
})
@Entity({
  name: "WorkspaceNotificationRuleOwningTeam",
})
@Index(["workspaceNotificationRuleId", "teamId", "projectId"], { unique: true })
@UniqueColumnsTogether(
  ["workspaceNotificationRuleId", "teamId", "projectId"],
  "This team already owns this workspace notification rule.",
)
export default class WorkspaceNotificationRuleOwningTeam extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRuleOwningTeam,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRuleOwningTeam,
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
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRuleOwningTeam,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRuleOwningTeam,
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
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRuleOwningTeam,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRuleOwningTeam,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "teamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Team",
    description:
      "Team that owns the rule. Its members, with this team's permissions, change and delete the rule.",
  })
  @ManyToOne(
    () => {
      return Team;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "teamId" })
  public team?: Team = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRuleOwningTeam,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRuleOwningTeam,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Team ID",
    description: "ID of the team that owns the rule",
    example: "f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public teamId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRuleOwningTeam,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRuleOwningTeam,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "workspaceNotificationRuleId",
    type: TableColumnType.Entity,
    modelType: WorkspaceNotificationRule,
    title: "Workspace Notification Rule",
    description: "The workspace notification rule the team owns",
  })
  @ManyToOne(
    () => {
      return WorkspaceNotificationRule;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "workspaceNotificationRuleId" })
  public workspaceNotificationRule?: WorkspaceNotificationRule = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRuleOwningTeam,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRuleOwningTeam,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Workspace Notification Rule ID",
    description: "ID of the workspace notification rule the team owns",
    example: "a7b8c9d0-e1f2-4a3b-4c5d-6e7f8a9b0c1d",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public workspaceNotificationRuleId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRuleOwningTeam,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRuleOwningTeam,
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
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateWorkspaceNotificationRuleOwningTeam,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRuleOwningTeam,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
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
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRuleOwningTeam,
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
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadWorkspaceNotificationRuleOwningTeam,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
