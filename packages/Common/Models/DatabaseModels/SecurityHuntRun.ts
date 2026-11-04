import Project from "./Project";
import SecurityHunt from "./SecurityHunt";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
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
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One scheduled run of a hunt (Types/SecurityEvent/SecurityHunt, RUN
 * HISTORY): when it ran - its createdAt - the window of events it searched,
 * how many its search found there, or why it could not be made. A hunt's
 * page lists its runs, newest first; a run that found something opens the
 * Events explorer on its window.
 *
 * Written by OneUptime alone, as a run is recorded (SecurityHuntScheduler),
 * never changed, and kept SECURITY_HUNT_RUN_RETENTION_IN_DAYS
 * (SecurityHuntRunService). Read by whoever may read the hunt: the
 * detection rules' readers and every Security tier. Deleted with its hunt.
 *
 * Nobody makes these rows, so none of them is audited: what people change
 * on a hunt is (SecurityHunt).
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadProjectDetectionRule,
];

// Every column is OneUptime's to write; people read them.
const serverWrittenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: readPermissions,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/security-hunt-run"))
@Entity({
  name: "SecurityHuntRun",
})
@TableMetadata({
  tableName: "SecurityHuntRun",
  singularName: "Hunt Run",
  pluralName: "Hunt Runs",
  icon: IconProp.ViewfinderCircle,
  tableDescription:
    "Each scheduled run of a hunt: the events it searched, how many it found, or why it could not run. Kept for 90 days.",
})
// A hunt's runs, newest first; and the rows past their retention, for the daily clean-up.
@Index(["securityHuntId", "createdAt"])
@Index(["createdAt"])
export default class SecurityHuntRun extends BaseModel {
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this run's hunt belongs to.",
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this run's hunt belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityHuntId",
    type: TableColumnType.Entity,
    modelType: SecurityHunt,
    title: "Hunt",
    description: "The hunt that ran.",
  })
  @ManyToOne(
    () => {
      return SecurityHunt;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityHuntId" })
  public securityHunt?: SecurityHunt = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Hunt ID",
    description: "ID of the hunt that ran.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityHuntId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    canReadOnRelationQuery: true,
    title: "Searched From",
    description:
      "The start of the events the run searched: the moment after the run before it stopped.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public windowStartAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    canReadOnRelationQuery: true,
    title: "Searched Up To",
    description:
      "The end of the events the run searched, two minutes before it ran.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public windowEndAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "Event Count",
    description:
      "How many events the run's search found in its window. Empty when the run could not be made.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public eventCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Error",
    description:
      "Why the run could not be made. Empty when it ran; its window is searched again by the next run.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public error?: string = undefined;
}
