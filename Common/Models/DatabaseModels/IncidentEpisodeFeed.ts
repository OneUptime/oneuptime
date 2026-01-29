import IncidentEpisode from "./IncidentEpisode";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import ColorField from "../../Types/Database/ColorField";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import Color from "../../Types/Color";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

export enum IncidentEpisodeFeedEventType {
  EpisodeCreated = "EpisodeCreated",
  EpisodeStateChanged = "EpisodeStateChanged",
  EpisodeUpdated = "EpisodeUpdated",
  IncidentAdded = "IncidentAdded",
  IncidentRemoved = "IncidentRemoved",
  OwnerUserAdded = "OwnerUserAdded",
  OwnerTeamAdded = "OwnerTeamAdded",
  OwnerUserRemoved = "OwnerUserRemoved",
  OwnerTeamRemoved = "OwnerTeamRemoved",
  OwnerNotificationSent = "OwnerNotificationSent",
  PrivateNote = "PrivateNote",
  RootCause = "RootCause",
  RemediationNotes = "RemediationNotes",
  PostmortemNote = "PostmortemNote",
  OnCallPolicy = "OnCallPolicy",
  OnCallNotification = "OnCallNotification",
  SeverityChanged = "SeverityChanged",
}

@EnableDocumentation()
@CanAccessIfCanReadOn("incidentEpisode")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateIncidentEpisodeFeed,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadIncidentEpisodeFeed,
    Permission.ReadAllProjectResources,
  ],
  delete: [],
  update: [],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/incident-episode-feed"))
@Entity({
  name: "IncidentEpisodeFeed",
})
@TableMetadata({
  tableName: "IncidentEpisodeFeed",
  singularName: "Incident Episode Feed",
  pluralName: "Incident Episode Feeds",
  icon: IconProp.List,
  tableDescription:
    "Log of the entire incident episode activity. This is a log of all the episode state changes, incidents added/removed, notes, etc.",
})
export default class IncidentEpisodeFeed extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentEpisodeFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentEpisodeFeed,
      Permission.ReadAllProjectResources,
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentEpisodeFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentEpisodeFeed,
      Permission.ReadAllProjectResources,
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentEpisodeFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentEpisodeFeed,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentEpisodeId",
    type: TableColumnType.Entity,
    modelType: IncidentEpisode,
    title: "Incident Episode",
    description: "Relation to Incident Episode in which this resource belongs",
  })
  @ManyToOne(
    () => {
      return IncidentEpisode;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentEpisodeId" })
  public incidentEpisode?: IncidentEpisode = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentEpisodeFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentEpisodeFeed,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Incident Episode ID",
    description:
      "Relation to Incident Episode ID in which this resource belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentEpisodeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentEpisodeFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentEpisodeFeed,
      Permission.ReadAllProjectResources,
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
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentEpisodeFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentEpisodeFeed,
      Permission.ReadAllProjectResources,
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
      Permission.ProjectMember,
      Permission.CreateIncidentEpisodeFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentEpisodeFeed,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Markdown,
    required: true,
    title: "Log (in Markdown)",
    description: "Log of the entire incident episode activity in Markdown",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: false,
    unique: false,
  })
  public feedInfoInMarkdown?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentEpisodeFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentEpisodeFeed,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Markdown,
    required: false,
    title: "More Information (in Markdown)",
    description: "More information in Markdown",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
    unique: false,
  })
  public moreInformationInMarkdown?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentEpisodeFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentEpisodeFeed,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Incident Episode Feed Event",
    description: "Incident Episode Feed Event Type",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    unique: false,
  })
  public incidentEpisodeFeedEventType?: IncidentEpisodeFeedEventType =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentEpisodeFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentEpisodeFeed,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @ColorField()
  @TableColumn({
    type: TableColumnType.Color,
    required: true,
    title: "Color",
    description: "Display color for the incident episode log",
  })
  @Column({
    type: ColumnType.Color,
    length: ColumnLength.Color,
    nullable: false,
    unique: false,
    transformer: Color.getDatabaseTransformer(),
  })
  public displayColor?: Color = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentEpisodeFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentEpisodeFeed,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description:
      "Relation to User who this feed belongs to (if this feed belongs to a User)",
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
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentEpisodeFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentEpisodeFeed,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
    description:
      "User who this feed belongs to (if this feed belongs to a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateIncidentEpisodeFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentEpisodeFeed,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    title: "Feed Posted At",
    description: "Date and time when the feed was posted",
    type: TableColumnType.Date,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public postedAt?: Date = undefined;
}
