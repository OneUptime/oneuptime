import EnableAuditLog from "../../Types/Database/EnableAuditLog";
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
import XcpNgCollectionErrorCode from "../../Types/XcpNg/XcpNgCollectionError";
import XcpNgCollectionStatus from "../../Types/XcpNg/XcpNgCollectionStatus";
import XcpNgConnectionType from "../../Types/XcpNg/XcpNgConnectionType";
import {
  XcpNgCollectionSummary,
  XcpNgMessageWatermark,
  XcpNgPresentedCertificate,
  XcpNgXapiPoolHost,
} from "../../Types/XcpNg/XcpNgProbeCollection";
import XcpNgXapiAccountKind from "../../Types/XcpNg/XcpNgXapiAccount";
import { DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES } from "../../Utils/XcpNg/XcpNgCollectionSettings";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ------------------------------------------------------------------
 *                         XcpNgConnection
 * ------------------------------------------------------------------
 *
 * How OneUptime reads XCP-ng pools with nothing to install (#10996,
 * #10999): one of the project's probes reads a Xen Orchestra - every pool
 * it manages, through its OpenMetrics plugin - or one pool's own XAPI on
 * its master. The probe sends exactly what the XCP-ng Agent would, so each
 * pool it reports is an XcpNgPool like any other, with the same pages,
 * monitors and templates; the pool names the connection that reads it
 * (XcpNgPool.xcpNgConnectionId).
 *
 * A connection is a Xen Orchestra, not a pool, because one Xen Orchestra
 * reports many pools from one endpoint with one secret: connecting it once
 * adds them all. An XAPI connection reads one pool.
 *
 * The rules are a vCenter's probe collection's (VMwareVCenter), rule for
 * rule: the secrets - the plugin's secret, the API token, the XAPI
 * password - are encrypted and write-only, sent only to the probe the
 * connection names, and bound to the address, the probe and the certificate
 * they were entered for (XcpNgConnectionRules); a shared probe on
 * OneUptime Cloud never receives one. The status columns are written by the
 * server and the probe only.
 *
 * Who may connect, change or remove one is who may do so to an XCP-ng
 * pool: a connection is how pools are read.
 * ------------------------------------------------------------------
 */

const CONNECTION_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadXcpNgPool,
];

const CONNECTION_CREATORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateXcpNgPool,
];

const CONNECTION_EDITORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditXcpNgPool,
];

const CONNECTION_DELETERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.DeleteXcpNgPool,
];

/*
 * The columns the server and the probe rewrite on their own, every
 * collection. The audit log records what people change; recording these
 * would bury it.
 */
export const XCP_NG_CONNECTION_BOOKKEEPING_COLUMNS: Array<string> = [
  "isOpenMetricsSecretSet",
  "isApiTokenSet",
  "isPasswordSet",
  "credentialsUpdatedAt",
  "apiTokenExpiresAt",
  "apiTokenExpiryWarnedAt",
  "xapiAccountKind",
  "xapiPoolId",
  "xapiMasterAddress",
  "xapiPoolHosts",
  "messageWatermark",
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
  ignoreColumns: XCP_NG_CONNECTION_BOOKKEEPING_COLUMNS,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: CONNECTION_CREATORS,
  read: CONNECTION_READERS,
  delete: CONNECTION_DELETERS,
  update: CONNECTION_EDITORS,
})
@CrudApiEndpoint(new Route("/xcp-ng-connection"))
/*
 * The probe's claim: "the connections I read whose next read is due".
 * Every connection names its probe, and there are few: this stays small.
 */
@Index(["collectionProbeId", "nextCollectionAt"])
@TableMetadata({
  tableName: "XcpNgConnection",
  singularName: "XCP-ng Connection",
  pluralName: "XCP-ng Connections",
  icon: IconProp.XcpNg,
  tableDescription:
    "How XCP-ng pools are read with nothing to install: one of your OneUptime probes reads a Xen Orchestra - every pool it manages, through its OpenMetrics plugin - or one pool's own XAPI, with the secrets saved here.",
})
@Entity({
  name: "XcpNgConnection",
})
export default class XcpNgConnection extends BaseModel {
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
      "Name of this connection in OneUptime, shown on every pool it reads. Defaults to the host name of its address.",
    example: "xo-paris",
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
    canReadOnRelationQuery: true,
    title: "Description",
    description: "Friendly description for this connection",
    example: "Xen Orchestra of the Paris datacenter",
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
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(XcpNgConnectionType),
    canReadOnRelationQuery: true,
    title: "Connection Type",
    description:
      "What the probe reads. XenOrchestra: a Xen Orchestra and every pool it manages, through its OpenMetrics plugin (Xen Orchestra 6.9 or later). Xapi: one pool with no Xen Orchestra, through XAPI on its pool master. Set when the connection is made.",
    example: XcpNgConnectionType.XenOrchestra,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public connectionType?: XcpNgConnectionType = undefined;

  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
    update: CONNECTION_EDITORS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Address",
    description:
      "The HTTPS address the probe connects to: Xen Orchestra's (the one you open it at, such as https://xo.example.com), or the pool master's (such as https://10.0.0.10). Stored as https://host[:port]. Changing it asks for the secrets again.",
    example: "https://xo.example.com",
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
    manyToOneRelationColumn: "collectionProbeId",
    type: TableColumnType.Entity,
    modelType: Probe,
    title: "Collection Probe",
    description:
      "The OneUptime probe that reads this connection: one of this project's own probes, in a network that reaches the address on its HTTPS port (on a self-hosted install, the instance's own probes may be picked too).",
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
      "ID of the OneUptime probe that reads this connection. Changing it asks for the secrets again.",
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
      "The SHA-256 fingerprint of the one certificate the probe accepts at the address, for one not from a public authority - Xen Orchestra's and XCP-ng's own, by default. Empty: the certificate must be signed by an authority the probe's machine trusts. Verification is never skipped. Trusting a different certificate asks for the secrets again.",
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
      "How often the probe reads this connection, in whole minutes from 1 to 60. Every minute is the XCP-ng Agent's own interval, and the resolution Xen Orchestra and XAPI keep.",
    defaultValue: DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
    example: DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: DEFAULT_XCP_NG_COLLECTION_INTERVAL_IN_MINUTES,
  })
  public collectionIntervalInMinutes?: number = undefined;

  // --- Xen Orchestra's secrets (#10996) ---------------------------------

  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: [],
    update: CONNECTION_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "OpenMetrics Secret",
    description:
      "The secret of Xen Orchestra's OpenMetrics plugin (Settings, then Plugins, then openmetrics). Write-only: encrypted at rest, never returned by the API, and sent only to the probe that reads this connection. Leave it out of an update to keep the saved one; changing the address, the probe or the trusted certificate needs it again.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public openMetricsSecret?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "OpenMetrics Secret Saved",
    description:
      "Whether the OpenMetrics plugin's secret is saved. Set by the server from the secret itself.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isOpenMetricsSecretSet?: boolean = undefined;

  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: [],
    update: CONNECTION_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "API Token",
    description:
      "A Xen Orchestra API token of a user holding a copy of the built-in Read only role, and nothing more: OneUptime checks that it only reads, reads alarms and backup logs, and when it expires. Optional for metrics. Write-only, as the secret is.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public apiToken?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "API Token Saved",
    description:
      "Whether a Xen Orchestra API token is saved. Set by the server from the token itself.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isApiTokenSet?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "API Token Expires At",
    description:
      "When the saved API token expires, as Xen Orchestra says. The connection's owners are warned two weeks before. Written by the server from what the probe reads.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public apiTokenExpiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "API Token Expiry Warned At",
    description:
      "When the owners were last warned that the API token expires soon, so they are warned once per token. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public apiTokenExpiryWarnedAt?: Date = undefined;

  // --- XAPI's account (#10999) ------------------------------------------

  @ColumnAccessControl({
    create: CONNECTION_CREATORS,
    read: CONNECTION_READERS,
    update: CONNECTION_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "XAPI User Name",
    description:
      "The account the probe logs in to XAPI as: root, or an Active Directory user with the read-only role, such as EXAMPLE\\oneuptime. XAPI's read-only role exists only for Active Directory users.",
    example: "root",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
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
    title: "XAPI Password",
    description:
      "The password of the XAPI account. Write-only: encrypted at rest, never returned by the API, and sent only to the probe that reads this connection.",
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
      "Whether an XAPI password is saved. Set by the server from the password itself.",
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
    type: TableColumnType.ShortText,
    allowedValues: Object.values(XcpNgXapiAccountKind),
    title: "XAPI Account Kind",
    description:
      "Which account the connection holds, as XAPI says of its session: Root (the pool's root password: only the probe's code keeps it to reads), ReadOnly (an Active Directory user with only the read-only role) or Elevated (an Active Directory user with more). Written by the server from the probe's test and collections.",
    example: XcpNgXapiAccountKind.ReadOnly,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public xapiAccountKind?: XcpNgXapiAccountKind = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "XAPI Pool UUID",
    description:
      "The pool this XAPI connection reads, as its master last reported it. A host that answers for another pool is never read in its place. Written by the server.",
    example: "b7569d99-30f8-178a-7d94-801de3e29b5b",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public xapiPoolId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "XAPI Pool Master",
    description:
      "The pool master the probe last reached. It follows the master when it moves; written by the server.",
    example: "https://10.0.0.11",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public xapiMasterAddress?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "XAPI Pool Hosts",
    description:
      "The pool's hosts as the pool itself last listed them - each one's address and the SHA-256 fingerprint of its certificate - so the probe reaches every host pinned to the certificate the pool vouched for, and follows the master when it moves. Written by the server.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public xapiPoolHosts?: Array<XcpNgXapiPoolHost> = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Message Watermark",
    description:
      "Where reading the pool's XAPI messages stands - the newest one read, and those of that second - so a probe restart neither loses nor repeats one. Written by the server.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public messageWatermark?: XcpNgMessageWatermark = undefined;

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
      "When a secret, the API token or the XAPI account was last changed. Set by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public credentialsUpdatedAt?: Date = undefined;

  // --- Where collection stands (server and probe only) --------------------

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(XcpNgCollectionStatus),
    title: "Collection Status",
    description:
      "Where reading stands: Pending (the probe has not tried the current settings yet), Succeeded or Failed. Written by the server and the probe.",
    example: XcpNgCollectionStatus.Succeeded,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public collectionStatus?: XcpNgCollectionStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(XcpNgCollectionErrorCode),
    title: "Collection Error Code",
    description:
      "Why the last read failed, as a code the dashboard turns into a next step (WrongSecret, PluginNotLoaded, UntrustedCertificate, InvalidLogin, ...). Written by the probe.",
    example: XcpNgCollectionErrorCode.WrongSecret,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public collectionErrorCode?: XcpNgCollectionErrorCode = undefined;

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
      "What went wrong in the last read, in words. Written by the probe.",
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
      "The certificate the address presented when the last read did not trust it: its SHA-256 fingerprint, subject, issuer and validity, so a person can check it and trust exactly that certificate. Written by the probe.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public presentedCertificate?: XcpNgPresentedCertificate = undefined;

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
      "What the last successful read found: the pools it sees, with how many hosts, VMs and storage repositories each has, the API token's expiry and what it may do, and - for XAPI - the pool master and the account. Written by the probe.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public collectionSummary?: XcpNgCollectionSummary = undefined;

  @ColumnAccessControl({
    create: [],
    read: CONNECTION_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Next Collection At",
    description:
      "When the probe reads this connection next. Written by the server.",
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
      "When the probe last tried to read this connection, whether it worked or not. Written by the server.",
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
      "When the probe last read this connection successfully. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastSuccessfulCollectionAt?: Date = undefined;

  /*
   * Counts every change to the connection settings. A probe is handed the
   * version it reads with and reports it back, so a read that started
   * before a person fixed the secret cannot report the old failure over the
   * new settings.
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
      "Counts changes to the connection's settings, so a report from a read that started before a change is not shown as the current status. Written by the server.",
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
