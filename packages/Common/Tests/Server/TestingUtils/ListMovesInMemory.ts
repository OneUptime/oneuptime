import DatabaseService from "../../../Server/Services/DatabaseService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getJestSpyOn } from "../../Spy";
import { InMemoryTable, StoredRow } from "./InMemoryRepository";
import { EntityManager } from "typeorm";

/*
 * THE TRANSACTION A MOVE IN AN ORDERED LIST RUNS IN, FOR A SUITE WHOSE TABLE
 * LIVES IN MEMORY (ContiguousOrder.move, issues #9573 and #9609).
 *
 * A move locks every row of its list (SELECT ... FOR UPDATE), works out the
 * new numbers from the rows as the lock hands them over, and writes the
 * rows given another number in one UPDATE - all in one transaction. This
 * answers those two statements from the suite's in-memory table, and runs
 * the transactions one after another, as the row locks make two moves of
 * one list run: the second reads the list only once the first has written
 * it. A write the transaction makes is recorded in the table's `updates`,
 * as any other write of a row is.
 *
 * The list's number column is the statements' own (`order`, `priority`,
 * `sortOrder`), and a list may be named by a kind as well as by ids (a
 * public note approval step's event type, compared as text).
 *
 * Every statement is recorded in `statements`, in order; `opened` counts
 * the transactions. A statement it does not know fails the test loudly.
 */
export interface ListMoveTransactions {
  statements: Array<string>;
  opened: number;
}

// A column holding the value a parameter names: an id, or a kind.
const LIST_CONDITION: RegExp = /"(\w+)" = \$(\d+)(?:::uuid)?(?=\s|$)/g;
const NULL_CONDITION: RegExp = /"(\w+)" IS NULL/g;
const MOVED_VALUE: RegExp = /\(\$(\d+)::uuid, \$(\d+)::integer\)/g;
// The lock of a list's rows: its number column, read as "order".
const LOCK: RegExp =
  /^SELECT "_id", "(\w+)" AS "order", "createdAt" FROM "(\w+)" WHERE .* FOR UPDATE$/;
// The write of the rows given another number: its number column.
const WRITE: RegExp = /^UPDATE "(\w+)" AS "row" SET "(\w+)" = "moved"\."order"/;

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

  // The transaction holding the list's rows now: the next waits for it.
  let held: Promise<void> = Promise.resolve();

  const manager: EntityManager = {
    query: async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<unknown> => {
      log.statements.push(sql);

      const lock: RegExpMatchArray | null = sql.match(LOCK);

      if (lock && lock[2] === tableName) {
        const column: string = lock[1]!;

        return data.table.rows
          .filter((row: StoredRow): boolean => {
            return inList(row, sql, parameters || []);
          })
          .map((row: StoredRow): StoredRow => {
            return {
              _id: row["_id"],
              order: row[column],
              createdAt: row["createdAt"],
            };
          })
          .sort((a: StoredRow, b: StoredRow): number => {
            const aId: string = String(a["_id"]).toLowerCase();
            const bId: string = String(b["_id"]).toLowerCase();
            return aId < bId ? -1 : aId > bId ? 1 : 0;
          });
      }

      const write: RegExpMatchArray | null = sql.match(WRITE);

      if (write && write[1] === tableName) {
        const column: string = write[2]!;
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
