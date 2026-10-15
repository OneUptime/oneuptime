import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "./NetworkDeviceDiscoveryScan";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import { DiscoveryImportStatus } from "../../Types/NetworkDevice/DiscoveryImport";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ONE IMPORT OF A DISCOVERY SCAN'S HOSTS AS NETWORK DEVICES (Network >
 * Discovery > Review Results > Import).
 *
 * The person picks hosts and says how they are monitored; this row records
 * that, and a worker creates the devices - and, with a monitor template, a
 * monitor per device - acting as that person, writing what happened to each
 * host into `results` as it goes. The Review dialog draws its progress, its
 * failures and its finished summary from this row, so closing the dialog,
 * leaving the page or opening it on another screen shows the same import
 * where it stands. See Types/NetworkDevice/DiscoveryImport for the shapes
 * and Server/Utils/NetworkDiscovery/DiscoveryImportRunner for the work.
 *
 * `hosts` is what the person ticked, as the scan described those hosts when
 * the import was asked for: the import creates what was reviewed, even if
 * the scan runs again meanwhile. It never holds a credential - the scan's
 * credentials are read from the scan, as the person, when each device is
 * created.
 *
 * Internal: every row is written by the server as root and read through the
 * import API (NetworkDeviceDiscoveryImportAPI), which decides who may see
 * and act on what. There is no CRUD API and no API documentation for this
 * table (ToolImportRun is the precedent).
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Index(["projectId", "status"])
@Index(["networkDeviceDiscoveryScanId", "createdAt"])
@TableMetadata({
  tableName: "NetworkDeviceDiscoveryImport",
  singularName: "Network Device Discovery Import",
  pluralName: "Network Device Discovery Imports",
  icon: IconProp.Download,
  tableDescription:
    "An import of a discovery scan's hosts as network devices, with the monitor each device gets, and what happened to every host. Managed by the server; not user-writable.",
})
@Entity({
  name: "NetworkDeviceDiscoveryImport",
})
export default class NetworkDeviceDiscoveryImport extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
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
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
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
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "networkDeviceDiscoveryScanId",
    type: TableColumnType.Entity,
    modelType: NetworkDeviceDiscoveryScan,
    title: "Discovery Scan",
    description:
      "The scan whose hosts are imported. Deleting the scan deletes its imports; the devices and monitors they created stay.",
  })
  @ManyToOne(
    () => {
      return NetworkDeviceDiscoveryScan;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "networkDeviceDiscoveryScanId" })
  public networkDeviceDiscoveryScan?: NetworkDeviceDiscoveryScan = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Discovery Scan ID",
    description: "ID of the scan whose hosts are imported.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public networkDeviceDiscoveryScanId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description:
      "Where the import is: Queued, Running, Completed, Stopped or Failed.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: DiscoveryImportStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    title: "Settings",
    description:
      "How the imported devices are monitored: the polling interval, whether vendor templates are applied, and the monitor template each device gets (DiscoveryImportSettings).",
  })
  @Column({
    nullable: false,
    type: ColumnType.JSON,
  })
  public settings?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    title: "Hosts",
    description:
      "The hosts the person ticked, as the scan described them when the import was asked for. Written once; never holds a credential.",
  })
  @Column({
    nullable: false,
    type: ColumnType.JSON,
  })
  public hosts?: Array<DiscoveredNetworkDevice> = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    title: "Results",
    description:
      "What happened to each host's device and monitor, in the order of `hosts` (DiscoveryImportHostResult).",
  })
  @Column({
    nullable: false,
    type: ColumnType.JSON,
  })
  public results?: Array<JSONObject> = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    title: "Progress",
    description:
      "The counts the progress bars are drawn from, worked out from `results` each time they are written (DiscoveryImportProgress).",
  })
  @Column({
    nullable: false,
    type: ColumnType.JSON,
  })
  public progress?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Monitor Template Name",
    description:
      "The monitor template's name when the import was asked for, so the summary can say which template the monitors came from.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public monitorTemplateName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Error",
    description: "Why the import as a whole failed, when it did.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public error?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Stop Requested At",
    description:
      "When someone asked the import to stop. The worker stops before its next host.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public stopRequestedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Resume Count",
    description:
      "How many times the import was picked up again after a worker stopped part-way. Past a few, the import is failed rather than resumed for ever.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: 0,
  })
  public resumeCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Retry Of Import ID",
    description:
      "The import whose failed hosts this one tries again, when it is a retry.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public retryOfImportId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "The person who asked for the import. It acts as them, with their permissions at the time each host is imported.",
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
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description: "ID of the person who asked for the import.",
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
    required: false,
    type: TableColumnType.Date,
    title: "Started At",
    description: "When a worker started creating the import's devices.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public startedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Completed At",
    description: "When the import completed, stopped or failed.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public completedAt?: Date = undefined;
}
