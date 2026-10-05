import DatabaseService from "../../../Server/Services/DatabaseService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { jest } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A table in memory behind a DatabaseService, for tests that drive the real
 * create / update / delete pipeline - the hooks, the permission checks and
 * the success hooks - without Postgres.
 *
 * It answers the repository calls that pipeline makes (find, count, save,
 * update, delete) and understands the where clauses it builds: plain values,
 * TypeORM's In / Equal / Not / IsNull / And operators, and the Raw SQL that
 * QueryHelper and the permission layer write (equality, IN, NOT IN ... OR IS
 * NULL, IS NULL, IS NOT NULL, comparisons, TRUE = TRUE / FALSE). A condition
 * it does not understand fails the test loudly instead of matching quietly.
 *
 * Rows are plain objects; every value is compared as text, ids case
 * insensitively.
 */

export type StoredRow = Record<string, unknown>;

export interface InMemoryTable {
  rows: Array<StoredRow>;
  // Every update(), in order: the row id and the columns it set.
  updates: Array<{ id: string; set: StoredRow }>;
  // Every save() of a new row, in order.
  inserts: Array<StoredRow>;
  // The ids every delete() removed, in order.
  deletes: Array<string>;
  // A row's current state, by id.
  get: (id: string | ObjectID) => StoredRow | undefined;
  repository: {
    find: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
}

function normalize(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (value instanceof ObjectID) {
    return value.toString().toLowerCase();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object" && value && "_id" in value) {
    return normalize((value as StoredRow)["_id"]);
  }

  return String(value).toLowerCase();
}

function compareNumbers(
  stored: unknown,
  operator: string,
  operand: unknown,
): boolean {
  const left: number = Number(stored);
  const right: number = Number(operand);

  if (stored === null || stored === undefined || isNaN(left)) {
    return false;
  }

  switch (operator) {
    case ">=":
      return left >= right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case "<":
      return left < right;
    case "=":
      return left === right;
    default:
      throw new Error(`InMemoryRepository: unknown comparison ${operator}`);
  }
}

// Whether `stored` satisfies one Raw condition's SQL, read for alias "c".
function matchesRaw(stored: unknown, operator: FindOperator<unknown>): boolean {
  const sql: string = (operator.getSql ? operator.getSql("c") : "").trim();
  const parameters: Record<string, unknown> =
    (operator.objectLiteralParameters as Record<string, unknown>) || {};
  const storedText: string | null = normalize(stored);

  const listOf: (name: string) => Array<string | null> = (
    name: string,
  ): Array<string | null> => {
    const value: unknown = parameters[name];
    return (Array.isArray(value) ? value : [value]).map(normalize);
  };

  if (sql === "TRUE = TRUE") {
    return true;
  }

  if (sql === "TRUE = FALSE") {
    return false;
  }

  let match: RegExpMatchArray | null = sql.match(/^\(c IS NULL\)$/i);
  if (match) {
    return storedText === null;
  }

  match = sql.match(/^\(c IS NOT NULL\)$/i);
  if (match) {
    return storedText !== null;
  }

  // Values are compared as lower-cased text already, so LOWER() changes nothing.
  match = sql.match(/^\((?:c|LOWER\(c\)) = :(\w+)\)$/);
  if (match) {
    return storedText !== null && storedText === normalize(parameters[match[1]!]);
  }

  match = sql.match(/^\(c IN \(:\.\.\.(\w+)\)\)$/);
  if (match) {
    return storedText !== null && listOf(match[1]!).includes(storedText);
  }

  match = sql.match(/^\(c NOT IN \(:\.\.\.(\w+)\) or c IS NULL\)$/i);
  if (match) {
    return storedText === null || !listOf(match[1]!).includes(storedText);
  }

  match = sql.match(/^\(?c (>=|<=|>|<) :(\w+)\)?$/);
  if (match) {
    return compareNumbers(stored, match[1]!, parameters[match[2]!]);
  }

  throw new Error(`InMemoryRepository: unknown SQL condition "${sql}"`);
}

function matchesCondition(stored: unknown, condition: unknown): boolean {
  if (condition instanceof FindOperator) {
    const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

    switch (operator.type) {
      case "raw":
        return matchesRaw(stored, operator);
      case "in":
        return (operator.value as Array<unknown>)
          .map(normalize)
          .includes(normalize(stored));
      case "equal":
        return normalize(stored) === normalize(operator.value);
      case "isNull":
        return normalize(stored) === null;
      case "not":
        return !matchesCondition(stored, operator.value);
      case "and":
        return (operator.value as Array<unknown>).every((child: unknown) => {
          return matchesCondition(stored, child);
        });
      case "moreThanOrEqual":
        return compareNumbers(stored, ">=", operator.value);
      case "lessThanOrEqual":
        return compareNumbers(stored, "<=", operator.value);
      case "moreThan":
        return compareNumbers(stored, ">", operator.value);
      case "lessThan":
        return compareNumbers(stored, "<", operator.value);
      default:
        throw new Error(
          `InMemoryRepository: unknown operator "${operator.type}"`,
        );
    }
  }

  if (typeof condition === "boolean") {
    return stored === condition;
  }

  return normalize(stored) === normalize(condition);
}

export function rowMatchesWhere(row: StoredRow, where: unknown): boolean {
  if (where === undefined || where === null) {
    return true;
  }

  if (Array.isArray(where)) {
    return where.some((part: unknown) => {
      return rowMatchesWhere(row, part);
    });
  }

  for (const [column, condition] of Object.entries(where as StoredRow)) {
    if (condition === undefined) {
      continue;
    }

    if (!matchesCondition(row[column], condition)) {
      return false;
    }
  }

  return true;
}

function sortRows(
  rows: Array<StoredRow>,
  order: Record<string, string> | undefined,
): Array<StoredRow> {
  if (!order) {
    return rows;
  }

  const columns: Array<[string, string]> = Object.entries(order);

  return [...rows].sort((a: StoredRow, b: StoredRow): number => {
    for (const [column, direction] of columns) {
      const left: unknown = a[column];
      const right: unknown = b[column];

      if (left === right) {
        continue;
      }

      const sign: number = String(direction).toUpperCase() === "DESC" ? -1 : 1;

      if (left === undefined || left === null) {
        return sign;
      }

      if (right === undefined || right === null) {
        return -sign;
      }

      if (typeof left === "number" && typeof right === "number") {
        return (left - right) * sign;
      }

      return String(left).localeCompare(String(right)) * sign;
    }

    return 0;
  });
}

/*
 * Put an in-memory table behind `service`. `rows` are the rows the table
 * starts with; each needs an _id.
 */
export function useInMemoryTable<TBaseModel extends BaseModel>(
  service: DatabaseService<TBaseModel>,
  rows: Array<StoredRow>,
): InMemoryTable {
  const table: InMemoryTable = {
    rows: rows.map((row: StoredRow): StoredRow => {
      return { ...row };
    }),
    updates: [],
    inserts: [],
    deletes: [],
    get: (id: string | ObjectID): StoredRow | undefined => {
      return table.rows.find((row: StoredRow) => {
        return normalize(row["_id"]) === normalize(id);
      });
    },
    repository: {} as InMemoryTable["repository"],
  };

  const toModel: (row: StoredRow) => TBaseModel = (
    row: StoredRow,
  ): TBaseModel => {
    const model: TBaseModel = new service.modelType();

    for (const [column, value] of Object.entries(row)) {
      (model as unknown as StoredRow)[column] = value;
    }

    return model;
  };

  table.repository = {
    find: jest.fn(
      async (options: {
        where?: unknown;
        skip?: number;
        take?: number;
        order?: Record<string, string>;
      }): Promise<Array<TBaseModel>> => {
        const matched: Array<StoredRow> = sortRows(
          table.rows.filter((row: StoredRow) => {
            return rowMatchesWhere(row, options.where);
          }),
          options.order,
        );

        const start: number = options.skip || 0;
        const window: Array<StoredRow> = options.take
          ? matched.slice(start, start + options.take)
          : matched.slice(start);

        return window.map(toModel);
      },
    ),
    count: jest.fn(async (options: { where?: unknown }): Promise<number> => {
      return table.rows.filter((row: StoredRow) => {
        return rowMatchesWhere(row, options.where);
      }).length;
    }),
    save: jest.fn(async (entity: TBaseModel): Promise<TBaseModel> => {
      const record: StoredRow = {};

      for (const [column, value] of Object.entries(
        entity as unknown as StoredRow,
      )) {
        if (value !== undefined && typeof value !== "function") {
          record[column] = value;
        }
      }

      if (!record["_id"]) {
        record["_id"] = ObjectID.generate().toString();
        (entity as unknown as StoredRow)["_id"] = record["_id"];
      }

      const existing: StoredRow | undefined = table.get(
        String(record["_id"]),
      );

      if (existing) {
        Object.assign(existing, record);
      } else {
        table.rows.push(record);
        table.inserts.push({ ...record });
      }

      return entity;
    }),
    update: jest.fn(
      async (where: unknown, set: StoredRow): Promise<{ affected: number }> => {
        const written: StoredRow = {};

        for (const [column, value] of Object.entries(set)) {
          if (typeof value !== "function" && column !== "version") {
            written[column] = value;
          }
        }

        let affected: number = 0;

        for (const row of table.rows) {
          if (rowMatchesWhere(row, where)) {
            Object.assign(row, written);
            table.updates.push({ id: String(row["_id"]), set: written });
            affected++;
          }
        }

        return { affected };
      },
    ),
    delete: jest.fn(async (where: unknown): Promise<{ affected: number }> => {
      const removed: Array<StoredRow> = table.rows.filter((row: StoredRow) => {
        return rowMatchesWhere(row, where);
      });

      table.rows = table.rows.filter((row: StoredRow) => {
        return !removed.includes(row);
      });

      for (const row of removed) {
        table.deletes.push(String(row["_id"]));
      }

      return { affected: removed.length };
    }),
  };

  getJestSpyOn(service, "getRepository").mockReturnValue(table.repository);
  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(undefined);
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(undefined);

  return table;
}
