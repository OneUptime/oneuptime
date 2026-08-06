import Label from "./Label";
import Project from "./Project";
import StatusPage from "./StatusPage";
import StatusPageGroup from "./StatusPageGroup";
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
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

@EnableDocumentation()
@CanAccessIfCanReadOn("statusPage")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.StatusPageAdmin,
    Permission.StatusPageMember,
    Permission.CreateStatusPageMonitorRule,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.StatusPageAdmin,
    Permission.StatusPageMember,
    Permission.StatusPageViewer,
    Permission.ReadStatusPageMonitorRule,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.StatusPageAdmin,
    Permission.StatusPageMember,
    Permission.DeleteStatusPageMonitorRule,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.StatusPageAdmin,
    Permission.StatusPageMember,
    Permission.EditStatusPageMonitorRule,
  ],
})
@CrudApiEndpoint(new Route("/status-page-monitor-rule"))
@Entity({
  name: "StatusPageMonitorRule",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "StatusPageMonitorRule",
  singularName: "Status Page Monitor Rule",
  pluralName: "Status Page Monitor Rules",
  icon: IconProp.Filter,
  tableDescription:
    "Configure rules that automatically add matching monitors to a status page group, instead of picking every monitor by hand",
})
export default class StatusPageMonitorRule extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
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
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
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
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "statusPageId",
    type: TableColumnType.Entity,
    modelType: StatusPage,
    title: "Status Page",
    description: "Status page this rule adds matching monitors to",
  })
  @ManyToOne(
    () => {
      return StatusPage;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "statusPageId" })
  public statusPage?: StatusPage = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Status Page ID",
    description: "ID of the status page this rule adds matching monitors to",
    example: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public statusPageId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageMonitorRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of this status page monitor rule",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageMonitorRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description of this status page monitor rule",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageMonitorRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description:
      "Whether this rule is enabled. A disabled rule removes the monitors it had added.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  // Match Criteria

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageMonitorRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Monitor Labels",
    description:
      "Only match monitors that carry at least one of these labels. Leave empty to skip the label filter.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "StatusPageMonitorRuleMonitorLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "statusPageMonitorRuleId",
      referencedColumnName: "_id",
    },
  })
  public monitorLabels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageMonitorRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Monitor Name Pattern",
    description:
      "Regex (case-insensitive) matched against the monitor name. Leave empty to skip the name filter. Use .* to match every monitor.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public monitorNamePattern?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageMonitorRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Monitor Description Pattern",
    description:
      "Regex (case-insensitive) matched against the monitor description. Leave empty to skip the description filter.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public monitorDescriptionPattern?: string = undefined;

  // Action: where matched monitors land, and how they are rendered.

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageMonitorRule,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "statusPageGroupId",
    type: TableColumnType.Entity,
    modelType: StatusPageGroup,
    title: "Status Page Group",
    description:
      "Group that matched monitors are added to. Leave empty to add them ungrouped.",
  })
  @ManyToOne(
    () => {
      return StatusPageGroup;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "statusPageGroupId" })
  public statusPageGroup?: StatusPageGroup = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageMonitorRule,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Status Page Group ID",
    description:
      "ID of the group that matched monitors are added to. Empty means ungrouped.",
    example: "c9d0e1f2-a3b4-5678-9abc-def012345678",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public statusPageGroupId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageMonitorRule,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Show current status",
    description:
      "Show current status like offline, operational or degraded on the resources this rule adds.",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public showCurrentStatus?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageMonitorRule,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Show uptime percent",
    description:
      "Show uptime percent on the resources this rule adds to the status page.",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public showUptimePercent?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageMonitorRule,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Uptime Percent Precision",
    required: false,
    description:
      "Precision of the uptime percent shown on the resources this rule adds",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
  })
  public uptimePercentPrecision?: UptimePrecision = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.EditStatusPageMonitorRule,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Show History Chart",
    description:
      "Show a 90 day uptime history on the resources this rule adds to the status page.",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public showStatusHistoryChart?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
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
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.CreateStatusPageMonitorRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.StatusPageAdmin,
      Permission.StatusPageMember,
      Permission.StatusPageViewer,
      Permission.ReadStatusPageMonitorRule,
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
}
