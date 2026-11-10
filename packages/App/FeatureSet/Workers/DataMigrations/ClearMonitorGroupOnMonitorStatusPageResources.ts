import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import logger from "Common/Server/Utils/Logger";

/*
 * A status page resource shows a monitor or a monitor group, never both
 * (StatusPageResourceService refuses a write that names both, and pointing a
 * resource at one clears the other). Before that, the dashboard's Edit
 * resource form opened the monitor picker on every resource (issue #6540):
 * saving it on a monitor group's row - or saving a monitor's row after
 * switching the picker to a monitor group - wrote the one reference and left
 * the other, so the row named both.
 *
 * Such a row is shown as its monitor: the Resources list draws it as the
 * monitor, and so does most of the status page. But its monitor group still
 * reached it elsewhere: the row's subscribers were told about incidents on
 * the group's monitors, the group could not be added to the page again
 * ("already added"), and deleting the group deleted the row with it. This
 * keeps what everyone sees - the monitor - and clears the monitor group, in
 * one statement.
 *
 * Postgres only. Idempotent: a second run finds no row that names both, and
 * nothing writes one any more.
 */

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface ClearedCountRow {
  count: string | number;
}

export default class ClearMonitorGroupOnMonitorStatusPageResources extends DataMigrationBase {
  public constructor() {
    super("ClearMonitorGroupOnMonitorStatusPageResources");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository = (
      StatusPageResourceService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    const tableName: string = repository.metadata.tableName;

    /*
     * The UPDATE inside a SELECT, so the result is the one row of the count
     * whatever the driver hands back for an UPDATE of its own.
     */
    const rows: Array<ClearedCountRow> = (await repository.manager.query(
      `WITH "cleared" AS (UPDATE "${tableName}" SET "monitorGroupId" = NULL WHERE "monitorId" IS NOT NULL AND "monitorGroupId" IS NOT NULL RETURNING "_id") SELECT COUNT(*) AS "count" FROM "cleared"`,
    )) as Array<ClearedCountRow>;

    const cleared: number = Number(rows[0]?.count || 0);

    logger.info(
      `ClearMonitorGroupOnMonitorStatusPageResources: ${cleared} status page resource(s) that named both a monitor and a monitor group now name only the monitor they showed.`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the monitor group cleared was never what the row
     * showed.
     */
    return;
  }
}
