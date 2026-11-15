import OpenStackCloud from "./OpenStackCloud";
import Probe from "./Probe";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES,
  DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
  OpenStackApiCheckResult,
  OpenStackLifecycleCheckOptions,
  OpenStackLifecycleRecords,
} from "../../Types/OpenStack/OpenStackCheck";
import {
  DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  OPENSTACK_CREDENTIAL_KINDS,
  OPENSTACK_ENDPOINT_INTERFACES,
  OpenStackCredentialKind,
  OpenStackEndpointInterface,
} from "../../Types/OpenStack/OpenStackProbeCollection";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Who reads, sets up and removes a cloud's checks: whoever may do the same to the cloud.
 */
const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadOpenStackCloud,
];

const CREATORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateOpenStackCloud,
];

const EDITORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditOpenStackCloud,
];

/*
 * The columns a probe's reports and the server rewrite on their own, every minute. The audit log
 * records what people change, and recording these would bury it.
 */
export const OPENSTACK_CLOUD_CHECK_BOOKKEEPING_COLUMNS: Array<string> = [
  "nextApiCheckAt",
  "lastApiCheckAt",
  "apiCheckResult",
  "nextLifecycleCheckAt",
  "lastLifecycleCheckAt",
  "lifecycleRecords",
  "pinnedLifecycleProjectId",
  "settingsVersion",
  "checkError",
];

/*
 * WHAT A PROBE CHECKS FROM OUTSIDE AN OPENSTACK CLOUD, AND WITH WHAT.
 *
 * One row per cloud, once someone turns a check on: see Types/OpenStack/OpenStackCheck. Beside the
 * cloud and not on it, because a report rewrites this every minute, and a cloud's row is read by
 * everything.
 *
 * It holds a credential of its own, under the same rules as a cloud's (OpenStackCloudConnection):
 * write-only, encrypted at rest, sent only to the probe it was entered for, and only to the Keystone
 * and the certificates it was entered for. The lifecycle check only ever runs with this one, because
 * it writes, and what it may write with is held to OpenStackCheckGuard before each run.
 */
@EnableAuditLog({
  create: true,
  update: true,
  delete: true,
  ignoreColumns: OPENSTACK_CLOUD_CHECK_BOOKKEEPING_COLUMNS,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: CREATORS,
  read: READERS,
  delete: EDITORS,
  update: EDITORS,
})
@CrudApiEndpoint(new Route("/openstack-cloud-check"))
/*
 * A probe asks for its due checks of each kind every ten seconds (OpenStackCheckStore): those that
 * name it are a range of these, oldest first, that stops at the claim's limit.
 */
@Index(["probeId", "nextApiCheckAt"])
@Index(["probeId", "nextLifecycleCheckAt"])
@Entity({
  name: "OpenStackCloudCheck",
})
@TableMetadata({
  tableName: "OpenStackCloudCheck",
  singularName: "OpenStack Cloud Check",
  pluralName: "OpenStack Cloud Checks",
  icon: IconProp.Cloud,
  tableDescription:
    "The API checks and the instance lifecycle check a probe runs against an OpenStack cloud from outside it, and what they last found.",
})
export default class OpenStackCloudCheck extends BaseModel {
  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
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
    create: CREATORS,
    read: READERS,
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
    create: CREATORS,
    read: READERS,
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
    create: CREATORS,
    read: READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
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
    read: READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted by User",
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
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
    read: READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
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
    create: CREATORS,
    read: READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "openStackCloudId",
    type: TableColumnType.Entity,
    modelType: OpenStackCloud,
    title: "OpenStack Cloud",
    description: "The cloud these checks are of.",
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
    create: CREATORS,
    read: READERS,
    update: [],
  })
  @Index({ unique: true })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "OpenStack Cloud ID",
    description:
      "ID of the cloud these checks are of. A cloud has one row of these.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public openStackCloudId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    manyToOneRelationColumn: "probeId",
    type: TableColumnType.Entity,
    modelType: Probe,
    title: "Probe",
    description:
      "The probe that runs these checks, outside the cloud: one of this project's own probes (on a self-hosted install, the instance's own probes may be picked too). Left empty: the probe that collects this cloud.",
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
  @JoinColumn({ name: "probeId" })
  public probe?: Probe = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Probe ID",
    description:
      "ID of the probe that runs these checks. Changing it asks for the credential again.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public probeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Auth URL",
    description:
      "Keystone's address, as your clouds.yaml or openrc has it, for a cloud a probe does not collect. Left empty: the address this cloud is collected from. Changing it asks for the credential again.",
    example: "https://keystone.example.com:5000/v3",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public authUrl?: string = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: [...OPENSTACK_ENDPOINT_INTERFACES],
    title: "Endpoint Interface",
    description:
      "Which of the catalog's URLs to check, for a cloud a probe does not collect. Left empty: the one this cloud is collected on.",
    example: DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public endpointInterface?: OpenStackEndpointInterface = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Regions",
    description:
      "The regions to check, as a JSON array, for a cloud a probe does not collect. Empty: every region the catalog names.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public regions?: Array<string> = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Trusted Certificate Fingerprints",
    description:
      "The SHA-256 fingerprints of the certificates these checks accept, as a JSON array, for a cloud a probe does not collect. Empty: every certificate must be signed by an authority the probe's machine trusts. Verification is never skipped. Trusting another certificate asks for the credential again.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public trustedCertificateFingerprints?: Array<string> = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: [...OPENSTACK_CREDENTIAL_KINDS],
    title: "Credential Kind",
    description:
      "applicationCredential or password. An application credential is better: it cannot be scoped to any other project.",
    example: "applicationCredential",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public credentialKind?: OpenStackCredentialKind = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Application Credential ID",
    description: "The application credential these checks log in with.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public applicationCredentialId?: string = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Username",
    description: "The user these checks log in as, for a password.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public keystoneUsername?: string = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "User Domain Name",
    description: "The Keystone domain of that user. Default, when left out.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public userDomainName?: string = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Credential Project Name",
    description:
      "The project that password logs in to. An application credential is scoped to its project when it is made.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public credentialProjectName?: string = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Credential Project Domain Name",
    description: "The Keystone domain of that project. Default, when left out.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public credentialProjectDomainName?: string = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: [],
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Credential Secret",
    description:
      "The application credential's secret, or the password. Write-only: encrypted at rest, never returned by the API, and sent only to the probe that runs these checks. Leave it out of an update to keep the saved one. Changing the address or the probe, or trusting another certificate, needs it again.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public credentialSecret?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Credential Saved",
    description:
      "Whether a secret is saved. Written by the server: the secret itself is never returned.",
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
    read: READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Credentials Updated At",
    description: "When the credential last changed. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public credentialsUpdatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Credential Binding",
    description:
      "Which Keystone, probe and certificates the saved credential was entered for. It is only ever sent there. Written by the server.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public credentialBinding?: JSONObject = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "API Checks On",
    description:
      "Whether a probe checks, from outside the cloud, that Keystone issues a token, that each service in the catalog answers, and when each endpoint's certificate expires. Read-only.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isApiCheckEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "API Check Interval In Minutes",
    description: "How often the API checks run: every 1, 2 or 5 minutes.",
    defaultValue: DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: DEFAULT_OPENSTACK_API_CHECK_INTERVAL_IN_MINUTES,
  })
  public apiCheckIntervalInMinutes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Next API Check At",
    description: "When the API checks are next due. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextApiCheckAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last API Check At",
    description:
      "When a probe last reported the API checks. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastApiCheckAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "API Check Result",
    description:
      "What the API checks last found, service by service. Written by the server, from what the probe reported.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public apiCheckResult?: OpenStackApiCheckResult = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Lifecycle Check On",
    description:
      "Whether a probe creates a server in this check's project, waits for it, and deletes it, to find out whether anyone can. It turns the API checks on too, because they are what keeps its series coming between runs.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isLifecycleCheckEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "Lifecycle Check Interval In Minutes",
    description:
      "How often the lifecycle check runs: every 15 minutes to every 24 hours.",
    defaultValue: DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: DEFAULT_OPENSTACK_LIFECYCLE_CHECK_INTERVAL_IN_MINUTES,
  })
  public lifecycleCheckIntervalInMinutes?: number = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Lifecycle Project Name",
    description:
      "The project the lifecycle check has to itself. A token for any other project is refused before anything is written.",
    example: "oneuptime-checks",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public lifecycleProjectName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Pinned Lifecycle Project ID",
    description:
      "That project's ID, once a run has verified it. A token for a project of the same name with another ID is refused too. Written by the server.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public pinnedLifecycleProjectId?: string = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Lifecycle Check Options",
    description:
      "What the lifecycle check boots and does, as JSON: flavor, image, network, isFloatingIpEnabled, floatingIpNetwork, isVolumeEnabled, volumeSizeInGiB, volumeType. What is left out is chosen at each run.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public lifecycleCheckOptions?: OpenStackLifecycleCheckOptions = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Next Lifecycle Check At",
    description: "When the lifecycle check is next due. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextLifecycleCheckAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Lifecycle Check At",
    description:
      "When a probe last reported a lifecycle run. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastLifecycleCheckAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Lifecycle Run Requested At",
    description:
      "Set it to run the lifecycle check as soon as a probe can, whenever it is next due.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lifecycleRunRequestedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Lifecycle Records",
    description:
      "What the lifecycle check last found in each region, step by step, and its recent runs. Written by the server, from what the probe reported.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public lifecycleRecords?: OpenStackLifecycleRecords = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Sweep Pending",
    description:
      "The lifecycle check was turned off, and the probe is still clearing up what it made, until nothing named for it is left. Written by the server.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isSweepPending?: boolean = undefined;

  @ColumnAccessControl({
    create: CREATORS,
    read: [],
    update: EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "OSProfiler Key",
    description:
      "A key in your services' hmac_keys. With it, a lifecycle run signs its writes, so a slow boot has a trace. Write-only: encrypted at rest, never returned by the API, and sent only to the probe that runs these checks. Anyone holding it can make any request traced.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public osProfilerKey?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "OSProfiler Key Saved",
    description:
      "Whether an OSProfiler key is saved. Written by the server: the key itself is never returned.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isOsProfilerKeySet?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "Settings Version",
    description:
      "Moves on each time these settings change, so a report of older settings never overwrites what newer ones found. Written by the server.",
    defaultValue: 0,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public settingsVersion?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Check Error",
    description:
      "Why these checks are not running, when something other than the cloud stops them. Written by the server.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public checkError?: string = undefined;
}
