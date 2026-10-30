import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import InfrastructureResourceBinding, {
  RESOURCE_KEYS,
} from "Common/Server/Utils/Monitor/InfrastructureResourceBinding";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";

/*
 * Binds every stored infrastructure monitor's step to its resource's id, and
 * stores its value as the resource has it (InfrastructureResourceBinding):
 * a Host, Docker or Podman step typed "Web-01 " becomes the "web-01" ingest
 * stores, and from then on a rename of the resource keeps the monitor on it.
 * A step whose value matches no resource is left as it is. Idempotent: a
 * bound step binds to the same id again.
 */

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface MonitorRow {
  _id: string;
  projectId: string;
  monitorType: string;
  monitorSteps: JSONObject | string | null;
}

export const PAGE_SIZE: number = 500;

export default class BindInfrastructureMonitorSteps extends DataMigrationBase {
  public constructor() {
    super("BindInfrastructureMonitorSteps");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository = (
      MonitorService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    const tableName: string = repository.metadata.tableName;
    const monitorTypes: Array<string> = Object.keys(RESOURCE_KEYS);
    let lastId: string | null = null;
    let bound: number = 0;
    let failed: number = 0;

    while (true) {
      const rows: Array<MonitorRow> = (await repository.manager.query(
        `SELECT "_id", "projectId", "monitorType", "monitorSteps" FROM "${tableName}" WHERE "monitorSteps" IS NOT NULL AND "monitorType" = ANY($2)${
          lastId ? ` AND "_id" > $3` : ""
        } ORDER BY "_id" ASC LIMIT $1`,
        lastId ? [PAGE_SIZE, monitorTypes, lastId] : [PAGE_SIZE, monitorTypes],
      )) as Array<MonitorRow>;

      for (const row of rows) {
        try {
          const stored: JSONObject | null =
            BindInfrastructureMonitorSteps.parse(row.monitorSteps);

          if (!stored || !row.projectId) {
            continue;
          }

          const before: string = JSON.stringify(stored);
          const monitorSteps: JSONObject = JSON.parse(before) as JSONObject;

          const changed: boolean =
            await InfrastructureResourceBinding.bindMonitorStepsJSON({
              projectId: new ObjectID(row.projectId),
              monitorType: row.monitorType as MonitorType,
              monitorStepsJSON: monitorSteps,
            });

          if (!changed) {
            continue;
          }

          await repository.manager.query(
            `UPDATE "${tableName}" SET "monitorSteps" = $1 WHERE "_id" = $2 AND "monitorSteps" = $3::jsonb`,
            [JSON.stringify(monitorSteps), row._id, before],
          );
          bound++;
        } catch (err) {
          /*
           * One monitor that cannot be bound must not hold the others back:
           * it keeps working on its value, and its next save binds it.
           */
          failed++;
          logger.error(
            `BindInfrastructureMonitorSteps: could not bind monitor ${row._id}:`,
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
      `BindInfrastructureMonitorSteps: bound the steps of ${bound} monitor(s) to their resources${
        failed ? `; ${failed} could not be written` : ""
      }.`,
    );
  }

  public override async rollback(): Promise<void> {
    // The ids are only read; a step without one works on its value as before.
  }

  // jsonb comes back parsed; a driver configured otherwise hands back text.
  public static parse(value: JSONObject | string | null): JSONObject | null {
    if (!value) {
      return null;
    }

    if (typeof value === "string") {
      try {
        return JSON.parse(value) as JSONObject;
      } catch {
        return null;
      }
    }

    return value;
  }
}
