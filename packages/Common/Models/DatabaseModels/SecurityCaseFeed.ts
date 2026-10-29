import Project from "./Project";
import SecurityCase from "./SecurityCase";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import Color from "../../Types/Color";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
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
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

// What a feed item records. Each value is its own name, like IncidentFeedEventType.
export enum SecurityCaseFeedEventType {
  CaseOpened = "CaseOpened",
  DetectionAdded = "DetectionAdded",
  StatusChanged = "StatusChanged",
  PriorityChanged = "PriorityChanged",
  AssigneeChanged = "AssigneeChanged",
  CaseUpdated = "CaseUpdated",
  PrivateNote = "PrivateNote",
  PlaybookRun = "PlaybookRun",
  PlaybookStep = "PlaybookStep",
  ApprovalRequested = "ApprovalRequested",
  ApprovalDecided = "ApprovalDecided",
  ThreatIntel = "ThreatIntel",
  EntityActivity = "EntityActivity",
  Notification = "Notification",
  IncidentDeclared = "IncidentDeclared",
  ResponseAction = "ResponseAction",
  // OneUptime AI's triage report (SecurityCaseTriageRunner).
  AiTriage = "AiTriage",
  // A task added, done, opened again, handed on or deleted (SecurityCaseTaskService).
  Task = "Task",
  // Evidence added or removed (SecurityCaseEvidenceService).
  Evidence = "Evidence",
  // A response target about to be missed, or missed (SecurityCaseTargetCheck).
  ResponseTarget = "ResponseTarget",
}

/*
 * The case's timeline: everything that happened to it and on it, written by
 * OneUptime as it happens - the detections that joined, every change of
 * status, priority and assignee, notes, and each step a playbook took. Read
 * like an incident's feed, by the same feed components; nobody edits or
 * deletes an entry, because a timeline that can be rewritten is no record.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityCaseFeed,
];

const columnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@CanAccessIfCanReadOn("securityCase")
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: readPermissions,
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/security-case-feed"))
@OwnedThrough("securityCaseId", SecurityCase)
@Entity({
  name: "SecurityCaseFeed",
})
@TableMetadata({
  tableName: "SecurityCaseFeed",
  singularName: "Security Case Feed Item",
  pluralName: "Security Case Feed Items",
  icon: IconProp.List,
  tableDescription:
    "The timeline of a security case: detections joining, changes of status, priority and assignee, notes, and every step a playbook took.",
})
@Index(["securityCaseId", "postedAt"])
export default class SecurityCaseFeed extends BaseModel {
  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this feed item belongs to.",
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

  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this feed item belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityCaseId",
    type: TableColumnType.Entity,
    modelType: SecurityCase,
    title: "Security Case",
    description: "The case this feed item is about.",
  })
  @ManyToOne(
    () => {
      return SecurityCase;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityCaseId" })
  public securityCase?: SecurityCase = undefined;

  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Security Case ID",
    description: "ID of the case this feed item is about.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityCaseId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.Markdown,
    title: "Feed Info (in Markdown)",
    description: "What happened, in Markdown.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Markdown,
  })
  public feedInfoInMarkdown?: string = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "More Information (in Markdown)",
    description: "Detail behind the entry, shown when it is expanded.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public moreInformationInMarkdown?: string = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Event Type",
    description: "What kind of thing happened.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public securityCaseFeedEventType?: SecurityCaseFeedEventType = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.Color,
    title: "Color",
    description: "The color the entry is drawn in.",
  })
  @Column({
    type: ColumnType.Color,
    length: ColumnLength.Color,
    nullable: false,
    transformer: Color.getDatabaseTransformer(),
  })
  public displayColor?: Color = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "The person who did it, when a person did.",
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

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
    description: "ID of the person who did it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    title: "Posted At",
    description: "When it happened.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public postedAt?: Date = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "The person whose action wrote the entry.",
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

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the person whose action wrote the entry.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Unused: feed entries are not deleted.",
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
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "Unused: feed entries are not deleted.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
