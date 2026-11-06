import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import EnableMCP from "../../Types/Database/EnableMCP";
import DataAsset from "./DataAsset";
import DataCheck from "./DataCheck";
import Monitor from "./Monitor";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import { getDecimalDatabaseTransformer } from "../../Types/Database/DecimalColumnTransformer";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import {
  DataReconciliationMeasure,
  DataReconciliationStatus,
  DataReconciliationToleranceType,
} from "../../Types/DataObservability/DataReconciliation";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A RECONCILIATION: TWO COPIES OF THE SAME DATA, KEPT HONEST.
 *
 * One measure of two tables - their rows, a column's sum or distinct
 * values, or a query's number - in the same database or two different ones,
 * with how far apart they may be: an absolute amount, or a percentage of
 * the source's value (DataReconciliation). Each side is read by a data
 * check of its own (sourceDataCheckId, targetDataCheckId), made and kept by
 * the reconciliation (DataReconciliationSync), with its store's collection;
 * the two values are compared once read together, and written as
 * oneuptime.data.reconciliation.drifted, which its monitor alerts on.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadDataAsset,
];

// A reconciliation checks two tables: whoever may edit a table may make one.
const writePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.EditDataAsset,
];

const editableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: writePermissions,
  read: readPermissions,
  update: writePermissions,
};

// Set once, when the reconciliation is made.
const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: writePermissions,
  read: readPermissions,
  update: [],
};

// OneUptime writes these; people read them.
const serverWrittenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

const hiddenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: [],
  update: [],
};

@EnableMCP()
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: writePermissions,
  read: readPermissions,
  update: writePermissions,
  delete: writePermissions,
})
@CrudApiEndpoint(new Route("/data-reconciliation"))
@Entity({
  name: "DataReconciliation",
})
@TableMetadata({
  tableName: "DataReconciliation",
  singularName: "Data Reconciliation",
  pluralName: "Data Reconciliations",
  icon: IconProp.Scale,
  tableDescription:
    "One measure of two tables - rows, a sum, distinct values, a query's number - compared, in one database or two, with a tolerance, and an alert when they drift.",
})
@Index(["projectId", "name"], { unique: true })
export default class DataReconciliation extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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

  @ColumnAccessControl(createOnlyColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Name",
    description: "What the reconciliation is called, as its alert names it.",
    example: "Orders: app vs warehouse",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public name?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Description",
    description: "Why the two must agree, and what to do when they do not.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public description?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Interval (Minutes)",
    description:
      "How often both sides are read and compared: every 15 minutes, hour, 6 hours or day.",
    example: 60,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public intervalInMinutes?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataReconciliationToleranceType),
    required: true,
    title: "Tolerance Type",
    description:
      "How the tolerance is read: Absolute, an amount, or Percent, of the source's value.",
    example: "Percent",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public toleranceType?: DataReconciliationToleranceType = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    title: "Tolerance",
    description:
      "How far apart the two may be before they have drifted: 0 means they must agree exactly.",
    example: 0.5,
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: false,
    transformer: getDecimalDatabaseTransformer(),
  })
  public tolerance?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "sourceDataAssetId",
    type: TableColumnType.Entity,
    modelType: DataAsset,
    title: "Source Table",
    description: "The source table the reconciliation reads.",
  })
  @ManyToOne(
    () => {
      return DataAsset;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "sourceDataAssetId" })
  public sourceDataAsset?: DataAsset = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Source Table ID",
    description: "ID of the source table the reconciliation reads.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public sourceDataAssetId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataReconciliationMeasure),
    required: true,
    title: "Source Measure",
    description:
      "What is measured of the source table: Row Count, Sum, Distinct Count, or Custom SQL.",
    example: "Row Count",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public sourceMeasure?: DataReconciliationMeasure = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Source Column",
    description: "For Sum or Distinct Count: the column of the source table.",
    example: "amount",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public sourceColumnName?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Source Custom SQL",
    description:
      "For Custom SQL: a read-only query of the source's database returning one number, as value.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public sourceCustomSql?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "sourceDataCheckId",
    type: TableColumnType.Entity,
    modelType: DataCheck,
    title: "Source Check",
    description:
      "The data check that reads the source, made and kept by the reconciliation.",
  })
  @ManyToOne(
    () => {
      return DataCheck;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "sourceDataCheckId" })
  public sourceDataCheck?: DataCheck = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Source Check ID",
    description:
      "ID of the data check that reads the source, made and kept by the reconciliation.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public sourceDataCheckId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    computed: true,
    title: "Source Value",
    description: "The source's value at the latest comparison.",
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: getDecimalDatabaseTransformer(),
  })
  public sourceValue?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "targetDataAssetId",
    type: TableColumnType.Entity,
    modelType: DataAsset,
    title: "Target Table",
    description: "The target table the reconciliation reads.",
  })
  @ManyToOne(
    () => {
      return DataAsset;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "targetDataAssetId" })
  public targetDataAsset?: DataAsset = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Target Table ID",
    description: "ID of the target table the reconciliation reads.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public targetDataAssetId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataReconciliationMeasure),
    required: true,
    title: "Target Measure",
    description:
      "What is measured of the target table: Row Count, Sum, Distinct Count, or Custom SQL.",
    example: "Row Count",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public targetMeasure?: DataReconciliationMeasure = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Target Column",
    description: "For Sum or Distinct Count: the column of the target table.",
    example: "amount",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public targetColumnName?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Target Custom SQL",
    description:
      "For Custom SQL: a read-only query of the target's database returning one number, as value.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public targetCustomSql?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "targetDataCheckId",
    type: TableColumnType.Entity,
    modelType: DataCheck,
    title: "Target Check",
    description:
      "The data check that reads the target, made and kept by the reconciliation.",
  })
  @ManyToOne(
    () => {
      return DataCheck;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "targetDataCheckId" })
  public targetDataCheck?: DataCheck = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Target Check ID",
    description:
      "ID of the data check that reads the target, made and kept by the reconciliation.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public targetDataCheckId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    computed: true,
    title: "Target Value",
    description: "The target's value at the latest comparison.",
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: getDecimalDatabaseTransformer(),
  })
  public targetValue?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    computed: true,
    title: "Difference",
    description:
      "The target's value less the source's, at the latest comparison.",
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: getDecimalDatabaseTransformer(),
  })
  public difference?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    computed: true,
    title: "Difference (%)",
    description:
      "The difference as a percentage of the source's value, at the latest comparison.",
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: getDecimalDatabaseTransformer(),
  })
  public differencePercent?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataReconciliationStatus),
    required: false,
    computed: true,
    title: "Status",
    description:
      "In Step, Drifted, Waiting for both sides to be read together, or Failed when a side's check could not run.",
    example: "In Step",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public status?: DataReconciliationStatus = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    computed: true,
    title: "Status Message",
    description: "Why the reconciliation is waiting or failed.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public statusMessage?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    title: "Compared At",
    description: "When the later of the two compared values was read.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public comparedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    title: "Status Changed At",
    description: "When the status last changed.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public statusChangedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "monitorId",
    type: TableColumnType.Entity,
    modelType: Monitor,
    title: "Monitor",
    description: "The Metrics monitor that alerts when the two drift.",
  })
  @ManyToOne(
    () => {
      return Monitor;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "monitorId" })
  public monitor?: Monitor = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Monitor ID",
    description: "ID of the Metrics monitor that alerts when the two drift.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public monitorId?: ObjectID = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
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

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl(hiddenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl(hiddenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
