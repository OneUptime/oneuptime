import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorTemplateService from "Common/Server/Services/MonitorTemplateService";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import MonitorStepsIdentityUtil, {
  MonitorStepsJSONIdentityResult,
} from "Common/Utils/Monitor/MonitorStepsIdentityUtil";

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface MonitorStepsRow {
  _id: string;
  monitorSteps: JSONObject | string | null;
}

export const PAGE_SIZE: number = 500;

/*
 * Gives the steps of every monitor and monitor template the ids an API
 * client never sent.
 *
 * The server used to give ids only to the criteria of a monitor's steps, so a
 * monitor written through the API - every monitor the Terraform provider
 * made - was stored with a step that had no id, and incident and alert
 * templates with none either. A probe filed each result of such a step under
 * "", which the monitor page drops ("No check has completed yet" on a
 * monitor checked every minute), and its incidents were stored without the
 * template id auto-resolve looked for. 538 monitors in 10 projects were in
 * that state when this was found.
 *
 * The server owns these ids on every write now (MonitorStepsIdentityUtil);
 * this fills in the ones already at rest. It only adds what is missing: an id
 * a row already has is never changed, because probe results, incidents and
 * template syncs already point at it, and nothing else in the column is
 * rewritten (the JSON is edited as stored, not parsed and re-serialized). The
 * default monitor status is left as it is: filling it in would change what a
 * monitor that matches no criteria does, and that is the owner's call - the
 * next write of its steps fills it in, as a new monitor gets it.
 *
 * Idempotent and safe to run twice at once: a row is written only while it
 * still holds what was read, so a second pass, or a save made meanwhile,
 * finds it already done or changed and leaves it. Paged by id, so rows
 * written during the walk cannot shift a page.
 */
export default class AddMissingIdsToMonitorSteps extends DataMigrationBase {
  public constructor() {
    super("AddMissingIdsToMonitorSteps");
  }

  public override async migrate(): Promise<void> {
    // Templates first: a template sync copies a template's steps, ids and all.
    await this.addMissingIds({
      service: MonitorTemplateService as unknown as DatabaseService<BaseModel>,
      label: "monitor template",
    });
    await this.addMissingIds({
      service: MonitorService as unknown as DatabaseService<BaseModel>,
      label: "monitor",
    });
  }

  public override async rollback(): Promise<void> {
    // The ids added are as valid as any the server gives; nothing to undo.
  }

  private async addMissingIds(data: {
    service: DatabaseService<BaseModel>;
    label: string;
  }): Promise<void> {
    const repository: ModelRepository = data.service.getRepository();
    const tableName: string = repository.metadata.tableName;
    let lastId: string | null = null;
    let repaired: number = 0;
    let failed: number = 0;

    while (true) {
      const rows: Array<MonitorStepsRow> = (await repository.manager.query(
        `SELECT "_id", "monitorSteps" FROM "${tableName}" WHERE "monitorSteps" IS NOT NULL${
          lastId ? ` AND "_id" > $2` : ""
        } ORDER BY "_id" ASC LIMIT $1`,
        lastId ? [PAGE_SIZE, lastId] : [PAGE_SIZE],
      )) as Array<MonitorStepsRow>;

      for (const row of rows) {
        const stored: JSONObject | null = AddMissingIdsToMonitorSteps.parse(
          row.monitorSteps,
        );

        if (!stored) {
          continue;
        }

        const result: MonitorStepsJSONIdentityResult =
          MonitorStepsIdentityUtil.assignIdsInJSON({ monitorSteps: stored });

        if (!result.changed) {
          continue;
        }

        try {
          await repository.manager.query(
            `UPDATE "${tableName}" SET "monitorSteps" = $1 WHERE "_id" = $2 AND "monitorSteps" = $3::jsonb`,
            [
              JSON.stringify(result.monitorSteps),
              row._id,
              JSON.stringify(stored),
            ],
          );
          repaired++;
        } catch (err) {
          /*
           * One row that cannot be written must not cost the others their
           * ids, nor halt every migration queued behind this one: the row
           * keeps working as it did, and its next save gives it the ids.
           */
          failed++;
          logger.error(
            `AddMissingIdsToMonitorSteps: could not add ids to ${data.label} ${row._id}:`,
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
      `AddMissingIdsToMonitorSteps: added missing ids to the steps of ${repaired} ${data.label}(s)${
        failed ? `; ${failed} could not be written` : ""
      }.`,
    );
  }

  // jsonb comes back parsed; a driver configured otherwise hands back text.
  private static parse(value: JSONObject | string | null): JSONObject | null {
    if (!value) {
      return null;
    }

    if (typeof value === "string") {
      try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === "object"
          ? (parsed as JSONObject)
          : null;
      } catch {
        return null;
      }
    }

    return typeof value === "object" ? value : null;
  }
}
