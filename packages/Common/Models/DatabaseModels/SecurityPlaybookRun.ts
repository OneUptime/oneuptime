import Project from "./Project";
import SecurityCase from "./SecurityCase";
import SecurityPlaybook from "./SecurityPlaybook";
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
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import SecurityPlaybookRunStatus from "../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import SecurityPlaybookTrigger from "../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One run of a playbook on one case, and the record of it: the steps as they
 * were when it started (a playbook edited mid-run changes nothing already
 * under way), what each step did, and who approved the steps that asked.
 *
 * Starting a run is creating one - name the case and the playbook, and
 * OneUptime copies the steps and queues it - which the Member tier may do.
 * Cancelling one is setting its status to Cancelled; approving or rejecting
 * a step waiting for approval goes through the run's approve and reject
 * routes. Everything else on a run is written by the engine.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityPlaybookRun,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.CreateSecurityPlaybookRun,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditSecurityPlaybookRun,
];

const engineColumnAccess: {
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
  create: createPermissions,
  read: readPermissions,
  delete: [],
  update: updatePermissions,
})
@CrudApiEndpoint(new Route("/security-playbook-run"))
@OwnedThrough("securityCaseId", SecurityCase)
@Entity({
  name: "SecurityPlaybookRun",
})
@TableMetadata({
  tableName: "SecurityPlaybookRun",
  singularName: "Security Playbook Run",
  pluralName: "Security Playbook Runs",
  icon: IconProp.Play,
  tableDescription:
    "One run of a security playbook on a case: the steps it took, what each did, and who approved the steps that asked.",
  enableRealtimeEventsOn: {
    create: true,
    update: true,
    delete: false,
  },
})
@Index(["securityCaseId", "createdAt"])
@Index(["status"])
export default class SecurityPlaybookRun extends BaseModel {
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
    description: "Relation to the project this run belongs to.",
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
    description: "ID of the project this run belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "securityCaseId",
    type: TableColumnType.Entity,
    modelType: SecurityCase,
    title: "Security Case",
    description: "The case the playbook runs on.",
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
    title: "Security Case ID",
    description: "ID of the case the playbook runs on.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityCaseId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "securityPlaybookId",
    type: TableColumnType.Entity,
    modelType: SecurityPlaybook,
    title: "Security Playbook",
    description: "The playbook being run.",
  })
  @ManyToOne(
    () => {
      return SecurityPlaybook;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityPlaybookId" })
  public securityPlaybook?: SecurityPlaybook = undefined;

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
    title: "Security Playbook ID",
    description: "ID of the playbook being run.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityPlaybookId?: ObjectID = undefined;

  @ColumnAccessControl(engineColumnAccess)
  @TableColumn({
    type: TableColumnType.Name,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Playbook Name",
    description:
      "The playbook's name when the run started, kept if the playbook is renamed or deleted.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public playbookName?: string = undefined;

  @ColumnAccessControl(engineColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Trigger",
    description:
      "What started the run: Case Opened, Detection Added, or Manual for a person.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public trigger?: SecurityPlaybookTrigger = undefined;

  @ColumnAccessControl(engineColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "triggeredByUserId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: User,
    title: "Triggered By User",
    description: "The person who ran the playbook, for a run started by hand.",
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
  @JoinColumn({ name: "triggeredByUserId" })
  public triggeredByUser?: User = undefined;

  @ColumnAccessControl(engineColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Triggered By User ID",
    description: "ID of the person who ran the playbook.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Status",
    description:
      "Queued, Running, Waiting for Approval, Succeeded, Failed or Cancelled. Set it to Cancelled to stop a run that has not finished.",
    defaultValue: SecurityPlaybookRunStatus.Queued,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityPlaybookRunStatus.Queued,
  })
  public status?: SecurityPlaybookRunStatus = undefined;

  @ColumnAccessControl(engineColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    computed: true,
    title: "Steps",
    description: "The playbook's steps as they were when the run started.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public steps?: JSONArray = undefined;

  @ColumnAccessControl(engineColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    computed: true,
    title: "Step Results",
    description:
      "What each step did: its status, when it started and finished, what it reported, and who decided on its approval.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public stepResults?: JSONArray = undefined;

  @ColumnAccessControl(engineColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    title: "Current Step Index",
    description: "The step the run is on, counting from 0.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public currentStepIndex?: number = undefined;

  @ColumnAccessControl(engineColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    computed: true,
    title: "Threat Intel Matched",
    description:
      "Whether a Check Threat Intel step of this run found a known-bad entity. Steps set to run only on a match read it.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public threatIntelMatched?: boolean = undefined;

  @ColumnAccessControl(engineColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Started At",
    description: "When the run started its first step.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public startedAt?: Date = undefined;

  @ColumnAccessControl(engineColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Completed At",
    description: "When the run finished, failed or was cancelled.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public completedAt?: Date = undefined;

  @ColumnAccessControl(engineColumnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    computed: true,
    title: "Error Message",
    description: "Why the run failed, when it did.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public errorMessage?: string = undefined;

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
    description: "The person who started the run.",
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
    description: "ID of the person who started the run.",
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
    description: "Unused: runs are not deleted.",
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
    description: "Unused: runs are not deleted.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
