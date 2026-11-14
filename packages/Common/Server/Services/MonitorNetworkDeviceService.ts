import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/MonitorNetworkDevice";
import ObjectID from "../../Types/ObjectID";

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
