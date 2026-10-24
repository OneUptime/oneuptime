import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import Color from "../../Types/Color";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColorField from "../../Types/Database/ColorField";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import ListOrderColumn from "../../Types/Database/ListOrderColumn";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * WHERE A SECURITY CASE STANDS.
 *
 * Every case is in one of its project's case statuses
 * (SecurityCase.securityCaseStatus). A project starts with the four every
 * case has always gone through - New, Investigating, Contained and Closed -
 * and adds its own: "Triage", "Eradicating", "Closed - Duplicate".
 *
 * The four are built in, flagged by what they mean, because OneUptime reads
 * those meanings and moves cases into them by itself
 * (Common/Utils/SecurityCase/SecurityCaseStatuses):
 *
 *   - every new case starts in the new status;
 *   - from the acknowledged status down, a case counts as taken on; a
 *     reopened case moves to it;
 *   - from the contained status down, as contained, which the time to
 *     contain is measured to;
 *   - from the closed status down, as closed: Close Case moves a case there
 *     with a verdict, and it leaves the open lists.
 *
 * They can be renamed and recoloured, never deleted or archived, and keep
 * their order; a project's own go anywhere between them, and a new one just
 * above the closed status (Common/Utils/StateOrder). Like every value
 * records pick from, a status of the project's own can be archived: cases
 * keep it, nobody picks it again (Common/Utils/ArchivableValues). One that
 * cases are in cannot be deleted until they are moved.
 *
 * Read by everyone who can read cases (and, like every project's states,
 * by its members); set up by the Security Admin tier.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityCaseStatus,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.CreateSecurityCaseStatus,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.EditSecurityCaseStatus,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.DeleteSecurityCaseStatus,
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

const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: [],
};

// Columns only OneUptime writes.
const serverWrittenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@EnableDocumentation()
@EnableMCP()
@TenantColumn("projectId")
@ListOrderColumn({ column: "order", scopeColumns: ["projectId"] })
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@EnableAuditLog()
@CrudApiEndpoint(new Route("/security-case-status"))
@SlugifyColumn("name", "slug")
@TableMetadata({
  tableName: "SecurityCaseStatus",
  singularName: "Security Case Status",
  pluralName: "Security Case Statuses",
  icon: IconProp.ArrowCircleRight,
  tableDescription:
    "The statuses a security case moves through (New, Investigating, Contained, Closed and your own). Add, rename, reorder or archive them.",
})
@Entity({
  name: "SecurityCaseStatus",
})
@Index(["projectId", "order"])
export default class SecurityCaseStatus extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this status belongs to.",
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
    description: "ID of the project this status belongs to.",
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
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "What the status is called, like Investigating or Triage.",
    example: "Triage",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    computed: true,
    title: "Slug",
    description: "Friendly globally unique name for the status.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
  })
  public slug?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "What a case in this status is waiting for, in a sentence.",
    example: "Someone is checking whether the detection is real.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @ColorField()
  @TableColumn({
    title: "Color",
    required: true,
    unique: false,
    type: TableColumnType.Color,
    canReadOnRelationQuery: true,
    description: "The status's colour, in hex (#32a852 for example).",
  })
  @Column({
    type: ColumnType.Color,
    length: ColumnLength.Color,
    unique: false,
    nullable: false,
    transformer: Color.getDatabaseTransformer(),
  })
  public color?: Color = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is New Status",
    description:
      "Is it the status every new case starts in? A project has one, and it can't be deleted or archived.",
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isNewStatus?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Acknowledged Status",
    description:
      "Is it the status a reopened case moves to? From it down, a case counts as taken on. A project has one, and it can't be deleted or archived.",
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isAcknowledgedStatus?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Contained Status",
    description:
      "Is it the status the time to contain is measured to? From it down, a case counts as contained. A project has one.",
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isContainedStatus?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Closed Status",
    description:
      "Is it the status Close Case moves a case to? From it down, a case counts as closed and carries a verdict. A project has one.",
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isClosedStatus?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.SmallNumber,
    canReadOnRelationQuery: true,
    title: "Order",
    required: false,
    description:
      "Where the status sits in the list: 1 is the top. A new, acknowledged, contained and closed status keep that order. A new status without a number goes just above the closed status.",
  })
  @Column({
    type: ColumnType.SmallNumber,
  })
  public order?: number = undefined;

  /*
   * Archiving retires a value without touching a record that has it: it
   * stays on them, and nobody can pick it again (Common/Utils/ArchivableValues;
   * the server refuses it in ArchivedValueCheck). No permission of its own:
   * archiving is an update, so it is gated by Edit.
   */
  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Archived",
    description:
      "Archived statuses stay on the cases in them, but can't be picked again. The built-in statuses can't be archived.",
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isArchived?: boolean = undefined;

  /*
   * Stamped server-side from the `isArchived` write (see
   * DatabaseService.stampSwitchAttribution), which is why these are read-only
   * to the client: "who archived this and when" cannot be spoofed.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Archived At",
    description:
      "When this status was archived. Empty while it is not archived.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public archivedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "archivedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Archived by User",
    description: "The person who archived this status.",
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
  @JoinColumn({ name: "archivedByUserId" })
  public archivedByUser?: User = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Archived by User ID",
    description: "ID of the person who archived this status.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public archivedByUserId?: ObjectID = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description: "The person who added this status.",
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
    description: "ID of the person who added this status.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description: "The person who deleted this status.",
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description: "ID of the person who deleted this status.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
