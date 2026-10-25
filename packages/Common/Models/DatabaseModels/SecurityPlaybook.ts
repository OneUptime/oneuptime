import Project from "./Project";
import SecurityCasePriority from "./SecurityCasePriority";
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
import SecurityPlaybookTrigger from "../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A playbook is a security team's standard response, written down once and
 * run on every case it fits: assign it, look its entities up, tell the right
 * channel, page on-call, contain the account or the host. It runs when a
 * case opens or gains a detection (when the case matches its conditions), or
 * by hand from a case.
 *
 * Writing one is the Admin tier's: a playbook acts through the project's
 * connections - suspending accounts, cutting hosts off the network - with
 * nobody at the keyboard. The Member tier runs them on cases and approves
 * the steps marked for approval, which is where a person decides.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityPlaybook,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.CreateSecurityPlaybook,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.EditSecurityPlaybook,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.DeleteSecurityPlaybook,
];

const editableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
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
@CrudApiEndpoint(new Route("/security-playbook"))
@Entity({
  name: "SecurityPlaybook",
})
@TableMetadata({
  tableName: "SecurityPlaybook",
  singularName: "Security Playbook",
  pluralName: "Security Playbooks",
  icon: IconProp.Bolt,
  tableDescription:
    "Automated responses to security cases: steps that assign, investigate, notify, escalate and contain, run when a matching case opens or by hand.",
})
@Index(["projectId", "isEnabled", "trigger"])
export default class SecurityPlaybook extends BaseModel {
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
    description: "Relation to the project this playbook belongs to.",
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
    description: "ID of the project this playbook belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.Name,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "What the playbook does, in a few words.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public name?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Description",
    description: "When to use the playbook and what it is for.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Enabled",
    description:
      "Whether the playbook runs on its own. A disabled playbook can still be run by hand from a case.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Trigger",
    description:
      "When the playbook runs on its own: Case Opened, Detection Added (a new detection joins an open case), or Manual (only when somebody runs it).",
    defaultValue: SecurityPlaybookTrigger.CaseOpened,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityPlaybookTrigger.CaseOpened,
  })
  public trigger?: SecurityPlaybookTrigger = undefined;

  /*
   * Run only on cases at this priority or above, by the priority's place in
   * the project's ranked list (Common/Utils/SecurityCase/
   * SecurityCasePriorities). A priority a playbook names cannot be deleted
   * (the key refuses it, NO ACTION): the playbook would quietly start
   * running on every case.
   */
  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "minimumSecurityCasePriorityId",
    type: TableColumnType.Entity,
    modelType: SecurityCasePriority,
    title: "Minimum Priority",
    description:
      "Run only on cases at this priority or above. Empty runs on every priority.",
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
  @JoinColumn({ name: "minimumSecurityCasePriorityId" })
  public minimumSecurityCasePriority?: SecurityCasePriority = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "Minimum Priority ID",
    description:
      "ID of the lowest case priority the playbook runs on by itself. Empty runs on every priority.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public minimumSecurityCasePriorityId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Detection Source",
    description:
      "Run only on cases raised by this source: a Detection Rule, Threat Intel, a Connected Product or Entity Risk. Empty runs on every source.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public detectionSource?: SecurityDetectionSource = undefined;

  /*
   * Rule ids rather than a relation list: the rules are security records a
   * project member at large cannot read, and the playbook service holds
   * every id to the project when it is saved (getJsonReferenceColumns).
   */
  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Detection Rule IDs",
    description:
      "Run only on cases with a detection from one of these detection rules. Empty runs on cases from any rule.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public detectionRuleIds?: Array<string> = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Steps",
    description:
      "The steps the playbook takes, in order. Each has an action, its settings, and whether it needs approval, may fail without stopping the run, or runs only when threat intel matched.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public steps?: JSONArray = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    title: "Run Count",
    description: "How many times the playbook has been run.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public runCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Last Run At",
    description: "When the playbook last started a run.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastRunAt?: Date = undefined;

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
    description: "The person who created the playbook.",
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
    description: "ID of the person who created the playbook.",
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
    description: "The person who deleted the playbook.",
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
    description: "ID of the person who deleted the playbook.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
