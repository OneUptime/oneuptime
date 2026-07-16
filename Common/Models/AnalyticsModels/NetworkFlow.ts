import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";

/*
 * One NetFlow v5 flow record exported by a network device, received by a
 * probe's NetFlow receiver and correlated to a NetworkDevice on ingest.
 * Powers top-talker / bandwidth-attribution queries: who talked to whom,
 * over which protocol/port, and how many bytes/packets, per device.
 *
 * Access control mirrors the NetworkDevice database model — flows are an
 * attribute of the device that exported them.
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
     * Required (not Nullable) even though a flow could in principle lack a
     * device: the ingest path DROPS flows whose exporter matches no
     * NetworkDevice (there is no project to attribute them to), so every
     * stored row has one — and the column sits in the sort key, where
     * ClickHouse rejects Nullable columns.
     */
    const networkDeviceIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "networkDeviceId",
        title: "Network Device ID",
        description:
          "ID of the NetworkDevice that exported this flow (correlated from the exporter IP on ingest)",
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
        "Source IP of the NetFlow export datagram — the router/switch that observed the flow",
      required: true,
      type: TableColumnType.Text,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const srcIpColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "srcIp",
      codec: { codec: "ZSTD", level: 1 },
      title: "Source IP",
      description: "Source IP address of the flow's traffic",
      required: true,
      type: TableColumnType.Text,
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
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const srcPortColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "srcPort",
      title: "Source Port",
      description: "TCP/UDP source port (0 when not applicable)",
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
      description: "TCP/UDP destination port (0 when not applicable)",
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

    const octetsColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "octets",
      title: "Octets",
      description: "Total bytes in the flow",
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
      description: "Total packets in the flow",
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
        octetsColumn,
        packetsColumn,
        flowStartAtColumn,
        flowEndAtColumn,
        ingestedAtColumn,
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
}
