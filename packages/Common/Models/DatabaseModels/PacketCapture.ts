import File from "./File";
import NetworkDevice from "./NetworkDevice";
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
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import {
  PACKET_CAPTURE_DEFAULT_DURATION_IN_SECONDS,
  PACKET_CAPTURE_DEFAULT_FILE_SIZE_IN_MB,
  PACKET_CAPTURE_DEFAULT_MAX_PACKETS,
} from "../../Types/PacketCapture/PacketCaptureLimits";
import PacketCaptureStatus from "../../Types/PacketCapture/PacketCaptureStatus";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Who may see that captures were run - when, on which probe and interface,
 * with which filter, by whom - but not the traffic itself. Knowing a capture
 * happened is not sensitive, and seeing it is how a team notices one.
 */
const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.ReadPacketCapture,
];

/*
 * Who may start (and stop) a capture: project owners and admins, and anyone
 * given Start Packet Capture. Not Project Member: a capture records the
 * traffic itself - passwords, tokens and personal data included - so it is
 * a permission somebody is trusted with, not part of everyday work. Who may
 * DOWNLOAD the file is a permission of its own (PACKET_CAPTURE_DOWNLOAD
 * _PERMISSIONS in Types/PacketCapture/PacketCapturePermissions), checked by
 * the download route.
 */
const START_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreatePacketCapture,
];

const DELETE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.DeletePacketCapture,
];

/*
 * One packet capture, run on one of the project's own probes (a probe's
 * page, or a network device's Traffic page, starts one).
 *
 * The dashboard creates the row with the probe, the interface, a BPF filter
 * and the limits; the probe picks it up the way it picks up monitors, runs
 * tcpdump, and uploads the pcap file, which is stored as a private file of
 * the project. The row then says Completed with a Download button, or Failed
 * with the reason. See Types/PacketCapture for the shapes and the limits.
 *
 * Guardrails, all of them load-bearing:
 *
 *   - Captures run only on a probe whose operator turned them on
 *     (PROBE_PACKET_CAPTURE_ENABLED), and only on the project's own probes -
 *     never a global probe, which carries other projects' traffic.
 *   - Starting one, downloading one and deleting one are permissions of
 *     their own, held by project owners and admins by default.
 *   - Every capture stops at the first of its duration, packet and size
 *     limits, which the server refuses past the hard maximums and the probe
 *     enforces again.
 *   - A capture and its file are deleted PACKET_CAPTURE_RETENTION_IN_DAYS
 *     after it started; deleting the row deletes the file at once.
 *   - Starting one is in the audit log (a Create), and so is every download
 *     (a Download entry, written by the download route).
 *
 * Nothing on the row can be edited through the API once it is created: every
 * column after the request describes the run the probe made, and the probe's
 * writes go through PacketCaptureService's own SQL, keyed on the probe.
 */
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: START_PERMISSIONS,
  read: READ_PERMISSIONS,
  delete: DELETE_PERMISSIONS,
  update: [],
})
@CrudApiEndpoint(new Route("/packet-capture"))
/*
 * Starting a capture and deleting one are recorded. Updates are not: after
 * creation only the probe and the server write to a capture, and those
 * writes go round the hooks.
 */
@EnableAuditLog({
  create: true,
  update: false,
  delete: true,
})
// The probe's claim: this probe's Pending captures, oldest first.
@Index(["probeId", "status", "createdAt"])
// A probe's or a device's captures, newest first.
@Index(["projectId", "createdAt"])
@TableMetadata({
  tableName: "PacketCapture",
  singularName: "Packet Capture",
  pluralName: "Packet Captures",
  icon: IconProp.Signal,
  tableDescription:
    "A packet capture run on one of the project's probes, and the pcap file it produced. Captures and their files are deleted 7 days after they start.",
})
@Entity({
  name: "PacketCapture",
})
export default class PacketCapture extends BaseModel {
  @ColumnAccessControl({
    create: START_PERMISSIONS,
    read: READ_PERMISSIONS,
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
    create: START_PERMISSIONS,
    read: READ_PERMISSIONS,
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
    create: START_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "probeId",
    type: TableColumnType.Entity,
    modelType: Probe,
    title: "Probe",
    description: "The probe that runs the capture.",
  })
  /*
   * SET NULL, not CASCADE: a finished capture's file is still worth opening
   * after its probe is deleted, and retention removes it on schedule. One
   * still waiting for that probe is failed by the stale-capture sweep.
   */
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
    create: START_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Probe ID",
    description:
      "ID of the probe that runs the capture: one of the project's own probes, with packet capture turned on.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public probeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: START_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "networkDeviceId",
    type: TableColumnType.Entity,
    modelType: NetworkDevice,
    title: "Network Device",
    description:
      "The network device the capture was started from, if it was started from a device's page.",
  })
  @ManyToOne(
    () => {
      return NetworkDevice;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "networkDeviceId" })
  public networkDevice?: NetworkDevice = undefined;

  @ColumnAccessControl({
    create: START_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Network Device ID",
    description:
      "ID of the network device the capture was started from, if it was started from a device's page.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public networkDeviceId?: ObjectID = undefined;

  /*
   * Written by the server from the interface and the filter, so the audit
   * log and the lists can name the capture: "eth0: host 10.0.0.5". Computed:
   * a value a request sends is replaced, never refused.
   */
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "The interface and the filter of the capture, written by OneUptime: eth0: host 10.0.0.5.",
    example: "eth0: host 10.0.0.5",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: START_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Interface",
    description:
      'The network interface the probe captures on, as the probe reported it: "eth0", or "any" for every interface at once.',
    example: "eth0",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public interfaceName?: string = undefined;

  @ColumnAccessControl({
    create: START_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Filter",
    description:
      "A BPF filter expression - the capture-filter language of tcpdump and Wireshark - that decides which packets are kept: host 10.0.0.5 and tcp port 443. Empty keeps every packet.",
    example: "host 10.0.0.5 and tcp port 443",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public bpfFilter?: string = undefined;

  @ColumnAccessControl({
    create: START_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "Duration",
    description:
      "How long the capture runs, in seconds, at most: from 5 seconds to 30 minutes, and no longer than the probe allows. It stops earlier when it reaches its packet or file size limit.",
    defaultValue: PACKET_CAPTURE_DEFAULT_DURATION_IN_SECONDS,
    example: PACKET_CAPTURE_DEFAULT_DURATION_IN_SECONDS,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: PACKET_CAPTURE_DEFAULT_DURATION_IN_SECONDS,
  })
  public maxDurationInSeconds?: number = undefined;

  @ColumnAccessControl({
    create: START_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "Packet Limit",
    description:
      "The capture stops after this many packets: from 1 to 1,000,000.",
    defaultValue: PACKET_CAPTURE_DEFAULT_MAX_PACKETS,
    example: PACKET_CAPTURE_DEFAULT_MAX_PACKETS,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: PACKET_CAPTURE_DEFAULT_MAX_PACKETS,
  })
  public maxPackets?: number = undefined;

  @ColumnAccessControl({
    create: START_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "File Size Limit",
    description:
      "The capture stops when its file reaches this many megabytes: from 1 to 25, and no more than the probe allows. The file is cut at the last whole packet.",
    defaultValue: PACKET_CAPTURE_DEFAULT_FILE_SIZE_IN_MB,
    example: PACKET_CAPTURE_DEFAULT_FILE_SIZE_IN_MB,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: PACKET_CAPTURE_DEFAULT_FILE_SIZE_IN_MB,
  })
  public maxFileSizeInMB?: number = undefined;

  // Computed: the server starts every capture Pending.
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    computed: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Status",
    description:
      'Where the capture is: "Pending" (waiting for the probe), "Running" (the probe is capturing), "Completed" (the file is ready) or "Failed" (see Status Message). Managed by OneUptime and the probe.',
    defaultValue: PacketCaptureStatus.Pending,
    example: PacketCaptureStatus.Pending,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: PacketCaptureStatus.Pending,
  })
  public status?: PacketCaptureStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Status Message",
    description:
      "Why a capture failed - the interface is gone, the probe may not capture, the filter did not compile - or what the capture tool said when it stopped by itself. Managed by OneUptime and the probe.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public statusMessage?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "End Reason",
    description:
      'Why a completed capture stopped: "DurationReached", "PacketLimitReached", "FileSizeLimitReached", "StoppedFromDashboard" or "CaptureToolStopped". Managed by the probe.',
    example: "DurationReached",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public endReason?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Started At",
    description: "When the probe started capturing. Managed by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public startedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Completed At",
    description: "When the capture completed or failed. Managed by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public completedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Stop Requested At",
    description:
      "When someone pressed Stop on the running capture. The probe stops at its next check, within about ten seconds, and uploads what it captured. Managed by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public stopRequestedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Packet Count",
    description:
      "How many packets the file holds, counted by OneUptime from the file. Managed by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public packetCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "File Size",
    description: "The size of the pcap file in bytes. Managed by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public fileSizeInBytes?: number = undefined;

  /*
   * The pcap file, a private file of the project. Readable by nobody
   * through the API - not even through this relation - so the bytes leave
   * only through the download route, which checks Download Packet Capture
   * and writes the audit entry.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "fileId",
    type: TableColumnType.Entity,
    modelType: File,
    title: "Capture File",
    description:
      "The pcap file the capture produced. Downloaded through the packet capture's download route only.",
    hideColumnInDocumentation: true,
  })
  @ManyToOne(
    () => {
      return File;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "fileId" })
  public file?: File = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Capture File ID",
    description:
      "ID of the pcap file the capture produced. Managed by OneUptime.",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public fileId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: START_PERMISSIONS,
    read: READ_PERMISSIONS,
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
    create: START_PERMISSIONS,
    read: READ_PERMISSIONS,
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
    read: READ_PERMISSIONS,
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
    read: READ_PERMISSIONS,
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
