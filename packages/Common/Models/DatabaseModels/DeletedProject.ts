import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import User from "./User";
import Route from "../../Types/API/Route";
import SubscriptionStatus from "../../Types/Billing/SubscriptionStatus";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import Email from "../../Types/Email";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Phone from "../../Types/Phone";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Snapshot of a project taken at the moment it was deleted, kept so the team
 * can follow up with the customer and understand why they left.
 *
 * Projects are hard-deleted (DatabaseService._deleteBy), so nothing about them
 * survives the delete - this table is the only record that the project ever
 * existed. That is also why the project columns below are a denormalised copy
 * rather than a foreign key, and why the user columns keep the name, email and
 * company alongside the (nullable) relation: the row has to stay readable
 * after the user is gone too.
 *
 * Written by ProjectService's delete hooks on SaaS only (IsBillingEnabled).
 * Master-admin only - empty access control arrays deny every project user, and
 * root/master admin short-circuit the permission checks before they run.
 */
@TableAccessControl({
  create: [],
  read: [],
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/deleted-project"))
@TableMetadata({
  tableName: "DeletedProject",
  singularName: "Deleted Project",
  pluralName: "Deleted Projects",
  icon: IconProp.Trash,
  tableDescription:
    "Record of projects that have been deleted, with the reason the customer gave, kept for customer outreach.",
})
@Entity({
  name: "DeletedProject",
})
export default class DeletedProject extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index("idx_deleted_project_project_id")
  @TableColumn({
    required: true,
    type: TableColumnType.ObjectID,
    title: "Project ID",
    description:
      "ID of the project that was deleted. Not a relation - the project row no longer exists.",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    nullable: false,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Project Name",
    description: "Name the deleted project had.",
    example: "My Awesome Project",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public projectName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Slug,
    title: "Project Slug",
    description: "Slug the deleted project had.",
    example: "my-awesome-project",
  })
  @Column({
    nullable: true,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
  })
  public projectSlug?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Project Created At",
    description:
      "When the deleted project was created. Together with Deleted At this gives the lifetime of the account.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public projectCreatedAt?: Date | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index("idx_deleted_project_project_deleted_at")
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Project Deleted At",
    description: "When the project was deleted.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public projectDeletedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Deletion Reason",
    description:
      "Why the customer said they were deleting the project, as typed into the delete confirmation. Empty when the delete did not come from the dashboard or the customer skipped the question.",
    example: "We consolidated onto a single project.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public deletionReason?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectDeletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Project Deleted by User",
    description:
      "Relation to the User who deleted the project (if a User deleted it).",
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
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
  @JoinColumn({ name: "projectDeletedByUserId" })
  public projectDeletedByUser?: User | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Project Deleted by User ID",
    description:
      "ID of the User who deleted the project (if a User deleted it).",
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  })
  @Column({
    nullable: true,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectDeletedByUserId?: ObjectID | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Name,
    title: "Project Deleted by User Name",
    description:
      "Name of the User who deleted the project, copied so it survives that user being deleted.",
    example: "Jane Doe",
  })
  @Column({
    nullable: true,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public projectDeletedByUserName?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Email,
    title: "Project Deleted by User Email",
    description:
      "Email of the User who deleted the project. This is the address to reach out on.",
    example: "jane@example.com",
  })
  @Column({
    nullable: true,
    type: ColumnType.Email,
    length: ColumnLength.Email,
    transformer: Email.getDatabaseTransformer(),
  })
  public projectDeletedByUserEmail?: Email | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectCreatedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Project Created by User",
    description:
      "Relation to the User who created the project (if a User created it).",
    example: "c3d4e5f6-a7b8-9012-cdef-123456789012",
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
  @JoinColumn({ name: "projectCreatedByUserId" })
  public projectCreatedByUser?: User | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Project Created by User ID",
    description:
      "ID of the User who created the project (if a User created it).",
    example: "c3d4e5f6-a7b8-9012-cdef-123456789012",
  })
  @Column({
    nullable: true,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectCreatedByUserId?: ObjectID | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Name,
    title: "Project Created by User Name",
    description:
      "Name of the User who created the project, copied so it survives that user being deleted.",
    example: "John Doe",
  })
  @Column({
    nullable: true,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public projectCreatedByUserName?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Email,
    title: "Project Created by User Email",
    description: "Email of the User who created the project.",
    example: "john@example.com",
  })
  @Column({
    nullable: true,
    type: ColumnType.Email,
    length: ColumnLength.Email,
    transformer: Email.getDatabaseTransformer(),
  })
  public projectCreatedByUserEmail?: Email | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Company Name",
    description:
      "Company the project belonged to, taken from the user who created the project and falling back to the user who deleted it.",
    example: "Acme Inc.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public companyName?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Phone,
    title: "Company Phone Number",
    description: "Phone number on file for the company, for outreach.",
    example: "+1-555-555-5555",
  })
  @Column({
    nullable: true,
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    transformer: Phone.getDatabaseTransformer(),
  })
  public companyPhoneNumber?: Phone | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Company Size",
    description: "Company size the customer selected when they signed up.",
    example: "11-50 People",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public companySize?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Job Role",
    description: "Job role the customer selected when they signed up.",
    example: "Engineering Manager",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public jobRole?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Plan Name",
    description: "Plan the project was on when it was deleted.",
    example: "Growth",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public planName?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Payment Provider Plan ID",
    description: "Billing plan ID the project was subscribed to.",
    example: "price_1234567890",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public paymentProviderPlanId?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Payment Provider Customer ID",
    description:
      "Billing customer ID of the project, so the account can be looked up in the payment provider.",
    example: "cus_1234567890",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public paymentProviderCustomerId?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Payment Provider Subscription ID",
    description: "Billing subscription ID of the project.",
    example: "sub_1234567890",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public paymentProviderSubscriptionId?: string | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Payment Provider Subscription Status",
    description:
      "Status the billing subscription was in when the project was deleted.",
    example: "active",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public paymentProviderSubscriptionStatus?: SubscriptionStatus | undefined =
    undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Payment Provider Subscription Seats",
    description:
      "Number of seats the project was billed for when it was deleted.",
    example: "5",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public paymentProviderSubscriptionSeats?: number | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Trial Ends At",
    description: "When the project's trial ended, or was going to end.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public trialEndsAt?: Date | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Active Monitor Count",
    description:
      "Number of active monitors the project had when it was deleted - a rough measure of how much the customer had invested in it.",
    example: "12",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public activeMonitorCount?: number | undefined = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Was Project Blocked",
    description:
      "Whether the project was blocked when it was deleted. Blocked projects are deleted for very different reasons than active ones.",
    example: "false",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public wasProjectBlocked?: boolean | undefined = undefined;
}
