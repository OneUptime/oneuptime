import DetectionRule from "./DetectionRule";
import Project from "./Project";
import SecurityCase from "./SecurityCase";
import SecurityEventConnection from "./SecurityEventConnection";
import ThreatIntelFeed from "./ThreatIntelFeed";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import SecurityDetectionSource from "../../Types/SecurityCase/SecurityDetectionSource";
import OcsfSeverity from "../../Types/SecurityEvent/OcsfSeverity";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One signal in a case: a detection rule's match for one group, a
 * threat-intel hit on one indicator, or an alert a connected product raised.
 * A detection that fires again while its case is open is the same row with
 * a higher count and a later last-seen time, never a new row, so a rule that
 * keeps matching is one line on the case, not hundreds.
 *
 * OneUptime writes detections (there is no create through the API); the
 * Security tiers read them, and deleting one is the Admin tier's, like
 * deleting any security record.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityDetection,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.DeleteSecurityDetection,
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
@EnableMCP()
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
  delete: deletePermissions,
  update: [],
})
@CrudApiEndpoint(new Route("/security-detection"))
@OwnedThrough("securityCaseId", SecurityCase)
@Entity({
  name: "SecurityDetection",
})
@TableMetadata({
  tableName: "SecurityDetection",
  singularName: "Security Detection",
  pluralName: "Security Detections",
  icon: IconProp.Bolt,
  tableDescription:
    "A signal inside a security case: a detection rule's match, a threat intelligence hit, or an alert from a connected security product, with how often it fired.",
})
@Index(["projectId", "fingerprint"])
@Index(["securityCaseId", "lastSeenAt"])
export default class SecurityDetection extends BaseModel {
  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this detection belongs to.",
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
    description: "ID of the project this detection belongs to.",
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
    description: "The case this detection belongs to.",
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
    description: "ID of the case this detection belongs to.",
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
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Title",
    description:
      "What fired, about what: the rule's name and the value it grouped on.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public title?: string = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Description",
    description: "What the detection saw, in Markdown.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public description?: string = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Severity",
    description:
      "OCSF severity of the detection: Informational, Low, Medium, High, Critical or Fatal.",
    defaultValue: OcsfSeverity.Medium,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: OcsfSeverity.Medium,
  })
  public severity?: OcsfSeverity = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Source",
    description:
      "What raised it: a Detection Rule, Threat Intel, a Connected Product, Entity Risk, or a person (Manual).",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public source?: SecurityDetectionSource = undefined;

  /*
   * Stable for "the same signal": a rule and the group value it fired for,
   * a feed and the indicator, a product and its alert id. Repeats while the
   * case is open fold into this row.
   */
  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Fingerprint",
    description:
      "Identifies the same signal across repeats: the source and what it fired for.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public fingerprint?: string = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Rule Name",
    description:
      "The name of what fired: the detection rule, the threat intel feed, or the connected product's own rule.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public ruleName?: string = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "detectionRuleId",
    type: TableColumnType.Entity,
    modelType: DetectionRule,
    title: "Detection Rule",
    description: "The detection rule that fired, for a rule's detection.",
  })
  @ManyToOne(
    () => {
      return DetectionRule;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "detectionRuleId" })
  public detectionRule?: DetectionRule = undefined;

  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "Detection Rule ID",
    description: "ID of the detection rule that fired.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public detectionRuleId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "threatIntelFeedId",
    type: TableColumnType.Entity,
    modelType: ThreatIntelFeed,
    title: "Threat Intel Feed",
    description: "The feed whose indicator matched, for a threat intel hit.",
  })
  @ManyToOne(
    () => {
      return ThreatIntelFeed;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "threatIntelFeedId" })
  public threatIntelFeed?: ThreatIntelFeed = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "Threat Intel Feed ID",
    description: "ID of the feed whose indicator matched.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public threatIntelFeedId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityEventConnectionId",
    type: TableColumnType.Entity,
    modelType: SecurityEventConnection,
    title: "Security Event Connection",
    description:
      "The connection the alert was imported through, for a connected product's alert.",
  })
  @ManyToOne(
    () => {
      return SecurityEventConnection;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityEventConnectionId" })
  public securityEventConnection?: SecurityEventConnection = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "Security Event Connection ID",
    description: "ID of the connection the alert was imported through.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityEventConnectionId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Group Value",
    description:
      "The value the rule grouped its matches by, such as the host or IP address they share.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public groupValue?: string = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Entities",
    description:
      "The users, hosts, IP addresses, domains and files the detection names, each as { type, value }.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public entities?: JSONArray = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "MITRE ATT&CK Tactics",
    description: "ATT&CK tactic ids the detection is tagged with.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public mitreTactics?: Array<string> = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "MITRE ATT&CK Techniques",
    description: "ATT&CK technique ids the detection is tagged with.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public mitreTechniques?: Array<string> = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    title: "Event Count",
    description:
      "How many security events are behind the detection, over every time it fired.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public eventCount?: number = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    title: "Fire Count",
    description: "How many times the detection fired while its case was open.",
    defaultValue: 1,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 1,
  })
  public fireCount?: number = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "First Seen At",
    description: "When the detection first fired.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public firstSeenAt?: Date = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description: "When the detection last fired.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Sample Message",
    description: "The message of one of the events behind the detection.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public sampleMessage?: string = undefined;

  /*
   * The event behind the detection in the events table: the Detection
   * Finding a rule or feed wrote, or the connected product's own alert.
   * Opens it in the Events explorer.
   */
  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Event UID",
    description:
      "eventUid of the security event that records the detection: the Detection Finding a rule or feed wrote, or the imported alert.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public eventUid?: string = undefined;

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
    description: "The person who deleted the detection.",
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
    description: "ID of the person who deleted the detection.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
