import Project from "./Project";
import RumApplication from "./RumApplication";
import User from "./User";
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
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { ProductAnalyticsSavedViewType } from "../../Types/Rum/ProductAnalyticsSavedViews";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A funnel or a retention table a team saved from a RUM application's
 * Funnels or User Retention page (issue #6630), under a name: its
 * definition (Types/Rum/ProductAnalyticsSavedViews), which the page opens
 * again and a dashboard widget reads with the dashboard's time range.
 *
 * Who may see and keep them is who may read what they read. The product
 * analytics reads are /list's (TelemetryAPI's requireSessionReplayListAccess
 * and its SESSION_REPLAY_LIST_PERMISSIONS): whoever can read an
 * application's funnels can save one, and nobody else lists them -
 * Permission.Viewer and the RUM application's read permission are not
 * among them, as they are not among the reads'. A role limited to labels
 * reaches the saved definitions of the applications carrying them: the
 * application the row names (rumApplicationId) carries its labels.
 *
 * The plan is the reads': saving what the project cannot read is not
 * offered either.
 */
const ACCESS_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.ReadRumSessionReplay,
  Permission.ReadRumSessionReplayPayload,
];

@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: ACCESS_PERMISSIONS,
  read: ACCESS_PERMISSIONS,
  update: ACCESS_PERMISSIONS,
  delete: ACCESS_PERMISSIONS,
})
@CrudApiEndpoint(new Route("/rum-product-analytics-saved-view"))
@TableMetadata({
  tableName: "RumProductAnalyticsSavedView",
  singularName: "Saved Product Analytics View",
  pluralName: "Saved Product Analytics Views",
  icon: IconProp.Bookmark,
  tableDescription:
    "Funnels and retention tables saved from a RUM application's product analytics, by name, to open again or show on a dashboard.",
})
/* How a page lists them: one application's, of one kind. */
@Index(["projectId", "rumApplicationId", "viewType"])
@Entity({
  name: "RumProductAnalyticsSavedView",
})
export default class RumProductAnalyticsSavedView extends BaseModel {
  @ColumnAccessControl({
    create: ACCESS_PERMISSIONS,
    read: ACCESS_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this saved view belongs to.",
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
    create: ACCESS_PERMISSIONS,
    read: ACCESS_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this saved view belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: ACCESS_PERMISSIONS,
    read: ACCESS_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "rumApplicationId",
    type: TableColumnType.Entity,
    modelType: RumApplication,
    title: "RUM Application",
    description:
      "The RUM application whose product analytics this saved view reads.",
  })
  @ManyToOne(
    () => {
      return RumApplication;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "rumApplicationId" })
  public rumApplication?: RumApplication = undefined;

  /*
   * Kept: a saved view is of its application, and moving it to another
   * would carry events and properties that one may not have.
   */
  @ColumnAccessControl({
    create: ACCESS_PERMISSIONS,
    read: ACCESS_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "RUM Application ID",
    description:
      "ID of the RUM application whose product analytics this saved view reads.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public rumApplicationId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: ACCESS_PERMISSIONS,
    read: ACCESS_PERMISSIONS,
    update: ACCESS_PERMISSIONS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "What the team calls this funnel or retention table.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  /*
   * What it is: a funnel or a retention table. Kept: its definition is
   * read as one or the other, and a dashboard widget draws one kind.
   */
  @ColumnAccessControl({
    create: ACCESS_PERMISSIONS,
    read: ACCESS_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "View Type",
    description:
      "What this saved view is: a funnel (funnel) or a retention table (retention).",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public viewType?: ProductAnalyticsSavedViewType = undefined;

  @ColumnAccessControl({
    create: ACCESS_PERMISSIONS,
    read: ACCESS_PERMISSIONS,
    update: ACCESS_PERMISSIONS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    title: "Definition",
    description:
      "What it reads. A funnel: its steps (each an event's kind and name), the time to finish it (windowMs) and its segment (filters). A retention table: its startEvent, returnEvent, period (day, week or month) and segment (filters). The time range is not part of it: a page keeps its own, and a dashboard widget reads the dashboard's.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: false,
  })
  public definition?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: ACCESS_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who saved this view.",
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

  /*
   * create: []: OneUptime writes who saved it (UserAttribution), never a
   * request, so an API key cannot put a colleague's name on it.
   */
  @ColumnAccessControl({
    create: [],
    read: ACCESS_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who saved this view.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: ACCESS_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this saved view.",
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
    read: ACCESS_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this saved view.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
