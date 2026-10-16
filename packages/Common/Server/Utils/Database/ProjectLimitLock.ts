import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import UUIDColumnFilter from "../../Types/Database/UUIDColumnFilter";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import ObjectID from "../../../Types/ObjectID";
import { DataSource, EntityManager } from "typeorm";

// What a uuid's text may carry besides its 32 hex digits.
const UUID_BRACES_AND_HYPHENS: RegExp = /[{}-]/g;

/*
 * ONE LIMIT, ONE PROJECT, ONE WRITE AT A TIME.
 *
 * A limit on how many of something a project may have - active monitors on
 * its plan, seats, status pages on the Free plan - is a count and a write
 * that must be decided together. Two writes that each count before the
 * other has written both see room, and the project ends up past its limit
 * by one for every write that raced.
 *
 * run() runs the count and the write in ONE transaction that first takes a
 * transaction-scoped advisory lock named after the limit and the project
 * (pg_advisory_xact_lock). Every write held to the same limit in the same
 * project takes the same lock, so they run one after another: the second
 * one's count is read once the first one's write has committed, and sees
 * it. Other projects, and other limits of the same project, never wait for
 * each other. The lock goes with the transaction, committed or rolled back,
 * so a refused or failed write never keeps it, and there is nothing to
 * release by hand.
 *
 * Everything in the transaction has to use the manager it is handed: a read
 * or write made through a service there runs on another of the pool's
 * connections, outside the transaction and its lock - and, with every
 * connection held by a write waiting for this lock, could wait forever for
 * one. That is also why the work held under it is small: a count and the
 * write.
 *
 * Reuse for another limit: pick a name of its own (the lock is per name and
 * project), count what the limit counts with the manager, refuse when there
 * is no room, then write with the manager - DatabaseService does this for a
 * service's creates through getCreateLimit (Types/Database/CreateLimit).
 */
export default class ProjectLimitLock {
  // What the lock is taken on: the limit's name and the project.
  public static getLockKey(data: {
    limitName: string;
    projectId: ObjectID;
  }): string {
    return `project-limit:${data.limitName}:${this.getProjectKey(data.projectId)}`;
  }

  /*
   * The project, as the lock names it: its id as Postgres writes it - 32 hex
   * digits in lower case, hyphenated 8-4-4-4-12.
   *
   * Postgres reads an id in upper or mixed case, in braces, without hyphens
   * or with one after any four of its digits as the same uuid, and so does
   * every count a limit makes; OneUptime takes each of those wherever an id
   * is given (UUIDColumnFilter.isUUIDText), the project a request names
   * included. The lock is named by the uuid, never by how a request wrote
   * it: a lock per spelling would let creates that name the project
   * differently count side by side again. Text that is no uuid names no
   * project, and is refused.
   */
  public static getProjectKey(projectId: ObjectID): string {
    const text: string = projectId.toString();

    if (!UUIDColumnFilter.isUUIDText(text)) {
      throw new BadDataException(
        "Invalid project ID: a project's ID is a UUID.",
      );
    }

    const digits: string = text
      .replace(UUID_BRACES_AND_HYPHENS, "")
      .toLowerCase();

    return [
      digits.slice(0, 8),
      digits.slice(8, 12),
      digits.slice(12, 16),
      digits.slice(16, 20),
      digits.slice(20),
    ].join("-");
  }

  /*
   * The statement that takes the lock: a 64-bit hash of the key, so the
   * key's length does not matter. Two keys that hash alike only ever wait
   * for each other.
   */
  public static readonly LOCK_STATEMENT: string =
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))";

  public static async run<T>(data: {
    limitName: string;
    projectId: ObjectID;
    run: (manager: EntityManager) => Promise<T>;
  }): Promise<T> {
    if (!PostgresAppInstance.isConnected()) {
      throw new DatabaseNotConnectedException();
    }

    const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

    if (!dataSource) {
      throw new DatabaseNotConnectedException();
    }

    const lockKey: string = this.getLockKey({
      limitName: data.limitName,
      projectId: data.projectId,
    });

    return await dataSource.transaction(
      async (manager: EntityManager): Promise<T> => {
        await manager.query(this.LOCK_STATEMENT, [lockKey]);

        return await data.run(manager);
      },
    );
  }
}
