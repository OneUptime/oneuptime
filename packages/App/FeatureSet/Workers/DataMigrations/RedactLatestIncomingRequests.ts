import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";

/*
 * An Incoming Request monitor's latest request was kept once, as it came,
 * in the column everyone who can read the monitor reads
 * (Monitor.incomingMonitorRequest). Since #6402 it is kept twice: as it
 * came, for the heartbeat job alone (incomingMonitorRequestAsReceived), and
 * as people read it, cut as the monitor's logs are, by its Keep request
 * content switch (LatestIncomingRequest). Each monitor's request is split
 * so (MonitorService.rewriteLatestIncomingRequestForReaders): the request
 * as it came moves beside the copy, and the copy is cut. A request a server
 * from before the split writes later, while the upgrade runs, the heartbeat
 * job splits (CheckHeartbeat).
 *
 * Postgres only. A monitor is written only while it still holds what was
 * read, so a request that came in meanwhile - which wrote both copies
 * itself - is never overwritten. Idempotent: a monitor split already is
 * written with the same two copies again.
 */

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface MonitorIdRow {
  _id: string;
}

export const PAGE_SIZE: number = 500;

export default class RedactLatestIncomingRequests extends DataMigrationBase {
  public constructor() {
    super("RedactLatestIncomingRequests");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository = (
      MonitorService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    const tableName: string = repository.metadata.tableName;
    let lastId: string | null = null;
    let split: number = 0;
    let failed: number = 0;

    while (true) {
      const rows: Array<MonitorIdRow> = (await repository.manager.query(
        `SELECT "_id" FROM "${tableName}" WHERE "incomingMonitorRequest" IS NOT NULL AND "deletedAt" IS NULL${
          lastId ? ` AND "_id" > $2` : ""
        } ORDER BY "_id" ASC LIMIT $1`,
        lastId ? [PAGE_SIZE, lastId] : [PAGE_SIZE],
      )) as Array<MonitorIdRow>;

      for (const row of rows) {
        try {
          if (
            await MonitorService.rewriteLatestIncomingRequestForReaders(
              new ObjectID(row._id),
            )
          ) {
            split++;
          }
        } catch (err) {
          /*
           * One monitor that fails holds no other back: its next request,
           * or the heartbeat job, splits it.
           */
          failed++;
          logger.error(
            `RedactLatestIncomingRequests: the latest request of monitor ${row._id} was not split.`,
          );
          logger.error(err);
        }
      }

      if (rows.length < PAGE_SIZE) {
        break;
      }

      lastId = rows[rows.length - 1]!._id;
    }

    logger.info(
      `RedactLatestIncomingRequests: the latest request of ${split} monitors split, ${failed} failed.`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
