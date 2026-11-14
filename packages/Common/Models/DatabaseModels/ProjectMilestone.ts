import Project from "./Project";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ActivationMilestone from "../../Types/Analytics/ActivationMilestone";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One activation milestone a project reached, and when (issue #6830): the
 * moment it first had a monitor, a check result, an on-call page delivered,
 * a second member... (Types/Analytics/ActivationMilestone).
 *
 * One row per project and milestone, held so by the unique index below:
 * ProjectMilestoneService.reach() writes a row with INSERT ... ON CONFLICT
 * DO NOTHING, so a milestone is kept once whichever worker gets there first,
 * and only the insert that wrote it sends its analytics event. A row is
 * never changed, and is deleted only with its project.
 *
 * A table rather than a column on Project for each milestone: Project is
 * read on nearly every request, and a new milestone is then a new value of
 * the enum, not an ALTER of that table.
 *
 * Read by every member of the project (ProjectUser, as the dashboard's
 * other shared furniture is): the Welcome checklist on Home (#6803) and
 * Setup health (#6812) read what the project has done here instead of
 * counting rows on every visit. Nothing in a row says who did it or what it
 * was about. Written only by the server: nobody creates, edits or deletes
 * one through the API.
 */
const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.ProjectUser,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/project-milestone"))
@TableMetadata({
  tableName: "ProjectMilestone",
  singularName: "Project Milestone",
  pluralName: "Project Milestones",
  icon: IconProp.Flag,
  tableDescription:
    "When a project first reached each activation milestone: its first monitor, check result, on-call page delivered, second member, status page with a monitor, telemetry of each kind and more.",
})
/*
 * A milestone is kept once per project. Also how every read finds a
 * project's milestones (projectId leads), so the table needs no other index.
 */
@Index(["projectId", "milestone"], { unique: true })
@Entity({
  name: "ProjectMilestone",
})
export default class ProjectMilestone extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "The project that reached this milestone.",
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
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project that reached this milestone.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Milestone",
    description:
      "Which milestone the project reached, such as first_monitor_created or first_check_result_received.",
    example: ActivationMilestone.FirstMonitorCreated,
    allowedValues: Object.values(ActivationMilestone),
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public milestone?: ActivationMilestone = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    title: "Reached At",
    description: "When the project first reached this milestone.",
    example: "2026-11-11T09:30:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public reachedAt?: Date = undefined;

  /*
   * Kept by the one-off backfill (BackfillProjectMilestones) from the data
   * a project already had when milestones were first kept, rather than at
   * the moment it happened: its time is the best that data says, and no
   * event was sent for it. The funnel leaves these out of its times.
   */
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Was Backfilled",
    description:
      "Whether this milestone was filled in afterwards from the data the project already had, rather than recorded when it happened.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public wasBackfilled?: boolean = undefined;
}
