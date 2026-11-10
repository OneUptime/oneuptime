import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "../../../Models/DatabaseModels/NetworkEndpoint";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkTopologySuppression from "../../../Models/DatabaseModels/NetworkTopologySuppression";
import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import {
  DiscoveredDeviceCounts,
  DiscoveredDeviceIdsResponse,
  DiscoveredDeviceListRequest,
  DiscoveredDeviceListResponse,
  DiscoveredDeviceMapChange,
  DiscoveredDeviceMatch,
  DiscoveredDeviceRow,
  DiscoveredDeviceSelected,
  DiscoveredDeviceShow,
  MAX_DISCOVERED_DEVICES_PER_ACTION,
  getEndpointNodeKey,
  readDiscoveredDeviceCounts,
} from "../../../Types/NetworkDevice/DiscoveredDevice";
import ObjectID from "../../../Types/ObjectID";
import { getEndpointSightingWindowMs } from "../../../Utils/Monitor/NetworkTopologyUtil";
import { getDiscoveredDeviceName } from "../../../Utils/NetworkDevice/DiscoveredDeviceIdentity";
import AuditLogService from "../../Services/AuditLogService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkEndpointService from "../../Services/NetworkEndpointService";
import NetworkSiteService from "../../Services/NetworkSiteService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import TablePermission from "../../Types/Database/Permissions/TablePermission";
import QueryHelper from "../../Types/Database/QueryHelper";
import {
  DiscoveredDeviceScope,
  DiscoveredDeviceStatement,
  StatementParams,
  buildClassifyStatement,
  buildCountsStatement,
  buildIdsStatement,
  buildRetentionStatement,
  buildRowsStatement,
} from "./DiscoveredDeviceQuery";
import { readDiscoveredDeviceRetentionInDays } from "../../../Types/NetworkDevice/DiscoveredDeviceRetention";

/*
 * THE DISCOVERED DEVICES LIST, AND WHAT IT DOES IN BULK (OneUptime issue
 * #5775): see Types/NetworkDevice/DiscoveredDevice for what a row is.
 *
 * The list's statements are DiscoveredDeviceQuery's and the map's writes
 * are here, all run as root, so every entry point here checks the person
 * first:
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
 *
 * Every suppression a bulk action writes or removes is in the project's
 * audit log, by the person who hid or showed it, as the map's own Hide and
 * Show are. Those go through DatabaseService, which records them; a bulk
 * action writes in one statement, round DatabaseService's hooks, so it
 * records its own entries (HookFreeWritesAreRecorded holds it to that). A
 * node that was hidden already, or was not hidden, adds no entry.
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

// What a map write answers of each suppression: what its audit log entry records.
const SUPPRESSION_COLUMNS: string = `"_id", "nodeKey", "nodeName", "reason", "createdByUserId"`;

// How many audit log entries are written at once.
const AUDIT_LOG_ENTRIES_AT_ONCE: number = 10;

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

// A column as it is stored, untrimmed; undefined only when it holds nothing.
function stored(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
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

    // How long a device nothing sees stays: the list says so (issue #6389).
    const retentionStatement: DiscoveredDeviceStatement =
      buildRetentionStatement(data.projectId.toString());

    const [countRows, rawRows, retentionRows]: [
      Array<Record<string, unknown>>,
      Array<Record<string, unknown>>,
      Array<Record<string, unknown>>,
    ] = await Promise.all([
      this.runQuery(countsStatement.sql, countsStatement.params),
      this.runQuery(rowsStatement.sql, rowsStatement.params),
      this.runQuery(retentionStatement.sql, retentionStatement.params),
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

    const retentionInDays: number | undefined =
      readDiscoveredDeviceRetentionInDays(
        retentionRows[0]?.["retentionInDays"],
      );

    return {
      rows: rows.map((row: ClassifiedDiscoveredDevice): DiscoveredDeviceRow => {
        return this.toPublicRow(row);
      }),
      count: this.countFor(counts, data.request.show),
      counts: counts,
      ...(retentionInDays !== undefined
        ? { retentionInDays: retentionInDays }
        : {}),
    };
  }

  /*
   * Every row the request matches, named, in its order, up to what one bulk
   * action takes: "select every matching row".
   */
  public static async listIds(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    request: DiscoveredDeviceListRequest;
  }): Promise<DiscoveredDeviceIdsResponse> {
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

    const devices: Array<DiscoveredDeviceSelected> = [];
    const seen: Set<string> = new Set<string>();

    for (const raw of idRows) {
      const row: ClassifiedDiscoveredDevice = this.toRow(raw);

      if (!row.id || seen.has(row.id)) {
        continue;
      }

      seen.add(row.id);
      devices.push({
        id: row.id,
        name: row.name,
        ...(row.ipAddress ? { ipAddress: row.ipAddress } : {}),
        ...(row.monitoredDevice ? { isMonitored: true } : {}),
      });
    }

    return {
      devices: devices,
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

    const changedKeys: Set<string> = new Set<string>();

    for (const part of chunk(toHide, WRITE_CHUNK_SIZE)) {
      for (const hidden of await this.writeSuppressions({
        projectId: data.projectId,
        props: data.props,
        rows: part,
      })) {
        changedKeys.add(hidden.nodeKey || "");
      }
    }

    return this.toMapChange({
      endpointIds: data.endpointIds,
      rows: rows,
      changedKeys: changedKeys,
    });
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

    const changedKeys: Set<string> = new Set<string>();

    for (const part of chunk(rows, WRITE_CHUNK_SIZE)) {
      for (const shown of await this.removeSuppressions({
        projectId: data.projectId,
        props: data.props,
        nodeKeys: part.map((row: ClassifiedDiscoveredDevice): string => {
          return getEndpointNodeKey(row.id);
        }),
      })) {
        changedKeys.add(shown.nodeKey || "");
      }
    }

    /*
     * A monitored row is not on the map as an endpoint, so it has nothing
     * to show: it is told apart only when hiding.
     */
    return this.toMapChange({
      endpointIds: data.endpointIds,
      rows: rows,
      changedKeys: changedKeys,
      isShowing: true,
    });
  }

  /*
   * Each selected id, by what happened to it: changed (its node key was
   * written or removed), monitored, left as it was, or not found.
   */
  private static toMapChange(data: {
    endpointIds: Array<string>;
    rows: Array<ClassifiedDiscoveredDevice>;
    changedKeys: Set<string>;
    isShowing?: boolean | undefined;
  }): DiscoveredDeviceMapChange {
    const change: DiscoveredDeviceMapChange = {
      changedIds: [],
      unchangedIds: [],
      monitoredIds: [],
      notFoundIds: [],
    };
    const found: Map<string, ClassifiedDiscoveredDevice> = new Map<
      string,
      ClassifiedDiscoveredDevice
    >();

    for (const row of data.rows) {
      found.set(row.id.toLowerCase(), row);
    }

    for (const id of data.endpointIds) {
      const row: ClassifiedDiscoveredDevice | undefined = found.get(
        id.toLowerCase(),
      );

      if (!row) {
        change.notFoundIds.push(id);
      } else if (data.changedKeys.has(getEndpointNodeKey(row.id))) {
        change.changedIds.push(id);
      } else if (row.monitoredDevice && !data.isShowing) {
        change.monitoredIds.push(id);
      } else {
        change.unchangedIds.push(id);
      }
    }

    return change;
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

    const shown: Array<NetworkTopologySuppression> =
      await this.removeSuppressions({
        projectId: data.projectId,
        props: data.props,
      });

    return { changed: shown.length };
  }

  /*
   * Suppressions for these rows' endpoint nodes, those not hidden already,
   * in one statement however many there are - hiding three thousand rows one
   * create at a time would outlive the request - with the columns the
   * model's own create writes, `version` included (it has no database
   * default). Answers the ones it wrote, each recorded in the audit log as a
   * Create by the person who hid it.
   *
   * Both map writes answer through a SELECT over their RETURNING rows:
   * TypeORM's Postgres driver answers a bare DELETE or UPDATE with
   * [rows, rowCount] rather than the rows, so a count read off it would
   * always be two.
   */
  private static async writeSuppressions(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    rows: Array<ClassifiedDiscoveredDevice>;
  }): Promise<Array<NetworkTopologySuppression>> {
    const params: StatementParams = new StatementParams();
    const project: string = params.add(data.projectId.toString());
    const user: string = params.add(data.props.userId?.toString() || null);
    const reason: string = params.add(HIDDEN_FROM_LIST_REASON);
    const ids: string = params.add(
      data.rows.map((): string => {
        return ObjectID.generate().toString();
      }),
    );
    const keys: string = params.add(
      data.rows.map((row: ClassifiedDiscoveredDevice): string => {
        return getEndpointNodeKey(row.id);
      }),
    );
    const names: string = params.add(
      data.rows.map((row: ClassifiedDiscoveredDevice): string => {
        return row.name.substring(0, MAX_NODE_NAME_LENGTH);
      }),
    );

    const written: Array<NetworkTopologySuppression> = (
      await this.runQuery(
        `WITH added AS (
INSERT INTO "NetworkTopologySuppression"
  ("_id", "createdAt", "updatedAt", "version", "projectId", "nodeKey", "nodeName", "reason", "createdByUserId")
SELECT v."id"::uuid, now(), now(), 1, ${project}::uuid, v."nodeKey", v."nodeName", ${reason}, ${user}::uuid
FROM unnest(${ids}::text[], ${keys}::text[], ${names}::text[]) AS v("id", "nodeKey", "nodeName")
WHERE NOT EXISTS (
  SELECT 1 FROM "NetworkTopologySuppression" s
  WHERE s."projectId" = ${project}::uuid
    AND s."nodeKey" = v."nodeKey"
    AND s."deletedAt" IS NULL
)
RETURNING ${SUPPRESSION_COLUMNS}
)
SELECT ${SUPPRESSION_COLUMNS} FROM added`,
        params.values,
      )
    ).map((raw: Record<string, unknown>): NetworkTopologySuppression => {
      return this.toSuppression(data.projectId, raw);
    });

    await this.recordInAuditLog({
      action: AuditLogAction.Create,
      suppressions: written,
      props: data.props,
    });

    return written;
  }

  /*
   * Removes suppressions - these node keys, or with none given every one of
   * the project's - the way a person's restore of one node removes it.
   * Answers the ones it removed, each recorded in the audit log as a Delete
   * by the person who showed it.
   */
  private static async removeSuppressions(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    nodeKeys?: Array<string> | undefined;
  }): Promise<Array<NetworkTopologySuppression>> {
    const params: StatementParams = new StatementParams();
    const project: string = params.add(data.projectId.toString());
    const filters: Array<string> = [`"projectId" = ${project}::uuid`];

    if (data.nodeKeys) {
      filters.push(`"nodeKey" = ANY(${params.add(data.nodeKeys)}::text[])`);
    }

    const removed: Array<NetworkTopologySuppression> = (
      await this.runQuery(
        `WITH removed AS (
DELETE FROM "NetworkTopologySuppression"
WHERE ${filters.join(" AND ")}
RETURNING ${SUPPRESSION_COLUMNS}
)
SELECT ${SUPPRESSION_COLUMNS} FROM removed`,
        params.values,
      )
    ).map((raw: Record<string, unknown>): NetworkTopologySuppression => {
      return this.toSuppression(data.projectId, raw);
    });

    await this.recordInAuditLog({
      action: AuditLogAction.Delete,
      suppressions: removed,
      props: data.props,
    });

    return removed;
  }

  // A suppression as a map write's RETURNING row has it.
  private static toSuppression(
    projectId: ObjectID,
    raw: Record<string, unknown>,
  ): NetworkTopologySuppression {
    const suppression: NetworkTopologySuppression =
      new NetworkTopologySuppression();
    const id: string = String(raw["_id"] || "");
    const nodeName: string | undefined = stored(raw["nodeName"]);
    const reason: string | undefined = stored(raw["reason"]);
    const createdByUserId: string = String(raw["createdByUserId"] || "");

    if (ObjectID.isValidUUID(id)) {
      suppression.id = new ObjectID(id);
    }

    suppression.projectId = projectId;
    suppression.nodeKey = String(raw["nodeKey"]);

    if (nodeName !== undefined) {
      suppression.nodeName = nodeName;
    }

    if (reason !== undefined) {
      suppression.reason = reason;
    }

    if (ObjectID.isValidUUID(createdByUserId)) {
      suppression.createdByUserId = new ObjectID(createdByUserId);
    }

    return suppression;
  }

  /*
   * An entry in the project's audit log for each suppression a map write
   * wrote or removed, by the person in `props`, a few at a time: the entry
   * DatabaseService records for the map's own Hide (a Create) and Show (a
   * Delete). Every one is recorded, however many: an audit log that stops
   * after some number of changes is not one. Like every audit write, it
   * never fails the change it records (AuditLogService).
   */
  private static async recordInAuditLog(data: {
    action: AuditLogAction.Create | AuditLogAction.Delete;
    suppressions: Array<NetworkTopologySuppression>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const recorded: Array<NetworkTopologySuppression> =
      data.suppressions.filter(
        (suppression: NetworkTopologySuppression): boolean => {
          return Boolean(suppression.id);
        },
      );

    for (
      let start: number = 0;
      start < recorded.length;
      start += AUDIT_LOG_ENTRIES_AT_ONCE
    ) {
      await Promise.all(
        recorded
          .slice(start, start + AUDIT_LOG_ENTRIES_AT_ONCE)
          .map(
            async (suppression: NetworkTopologySuppression): Promise<void> => {
              if (data.action === AuditLogAction.Create) {
                await AuditLogService.recordCreate({
                  model: new NetworkTopologySuppression(),
                  createdItem: suppression,
                  props: data.props,
                });
                return;
              }

              await AuditLogService.recordDelete({
                model: new NetworkTopologySuppression(),
                deletedItem: suppression,
                itemId: suppression.id!,
                props: data.props,
              });
            },
          ),
      );
    }
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
