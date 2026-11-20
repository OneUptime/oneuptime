import DataSecurityIssue from "./DataSecurityIssue";
import DataStore from "./DataStore";
import Project from "./Project";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
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
import { DataSecurityAiIssueSkipReason } from "../../Types/DataSecurity/DataSecurityAiDecision";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * WHY ONEUPTIME AI DID, OR DID NOT, ACT ON A DATA SECURITY ISSUE (#10364):
 * one record each time the engine evaluated the issue
 * (DataSecurityAiEngine), with one entry per kind of work - what it did,
 * or why it did nothing (Types/DataSecurity/DataSecurityAiDecision).
 * Data Security > AI lists the issues it did nothing for under "Why AI did
 * not act"; the records it acted in are its day's ledger, which the daily
 * limits per store and per project count.
 *
 * As an incident's AutoRemediationDecision, but a table of its own: that
 * one is read by every Project Member, and a Data Security issue only by
 * the people who read the issue (DataSecurityIssue's list), which these
 * share. Written by OneUptime alone, once, and never changed. Reason codes
 * and names only - never a value, a sample or a record.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataSecurityAiDecision,
];

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
@CanAccessIfCanReadOn("dataSecurityIssue")
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/data-security-ai-decision"))
@Entity({
  name: "DataSecurityAiDecision",
})
@TableMetadata({
  tableName: "DataSecurityAiDecision",
  singularName: "Data Security AI Decision",
  pluralName: "Data Security AI Decisions",
  icon: IconProp.Sparkles,
  tableDescription:
    "Why OneUptime AI did, or did not, act on a Data Security issue: one record each time it evaluated the issue, with what each kind of work did or why it did nothing - no rule matched, the work is off, no credits, the daily limit, nothing it may do, a proof that failed. Written by OneUptime.",
})
@TableAccessControl({
  create: [],
  read: readPermissions,
  update: [],
  delete: [],
})
@Index(["projectId", "didAct", "createdAt"])
@Index(["dataStoreId", "didAct", "createdAt"])
export default class DataSecurityAiDecision extends BaseModel {
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this decision belongs to.",
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this decision belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "dataSecurityIssueId",
    type: TableColumnType.Entity,
    modelType: DataSecurityIssue,
    title: "Data Security Issue",
    description: "Relation to the issue OneUptime AI evaluated.",
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Data Security Issue ID",
    description: "The issue OneUptime AI evaluated.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataSecurityIssueId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "dataStoreId",
    type: TableColumnType.Entity,
    modelType: DataStore,
    title: "Data Store",
    description: "Relation to the store the issue is on.",
  })
  @ManyToOne(
    () => {
      return DataStore;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "dataStoreId" })
  public dataStore?: DataStore = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Data Store ID",
    description: "The store the issue is on.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataStoreId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Did Act",
    description:
      "Whether OneUptime AI did anything for the issue in this evaluation: analyzed it, proposed a change, or made one without asking.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public didAct?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataSecurityAiIssueSkipReason),
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Why Nothing Was Done",
    description:
      "When OneUptime AI did nothing: RulesUnreadable, NoRuleMatched, StoreDailyLimitReached, ProjectDailyLimitReached, NothingToDo (each kind of work says why in the entries) or EvaluationFailed.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public skipReason?: DataSecurityAiIssueSkipReason = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Entries",
    description:
      "One entry per kind of work - Analyze, Contain, Fix, Judge - with a reason code saying what it did or why it did nothing, and the rule or proposal it was about.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public entries?: JSONArray = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    title: "Times The Issue Had Reopened",
    description:
      "How many times the issue had opened again when it was evaluated: OneUptime AI analyzes an issue once each time it opens.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public issueReopenCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    title: "Analyzed",
    description: "Whether OneUptime AI analyzed the issue in this evaluation.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public didAnalyze?: boolean = undefined;
}
