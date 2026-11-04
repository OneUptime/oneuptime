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
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import OpenStackCollectionErrorCode from "../../Types/OpenStack/OpenStackCollectionError";
import OpenStackConnectionTestStatus from "../../Types/OpenStack/OpenStackConnectionTestStatus";
import {
  DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  OPENSTACK_CREDENTIAL_KINDS,
  OPENSTACK_ENDPOINT_INTERFACES,
  OpenStackConnectionTestSummary,
  OpenStackCredentialKind,
  OpenStackEndpointInterface,
  OpenStackPresentedCertificate,
} from "../../Types/OpenStack/OpenStackProbeCollection";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Who tests a cloud's connection: whoever may connect a cloud or change one's connection.
 * Only they read the result, because it says what a probe could reach on their network.
 */
const TESTERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateOpenStackCloud,
  Permission.EditOpenStackCloud,
];

/*
 * "Test connection" in the dashboard's cloud form: the address, credential, regions and
 * certificates a person is about to save, tried by the probe they picked, before anything
 * is saved on a cloud.
 *
 * A test is a short-lived request. The probe asks for work every ten seconds and is handed
 * the pending tests that name it, the secret is wiped from the row the moment the probe is
 * handed it, and tests are deleted a day after they were started. The dashboard polls the
 * row until the probe reports Succeeded (with what the credential may read, service by
 * service) or Failed (with exactly why, and, for a certificate that is not trusted, the
 * certificate, so it can be trusted).
 *
 * A test of a cloud that is already set up may leave the secret out: the cloud's saved
 * credential is used, under the same rule as an update, so only for the address, probe and
 * certificates it was saved for.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: TESTERS,
  read: TESTERS,
  delete: TESTERS,
  update: [],
})
@CrudApiEndpoint(new Route("/openstack-cloud-connection-test"))
@Entity({
  name: "OpenStackCloudConnectionTest",
})
@TableMetadata({
  tableName: "OpenStackCloudConnectionTest",
  singularName: "OpenStack Connection Test",
  pluralName: "OpenStack Connection Tests",
  icon: IconProp.Cloud,
  tableDescription:
    "Tests of a cloud's address and read-only credential, run by the probe that will collect it, before the connection is saved.",
})
@Index(["probeId", "status"])
export default class OpenStackCloudConnectionTest extends BaseModel {
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
    manyToOneRelationColumn: "openStackCloudId",
    type: TableColumnType.Entity,
    modelType: OpenStackCloud,
    title: "OpenStack Cloud",
    description:
      "The cloud whose connection is being changed, when the test is for one that already exists. Its saved credential is used when the test carries no secret.",
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
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "OpenStack Cloud ID",
    description:
      "ID of the cloud whose connection is being changed, when the test is for one that already exists.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public openStackCloudId?: ObjectID = undefined;

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
    title: "Keystone Address",
    description:
      "The Keystone address being tested, as https://host[:port][/path].",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public authUrl?: string = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: [...OPENSTACK_ENDPOINT_INTERFACES],
    title: "Endpoint Interface",
    description:
      "Which of the catalog's addresses the test uses for each service: public, internal or admin.",
    defaultValue: DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: DEFAULT_OPENSTACK_ENDPOINT_INTERFACE,
  })
  public endpointInterface?: OpenStackEndpointInterface = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Collection Regions",
    description:
      "The regions the test checks, as a JSON array of names. Empty: every region the catalog names.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public collectionRegions?: Array<string> = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: [...OPENSTACK_CREDENTIAL_KINDS],
    title: "Credential Kind",
    description:
      "Which kind of credential is being tested: applicationCredential or password. Worked out from what the test carries.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public credentialKind?: OpenStackCredentialKind = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Application Credential ID",
    description: "The ID of the application credential being tested.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public applicationCredentialId?: string = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Keystone User Name",
    description:
      "The Keystone user being tested, when the test logs in with a password.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public keystoneUsername?: string = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "User Domain Name",
    description: "The Keystone domain of that user.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public userDomainName?: string = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Project Name",
    description:
      "The project that user logs in to, when the test logs in with a password.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public projectName?: string = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Project Domain Name",
    description: "The Keystone domain of that project.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public projectDomainName?: string = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Credential Secret",
    description:
      "The secret or password being tested. Write-only, encrypted at rest, and wiped as soon as the probe is handed the test.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public credentialSecret?: string = undefined;

  @ColumnAccessControl({
    create: TESTERS,
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Trusted Certificate Fingerprints",
    description:
      "The SHA-256 fingerprints of the certificates the test accepts from the cloud's APIs, when they are not from a public authority.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public trustedCertificateFingerprints?: Array<string> = undefined;

  @ColumnAccessControl({
    create: [],
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(OpenStackConnectionTestStatus),
    title: "Status",
    description:
      "Pending (waiting for the probe), Running, Succeeded or Failed. Written by the server and the probe.",
    forceGetDefaultValueOnCreate: (): OpenStackConnectionTestStatus => {
      return OpenStackConnectionTestStatus.Pending;
    },
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: OpenStackConnectionTestStatus.Pending,
  })
  public status?: OpenStackConnectionTestStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: TESTERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(OpenStackCollectionErrorCode),
    title: "Error Code",
    description:
      "Why the test failed, as a code (InvalidCredential, UntrustedCertificate, ...).",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public errorCode?: OpenStackCollectionErrorCode = undefined;

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
      "The certificate an API presented when the test did not trust it.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public presentedCertificate?: OpenStackPresentedCertificate = undefined;

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
      "What the test found: the regions and services in the catalog, what the credential may read service by service, and the level that adds up to. A failed test says what it found before it stopped.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public summary?: OpenStackConnectionTestSummary = undefined;

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
