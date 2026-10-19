import { SUBSCRIBER_COUNT_STATEMENT } from "../../../Server/Services/StatusPageSubscriberService";
import { InMemoryTable, StoredRow } from "./InMemoryRepository";
import {
  LimitTransactions,
  useInMemoryLimitTransactions,
} from "./LimitTransactionsInMemory";

/*
 * THE TRANSACTION A STATUS PAGE SUBSCRIBER IS INSERTED IN, FOR A SUITE THAT
 * HOLDS THE SUBSCRIBERS IN MEMORY (useInMemoryTable).
 *
 * A subscriber that names a contact is inserted in a transaction of its own
 * (StatusPageSubscriberService.getCreateLimit): under its page's lock - or,
 * on the Free plan, its project's - the page is asked again whether it has
 * that contact already, and the Free plan's subscribers are counted, before
 * the row is saved. This answers that transaction from the suite's table:
 * its finds read the table, the Free plan's count counts the project's rows,
 * and the row is saved into it. Call it once the table is in place.
 */
export function useInMemorySubscriberCreates(
  subscribers: InMemoryTable,
): LimitTransactions {
  return useInMemoryLimitTransactions({
    count: (statement: string, parameters: Array<unknown>): number => {
      if (statement !== SUBSCRIBER_COUNT_STATEMENT) {
        throw new Error(
          `SubscriberCreatesInMemory: no answer for "${statement}"`,
        );
      }

      const projectId: string = String(parameters[0]).toLowerCase();

      return subscribers.rows.filter((row: StoredRow): boolean => {
        return String(row["projectId"]).toLowerCase() === projectId;
      }).length;
    },
    save: async (_tableName: string, row: unknown): Promise<unknown> => {
      return await subscribers.repository.save(row);
    },
    find: async (
      _tableName: string,
      options: unknown,
    ): Promise<Array<unknown>> => {
      return (await subscribers.repository.find(options)) as Array<unknown>;
    },
  });
}
