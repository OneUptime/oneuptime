import CloudAccount from "./CloudAccount";
import Project from "./Project";
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
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * How many of an account's resources carried its required tags on a day
 * (#11012): every resource its connection lists, those that carried every
 * required tag, and those that carried each one. Counted once a day by the
 * watcher (CloudTagWatcher), so coverage by resource has a trend; coverage
 * by spend is worked out from the costs' own tags whenever it is read.
 *
 * Written only by the watcher, one row an account and UTC day; kept as
 * long as the costs are (CLOUD_COST_HISTORY_DAYS).
 */

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadCloudResource,
];

@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/cloud-tag-coverage-day"))
@TableMetadata({
  tableName: "CloudTagCoverageDay",
  singularName: "Tag Coverage Day",
  pluralName: "Tag Coverage Days",
  icon: IconProp.Tag,
  tableDescription:
    "How many of a cloud account's resources carried its required tags, counted once a day.",
})
@TableAccessControl({
  create: [],
  read: readPermissions,
  delete: [],
  update: [],
})
@Index(["cloudAccountId", "day"], { unique: true })
@Index(["projectId", "day"])
@Entity({
  name: "CloudTagCoverageDay",
})
export default class CloudTagCoverageDay extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: readPermissions,
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
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudAccountId",
    type: TableColumnType.Entity,
    modelType: CloudAccount,
    title: "Cloud Account",
    description: "The account counted.",
  })
  @ManyToOne(
    () => {
      return CloudAccount;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudAccountId" })
  public cloudAccount?: CloudAccount = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Cloud Account ID",
    description: "ID of the account counted.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudAccountId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Day",
    description: "The UTC day counted, at its start.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public day?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Resources",
    description: "The resources the account's connection listed that day.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: 0,
  })
  public resourceCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Carrying Every Required Tag",
    description:
      "Of them, those that carried every required tag, each with a value allowed.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: 0,
  })
  public coveredCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Carrying Each Required Tag",
    description:
      "Of them, how many carried each required tag with a value allowed, by the tag's key in lower case.",
    example: '{"team": 41, "env": 48}',
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public keyCounts?: JSONObject = undefined;
}
