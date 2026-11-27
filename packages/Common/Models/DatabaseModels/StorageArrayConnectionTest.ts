import Probe from "./Probe";
import Project from "./Project";
import StorageArrayConnection from "./StorageArrayConnection";
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
import StorageArrayCollectionErrorCode from "../../Types/StorageArray/Collection/StorageArrayCollectionErrorCode";
import StorageArrayConnectionTestStatus from "../../Types/StorageArray/Collection/StorageArrayConnectionTestStatus";
import {
  StorageArrayCollectionSummary,
  StorageArrayPresentedCertificate,
} from "../../Types/StorageArray/Collection/StorageArrayProbeCollection";
import StorageArrayProbeCollectors from "../../Types/StorageArray/Collection/StorageArrayProbeCollectors";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Who tests a storage array connection: whoever may connect one or change
 * one. Only they read the result - it says what a probe could reach on
 * their network.
 */
const TESTERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateStorageArray,
  Permission.EditStorageArray,
];

/*
 * "Test connection" in the dashboard's Connect form: the address, account
 * and certificate a person is about to save, tried by the probe they
 * picked, before anything is saved - as VMwareVCenterConnectionTest does
 * for a vCenter.
 *
 * A test is a short-lived request. The probe asks for work every ten
 * seconds and is handed the pending tests that name it; the password is
 * wiped from the row the moment the probe is handed it, and tests are
 * deleted a day after they were started. The dashboard polls the row until
 * the probe reports Succeeded (with what it found: the server's version,
 * each array it manages, how much of it the account can see and whether
 * its performance is collected) or Failed (with exactly why, and - for a
 * certificate that is not trusted - the certificate, so it can be trusted).
 *
 * A test of a connection that is already set up may leave the password
 * out: the saved one is used, under the same rule as an update - only for
 * the address, probe and certificate it was saved for.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: TESTERS,
  read: TESTERS,
  delete: TESTERS,
  update: [],
})
@CrudApiEndpoint(new Route("/storage-array-connection-test"))
@Entity({
  name: "StorageArrayConnectionTest",
})
@TableMetadata({
  tableName: "StorageArrayConnectionTest",
  singularName: "Storage Array Connection Test",
  pluralName: "Storage Array Connection Tests",
  icon: IconProp.StorageArray,
  tableDescription:
    "Tests of a storage management server's address and read-only account, run by the probe that will read it, before the connection is saved.",
})
@Index(["probeId", "status"])
export default class StorageArrayConnectionTest extends BaseModel {
  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
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
    create: TESTERS,
    read: TESTERS,
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
    create: TESTERS,
    read: TESTERS,
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
    create: TESTERS,
    read: TESTERS,
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
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "storageArrayConnectionId",
    type: TableColumnType.Entity,
    modelType: StorageArrayConnection,
    title: "Connection",
    description:
      "The saved connection this test is for, when it tests one (its saved password is used when none is typed).",
  })
  @ManyToOne(
    () => {
      return StorageArrayConnection;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "storageArrayConnectionId" })
  public storageArrayConnection?: StorageArrayConnection = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Connection ID",
    description: "ID of the saved connection this test is for, if any.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public storageArrayConnectionId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "probeId",
    type: TableColumnType.Entity,
    modelType: Probe,
    title: "Probe",
    description: "The probe that runs the test: the one that will collect.",
  })
  @ManyToOne(
    () => {
      return Probe;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "probeId" })
  public probe?: Probe = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Probe ID",
    description: "ID of the probe that runs the test.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public probeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: StorageArrayProbeCollectors.getStorageSystems(),
    title: "Platform",
    description:
      "The storage platform the server manages, which picks the probe's poller: dell.powermax for Unisphere for PowerMax.",
    defaultValue: StorageArrayProbeCollectors.getDefault().storageSystem,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: StorageArrayProbeCollectors.getDefault().storageSystem,
  })
  public storageSystem?: string = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Address",
    description: "The HTTPS address being tested, normalized to https://host:port.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public address?: string = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "User Name",
    description: "The user name being tested.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public username?: string = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Password",
    description:
      "The password being tested. Write-only, encrypted at rest, and wiped as soon as the probe is handed the test.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public password?: string = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Trusted Certificate Fingerprint",
    description:
      "The SHA-256 fingerprint of the certificate the test accepts from the server, when its certificate is not from a public authority.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public trustedCertificateFingerprint?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description:
      "Pending until the probe takes the test, Running while it connects, then Succeeded or Failed.",
    defaultValue: StorageArrayConnectionTestStatus.Pending,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: StorageArrayConnectionTestStatus.Pending,
  })
  public status?: StorageArrayConnectionTestStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Error Code",
    description: "Why the test failed, as a code.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public errorCode?: StorageArrayCollectionErrorCode = undefined;

  @ColumnAccessControl({
    create: [],
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Error Message",
    description: "Why the test failed, in words.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public errorMessage?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Presented Certificate",
    description:
      "The certificate the server presented when the test did not trust it, so it can be checked and trusted.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public presentedCertificate?: StorageArrayPresentedCertificate = undefined;

  @ColumnAccessControl({
    create: [],
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Summary",
    description:
      "What the test found: the server's version, each array behind it, how much the account can see on each, and whether its performance is collected.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public summary?: StorageArrayCollectionSummary = undefined;

  @ColumnAccessControl({
    create: [],
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Claimed At",
    description: "When the probe took the test.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public claimedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Completed At",
    description: "When the probe reported the test's outcome.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public completedAt?: Date = undefined;
}
