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
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import StorageArrayCollectionErrorCode from "../../Types/StorageArray/Collection/StorageArrayCollectionErrorCode";
import StorageArrayCollectionStatus from "../../Types/StorageArray/Collection/StorageArrayCollectionStatus";
import {
  StorageArrayCollectionSummary,
  StorageArrayPresentedCertificate,
} from "../../Types/StorageArray/Collection/StorageArrayProbeCollection";
import StorageArrayProbeCollectors from "../../Types/StorageArray/Collection/StorageArrayProbeCollectors";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Who may see, connect, change and remove a storage array connection: the
 * people who may do the same to a storage array, since one connection adds
 * every array behind it.
 */
const CONNECTION_CREATORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateStorageArray,
];

const CONNECTION_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadStorageArray,
];

const CONNECTION_EDITORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditStorageArray,
];

const CONNECTION_DELETERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.DeleteStorageArray,
];

/*
 * A STORAGE MANAGEMENT SERVER A PROBE READS ARRAYS FROM (#11004): a Unisphere
 * for PowerMax, which manages many arrays at once.
 *
 * A person saves its address and a read-only account (Unisphere's Monitor
 * and PerfMonitor roles) and picks a probe that can reach it; every
 * collectionIntervalInMinutes that probe reads each array the server
 * manages and sends their metrics in the platform's shape, and each array
 * appears in Storage Arrays as an agent-sent one would (StorageArrayProbe
 * Collection). This follows VMware's agentless collection: the password is
 * write-only - nobody reads it back and the API never returns it - and is
 * only ever sent to the address, through the probe, and to the certificate
 * it was entered for (StorageArrayConnectionSettings.getPasswordRebindRefusal).
 * The status columns after the settings are written by the server and the
 * probe only.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: CONNECTION_CREATORS,
  read: CONNECTION_READERS,
  delete: CONNECTION_DELETERS,
  update: CONNECTION_EDITORS,
})
@CrudApiEndpoint(new Route("/storage-array-connection"))
@Entity({
  name: "StorageArrayConnection",
})
@TableMetadata({
  tableName: "StorageArrayConnection",
  singularName: "Storage Array Connection",
  pluralName: "Storage Array Connections",
  icon: IconProp.StorageArray,
  tableDescription:
    "Storage management servers, such as Unisphere for PowerMax, that a OneUptime probe reads every storage array from with a read-only account.",
})
@Index(["projectId", "name"], { unique: true })
@Index(["collectionProbeId", "nextCollectionAt"])
export default class StorageArrayConnection extends BaseModel {
  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
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
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
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
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
    update: CONNECTION_EDITORS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "How this connection is named in OneUptime. Defaults to the server's host name.",
    example: "unisphere-prod",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
    update: CONNECTION_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "A note about this connection.",
    example: "Unisphere for PowerMax of the primary datacenter",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: StorageArrayProbeCollectors.getStorageSystems(),
    canReadOnRelationQuery: true,
    title: "Platform",
    description:
      "The storage platform the server manages, as its arrays' storage.system: dell.powermax for Unisphere for PowerMax. Set when the connection is made.",
    defaultValue: StorageArrayProbeCollectors.getDefault().storageSystem,
    example: "dell.powermax",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: StorageArrayProbeCollectors.getDefault().storageSystem,
  })
  public storageSystem?: string = undefined;

  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
    update: CONNECTION_EDITORS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Address",
    description:
      "The HTTPS address of the management server the probe connects to, such as https://unisphere.example.com:8443. Stored as https://host:port; a path such as /univmax is dropped. Changing it asks for the password again.",
    example: "https://unisphere.example.com:8443",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public address?: string = undefined;

  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
    update: CONNECTION_EDITORS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "User Name",
    description:
      "The read-only user the probe logs in as. On Unisphere for PowerMax, a user with the Monitor role, and the PerfMonitor role for performance.",
    example: "oneuptime",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public username?: string = undefined;

  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: [],
    update: CONNECTION_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Password",
    description:
      "The user's password. Write-only: encrypted at rest, never returned by the API, and sent only to the probe that collects this connection. Leave it out of an update to keep the saved one; changing the address, the probe or the trusted certificate needs it again.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public password?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Password Saved",
    description:
      "Whether a password is saved. Set by the server from the password itself.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isPasswordSet?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Credentials Changed At",
    description:
      "When the user name or password was last changed. Set by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public credentialsUpdatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
    update: CONNECTION_EDITORS,
  })
  @TableColumn({
    manyToOneRelationColumn: "collectionProbeId",
    type: TableColumnType.Entity,
    modelType: Probe,
    title: "Collection Probe",
    description:
      "The OneUptime probe that reads this server: one of this project's own probes, in a network that reaches it (on a self-hosted install, the instance's own probes may be picked too).",
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
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
    update: CONNECTION_EDITORS,
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Collection Probe ID",
    description:
      "ID of the OneUptime probe that reads this server. Changing it asks for the password again.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public collectionProbeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
    update: CONNECTION_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Trusted Certificate Fingerprint",
    description:
      "The SHA-256 fingerprint of the one certificate the probe accepts from the server, for a server whose certificate is not from a public authority (Unisphere's own, by default). Empty: the certificate must be signed by an authority the probe's machine trusts. Verification is never skipped. Trusting a different certificate asks for the password again.",
    example:
      "3A:7F:12:9C:4B:D0:55:E1:08:6A:B2:C3:91:F4:27:8E:6D:0B:A5:C8:13:4E:F9:72:B6:5D:0A:E3:29:C1:7B:44",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public trustedCertificateFingerprint?: string = undefined;

  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
    update: CONNECTION_EDITORS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "Collection Interval (Minutes)",
    description:
      "How often the probe reads the server, in whole minutes: 5 or 10 for Unisphere for PowerMax, which computes performance every 5 minutes.",
    defaultValue: 5,
    example: 5,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 5,
  })
  public collectionIntervalInMinutes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Collection Status",
    description:
      "Where collection stands: Pending (the probe has not tried the current settings yet), Succeeded or Failed. Written by the server and the probe.",
    example: StorageArrayCollectionStatus.Succeeded,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public collectionStatus?: StorageArrayCollectionStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Collection Error Code",
    description:
      "Why the last collection failed, as a code the dashboard turns into a next step (InvalidLogin, UntrustedCertificate, MissingRole, ...). Written by the probe.",
    example: StorageArrayCollectionErrorCode.InvalidLogin,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public collectionErrorCode?: StorageArrayCollectionErrorCode = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
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
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Presented Certificate",
    description:
      "The certificate the server presented when the last collection did not trust it: its SHA-256 fingerprint, subject, issuer and validity, so a person can check it and trust exactly that certificate. Written by the probe.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public presentedCertificate?: StorageArrayPresentedCertificate = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Collection Summary",
    description:
      "What the last successful collection found: the server's product and version, each array behind it with its model, version and inventory counts, whether the server collects its performance, and what could not be read. Written by the probe.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public collectionSummary?: StorageArrayCollectionSummary = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Next Collection At",
    description: "When the probe reads the server next. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextCollectionAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Collection At",
    description:
      "When the probe last tried to read the server, whether it worked or not. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastCollectionAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Successful Collection At",
    description:
      "When the probe last read the server successfully. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastSuccessfulCollectionAt?: Date = undefined;

  /*
   * Counts every change to the connection settings. A probe is handed the
   * version it collects with and reports it back, so a collection that
   * started before a person fixed the password cannot report the old
   * failure over the new settings.
   */
  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "Collection Settings Version",
    description:
      "Counts changes to the collection settings, so a report from a collection that started before a change is not shown as the current status. Written by the server.",
    defaultValue: 0,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public collectionSettingsVersion?: number = undefined;

  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
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
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
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
}
