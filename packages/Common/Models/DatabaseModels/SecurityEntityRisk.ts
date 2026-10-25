import Project from "./Project";
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
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { SecurityEntityType } from "../../Types/SecurityCase/SecurityEntity";
import { SecurityEntityCriticality } from "../../Types/SecurityCase/SecurityEntityRisk";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One user, host or address and what everything found about it adds up to:
 * its risk score over the last week, and each detection rule, threat intel
 * feed and connected product's rule that added to it
 * (Types/SecurityCase/SecurityEntityRisk says how it counts).
 *
 * Written by OneUptime alone (SecurityEntityRiskRecorder) as findings
 * arrive, and refreshed as sources stop counting: nobody creates or edits a
 * row. It is security data like the detections it comes from, so the
 * Security tiers read it and nobody else; who may delete security data may
 * reset an entity's risk by deleting its row - the findings that come next
 * start it again.
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

// Every column is OneUptime's to write; the Security tiers read them.
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
/*
 * A reset is a person's decision and is kept; the score's every move is
 * OneUptime's own arithmetic, and would bury the log.
 */
@EnableAuditLog({ create: false, update: false, delete: true })
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/security-entity-risk"))
@Entity({
  name: "SecurityEntityRisk",
})
@TableMetadata({
  tableName: "SecurityEntityRisk",
  singularName: "Entity Risk",
  pluralName: "Entity Risks",
  icon: IconProp.Fingerprint,
  tableDescription:
    "The risk of each user, host and IP address: what the detection rules, threat intel and connected products found about it in the last 7 days adds up to.",
})
@TableAccessControl({
  create: [],
  read: readPermissions,
  update: [],
  delete: deletePermissions,
})
@Index(["projectId", "entityKey"], { unique: true })
@Index(["projectId", "riskScore"])
export default class SecurityEntityRisk extends BaseModel {
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this entity's risk belongs to.",
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
    description: "ID of the project this entity's risk belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Type",
    description: "What the entity is: a User, a Host or an IP Address.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public entityType?: SecurityEntityType = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Entity",
    description:
      "The user's sign-in name, the host's name or the address, as the first finding about it named it.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public entityValue?: string = undefined;

  /*
   * The value trimmed and case folded - hashed past 200 characters - as a
   * case's grouping key folds it: one row per entity, however its findings
   * spell it.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Entity Key",
    description:
      "The entity's value, trimmed and in lower case: one entity's risk, whatever case its findings write it in.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public entityKey?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Risk Score",
    description:
      "What its sources of the last 7 days add up to, weighted by how much it matters. A case opens at the project's threshold.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public riskScore?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Criticality",
    description:
      "How much it matters, from the project's Entity Criticality list: Low (x0.5), High (x1.5) or Extreme (x2). Empty counts as it is.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public criticality?: SecurityEntityCriticality = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Sources",
    description:
      "How many different detection rules, threat intel feeds and connected products' rules add to its risk.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public contributorCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Contributions",
    description:
      "What adds to its risk: each source with its severity, its points, how often it fired and when.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public contributions?: JSONArray = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "MITRE ATT&CK Tactics",
    description: "ATT&CK tactic ids (TA0006) its sources are tagged with.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public mitreTactics?: Array<string> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "MITRE ATT&CK Techniques",
    description: "ATT&CK technique ids (T1110) its sources are tagged with.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public mitreTechniques?: Array<string> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "First Risk At",
    description: "When the sources that count now began counting.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public firstRiskAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Last Risk At",
    description: "When a finding last added to its risk.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastRiskAt?: Date = undefined;

  /*
   * When the score next falls: the moment the first of its sources has said
   * nothing for a week. The hourly refresh reads the rows whose moment has
   * come, and no other.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    title: "Risk Expires At",
    description:
      "When its score next falls, as the first of its sources stops counting.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public riskExpiresAt?: Date = undefined;

  /*
   * When its risk last opened a case, or joined the open one about it: what
   * was behind that case is not counted again for the next
   * (getRiskSinceLastCase).
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Risk Case At",
    description:
      "When its risk last reached the threshold and opened a case, or joined the open case about it.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public riskCaseAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Risk History",
    description: "Its risk score at the end of each of the last 30 days.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public riskHistory?: JSONArray = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "The person who reset this entity's risk.",
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the person who reset this entity's risk.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
