import DataMigrationBase from "./DataMigrationBase";
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
 * Issue #8194: the Product Analytics overview filed every session of a
 * hash-routed app under the entry page "/". RumProductAnalyticsSessionV1_mv
 * wrote `entryPage` as path(entryUrl), and path() stops at the fragment, so
 * "https://shop.example.com/#/orders/42" was "/". The model now writes the
 * page as product analytics names it everywhere else, its hash route
 * included (productAnalyticsPageOfUrlSql: "/orders/42"), and this puts that
 * definition on the view an install already has.
 *
 * Boot's schema-sync creates a view that is missing, and recreates one whose
 * source, target or aggregate functions changed - this change is to an
 * expression inside one, which it does not see. So the view's query is
 * replaced in place with ALTER TABLE ... MODIFY QUERY, ON CLUSTER, the
 * model's own SELECT as boot would create it (the local source table). It
 * is one atomic change: no insert into RumSessionV1 goes by with no view to
 * file it, as it would between a DROP and a CREATE, and a process that runs
 * this at the same time as another writes the same query.
 *
 * Every session header written from then on - a session's provisional
 * header, the finalizer's, a pinned copy - files the route. The table keeps
 * a session's entry page by max(), and the route page always sorts after
 * the path it extends ("/" before "/orders/42"), so a session still being
 * recorded during the upgrade ends with its route. Sessions finished before
 * keep "/": those recorded before #7983 were stored without the route at
 * all, and the few since are not worth an INSERT ... SELECT from the
 * recordings, which could file again a session an erasure request removed
 * from product analytics. The reads group a page in one spelling, so old
 * and new rows of a page are one row (RumProductAnalyticsReadService).
 *
 * Safe to run twice, at once too: the same query is written each time.
 */
export default class ReadHashRoutesInProductAnalyticsEntryPages extends DataMigrationBase {
  public constructor() {
    super("ReadHashRoutesInProductAnalyticsEntryPages");
  }

  public static getView(): MaterializedView {
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
  public static getModifyQueryStatement(): string {
    const view: MaterializedView =
      ReadHashRoutesInProductAnalyticsEntryPages.getView();
    const create: string = applyClusterToMaterializedViewQuery(view.query);
    const select: number = create.search(/\bAS\s+SELECT\b/);

    if (select === -1) {
      throw new Error(`${view.name} has no AS SELECT`);
    }

    return `ALTER TABLE ${view.name}${onClusterClause()} MODIFY QUERY ${create
      .slice(select)
      .replace(/^AS\s+/, "")}`;
  }

  public override async migrate(): Promise<void> {
    const view: MaterializedView =
      ReadHashRoutesInProductAnalyticsEntryPages.getView();

    /*
     * Boot and the migrate Job create the views before data migrations run;
     * one that is not there is created from the model, with this query, by
     * the next boot.
     */
    if (!(await ClickHouseMigrationUtil.tableExists(view.name))) {
      logger.info(
        `ReadHashRoutesInProductAnalyticsEntryPages: ${view.name} does not exist; boot creates it from the model.`,
      );
      return;
    }

    await MetricService.execute(
      ReadHashRoutesInProductAnalyticsEntryPages.getModifyQueryStatement(),
      MigrationExecuteOptions,
    );

    logger.info(
      `ReadHashRoutesInProductAnalyticsEntryPages: ${view.name} now files a hash router's route as the entry page.`,
    );
  }

  public override async rollback(): Promise<void> {
    // The query before read every hash-routed session as "/"; nothing to restore.
    return;
  }
}
