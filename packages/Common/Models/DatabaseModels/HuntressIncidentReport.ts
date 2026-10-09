import HuntressConnection from "./HuntressConnection";
import Incident from "./Incident";
import Project from "./Project";
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
import HuntressIncidentReportOutcome from "../../Types/Huntress/HuntressIncidentReportOutcome";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

// The same readers as the connection: everyone who can read incidents.
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
 * One Huntress incident report a project received, and what was done with
 * it: the incident it opened, or why it opened none.
 *
 * It is also what keeps a report to one incident. Huntress sends a report
 * more than once - created, then comments, then closed, and Svix retries
 * any delivery that was not answered in time - and the row, unique by
 * project, Huntress account and report id, is claimed before the incident
 * is opened. A report sent to two connections of one project opens one
 * incident too.
 *
 * Only the webhook writes these rows; deleting a connection deletes them.
 */
@EnableDocumentation()
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/huntress-incident-report"))
@Entity({
  name: "HuntressIncidentReport",
})
@Index(["projectId", "huntressAccountId", "huntressIncidentReportId"], {
  unique: true,
})
@Index(["projectId", "huntressConnectionId", "createdAt"])
@TableMetadata({
  tableName: "HuntressIncidentReport",
  singularName: "Huntress Incident Report",
  pluralName: "Huntress Incident Reports",
  icon: IconProp.ShieldCheck,
  tableDescription:
    "Huntress incident reports received through a Huntress connection, each with the incident it opened or the reason it opened none.",
})
@TableAccessControl({
  create: [],
  read: readPermissions,
  delete: [],
  update: [],
})
export default class HuntressIncidentReport extends BaseModel {
  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this report was received in.",
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

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this report was received in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "huntressConnectionId",
    type: TableColumnType.Entity,
    modelType: HuntressConnection,
    title: "Huntress Connection",
    description: "The connection that first received this report.",
  })
  @ManyToOne(
    () => {
      return HuntressConnection;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "huntressConnectionId" })
  public huntressConnection?: HuntressConnection = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Huntress Connection ID",
    description: "ID of the connection that first received this report.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public huntressConnectionId?: ObjectID = undefined;

  /*
   * Empty, never null, when the payload names no account: the unique index
   * treats nulls as different from each other, which would let one report
   * open two incidents.
   */
  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Huntress Account ID",
    description:
      "The id of the Huntress account the report belongs to, or empty when Huntress did not say.",
    example: "5",
    defaultValue: "",
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: "",
  })
  public huntressAccountId?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Huntress Incident Report ID",
    description: "The incident report's id in Huntress.",
    example: "1234",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public huntressIncidentReportId?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Organization ID",
    description: "The id of the Huntress organization the report is about.",
    example: "4",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public organizationId?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Organization",
    description: "The name of the Huntress organization the report is about.",
    example: "Acme Corp",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public organizationName?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Affected",
    description:
      "The host or identity the report is about, as Huntress names it in the report's subject.",
    example: "DESKTOP-01",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public affectedName?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Subject",
    description: "The report's subject in Huntress.",
    example: "CRITICAL - Incident on DESKTOP-01 (Acme Corp)",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public subject?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Severity",
    description:
      "The report's severity in Huntress: critical, high or low, as Huntress last sent it.",
    example: "critical",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public severity?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Status",
    description:
      "The report's status in Huntress as it last sent it, such as sent, closed or dismissed.",
    example: "sent",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public status?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "incidentId",
    type: TableColumnType.Entity,
    modelType: Incident,
    title: "Incident",
    description: "The incident this report opened.",
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

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Incident ID",
    description:
      "ID of the incident this report opened. Empty when it opened none, or when the incident was deleted.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Outcome",
    description:
      "What was done with the report: Opening, IncidentOpened, IncidentResolved, OrganizationNotWatched or ClosedBeforeReceived.",
    example: HuntressIncidentReportOutcome.IncidentOpened,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public outcome?: HuntressIncidentReportOutcome = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    title: "Paged On-Call",
    description:
      "Whether the incident was opened with the connection's on-call policies, which pages them.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public pagedOnCall?: boolean = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Last Event Type",
    description: "The last event Huntress sent about this report.",
    example: "incident_report.closed",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public lastEventType?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Event Received At",
    description: "When Huntress last sent an event about this report.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastEventReceivedAt?: Date = undefined;

  /*
   * The ids of the latest webhook messages applied to this report, so a
   * delivery Svix sends again - a comment answered too slowly the first
   * time - is applied once. Server only.
   */
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Applied Message IDs",
    description:
      "The ids of the latest webhook messages applied to this report.",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public appliedMessageIds?: JSONArray = undefined;
}
