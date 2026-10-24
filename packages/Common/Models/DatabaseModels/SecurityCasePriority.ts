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
 * HOW URGENT A SECURITY CASE IS.
 *
 * Every case is at one of its project's case priorities
 * (SecurityCase.securityCasePriority). The list is ranked, most urgent
 * first, and the rank is what OneUptime compares: a playbook for cases "at
 * least High", a person told about cases from High up, a case rising when a
 * more severe detection joins it (Common/Utils/SecurityCase/
 * SecurityCasePriorities).
 *
 * A project starts with five - Critical, High, Medium, Low and
 * Informational - built in and flagged by the detection severity each
 * stands for: a Critical detection opens its case at the critical priority,
 * whatever the project calls it, OneUptime AI suggests one of the five, and
 * the high and critical priorities say which cases are urgent. They can be
 * renamed and recoloured, never deleted or archived, and keep their order.
 * A project adds its own anywhere among them ("Emergency" above Critical),
 * which people and playbooks set. Like every value records pick from, one
 * of the project's own can be archived: cases keep it, nobody picks it
 * again (Common/Utils/ArchivableValues). One that cases are at cannot be
 * deleted until they are moved.
 *
 * Read by everyone who can read cases (and, like every project's
 * severities, by its members); set up by the Security Admin tier.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityCasePriority,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.CreateSecurityCasePriority,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.EditSecurityCasePriority,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.DeleteSecurityCasePriority,
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
@CrudApiEndpoint(new Route("/security-case-priority"))
@SlugifyColumn("name", "slug")
@TableMetadata({
  tableName: "SecurityCasePriority",
  singularName: "Security Case Priority",
  pluralName: "Security Case Priorities",
  icon: IconProp.Signal,
  tableDescription:
    "How urgent a security case is, most urgent first (Critical, High, Medium, Low, Informational and your own). Add, rename, reorder or archive them.",
})
@Entity({
  name: "SecurityCasePriority",
})
@Index(["projectId", "order"])
export default class SecurityCasePriority extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this priority belongs to.",
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
    description: "ID of the project this priority belongs to.",
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
    description: "What the priority is called, like High or P1.",
    example: "Emergency",
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
    description: "Friendly globally unique name for the priority.",
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
    description: "How fast a case at this priority needs a person, in a sentence.",
    example: "A confirmed breach. Page the team now.",
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
    description: "The priority's colour, in hex (#32a852 for example).",
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
    title: "Is Critical Priority",
    description:
      "Is it the priority Critical detections open cases at? From it up, a case can't wait. A project has one; it can't be deleted or archived.",
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isCriticalPriority?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is High Priority",
    description:
      "Is it the priority High detections open cases at? From it up, a case counts as urgent. A project has one; it can't be deleted or archived.",
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isHighPriority?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Medium Priority",
    description:
      "Is it the priority Medium detections, and the cases people open, start at? A project has one; it can't be deleted or archived.",
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isMediumPriority?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Low Priority",
    description:
      "Is it the priority Low detections open cases at? A project has one, and it can't be deleted or archived.",
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isLowPriority?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Informational Priority",
    description:
      "Is it the priority Informational detections open cases at? A project has one, and it can't be deleted or archived.",
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isInformationalPriority?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.SmallNumber,
    canReadOnRelationQuery: true,
    title: "Order",
    required: false,
    description:
      "Where the priority ranks: 1 is the most urgent. The built-in priorities keep their order. A new priority without a number goes to the end.",
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
      "Archived priorities stay on the cases at them, but can't be picked again. The built-in priorities can't be archived.",
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
      "When this priority was archived. Empty while it is not archived.",
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
    description: "The person who archived this priority.",
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
    description: "ID of the person who archived this priority.",
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
    description: "The person who added this priority.",
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
    description: "ID of the person who added this priority.",
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
    description: "The person who deleted this priority.",
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
    description: "ID of the person who deleted this priority.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
