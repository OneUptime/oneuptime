import CreateLimit from "../../Types/Database/CreateLimit";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { EntityManager } from "typeorm";

/*
 * A LIMIT ON HOW MANY ROWS OF A KIND A PROJECT MAY HAVE, DECIDED WITH THE
 * INSERT.
 *
 * Most of a plan's limits are one count held against one number: the Free
 * plan's status pages, their subscribers, its dashboards, the escalation
 * rules of each of its on-call policies. A service asks its limit twice:
 *
 *  1. early, in onBeforeCreate, so a project at its limit is told before
 *     anything is prepared;
 *  2. with the INSERT itself (DatabaseService.getCreateLimit), through the
 *     CreateLimit built here: `statement` counts the rows with the INSERT's
 *     own transaction, which holds the limit's lock in the project
 *     (ProjectLimitLock), and the create is refused once the count has
 *     reached `allowed`.
 *
 * The first answer alone is not enough: creates made at the same moment
 * each count before any of the others has written, all see room, and all
 * are added. Under the lock, each one counts once every earlier create held
 * to the same limit in the project has committed.
 *
 * `statement` is a COUNT that names its result "count" and reads only its
 * `parameters`: it runs on the transaction holding the lock, which is why it
 * is a statement and not a service read (a service read runs on another of
 * the pool's connections, outside the transaction and its lock).
 */
export default class ProjectCountLimit {
  // How many rows `statement` counts, read with `manager`.
  public static async count(data: {
    manager: EntityManager;
    statement: string;
    parameters: Array<string>;
  }): Promise<number> {
    const rows: Array<{ count: number | string }> = await data.manager.query(
      data.statement,
      data.parameters,
    );

    return Number(rows[0]?.count || 0);
  }

  /*
   * The CreateLimit of a count: refused in `refusal`'s words when the
   * project already has `allowed` rows or more.
   */
  public static getCreateLimit(data: {
    limitName: string;
    projectId: ObjectID;
    allowed: number;
    statement: string;
    parameters: Array<string>;
    refusal: string;
  }): CreateLimit {
    return {
      limitName: data.limitName,
      projectId: data.projectId,
      check: async (manager: EntityManager): Promise<void> => {
        const count: number = await ProjectCountLimit.count({
          manager: manager,
          statement: data.statement,
          parameters: data.parameters,
        });

        if (count >= data.allowed) {
          throw new BadDataException(data.refusal);
        }
      },
    };
  }
}
