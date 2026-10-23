import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import NetworkDevice from "../DatabaseModels/NetworkDevice";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";

/*
 * Traffic a network's controller reported - today the Meraki dashboard API
 * (OneUptime issue #5140) - read on a schedule by a
 * NetworkControllerConnection. Unlike a NetworkFlow, a row is a TOTAL over
 * a window the read covered, of one of three kinds
 * (Types/NetFlow/NetworkTrafficUsage):
 *
 *   uplink       the bytes one appliance sent and received on one uplink
 *                (wan1, wan2, cellular) - five-minute windows;
 *   application  the bytes, flows and clients of one application and
 *                destination on one network - two-hour windows at least,
 *                Meraki's own aggregation; the rest of a busy window
 *                summed into one row whose application is empty;
 *   client       the bytes one client sent and received on one network,
 *                read with the applications.
 *
 * Every row carries the window it covers, so a page counts each window's
 * share of its range. A window that was read again replaces nothing: the
 * read runner never writes a window that is stored already
 * (NetworkControllerReadRunner), so nothing is counted twice.
 *
 * Read through the device the traffic belongs to, exactly as flows are:
 * an appliance that is a device in OneUptime (matched by serial number or
 * MAC address when the row was written) owns its uplinks and its network's
 * applications and clients; everything else carries the project's ID in
 * its place - the project's bucket, which a project-wide or Owned grant
 * reads and a grant limited to labels does not.
 *
 * No CRUD API: the Traffic pages read it through
 * /network-traffic/usage-summary (NetworkTrafficUsageSummary), which
 * applies the same read scope.
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

// Written by the server only (the read runner), never by a caller.
const createPermissions: Array<Permission> = [];

function column(data: {
  key: string;
  title: string;
  description: string;
  type: TableColumnType;
  isLowCardinality?: boolean | undefined;
  required?: boolean | undefined;
  isTenantId?: boolean | undefined;
}): AnalyticsTableColumn {
  return new AnalyticsTableColumn({
    key: data.key,
    title: data.title,
    description: data.description,
    required: data.required ?? true,
    type: data.type,
    ...(data.isLowCardinality ? { isLowCardinality: true } : {}),
    ...(data.isTenantId ? { isTenantId: true } : {}),
    accessControl: {
      read: readPermissions,
      create: createPermissions,
      update: [],
    },
  });
}

@OwnedThrough("networkDeviceId", NetworkDevice, {
  onlyParentModels: true,
  includeProjectScope: true,
})
export default class NetworkTrafficUsage extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: AnalyticsTableName.NetworkTrafficUsage,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Network Traffic Usage",
      pluralName: "Network Traffic Usage",
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
        delete: [],
      },
      tableColumns: [
        column({
          key: "projectId",
          title: "Project ID",
          description: "ID of project",
          type: TableColumnType.ObjectID,
          isTenantId: true,
        }),
        /*
         * Required: the project's ID stands in for traffic of no device, as
         * it does on NetworkFlow, so the read scope always has an ID to
         * hold a row to.
         */
        column({
          key: "networkDeviceId",
          title: "Network Device ID",
          description:
            "ID of the NetworkDevice the traffic belongs to - the appliance, matched by serial number or MAC address when the row was written - or the project's ID when it is no device in OneUptime",
          type: TableColumnType.ObjectID,
        }),
        column({
          key: "connectionId",
          title: "Connection ID",
          description:
            "ID of the NetworkControllerConnection whose read wrote this row",
          type: TableColumnType.ObjectID,
        }),
        column({
          key: "kind",
          title: "Kind",
          description:
            "What the row totals: 'uplink' (one uplink of one appliance), 'application' (one application and destination of one network) or 'client' (one client of one network)",
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        column({
          key: "controllerNetworkId",
          title: "Controller Network ID",
          description:
            "The controller's ID of the network the traffic is of (a Meraki network ID)",
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        column({
          key: "controllerNetworkName",
          title: "Controller Network Name",
          description: "The network's name in the controller when it was read",
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        column({
          key: "deviceSerial",
          title: "Device Serial",
          description:
            "Uplink rows: the appliance's serial number. Empty on other rows",
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        column({
          key: "deviceName",
          title: "Device Name",
          description:
            "Uplink rows: the appliance's name in the controller. Empty on other rows",
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        column({
          key: "interfaceName",
          title: "Interface Name",
          description:
            "Uplink rows: the uplink (wan1, wan2, wan3, cellular). Empty on other rows",
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        column({
          key: "application",
          title: "Application",
          description:
            "Application rows: the application as the controller names it (Microsoft Teams, YouTube). Empty for the row that sums the rest of a busy window",
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        column({
          key: "destination",
          title: "Destination",
          description:
            "Application rows: the host or address the traffic went to, as the controller names it",
          type: TableColumnType.Text,
        }),
        column({
          key: "protocol",
          title: "Protocol",
          description: "Application rows: TCP, UDP, ICMP or another protocol",
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        column({
          key: "port",
          title: "Port",
          description: "Application rows: the destination port, 0 for none",
          type: TableColumnType.Number,
        }),
        column({
          key: "clientKey",
          title: "Client Key",
          description:
            "Client rows: the controller's ID of the client. Empty for the row that sums the rest of a busy window",
          type: TableColumnType.Text,
        }),
        column({
          key: "clientName",
          title: "Client Name",
          description:
            "Client rows: the client's description in the controller, else its hostname",
          type: TableColumnType.Text,
        }),
        column({
          key: "clientIp",
          title: "Client IP",
          description: "Client rows: the client's IP address",
          type: TableColumnType.Text,
        }),
        column({
          key: "clientMac",
          title: "Client MAC",
          description: "Client rows: the client's MAC address",
          type: TableColumnType.Text,
        }),
        column({
          key: "clientManufacturer",
          title: "Client Manufacturer",
          description:
            "Client rows: who made the client, as the controller says",
          type: TableColumnType.Text,
          isLowCardinality: true,
        }),
        column({
          key: "sentOctets",
          title: "Sent Octets",
          description:
            "Bytes sent in the window: by the appliance on the uplink (upload), by the network's clients to the application, by the client",
          type: TableColumnType.UInt64,
        }),
        column({
          key: "receivedOctets",
          title: "Received Octets",
          description:
            "Bytes received in the window: by the appliance on the uplink (download), by the network's clients from the application, by the client",
          type: TableColumnType.UInt64,
        }),
        column({
          key: "flows",
          title: "Flows",
          description:
            "Application rows: the flows the controller counted. 0 on other rows",
          type: TableColumnType.UInt64,
        }),
        column({
          key: "clients",
          title: "Clients",
          description:
            "Application rows: how many clients used the application. 0 on other rows",
          type: TableColumnType.Number,
        }),
        column({
          key: "windowStartAt",
          title: "Window Start",
          description: "Start of the window the row totals",
          type: TableColumnType.DateTime64,
        }),
        column({
          key: "windowEndAt",
          title: "Window End",
          description: "End of the window the row totals (exclusive)",
          type: TableColumnType.DateTime64,
        }),
        column({
          key: "ingestedAt",
          title: "Ingested At",
          description: "When the read that wrote this row ran",
          type: TableColumnType.DateTime64,
        }),
      ],
      projections: [],
      /*
       * Every read is one kind over a time range of one project, so the key
       * leads with those: a page's nine reads each touch only the parts of
       * their kind and their window.
       */
      sortKeys: ["projectId", "kind", "windowStartAt"],
      primaryKeys: ["projectId", "kind", "windowStartAt"],
      partitionKey: "toYYYYMMDD(windowStartAt)",
      shardingKey: "cityHash64(projectId, connectionId, windowStartAt)",
      /*
       * Kept as long as flows (one page shows at most 31 days). Keyed on the
       * window, which the server sets; toDateTime() for the same reason as
       * NetworkFlow's: a TTL must be a Date or DateTime on ClickHouse 24.
       */
      ttlExpression: "toDateTime(windowStartAt) + INTERVAL 31 DAY DELETE",
      defaultSortColumn: "windowStartAt",
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

  public get connectionId(): ObjectID | undefined {
    return this.getColumnValue("connectionId") as ObjectID | undefined;
  }

  public set connectionId(v: ObjectID | undefined) {
    this.setColumnValue("connectionId", v);
  }

  public get kind(): string | undefined {
    return this.getColumnValue("kind") as string | undefined;
  }

  public set kind(v: string | undefined) {
    this.setColumnValue("kind", v);
  }

  public get windowStartAt(): Date | undefined {
    return this.getColumnValue("windowStartAt") as Date | undefined;
  }

  public set windowStartAt(v: Date | undefined) {
    this.setColumnValue("windowStartAt", v);
  }

  public get windowEndAt(): Date | undefined {
    return this.getColumnValue("windowEndAt") as Date | undefined;
  }

  public set windowEndAt(v: Date | undefined) {
    this.setColumnValue("windowEndAt", v);
  }
}
