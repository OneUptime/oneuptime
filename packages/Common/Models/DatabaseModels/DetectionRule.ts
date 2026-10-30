import Project from "./Project";
import User from "./User";
import AlertSeverity from "./AlertSeverity";
import IncidentSeverity from "./IncidentSeverity";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
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
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Part of the SIEM, so it reads and is administered through the Security
 * tiers rather than the Telemetry ones it used to share a list with. A
 * detection rule and a threat-intel subscription describe what a project is
 * watching for and what it believes it is up against, which is security
 * posture rather than observability configuration.
 */
const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.CreateProjectDetectionRule,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadProjectDetectionRule,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditProjectDetectionRule,
];

/*
 * Detections-as-code: a Sigma rule evaluated on a schedule against the
 * SecurityEvent ClickHouse table. Matches open Alerts (deduped per rule +
 * group-by fingerprint) and, optionally, write a Detection Finding row
 * back into the security events table so detections are themselves
 * queryable signals.
 */
@EnableDocumentation()
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/detection-rule"))
@Entity({
  name: "DetectionRule",
})
@TableMetadata({
  tableName: "DetectionRule",
  singularName: "Detection Rule",
  pluralName: "Detection Rules",
  icon: IconProp.ShieldExclamation,
  tableDescription:
    "Sigma detection rules evaluated against security events. Matches create alerts and detection findings.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.DeleteProjectDetectionRule,
  ],
  update: updatePermissions,
})
export default class DetectionRule extends BaseModel {
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
    description: "Relation to the project this detection rule belongs to.",
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
    description: "ID of the project this detection rule belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  /*
   * A rule is named after its Sigma title - by the Rule Library, by the
   * form and by the server when a create names none - so the name holds
   * what a title is: 100 characters, as every other name in OneUptime and
   * Microsoft Sentinel's rule names. It was 50, and the library's own
   * "Failed sign-ins, then a success from the same address" (53) failed
   * Turn on recommended; a quarter of SigmaHQ's titles are longer than 50.
   * A title longer still is cut to fit wherever OneUptime names a rule
   * after it (fitDetectionRuleName).
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Friendly name for this detection rule.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Description",
    description: "Description of what this detection rule looks for.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    title: "Sigma Rule (YAML)",
    description:
      "The Sigma rule to evaluate, in YAML. detection selections and condition are compiled to a ClickHouse query over security events.",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public sigmaRuleYaml?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Enabled",
    description: "Whether this detection rule is evaluated.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    title: "Evaluation Interval (Minutes)",
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    description:
      "How often this rule is evaluated, in minutes. The evaluation window covers the time since the previous evaluation.",
    defaultValue: 1,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 1,
  })
  public evaluationIntervalInMinutes?: number = undefined;

  /*
   * A rule that fires on one event can be checked as each event arrives
   * (Types/SecurityEvent/RealTimeDetection): within seconds instead of on
   * its interval, which it then no longer runs on. Off by default, and on
   * every rule saved before the column existed: a scheduled rule stays
   * scheduled until somebody chooses otherwise. The evaluator gates on
   * === true, so an unset column reads as off.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Run in Real Time",
    description:
      "Whether each event is checked against this rule as it arrives, within seconds, instead of every evaluation interval. Only for a rule that fires on one event: not a correlation, a match count threshold of 1, no distinct count field and no regular expression.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public isRealTime?: boolean = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    title: "Group By Field",
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    description:
      "Optional security-event field (e.g. principalHost, principalUser) to group matches by. One alert is opened per distinct value; empty groups all matches into one alert.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public groupByField?: string = undefined;

  /*
   * The correlation pair: distinctCountField switches what the threshold
   * counts (unique field values instead of raw events — the difference
   * between brute-force and one user retyping a password), and
   * matchCountThreshold holds the rule back until a group reaches N in
   * one evaluation window. Threshold 1 preserves fire-on-any-match, so
   * every rule saved before these columns existed behaves unchanged.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    title: "Distinct Count Field",
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    description:
      "Optional security-event field (e.g. principalUser, principalIp) whose distinct values are counted instead of raw matching events. The match count threshold then applies to that distinct count. Empty values are not counted. Names that are not typed event columns are looked up in the event's attributes map.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public distinctCountField?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    title: "Match Count Threshold",
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    description:
      "Fire only when a group's count — distinct values when a distinct count field is set, matching events otherwise — reaches this number within one evaluation window. 1 fires on any match.",
    defaultValue: 1,
    /*
     * Same reason as shouldCreateIncident: without this,
     * checkRequiredFields 400s every create payload written before the
     * column existed, and the DB DEFAULT 1 can never apply.
     */
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 1,
  })
  public matchCountThreshold?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Create Alerts",
    description: "Whether matches open OneUptime alerts.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public shouldCreateAlert?: boolean = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Write Detection Findings",
    description:
      "Whether matches also write a Detection Finding security event back into the events table.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public shouldWriteDetectionFinding?: boolean = undefined;

  /*
   * Default FALSE, unlike shouldCreateAlert. An incident is the heavy
   * machinery — workspace channels, SLAs, on-call escalation, status-page
   * visibility — and a rule imported from a community Sigma pack must not
   * open one per match group unless somebody chose that. The evaluator
   * gates on === true for the same reason: an unset column must read as
   * off, not as "probably on".
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Create Incidents",
    description:
      "Whether matches also open OneUptime incidents. Off by default: incidents drive on-call, SLAs and status pages, so opt in per rule.",
    defaultValue: false,
    /*
     * Without this, checkRequiredFields 400s any create payload that
     * omits the flag — including every API client written before the
     * column existed — and the DB DEFAULT false can never apply.
     */
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public shouldCreateIncident?: boolean = undefined;

  /*
   * On by default, unlike incidents: a case is where a security team works
   * a detection - nobody is paged by one opening, and a case gathers a
   * rule's repeats and every other rule's signals about the same entity
   * instead of stacking alerts. Checked !== false, so a rule saved before
   * the column existed opens cases too.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Open Security Cases",
    description:
      "Whether matches open security cases (or join the open case about the same entity), where the security team works them and playbooks respond.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public shouldCreateCase?: boolean = undefined;

  /*
   * What each match adds to the risk of the user, host or address it is
   * about (Types/SecurityCase/SecurityEntityRisk): empty for the points of
   * the rule's level - Low 10, Medium 25, High 50, Critical 75 - or the
   * rule's own, from 0 (adds no risk) to 100. A rule that opens no cases
   * still adds risk, so a rule too noisy to open cases of its own can still
   * tell, with others, which entity to look at.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Risk Points",
    description:
      "What a match adds to the risk of the user, host or address it is about, from 0 to 100. Empty: by the rule's level.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public riskScore?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "alertSeverityId",
    type: TableColumnType.Entity,
    modelType: AlertSeverity,
    title: "Alert Severity",
    description:
      "Severity of alerts opened by this rule. Defaults from the Sigma rule's level, mapped onto this project's severities, when unset.",
  })
  @ManyToOne(
    () => {
      return AlertSeverity;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "alertSeverityId" })
  public alertSeverity?: AlertSeverity = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Alert Severity ID",
    description: "ID of the alert severity for alerts opened by this rule.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertSeverityId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentSeverityId",
    type: TableColumnType.Entity,
    modelType: IncidentSeverity,
    title: "Incident Severity",
    description:
      "Severity of incidents opened by this rule. Defaults from the Sigma rule's level, mapped onto this project's incident severities, when unset.",
  })
  @ManyToOne(
    () => {
      return IncidentSeverity;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentSeverityId" })
  public incidentSeverity?: IncidentSeverity = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Incident Severity ID",
    description:
      "ID of the incident severity for incidents opened by this rule.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentSeverityId?: ObjectID = undefined;

  /*
   * Evaluator-owned state. Written only by the detection engine cron,
   * never by users.
   */
  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    title: "Last Evaluated At",
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    description:
      "When the detection engine last evaluated this rule. Null means it has never run.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastEvaluatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    title: "Last Match At",
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    description:
      "When this rule most recently matched security events. Null means it has never matched.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastMatchAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    title: "Last Error",
    required: false,
    /*
     * Unbounded text, not LongText's varchar(500): a ClickHouse error
     * echoes the whole compiled query back, which overflows 500 and made
     * the evaluator's own error-recording write throw — leaving this
     * column, and lastEvaluatedAt with it, null forever. The evaluator
     * still clamps what it stores.
     */
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: true,
    description:
      "The most recent evaluation error, if any. Cleared on the next successful evaluation.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public lastError?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who created this detection rule.",
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
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this detection rule.",
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
    description: "Relation to the user who deleted this detection rule.",
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
    description: "ID of the user who deleted this detection rule.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
