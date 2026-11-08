import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "../../../Models/DatabaseModels/NetworkEndpoint";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkTopologySuppression from "../../../Models/DatabaseModels/NetworkTopologySuppression";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import {
  DiscoveredDeviceCounts,
  DiscoveredDeviceListRequest,
  DiscoveredDeviceListResponse,
  DiscoveredDeviceMapChange,
  DiscoveredDeviceMatch,
  DiscoveredDeviceRow,
  DiscoveredDeviceShow,
  MAX_DISCOVERED_DEVICES_PER_ACTION,
  getEndpointNodeKey,
  readDiscoveredDeviceCounts,
} from "../../../Types/NetworkDevice/DiscoveredDevice";
import ObjectID from "../../../Types/ObjectID";
import { getEndpointSightingWindowMs } from "../../../Utils/Monitor/NetworkTopologyUtil";
import { getDiscoveredDeviceName } from "../../../Utils/NetworkDevice/DiscoveredDeviceIdentity";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkEndpointService from "../../Services/NetworkEndpointService";
import NetworkSiteService from "../../Services/NetworkSiteService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../Types/Database/Permissions/TablePermission";
import QueryHelper from "../../Types/Database/QueryHelper";
import {
  DiscoveredDeviceScope,
  DiscoveredDeviceStatement,
  buildClassifyStatement,
  buildCountsStatement,
  buildHideStatement,
  buildIdsStatement,
  buildRowsStatement,
  buildShowStatement,
} from "./DiscoveredDeviceQuery";

/*
 * THE DISCOVERED DEVICES LIST, AND WHAT IT DOES IN BULK (OneUptime issue
 * #5775): see Types/NetworkDevice/DiscoveredDevice for what a row is.
 *
 * The statements are DiscoveredDeviceQuery's, run as root, so every entry
 * point here checks the person first:
 *
 *  - reading the list needs the right to read endpoints, the table every
 *    row is;
 *  - names of other records come from the person's own reads - a device
 *    the person may not see (another team's, by its labels) stays a
 *    "monitored device" without a name, and a site the same;
 *  - hiding rows needs the right to create map suppressions, showing them
 *    the right to delete them, the rights the map's own Hide and Show ask.
 *
 * Hiding never touches a monitored device: the map draws one as the device
 * it is, so its endpoint row is not on the map to hide, and nothing about
 * its monitoring changes. Neither action deletes anything but a map
 * preference.
 */

export interface ClassifiedDiscoveredDevice extends DiscoveredDeviceRow {
  seenOnDeviceId?: string | undefined;
  siteId?: string | undefined;
}

export type DiscoveredDeviceQueryRunner = (
  sql: string,
  params: Array<unknown>,
) => Promise<Array<Record<string, unknown>>>;

export const HIDDEN_FROM_LIST_REASON: string =
  "Hidden from the map on the Discovered Devices list.";

// The most a suppression's nodeName column holds.
const MAX_NODE_NAME_LENGTH: number = 100;

// Rows per write: a statement's parameters stay well short of any limit.
const WRITE_CHUNK_SIZE: number = 1000;

function isRefusal(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

function text(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const string: string = String(value).trim();

  return string ? string : undefined;
}

function isoDate(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const date: Date = value instanceof Date ? value : new Date(String(value));

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function chunk<T>(items: Array<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = [];

  for (let index: number = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function unique(values: Array<string | undefined>): Array<string> {
  return Array.from(
    new Set<string>(
      values.filter((value: string | undefined): value is string => {
        return Boolean(value);
      }),
    ),
  );
}

export default class DiscoveredDevices {
  // Seams for tests: the statement runner and the clock.
  public static runQuery: DiscoveredDeviceQueryRunner = async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> => {
    return (await NetworkEndpointService.getRepository().manager.query(
      sql,
      params,
    )) as Array<Record<string, unknown>>;
  };

  public static now: () => Date = (): Date => {
    return new Date();
  };

  public static getScope(data: {
    projectId: ObjectID;
    siteId?: string | undefined;
    endpointIds?: Array<string> | undefined;
  }): DiscoveredDeviceScope {
    const now: number = this.now().getTime();

    return {
      projectId: data.projectId.toString(),
      siteId: data.siteId,
      endpointIds: data.endpointIds,
      walkSeenSince: new Date(now - getEndpointSightingWindowMs(undefined)),
      controllerSeenSince: new Date(
        now - getEndpointSightingWindowMs("controller"),
      ),
    };
  }

  // ---- Who may do what.

  public static assertCanRead(props: DatabaseCommonInteractionProps): void {
    try {
      TablePermission.checkTableLevelPermissions(
        NetworkEndpoint,
        props,
        DatabaseRequestType.Read,
      );
    } catch (error) {
      if (isRefusal(error)) {
        throw new NotAuthorizedException(
          "You may not see this project's discovered devices.",
        );
      }

      throw error;
    }
  }

  public static assertCanChangeMap(
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType.Create | DatabaseRequestType.Delete,
  ): void {
    try {
      TablePermission.checkTableLevelPermissions(
        NetworkTopologySuppression,
        props,
        type,
      );
    } catch (error) {
      if (isRefusal(error)) {
        throw new NotAuthorizedException(
          type === DatabaseRequestType.Create
            ? "You may not hide devices from this project's topology map."
            : "You may not show hidden devices on this project's topology map again.",
        );
      }

      throw error;
    }
  }

  // ---- Reading.

  public static async list(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    request: DiscoveredDeviceListRequest;
  }): Promise<DiscoveredDeviceListResponse> {
    this.assertCanRead(data.props);

    const scope: DiscoveredDeviceScope = this.getScope({
      projectId: data.projectId,
      siteId: data.request.siteId,
    });

    const countsStatement: DiscoveredDeviceStatement = buildCountsStatement({
      scope: scope,
      search: data.request.search,
    });
    const rowsStatement: DiscoveredDeviceStatement = buildRowsStatement({
      scope: scope,
      search: data.request.search,
      show: data.request.show,
      sort: data.request.sort,
      sortOrder: data.request.sortOrder,
      limit: data.request.limit,
      skip: data.request.skip,
    });

    const [countRows, rawRows]: [
      Array<Record<string, unknown>>,
      Array<Record<string, unknown>>,
    ] = await Promise.all([
      this.runQuery(countsStatement.sql, countsStatement.params),
      this.runQuery(rowsStatement.sql, rowsStatement.params),
    ]);

    const counts: DiscoveredDeviceCounts = readDiscoveredDeviceCounts(
      countRows[0],
    );

    const rows: Array<ClassifiedDiscoveredDevice> = rawRows.map(
      (raw: Record<string, unknown>): ClassifiedDiscoveredDevice => {
        return this.toRow(raw);
      },
    );

    await this.addNames({
      projectId: data.projectId,
      props: data.props,
      rows: rows,
    });

    return {
      rows: rows.map((row: ClassifiedDiscoveredDevice): DiscoveredDeviceRow => {
        return this.toPublicRow(row);
      }),
      count: this.countFor(counts, data.request.show),
      counts: counts,
    };
  }

  /*
   * The ids of every row the request matches, in its order, up to what one
   * bulk action takes: "select every matching row".
   */
  public static async listIds(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    request: DiscoveredDeviceListRequest;
  }): Promise<{ ids: Array<string>; count: number }> {
    this.assertCanRead(data.props);

    const scope: DiscoveredDeviceScope = this.getScope({
      projectId: data.projectId,
      siteId: data.request.siteId,
    });

    const countsStatement: DiscoveredDeviceStatement = buildCountsStatement({
      scope: scope,
      search: data.request.search,
    });
    const idsStatement: DiscoveredDeviceStatement = buildIdsStatement({
      scope: scope,
      search: data.request.search,
      show: data.request.show,
      sort: data.request.sort,
      sortOrder: data.request.sortOrder,
      limit: MAX_DISCOVERED_DEVICES_PER_ACTION,
    });

    const [countRows, idRows]: [
      Array<Record<string, unknown>>,
      Array<Record<string, unknown>>,
    ] = await Promise.all([
      this.runQuery(countsStatement.sql, countsStatement.params),
      this.runQuery(idsStatement.sql, idsStatement.params),
    ]);

    return {
      ids: unique(
        idRows.map((row: Record<string, unknown>): string | undefined => {
          return text(row["id"]);
        }),
      ),
      count: this.countFor(
        readDiscoveredDeviceCounts(countRows[0]),
        data.request.show,
      ),
    };
  }

  /*
   * These rows, classified, read as root: what a bulk action or an import
   * acts on. The caller has checked the person. Rows not found are left out.
   */
  public static async classify(data: {
    projectId: ObjectID;
    endpointIds: Array<string>;
  }): Promise<Array<ClassifiedDiscoveredDevice>> {
    const rows: Array<ClassifiedDiscoveredDevice> = [];

    for (const ids of chunk(data.endpointIds, WRITE_CHUNK_SIZE)) {
      const statement: DiscoveredDeviceStatement = buildClassifyStatement(
        this.getScope({ projectId: data.projectId, endpointIds: ids }),
      );

      for (const raw of await this.runQuery(statement.sql, statement.params)) {
        rows.push(this.toRow(raw));
      }
    }

    return rows;
  }

  // ---- The map.

  public static async hideFromMap(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    endpointIds: Array<string>;
  }): Promise<DiscoveredDeviceMapChange> {
    this.assertCanRead(data.props);
    this.assertCanChangeMap(data.props, DatabaseRequestType.Create);

    const rows: Array<ClassifiedDiscoveredDevice> = await this.classify({
      projectId: data.projectId,
      endpointIds: data.endpointIds,
    });

    const notMonitored: Array<ClassifiedDiscoveredDevice> = rows.filter(
      (row: ClassifiedDiscoveredDevice): boolean => {
        return !row.monitoredDevice;
      },
    );
    const toHide: Array<ClassifiedDiscoveredDevice> = notMonitored.filter(
      (row: ClassifiedDiscoveredDevice): boolean => {
        return !row.isHidden;
      },
    );

    let changed: number = 0;

    for (const part of chunk(toHide, WRITE_CHUNK_SIZE)) {
      const statement: DiscoveredDeviceStatement = buildHideStatement({
        projectId: data.projectId.toString(),
        userId: data.props.userId?.toString(),
        reason: HIDDEN_FROM_LIST_REASON,
        rows: part.map(
          (
            row: ClassifiedDiscoveredDevice,
          ): { id: string; nodeKey: string; nodeName: string } => {
            return {
              id: ObjectID.generate().toString(),
              nodeKey: getEndpointNodeKey(row.id),
              nodeName: row.name.substring(0, MAX_NODE_NAME_LENGTH),
            };
          },
        ),
      });

      changed += (await this.runQuery(statement.sql, statement.params)).length;
    }

    return {
      changed: changed,
      unchanged: notMonitored.length - changed,
      skippedMonitored: rows.length - notMonitored.length,
      notFound: data.endpointIds.length - rows.length,
    };
  }

  public static async showOnMap(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    endpointIds: Array<string>;
  }): Promise<DiscoveredDeviceMapChange> {
    this.assertCanRead(data.props);
    this.assertCanChangeMap(data.props, DatabaseRequestType.Delete);

    const rows: Array<ClassifiedDiscoveredDevice> = await this.classify({
      projectId: data.projectId,
      endpointIds: data.endpointIds,
    });

    let changed: number = 0;

    for (const part of chunk(rows, WRITE_CHUNK_SIZE)) {
      const statement: DiscoveredDeviceStatement = buildShowStatement({
        projectId: data.projectId.toString(),
        nodeKeys: part.map((row: ClassifiedDiscoveredDevice): string => {
          return getEndpointNodeKey(row.id);
        }),
      });

      changed += (await this.runQuery(statement.sql, statement.params)).length;
    }

    return {
      changed: changed,
      unchanged: rows.length - changed,
      skippedMonitored: 0,
      notFound: data.endpointIds.length - rows.length,
    };
  }

  /*
   * Every hidden node of the map shown again - devices, peers and
   * endpoints - in one statement: the map's "Show them". It used to remove
   * them one request at a time from the browser, which a few thousand rows
   * hidden from the list would have turned into minutes.
   */
  public static async showEverythingOnMap(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<{ changed: number }> {
    this.assertCanChangeMap(data.props, DatabaseRequestType.Delete);

    const statement: DiscoveredDeviceStatement = buildShowStatement({
      projectId: data.projectId.toString(),
    });

    return {
      changed: (await this.runQuery(statement.sql, statement.params)).length,
    };
  }

  // ---- Rows.

  public static countFor(
    counts: DiscoveredDeviceCounts,
    show: DiscoveredDeviceShow,
  ): number {
    switch (show) {
      case DiscoveredDeviceShow.NotMonitored:
        return counts.notMonitored;
      case DiscoveredDeviceShow.Monitored:
        return counts.monitored;
      case DiscoveredDeviceShow.Hidden:
        return counts.hidden;
      case DiscoveredDeviceShow.All:
        return counts.all;
    }
  }

  public static toRow(
    raw: Record<string, unknown>,
  ): ClassifiedDiscoveredDevice {
    const macAddress: string = text(raw["macAddress"]) || "";
    const ipAddress: string | undefined = text(raw["ipAddress"]);
    const hostname: string | undefined = text(raw["hostname"]);
    const classification: string | undefined = text(raw["classification"]);
    const monitoredDeviceId: string | undefined = text(
      raw["monitoredDeviceId"],
    );

    const row: ClassifiedDiscoveredDevice = {
      id: text(raw["id"]) || "",
      name:
        getDiscoveredDeviceName({
          classification: classification,
          hostname: hostname,
          ipAddress: ipAddress,
          macAddress: macAddress,
        }) || macAddress,
      macAddress: macAddress,
      isSeenRecently: raw["isSeenRecently"] === true,
      isFromController: raw["isFromController"] === true,
      isHidden: !monitoredDeviceId && raw["isHidden"] === true,
    };

    if (ipAddress) {
      row.ipAddress = ipAddress;
    }

    if (hostname) {
      row.hostname = hostname;
    }

    if (classification) {
      row.classification = classification;
    }

    const vendor: string | undefined = text(raw["vendor"]);

    if (vendor) {
      row.vendor = vendor;
    }

    const portName: string | undefined = text(raw["attachedPortName"]);

    if (portName) {
      row.portName = portName;
    }

    const vlanId: number = Number(raw["vlanId"]);

    if (
      raw["vlanId"] !== null &&
      raw["vlanId"] !== undefined &&
      Number.isInteger(vlanId)
    ) {
      row.vlanId = vlanId;
    }

    const firstSeenAt: string | undefined = isoDate(raw["firstSeenAt"]);
    const lastSeenAt: string | undefined = isoDate(raw["lastSeenAt"]);

    if (firstSeenAt) {
      row.firstSeenAt = firstSeenAt;
    }

    if (lastSeenAt) {
      row.lastSeenAt = lastSeenAt;
    }

    const seenOnDeviceId: string | undefined = text(
      raw["attachedNetworkDeviceId"],
    );

    if (seenOnDeviceId) {
      row.seenOnDeviceId = seenOnDeviceId;
      row.seenOn = { id: seenOnDeviceId };
    }

    const siteId: string | undefined = text(raw["siteId"]);

    if (siteId) {
      row.siteId = siteId;
      row.site = { id: siteId };
    }

    if (monitoredDeviceId) {
      row.monitoredDevice = { id: monitoredDeviceId };
      row.monitoredBy =
        raw["monitoredBy"] === DiscoveredDeviceMatch.IpAddress
          ? DiscoveredDeviceMatch.IpAddress
          : DiscoveredDeviceMatch.MacAddress;
    }

    return row;
  }

  private static toPublicRow(
    row: ClassifiedDiscoveredDevice,
  ): DiscoveredDeviceRow {
    const publicRow: ClassifiedDiscoveredDevice = { ...row };
    delete publicRow.seenOnDeviceId;
    delete publicRow.siteId;
    return publicRow;
  }

  /*
   * The names of the devices and sites a page's rows point at, read as the
   * person: what they may not read keeps its id and goes without a name.
   */
  private static async addNames(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    rows: Array<ClassifiedDiscoveredDevice>;
  }): Promise<void> {
    const deviceIds: Array<string> = unique(
      data.rows.flatMap(
        (row: ClassifiedDiscoveredDevice): Array<string | undefined> => {
          return [row.monitoredDevice?.id, row.seenOn?.id];
        },
      ),
    );
    const siteIds: Array<string> = unique(
      data.rows.map((row: ClassifiedDiscoveredDevice): string | undefined => {
        return row.site?.id;
      }),
    );

    const [deviceNames, siteNames]: [Map<string, string>, Map<string, string>] =
      await Promise.all([
        this.readDeviceNames({
          projectId: data.projectId,
          props: data.props,
          ids: deviceIds,
        }),
        this.readSiteNames({
          projectId: data.projectId,
          props: data.props,
          ids: siteIds,
        }),
      ]);

    for (const row of data.rows) {
      const monitoredName: string | undefined = row.monitoredDevice
        ? deviceNames.get(row.monitoredDevice.id)
        : undefined;
      const seenOnName: string | undefined = row.seenOn
        ? deviceNames.get(row.seenOn.id)
        : undefined;
      const siteName: string | undefined = row.site
        ? siteNames.get(row.site.id)
        : undefined;

      if (row.monitoredDevice && monitoredName) {
        row.monitoredDevice.name = monitoredName;
      }

      if (row.seenOn && seenOnName) {
        row.seenOn.name = seenOnName;
      }

      if (row.site && siteName) {
        row.site.name = siteName;
      }
    }
  }

  private static async readDeviceNames(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    ids: Array<string>;
  }): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();

    if (data.ids.length === 0) {
      return names;
    }

    try {
      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(data.ids),
        },
        select: { _id: true, name: true },
        limit: data.ids.length,
        skip: 0,
        props: data.props,
      });

      for (const device of devices) {
        if (device.id && device.name) {
          names.set(device.id.toString(), device.name);
        }
      }
    } catch (error) {
      if (!isRefusal(error)) {
        throw error;
      }
    }

    return names;
  }

  private static async readSiteNames(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    ids: Array<string>;
  }): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();

    if (data.ids.length === 0) {
      return names;
    }

    try {
      const sites: Array<NetworkSite> = await NetworkSiteService.findBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(data.ids),
        },
        select: { _id: true, name: true },
        limit: data.ids.length,
        skip: 0,
        props: data.props,
      });

      for (const site of sites) {
        if (site.id && site.name) {
          names.set(site.id.toString(), site.name);
        }
      }
    } catch (error) {
      if (!isRefusal(error)) {
        throw error;
      }
    }

    return names;
  }
}
