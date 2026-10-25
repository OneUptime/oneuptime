import Incident from "./Incident";
import Label from "./Label";
import Project from "./Project";
import SecurityCasePriority from "./SecurityCasePriority";
import SecurityCaseStatus from "./SecurityCaseStatus";
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
import SecurityCaseAiVerdict from "../../Types/SecurityCase/SecurityCaseAiVerdict";
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
 * the end a verdict. Its status and its priority are among its project's own
 * (SecurityCaseStatus, SecurityCasePriority), read by what they mean - which
 * status is the new, the contained, the closed one; which priority each
 * detection severity opens a case at - never by their names. Detection
 * rules, threat-intel matches and the products
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
@Index(["projectId", "securityCaseStatusId"])
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

  /*
   * Where the case stands: one of the project's case statuses. A case
   * created without one starts in the project's new status; one in a
   * status that counts as closed carries a verdict
   * (Common/Utils/SecurityCase/SecurityCaseStatuses). A status cases are in
   * cannot be deleted (the key refuses it, NO ACTION).
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "securityCaseStatusId",
    type: TableColumnType.Entity,
    modelType: SecurityCaseStatus,
    title: "Status",
    description:
      "Where the case stands: one of the project's case statuses. Every case starts in the new status; closing it records a verdict.",
  })
  @ManyToOne(
    () => {
      return SecurityCaseStatus;
    },
    {
      eager: false,
      nullable: true,
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityCaseStatusId" })
  public securityCaseStatus?: SecurityCaseStatus = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Status ID",
    description:
      "ID of the case's status. Optional on create: a new case starts in the project's new status.",
    example: "d4e5f6a7-b8c9-4123-8def-456789012345",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityCaseStatusId?: ObjectID = undefined;

  /*
   * How urgent the case is: one of the project's case priorities, ranked by
   * their order. A case opened by a detection starts at the priority of the
   * detection's severity and rises when a more severe one joins it; one a
   * person opens starts at the medium priority
   * (Common/Utils/SecurityCase/SecurityCasePriorities).
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "securityCasePriorityId",
    type: TableColumnType.Entity,
    modelType: SecurityCasePriority,
    title: "Priority",
    description:
      "How urgent the case is: one of the project's case priorities. A detection's case starts at its severity's priority and rises with worse ones.",
  })
  @ManyToOne(
    () => {
      return SecurityCasePriority;
    },
    {
      eager: false,
      nullable: true,
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityCasePriorityId" })
  public securityCasePriority?: SecurityCasePriority = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Priority ID",
    description:
      "ID of the case's priority. Optional on create: a case opened by hand starts at the project's medium priority.",
    example: "e5f6a7b8-c9d0-4234-9efa-567890123456",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityCasePriorityId?: ObjectID = undefined;

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
      "What opened the case: a Detection Rule, Threat Intel, a Connected Product, Entity Risk, or a person (Manual).",
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
   * workers handed the same rise tell people once. A plain id: the rank it
   * is compared by is the priority's place in the project's list now.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Notified Priority ID",
    description:
      "ID of the highest priority people have been told about this case at. They are told again only when it rises above it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public notifiedSecurityCasePriorityId?: ObjectID = undefined;

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

  /*
   * OneUptime AI's triage of the case (SecurityCaseTriageRunner): its read
   * of what the case is, the priority it suggests, the playbook that fits,
   * and the report it wrote, with when. Written only by OneUptime, the
   * moment a triage finishes; never the case's own verdict or priority,
   * which a person sets (the case card offers each suggestion as one
   * click). Empty until a triage has finished.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "AI Verdict",
    description:
      "What OneUptime AI made of the case when it triaged it: Likely Malicious, Likely Benign, Likely False Positive or Inconclusive. A suggestion; a person sets the case's verdict.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public aiVerdict?: SecurityCaseAiVerdict = undefined;

  /*
   * The priority OneUptime AI suggested: the project's priority of the level
   * the triage named (Critical, High, Medium, Low or Informational), kept
   * by id so it reads with the name the project gives it.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "AI Suggested Priority ID",
    description:
      "ID of the priority OneUptime AI suggested when it triaged the case. The case's own priority changes only when a person sets it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public aiSuggestedSecurityCasePriorityId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "AI Suggested Playbook ID",
    description:
      "ID of the project's playbook OneUptime AI suggested running when it triaged the case. It runs only when a person runs it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public aiSuggestedPlaybookId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Markdown,
    computed: true,
    title: "AI Triage Report",
    description:
      "The report OneUptime AI wrote when it last triaged the case: what happened, its read and the evidence for it, and the next steps.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public aiTriageReport?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "AI Triaged At",
    description: "When OneUptime AI last finished triaging the case.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public aiTriagedAt?: Date = undefined;

  /*
   * Whether the case's data held text written to steer an AI - "ignore
   * previous instructions", a chat template's tokens, the triage's own
   * answer lines (Common/Utils/AI/InstructionLikeText). A triage that found
   * some never reads the case as benign or a false positive: it reads
   * Inconclusive, and the card says why.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    computed: true,
    title: "AI Triage Prompt Injection Suspected",
    description:
      "Whether OneUptime AI found text in the case's data written to steer an AI when it triaged the case. It then leaves the call to a person.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public aiTriagePromptInjectionSuspected?: boolean = undefined;

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
