import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import ProjectLimitLock from "../../../Server/Utils/Database/ProjectLimitLock";
import { DataSource, EntityManager } from "typeorm";

/*
 * THE TRANSACTION A CREATE HELD TO A LIMIT IS INSERTED IN, FOR A SUITE
 * WHOSE TABLES LIVE IN MEMORY.
 *
 * A create held to a plan's limit - seats, the Free plan's status pages,
 * subscribers, dashboards and escalation rules, active monitors
 * (DatabaseService.getCreateLimit) - is inserted in a transaction of its
 * own that first takes the limit's lock in the project, counts with that
 * transaction, and only then saves the row (insertWithinCreateLimit,
 * ProjectLimitLock). So is a status page subscriber that names a contact:
 * its page is asked, under the page's lock, whether it has that contact
 * already (StatusPageSubscriberService). A suite that drives the whole
 * create with its tables in memory hands this the answers its tables give:
 * the count each statement reads, where a row the transaction saves goes,
 * and - for a check that reads rows - what a find of a table answers.
 * Everything the transactions did is recorded, in order: "lock", each
 * statement, "find <table>" and "save <table>".
 */
export interface LimitTransactions {
  events: Array<string>;
  // How many limit transactions were opened.
  opened: number;
}

export function useInMemoryLimitTransactions(data: {
  // The count a statement reads, with its parameters.
  count: (statement: string, parameters: Array<unknown>) => number;
  // Saves a row the transaction inserts into the suite's table.
  save: (tableName: string, row: unknown) => Promise<unknown>;
  // Reads a table, with the options a repository's find is handed.
  find?:
    | ((tableName: string, options: unknown) => Promise<Array<unknown>>)
    | undefined;
}): LimitTransactions {
  const log: LimitTransactions = { events: [], opened: 0 };

  const manager: EntityManager = {
    query: async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<Array<{ count: number }>> => {
      if (sql === ProjectLimitLock.LOCK_STATEMENT) {
        log.events.push("lock");
        return [];
      }

      log.events.push(sql);

      return [{ count: data.count(sql, parameters || []) }];
    },
    getRepository: (tableName: string): unknown => {
      return {
        save: async (row: unknown): Promise<unknown> => {
          log.events.push(`save ${tableName}`);
          return await data.save(tableName, row);
        },
        find: async (options: unknown): Promise<Array<unknown>> => {
          log.events.push(`find ${tableName}`);

          if (!data.find) {
            throw new Error(
              `LimitTransactionsInMemory: no find for ${tableName}`,
            );
          }

          return await data.find(tableName, options);
        },
      };
    },
  } as unknown as EntityManager;

  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
  jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
    transaction: async (
      run: (transactionManager: EntityManager) => Promise<unknown>,
    ): Promise<unknown> => {
      log.opened++;
      return await run(manager);
    },
  } as unknown as DataSource);

  return log;
}
