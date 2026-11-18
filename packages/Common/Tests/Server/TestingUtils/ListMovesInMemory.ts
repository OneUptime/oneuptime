import DatabaseService from "../../../Server/Services/DatabaseService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getJestSpyOn } from "../../Spy";
import { InMemoryTable, StoredRow } from "./InMemoryRepository";
import { EntityManager } from "typeorm";

/*
 * THE TRANSACTION A MOVE IN A NUMBERED LIST RUNS IN, FOR A SUITE WHOSE TABLE
 * LIVES IN MEMORY (ContiguousOrder.move, issues #9573, #9609).
 *
 * A move locks every row of its list (SELECT ... FOR UPDATE), works out the
 * new numbers from the rows as the lock hands them over, and writes the
 * rows given another number in one UPDATE - all in one transaction. This
 * answers those two statements from the suite's in-memory table, whatever
 * column numbers the list (`order`, `sortOrder`, `priority`) and whether a
 * column naming the list holds an id or a text, and runs the transactions
 * one after another, as the row locks make two moves of one list run: the
 * second reads the list only once the first has written it. A write the
 * transaction makes is recorded in the table's `updates`, as any other
 * write of a row is.
 *
 * Every statement is recorded in `statements`, in order; `opened` counts
 * the transactions. A statement it does not know fails the test loudly.
 */
export interface ListMoveTransactions {
  statements: Array<string>;
  opened: number;
}

const LIST_CONDITION: RegExp = /"(\w+)" = \$(\d+)(::uuid)?/g;
const NULL_CONDITION: RegExp = /"(\w+)" IS NULL/g;
const MOVED_VALUE: RegExp = /\(\$(\d+)::uuid, \$(\d+)::integer\)/g;

const sameId: (a: unknown, b: unknown) => boolean = (
  a: unknown,
  b: unknown,
): boolean => {
  const text: (value: unknown) => string = (value: unknown): string => {
    return value === null || value === undefined
      ? ""
      : String(value).toLowerCase();
  };

  return text(a) !== "" && text(a) === text(b);
};

// Whether a row is in the list a statement's conditions name.
function inList(
  row: StoredRow,
  sql: string,
  parameters: Array<unknown>,
): boolean {
  for (const match of sql.matchAll(LIST_CONDITION)) {
    const column: string = match[1]!;
    const value: unknown = parameters[Number(match[2]) - 1];

    if (column === "_id") {
      continue;
    }

    if (!sameId(row[column], value)) {
      return false;
    }
  }

  for (const match of sql.matchAll(NULL_CONDITION)) {
    const value: unknown = row[match[1]!];

    if (value !== null && value !== undefined) {
      return false;
    }
  }

  return true;
}

export function useInMemoryListMoves<TBaseModel extends BaseModel>(data: {
  service: DatabaseService<TBaseModel>;
  table: InMemoryTable;
}): ListMoveTransactions {
  const log: ListMoveTransactions = { statements: [], opened: 0 };
  const tableName: string = data.service.getModel().tableName || "";

  const lockStatement: RegExp = new RegExp(
    `^SELECT "_id", "(\\w+)" FROM "${tableName}" WHERE .* FOR UPDATE$`,
  );
  const writeStatement: RegExp = new RegExp(
    `^UPDATE "${tableName}" AS "row" SET "(\\w+)" = "moved"\\."order"`,
  );

  // The transaction holding the list's rows now: the next waits for it.
  let held: Promise<void> = Promise.resolve();

  const manager: EntityManager = {
    query: async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<unknown> => {
      log.statements.push(sql);

      const lock: RegExpMatchArray | null = sql.match(lockStatement);

      if (lock) {
        const column: string = lock[1]!;

        return data.table.rows
          .filter((row: StoredRow): boolean => {
            return inList(row, sql, parameters || []);
          })
          .map((row: StoredRow): StoredRow => {
            return { _id: row["_id"], [column]: row[column] };
          })
          .sort((a: StoredRow, b: StoredRow): number => {
            const aId: string = String(a["_id"]).toLowerCase();
            const bId: string = String(b["_id"]).toLowerCase();
            return aId < bId ? -1 : aId > bId ? 1 : 0;
          });
      }

      const write: RegExpMatchArray | null = sql.match(writeStatement);

      if (write) {
        const column: string = write[1]!;
        const where: string = sql.slice(sql.indexOf(" WHERE "));
        let affected: number = 0;

        for (const match of sql.matchAll(MOVED_VALUE)) {
          const id: unknown = (parameters || [])[Number(match[1]) - 1];
          const order: number = Number(
            (parameters || [])[Number(match[2]) - 1],
          );

          const row: StoredRow | undefined = data.table.rows.find(
            (candidate: StoredRow): boolean => {
              return (
                sameId(candidate["_id"], id) &&
                inList(candidate, where, parameters || [])
              );
            },
          );

          if (row) {
            row[column] = order;
            data.table.updates.push({
              id: String(row["_id"]),
              set: { [column]: order },
            });
            affected++;
          }
        }

        return [[], affected];
      }

      throw new Error(`ListMovesInMemory: no answer for ${sql}`);
    },
  } as unknown as EntityManager;

  getJestSpyOn(data.service, "executeTransaction").mockImplementation(
    async (
      run: (entityManager: EntityManager) => Promise<unknown>,
    ): Promise<unknown> => {
      const before: Promise<void> = held;
      let release: () => void = (): void => {};

      held = new Promise<void>((resolve: () => void) => {
        release = resolve;
      });

      await before;
      log.opened++;

      try {
        return await run(manager);
      } finally {
        release();
      }
    },
  );

  return log;
}
