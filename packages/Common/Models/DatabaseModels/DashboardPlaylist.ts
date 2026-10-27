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
import {
  DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS,
  DashboardPlaylistDashboard,
} from "../../Types/Dashboard/DashboardPlaylist";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Who makes, changes and deletes a playlist: project owners and admins, and
 * whoever holds the playlist permission - as with dashboards.
 */
const CREATORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateDashboardPlaylist,
];

const EDITORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditDashboardPlaylist,
];

const DELETERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.DeleteDashboardPlaylist,
];

/*
 * Who sees and plays a playlist: everyone who reads the project's
 * dashboards by their role, and whoever holds Read Dashboard Playlist. Each
 * dashboard in it is shown only to those who may read that dashboard.
 */
const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadDashboardPlaylist,
];

/*
 * A DASHBOARD PLAYLIST (issue #5235): the project's dashboards that one
 * screen shows one after another - a NOC wall, a team's TV - each for the
 * same time, round and round, until someone pauses it.
 *
 * Its dashboards are one ordered list, `dashboards`
 * (Types/Dashboard/DashboardPlaylist). The player reads them as the viewer
 * reads dashboards, so a playlist never shows anyone a dashboard they may
 * not read: a dashboard that was deleted or archived, or that the viewer
 * may not see, is skipped.
 */
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: CREATORS,
  read: READERS,
  delete: DELETERS,
  update: EDITORS,
})
@CrudApiEndpoint(new Route("/dashboard-playlist"))
@TableMetadata({
  tableName: "DashboardPlaylist",
  singularName: "Dashboard Playlist",
  pluralName: "Dashboard Playlists",
  icon: IconProp.QueueList,
  tableDescription:
    "Dashboards shown one after another on a screen, such as a NOC wall, each for the same time.",
})
@Entity({
  name: "DashboardPlaylist",
})
export default class DashboardPlaylist extends BaseModel {
  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
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
    create: CREATORS,
    read: READERS,
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
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Any friendly name of this object",
    example: "NOC wall",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
    example: "The screen above the on-call desk",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Dashboards",
    description:
      'The dashboards shown, in order: a list like [{"dashboardId": "<id>"}]. One may appear more than once.',
    example: [{ dashboardId: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e" }],
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public dashboards?: Array<DashboardPlaylistDashboard> = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "Interval (Seconds)",
    description:
      "How long each dashboard is shown before the next one, in seconds: 10 to 86400.",
    defaultValue: DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS,
    example: 60,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: DASHBOARD_PLAYLIST_DEFAULT_INTERVAL_IN_SECONDS,
  })
  public intervalInSeconds?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
    read: READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
    read: READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
