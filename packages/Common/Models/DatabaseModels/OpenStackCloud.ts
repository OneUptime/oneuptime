import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnBillingAccessControl from "../../Types/Database/AccessControl/ColumnBillingAccessControl";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import Label from "./Label";
import Probe from "./Probe";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import OpenStackCollectionErrorCode from "../../Types/OpenStack/OpenStackCollectionError";
import OpenStackCollectionMethod from "../../Types/OpenStack/OpenStackCollectionMethod";
import OpenStackCollectionStatus from "../../Types/OpenStack/OpenStackCollectionStatus";
import {
  DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  OPENSTACK_CREDENTIAL_KINDS,
  OPENSTACK_ENDPOINT_INTERFACES,
  OpenStackCollectionOptions,
  OpenStackCollectionSummary,
  OpenStackCredentialKind,
  OpenStackEndpointInterface,
  OpenStackPresentedCertificate,
} from "../../Types/OpenStack/OpenStackProbeCollection";
import Permission from "../../Types/Permission";
import TelemetryRetentionConfig from "../../Types/Telemetry/TelemetryRetentionConfig";
import { DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES } from "../../Utils/OpenStack/OpenStackCollectionSettings";
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
 * Who reads, creates and edits a cloud: the lists of the table below, named for the
 * probe collection columns, which hold to them too.
 */
const OPENSTACK_CLOUD_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadOpenStackCloud,
];

const OPENSTACK_CLOUD_CREATORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateOpenStackCloud,
];

const OPENSTACK_CLOUD_EDITORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditOpenStackCloud,
];

/*
 * The columns ingest and the probe rewrite on their own, every collection. The audit
 * log records what people change, and recording these would bury it.
 */
export const OPENSTACK_CLOUD_BOOKKEEPING_COLUMNS: Array<string> = [
  "otelCollectorStatus",
  "agentVersion",
  "lastSeenAt",
  "regionCount",
  "availabilityZoneCount",
  "hypervisorCount",
  "instanceCount",
  "activeInstanceCount",
  "volumeCount",
  "networkCount",
  "routerCount",
  "floatingIpCount",
  "projectCount",
  "serviceCount",
  "downServiceCount",
  "vcpuCapacity",
  "vcpuAllocated",
  "memoryCapacityBytes",
  "memoryAllocatedBytes",
  "storageCapacityBytes",
  "storageUsedBytes",
  "collectionStatus",
  "collectionErrorCode",
  "collectionError",
  "presentedCertificate",
  "collectionSummary",
  "nextCollectionAt",
  "lastCollectionAt",
  "lastSuccessfulCollectionAt",
  "collectionSettingsVersion",
];

@EnableAuditLog({
  create: true,
  update: true,
  delete: true,
  ignoreColumns: OPENSTACK_CLOUD_BOOKKEEPING_COLUMNS,
})
@AccessControlColumn("labels")
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.CreateOpenStackCloud,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadOpenStackCloud,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.DeleteOpenStackCloud,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.EditOpenStackCloud,
  ],
})
@CrudApiEndpoint(new Route("/openstack-cloud"))
@SlugifyColumn("name", "slug")
/*
 * DB-level unique index on (projectId, name) — the @UniqueColumnBy decorator
 * on `name` is app-level only and does not defuse the concurrent
 * find-or-create race at ingest (multiple agent pods discovering the same
 * cloud simultaneously). Mirrors KubernetesCloud's
 * (projectId, cloudIdentifier) unique index.
 */
@Index(["projectId", "name"], { unique: true })
@Index(["projectId", "isArchived"])
/*
 * Restores a UNIQUE index that an autogenerated migration deleted.
 *
 * Declared natively and NAMED. TypeORM's schema builder matches database
 * indexes to entity metadata by name and drops every one it cannot find, which
 * is how the original was lost: it existed only in a migration, so entity
 * metadata never mentioned it and `migration:generate` emitted a DROP. Naming
 * it here keeps the original index name and lets the builder match, compare
 * uniqueness and columns, and keep it.
 */
@Index("IDX_openstack_cloud_slug", ["slug"], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
// A probe asks for its due clouds every ten seconds (OpenStackProbeCollectionStore).
@Index(["collectionProbeId", "nextCollectionAt"])
@TableMetadata({
  tableName: "OpenStackCloud",
  singularName: "OpenStack Cloud",
  pluralName: "OpenStack Clouds",
  icon: IconProp.Cloud,
  tableDescription:
    "OpenStack clouds that are being monitored in this project. Each cloud is auto-discovered when the OneUptime OpenStack Agent sends metrics, or can be manually registered.",
})
@Entity({
  name: "OpenStackCloud",
})
export default class OpenStackCloud extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateOpenStackCloud,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
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
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateOpenStackCloud,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
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
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateOpenStackCloud,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditOpenStackCloud,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "Name of this OpenStack cloud. This is the join key — it must match the openstack.cloud.name OTel resource attribute stamped by the OneUptime OpenStack Agent.",
    example: "production",
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
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
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
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateOpenStackCloud,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Description",
    description: "Friendly description for this OpenStack cloud",
    example: "Production OpenStack cloud running in US East region",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "OTel Collector Status",
    description:
      "Connection status of the OTel Collector agent (connected or disconnected)",
    example: "connected",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "disconnected",
  })
  public otelCollectorStatus?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Agent Version",
    description:
      "Version of the OneUptime OpenStack agent reporting telemetry, as self-reported via the oneuptime.agent.version resource attribute",
    example: "1.0.0",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public agentVersion?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description: "When metrics were last received from this cloud",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Regions",
    description: "How many regions this cloud reports.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public regionCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Availability Zones",
    description: "How many availability zones this cloud reports.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public availabilityZoneCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Hypervisors",
    description: "How many hypervisors this cloud reports.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public hypervisorCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Instances",
    description: "How many instances this cloud reports, in every project.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public instanceCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Active Instances",
    description: "How many instances are ACTIVE.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public activeInstanceCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Volumes",
    description: "How many volumes this cloud reports, in every project.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public volumeCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Networks",
    description: "How many networks this cloud reports, in every project.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public networkCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Routers",
    description: "How many routers this cloud reports, in every project.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public routerCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Floating IPs",
    description: "How many floating IPs this cloud reports.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public floatingIpCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Projects",
    description: "How many OpenStack projects this cloud reports.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public projectCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Services",
    description: "How many services and agents (nova-compute, neutron agents, cinder-volume and so on) this cloud reports.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public serviceCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Services Down",
    description: "How many enabled services and agents are down. A service someone disabled is not counted.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public downServiceCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "vCPU Capacity",
    description: "vCPUs the cloud can promise to instances, as Placement counts them: (total - reserved) * allocation ratio.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public vcpuCapacity?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "vCPUs Allocated",
    description: "vCPUs promised to instances. This is what is promised, not what is busy.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public vcpuAllocated?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.BigPositiveNumber,
    title: "Memory Capacity",
    description: "Memory the cloud can promise to instances, as Placement counts it.",
  })
  @Column({
    type: ColumnType.BigPositiveNumber,
    nullable: true,
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.BigPositiveNumber,
    title: "Memory Allocated",
    description: "Memory promised to instances. This is what is promised, not what is in use.",
  })
  @Column({
    type: ColumnType.BigPositiveNumber,
    nullable: true,
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.BigPositiveNumber,
    title: "Storage Capacity",
    description: "Total size of the cloud's Cinder storage pools.",
  })
  @Column({
    type: ColumnType.BigPositiveNumber,
    nullable: true,
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
  public storageCapacityBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.BigPositiveNumber,
    title: "Storage Used",
    description: "How much of the cloud's Cinder storage pools is used.",
  })
  @Column({
    type: ColumnType.BigPositiveNumber,
    nullable: true,
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
  public storageUsedBytes?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateOpenStackCloud,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
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
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateOpenStackCloud,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateOpenStackCloud,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Archived",
    description:
      "Is this OpenStack cloud archived? Archived OpenStack clouds are hidden from lists but keep collecting telemetry.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isArchived?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Archived At",
    description: "When was this OpenStack cloud archived?",
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
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
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
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
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

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
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
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
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
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateOpenStackCloud,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description: "Labels to group and filter by.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "OpenStackCloudLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "openStackCloudId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateOpenStackCloud,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Retain Telemetry Data For Days",
    description:
      "Number of days to retain telemetry data for this OpenStack cloud. Leave blank to use the project-wide default.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Scale,
    create: PlanType.Scale,
  })
  public retainTelemetryDataForDays?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateOpenStackCloud,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadOpenStackCloud,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditOpenStackCloud,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Telemetry Data Retention Overrides",
    description:
      "Per-pillar retention overrides for this OpenStack cloud (logs by severity, traces by status, metrics, profiles). Unset fields fall back to the OpenStack cloud default, then the project's retention settings.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Scale,
    create: PlanType.Scale,
  })
  public telemetryRetentionConfig?: TelemetryRetentionConfig = undefined;

  /*
   * ---------------------------------------------------------------------
   * Probe collection: no agent, a OneUptime probe reads the cloud's APIs.
   * ---------------------------------------------------------------------
   *
   * A person saves Keystone's address, a read-only credential, the regions and the
   * probe that can reach the cloud. That probe collects the same data the OpenStack
   * agent's exporter sends, every collectionIntervalInMinutes, and ingest treats it
   * exactly like the agent's (OpenStackSnapshotScan, the metric catalog, the alert
   * templates, the AI tools).
   *
   * The settings are edited by whoever may edit the cloud. The secret is write-only:
   * nobody reads it back and the API never returns it, and it is only ever sent to the
   * address, through the probe, and to the certificates it was entered for
   * (OpenStackCollectionSettings.getCredentialRebindRefusal). The status columns after
   * the settings are written by the server and the probe only.
   */
  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(OpenStackCollectionMethod),
    canReadOnRelationQuery: true,
    title: "Collection Method",
    description:
      "How this cloud's data reaches OneUptime. Probe: one of your OneUptime probes reads the cloud's APIs with the credential saved here, with no agent to install. Agent: the OneUptime OpenStack Agent you run sends it. Switching to Agent forgets the saved credential.",
    defaultValue: OpenStackCollectionMethod.Agent,
    example: OpenStackCollectionMethod.Probe,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: OpenStackCollectionMethod.Agent,
  })
  public collectionMethod?: OpenStackCollectionMethod = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Keystone Address",
    description:
      "The HTTPS address of the cloud's Keystone, which the probe logs in at and reads the service catalog from, such as https://keystone.example.com:5000/v3. Stored as https://host[:port][/path], without the version. Changing it asks for the credential again.",
    example: "https://keystone.example.com:5000",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public authUrl?: string = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: [...OPENSTACK_ENDPOINT_INTERFACES],
    title: "Endpoint Interface",
    description:
      "Which of the catalog's addresses the probe uses for each service: public, internal or admin. Most probes sit where public answers. One in the control plane's own network may want internal.",
    defaultValue: DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
    example: DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  })
  public endpointInterface?: OpenStackEndpointInterface = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Collection Regions",
    description:
      'The regions the probe reads, as a JSON array of the names the catalog uses, such as ["RegionOne"]. The connection test lists the ones the catalog names.',
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public collectionRegions?: Array<string> = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: [...OPENSTACK_CREDENTIAL_KINDS],
    title: "Credential Kind",
    description:
      "Which kind of credential the probe logs in with: applicationCredential or password. Worked out from what is written with a new secret, so it can be left out.",
    example: "applicationCredential",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public credentialKind?: OpenStackCredentialKind = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Application Credential ID",
    description:
      "The ID of the Keystone application credential the probe logs in with, the better of the two kinds because it can be limited to reading and can expire. Its secret goes in Credential Secret. Changing it asks for the secret again.",
    example: "aa912b9a1d8446c3a5b5b5a1f0a4c9e1",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public applicationCredentialId?: string = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Keystone User Name",
    description:
      "The Keystone user the probe logs in as, when it logs in with a password instead of an application credential. The password goes in Credential Secret. Changing it asks for the password again.",
    example: "oneuptime-reader",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public keystoneUsername?: string = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "User Domain Name",
    description:
      "The Keystone domain of that user. Default, when left out.",
    example: "Default",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public userDomainName?: string = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Project Name",
    description:
      "The project that user logs in to, when it logs in with a password. An application credential already names its own project.",
    example: "monitoring",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public projectName?: string = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Project Domain Name",
    description:
      "The Keystone domain of that project. Default, when left out.",
    example: "Default",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public projectDomainName?: string = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: [],
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Credential Secret",
    description:
      "The application credential's secret, or the password. Write-only: encrypted at rest, never returned by the API, and sent only to the probe that collects this cloud. Leave it out of an update to keep the saved one. Changing the address or the probe, or trusting another certificate, needs it again.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public credentialSecret?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: OPENSTACK_CLOUD_READERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Credential Saved",
    description:
      "Whether a credential is saved. Set by the server from the secret itself.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isCredentialSet?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: OPENSTACK_CLOUD_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Credential Changed At",
    description: "When the credential was last changed. Set by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public credentialsUpdatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    manyToOneRelationColumn: "collectionProbeId",
    type: TableColumnType.Entity,
    modelType: Probe,
    title: "Collection Probe",
    description:
      "The OneUptime probe that collects this cloud: one of this project's own probes, in a network that can reach the cloud's APIs (on a self-hosted install, the instance's own probes may be picked too).",
  })
  @ManyToOne(
    () => {
      return Probe;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "collectionProbeId" })
  public collectionProbe?: Probe = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Collection Probe ID",
    description:
      "ID of the OneUptime probe that collects this cloud. Changing it asks for the credential again.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public collectionProbeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Trusted Certificate Fingerprints",
    description:
      "The SHA-256 fingerprints of the certificates the probe accepts from this cloud's APIs, as a JSON array, for APIs whose certificates are not from a public authority. More than one, because each service can have a host and a certificate of its own. Empty: every certificate must be signed by an authority the probe's machine trusts. Verification is never skipped. Trusting another certificate asks for the credential again.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public trustedCertificateFingerprints?: Array<string> = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "Collection Interval (Minutes)",
    description:
      "How often the probe collects this cloud, in whole minutes from 1 to 60. Two minutes is the OpenStack agent's own default. Collect large clouds less often to go easier on their APIs.",
    defaultValue: DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
    example: DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: DEFAULT_OPENSTACK_COLLECTION_INTERVAL_IN_MINUTES,
  })
  public collectionIntervalInMinutes?: number = undefined;

  @ColumnAccessControl({
    create: OPENSTACK_CLOUD_CREATORS,
    read: OPENSTACK_CLOUD_READERS,
    update: OPENSTACK_CLOUD_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Collection Options",
    description:
      "What the probe reads beyond the agent's defaults, as JSON. collectPorts reads ports, scoped by portNetworkIds and portProjectIds and paged. collectProjectLimits reads each project's quotas, four calls per project. Both are off unless asked for.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public collectionOptions?: OpenStackCollectionOptions = undefined;

  @ColumnAccessControl({
    create: [],
    read: OPENSTACK_CLOUD_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(OpenStackCollectionStatus),
    title: "Collection Status",
    description:
      "Where probe collection stands: Pending (the probe has not tried the current settings yet), Succeeded, PartiallySucceeded (some of the cloud could not be read) or Failed. Written by the server and the probe.",
    example: OpenStackCollectionStatus.Succeeded,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public collectionStatus?: OpenStackCollectionStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: OPENSTACK_CLOUD_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(OpenStackCollectionErrorCode),
    title: "Collection Error Code",
    description:
      "Why the last collection failed or was partial, as a code the dashboard turns into a next step (InvalidCredential, UntrustedCertificate, ConnectionTimedOut, ...). Written by the probe.",
    example: OpenStackCollectionErrorCode.InvalidCredential,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public collectionErrorCode?: OpenStackCollectionErrorCode = undefined;

  @ColumnAccessControl({
    create: [],
    read: OPENSTACK_CLOUD_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Collection Error",
    description:
      "What went wrong in the last collection, in words. Written by the probe.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public collectionError?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: OPENSTACK_CLOUD_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Presented Certificate",
    description:
      "The certificate an API presented when the last collection did not trust it: its SHA-256 fingerprint, subject, issuer, validity and the host that showed it, so a person can check it and trust exactly that certificate. Written by the probe.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public presentedCertificate?: OpenStackPresentedCertificate = undefined;

  @ColumnAccessControl({
    create: [],
    read: OPENSTACK_CLOUD_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Collection Summary",
    description:
      "What the last collection found: the regions, how each service answered, how many hypervisors, instances, networks, volumes and projects it read, and what it left out. Written by the probe.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public collectionSummary?: OpenStackCollectionSummary = undefined;

  @ColumnAccessControl({
    create: [],
    read: OPENSTACK_CLOUD_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Next Collection At",
    description:
      "When the probe collects this cloud next. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextCollectionAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: OPENSTACK_CLOUD_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Collection At",
    description:
      "When the probe last tried to collect this cloud, whether it worked or not. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastCollectionAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: OPENSTACK_CLOUD_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Successful Collection At",
    description:
      "When a collection of this cloud last worked, in full or in part. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastSuccessfulCollectionAt?: Date = undefined;

  /*
   * Counts every change to the connection settings. A probe is handed the version it
   * collects with and reports it back, so a collection that started before a person
   * fixed the credential cannot report the old failure over the new settings.
   */
  @ColumnAccessControl({
    create: [],
    read: OPENSTACK_CLOUD_READERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "Collection Settings Version",
    description:
      "Counts changes to the probe collection settings, so a report from a collection that started before a change is not shown as the current status. Written by the server.",
    defaultValue: 0,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public collectionSettingsVersion?: number = undefined;
}
