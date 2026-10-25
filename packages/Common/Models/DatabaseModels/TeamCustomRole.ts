import CustomRole from "./CustomRole";
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
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
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
 * A CUSTOM ROLE GIVEN TO A TEAM.
 *
 * Giving it hands the team's members every permission of the role, as if
 * each had been added to the team on its own: the team holds a copy of each
 * (TeamPermission.teamCustomRoleId), made when the role is given and kept
 * equal to the role from then on (Server/Utils/CustomRole/CustomRoleSync).
 * Taking it away takes the copies with it (ON DELETE CASCADE).
 *
 * Added and removed the way a team's own permissions are - by whoever may
 * add them, and only when every permission in the role is one the giver
 * could give the team directly (TeamCustomRoleService). Nothing of it is
 * ever changed in place: a team is given a role, or it is not.
 */
@TableEditionAccessControl({
  requiresEnterprise: true,
})
@TableBillingAccessControl({
  create: PlanType.Scale,
  read: PlanType.Free,
  update: PlanType.Scale,
  delete: PlanType.Free,
})
@EnableDocumentation()
@EnableAuditLog({
  rootResource: {
    resourceType: "Team",
    column: "teamId",
  },
  resourceNameRelation: "customRole",
})
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditProjectTeamPermissions,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadProjectTeam,
    Permission.EditProjectTeamPermissions,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteProjectTeam,
    Permission.EditProjectTeamPermissions,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditProjectTeamPermissions,
  ],
})
@CrudApiEndpoint(new Route("/team-custom-role"))
@Entity({
  name: "TeamCustomRole",
})
@Index(["teamId", "customRoleId", "projectId"], { unique: true })
@UniqueColumnsTogether(
  ["teamId", "customRoleId", "projectId"],
  "This team already has this role.",
)
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "TeamCustomRole",
  singularName: "Team Custom Role",
  pluralName: "Team Custom Roles",
  icon: IconProp.Identification,
  tableDescription:
    "The custom roles a team is given. Its members can do everything the role allows.",
})
export default class TeamCustomRole extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectTeamPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectTeam,
      Permission.EditProjectTeamPermissions,
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
      Permission.EditProjectTeamPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectTeam,
      Permission.EditProjectTeamPermissions,
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectTeamPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectTeam,
      Permission.EditProjectTeamPermissions,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "teamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Team",
    description: "The team given the role.",
    example: "Engineering Team",
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
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectTeamPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectTeam,
      Permission.EditProjectTeamPermissions,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Team ID",
    description: "ID of the team given the role.",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public teamId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectTeamPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectTeam,
      Permission.EditProjectTeamPermissions,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "customRoleId",
    type: TableColumnType.Entity,
    modelType: CustomRole,
    title: "Custom Role",
    description: "The custom role given to the team.",
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectTeamPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectTeam,
      Permission.EditProjectTeamPermissions,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Custom Role ID",
    description: "ID of the custom role given to the team.",
    example: "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public customRoleId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectTeamPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectTeam,
      Permission.EditProjectTeamPermissions,
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectTeamPermissions,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectTeam,
      Permission.EditProjectTeamPermissions,
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
}
