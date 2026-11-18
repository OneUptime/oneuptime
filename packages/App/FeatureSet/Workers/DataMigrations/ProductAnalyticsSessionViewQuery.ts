import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import RumProductAnalyticsSession from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import {
  applyClusterToMaterializedViewQuery,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import MaterializedView from "Common/Types/AnalyticsDatabase/MaterializedView";
import logger from "Common/Server/Utils/Logger";

/*
 * Puts the model's query on RumProductAnalyticsSessionV1_mv, the view that
 * files every RumSessionV1 write as a product analytics session summary,
 * for a data migration that changed an expression inside it.
 *
 * Boot's schema-sync creates a view that is missing, and recreates one whose
 * source, target or aggregate functions changed - a change to an expression
 * inside one it does not see. So the view's query is replaced in place with
 * ALTER TABLE ... MODIFY QUERY, ON CLUSTER, the model's own SELECT as boot
 * would create it (the local source table). It is one atomic change: no
 * insert into RumSessionV1 goes by with no view to file it, as it would
 * between a DROP and a CREATE, and a process that runs it at the same time
 * as another writes the same query. Safe to run twice for the same reason.
 *
 * The view folds a session's writes by max(), so a session recorded during
 * the upgrade ends with what the newer expression files for it.
 */

export function getProductAnalyticsSessionView(): MaterializedView {
  const view: MaterializedView | undefined = new RumProductAnalyticsSession()
    .materializedViews[0];

  if (!view) {
    throw new Error("RumProductAnalyticsSession declares no view");
  }

  return view;
}

/*
 * The model's SELECT as boot creates the view (cluster form: the local
 * source table), set as the view's query.
 */
export function getProductAnalyticsSessionViewModifyQueryStatement(): string {
  const view: MaterializedView = getProductAnalyticsSessionView();
  const create: string = applyClusterToMaterializedViewQuery(view.query);
  const select: number = create.search(/\bAS\s+SELECT\b/);

  if (select === -1) {
    throw new Error(`${view.name} has no AS SELECT`);
  }

  return `ALTER TABLE ${view.name}${onClusterClause()} MODIFY QUERY ${create
    .slice(select)
    .replace(/^AS\s+/, "")}`;
}

/*
 * Replaces the view's query, for the migration named. A view that is not
 * there is left alone: boot and the migrate Job create the views before data
 * migrations run, so the next boot creates it from the model, with the query
 * already. A statement that fails throws, so the migration is tried again.
 */
export async function replaceProductAnalyticsSessionViewQuery(data: {
  migrationName: string;
  outcome: string;
}): Promise<void> {
  const view: MaterializedView = getProductAnalyticsSessionView();

  if (!(await ClickHouseMigrationUtil.tableExists(view.name))) {
    logger.info(
      `${data.migrationName}: ${view.name} does not exist; boot creates it from the model.`,
    );
    return;
  }

  await MetricService.execute(
    getProductAnalyticsSessionViewModifyQueryStatement(),
    MigrationExecuteOptions,
  );

  logger.info(`${data.migrationName}: ${view.name} ${data.outcome}`);
}
