import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import CustomFieldMappingSourceResource from "../../Types/CustomField/CustomFieldMappingSourceResource";
import CustomFieldType from "../../Types/CustomField/CustomFieldType";
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
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A FIELD OF A PROJECT'S OWN ON ITS SECURITY CASES.
 *
 * What a team records about every case that OneUptime does not ask for -
 * a customer, a business unit, a regulator to notify, a ticket in another
 * tool, a breach or not - defined once under Security Events > Settings >
 * Custom Fields, and filled in on each case's Custom Fields page. The
 * values live in the case's own `customFields` bag, keyed by the field's
 * name (SecurityCase.customFields), as an incident's and an alert's do, so
 * the API, the queue's columns and every other kind of custom field read
 * them the same way.
 *
 * Read by everyone who reads cases; defined by the Security Admin tier, as
 * the project's other case settings are.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityCaseCustomField,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.CreateSecurityCaseCustomField,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.EditSecurityCaseCustomField,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.DeleteSecurityCaseCustomField,
];

@EnableDocumentation()
// A Growth feature, as every product's custom fields are.
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
@CrudApiEndpoint(new Route("/security-case-custom-field"))
@TableMetadata({
  tableName: "SecurityCaseCustomField",
  singularName: "Security Case Custom Field",
  pluralName: "Security Case Custom Fields",
  icon: IconProp.TableCells,
  tableDescription:
    "Fields a project adds to its security cases, filled in on each case.",
})
@Entity({
  name: "SecurityCaseCustomField",
})
export default class SecurityCaseCustomField extends BaseModel {
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
    description: "Relation to the project this custom field belongs to.",
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
    description: "ID of the project this custom field belongs to.",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "The field's name, as each case shows it and as its value is kept under in the case's customFields.",
    example: "Business Unit",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description:
      "What the field is for, shown under it when a case's fields are edited.",
    example: "The business unit whose systems the case is about.",
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
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.CustomFieldType,
    title: "Custom Field Type",
    description:
      "What the field holds: text, a number, yes or no, a date, a choice from a list, and the rest.",
    example: "Text",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public customFieldType?: CustomFieldType = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Dropdown Options",
    description:
      'Options and optional colors for dropdown fields, in the order they are listed. Plain one-per-line values remain supported. Records store an option as its text: changing an option here keeps the values records already hold. To rename an option and move those values with it, send the renames with the update, in miscDataProps: {"renamedDropdownOptions": [{"from": "Old text", "to": "New text"}]}. "to" must be one of the options.',
    example: "Finance\nEngineering\nOperations",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public dropdownOptions?: string = undefined;

  /*
   * Every custom field definition can copy its value from a related
   * resource's own field (CustomFieldMappingCatalog). A case has no related
   * resource that carries custom fields, so nothing is offered here today:
   * the columns are kept so every definition table has the same shape, and
   * the API refuses a mapping a case cannot have (CustomFieldMappingValidator).
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Map Value From",
    description:
      "Related resource this field copies its value from. Empty means values are entered by hand.",
    example: "Monitor",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public mapFromResourceType?: CustomFieldMappingSourceResource = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Map Value From Field",
    description:
      "Name of the custom field on the related resource this field copies its value from.",
    example: "Vendor",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public mapFromCustomFieldName?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description: "The person who added the field.",
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
    title: "Created by User ID",
    description: "ID of the person who added the field.",
    example: "a3f2b1c0-d9e8-4f5a-8b7c-6d5e4f3a2b1c",
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
    title: "Deleted by User",
    modelType: User,
    description: "The person who deleted the field.",
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

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description: "ID of the person who deleted the field.",
    example: "b5c4d3e2-f1a0-4b5c-9d8e-7f6a5b4c3d2e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
