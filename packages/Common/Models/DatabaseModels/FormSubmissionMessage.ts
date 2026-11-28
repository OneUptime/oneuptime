import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Form from "./Form";
import FormSubmission from "./FormSubmission";
import FormSubmissionFollower from "./FormSubmissionFollower";
import Project from "./Project";
import User from "./User";
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
import { FormFollowUpAuthor } from "../../Types/Form/FormFollowUp";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One message of a form submission's follow-up conversation
 * (Common/Types/Form/FormFollowUp): written by somebody following the
 * request on the form's page, or by a responder on the page of the record
 * the submission created.
 *
 * Each is also a private note on that record, which is what the team reads
 * - under the record's own access rules - so these rows are only what the
 * form's page shows the people following, and what the dashboard's card
 * lists. Nobody reads or writes them through the API; the follow-up routes
 * do, as root (see FormSubmissionFollower).
 *
 * The author's name and address are kept as they were when the message was
 * written: a person who stops following leaves their messages behind.
 * Deleting the submission, or its form, deletes its messages.
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
@Index(["formSubmissionId", "createdAt"])
@Entity({
  name: "FormSubmissionMessage",
})
@TableMetadata({
  tableName: "FormSubmissionMessage",
  singularName: "Form Submission Message",
  pluralName: "Form Submission Messages",
  icon: IconProp.Chat,
  tableDescription:
    "The follow-up conversation of a form submission: what the people following it and the team wrote to each other, and the files they sent.",
})
export default class FormSubmissionMessage extends BaseModel {
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
    description: "The submission this message is about.",
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
    description: "ID of the submission this message is about.",
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
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(FormFollowUpAuthor),
    title: "Author",
    description:
      "Who wrote the message: Requester, for somebody following the request, or Team, for a responder.",
    example: FormFollowUpAuthor.Requester,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public author?: FormFollowUpAuthor = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "formSubmissionFollowerId",
    type: TableColumnType.Entity,
    modelType: FormSubmissionFollower,
    title: "Written By",
    description:
      "The person following the request who wrote the message. Empty for the team's messages, and once that person stops following.",
  })
  @ManyToOne(
    () => {
      return FormSubmissionFollower;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "formSubmissionFollowerId" })
  public formSubmissionFollower?: FormSubmissionFollower = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Written By ID",
    description:
      "ID of the person following the request who wrote the message. Empty for the team's messages, and once that person stops following.",
    example: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public formSubmissionFollowerId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "The responder who wrote the message. Empty for messages from the people following the request.",
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
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Created by User ID",
    description:
      "ID of the responder who wrote the message. Empty for messages from the people following the request.",
    example: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Author Name",
    description:
      "The name the message was written under when it was written: the person's name or address, or the responder's name.",
    example: "Jane Doe",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public authorName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Email,
    title: "Author Email",
    description:
      "The address of the person following the request who wrote the message, as it was then. Empty for the team's messages.",
    example: "jane.doe@example.com",
  })
  @Column({
    nullable: true,
    type: ColumnType.Email,
    length: ColumnLength.Email,
    transformer: Email.getDatabaseTransformer(),
  })
  public authorEmail?: Email = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Message",
    description:
      "What was written, as Markdown. Empty for a message that is files alone.",
    example: "The checkout still fails for orders over 100 items.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public message?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Files",
    description:
      "The files the message carried, as stored with the record the submission created: each file's id, name, type and size.",
    example: [
      {
        fileId: "d4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f7a",
        name: "checkout-error.png",
        fileType: "image/png",
        size: 48213,
      },
    ],
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public files?: JSONArray = undefined;
}
