import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import NetworkDevice from "../DatabaseModels/NetworkDevice";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";

/*
 * One network flow a device reported - in NetFlow v5, NetFlow v9, IPFIX or
 * sFlow - received by a probe's flow collector and matched to a
 * NetworkDevice on ingest. Powers the Traffic pages: who talked to whom,
 * over which protocol and port, through which interfaces, and how many
 * bytes and packets, per device, per site and across the project.
 *
 * Counts are estimates of the real traffic: a sampled record's bytes and
 * packets were multiplied by its sampling rate before they were stored.
 *
 * Access control mirrors the NetworkDevice database model - flows are an
 * attribute of the device that exported them. Flows a project's own probe
 * receives from an address that is not one of its devices yet are kept for
 * the project, with the project's ID in place of a device ID, so the
 * Traffic pages can show them and offer to add the device.
 */

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadNetworkDevice,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateNetworkDevice,
];

/*
 * A flow is read through the device that exported it: a caller whose
 * grants are limited to labels or to owned devices reads the flows of the
 * devices those reach, and a block with labels takes away the flows of the
 * devices carrying them (ModelPermission.getReadScope). Flows from an
 * exporter that is not a device yet carry the project's ID instead: like
 * telemetry from no known resource, they belong to the project, so a
 * project-wide or Owned grant reads them and a grant limited to labels
 * does not.
 */
@OwnedThrough("networkDeviceId", NetworkDevice, {
  onlyParentModels: true,
  includeProjectScope: true,
})
export default class NetworkFlow extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    /*
     * Required (not Nullable): the column sits in the sort key, where
     * ClickHouse rejects Nullable columns. A flow from an exporter that is
     * no device of the project yet - received by the project's own probe -
     * carries the project's ID here (the project's bucket); on a global probe
     * such a flow has no project to belong to and is dropped.
     */
    const networkDeviceIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "networkDeviceId",
        title: "Network Device ID",
        description:
          "ID of the NetworkDevice that exported this flow (matched from the exporter's address on ingest), or the project's ID when the exporter is not a device of the project yet",
        required: true,
        type: TableColumnType.ObjectID,
        accessControl: {
          read: readPermissions,
          create: createPermissions,
          update: [],
        },
      });

    const exporterIpColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "exporterIp",
      isLowCardinality: true,
      title: "Exporter IP",
      description:
        "Address of the router or switch that observed the flow: the sFlow agent address, or the address an IPFIX or NetFlow v9 exporter gives for itself, else the source address of the export datagram",
      required: true,
      type: TableColumnType.Text,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    /*
     * The Traffic pages filter by an address on either side ("everything
     * 10.0.0.5 did this week"); a bloom filter per granule lets that read
     * skip the parts of the window the address never appears in.
     */
    const srcIpColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "srcIp",
      codec: { codec: "ZSTD", level: 1 },
      title: "Source IP",
      description: "Source IP address of the flow's traffic",
      required: true,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_src_ip",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 4,
      },
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const dstIpColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "dstIp",
      codec: { codec: "ZSTD", level: 1 },
      title: "Destination IP",
      description: "Destination IP address of the flow's traffic",
      required: true,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_dst_ip",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 4,
      },
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const srcPortColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "srcPort",
      title: "Source Port",
      description:
        "TCP/UDP source port; 0 when the protocol has none, and on the client side of a conversation with a service (the probe folds a client's ephemeral port into 0)",
      required: true,
      type: TableColumnType.Number,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const dstPortColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "dstPort",
      title: "Destination Port",
      description:
        "TCP/UDP destination port; 0 when the protocol has none, and on the client side of a conversation with a service",
      required: true,
      type: TableColumnType.Number,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const protocolColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "protocol",
      title: "Protocol",
      description: "IP protocol number (6 = TCP, 17 = UDP, 1 = ICMP, ...)",
      required: true,
      type: TableColumnType.Number,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    /*
     * SNMP ifIndex of the interfaces the flow entered/left through — the
     * key that ties flow records to NetworkInterface rows for
     * per-interface traffic attribution. 0 when the exporter did not
     * report one (and on rows ingested before these columns existed).
     */
    const inputInterfaceIndexColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "inputInterfaceIndex",
        title: "Input Interface Index",
        description:
          "SNMP ifIndex of the interface the flow entered through (0 when unknown)",
        required: true,
        type: TableColumnType.Number,
        accessControl: {
          read: readPermissions,
          create: createPermissions,
          update: [],
        },
      });

    const outputInterfaceIndexColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "outputInterfaceIndex",
        title: "Output Interface Index",
        description:
          "SNMP ifIndex of the interface the flow left through (0 when unknown)",
        required: true,
        type: TableColumnType.Number,
        accessControl: {
          read: readPermissions,
          create: createPermissions,
          update: [],
        },
      });

    const octetsColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "octets",
      title: "Octets",
      description:
        "Bytes in the flow - an estimate of the real traffic: what the device reported, multiplied by its sampling rate",
      required: true,
      type: TableColumnType.UInt64,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const packetsColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "packets",
      title: "Packets",
      description:
        "Packets in the flow - an estimate of the real traffic: what the device reported, multiplied by its sampling rate",
      required: true,
      type: TableColumnType.UInt64,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const flowStartAtColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "flowStartAt",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Flow Start",
      description: "Wall-clock time the flow started",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const flowEndAtColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "flowEndAt",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Flow End",
      description: "Wall-clock time the flow ended",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const ingestedAtColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "ingestedAt",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Ingested At",
      description: "When the server ingested this flow record",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    /*
     * The three columns below arrived with IPFIX and sFlow. Rows stored
     * before them read '' and 0 (ClickHouse fills a column added to a
     * table with its type's default): readers treat a rate or a count below
     * 1 as 1, and an empty format as "NetFlow v5 or v9" - all an older probe
     * could decode.
     */
    const flowFormatColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "flowFormat",
      isLowCardinality: true,
      title: "Flow Format",
      description:
        "The export format the device used: NetFlow v5, NetFlow v9, IPFIX or sFlow (empty on rows from probes older than IPFIX and sFlow support)",
      required: true,
      type: TableColumnType.Text,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const samplingRateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "samplingRate",
      title: "Sampling Rate",
      description:
        "The device counted one packet in this many (1: every packet). Octets and Packets are already multiplied by it.",
      required: true,
      type: TableColumnType.Number,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const flowCountColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "flowCount",
      title: "Flow Count",
      description:
        "How many flow records the device sent for this conversation that the probe summed into this row (records of the same conversation arriving within seconds of each other)",
      required: true,
      type: TableColumnType.Number,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const probeIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "probeId",
      title: "Probe ID",
      description:
        "ID of the probe whose flow collector received this flow (empty on rows stored before it was recorded)",
      required: false,
      type: TableColumnType.ObjectID,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    super({
      tableName: AnalyticsTableName.NetworkFlow,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Network Flow",
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.SettingsAdmin,
          Permission.SettingsMember,
          Permission.EditNetworkDevice,
        ],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.SettingsAdmin,
          Permission.SettingsMember,
          Permission.DeleteNetworkDevice,
        ],
      },
      pluralName: "Network Flows",
      crudApiPath: new Route("/network-flow"),
      tableColumns: [
        projectIdColumn,
        networkDeviceIdColumn,
        exporterIpColumn,
        srcIpColumn,
        dstIpColumn,
        srcPortColumn,
        dstPortColumn,
        protocolColumn,
        inputInterfaceIndexColumn,
        outputInterfaceIndexColumn,
        octetsColumn,
        packetsColumn,
        flowStartAtColumn,
        flowEndAtColumn,
        ingestedAtColumn,
        flowFormatColumn,
        samplingRateColumn,
        flowCountColumn,
        probeIdColumn,
      ],
      projections: [],
      sortKeys: ["projectId", "networkDeviceId", "flowStartAt"],
      primaryKeys: ["projectId", "networkDeviceId", "flowStartAt"],
      partitionKey: "toYYYYMMDD(flowStartAt)",
      /*
       * Shard by (projectId, networkDeviceId, flowStartAt) — mirrors how
       * Log shards on its always-present sort-key columns: the
       * high-entropy time component spreads even a single very busy
       * exporter across all shards.
       */
      shardingKey: "cityHash64(projectId, networkDeviceId, flowStartAt)",
      tableSettings: "non_replicated_deduplication_window = 10000",
      /*
       * Flows are the highest-volume rows in the product (a single busy
       * router can export thousands per second), so the table must never
       * grow unboundedly. Fixed-window TTL for now; per-project retention
       * (a retentionDate column computed at ingest, like Log/Metric) is
       * the phase-2 follow-up. Keyed on server-assigned ingestedAt so a
       * device with a wrong clock cannot make rows expire early.
       *
       * toDateTime() is NOT redundant: ingestedAt is DateTime64(9), so
       * `ingestedAt + INTERVAL 30 DAY` stays DateTime64(9), and a TTL
       * expression must evaluate to Date or DateTime. ClickHouse only began
       * accepting DateTime64 there in 25.x; on 24.x it fails the CREATE with
       * BAD_TTL_EXPRESSION, which aborts the whole boot schema-sync (it has
       * no per-table error handling) and takes every table registered after
       * this one down with it. The Helm chart ships `tag: latest` but tells
       * operators to pin for production, so older servers are supported and
       * this must stay version-portable. Narrowing to second precision is
       * lossless for a 30-day retention window.
       */
      ttlExpression: "toDateTime(ingestedAt) + INTERVAL 30 DAY DELETE",
      defaultSortColumn: "flowStartAt",
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get networkDeviceId(): ObjectID | undefined {
    return this.getColumnValue("networkDeviceId") as ObjectID | undefined;
  }

  public set networkDeviceId(v: ObjectID | undefined) {
    this.setColumnValue("networkDeviceId", v);
  }

  public get exporterIp(): string | undefined {
    return this.getColumnValue("exporterIp") as string | undefined;
  }

  public set exporterIp(v: string | undefined) {
    this.setColumnValue("exporterIp", v);
  }

  public get srcIp(): string | undefined {
    return this.getColumnValue("srcIp") as string | undefined;
  }

  public set srcIp(v: string | undefined) {
    this.setColumnValue("srcIp", v);
  }

  public get dstIp(): string | undefined {
    return this.getColumnValue("dstIp") as string | undefined;
  }

  public set dstIp(v: string | undefined) {
    this.setColumnValue("dstIp", v);
  }

  public get srcPort(): number | undefined {
    return this.getColumnValue("srcPort") as number | undefined;
  }

  public set srcPort(v: number | undefined) {
    this.setColumnValue("srcPort", v);
  }

  public get dstPort(): number | undefined {
    return this.getColumnValue("dstPort") as number | undefined;
  }

  public set dstPort(v: number | undefined) {
    this.setColumnValue("dstPort", v);
  }

  public get protocol(): number | undefined {
    return this.getColumnValue("protocol") as number | undefined;
  }

  public set protocol(v: number | undefined) {
    this.setColumnValue("protocol", v);
  }

  public get inputInterfaceIndex(): number | undefined {
    return this.getColumnValue("inputInterfaceIndex") as number | undefined;
  }

  public set inputInterfaceIndex(v: number | undefined) {
    this.setColumnValue("inputInterfaceIndex", v);
  }

  public get outputInterfaceIndex(): number | undefined {
    return this.getColumnValue("outputInterfaceIndex") as number | undefined;
  }

  public set outputInterfaceIndex(v: number | undefined) {
    this.setColumnValue("outputInterfaceIndex", v);
  }

  public get octets(): number | undefined {
    return this.getColumnValue("octets") as number | undefined;
  }

  public set octets(v: number | undefined) {
    this.setColumnValue("octets", v);
  }

  public get packets(): number | undefined {
    return this.getColumnValue("packets") as number | undefined;
  }

  public set packets(v: number | undefined) {
    this.setColumnValue("packets", v);
  }

  public get flowStartAt(): Date | undefined {
    return this.getColumnValue("flowStartAt") as Date | undefined;
  }

  public set flowStartAt(v: Date | undefined) {
    this.setColumnValue("flowStartAt", v);
  }

  public get flowEndAt(): Date | undefined {
    return this.getColumnValue("flowEndAt") as Date | undefined;
  }

  public set flowEndAt(v: Date | undefined) {
    this.setColumnValue("flowEndAt", v);
  }

  public get ingestedAt(): Date | undefined {
    return this.getColumnValue("ingestedAt") as Date | undefined;
  }

  public set ingestedAt(v: Date | undefined) {
    this.setColumnValue("ingestedAt", v);
  }

  public get flowFormat(): string | undefined {
    return this.getColumnValue("flowFormat") as string | undefined;
  }

  public set flowFormat(v: string | undefined) {
    this.setColumnValue("flowFormat", v);
  }

  public get samplingRate(): number | undefined {
    return this.getColumnValue("samplingRate") as number | undefined;
  }

  public set samplingRate(v: number | undefined) {
    this.setColumnValue("samplingRate", v);
  }

  public get flowCount(): number | undefined {
    return this.getColumnValue("flowCount") as number | undefined;
  }

  public set flowCount(v: number | undefined) {
    this.setColumnValue("flowCount", v);
  }

  public get probeId(): ObjectID | undefined {
    return this.getColumnValue("probeId") as ObjectID | undefined;
  }

  public set probeId(v: ObjectID | undefined) {
    this.setColumnValue("probeId", v);
  }
}
