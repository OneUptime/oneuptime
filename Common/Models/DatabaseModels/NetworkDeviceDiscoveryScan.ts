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
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

export interface DiscoveredNetworkDevice {
  ipAddress: string;
  sysName?: string | undefined;
  sysDescr?: string | undefined;
  /*
   * The rest of the SNMP system group, carried since the probe started
   * reporting it — the same single GET fetches all six scalars, so these
   * cost nothing extra on the wire. sysObjectId is the vendor's registered
   * enterprise OID, which vendor-based auto-import conditions match on.
   * Undefined on ping-only hosts and on scan rows stored by older probes.
   */
  sysObjectId?: string | undefined;
  sysLocation?: string | undefined;
  sysContact?: string | undefined;
  sysUpTimeSeconds?: number | undefined;
  isAlreadyRegistered?: boolean | undefined;
  /*
   * False when the host answered ping but not SNMP — such hosts cannot be
   * imported as SNMP-credentialed Network Devices; they surface as
   * endpoints via ARP/FDB discovery instead. Undefined on scans stored
   * before this field existed (those hosts all answered SNMP).
   */
  snmpReachable?: boolean | undefined;
}

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.CreateNetworkDeviceDiscoveryScan,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadNetworkDeviceDiscoveryScan,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.DeleteNetworkDeviceDiscoveryScan,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.EditNetworkDeviceDiscoveryScan,
  ],
})
@CrudApiEndpoint(new Route("/network-device-discovery-scan"))
@TableMetadata({
  tableName: "NetworkDeviceDiscoveryScan",
  singularName: "Network Device Discovery Scan",
  pluralName: "Network Device Discovery Scans",
  icon: IconProp.Search,
  tableDescription:
    "Network discovery scans that sweep an address space — a CIDR subnet or an octet range — from a probe and report the hosts found, so they can be imported as Network Devices. Every sweep pings; scans with Check SNMP on also query each live host over SNMP.",
})
@Entity({
  name: "NetworkDeviceDiscoveryScan",
})
export default class NetworkDeviceDiscoveryScan extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
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
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
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
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "probeId",
    type: TableColumnType.Entity,
    modelType: Probe,
    title: "Scanning Probe",
    description: "Relation to the Probe that runs this discovery scan",
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Scanning Probe ID",
    description: "ID of the Probe that runs this discovery scan",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public probeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    /*
     * Updatable, like everything else that DESCRIBES the scan — its target,
     * its probe, its credentials and its schedule. Only what the scan
     * REPORTED (status, results, host counts, timestamps) is read-only,
     * because those belong to a run that happened and cannot be edited into
     * having happened differently.
     *
     * Every one of those settings used to be create-only, on the reasoning
     * that a row must not stop describing the sweep that ran. The reasoning
     * was sound and the conclusion was not: the only way to fix a typo'd
     * subnet or a rejected community string was to delete the scan — losing
     * its results — and recreate it (OneUptime issue #3444). The invariant is
     * kept where it belongs instead, in
     * Common/Server/Services/NetworkDeviceDiscoveryScanService: changing any
     * of them re-queues the scan and clears the previous run's results, so the
     * row never advertises findings from settings it no longer has.
     *
     * A name describes nothing but itself, and the whole point of it is to be
     * fixable after the fact: a scan mislabelled "Region 1100" is worse than
     * an unnamed one, and deleting a scan to rename it would throw away its
     * results.
     */
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  /*
   * What this scan is FOR, in the operator's own words — "Router Discovery —
   * Region 1100", "Switch Discovery — WB Units". Optional, not unique, and
   * never used to look a scan up: it exists so the Discovery Scans list can be
   * read at a glance instead of by matching octet ranges against a subnet plan
   * kept somewhere else (OneUptime issue #3391).
   *
   * Nullable, and every scan created before this column existed is null — so
   * every surface that renders it falls back to the scan target. See
   * Common/Utils/NetworkDiscovery/ScanNameUtil.
   */
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "Optional name for this scan, so it can be told apart from other scans at a glance. Falls back to the scan target when empty.",
    example: "Router Discovery - Region 1100",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  /*
   * The address space this scan sweeps. Two notations are accepted (see
   * Common/Utils/NetworkDiscovery/ScanTargetUtil): CIDR, and octet ranges
   * where any octet may be an inclusive low-high range.
   *
   * The column keeps the name `cidr` it was created with: it is part of the
   * public API surface and the probe payload, and renaming it would break both
   * for a purely cosmetic gain.
   */
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Scan Target",
    description:
      "Address space to scan, either in CIDR notation (192.168.1.0/24) or octet-range notation where any octet may be an inclusive low-high range (10.16-22.0-255.51-66)",
    example: "192.168.1.0/24",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public cidr?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  /*
   * Whether the sweep asks each live host for its SNMP system group, or stops
   * at the ICMP ping that finds it (OneUptime issue #3445).
   *
   * Every scan is a ping sweep first — that is how a live address is told from
   * an empty one. This column decides only what happens next, so turning it off
   * does not narrow WHAT is discovered, it narrows what is discovered ABOUT
   * each host: an ICMP-only scan still lists everything that answered, it just
   * has no sysName, no vendor OID and no credentials to poll with, and its
   * hosts import as monitor-backed devices rather than SNMP-polled ones.
   *
   * NOT NULL DEFAULT true, and read everywhere through
   * Common/Utils/NetworkDiscovery/ScanModeUtil rather than directly. Every scan
   * that existed before this column did was an SNMP scan, so the default is the
   * only value that leaves them describing the sweep they actually ran — and an
   * ABSENT value (a probe polling a server too old to select the column) has to
   * mean the same thing, which is why the read is `!== false`.
   *
   * Updatable, exactly as the other sweep-defining columns became when scans
   * gained an edit form (issue #3444), and listed in that form's SWEEP_COLUMNS
   * so flipping the method retires the run the way changing the target does.
   * Leaving the old results in place would have them describing a sweep that
   * asked a different question of every address.
   */
  @TableColumn({
    isDefaultValueColumn: true,
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Check SNMP",
    description:
      "Whether hosts that answer the ping sweep are then queried over SNMP. Turn it off for an ICMP-only scan, which reports every host that answers ping and asks nothing else of them.",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isSnmpEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "SNMP Version",
    description:
      "SNMP version tried against every host in the subnet (V1, V2c, V3). Ignored when Check SNMP is off.",
    example: "V2c",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "V2c",
  })
  public snmpVersion?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "SNMP Community String",
    description:
      "Community string tried against every host in the subnet (SNMP v1/v2c). Ignored when Check SNMP is off.",
    example: "public",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public snmpCommunityString?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "SNMP Port",
    description:
      "UDP port tried against every host in the subnet. Ignored when Check SNMP is off.",
    example: "161",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 161,
  })
  public snmpPort?: number = undefined;

  /*
   * SNMP v3 credentials tried against every host in the subnet. These mirror
   * the flattened snmpV3* columns on NetworkDevice so a v3 scan can be imported
   * into a v3 device without re-entering credentials.
   *
   * Editable after creation, like the rest of the SNMP config above — a
   * credential that the devices reject is exactly the thing an operator needs
   * to correct without rebuilding the scan. Changing one re-queues the scan;
   * see NetworkDeviceDiscoveryScanService.
   *
   * READ permissions are untouched by that, and are not uniform across these
   * columns: the two that carry a secret — snmpV3AuthKey and snmpV3PrivKey,
   * like snmpCommunityString above them — are read by a narrower list than the
   * rest of the model (no Viewer, no SettingsViewer), because a passphrase is
   * not a thing every reader of the scans list should be handed. The security
   * level, the username and the two protocol names describe HOW the scan
   * authenticates rather than WITH WHAT, and are read as widely as the target
   * is.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "SNMP v3 Security Level",
    description:
      "SNMP v3 security level tried against every host: noAuthNoPriv, authNoPriv, or authPriv. Ignored when Check SNMP is off.",
    example: "authPriv",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public snmpV3SecurityLevel?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "SNMP v3 Username",
    description:
      "SNMP v3 security name (username) tried against every host. Ignored when Check SNMP is off.",
    example: "monitoring",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public snmpV3Username?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "SNMP v3 Authentication Protocol",
    description:
      "SNMP v3 authentication protocol: MD5, SHA, SHA256, or SHA512. Ignored when Check SNMP is off.",
    example: "SHA",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public snmpV3AuthProtocol?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "SNMP v3 Authentication Key",
    description:
      "SNMP v3 authentication passphrase tried against every host. Ignored when Check SNMP is off.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
  })
  public snmpV3AuthKey?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "SNMP v3 Privacy Protocol",
    description:
      "SNMP v3 privacy (encryption) protocol: DES, AES, or AES256. Ignored when Check SNMP is off.",
    example: "AES",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public snmpV3PrivProtocol?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "SNMP v3 Privacy Key",
    description:
      "SNMP v3 privacy (encryption) passphrase tried against every host. Ignored when Check SNMP is off.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
  })
  public snmpV3PrivKey?: string = undefined;

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
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Status",
    description:
      'Status of this discovery scan: "Pending", "In Progress", "Completed" or "Failed". Managed by the scanning probe.',
    defaultValue: "Pending",
    example: "Pending",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "Pending",
  })
  public status?: string = undefined;

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
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Status Message",
    description:
      "Details about the current status of this scan, e.g. the failure reason. Managed by the scanning probe.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public statusMessage?: string = undefined;

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
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Discovered Devices",
    description:
      "Devices found by this scan: array of {ipAddress, sysName, sysDescr, isAlreadyRegistered}. Managed by the scanning probe.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public discoveredDevices?: Array<DiscoveredNetworkDevice> = undefined;

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
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Scanned Host Count",
    description:
      "Total number of host addresses swept in the subnet. Managed by the scanning probe.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public scannedHostCount?: number = undefined;

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
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Responded Host Count",
    description:
      "Number of hosts that answered the check this scan performed: SNMP responders on a scan with Check SNMP on, hosts that answered the ping sweep on an ICMP-only one. Managed by the scanning probe.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public respondedHostCount?: number = undefined;

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
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Started At",
    description:
      "When the scanning probe started this scan. Managed by the scanning probe.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public startedAt?: Date = undefined;

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
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Completed At",
    description:
      "When the scanning probe completed (or failed) this scan. Managed by the scanning probe.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public completedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: false,
    type: TableColumnType.Boolean,
    title: "Is Recurring",
    description:
      "Re-run this scan automatically every Rescan Interval minutes to keep discovery continuous.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isRecurring?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditNetworkDeviceDiscoveryScan,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Rescan Interval (Minutes)",
    description:
      "How often a recurring scan re-runs, in minutes. Ignored unless Is Recurring is on.",
    example: "1440",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public rescanIntervalInMinutes?: number = undefined;

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
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Next Scan At",
    description:
      "When a recurring scan is next due to run. Managed by the server.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public nextScanAt?: Date = undefined;

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
      Permission.ReadNetworkDeviceDiscoveryScan,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Auto Import Processed At",
    description:
      "When auto-import rules last processed this scan's results. Managed by the server: cleared when new results arrive, stamped by the worker that evaluates the rules. NULL means the current results have not been processed yet.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public autoImportProcessedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
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
      Permission.CreateNetworkDeviceDiscoveryScan,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
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
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadNetworkDeviceDiscoveryScan,
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
      Permission.ReadNetworkDeviceDiscoveryScan,
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
}
