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
 * THE TEAMS THAT OWN A TEAM: what TeamOwnerUser is for people, for teams.
 * Every member of an owning team looks after the owned team as its owners
 * do (with a team permission scoped to Owned) - a team can own itself, so
 * that each of its members may, say, invite people into it.
 *
 * The owned team is named by `ownedTeamId` and the owning team by `teamId`,
 * the owner column of every owner table. Read by whoever may read the team,
 * added and removed by whoever may edit it; Owners and Admin, which come
 * with every project, have no owners (TeamOwnerTeamService).
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
@CrudApiEndpoint(new Route("/team-owner-team"))
@TableMetadata({
  tableName: "TeamOwnerTeam",
  singularName: "Team Team Owner",
  pluralName: "Team Team Owners",
  icon: IconProp.Team,
  tableDescription:
    "Add teams as owners of your teams. The members of an owning team look after who is in the owned team and what it may do.",
})
@Entity({
  name: "TeamOwnerTeam",
})
@Index(["ownedTeamId", "teamId", "projectId"], { unique: true })
@UniqueColumnsTogether(
  ["ownedTeamId", "teamId", "projectId"],
  "This team is already an owner of this team.",
)
export default class TeamOwnerTeam extends BaseModel {
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
    description: "The team that is owned",
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
    description: "ID of the team that is owned",
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
    manyToOneRelationColumn: "teamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Team",
    description:
      "Team that owns the team. Every member of this team is an owner of it.",
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
    create: TEAM_OWNER_WRITERS,
    read: TEAM_OWNER_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Team ID",
    description: "ID of the team that owns the team",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public teamId?: ObjectID = undefined;

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
