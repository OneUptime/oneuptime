import Incident from "./Incident";
import Label from "./Label";
import Project from "./Project";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import SecurityCasePriority from "../../Types/SecurityCase/SecurityCasePriority";
import SecurityCaseStatus from "../../Types/SecurityCase/SecurityCaseStatus";
import SecurityCaseVerdict from "../../Types/SecurityCase/SecurityCaseVerdict";
import SecurityDetectionSource from "../../Types/SecurityCase/SecurityDetectionSource";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

/*
 * A security case is the unit of work of a security team: one threat, made
 * of the detections that point at it, with somebody on it, a status, and in
 * the end a verdict. Detection rules, threat-intel matches and the products
 * a project connects all raise detections; detections about the same thing
 * (the same user, host or address) gather in one open case instead of
 * paging an analyst once per rule per minute.
 *
 * It reads through the Security tiers like the rest of the SIEM: a case is
 * the investigation trail of a possible breach, which is exactly what a
 * project-wide Viewer must not be handed by default. Working a case
 * (assigning, changing status and priority, closing) is the Member tier's
 * job; deleting one destroys that trail, so it is the Admin tier's.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityCase,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.CreateSecurityCase,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditSecurityCase,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.DeleteSecurityCase,
];

// Columns only OneUptime writes: numbers, counts and timestamps.
const serverWrittenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@EnableMCP()
@EnableAuditLog()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
@CrudApiEndpoint(new Route("/security-case"))
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@Entity({
  name: "SecurityCase",
})
@TableMetadata({
  tableName: "SecurityCase",
  singularName: "Security Case",
  pluralName: "Security Cases",
  icon: IconProp.ShieldExclamation,
  tableDescription:
    "A possible threat to investigate: the detections that point at it, who is on it, its priority and status, and the verdict it closed with.",
  enableRealtimeEventsOn: {
    create: true,
    update: true,
    delete: true,
  },
})
@Index(["projectId", "status"])
@Index(["projectId", "groupingKey"])
export default class SecurityCase extends BaseModel {
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this case belongs to.",
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this case belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Case Number",
    description:
      "The case's number in this project, counting up from 1 as cases are opened.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public caseNumber?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Case Number With Prefix",
    description:
      "The case number with the project's case number prefix in front of it, like CASE-42.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public caseNumberWithPrefix?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Title",
    description: "What the case is about, in a line.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public title?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Description",
    description:
      "What is known about the threat, in Markdown. A case opened by a detection starts with the detection's description.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Status",
    description:
      "New, Investigating, Contained or Closed. Every case starts New; closing it records a verdict.",
    defaultValue: SecurityCaseStatus.New,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityCaseStatus.New,
  })
  public status?: SecurityCaseStatus = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Priority",
    description:
      "Critical, High, Medium, Low or Informational. A case opened by a detection starts at the detection's severity and rises when a more severe one joins it.",
    defaultValue: SecurityCasePriority.Medium,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityCasePriority.Medium,
  })
  public priority?: SecurityCasePriority = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Verdict",
    description:
      "What the case turned out to be, set when it is closed: True Positive, Benign Positive, False Positive or Undetermined.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public verdict?: SecurityCaseVerdict = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Closing Note",
    description:
      "Why the case was closed the way it was, in Markdown: what was found and what was done.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public closingNote?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "assignedToUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Assigned To User",
    description: "The person working the case.",
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
  @JoinColumn({ name: "assignedToUserId" })
  public assignedToUser?: User = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "Assigned To User ID",
    description: "ID of the person working the case.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public assignedToUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "assignedToTeamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Assigned To Team",
    description:
      "The team whose queue the case is in, whether or not one person has picked it up.",
  })
  @ManyToOne(
    () => {
      return Team;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "assignedToTeamId" })
  public assignedToTeam?: Team = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "Assigned To Team ID",
    description: "ID of the team whose queue the case is in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public assignedToTeamId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Source",
    description:
      "What opened the case: a Detection Rule, Threat Intel, a Connected Product, or a person (Manual).",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public source?: SecurityDetectionSource = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Entities",
    description:
      "The users, hosts, IP addresses, domains and files the case is about, each as { type, value }. Detections add theirs as they join the case.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public entities?: JSONArray = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "MITRE ATT&CK Tactics",
    description:
      "ATT&CK tactic ids (TA0006) the case's detections are tagged with.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public mitreTactics?: Array<string> = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "MITRE ATT&CK Techniques",
    description:
      "ATT&CK technique ids (T1110) the case's detections are tagged with.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public mitreTechniques?: Array<string> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Detection Count",
    description: "How many distinct detections the case holds.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public detectionCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "First Detected At",
    description: "When the case's earliest detection fired.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public firstDetectedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Last Detected At",
    description: "When a detection of the case last fired.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastDetectedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Acknowledged At",
    description:
      "When somebody first took the case on: assigned it to a person, or moved it out of New. The time to acknowledge is measured to here.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public acknowledgedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Contained At",
    description:
      "When the case first reached Contained. The time to contain is measured to here.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public containedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Closed At",
    description:
      "When the case was closed. Cleared if it is reopened. The time to close is measured to here.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public closedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "closedByUserId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: User,
    title: "Closed By User",
    description: "The person who closed the case.",
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
  @JoinColumn({ name: "closedByUserId" })
  public closedByUser?: User = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Closed By User ID",
    description: "ID of the person who closed the case.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public closedByUserId?: ObjectID = undefined;

  /*
   * What new detections are matched on to join this case while it is open:
   * the entity they are about ("entity:web-01") or, for a detection about no
   * entity, its own fingerprint. Written by OneUptime when the case opens.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    computed: true,
    title: "Grouping Key",
    description:
      "What new detections are matched on to join this case while it is open: the entity they are about, or the detection's own fingerprint.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public groupingKey?: string = undefined;

  /*
   * The highest priority people have been told about this case at
   * (SecurityCaseNotifications): the New Security Case notification goes out
   * again only when the case rises above it, and then only to the people
   * whose chosen priority it now reaches. Empty until the case first reaches
   * somebody's priority. Written by OneUptime in one compare-and-set, so two
   * workers handed the same rise tell people once.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "Notified Priority",
    description:
      "The highest priority people have been told about this case at. They are told again only when it rises above it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public notifiedPriority?: SecurityCasePriority = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "incidentId",
    type: TableColumnType.Entity,
    modelType: Incident,
    title: "Incident",
    description:
      "The OneUptime incident declared for this case, when it became one.",
  })
  @ManyToOne(
    () => {
      return Incident;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentId" })
  public incident?: Incident = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "Incident ID",
    description: "ID of the OneUptime incident declared for this case.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description: "Labels to filter and report on cases by.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "SecurityCaseLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "securityCaseId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description:
      "The person who opened the case by hand. Empty for a case a detection opened.",
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the person who opened the case by hand.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "The person who deleted the case.",
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

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the person who deleted the case.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
