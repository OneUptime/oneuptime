import Project from "./Project";
import DataSecurityIssue from "./DataSecurityIssue";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import Color from "../../Types/Color";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
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
export enum DataSecurityIssueFeedEventType {
  IssueOpened = "IssueOpened",
  SeverityChanged = "SeverityChanged",
  EvidenceChanged = "EvidenceChanged",
  StatusChanged = "StatusChanged",
  Resolved = "Resolved",
  Reopened = "Reopened",
  Accepted = "Accepted",
  AcceptanceExpired = "AcceptanceExpired",
  AssigneeChanged = "AssigneeChanged",
  RecheckRequested = "RecheckRequested",
  SecurityCaseOpened = "SecurityCaseOpened",
  AlertRaised = "AlertRaised",
  OwnersNotified = "OwnersNotified",
  // OneUptime AI's explanation, or a fix it was asked to open.
  AiExplanation = "AiExplanation",
  AiFixRequested = "AiFixRequested",
  // Public access blocked or sharing revoked from the issue (DataSecurityResponse).
  ResponseActionTaken = "ResponseActionTaken",
}

/*
 * The issue's timeline: everything that happened to it, written by OneUptime
 * as it happens - when it opened, every change of severity, evidence,
 * status and assignee, the cases, alerts and notifications it caused, and
 * what OneUptime AI said about it. Read like an incident's feed, by the
 * same feed components; nobody edits or deletes an entry, because a
 * timeline that can be rewritten is no record.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataSecurityIssueFeed,
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
@CanAccessIfCanReadOn("dataSecurityIssue")
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
@CrudApiEndpoint(new Route("/data-security-issue-feed"))
@Entity({
  name: "DataSecurityIssueFeed",
})
@TableMetadata({
  tableName: "DataSecurityIssueFeed",
  singularName: "Data Security Issue Feed Item",
  pluralName: "Data Security Issue Feed Items",
  icon: IconProp.List,
  tableDescription:
    "The timeline of a data security issue: when it opened, changes of severity, status and assignee, and the cases, alerts and notifications it caused.",
})
@Index(["dataSecurityIssueId", "postedAt"])
export default class DataSecurityIssueFeed extends BaseModel {
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
    manyToOneRelationColumn: "dataSecurityIssueId",
    type: TableColumnType.Entity,
    modelType: DataSecurityIssue,
    title: "Data Security Issue",
    description: "The case this feed item is about.",
  })
  @ManyToOne(
    () => {
      return DataSecurityIssue;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "dataSecurityIssueId" })
  public dataSecurityIssue?: DataSecurityIssue = undefined;

  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Data Security Issue ID",
    description: "ID of the case this feed item is about.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataSecurityIssueId?: ObjectID = undefined;

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
  public dataSecurityIssueFeedEventType?: DataSecurityIssueFeedEventType =
    undefined;

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
