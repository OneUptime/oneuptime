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
 * ProjectLimitLock). A suite that drives the whole create with its tables
 * in memory hands this the answers its tables give: the count each
 * statement reads, and where a row the transaction saves goes. Everything
 * the transactions did is recorded, in order: "lock", each statement, and
 * "save <table>".
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
