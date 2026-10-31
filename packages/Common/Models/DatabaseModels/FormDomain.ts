import Domain from "./Domain";
import Form from "./Form";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A form's own domain: report.acme.com answering with the form, over HTTPS,
 * as status.acme.com answers with a status page (StatusPageDomain) and
 * dashboard.acme.com with a dashboard (DashboardDomain). The three have the
 * same columns, and their certificates go through the same steps
 * (FormDomainService, CustomDomainOrders, GreenlockUtil).
 *
 * One form per domain, at the domain's root, and one thing per name on the
 * whole installation: a name a status page, a dashboard or another form
 * already has is refused (CustomDomainConflicts), since a visit to the name
 * can only lead to one of them. The domain shows the form it was added to
 * and nothing else (Types/Form/FormCustomDomain): the form is found by the
 * domain the request came to, never by a key the request names.
 *
 * Who may add, change or remove a form's domains is who may change where
 * the form is shared: the project's owners and admins, Edit Form (which
 * resets the form's link), or the Form Domain permissions given on purpose -
 * not a member tier, as for the form itself. Everyone who can read forms can
 * read their domains: a domain is the form's link, and a link is meant to be
 * passed around.
 *
 * The form, the domain and the subdomain are fixed once the domain is
 * added: a different subdomain, or another form, is another domain - add it
 * and delete this one. Deleting the form deletes its domains.
 */

const CREATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditForm,
  Permission.CreateFormDomain,
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
  Permission.ReadFormDomain,
];

const UPDATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditForm,
  Permission.EditFormDomain,
];

const DELETE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditForm,
  Permission.DeleteFormDomain,
];

@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@EnableDocumentation()
@CanAccessIfCanReadOn("form")
@TenantColumn("projectId")
@TableAccessControl({
  create: [...CREATE_PERMISSIONS],
  read: [...READ_PERMISSIONS],
  delete: [...DELETE_PERMISSIONS],
  update: [...UPDATE_PERMISSIONS],
})
@CrudApiEndpoint(new Route("/form-domain"))
@TableMetadata({
  tableName: "FormDomain",
  singularName: "Form Domain",
  pluralName: "Form Domains",
  icon: IconProp.Globe,
  tableDescription:
    "Your own domains a form answers on, such as report.acmeinc.com, verified and served over HTTPS.",
})
@Entity({
  name: "FormDomain",
})
export default class FormDomain extends BaseModel {
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
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "domainId",
    type: TableColumnType.Entity,
    modelType: Domain,
    title: "Domain",
    description:
      "The verified domain this one is a subdomain of (Project Settings > Advanced > Domains).",
  })
  @ManyToOne(
    () => {
      return Domain;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "domainId" })
  public domain?: Domain = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Domain ID",
    description:
      "ID of the verified domain this one is a subdomain of. The domain must be verified in Project Settings > Advanced > Domains.",
    example: "d4e5f6a7-b8c9-4123-8ef4-567890abcdef",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public domainId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "formId",
    type: TableColumnType.Entity,
    modelType: Form,
    title: "Form",
    description: "The form this domain answers with.",
  })
  @ManyToOne(
    () => {
      return Form;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "formId" })
  public form?: Form = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Form ID",
    description:
      "ID of the form this domain answers with. Fixed once the domain is added: to put the domain on another form, delete it and add it there.",
    example: "b2c3d4e5-f6a7-4901-8cde-f1234567890a",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public formId?: ObjectID = undefined;

  /*
   * Create only: the full domain is worked out when the domain is added
   * (FormDomainService.onBeforeCreate) and never again, so a subdomain
   * changed afterwards would change nothing.
   */
  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Subdomain",
    description:
      "Subdomain label for your form such as 'report'. Leave blank or enter @ to use the root domain.",
    example: "report",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public subdomain?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.ShortText,
    title: "Full Domain",
    description:
      "Full domain of your form (like report.acmeinc.com). This is autogenerated and is derived from subdomain and domain.",
    example: "report.acmeinc.com",
  })
  @Index()
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public fullDomain?: string = undefined;

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
    example: "c3d4e5f6-a7b8-4012-8def-234567890abc",
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

  /*
   * The CNAME sweeps fetch http(s)://<fullDomain>/api/form/custom-domain/
   * cname-verification/<token> (Types/Form/FormCustomDomain), and the form
   * API answers 200 only on that domain, for its own token: the domain
   * reaches this installation. Generated when the domain is added; never
   * read by anyone.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.ShortText,
    title: "CNAME Verification Token",
    description: "CNAME Verification Token",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public cnameVerificationToken?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    computed: true,
    type: TableColumnType.Boolean,
    title: "CNAME Verified",
    description:
      "Whether the domain's CNAME record has been found pointing to this installation. Checked every 15 minutes, or on Check now.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public isCnameVerified?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    computed: true,
    type: TableColumnType.Boolean,
    title: "SSL Ordered",
    description:
      "Whether a free SSL certificate has been ordered for the domain. Ordered on its own once the CNAME record is verified.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public isSslOrdered?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    computed: true,
    type: TableColumnType.Boolean,
    title: "SSL Provisioned",
    description: "Whether the domain serves its free SSL certificate yet.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public isSslProvisioned?: boolean = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Custom Certificate",
    description:
      "The certificate, in PEM format, to serve the domain with instead of the free one. Used while isCustomCertificate is on.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
    unique: false,
  })
  public customCertificate?: string = undefined;

  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Custom Certificate Key",
    description:
      "The custom certificate's private key, in PEM format. Used while isCustomCertificate is on.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
    unique: false,
  })
  public customCertificateKey?: string = undefined;

  // On: the domain is served with the certificate uploaded above, not ours.
  @ColumnAccessControl({
    create: [...CREATE_PERMISSIONS],
    read: [...READ_PERMISSIONS],
    update: [...UPDATE_PERMISSIONS],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: false,
    type: TableColumnType.Boolean,
    title: "Is Custom Certificate",
    description:
      "Serve the domain with the certificate you upload rather than the free SSL certificate OneUptime issues and renews.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    unique: false,
    default: false,
  })
  public isCustomCertificate?: boolean = undefined;

  /*
   * When a reissue of this domain's Let's Encrypt certificate was last
   * REQUESTED from the dashboard - not when one last succeeded: the stamp
   * behind the reissue cooldown, written before the order is attempted
   * (CertificateReissueOrder). Automated renewal never writes here.
   */
  @ColumnAccessControl({
    create: [],
    read: [...READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Date,
    title: "Certificate Reissue Requested At",
    description:
      "When a reissue of the SSL certificate for this domain was last requested. Used to rate limit how often a certificate can be reissued.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public certificateReissueRequestedAt?: Date = undefined;
}
