import Probe from "./Probe";
import Project from "./Project";
import User from "./User";
import VMwareVCenter from "./VMwareVCenter";
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
import VMwareCollectionErrorCode from "../../Types/VMware/VMwareCollectionError";
import VMwareConnectionTestStatus from "../../Types/VMware/VMwareConnectionTestStatus";
import {
  VMwareCollectionSummary,
  VMwarePresentedCertificate,
} from "../../Types/VMware/VMwareProbeCollection";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Who tests a vCenter connection: whoever may connect a vCenter or change
 * one's connection. Only they read the result - it says what a probe could
 * reach on their network.
 */
const TESTERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateVMwareVCenter,
  Permission.EditVMwareVCenter,
];

/*
 * "Test connection" in the dashboard's vCenter form: the address, account
 * and certificate a person is about to save, tried by the probe they picked,
 * before anything is saved on a vCenter.
 *
 * A test is a short-lived request. The probe asks for work every fifteen
 * seconds and is handed the pending tests that name it; the password is
 * wiped from the row the moment the probe is handed it, and tests are
 * deleted a day after they were started. The dashboard polls the row until
 * the probe reports Succeeded (with what it found: vCenter's version and how
 * much inventory the user can see) or Failed (with exactly why, and - for a
 * certificate that is not trusted - the certificate, so it can be trusted).
 *
 * A test of a vCenter that is already set up may leave the password out: the
 * vCenter's saved password is used, under the same rule as an update - only
 * for the address, probe and certificate it was saved for.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: TESTERS,
  read: TESTERS,
  delete: TESTERS,
  update: [],
})
@CrudApiEndpoint(new Route("/vmware-vcenter-connection-test"))
@Entity({
  name: "VMwareVCenterConnectionTest",
})
@TableMetadata({
  tableName: "VMwareVCenterConnectionTest",
  singularName: "vCenter Connection Test",
  pluralName: "vCenter Connection Tests",
  icon: IconProp.VMware,
  tableDescription:
    "Tests of a vCenter's address and read-only account, run by the probe that will collect it, before the connection is saved.",
})
@Index(["probeId", "status"])
export default class VMwareVCenterConnectionTest extends BaseModel {
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
    create: [],
    read: [],
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
    read: [],
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
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "vmwareVCenterId",
    type: TableColumnType.Entity,
    modelType: VMwareVCenter,
    title: "vCenter",
    description:
      "The vCenter whose connection is being changed, when the test is for one that already exists. Its saved password is used when the test carries none.",
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
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "vCenter ID",
    description:
      "ID of the vCenter whose connection is being changed, when the test is for one that already exists.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public vmwareVCenterId?: ObjectID = undefined;

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
    description: "The probe that runs the test.",
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
    required: true,
    type: TableColumnType.LongText,
    title: "vCenter Address",
    description: "The vCenter address being tested, as https://host[:port].",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public vcenterUrl?: string = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "vCenter User Name",
    description: "The vSphere user name being tested.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public vcenterUsername?: string = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "vCenter Password",
    description:
      "The password being tested. Write-only, encrypted at rest, and wiped as soon as the probe is handed the test.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public vcenterPassword?: string = undefined;

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
      "The SHA-256 fingerprint of the certificate the test accepts from vCenter, when vCenter's certificate is not from a public authority.",
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
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description:
      "Pending (waiting for the probe), Running, Succeeded or Failed. Written by the server and the probe.",
    forceGetDefaultValueOnCreate: (): VMwareConnectionTestStatus => {
      return VMwareConnectionTestStatus.Pending;
    },
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: VMwareConnectionTestStatus.Pending,
  })
  public status?: VMwareConnectionTestStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Error Code",
    description:
      "Why the test failed, as a code (InvalidLogin, UntrustedCertificate, ...).",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public errorCode?: VMwareCollectionErrorCode = undefined;

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
      "The certificate vCenter presented when the test did not trust it.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public presentedCertificate?: VMwarePresentedCertificate = undefined;

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
      "What a successful test found: vCenter's version, and how much of its inventory the user can see.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public summary?: VMwareCollectionSummary = undefined;

  @ColumnAccessControl({
    create: [],
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Claimed At",
    description: "When the probe picked the test up.",
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
    description: "When the test finished.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public completedAt?: Date = undefined;
}
