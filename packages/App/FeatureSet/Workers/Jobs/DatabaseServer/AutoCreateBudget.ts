import logger from "Common/Server/Utils/Logger";
import DatabaseServerService from "Common/Server/Services/DatabaseServerService";
import ObjectID from "Common/Types/ObjectID";

/*
 * The per-project auto-create budget as the discovery jobs apply it
 * (DatabaseServerService.getAutoCreateBudget — default 500 discovered,
 * non-archived rows per project, collector-created rows included). The
 * collector path at ingest has no run to hang this on and applies the same
 * budget itself, from a per-process cache, inside
 * DatabaseServerService.findOrCreateByEndpoint.
 *
 * Discovery always LOOKS a database up first, without permission to create,
 * and asks the budget only on a miss: in steady state every database
 * already has its row, so a run costs no budget query at all. A project's
 * answer is remembered for the rest of the run — except that after every
 * create it is read again, so a burst of new databases (a new cluster
 * coming online) stops exactly at the budget instead of overshooting it by
 * a whole run's worth.
 *
 * Fails closed: if the count cannot be read, nothing is created this run.
 */
export default class AutoCreateBudget {
  private readonly underBudgetByProject: Map<string, boolean> = new Map<
    string,
    boolean
  >();

  public async allowsCreate(projectId: ObjectID): Promise<boolean> {
    const key: string = projectId.toString();
    const cached: boolean | undefined = this.underBudgetByProject.get(key);

    if (cached !== undefined) {
      return cached;
    }

    let underBudget: boolean = false;

    try {
      underBudget =
        await DatabaseServerService.isUnderAutoCreateBudget(projectId);
    } catch (err) {
      logger.error(
        `DatabaseServer auto-create budget check failed for project ${key}; not creating databases this run: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.underBudgetByProject.set(key, underBudget);

    return underBudget;
  }

  // A row was created: the count moved, so read it again before the next create.
  public recordCreate(projectId: ObjectID): void {
    this.underBudgetByProject.delete(projectId.toString());
  }
}
