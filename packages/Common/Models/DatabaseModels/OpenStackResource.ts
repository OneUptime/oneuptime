import OpenStackCloud from "./OpenStackCloud";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
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
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ------------------------------------------------------------------
 *                         OpenStackResource
 * ------------------------------------------------------------------
 *
 * Inventory snapshot of one part of an OpenStack cloud: a region, hypervisor,
 * service, instance, volume, network and so on. Populated by the telemetry
 * ingest path from the openstack_* series (OpenStackSnapshotScan), so the list
 * and detail pages read this table instead of grouping over ClickHouse.
 *
 * A cloud can hold hundreds of thousands of these, so lists page on the server
 * by the indexed columns, and what is specific to one kind stays in `facts`
 * rather than growing a column per fact of every OpenStack service.
 *
 * Rows age out per service, not by the clock alone: a part is gone only when its
 * service's scrape succeeded without it (OpenStackResourceService.deleteStale).
 * A failing Nova is not a Nova with no instances.
 *
 * Writes go through OpenStackResourceService under isRoot; users never create,
 * update or delete rows directly.
 *
 * ------------------------------------------------------------------
 */

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadOpenStackCloud,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/openstack-resource"))
@TableMetadata({
  tableName: "OpenStackResource",
  singularName: "OpenStack Resource",
  pluralName: "OpenStack Resources",
  icon: IconProp.Cube,
  tableDescription:
    "Snapshot of one part of an OpenStack cloud (a hypervisor, service, instance, volume, network and so on) as last reported to OneUptime. Populated by the telemetry ingest pipeline; not user-editable.",
})
@Index(["projectId", "openStackCloudId", "kind", "externalId"], {
  unique: true,
})
@Index(["projectId", "openStackCloudId", "kind", "status"])
/*
 * A list's default sort. Measured at 200,000 instances: the first page falls from 124 to
 * 2 ms, and the worst page from 1,680 to 364 ms, for 10% more write-ahead log on a whole
 * upsert.
 */
@Index(["projectId", "openStackCloudId", "kind", "name"])
// What runs on a hypervisor, and what a project owns: read for every blast radius.
@Index(["projectId", "openStackCloudId", "kind", "hypervisorName"])
@Index(["projectId", "openStackCloudId", "kind", "openStackProjectId"])
@Entity({
  name: "OpenStackResource",
})
export default class OpenStackResource extends BaseModel {
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
    description: "Relation to Project this resource belongs to.",
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
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the Project this resource belongs to.",
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
    manyToOneRelationColumn: "openStackCloudId",
    type: TableColumnType.Entity,
    modelType: OpenStackCloud,
    title: "OpenStack Cloud",
    description: "Cloud this resource lives in.",
  })
  @ManyToOne(
    () => {
      return OpenStackCloud;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "openStackCloudId" })
  public openStackCloud?: OpenStackCloud = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "OpenStack Cloud ID",
    description: "ID of the OpenStack Cloud this resource lives in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public openStackCloudId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Kind",
    description:
      "What this row is: one of OpenStackResourceKind, such as Hypervisor, Instance, Volume or Service.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public kind?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "External ID",
    description:
      "The part's own id in the cloud, stable for its life: a UUID for most kinds, region/host/binary for a service.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public externalId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "The part's name as OpenStack reports it. Names are not unique in OpenStack, so nothing joins on this.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Region",
    description:
      "The region this part is in.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public regionName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Availability Zone",
    description:
      "The availability zone this part is in, for the kinds that have one.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public availabilityZone?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Hypervisor",
    description:
      "The hypervisor this part runs on, or for a Hypervisor row, its own name.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public hypervisorName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "OpenStack Project ID",
    description:
      "The ID of the OpenStack project that owns this part. Keyed by ID so a rename breaks nothing.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public openStackProjectId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Status",
    description:
      "The part's status in OpenStack's own word, such as ACTIVE, SHUTOFF, available, in-use, up or down.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Admin State",
    description:
      "What an operator has set: enabled or disabled for Nova and Cinder services, up or down for Neutron agents. A disabled part is planned work, never a failure.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public adminState?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Disabled Reason",
    description:
      "Why an operator disabled this part, in their own words.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public disabledReason?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "State Changed At",
    description:
      "When this part's status or admin state last changed, as far as OneUptime has seen. How long a part has been stuck, or disabled, is read from this.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public stateChangedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "vCPU Capacity",
    description:
      "vCPUs this part can promise to instances: what Placement allows on a hypervisor, a flavor's size on an instance.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public vcpuCapacity?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "vCPUs Allocated",
    description:
      "vCPUs promised to instances on this part. This is what is promised, not what is busy.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public vcpuAllocated?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Memory Capacity",
    description:
      "Memory this part can promise to instances.",
  })
  @Column({
    nullable: true,
    type: ColumnType.BigPositiveNumber,
    transformer: {
      to: (value: number | null | undefined): string | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return Math.trunc(value).toString();
      },
      from: (value: string | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        const parsed: number = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public memoryCapacityBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Memory Allocated",
    description:
      "Memory promised to instances on this part. This is what is promised, not what is in use.",
  })
  @Column({
    nullable: true,
    type: ColumnType.BigPositiveNumber,
    transformer: {
      to: (value: number | null | undefined): string | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return Math.trunc(value).toString();
      },
      from: (value: string | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        const parsed: number = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public memoryAllocatedBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Disk Capacity",
    description:
      "Local disk this part can promise, or for a volume or storage pool, its size.",
  })
  @Column({
    nullable: true,
    type: ColumnType.BigPositiveNumber,
    transformer: {
      to: (value: number | null | undefined): string | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return Math.trunc(value).toString();
      },
      from: (value: string | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        const parsed: number = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public diskCapacityBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Disk Allocated",
    description:
      "Local disk promised on this part, or for a storage pool, what is used.",
  })
  @Column({
    nullable: true,
    type: ColumnType.BigPositiveNumber,
    transformer: {
      to: (value: number | null | undefined): string | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return Math.trunc(value).toString();
      },
      from: (value: string | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        const parsed: number = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public diskAllocatedBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Instances",
    description:
      "How many instances this part holds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public instanceCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    canReadOnRelationQuery: true,
    title: "Facts",
    description:
      "What else OpenStack says about this part, by kind: a flavor's id, a network's addresses used and total, a router's external network. Read for display, never filtered on.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public facts?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Metrics Updated At",
    description:
      "When this row's numbers were last read.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public metricsUpdatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description:
      "When a scrape of this part's kind last reported it. A row ages out only when its service's scrape succeeded without it, so a failing service never empties its parts.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description: "Always null: rows are written by the ingest pipeline.",
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
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description: "Always null: rows are written by the ingest pipeline.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted by User",
    description: "Always null: rows are removed by the ingest pipeline.",
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
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description: "Always null: rows are removed by the ingest pipeline.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
