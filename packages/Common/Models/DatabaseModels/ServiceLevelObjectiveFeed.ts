import ServiceLevelObjective from "./ServiceLevelObjective";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import Color from "../../Types/Color";
import ColumnLength from "../../Types/Database/ColumnLength";

/*
 * Everything that happened to an SLO that is worth remembering. The overview
 * answers "how is this objective doing right now"; the feed answers "how did it
 * get here" - who changed the target, when the budget went at risk, which
 * burn-rate rule raised the alert, which monitor rule attached which monitors.
 *
 * Unlike the audit log, the feed is always on: SLO audit logs are only written
 * on Enterprise projects that enabled them, and most of an SLO's history is
 * written by the evaluation worker, which the audit log treats as a system
 * event.
 *
 * Values equal their keys and are stored verbatim, so a value must never be
 * renamed once rows exist under it. Names deliberately avoid ending in
 * "Created" / "Updated" / "Restored" unless that is what they mean, because
 * the feed page picks an icon from those suffixes. Status names are not
 * embedded in event names because SloStatus values contain spaces.
 */
export enum ServiceLevelObjectiveFeedEventType {
  ServiceLevelObjectiveCreated = "ServiceLevelObjectiveCreated",
  ServiceLevelObjectiveUpdated = "ServiceLevelObjectiveUpdated",
  ServiceLevelObjectiveEnabled = "ServiceLevelObjectiveEnabled",
  ServiceLevelObjectiveDisabled = "ServiceLevelObjectiveDisabled",
  ServiceLevelObjectiveArchived = "ServiceLevelObjectiveArchived",
  ServiceLevelObjectiveRestored = "ServiceLevelObjectiveRestored",
  StatusChanged = "StatusChanged",
  BurnRateAlertRaised = "BurnRateAlertRaised",
  BurnRateAlertResolved = "BurnRateAlertResolved",
  BurnRateIncidentDeclared = "BurnRateIncidentDeclared",
  BurnRateIncidentResolved = "BurnRateIncidentResolved",
  BurnRateRuleAdded = "BurnRateRuleAdded",
  BurnRateRuleChanged = "BurnRateRuleChanged",
  BurnRateRuleRemoved = "BurnRateRuleRemoved",
  MonitorRuleAdded = "MonitorRuleAdded",
  MonitorRuleChanged = "MonitorRuleChanged",
  MonitorRuleRemoved = "MonitorRuleRemoved",
  MonitorsAttached = "MonitorsAttached",
  MonitorsDetached = "MonitorsDetached",
  OwnerUserAdded = "OwnerUserAdded",
  OwnerUserRemoved = "OwnerUserRemoved",
  OwnerTeamAdded = "OwnerTeamAdded",
  OwnerTeamRemoved = "OwnerTeamRemoved",
  LabelRuleExecuted = "LabelRuleExecuted",
  OwnerRuleExecuted = "OwnerRuleExecuted",
}

@EnableDocumentation()
@CanAccessIfCanReadOn("serviceLevelObjective")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateServiceLevelObjectiveFeed,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadServiceLevelObjectiveFeed,
  ],
  /*
   * Append only. A feed that can be edited or deleted is not a record of what
   * happened, it is a record of what somebody last wanted it to say.
   */
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/service-level-objective-feed"))
@OwnedThrough("serviceLevelObjectiveId", ServiceLevelObjective)
@Entity({
  name: "ServiceLevelObjectiveFeed",
})
@TableMetadata({
  tableName: "ServiceLevelObjectiveFeed",
  singularName: "SLO Feed",
  pluralName: "SLO Feeds",
  icon: IconProp.List,
  tableDescription:
    "Log of everything that happened to this Service Level Objective - configuration changes, status transitions, burn rate alerts and incidents, monitor rule changes and owner changes.",
})
@Index(["serviceLevelObjectiveId", "postedAt"]) // SLO feed page: feed sorted by postedAt
export default class ServiceLevelObjectiveFeed extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveFeed,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveFeed,
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
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveFeed,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "serviceLevelObjectiveId",
    type: TableColumnType.Entity,
    modelType: ServiceLevelObjective,
    title: "Service Level Objective",
    description:
      "Relation to Service Level Objective in which this resource belongs",
    example: "e5f6a7b8-d9c0-1234-5678-901234efab56",
  })
  /*
   * CASCADE: the feed is the SLO's own history. Deleting the SLO deletes it,
   * which is also why there is no "Deleted" event type.
   */
  @ManyToOne(
    () => {
      return ServiceLevelObjective;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "serviceLevelObjectiveId" })
  public serviceLevelObjective?: ServiceLevelObjective = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveFeed,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Service Level Objective ID",
    description:
      "Relation to Service Level Objective ID in which this resource belongs",
    example: "e5f6a7b8-d9c0-1234-5678-901234efab56",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serviceLevelObjectiveId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveFeed,
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
    example: "b2c3d4e5-a6b7-8901-2345-678901bcdef0",
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
      Permission.CreateServiceLevelObjectiveFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveFeed,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "b2c3d4e5-a6b7-8901-2345-678901bcdef0",
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
    example: "c3d4e5f6-b7c8-9012-3456-789012cdef01",
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
    example: "c3d4e5f6-b7c8-9012-3456-789012cdef01",
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
      Permission.CreateServiceLevelObjectiveFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveFeed,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Markdown,
    required: true,
    title: "Log (in Markdown)",
    description: "Log of the Service Level Objective change in Markdown",
    example: "🔴 SLO **Checkout API** changed status to **At Risk**.",
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
      Permission.CreateServiceLevelObjectiveFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveFeed,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Markdown,
    required: false,
    title: "More Information (in Markdown)",
    description: "More information in Markdown",
    example:
      "**SLI:** 99.82%\n\n**Error budget remaining:** 18.4% (79 minutes)",
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
      Permission.CreateServiceLevelObjectiveFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveFeed,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Service Level Objective Feed Event",
    description: "Service Level Objective Feed Event",
    example: "StatusChanged",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    unique: false,
  })
  public serviceLevelObjectiveFeedEventType?: ServiceLevelObjectiveFeedEventType =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjectiveFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveFeed,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Color,
    required: true,
    title: "Color",
    description: "Display color for this feed item",
    example: "#3498db",
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
      Permission.CreateServiceLevelObjectiveFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveFeed,
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
    example: "d4e5f6a7-c8d9-0123-4567-890123def012",
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
      Permission.CreateServiceLevelObjectiveFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveFeed,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
    description:
      "User who this feed belongs to (if this feed belongs to a User)",
    example: "d4e5f6a7-c8d9-0123-4567-890123def012",
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
      Permission.CreateServiceLevelObjectiveFeed,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjectiveFeed,
    ],
    update: [],
  })
  @TableColumn({
    title: "Feed Posted At",
    description: "Date and time when the feed was posted",
    type: TableColumnType.Date,
    example: "2024-01-15T10:30:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public postedAt?: Date = undefined;
}
