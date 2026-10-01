import IncidentSeverity from "./IncidentSeverity";
import IncidentTemplate from "./IncidentTemplate";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import ColumnBillingAccessControl from "../../Types/Database/AccessControl/ColumnBillingAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import {
  DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING,
  IncidentFormFieldSetting,
} from "../../Types/Incident/IncidentFormPublic";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * An incident form: a page anyone with its link can open, without a
 * OneUptime account, to report something that is wrong. Each submission
 * declares an incident in the form's project (see IncidentFormSubmission for
 * the record it leaves) and the form decides what that incident starts with:
 * its severity, optionally an incident template, and which questions the
 * reporter is asked.
 *
 * Because a form lets people outside the team page on-call, building one
 * takes the incident settings tier - project owners and admins and incident
 * admins, like severities and states - rather than the tier that may edit
 * incident templates. Everyone who can read incidents can read forms, and so
 * their links: the link is meant to be passed around the company.
 *
 * The link is /accounts/incident-form/<shareKey>. shareKey is minted by
 * IncidentFormService on create - never taken from the request - and form
 * editors can replace it (the dashboard's Reset Link) to stop an old link
 * working. It is not a secret the way an API key is: it sits in an address
 * bar by design, and the form is protected by its enable switch, its IP
 * allowlist, rate limits and the instance captcha instead.
 */

const CREATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.IncidentAdmin,
  Permission.CreateIncidentForm,
];

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.IncidentViewer,
  Permission.ReadIncidentForm,
];

const DELETE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.IncidentAdmin,
  Permission.DeleteIncidentForm,
];

const UPDATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.IncidentAdmin,
  Permission.EditIncidentForm,
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
  create: [...CREATE_PERMISSIONS],
  read: [...READ_PERMISSIONS],
  delete: [...DELETE_PERMISSIONS],
  update: [...UPDATE_PERMISSIONS],
})
@CrudApiEndpoint(new Route("/incident-form"))
@Entity({
  name: "IncidentForm",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "IncidentForm",
  singularName: "Incident Form",
  pluralName: "Incident Forms",
  icon: IconProp.ClipboardDocumentList,
  tableDescription:
    "Forms anyone with the link can fill in to report an incident, without a OneUptime account. Each submission declares an incident in this project.",
})
export default class IncidentForm extends BaseModel {
  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
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
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
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
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "The form's name, shown as the heading of its public page. Unique within the project.",
    example: "Report a Security Concern",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Description",
    description:
      "Shown at the top of the form's public page, above the questions: what the form is for and what happens after it is sent. Markdown.",
    example:
      "Use this form to report anything that looks like a security problem. The security on-call team is paged as soon as you submit it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Enabled",
    description:
      "Whether the form's link works. While the form is turned off, its public page shows a not-available message and nothing can be submitted.",
    defaultValue: true,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  /*
   * Computed: whatever a create sends is replaced by a fresh key (see
   * IncidentFormService.onBeforeCreate), so nobody can choose the key a form
   * starts with. Editors may replace it later - that is how the dashboard's
   * Reset Link retires a link that went too far - and the service only
   * accepts a UUID there. Unique across all projects, since a visit finds
   * its form by this key alone; the constraint is also the index that
   * lookup uses.
   */
  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Share Key",
    description:
      "The key in the form's public link, /accounts/incident-form/<shareKey>. Generated when the form is created. Resetting the link in the dashboard replaces it, and the old link stops working.",
    example: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    unique: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public shareKey?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentSeverityId",
    type: TableColumnType.Entity,
    modelType: IncidentSeverity,
    title: "Incident Severity",
    description:
      "The severity incidents declared through this form start with, unless the form lets the reporter choose one and they do.",
  })
  @ManyToOne(
    () => {
      return IncidentSeverity;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentSeverityId" })
  public incidentSeverity?: IncidentSeverity = undefined;

  /*
   * Required when a form is created, but nullable in the database: deleting
   * the severity must not be blocked by a form, and must not delete the
   * form either. A form left without one still works when its template or
   * its reporter supplies a severity; otherwise a submission is refused with
   * a message saying so, until an editor picks a new one.
   */
  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Incident Severity ID",
    description:
      "ID of the severity incidents declared through this form start with.",
    example: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentSeverityId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Let Reporter Choose Severity",
    description:
      "When on, the form asks the reporter to choose a severity from the project's incident severities, with the form's own severity chosen to begin with.",
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public allowReporterToChooseSeverity?: boolean = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentTemplateId",
    type: TableColumnType.Entity,
    modelType: IncidentTemplate,
    title: "Incident Template",
    description:
      "An incident template to declare incidents from. Everything the template sets applies - its initial state, monitors, labels, on-call policies, owners, status pages and a monitor status change among them - and the reporter's answers are filled in over it.",
  })
  @ManyToOne(
    () => {
      return IncidentTemplate;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentTemplateId" })
  public incidentTemplate?: IncidentTemplate = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Incident Template ID",
    description:
      "ID of the incident template incidents declared through this form are declared from, if any.",
    example: "d4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f8a",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentTemplateId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    title: "Description Question",
    description:
      "Whether the form asks the reporter to describe the incident: Required, Optional or Hidden.",
    defaultValue: DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING,
    example: IncidentFormFieldSetting.Optional,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING,
  })
  public descriptionSetting?: IncidentFormFieldSetting = undefined;

  /*
   * The form's own questions, in the shape of IncidentTemplate's setting
   * (Types/CustomField/CustomFieldCreateSettings) but read the form's way:
   * only fields listed as Required or Optional are asked, whatever their
   * project-wide switches say. A public page must never show a field an
   * admin did not put on it. Checked on every write by IncidentFormService.
   */
  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Custom Field Settings",
    description:
      "The incident custom fields the form asks for, keyed by each field's template variable key (variableKey). Required means the reporter must answer it, Optional that they may leave it empty. Only the fields listed as Required or Optional are asked: a field that is not listed, or is Hidden or Default, is not on the form. The answers become the incident's custom field values.",
    example: {
      impact: "Required",
      affected_location: "Optional",
    },
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public customFieldSettings?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Require Reporter Details",
    description:
      "When on, the reporter must give their name and email. When off, they may report anonymously.",
    defaultValue: true,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isReporterDetailsRequired?: boolean = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Success Message",
    description:
      "Shown to the reporter after they submit the form, together with the new incident's number. Markdown.",
    example:
      "Thank you. The on-call team has been notified and will follow up if they need more details.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public successMessage?: string = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "IP Allowlist",
    description:
      "The networks the form can be opened and submitted from: one IPv4 or IPv6 address, or one IPv4 range in CIDR notation (such as 10.0.0.0/8), per line. IPv6 ranges are not supported. Leave it empty to allow any network.",
    example: "203.0.113.0/24\n198.51.100.7",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Scale,
    create: PlanType.Free,
  })
  public ipWhitelist?: string = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [],
  })
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

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
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

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
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
