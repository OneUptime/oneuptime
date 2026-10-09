import IncidentSeverity from "./IncidentSeverity";
import Label from "./Label";
import OnCallDutyPolicy from "./OnCallDutyPolicy";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import HuntressSeverity from "../../Types/Huntress/HuntressSeverity";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

/*
 * A connection decides who is paged for a security incident, so it is
 * configured by the project's admins, like the incident rules that do the
 * same (Incident Admin's description: "Incident rules ... take Project
 * Admin"). Everyone who can read incidents can read it, so a responder can
 * see why an incident was or was not opened.
 */
const writePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.IncidentViewer,
];

/*
 * A Huntress webhook endpoint, received by OneUptime.
 *
 * Huntress POSTs a signed event to the connection's URL
 * (/api/huntress/webhook/<id>) when one of its SOC analysts sends, comments
 * on or closes an incident report. Each report opens one incident, at the
 * severity the connection gives that Huntress severity, labelled with the
 * report's organization, paging the connection's on-call policies when the
 * report is severe enough; closing the report in Huntress resolves it.
 * What happened to every report is kept in HuntressIncidentReport.
 *
 * The signing secret Huntress shows for the endpoint is write-only: it is
 * encrypted at rest and never returned by the API.
 */
@EnableDocumentation()
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/huntress-connection"))
@Entity({
  name: "HuntressConnection",
})
@TableMetadata({
  tableName: "HuntressConnection",
  singularName: "Huntress Connection",
  pluralName: "Huntress Connections",
  icon: IconProp.ShieldCheck,
  tableDescription:
    "Huntress webhook endpoints. Every Huntress incident report opens an incident that pages on-call, and closing the report in Huntress resolves it.",
})
@TableAccessControl({
  create: writePermissions,
  read: readPermissions,
  delete: writePermissions,
  update: writePermissions,
})
export default class HuntressConnection extends BaseModel {
  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this connection belongs to.",
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
    create: writePermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this connection belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: writePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Name,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "A name for this connection, such as the Huntress account it receives from.",
    example: "Huntress",
  })
  @Column({
    nullable: false,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: writePermissions,
    read: [],
    update: writePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Signing Secret",
    description:
      "The endpoint's signing secret from Huntress (whsec_...), used to verify that a request really came from Huntress. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public signingSecret?: string = undefined;

  /*
   * Whether signingSecret holds a secret, for the pages that cannot read it.
   * The service sets it from the secret on every create and every update
   * that writes the secret, whatever the request says; it is writable by
   * the connection's writers only because a hook writes it inside their
   * request.
   */
  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: writePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Signing Secret Saved",
    description:
      "Whether a signing secret is saved. Requests are only accepted once it is. Set from the signing secret itself; a value sent for it is ignored.",
    defaultValue: false,
    isDefaultValueColumn: true,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isSigningSecretSet?: boolean = undefined;

  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: writePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: OnCallDutyPolicy,
    title: "On-Call Policies",
    description:
      "The on-call policies paged for an incident report at or above the Page On-Call For severity.",
  })
  @ManyToMany(
    () => {
      return OnCallDutyPolicy;
    },
    { eager: false },
  )
  @JoinTable({
    name: "HuntressConnectionOnCallDutyPolicy",
    inverseJoinColumn: {
      name: "onCallDutyPolicyId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "huntressConnectionId",
      referencedColumnName: "_id",
    },
  })
  public onCallDutyPolicies?: Array<OnCallDutyPolicy> = undefined;

  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: writePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Page On-Call For",
    description:
      "The lowest Huntress severity that pages the on-call policies: critical (critical reports only), high (high and critical reports) or low (every report). Every report opens an incident either way.",
    defaultValue: HuntressSeverity.High,
    isDefaultValueColumn: true,
    example: HuntressSeverity.High,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: HuntressSeverity.High,
  })
  public pageOnCallFor?: HuntressSeverity = undefined;

  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: writePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "criticalIncidentSeverityId",
    type: TableColumnType.Entity,
    modelType: IncidentSeverity,
    title: "Severity For Critical Reports",
    description:
      "The incident severity a critical Huntress report opens at. Empty means the project's most severe incident severity.",
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
  @JoinColumn({ name: "criticalIncidentSeverityId" })
  public criticalIncidentSeverity?: IncidentSeverity = undefined;

  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: writePermissions,
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Severity For Critical Reports ID",
    description: "ID of the incident severity critical reports open at.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public criticalIncidentSeverityId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: writePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "highIncidentSeverityId",
    type: TableColumnType.Entity,
    modelType: IncidentSeverity,
    title: "Severity For High Reports",
    description:
      "The incident severity a high Huntress report opens at. Empty means the project's second most severe incident severity.",
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
  @JoinColumn({ name: "highIncidentSeverityId" })
  public highIncidentSeverity?: IncidentSeverity = undefined;

  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: writePermissions,
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Severity For High Reports ID",
    description: "ID of the incident severity high reports open at.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public highIncidentSeverityId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: writePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "lowIncidentSeverityId",
    type: TableColumnType.Entity,
    modelType: IncidentSeverity,
    title: "Severity For Low Reports",
    description:
      "The incident severity a low Huntress report opens at. Empty means the project's third most severe incident severity.",
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
  @JoinColumn({ name: "lowIncidentSeverityId" })
  public lowIncidentSeverity?: IncidentSeverity = undefined;

  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: writePermissions,
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Severity For Low Reports ID",
    description: "ID of the incident severity low reports open at.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public lowIncidentSeverityId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: writePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Only These Organizations",
    description:
      "The Huntress organizations this connection opens incidents for, one per line, by name or by id. Empty watches every organization.",
    example: "Acme Corp\n1234",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public watchedOrganizations?: string = undefined;

  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: writePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Labels added to every incident this connection opens, next to the label named after the report's organization.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "HuntressConnectionLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "huntressConnectionId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: writePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Resolve When Huntress Closes The Report",
    description:
      "Resolve the incident when the report is closed or dismissed in Huntress. When off, a note on the incident says so instead.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public resolveIncidentWhenReportCloses?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Event Received At",
    description:
      "When a request signed with the signing secret last arrived. Empty until Huntress sends the first one.",
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastEventReceivedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Last Event Type",
    description:
      "The type of the last event received, such as incident_report.created.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public lastEventType?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Last Error",
    description:
      "Why the last request was refused or could not be handled, if it was. Cleared by the next request that is handled.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public lastError?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Error At",
    description: "When the last error happened.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastErrorAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who created this connection.",
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
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this connection.",
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
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this connection.",
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
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this connection.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
