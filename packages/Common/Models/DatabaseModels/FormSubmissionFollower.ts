import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Form from "./Form";
import FormSubmission from "./FormSubmission";
import Project from "./Project";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import Email from "../../Types/Email";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Somebody following a form submission (Common/Types/Form/FormFollowUp):
 * the person who sent it, or anybody they or the team added, by email. Each
 * reads the request and its conversation on the form's own page, writes to
 * the team there, and is emailed when anybody else writes.
 *
 * Nobody reads or writes these through the API - the table's lists are
 * empty. The form's public follow-up routes read them as root, for the one
 * request a link or a signed-in visitor names; the dashboard reads them
 * through FormFollowUpRecordAPI, for somebody who may read the record the
 * submission created, which is where everything about the submission is
 * read (FormSubmission explains why). A row holds a stranger's address and
 * the secret of their link.
 *
 * Deleting the submission, or its form, deletes the people following it.
 */
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@CanAccessIfCanReadOn("form")
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@OwnedThrough("formId", Form)
@Index(["formSubmissionId", "email"], { unique: true })
@Entity({
  name: "FormSubmissionFollower",
})
@TableMetadata({
  tableName: "FormSubmissionFollower",
  singularName: "Form Submission Follower",
  pluralName: "Form Submission Followers",
  icon: IconProp.User,
  tableDescription:
    "The people following a form submission: the person who sent it and anybody added since, each with the private link they open it with.",
})
export default class FormSubmissionFollower extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
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

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "formId",
    type: TableColumnType.Entity,
    modelType: Form,
    title: "Form",
    description: "The form the submission was made through.",
  })
  @ManyToOne(
    () => {
      return Form;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "formId" })
  public form?: Form = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Form ID",
    description: "ID of the form the submission was made through.",
    example: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public formId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "formSubmissionId",
    type: TableColumnType.Entity,
    modelType: FormSubmission,
    title: "Form Submission",
    description: "The submission this person is following.",
  })
  @ManyToOne(
    () => {
      return FormSubmission;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "formSubmissionId" })
  public formSubmission?: FormSubmission = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Form Submission ID",
    description: "ID of the submission this person is following.",
    example: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public formSubmissionId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Email,
    title: "Email",
    description:
      "The address this person is emailed at, and on a form that asks its visitors to sign in, the address they sign in with to open the request.",
    example: "jane.doe@example.com",
  })
  @Column({
    nullable: false,
    type: ColumnType.Email,
    length: ColumnLength.Email,
    transformer: Email.getDatabaseTransformer(),
  })
  public email?: Email = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Name",
    description:
      "The name this person is shown by, as the submitter gave theirs or whoever added them typed it. Empty when nobody gave one.",
    example: "Jane Doe",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Submitter",
    description: "Whether this person sent the form, rather than being added.",
    defaultValue: false,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isSubmitter?: boolean = undefined;

  /*
   * The secret in this person's link (?followUp=<id>-<token>, see
   * Common/Types/Form/FormFollowUp): 32 random bytes as hex, minted by
   * FormFollowUpToken when the row is created. Kept, encrypted, rather than
   * hashed: every email about the request carries the link again. It only
   * ever leaves the server inside a link sent to this person's own address.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    secret: true,
    encrypted: true,
    presentedKey: true,
    computed: true,
    hideColumnInDocumentation: true,
    required: false,
    type: TableColumnType.ShortText,
    title: "Access Token",
    description:
      "Random secret in this person's link to the request. Generated by OneUptime; never readable through the API.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public accessToken?: string = undefined;
}
