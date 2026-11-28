import CloudAccount from "./CloudAccount";
import CloudConnection from "./CloudConnection";
import CloudOffHoursSchedule from "./CloudOffHoursSchedule";
import CloudResource from "./CloudResource";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import { CloudResourceEnvironment } from "../../Types/Cloud/CloudResourceEnvironment";
import {
  CloudSavingsActionKind,
  CloudSavingsActionOrigin,
  CloudSavingsActionStatus,
  CloudSavingsActionUndo,
  CloudSavingsMeasurement,
} from "../../Types/Cloud/CloudSavingsAction";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  ValueTransformer,
} from "typeorm";

/*
 * ONE CHANGE ONEUPTIME MAKES - OR PROPOSES TO MAKE - IN A CLOUD FOR A
 * SAVING (#11010).
 *
 * A saving (CloudCostRecommendation) that is one change through the
 * account's cloud connection (Types/Cloud/CloudSavingsAction) becomes a
 * row here when a person presses Apply, when an AI rule for savings
 * proposes or makes it, or when an off-hours schedule stops a resource.
 * It keeps what was promised and what the resource was, because the
 * saving itself goes away from the recommender once it is acted on:
 *
 *   - Proposed, until an owner of the resource approves it (or a project
 *     admin, for a resource nobody owns) - two of them, where the project
 *     asks two for a change that cannot be undone - or dismisses it;
 *   - Applying, a step at a time (a final snapshot first, a stop first),
 *     run as the person who approved it, or under the AI rule that made
 *     it without asking;
 *   - Applied or AppliedWithoutAsking, then read against the bill
 *     (measurement): what the resource cost a day before the change, and
 *     after, so a saving is said realised only when the bill shows it;
 *   - Undoing and Undone, or Failed with why;
 *   - Ended, for an off-hours schedule's stop the schedule started again,
 *     with the hours the resource did not run.
 *
 * Written by the server alone (CloudSavingsActions, the runner, the
 * schedules): nobody creates, edits or deletes a row through the API. The
 * resource's and the account's timelines say each step, who took it, and
 * how to take it back.
 */

// Postgres answers a decimal as text: read it back as the number it is.
const decimalTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    return value;
  },
  from: (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "number") {
      return value;
    }
    const parsed: number = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  },
};

// Read by those who read the project's cloud resources, as its savings are.
const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadCloudResource,
];

@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/cloud-savings-action"))
@TableMetadata({
  tableName: "CloudSavingsAction",
  singularName: "Cloud Savings Action",
  pluralName: "Cloud Savings Actions",
  icon: IconProp.ArrowTrendingDown,
  tableDescription:
    "Changes OneUptime proposes or makes in your connected clouds to act on a saving - stop an idle instance, delete an unattached disk, release an idle address, resize - with who approved each, whether it can be undone, and what the bill showed it saved. Written by OneUptime; not user-editable.",
})
@Index(["projectId", "status", "appliedAt"])
@Entity({
  name: "CloudSavingsAction",
})
export default class CloudSavingsAction extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this change belongs to.",
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
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this change belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudAccountId",
    type: TableColumnType.Entity,
    modelType: CloudAccount,
    title: "Cloud Account",
    description: "The account the resource is in.",
  })
  @ManyToOne(
    () => {
      return CloudAccount;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudAccountId" })
  public cloudAccount?: CloudAccount = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Cloud Account ID",
    description: "ID of the account the resource is in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudAccountId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudConnectionId",
    type: TableColumnType.Entity,
    modelType: CloudConnection,
    title: "Cloud Connection",
    description: "The connection the change is made through.",
  })
  @ManyToOne(
    () => {
      return CloudConnection;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudConnectionId" })
  public cloudConnection?: CloudConnection = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Cloud Connection ID",
    description: "ID of the connection the change is made through.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudConnectionId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudResourceId",
    type: TableColumnType.Entity,
    modelType: CloudResource,
    title: "Cloud Resource",
    description: "The resource the change is made to, when OneUptime holds it.",
  })
  @ManyToOne(
    () => {
      return CloudResource;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudResourceId" })
  public cloudResource?: CloudResource = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Cloud Resource ID",
    description:
      "ID of the resource the change is made to, when OneUptime holds it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudResourceId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudOffHoursScheduleId",
    type: TableColumnType.Entity,
    modelType: CloudOffHoursSchedule,
    title: "Off-Hours Schedule",
    description:
      "The off-hours schedule that stopped the resource, for a schedule's stop.",
  })
  @ManyToOne(
    () => {
      return CloudOffHoursSchedule;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudOffHoursScheduleId" })
  public cloudOffHoursSchedule?: CloudOffHoursSchedule = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Off-Hours Schedule ID",
    description:
      "ID of the off-hours schedule that stopped the resource, for a schedule's stop.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudOffHoursScheduleId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Recommendation ID",
    description:
      "The recommender's own id of the saving the change acts on, kept after the saving is gone from the recommender.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public recommendationId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    allowedValues: Object.values(CloudProvider),
    title: "Cloud",
    description: "Which cloud the resource is in: 'aws', 'azure' or 'gcp'.",
    example: "aws",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
  })
  public provider?: CloudProvider = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    allowedValues: Object.values(CloudSavingsActionKind),
    title: "Kind",
    description:
      "What the change does: StopInstance, StopDatabase, ChangeVolumeType, DeleteVolume, DeleteSnapshot, DeleteImage, ReleaseAddress, ResizeInstance or ResizeDatabase.",
    example: "StopInstance",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
  })
  public kind?: CloudSavingsActionKind = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    allowedValues: Object.values(CloudSavingsActionStatus),
    title: "Status",
    description:
      "Where the change is: Proposed (waiting for an owner), Applying, Applied, AppliedWithoutAsking, Failed, Dismissed, Undoing, Undone, Expired, or Ended (an off-hours stop the schedule started again).",
    defaultValue: CloudSavingsActionStatus.Proposed,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
    default: CloudSavingsActionStatus.Proposed,
  })
  public status?: CloudSavingsActionStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    allowedValues: Object.values(CloudSavingsActionOrigin),
    title: "Origin",
    description:
      "Who started it: a Person who pressed Apply, an AI Rule, or an off-hours Schedule.",
    example: "Person",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
  })
  public origin?: CloudSavingsActionOrigin = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    allowedValues: Object.values(CloudResourceEnvironment),
    title: "Environment",
    description:
      "Whether the resource was Production, NonProduction or Unknown when the change was proposed, from its tags, its account and its labels.",
    defaultValue: CloudResourceEnvironment.Unknown,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
    default: CloudResourceEnvironment.Unknown,
  })
  public environment?: CloudResourceEnvironment = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    title: "Resource",
    description:
      "The resource as its cloud names it: an ARN, an ARM id, a full resource name.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: false,
    length: ColumnLength.LongText,
  })
  public resourceId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Resource Name",
    description: "What the resource is called.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    length: ColumnLength.ShortText,
  })
  public resourceName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Resource Type",
    description: "What kind of resource it is, in its cloud's words.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    length: ColumnLength.ShortText,
  })
  public resourceType?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Region",
    description: "The Region or zone the resource is in; empty when none.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    length: ColumnLength.ShortText,
  })
  public region?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "From",
    description:
      "What the resource is before the change: a size, a class, a volume type.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    length: ColumnLength.ShortText,
  })
  public fromConfiguration?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "To",
    description: "What the change makes it: a size, a class, a volume type.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    length: ColumnLength.ShortText,
  })
  public toConfiguration?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    title: "Final Snapshot",
    description:
      "For a deleted disk: whether a final snapshot is taken first, which the disk can be made again from.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public finalSnapshot?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    allowedValues: Object.values(CloudSavingsActionUndo),
    title: "Undo",
    description:
      "Whether it can be undone: Undoable, FromSnapshot (made again from its final snapshot) or Never.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
  })
  public undo?: CloudSavingsActionUndo = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    canReadOnRelationQuery: true,
    title: "Monthly Savings",
    description: "What the saving promised a month, in its currency.",
    example: "182.4",
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: false,
    transformer: decimalTransformer,
  })
  public monthlySavings?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Currency",
    description: "The currency the figures are in.",
    example: "USD",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
  })
  public currency?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Target",
    description:
      "The resource as the change addresses it in its cloud: its id, Region or zone, and account.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public target?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Progress",
    description:
      "Where the change is in its steps, and what it did: what undo puts back.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public progress?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Undo Progress",
    description: "Where taking the change back is in its steps.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public undoProgress?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Summary",
    description: "What was done, in a sentence: what the timeline shows.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public summary?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Failure Message",
    description:
      "Why the change, or its undo, failed, and what was done before it did.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public failureMessage?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Next Step At",
    description:
      "When the change's next step is taken, while it is applying or being undone.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextStepAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "requestedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Requested by User",
    description: "The person who pressed Apply.",
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
  @JoinColumn({ name: "requestedByUserId" })
  public requestedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Requested by User ID",
    description: "ID of the person who pressed Apply.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public requestedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "firstApprovedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "First Approved by User",
    description:
      "For a change that needs two approvals: the first person who approved it.",
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
  @JoinColumn({ name: "firstApprovedByUserId" })
  public firstApprovedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "First Approved by User ID",
    description:
      "For a change that needs two approvals: ID of the first person who approved it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public firstApprovedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "First Approved At",
    description: "When the first of two approvals was given.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public firstApprovedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "approvedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Approved by User",
    description:
      "The person whose approval made the change, and who it ran as.",
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
  @JoinColumn({ name: "approvedByUserId" })
  public approvedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Approved by User ID",
    description:
      "ID of the person whose approval made the change, and who it ran as.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public approvedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Approved At",
    description: "When the change was approved.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public approvedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "AI Rule ID",
    description:
      "ID of the AI rule for savings that proposed or made the change.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public autoRemediationRuleId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "AI Rule",
    description:
      "The name of the AI rule for savings that proposed or made the change, as it was then.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    length: ColumnLength.ShortText,
  })
  public autoRemediationRuleName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Applied At",
    description: "When the change was made in the cloud.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public appliedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    /*
     * Not "Failed At", which the Dashboard keeps out of its locales: a
     * probe's failed phase was once drawn under it (#7422).
     */
    title: "Change Failed At",
    description: "When the change failed.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public failedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "dismissedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Dismissed by User",
    description: "The person who said no.",
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
  @JoinColumn({ name: "dismissedByUserId" })
  public dismissedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Dismissed by User ID",
    description: "ID of the person who said no.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dismissedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Dismissed At",
    description: "When the change was dismissed.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public dismissedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Dismiss Reason",
    description: "Why the change was dismissed.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public dismissReason?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "undoneByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Undone by User",
    description: "The person who took the change back.",
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
  @JoinColumn({ name: "undoneByUserId" })
  public undoneByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Undone by User ID",
    description: "ID of the person who took the change back.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public undoneByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Undone At",
    description: "When the change was taken back.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public undoneAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Expired At",
    description: "When a waiting change was no longer needed.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public expiredAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Ended At",
    description:
      "For an off-hours stop: when the schedule started the resource again.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public endedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Saved Hours",
    description: "For an off-hours stop: the hours the resource did not run.",
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: decimalTransformer,
  })
  public savedHours?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    allowedValues: Object.values(CloudSavingsMeasurement),
    title: "Measurement",
    description:
      "What the bill says of the change: Measuring, Realised, NotSeen or CannotMeasure.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    length: ColumnLength.ShortText,
  })
  public measurement?: CloudSavingsMeasurement = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Cost a Day Before",
    description:
      "What the resource cost a day over the days before the change, from its cloud's bill.",
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: decimalTransformer,
  })
  public costBeforeDaily?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Cost a Day After",
    description:
      "What the resource cost a day over the days read after the change, from its cloud's bill.",
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: decimalTransformer,
  })
  public costAfterDaily?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "Realised Monthly Savings",
    description:
      "What the change saves a month as the bill shows it: the cost a day before less the cost a day after, made a month.",
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: decimalTransformer,
  })
  public realisedMonthlySavings?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Measured At",
    description: "When the bill was last read for the change.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public measuredAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Created by User ID",
    description:
      "ID of the user who created this row (OneUptime writes it as root).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
