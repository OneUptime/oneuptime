import Project from "./Project";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
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
 * THE PEOPLE WHO OWN A TEAM. A team's owners are the people (here) and the
 * teams (TeamOwnerTeam) who look after it: with a team permission scoped to
 * Owned - Invite New Members, Remove Team Members, Edit Team, Edit Team
 * Permissions, Delete Team - its holder acts only on the teams they or their
 * teams own, and whoever creates a team with Create Team scoped to Owned
 * becomes its first owner (OwnerTableRegistry: "Team").
 *
 * Owning a team is not being in it: an owner looks after who is in the team
 * and what it may do, and is a member only if they are invited, like anyone
 * else. The team is named by `ownedTeamId`, as the owner columns of every
 * owner table are `userId` and `teamId`.
 *
 * Read by whoever may read the team, added and removed by whoever may edit
 * it. Owners and Admin, which come with every project, have no owners: their
 * members are the project's owners and admins (TeamOwnerUserService).
 */
const TEAM_OWNER_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.ProjectUser,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadProjectTeam,
];

const TEAM_OWNER_WRITERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditProjectTeam,
];

@CanAccessIfCanReadOn("ownedTeam")
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: TEAM_OWNER_WRITERS,
  read: TEAM_OWNER_READERS,
  delete: TEAM_OWNER_WRITERS,
  update: TEAM_OWNER_WRITERS,
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/team-owner-user"))
@TableMetadata({
  tableName: "TeamOwnerUser",
  singularName: "Team User Owner",
  pluralName: "Team User Owners",
  icon: IconProp.Team,
  tableDescription:
    "Add users as owners to your teams. Owners look after who is in a team and what it may do.",
})
@Entity({
  name: "TeamOwnerUser",
})
@Index(["ownedTeamId", "userId", "projectId"], { unique: true })
@UniqueColumnsTogether(
  ["ownedTeamId", "userId", "projectId"],
  "This user is already an owner of this team.",
)
export default class TeamOwnerUser extends BaseModel {
  @ColumnAccessControl({
    create: TEAM_OWNER_WRITERS,
    read: TEAM_OWNER_READERS,
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
    create: TEAM_OWNER_WRITERS,
    read: TEAM_OWNER_READERS,
    update: [],
  })
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
    create: TEAM_OWNER_WRITERS,
    read: TEAM_OWNER_READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "ownedTeamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Owned Team",
    description: "The team this user owns",
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
  @JoinColumn({ name: "ownedTeamId" })
  public ownedTeam?: Team = undefined;

  @ColumnAccessControl({
    create: TEAM_OWNER_WRITERS,
    read: TEAM_OWNER_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Owned Team ID",
    description: "ID of the team the user owns",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public ownedTeamId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: TEAM_OWNER_WRITERS,
    read: TEAM_OWNER_READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "User that owns the team.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: TEAM_OWNER_WRITERS,
    read: TEAM_OWNER_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "User ID",
    description: "ID of the user who owns the team",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: TEAM_OWNER_WRITERS,
    read: TEAM_OWNER_READERS,
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
    create: TEAM_OWNER_WRITERS,
    read: TEAM_OWNER_READERS,
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

  @ColumnAccessControl({
    create: [],
    read: TEAM_OWNER_READERS,
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
    read: TEAM_OWNER_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
