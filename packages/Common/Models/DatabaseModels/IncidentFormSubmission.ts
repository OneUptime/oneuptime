import Incident from "./Incident";
import IncidentForm from "./IncidentForm";
import Project from "./Project";
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
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One submission of an incident form: which form it came through, the
 * incident it declared, and who the reporter said they were. createdAt is
 * when it was sent.
 *
 * Only the form's public submit route writes these, as root, so the create
 * and update lists are empty and the API is read-only - apart from deleting
 * a submission, and the reporter's name and email with it, which incident
 * admins may do. There are no workflow triggers: a submission is already an
 * incident, and the incident's own triggers fire for it.
 *
 * Deleting the form deletes its submissions. Deleting the incident keeps
 * the submission, pointing at no incident. A submission whose incident is
 * private is hidden from whoever cannot see that incident
 * (IncidentFormSubmissionService applies the incident privacy filter).
 */

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.IncidentViewer,
  Permission.ReadIncidentFormSubmission,
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
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.IncidentAdmin,
    Permission.DeleteIncidentFormSubmission,
  ],
  update: [],
})
@CrudApiEndpoint(new Route("/incident-form-submission"))
@Entity({
  name: "IncidentFormSubmission",
})
@TableMetadata({
  tableName: "IncidentFormSubmission",
  singularName: "Incident Form Submission",
  pluralName: "Incident Form Submissions",
  icon: IconProp.ClipboardDocumentCheck,
  tableDescription:
    "The submissions made through this project's incident forms: the form, the incident each one declared, and the name and email the reporter gave.",
})
export default class IncidentFormSubmission extends BaseModel {
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
    manyToOneRelationColumn: "incidentFormId",
    type: TableColumnType.Entity,
    modelType: IncidentForm,
    title: "Incident Form",
    description: "The incident form this submission was made through.",
  })
  @ManyToOne(
    () => {
      return IncidentForm;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentFormId" })
  public incidentForm?: IncidentForm = undefined;

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
    title: "Incident Form ID",
    description: "ID of the incident form this submission was made through.",
    example: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentFormId?: ObjectID = undefined;

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
      "The incident this submission declared. Empty once that incident is deleted.",
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
      "ID of the incident this submission declared. Empty once that incident is deleted.",
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
    required: false,
    type: TableColumnType.ShortText,
    title: "Reporter Name",
    description:
      "The name the reporter gave, as they typed it. Empty when the form lets people report anonymously and they did.",
    example: "Jane Doe",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public reporterName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Email,
    title: "Reporter Email",
    description:
      "The email address the reporter gave. It is not verified, and nothing is sent to it. Empty when the form lets people report anonymously and they did.",
    example: "jane.doe@example.com",
  })
  @Column({
    nullable: true,
    type: ColumnType.Email,
    length: ColumnLength.Email,
    transformer: Email.getDatabaseTransformer(),
  })
  public reporterEmail?: Email = undefined;
}
