import Form from "./Form";
import Incident from "./Incident";
import Project from "./Project";
import ScheduledMaintenance from "./ScheduledMaintenance";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
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
import Email from "../../Types/Email";
import FormTargetType from "../../Types/Form/FormTargetType";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One submission of a form: which form it came through, every answer it
 * gave (worded as the form asked it then), who the submitter said they
 * were, and what it created - an incident or a scheduled maintenance event.
 * createdAt is when it was sent.
 *
 * Only the form's public submit route writes these, as root, so the create
 * and update lists are empty and the API is read-only - apart from deleting
 * a submission, and the answers, name and email with it.
 *
 * A submission holds what a stranger wrote and how to reach them, and the
 * answers may describe a private incident. So it is read by the project's
 * owners and admins, and by whoever is given Read Form Submission on
 * purpose - not by everyone who can read incidents. Everybody else reads
 * what a submission created on the incident or the event itself, where the
 * answers are on a private note, under that record's own access rules.
 *
 * Deleting the form deletes its submissions. Deleting what a submission
 * created keeps the submission, pointing at nothing.
 */

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadFormSubmission,
];

const DELETE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.DeleteFormSubmission,
];

@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [...READ_PERMISSIONS],
  delete: [...DELETE_PERMISSIONS],
  update: [],
})
@CrudApiEndpoint(new Route("/form-submission"))
@Entity({
  name: "FormSubmission",
})
@TableMetadata({
  tableName: "FormSubmission",
  singularName: "Form Submission",
  pluralName: "Form Submissions",
  icon: IconProp.ClipboardDocumentCheck,
  tableDescription:
    "The submissions made through this project's forms: every answer, the name and email the submitter gave, and the incident or scheduled maintenance event each one created.",
})
export default class FormSubmission extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
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
    read: [...READ_PERMISSIONS],
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
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "formId",
    type: TableColumnType.Entity,
    modelType: Form,
    title: "Form",
    description: "The form this submission was made through.",
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
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Form ID",
    description: "ID of the form this submission was made through.",
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
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Answers",
    description:
      "Every question the submitter answered, in the form's order: the question's id (fieldId), its label when the form was submitted, the stored value, and the value as a person reads it (displayValue).",
    example: [
      {
        fieldId: "0f6c2b8e-6a8d-4f1c-9d3e-2b7a1c5e9f40",
        label: "What is wrong?",
        value: "Checkout fails",
        displayValue: "Checkout fails",
      },
    ],
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public answers?: JSONArray = undefined;

  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Submitter Name",
    description:
      "The name the submitter gave, as they typed it. Empty when the form does not ask for it, or lets people leave it out and they did.",
    example: "Jane Doe",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public submitterName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Email,
    title: "Submitter Email",
    description:
      "The email address the submitter gave. It is not verified, and nothing is sent to it. Empty when the form does not ask for it, or lets people leave it out and they did.",
    example: "jane.doe@example.com",
  })
  @Column({
    nullable: true,
    type: ColumnType.Email,
    length: ColumnLength.Email,
    transformer: Email.getDatabaseTransformer(),
  })
  public submitterEmail?: Email = undefined;

  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Created",
    description:
      "What the submission created: Incident, or ScheduledMaintenance (a scheduled maintenance event).",
    example: FormTargetType.Incident,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public targetType?: FormTargetType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentId",
    type: TableColumnType.Entity,
    modelType: Incident,
    title: "Incident",
    description:
      "The incident this submission created. Empty for a form that schedules maintenance, and once that incident is deleted.",
  })
  @ManyToOne(
    () => {
      return Incident;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentId" })
  public incident?: Incident = undefined;

  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Incident ID",
    description:
      "ID of the incident this submission created. Empty for a form that schedules maintenance, and once that incident is deleted.",
    example: "e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8a9b",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "scheduledMaintenanceId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenance,
    title: "Scheduled Maintenance Event",
    description:
      "The scheduled maintenance event this submission created. Empty for a form that creates incidents, and once that event is deleted.",
  })
  @ManyToOne(
    () => {
      return ScheduledMaintenance;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "scheduledMaintenanceId" })
  public scheduledMaintenance?: ScheduledMaintenance = undefined;

  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Scheduled Maintenance Event ID",
    description:
      "ID of the scheduled maintenance event this submission created. Empty for a form that creates incidents, and once that event is deleted.",
    example: "b8c9d0e1-f2a3-4b4c-9d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public scheduledMaintenanceId?: ObjectID = undefined;
}
