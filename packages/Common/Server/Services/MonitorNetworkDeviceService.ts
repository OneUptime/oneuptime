import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/MonitorNetworkDevice";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";

// A row whose device no longer exists in the monitor's project.
export interface RowOfGoneDevice {
  id: ObjectID;
  monitorId: ObjectID;
  networkDeviceId: ObjectID;
  projectId: ObjectID;
}

/*
 * The rows of devices that no longer exist - deleted, or never in the
 * monitor's project - in id order after `afterId`, at most `limit`. The
 * stale poll check reports the monitors watching them. One anti-join: the
 * table is small (a row per device a monitor's steps name), and each row is
 * one probe of the device's primary key.
 */
export const ROWS_OF_GONE_DEVICES_QUERY: string = `SELECT "MonitorNetworkDevice"."_id" AS "id",
  "MonitorNetworkDevice"."monitorId" AS "monitorId",
  "MonitorNetworkDevice"."networkDeviceId" AS "networkDeviceId",
  "MonitorNetworkDevice"."projectId" AS "projectId"
FROM "MonitorNetworkDevice"
WHERE "MonitorNetworkDevice"."deletedAt" IS NULL
  AND ($1::uuid IS NULL OR "MonitorNetworkDevice"."_id" > $1::uuid)
  AND NOT EXISTS (
    SELECT 1 FROM "NetworkDevice"
    WHERE "NetworkDevice"."_id" = "MonitorNetworkDevice"."networkDeviceId"
      AND "NetworkDevice"."projectId" = "MonitorNetworkDevice"."projectId"
      AND "NetworkDevice"."deletedAt" IS NULL
  )
ORDER BY "MonitorNetworkDevice"."_id"
LIMIT $2`;

/*
 * Reads which Network Device monitors watch which devices. Postgres writes
 * the rows (see the model); nothing here does.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The ids of the Network Device monitors whose steps name one of the
   * devices, in the project: one index lookup by device (the table's
   * networkDeviceId index), in keyset pages by row id - a device has a
   * handful of monitors, so one page nearly always holds them all. Each
   * monitor once, in the order its first row was read.
   *
   * As root, and held to the project: callers name devices they have
   * already checked (a poll's, a trap's, one the caller may read), and
   * read the monitors by these ids with whatever props they act under.
   * Keep the device list short - a statement names every id in it
   * (NetworkDeviceWalkUtil cuts long lists into FAN_OUT_ID_CHUNK_SIZE).
   */
  public async findMonitorIdsWatching(data: {
    projectId: ObjectID;
    deviceIds: Array<string>;
  }): Promise<Array<string>> {
    const monitorIds: Set<string> = new Set<string>();

    if (data.deviceIds.length === 0) {
      return [];
    }

    let cursor: ObjectID | undefined = undefined;

    for (;;) {
      const page: Array<Model> = await this.findBy({
        query: {
          projectId: data.projectId,
          networkDeviceId: QueryHelper.any(data.deviceIds),
          ...(cursor ? { _id: QueryHelper.greaterThan(cursor) } : {}),
        },
        select: {
          _id: true,
          monitorId: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const row of page) {
        if (row.monitorId) {
          monitorIds.add(row.monitorId.toString());
        }
      }

      const last: ObjectID | null | undefined = page[page.length - 1]?.id;

      if (page.length < LIMIT_MAX || !last) {
        return Array.from(monitorIds);
      }

      cursor = last;
    }
  }

  public async findRowsOfGoneDevices(data: {
    afterId?: ObjectID | undefined;
    limit: number;
  }): Promise<Array<RowOfGoneDevice>> {
    const rows: Array<{
      id: string;
      monitorId: string;
      networkDeviceId: string;
      projectId: string;
    }> = await this.getRepository().manager.query(ROWS_OF_GONE_DEVICES_QUERY, [
      data.afterId ? data.afterId.toString() : null,
      data.limit,
    ]);

    return rows.map(
      (row: {
        id: string;
        monitorId: string;
        networkDeviceId: string;
        projectId: string;
      }): RowOfGoneDevice => {
        return {
          id: new ObjectID(row.id),
          monitorId: new ObjectID(row.monitorId),
          networkDeviceId: new ObjectID(row.networkDeviceId),
          projectId: new ObjectID(row.projectId),
        };
      },
    );
  }
}

export default new Service();
