import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import logger from "Common/Server/Utils/Logger";

/*
 * A status page resource shows a monitor or a monitor group (issue #6558):
 * StatusPageResourceService refuses a create that names neither, and an
 * update that would leave a resource with neither. Before that, the API
 * took one - a script, a Terraform resource, an MCP client that named no
 * monitor and no monitor group, or an update that cleared the one a
 * resource showed. The Dashboard never wrote one: its pickers are required,
 * and deleting a monitor or a monitor group deletes its resources.
 *
 * Such a row shows nothing to anyone. The public status page leaves it out
 * of its list (it has no status to draw), no incident, maintenance event or
 * announcement reaches it, and a subscriber who picked it was told nothing
 * through it. Only the Dashboard's Resources list drew it, by its display
 * name, beside "Same as the monitor name" with no monitor. So this deletes
 * every such row, in one statement, and says how many it deleted and on
 * which status pages, for whoever reads the worker's log. Nothing a visitor
 * or a subscriber sees changes; a subscription that named the row loses it
 * with the row (the join rows cascade), and was told nothing through it
 * either way.
 *
 * Postgres only. Idempotent: a second run finds no row that names neither,
 * and nothing writes one any more.
 */

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface DeletedRow {
  count: string | number;
  statusPageIds: string | null;
}

export default class DeleteStatusPageResourcesThatShowNothing extends DataMigrationBase {
  public constructor() {
    super("DeleteStatusPageResourcesThatShowNothing");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository = (
      StatusPageResourceService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    const tableName: string = repository.metadata.tableName;

    /*
     * The DELETE inside a SELECT, so the result is the one row of the count
     * whatever the driver hands back for a DELETE of its own.
     */
    const rows: Array<DeletedRow> = (await repository.manager.query(
      `WITH "deleted" AS (DELETE FROM "${tableName}" WHERE "monitorId" IS NULL AND "monitorGroupId" IS NULL RETURNING "_id", "statusPageId") SELECT COUNT(*) AS "count", STRING_AGG(DISTINCT "statusPageId"::text, ', ') AS "statusPageIds" FROM "deleted"`,
    )) as Array<DeletedRow>;

    const deleted: number = Number(rows[0]?.count || 0);
    const statusPageIds: string = rows[0]?.statusPageIds || "";

    logger.info(
      deleted > 0
        ? `DeleteStatusPageResourcesThatShowNothing: deleted ${deleted} status page resource(s) that showed neither a monitor nor a monitor group, on these status pages: ${statusPageIds}.`
        : "DeleteStatusPageResourcesThatShowNothing: deleted 0 status page resource(s): every resource shows a monitor or a monitor group.",
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to put back: a deleted row showed nothing, and a write that
     * would make one again is refused.
     */
    return;
  }
}
