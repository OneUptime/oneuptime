import Project from "./Project";
import SecurityCase from "./SecurityCase";
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
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import SecurityCaseStepCheckState from "../../Types/SecurityCase/SecurityCaseStepCheckState";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * What OneUptime found when it checked a step of a security case's Response
 * Plan itself (#10340): one row a step of a case, by the step's key - the
 * key a person's tick keeps too (SecurityCaseTask.responseStepKey).
 *
 * A tick is a promise; a check is what OneUptime sees: no request from the
 * address has reached the app since 10:42, the account is suspended in
 * Okta, every request was turned away. Its state says what that means -
 * Verified, Looks Done, Not Done, Cannot Tell, Regressed, Not Needed - and
 * its evidence says why, with links to the traces, the events or the
 * product (Types/SecurityCase/SecurityCaseStepCheckEvidence). The case's
 * card draws it beside the step, distinct from a person's tick.
 *
 * Written only by OneUptime's step checks
 * (Server/Utils/SecurityCase/StepChecks), each write compare-and-set, and
 * read like the case itself: whoever may read the case may read what
 * OneUptime found of it. Nobody edits a check: a person who disagrees ticks
 * the step themselves.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityCaseStepCheck,
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
@CrudApiEndpoint(new Route("/security-case-step-check"))
@OwnedThrough("securityCaseId", SecurityCase)
@Entity({
  name: "SecurityCaseStepCheck",
})
@TableMetadata({
  tableName: "SecurityCaseStepCheck",
  singularName: "Security Case Step Check",
  pluralName: "Security Case Step Checks",
  icon: IconProp.ShieldCheck,
  tableDescription:
    "What OneUptime found when it checked a step of a security case's Response Plan itself, and the evidence for it.",
  // A step OneUptime checks again shows on the case's Overview at once.
  enableRealtimeEventsOn: {
    create: true,
    update: true,
    delete: true,
  },
})
// One check a step of a case.
@Index(["securityCaseId", "stepKey"], { unique: true })
export default class SecurityCaseStepCheck extends BaseModel {
  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this check belongs to.",
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
    description: "ID of the project this check belongs to.",
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
    description: "The case whose step was checked.",
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
    description: "ID of the case whose step was checked.",
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
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Step Key",
    description:
      "The step of the case's Response Plan that was checked: what it is, and what it is about.",
    example: "contain:block-ip:203.0.113.7",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public stepKey?: string = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    allowedValues: Object.values(SecurityCaseStepCheckState),
    title: "State",
    description:
      "What OneUptime found: Verified, Looks Done (it fits, but OneUptime cannot prove who did it), Not Done, Cannot Tell (no data to check with), Regressed (it was done, and stopped holding) or Not Needed.",
    example: SecurityCaseStepCheckState.Verified,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public state?: SecurityCaseStepCheckState = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    title: "Evidence",
    description:
      "Why OneUptime says so: the sentence the step says, what else it saw, links to the traces, events or product, and the figures it worked from.",
  })
  @Column({
    nullable: false,
    type: ColumnType.JSON,
  })
  public evidence?: JSONObject = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Checked At",
    description: "When OneUptime last checked the step.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public checkedAt?: Date = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "State Since",
    description: "Since when the step has been in its state.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public stateSince?: Date = undefined;

  /*
   * When OneUptime next checks the step: soon while it is in flux, less
   * often once it has held for a while. Empty for a step it no longer
   * checks - the case closed, or the step left the plan.
   */
  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    title: "Next Check At",
    description:
      "When OneUptime next checks the step. Empty when it no longer checks it: the case is closed, or the step left the plan.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public nextCheckAt?: Date = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Unused: OneUptime writes every check.",
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
    description: "Unused: OneUptime writes every check.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
