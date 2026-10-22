import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import Color from "../../Types/Color";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableMCP from "../../Types/Database/EnableMCP";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import ColorField from "../../Types/Database/ColorField";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import ListOrderColumn from "../../Types/Database/ListOrderColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * HOW FAR AN INCIDENT'S POSTMORTEM HAS COME.
 *
 * Every incident's postmortem is in one of its project's postmortem
 * statuses (Incident.postmortemStatus), so a team can see which postmortems
 * are still owed across every incident (Incidents > Postmortems) and filter
 * them by owner, severity and status.
 *
 * A project starts with four: Not Started, Draft, Completed and Not Needed
 * (ProjectService.addDefaultIncidentPostmortemStatuses). Three of them are
 * built in, because OneUptime moves postmortems into them by itself
 * (Common/Utils/Incident/PostmortemStatus):
 *
 *   - a new incident's postmortem starts in the not started status;
 *   - writing its note moves it to the draft status;
 *   - publishing it on a status page moves it to the completed status.
 *
 * They can be renamed, never deleted or archived. A project adds its own
 * statuses - "In Review", "Action Items Open" - which go just above the
 * completed status, and the order of the list says what each counts as: a
 * status at or below the completed one counts as done, so the postmortem is
 * no longer owed ("Not Needed" sits after it), and one above it as not
 * started or in progress (Common/Utils/StateOrder). Like every value
 * records pick from, a status can be archived: incidents keep it, nobody
 * picks it again (Common/Utils/ArchivableValues).
 */
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Free,
  update: PlanType.Growth,
  delete: PlanType.Free,
})
@EnableDocumentation()
@EnableMCP()
@TenantColumn("projectId")
@ListOrderColumn({ column: "order", scopeColumns: ["projectId"] })
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.IncidentAdmin,
    Permission.CreateIncidentPostmortemStatus,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.IncidentViewer,
    Permission.ReadIncidentPostmortemStatus,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.IncidentAdmin,
    Permission.DeleteIncidentPostmortemStatus,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.IncidentAdmin,
    Permission.EditIncidentPostmortemStatus,
  ],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@EnableAuditLog()
@CrudApiEndpoint(new Route("/incident-postmortem-status"))
@SlugifyColumn("name", "slug")
@TableMetadata({
  tableName: "IncidentPostmortemStatus",
  singularName: "Postmortem Status",
  pluralName: "Postmortem Statuses",
  icon: IconProp.ClipboardDocumentCheck,
  tableDescription:
    "Manage the statuses an incident's postmortem moves through (Not Started, Draft, Completed for example). Add, edit, reorder or archive them.",
})
@Entity({
  name: "IncidentPostmortemStatus",
})
@Index(["projectId", "isNotStartedStatus"])
@Index(["projectId", "order"])
export default class IncidentPostmortemStatus extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.CreateIncidentPostmortemStatus,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.CreateIncidentPostmortemStatus,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.CreateIncidentPostmortemStatus,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.EditIncidentPostmortemStatus,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Any friendly name of this object",
    example: "In Review",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    computed: true,
    title: "Slug",
    description: "Friendly globally unique name for your object",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.CreateIncidentPostmortemStatus,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.EditIncidentPostmortemStatus,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
    example: "The postmortem is written and waiting for the team's review.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.CreateIncidentPostmortemStatus,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.CreateIncidentPostmortemStatus,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
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

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.CreateIncidentPostmortemStatus,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.EditIncidentPostmortemStatus,
    ],
  })
  @ColorField()
  @TableColumn({
    title: "Color",
    required: true,
    unique: false,
    type: TableColumnType.Color,
    canReadOnRelationQuery: true,
    description: "Color of this resource in Hex (#32a852 for example)",
  })
  @Column({
    type: ColumnType.Color,
    length: ColumnLength.Color,
    unique: false,
    nullable: false,
    transformer: Color.getDatabaseTransformer(),
  })
  public color?: Color = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.CreateIncidentPostmortemStatus,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.EditIncidentPostmortemStatus,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Not Started Status",
    description:
      "Is it the status a new incident's postmortem starts in? A project has one, and it can't be deleted or archived.",
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isNotStartedStatus?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.CreateIncidentPostmortemStatus,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.EditIncidentPostmortemStatus,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Draft Status",
    description:
      "Is it the status a postmortem moves to once its note is written? A project has one, and it can't be deleted or archived.",
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isDraftStatus?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.CreateIncidentPostmortemStatus,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.EditIncidentPostmortemStatus,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Completed Status",
    description:
      "Is it the status a postmortem moves to once it is published on a status page? A postmortem in this status, or in one below it, counts as done. A project has one, and it can't be deleted or archived.",
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isCompletedStatus?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.CreateIncidentPostmortemStatus,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.EditIncidentPostmortemStatus,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.SmallNumber,
    canReadOnRelationQuery: true,
    title: "Order",
    required: false,
    description:
      "Where this status sits in the project's list of postmortem statuses: 1 is the top. A postmortem in the completed status, or in a status below it, counts as done; one above it is still owed. So the not started, draft and completed statuses have to stay in that order. A new status without a number goes just above the completed status. Setting a number moves the status to that place, and the ones in between shift by one. In the dashboard, drag the rows to reorder them.",
  })
  @Column({
    type: ColumnType.SmallNumber,
  })
  public order?: number = undefined;

  /*
   * Archiving retires a value without touching a record that has it: it
   * stays on them, and nobody can pick it again (Common/Utils/ArchivableValues;
   * the server refuses it in ArchivedValueCheck). No permission of its own:
   * archiving is an update, so it is gated by Edit.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.CreateIncidentPostmortemStatus,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.IncidentAdmin,
      Permission.EditIncidentPostmortemStatus,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Archived",
    description:
      "Archived statuses stay on the incidents whose postmortems are in them, but can't be picked again. The not started, draft and completed statuses can't be archived.",
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isArchived?: boolean = undefined;

  /*
   * Stamped server-side from the `isArchived` write (see
   * DatabaseService.stampSwitchAttribution), which is why these are read-only
   * to the client: "who archived this and when" cannot be spoofed.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Archived At",
    description:
      "When this postmortem status was archived. Empty while it is not archived.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public archivedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "archivedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Archived by User",
    description:
      "Relation to User who archived this object (if this object was archived by a User)",
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
  @JoinColumn({ name: "archivedByUserId" })
  public archivedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentPostmortemStatus,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Archived by User ID",
    description:
      "User ID who archived this object (if this object was archived by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public archivedByUserId?: ObjectID = undefined;
}
