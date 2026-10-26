import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorTemplateService from "Common/Server/Services/MonitorTemplateService";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import SyntheticMonitorStepsUtil, {
  SyntheticListsFillResult,
} from "Common/Utils/Monitor/SyntheticMonitorStepsUtil";

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface MonitorStepsRow {
  _id: string;
  monitorSteps: JSONObject | string | null;
}

export const PAGE_SIZE: number = 500;

/*
 * Gives every Synthetic monitor and Synthetic monitor template a browser and
 * a screen size to run its script in, where a step was stored without one.
 *
 * A Synthetic step runs its script once for each browser and screen size it
 * lists, so a step stored with either list empty ran nothing and never
 * failed: the monitor looked healthy forever. The form asked for both with
 * every box unticked until #4964, which made a new step start on Chromium at
 * Desktop and refused a step with none; the server refuses one too now
 * (SyntheticMonitorStepsUtil.assertRunsSomewhere). This fills in the ones
 * already stored with those same defaults, so each starts running - in
 * Chromium at a desktop size - from its next check.
 *
 * Only the empty lists are filled (SyntheticMonitorStepsUtil
 * .fillEmptyListsInJSON): a list with anything in it, and everything else in
 * the column, is left as stored. Templates first, since a template sync
 * copies a template's steps onto its monitors.
 *
 * Idempotent and safe to run twice at once: a row is written only while it
 * still holds what was read, so a second pass, or a save made meanwhile,
 * finds it done or changed and leaves it. Paged by id, so rows written
 * during the walk cannot shift a page. Written without hooks, as a stored
 * value's repair: nothing about the monitor changes but what it runs in.
 */
export default class FillSyntheticMonitorBrowsersAndScreenSizes extends DataMigrationBase {
  public constructor() {
    super("FillSyntheticMonitorBrowsersAndScreenSizes");
  }

  public override async migrate(): Promise<void> {
    await this.fillEmptyLists({
      service: MonitorTemplateService as unknown as DatabaseService<BaseModel>,
      label: "monitor template",
    });
    await this.fillEmptyLists({
      service: MonitorService as unknown as DatabaseService<BaseModel>,
      label: "monitor",
    });
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the lists filled in are what the form gives a new
     * step, and an empty list was a step that ran nothing.
     */
  }

  private async fillEmptyLists(data: {
    service: DatabaseService<BaseModel>;
    label: string;
  }): Promise<void> {
    const repository: ModelRepository = data.service.getRepository();
    const tableName: string = repository.metadata.tableName;
    let lastId: string | null = null;
    let repaired: number = 0;
    let stepsFilled: number = 0;
    let failed: number = 0;

    while (true) {
      const rows: Array<MonitorStepsRow> = (await repository.manager.query(
        `SELECT "_id", "monitorSteps" FROM "${tableName}" WHERE "monitorType" = $2 AND "monitorSteps" IS NOT NULL${
          lastId ? ` AND "_id" > $3` : ""
        } ORDER BY "_id" ASC LIMIT $1`,
        lastId
          ? [PAGE_SIZE, MonitorType.SyntheticMonitor, lastId]
          : [PAGE_SIZE, MonitorType.SyntheticMonitor],
      )) as Array<MonitorStepsRow>;

      for (const row of rows) {
        const stored: JSONObject | null =
          FillSyntheticMonitorBrowsersAndScreenSizes.parse(row.monitorSteps);

        if (!stored) {
          continue;
        }

        const result: SyntheticListsFillResult =
          SyntheticMonitorStepsUtil.fillEmptyListsInJSON(stored);

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
          stepsFilled += result.stepsFilled;
        } catch (err) {
          /*
           * One row that cannot be written must not cost the others their
           * browsers, nor halt every migration queued behind this one: the
           * row runs nothing, as it did, until it is next saved.
           */
          failed++;
          logger.error(
            `FillSyntheticMonitorBrowsersAndScreenSizes: could not fill the steps of ${data.label} ${row._id}:`,
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
      `FillSyntheticMonitorBrowsersAndScreenSizes: gave ${stepsFilled} step(s) of ${repaired} Synthetic ${data.label}(s) a browser and a screen size${
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
