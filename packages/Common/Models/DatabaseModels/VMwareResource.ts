import VMwareVCenter from "./VMwareVCenter";
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
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ------------------------------------------------------------------
 *                          VMwareResource
 * ------------------------------------------------------------------
 *
 * Inventory snapshot of a single vSphere object (Datacenter, Cluster,
 * ESXi Host, Virtual Machine, Datastore or Resource Pool) as seen
 * through one vCenter. Populated by the OTel metrics ingest path from
 * the OpenTelemetry Collector `vcenter` receiver — identity arrives in
 * the RESOURCE attributes of every metric batch (vcenter.datacenter.name,
 * vcenter.cluster.name, vcenter.host.name, vcenter.vm.name / vcenter.vm.id,
 * vcenter.datastore.name, vcenter.resource_pool.inventory_path), so no
 * separate object stream is needed.
 *
 * `externalId` is derived from those attributes and is immutable and
 * collision-free within a vCenter:
 *   datacenter/<dc>            cluster/<dc>/<cluster>
 *   host/<dc>/<host>           vm/<vcenter.vm.id | vcenter.vm_template.id>
 *   datastore/<dc>/<datastore> resourcepool/<inventory path>
 * The column is ShortText (100). An id longer than that (a deeply
 * nested resource-pool path, the vm/<dc>/<host>/<name> fallback) is
 * shortened by the snapshot scan to a prefix + "~" + 16-hex sha1 of the
 * full id, so two long paths never share a row; the full path stays in
 * the LongText resourcePoolPath column.
 *
 * Power state is inferred rather than reported: the receiver emits
 * vcenter.vm.cpu.* ONLY for powered-on virtual machines, so a VM whose
 * batch carried memory/disk points but no CPU point is powered off (or
 * suspended — the receiver does not distinguish). Templates never carry
 * a power state.
 *
 * Count columns that fan out over datapoint attributes (status,
 * power_state, effective) are SUMMED across the newest timestamp for
 * that (resource, metric) — never "newest datapoint wins".
 *
 * The list/detail pages read this table instead of groupBy-ing over
 * 24h of ClickHouse metric data. Rows are upserted per collection and
 * hard-deleted once lastSeenAt falls behind the staleness threshold for
 * vCenters that remain connected.
 *
 * Writes go through VMwareResourceService under isRoot; users never
 * create/update/delete rows directly.
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
  Permission.ReadVMwareVCenter,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/vmware-resource"))
@TableMetadata({
  tableName: "VMwareResource",
  singularName: "VMware Resource",
  pluralName: "VMware Resources",
  icon: IconProp.Cube,
  tableDescription:
    "Snapshot of a vSphere object (datacenter, cluster, ESXi host, virtual machine, datastore or resource pool) as last reported by the VMware agent through vCenter. Populated by the telemetry ingest pipeline; not user-editable.",
})
@Index(["projectId", "vmwareVCenterId", "kind", "externalId"], {
  unique: true,
})
@Entity({
  name: "VMwareResource",
})
export default class VMwareResource extends BaseModel {
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
    manyToOneRelationColumn: "vmwareVCenterId",
    type: TableColumnType.Entity,
    modelType: VMwareVCenter,
    title: "vCenter",
    description: "vCenter this resource is inventoried through.",
  })
  @ManyToOne(
    () => {
      return VMwareVCenter;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "vmwareVCenterId" })
  public vmwareVCenter?: VMwareVCenter = undefined;

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
    title: "vCenter ID",
    description: "ID of the vCenter this resource is inventoried through.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public vmwareVCenterId?: ObjectID = undefined;

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
      "vSphere object kind in singular PascalCase: Datacenter, Cluster, Host, VirtualMachine, Datastore or ResourcePool.",
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
      "Immutable, collision-free identity within a vCenter, derived from the vcenter receiver's resource attributes: datacenter/<dc>, cluster/<dc>/<cluster>, host/<dc>/<host>, vm/<instance uuid> (fallback vm/<dc>/<host>/<name>), datastore/<dc>/<datastore>, resourcepool/<inventory path>. Also the URL-encoded detail-route param. Ids longer than 100 characters are shortened by the ingest layer to an 83-character prefix plus '~' and a 16-hex sha1 suffix of the full id, so two long inventory paths never collapse to the same key; the full inventory path stays in resourcePoolPath.",
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
      "Display name of the object as shown in the vSphere Client — the vcenter.datacenter.name, vcenter.cluster.name, vcenter.host.name, vcenter.vm.name / vcenter.vm_template.name, vcenter.datastore.name or vcenter.resource_pool.name resource attribute.",
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
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Datacenter Name",
    description:
      "The vcenter.datacenter.name resource attribute — the vSphere datacenter this object lives in. Every kind carries it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public datacenterName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Cluster Name",
    description:
      "The vcenter.cluster.name resource attribute — the vSphere cluster this host, virtual machine or resource pool belongs to. Null for standalone ESXi hosts and their VMs, and for Datacenter / Datastore kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public clusterName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Host Name",
    description:
      "The vcenter.host.name resource attribute — the ESXi host a virtual machine currently runs on, or the owner host of a resource pool on a standalone host. For Host kinds this equals name.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public hostName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Resource Pool Name",
    description:
      "The vcenter.resource_pool.name resource attribute — the resource pool a virtual machine is placed in. Null when the VM belongs to a vApp instead, and for non-VM kinds other than ResourcePool.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public resourcePoolName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Resource Pool Inventory Path",
    description:
      "The vcenter.resource_pool.inventory_path resource attribute (e.g. /DC1/host/Cluster1/Resources/Prod). For VMs placed in a vApp this holds vcenter.virtual_app.inventory_path instead. Stored as long text because vSphere inventory paths regularly exceed 100 characters.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public resourcePoolPath?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "vApp Name",
    description:
      "The vcenter.virtual_app.name resource attribute — the vApp a virtual machine belongs to. Null unless the VM is a vApp member.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public virtualAppName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "VM Instance UUID",
    description:
      "The vcenter.vm.id (or vcenter.vm_template.id) resource attribute — the virtual machine's instance UUID, stable across vMotion and renames. Null for non-VM kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public vmInstanceUuid?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Template",
    description:
      "True when this VirtualMachine row is a VM template (reported under vcenter.vm_template.*). Templates only report disk usage and never have a power state. Null for non-VM kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public isTemplate?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Powered On",
    description:
      "Inferred power state for VirtualMachine rows: true when the latest collection carried any vcenter.vm.cpu.* datapoint (the receiver emits those only for powered-on VMs), false when it carried memory or disk points but no CPU point (powered off or suspended — the receiver does not distinguish). Null for templates and non-VM kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public isPoweredOn?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Latest CPU Percent",
    description:
      "Most recent CPU utilization percent — vcenter.host.cpu.utilization for hosts, vcenter.vm.cpu.utilization for virtual machines (already a 0-100 percent, so no denominator cache is needed). Stored as decimal so sub-percent precision survives the round trip. Null for other kinds and until the first metric arrives.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: {
      to: (value: number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return value;
      },
      from: (value: string | number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        if (typeof value === "number") {
          return value;
        }
        const parsed: number = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public latestCpuPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Latest CPU MHz",
    description:
      "Most recent CPU usage in MHz — vcenter.host.cpu.usage, vcenter.vm.cpu.usage or vcenter.resource_pool.cpu.usage. Rounded to a whole MHz by the ingest layer.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public latestCpuMhz?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "CPU Capacity MHz",
    description:
      "Total CPU capacity in MHz — vcenter.host.cpu.capacity for hosts, vcenter.cluster.cpu.limit for clusters, vcenter.datacenter.cpu.limit for datacenters. The denominator for the CPU usage bar.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public cpuCapacityMhz?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "CPU Effective MHz",
    description:
      "vcenter.cluster.cpu.effective — CPU capacity in MHz actually available to virtual machines after vSphere HA / maintenance-mode reservations. Cluster kinds only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public cpuEffectiveMhz?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Latest Memory Bytes",
    description:
      "Most recent memory usage in bytes — vcenter.host.memory.usage, vcenter.vm.memory.usage or vcenter.resource_pool.memory.usage (guest type), converted from MiB. Stored as bigint so values past 2 GiB don't overflow.",
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
  public latestMemoryBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Max Memory Bytes",
    description:
      "Total memory in bytes — vcenter.host.memory.capacity for hosts (falling back to usage / utilization), derived from usage and utilization for virtual machines, vcenter.cluster.memory.limit for clusters, vcenter.datacenter.memory.limit for datacenters. The denominator for the memory usage bar.",
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
  public maxMemoryBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Memory Effective Bytes",
    description:
      "vcenter.cluster.memory.effective — memory in bytes actually available to virtual machines after vSphere HA / maintenance-mode reservations. Cluster kinds only.",
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
  public memoryEffectiveBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Latest Memory Percent",
    description:
      "Most recent memory utilization percent — vcenter.host.memory.utilization or vcenter.vm.memory.utilization. Stored as decimal — mirrors latestCpuPercent — so list views can sort/filter without dividing bigints client-side.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: {
      to: (value: number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return value;
      },
      from: (value: string | number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        if (typeof value === "number") {
          return value;
        }
        const parsed: number = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public latestMemoryPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Latest Disk Bytes",
    description:
      "Most recent used disk space in bytes — vcenter.vm.disk.usage{disk_state=used} for virtual machines, vcenter.datastore.disk.usage{disk_state=used} for datastores, vcenter.datacenter.disk.space{disk_state=used} for datacenters. Null for other kinds.",
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
  public latestDiskBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Max Disk Bytes",
    description:
      "Total disk space in bytes — the used plus available disk_state datapoints of the same metric that feeds latestDiskBytes. The denominator for the disk / datastore usage bar.",
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
  public maxDiskBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Latest Disk Percent",
    description:
      "Most recent disk utilization percent — vcenter.vm.disk.utilization or vcenter.datastore.disk.utilization; derived as used / (used + available) x 100 for datacenters.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: {
      to: (value: number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return value;
      },
      from: (value: string | number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        if (typeof value === "number") {
          return value;
        }
        const parsed: number = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public latestDiskPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "CPU Readiness Percent",
    description:
      "vcenter.vm.cpu.readiness — percentage of time the virtual machine was ready to run but could not be scheduled on a physical CPU (CPU ready). Sustained values above 10% mean host CPU contention. VirtualMachine kinds only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: {
      to: (value: number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return value;
      },
      from: (value: string | number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        if (typeof value === "number") {
          return value;
        }
        const parsed: number = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public cpuReadinessPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Memory Ballooned Bytes",
    description:
      "vcenter.vm.memory.ballooned or vcenter.resource_pool.memory.ballooned converted from MiB — guest memory reclaimed by the balloon driver. Any non-zero value means the host is under memory pressure.",
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
  public memoryBalloonedBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Memory Swapped Bytes",
    description:
      "vcenter.vm.memory.swapped or vcenter.resource_pool.memory.swapped converted from MiB — guest memory swapped to disk by the hypervisor. Any non-zero value is a critical memory-pressure signal.",
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
  public memorySwappedBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Host Count",
    description:
      "ESXi hosts in this cluster or datacenter — the sum of vcenter.cluster.host.count over both effective values, or of vcenter.datacenter.host.count over every status and power_state. Cluster and Datacenter kinds only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public hostCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Effective Host Count",
    description:
      "vcenter.cluster.host.count{effective=true} — hosts that are connected, not in maintenance mode and contributing resources to the cluster. A gap against hostCount means a host is in maintenance mode or unresponsive. Cluster kinds only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public effectiveHostCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Powered On Host Count",
    description:
      "Sum of vcenter.datacenter.host.count{power_state=on} across every status. Datacenter kinds only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public poweredOnHostCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "VM Count",
    description:
      "Virtual machines in this cluster or datacenter — the sum of vcenter.cluster.vm.count over every power_state, or of vcenter.datacenter.vm.count over every status and power_state. Cluster and Datacenter kinds only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public vmCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Powered On VM Count",
    description:
      "vcenter.cluster.vm.count{power_state=on}, or the sum of vcenter.datacenter.vm.count{power_state=on} across every status. Cluster and Datacenter kinds only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public poweredOnVmCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "VM Template Count",
    description:
      "vcenter.cluster.vm_template.count — VM templates registered in this cluster. Cluster kinds only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public vmTemplateCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Datastore Count",
    description:
      "vcenter.datacenter.datastore.count — datastores visible in this datacenter. Datacenter kinds only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public datastoreCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Cluster Count",
    description:
      "Sum of vcenter.datacenter.cluster.count across every status — clusters in this datacenter. Datacenter kinds only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public clusterCount?: number = undefined;

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
      "Observed timestamp of the latest metric point. Acts as the monotonic guard for metric updates and the cutoff for staleness rendering.",
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
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description:
      "Agent-observed timestamp of the most recent collection containing this resource. Also acts as the monotonic guard for upserts and the staleness delete threshold.",
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
    title: "Created By User",
    description:
      "Not user-facing; ingest writes as isRoot so this stays null in practice.",
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
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this row.",
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
    title: "Deleted By User",
    description: "Relation to the user who deleted this row.",
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
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this row.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
