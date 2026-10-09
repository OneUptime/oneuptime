import File from "./File";
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
import FormTargetType, {
  DEFAULT_FORM_TARGET_TYPE,
} from "../../Types/Form/FormTargetType";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A form (the Forms product): a page anyone with its link can open, without
 * a OneUptime account, built question by question in the dashboard's form
 * builder. Each submission creates something in the form's project - an
 * incident or a scheduled maintenance event (targetType) - from the answers
 * (fields) and the form's own settings (targetSettings), and leaves a
 * FormSubmission behind. A submission can start from one of the form's
 * templates (templates): named sets of answers that fill the form in, ask
 * its questions their own way (required, optional or hidden) and answer the
 * questions they hide.
 *
 * Forms replaced incident forms (Incidents > Settings > Forms); the
 * migration that moved them kept each form's id and link key, so the old
 * links still lead to it.
 *
 * Because a form lets people outside the team page on-call and schedule
 * maintenance, building one takes the project's owners and admins, or the
 * Form permissions given on purpose - not a domain's member tier. Everyone
 * who can read incidents or scheduled maintenance can read forms, and so
 * their links: a link is meant to be passed around.
 *
 * The link is /accounts/form/<shareKey>. shareKey is minted by FormService
 * on create - never taken from the request - and form editors can replace it
 * (the dashboard's Reset Link) to stop an old link working. It is not a
 * secret the way an API key is: it sits in an address bar by design, and
 * the form is protected by its switch, its IP allowlist, rate limits and the
 * instance captcha instead.
 */

const CREATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateForm,
];

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.IncidentViewer,
  Permission.ScheduledMaintenanceAdmin,
  Permission.ScheduledMaintenanceMember,
  Permission.ScheduledMaintenanceViewer,
  Permission.ReadForm,
];

const DELETE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.DeleteForm,
];

const UPDATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditForm,
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
@CrudApiEndpoint(new Route("/form"))
@Entity({
  name: "Form",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "Form",
  singularName: "Form",
  pluralName: "Forms",
  icon: IconProp.ClipboardDocumentList,
  tableDescription:
    "Forms anyone with the link can fill in, without a OneUptime account. Each submission creates an incident or a scheduled maintenance event in this project.",
})
export default class Form extends BaseModel {
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
    example: "Report a Problem",
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
      "Use this form to report anything that looks broken. The on-call team is told as soon as you submit it.",
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
    title: "Accepting Submissions",
    description:
      "Whether the form's link works. While it is off, the public page shows a not-available message and nothing can be submitted.",
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
   * FormService.onBeforeCreate), so nobody can choose the key a form starts
   * with. Editors may replace it later - that is how the dashboard's Reset
   * Link retires a link that went too far - and the service only accepts a
   * UUID there. Unique across all projects, since a visit finds its form by
   * this key alone; the constraint is also the index that lookup uses.
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
      "The key in the form's public link, /accounts/form/<shareKey>. Generated when the form is created. Resetting the link in the dashboard replaces it, and the old link stops working.",
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
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    title: "Creates",
    description:
      "What each submission creates: Incident, or ScheduledMaintenance (a scheduled maintenance event).",
    defaultValue: DEFAULT_FORM_TARGET_TYPE,
    example: FormTargetType.Incident,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: DEFAULT_FORM_TARGET_TYPE,
  })
  public targetType?: FormTargetType = undefined;

  /*
   * The questions, in the order the public page asks them: a list of
   * Types/Form/FormField. Checked on every write by FormService, against
   * the form's target, so a public page never asks something no submission
   * could be made from.
   */
  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Questions",
    description:
      "The questions the form asks, in order. Each has an id, a source (Question: one of the form's own, answered by type; TargetField: a built-in field of what the form creates, by targetField; TargetCustomField: one of its custom fields, by customFieldId; Submitter: the submitter's Name or Email), a label, optional help text, isRequired and isHidden (not shown on the public form, and answered only from the template a submission started from; never required, and never a field the target cannot be created without). A new form starts with a title, a description and the submitter's name and email.",
    example: [
      {
        id: "0f6c2b8e-6a8d-4f1c-9d3e-2b7a1c5e9f40",
        source: "TargetField",
        targetField: "title",
        label: "What is wrong?",
        isRequired: true,
      },
      {
        id: "5b1d7e2a-3c9f-4e6b-8a0d-1f2e3d4c5b6a",
        source: "Question",
        type: "Dropdown",
        label: "Which office are you in?",
        dropdownOptions: "Berlin\nLondon",
        isRequired: false,
      },
    ],
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public fields?: JSONArray = undefined;

  /*
   * Named sets of answers a submission can start from - the Templates page:
   * a list of Types/Form/FormTemplate, checked on every write by FormService,
   * each answer against the question it answers and each field setting
   * against the question it sets. The public page offers them above the
   * questions and asks the questions as the chosen one asks them (Required,
   * Optional, Hidden); the server holds a submission to the same questions,
   * and answers the ones it was not asked from the template it started from.
   */
  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Templates",
    description:
      "Named sets of answers a submission can start from, in the order the form lists them. Each has an id, a name (unique within the form), isDefault (the form opens with it; at most one template), answers: an object keyed by question id, each answer as a submission sends it - text, a number, true or false, an option's value, or a list of values for a multi-select - and fieldSettings: an object keyed by question id that makes a question Required, Optional or Hidden when a submission starts from the template; a question it does not list is asked as the form asks it, and a question the form cannot create its record without is always asked and required. The public form lists the templates above its questions and fills in a template's answers when one is chosen, or when its link names one (?template=<id>). A question the submission was not asked - hidden by the form or by the template - is answered only from the template a submission started from.",
    example: [
      {
        id: "3f2c1b0a-9d8e-4c7b-a6f5-e4d3c2b1a0f9",
        name: "Application Outage",
        isDefault: false,
        answers: {
          "0f6c2b8e-6a8d-4f1c-9d3e-2b7a1c5e9f40":
            "The application is unavailable",
          "5b1d7e2a-3c9f-4e6b-8a0d-1f2e3d4c5b6a": "London",
        },
        fieldSettings: {
          "5b1d7e2a-3c9f-4e6b-8a0d-1f2e3d4c5b6a": "Required",
          "9c4e1f6a-2b7d-4e8a-b3c5-d6e7f8091a2b": "Hidden",
        },
      },
    ],
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public templates?: JSONArray = undefined;

  /*
   * What every submission starts with, beyond the answers - the On Submit
   * page: Types/Form/FormTargetSettings, checked on every write, and every
   * record it names checked against the form's own project.
   */
  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "On Submit Settings",
    description:
      "What every submission starts with besides the answers. For incidents: defaultTitle, incidentSeverityId, incidentTemplateId, monitorIds, labelIds, onCallDutyPolicyIds, ownerUserIds and ownerTeamIds. For scheduled maintenance events: defaultTitle, monitorIds, statusPageIds, labelIds, ownerUserIds, ownerTeamIds, showOnStatusPages and notifySubscribers.",
    example: {
      incidentSeverityId: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
      ownerTeamIds: ["e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8a9b"],
    },
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public targetSettings?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Thank-You Message",
    description:
      "Shown after the form is submitted, together with the number of what the submission created. Markdown.",
    example:
      "Thank you. The on-call team has been told and will follow up if they need more details.",
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
    create: PlanType.Scale,
  })
  public ipWhitelist?: string = undefined;

  /*
   * The form's branding, set in the Build page's Branding section: a logo
   * shown at the top of its public page in place of the OneUptime logo,
   * what that logo says for screen readers, and the icon of the browser tab
   * while the page is open. Files, uploaded as a status page's are, checked
   * on every write by FormService (Types/Form/FormBranding: an image every
   * browser draws, 1 MB at most).
   *
   * The public page gets them inside the form's own public read, never at
   * an address of their own and never by a file's id, and the files stay
   * private. Deleting a file only takes it off the form (SET NULL): a form,
   * and its submissions, outlive their logo.
   */
  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    manyToOneRelationColumn: "logoFileId",
    type: TableColumnType.Entity,
    modelType: File,
    title: "Logo",
    description:
      "The image at the top of the form's public page, in place of the OneUptime logo. A PNG, JPEG, GIF, WebP or SVG image of 1 MB or less.",
  })
  @ManyToOne(
    () => {
      return File;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "logoFileId" })
  public logoFile?: File = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Logo File ID",
    description:
      "ID of the file the form's public page shows as its logo: upload the image to /api/file first. Leave it empty to show the OneUptime logo.",
    example: "b8e2c3d4-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public logoFileId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Logo Alt Text",
    description:
      "What the logo says, read out by screen readers: usually your organization's name. Leave it empty and screen readers skip the logo.",
    example: "Acme Inc.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public logoAltText?: string = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    manyToOneRelationColumn: "faviconFileId",
    type: TableColumnType.Entity,
    modelType: File,
    title: "Favicon",
    description:
      "The icon in the browser tab while the form's public page is open, in place of the OneUptime favicon. A PNG, JPEG, GIF, WebP or SVG image of 1 MB or less.",
  })
  @ManyToOne(
    () => {
      return File;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "faviconFileId" })
  public faviconFile?: File = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Favicon File ID",
    description:
      "ID of the file the form's public page shows as the browser tab's icon: upload the image to /api/file first. Leave it empty to show the OneUptime favicon.",
    example: "c9f3d4e5-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public faviconFileId?: ObjectID = undefined;

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
