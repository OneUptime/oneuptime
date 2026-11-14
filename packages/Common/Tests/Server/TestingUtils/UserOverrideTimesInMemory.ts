import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import { StoredRow, rowMatchesWhere, sortRows } from "./InMemoryRepository";
import {
  LimitTransactions,
  useInMemoryLimitTransactions,
} from "./LimitTransactionsInMemory";
import { expect } from "@jest/globals";

/*
 * THE LOCK EVERY ADD OF A USER OVERRIDE - AND EVERY EDIT OF ITS TIMES - IS
 * WRITTEN UNDER, FOR A SUITE WHOSE OVERRIDES LIVE IN MEMORY.
 *
 * One person's overrides may not overlap in one scope (issue #7630). Each
 * add, and each edit that moves an override's times, is decided in a
 * transaction of its own that takes the project's lock on override times,
 * reads the person's other overrides with that transaction, and only then
 * writes (OnCallDutyPolicyUserOverrideService.getCreateLimit and
 * getUpdateLimit, ProjectLimitLock). This answers that transaction from the
 * suite's own rows: a read of the overrides reads `overrides`, a read of
 * people - the names a refusal says, the caller's time zone - reads
 * `users`, and what the transaction writes goes through the repository the
 * suite stands in for the service (its getRepository): an add is saved
 * there, an edit updated there. Everything is recorded, as
 * LimitTransactionsInMemory records it.
 */

// The table a read under the lock names, by its model's name.
const OVERRIDE_TABLE: string = "OnCallDutyPolicyUserOverride";
const USER_TABLE: string = "User";

interface FindOptions {
  where?: unknown;
  order?: Record<string, string> | undefined;
  take?: number | undefined;
}

interface OverrideRepository {
  save: (row: unknown) => Promise<unknown>;
  update?:
    | ((criteria: unknown, values: unknown) => Promise<unknown>)
    | undefined;
}

export function useUserOverrideTimesInMemory(data: {
  overrides: () => Array<StoredRow>;
  users?: (() => Array<StoredRow>) | undefined;
}): LimitTransactions {
  const repository: () => OverrideRepository = (): OverrideRepository => {
    return OnCallDutyPolicyUserOverrideService.getRepository() as unknown as OverrideRepository;
  };

  return useInMemoryLimitTransactions({
    count: (statement: string): number => {
      throw new Error(
        `UserOverrideTimesInMemory: nothing is counted under the override times lock, yet this was: ${statement}`,
      );
    },
    save: async (tableName: string, row: unknown): Promise<unknown> => {
      expect(tableName).toBe(OVERRIDE_TABLE);

      return await repository().save(row);
    },
    find: async (
      tableName: string,
      options: unknown,
    ): Promise<Array<unknown>> => {
      let rows: Array<StoredRow> = [];

      if (tableName === OVERRIDE_TABLE) {
        rows = data.overrides();
      } else if (tableName === USER_TABLE) {
        rows = data.users ? data.users() : [];
      } else {
        throw new Error(
          `UserOverrideTimesInMemory: nothing reads ${tableName} under the override times lock.`,
        );
      }

      const find: FindOptions = options as FindOptions;

      const matched: Array<StoredRow> = sortRows(
        rows.filter((row: StoredRow): boolean => {
          return rowMatchesWhere(row, find.where);
        }),
        find.order,
      );

      return find.take ? matched.slice(0, find.take) : matched;
    },
    update: async (
      tableName: string,
      criteria: unknown,
      values: unknown,
    ): Promise<unknown> => {
      expect(tableName).toBe(OVERRIDE_TABLE);

      const update: OverrideRepository["update"] = repository().update;

      if (!update) {
        throw new Error(
          "UserOverrideTimesInMemory: the suite's override repository writes no update.",
        );
      }

      return await update(criteria, values);
    },
  });
}
