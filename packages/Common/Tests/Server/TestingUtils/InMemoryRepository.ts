import DatabaseService from "../../../Server/Services/DatabaseService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { FindOperator } from "typeorm";
import { getPhoneLineSql } from "../../../Server/Utils/StatusPage/SubscriberContactSql";
import SubscriberContactKey from "../../../Types/StatusPage/SubscriberContactKey";
import { getNameKey, getNameKeySql } from "../../../Types/Database/UniqueName";

/*
 * A table in memory behind a DatabaseService, for tests that drive the real
 * create / update / delete pipeline - the hooks, the permission checks and
 * the success hooks - without Postgres.
 *
 * It answers the repository calls that pipeline makes (find, count, save,
 * update, delete) and understands the where clauses it builds: plain values,
 * TypeORM's In / Equal / Not / IsNull / And operators, and the Raw SQL that
 * QueryHelper and the permission layer write (equality, IN, NOT IN, NOT IN
 * ... OR IS NULL, IS NULL, IS NOT NULL, comparisons, TRUE = TRUE / FALSE),
 * a phone number's line (SubscriberContactSql.onPhoneLine), a name as it
 * reads (QueryHelper.findWithSameName), and a column
 * naming a private incident, alert or episode (PrivateRecordReadFilter),
 * answered from the private records a test says there are
 * (setPrivateRecords). A condition it does not understand fails the test
 * loudly instead of matching quietly.
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
    find: MockFunction;
    count: MockFunction;
    save: MockFunction;
    update: MockFunction;
    delete: MockFunction;
  };
}

/*
 * The private incidents, alerts and episodes there are, by their table, and
 * who sees each: the people it is owned by, or by a team of theirs they have
 * accepted (setPrivateRecords). A table a test says nothing of has none.
 */
const privateRecords: Map<string, Map<string, Set<string>>> = new Map();

/*
 * Says which records of `table` ("Incident") are private, and who sees each,
 * for the reads of a part that names them (PrivateRecordReadFilter). Kept
 * until clearPrivateRecords.
 */
export function setPrivateRecords(data: {
  table: string;
  records: Array<{
    id: string | ObjectID;
    seenBy?: Array<string | ObjectID> | undefined;
  }>;
}): void {
  const records: Map<string, Set<string>> = new Map();

  for (const record of data.records) {
    records.set(
      record.id.toString().toLowerCase(),
      new Set(
        (record.seenBy || []).map((who: string | ObjectID): string => {
          return who.toString().toLowerCase();
        }),
      ),
    );
  }

  privateRecords.set(data.table, records);
}

export function clearPrivateRecords(): void {
  privateRecords.clear();
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

  /*
   * A phone number on a line (SubscriberContactSql.onPhoneLine): the stored
   * number's line, as SubscriberContactKey writes it - which the SQL does.
   */
  const phoneLinePrefix: string = `(${getPhoneLineSql("c")} = :`;

  if (sql.startsWith(phoneLinePrefix) && sql.endsWith(")")) {
    const name: string = sql.slice(phoneLinePrefix.length, -1);

    return (
      storedText !== null &&
      SubscriberContactKey.forPhone(String(stored)) === String(parameters[name])
    );
  }

  /*
   * A name as it reads, the stored one and the one asked for alike
   * (QueryHelper.findWithSameName): each read here as getNameKey reads it,
   * which is how the SQL reads it.
   */
  match = sql.match(
    /^\(LOWER\(BTRIM\(REGEXP_REPLACE\(c, :(\w+), ' ', 'g'\)\)\) = LOWER\(BTRIM\(REGEXP_REPLACE\(CAST\(:(\w+) AS TEXT\), :(\w+), ' ', 'g'\)\)\)\)$/,
  );
  if (match) {
    const askedFor: string = getNameKeySql({
      textSql: `CAST(:${match[2]!} AS TEXT)`,
      patternSql: `:${match[1]!}`,
    });

    if (!sql.includes(askedFor) || match[1] !== match[3]) {
      throw new Error(
        `InMemoryRepository: a name compared with two patterns "${sql}"`,
      );
    }

    const storedKey: string = getNameKey(stored);

    return (
      storedKey.length > 0 && storedKey === getNameKey(parameters[match[2]!])
    );
  }

  // Values are compared as lower-cased text already, so LOWER() changes nothing.
  match = sql.match(/^\((?:c|LOWER\(c\)) = :(\w+)\)$/);
  if (match) {
    return (
      storedText !== null && storedText === normalize(parameters[match[1]!])
    );
  }

  // SQL's != never matches an empty value either (QueryHelper.notEquals).
  match = sql.match(/^\((?:c|LOWER\(c\)) != :(\w+)\)$/);
  if (match) {
    return (
      storedText !== null && storedText !== normalize(parameters[match[1]!])
    );
  }

  match = sql.match(/^\(c IN \(:\.\.\.(\w+)\)\)$/);
  if (match) {
    return storedText !== null && listOf(match[1]!).includes(storedText);
  }

  match = sql.match(/^\(c NOT IN \(:\.\.\.(\w+)\) or c IS NULL\)$/i);
  if (match) {
    return storedText === null || !listOf(match[1]!).includes(storedText);
  }

  // SQL's NOT IN never matches an empty value (QueryHelper.notIn).
  match = sql.match(/^\(c NOT IN \(:\.\.\.(\w+)\)\)$/);
  if (match) {
    return storedText !== null && !listOf(match[1]!).includes(storedText);
  }

  match = sql.match(/^\(?c (>=|<=|>|<) :(\w+)\)?$/);
  if (match) {
    return compareNumbers(stored, match[1]!, parameters[match[2]!]);
  }

  // A comparison that an empty value passes too (QueryHelper.*OrNull).
  match = sql.match(/^\(c (>=|<=|>|<) :(\w+) or c IS NULL\)$/i);
  if (match) {
    return (
      storedText === null ||
      compareNumbers(stored, match[1]!, parameters[match[2]!])
    );
  }

  /*
   * A column naming a private incident, alert or episode
   * (PrivateRecordReadFilter): no record, one that is not private, or one
   * the reader - the person the condition names, when it names one - sees.
   */
  match = sql.match(
    /^\(c IS NULL OR NOT EXISTS \(SELECT 1 FROM "(\w+)" pr WHERE pr\."_id" = c AND pr\."isPrivate" = TRUE([\s\S]*)\)\)$/,
  );
  if (match) {
    if (storedText === null) {
      return true;
    }

    const seenBy: Set<string> | undefined = privateRecords
      .get(match[1]!)
      ?.get(storedText);

    if (!seenBy) {
      return true;
    }

    const reader: RegExpMatchArray | null = match[2]!.match(/:(\w+)/);
    const readerId: string | null = reader
      ? normalize(parameters[reader[1]!])
      : null;

    return readerId !== null && seenBy.has(readerId);
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

// Rows in a find's order: each column in turn, ASC or DESC.
export function sortRows(
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

      // In time, as Postgres orders a timestamp - not by the text of the day's name.
      if (left instanceof Date && right instanceof Date) {
        return (left.getTime() - right.getTime()) * sign;
      }

      return String(left).localeCompare(String(right)) * sign;
    }

    return 0;
  });
}

export interface InMemoryTableOptions {
  /*
   * Answer a find with only the columns it selects (and the id), as
   * Postgres does, for a test of what a read leaves out: a column the
   * service drops from a read is then missing from what the API sends. Off
   * by default: the tables answer every column, as the tests written before
   * this expect.
   */
  answersOnlySelectedColumns?: boolean | undefined;
}

// The columns of `row` a find's `select` asks for, and the id.
function selectedColumnsOf(
  row: StoredRow,
  select: Record<string, unknown> | undefined,
): StoredRow {
  if (!select) {
    return { ...row };
  }

  const selected: StoredRow = { _id: row["_id"] };

  for (const [column, isSelected] of Object.entries(select)) {
    if (isSelected && column in row) {
      selected[column] = row[column];
    }
  }

  return selected;
}

/*
 * Put an in-memory table behind `service`. `rows` are the rows the table
 * starts with; each needs an _id.
 */
export function useInMemoryTable<TBaseModel extends BaseModel>(
  service: DatabaseService<TBaseModel>,
  rows: Array<StoredRow>,
  options?: InMemoryTableOptions | undefined,
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
    find: getJestMockFunction().mockImplementation(
      async (findOptions: {
        where?: unknown;
        skip?: number;
        take?: number;
        order?: Record<string, string>;
        select?: Record<string, unknown>;
      }): Promise<Array<TBaseModel>> => {
        const matched: Array<StoredRow> = sortRows(
          table.rows.filter((row: StoredRow) => {
            return rowMatchesWhere(row, findOptions.where);
          }),
          findOptions.order,
        );

        const start: number = findOptions.skip || 0;
        const window: Array<StoredRow> = findOptions.take
          ? matched.slice(start, start + findOptions.take)
          : matched.slice(start);

        if (options?.answersOnlySelectedColumns) {
          return window.map((row: StoredRow): TBaseModel => {
            return toModel(selectedColumnsOf(row, findOptions.select));
          });
        }

        return window.map(toModel);
      },
    ),
    count: getJestMockFunction().mockImplementation(
      async (options: { where?: unknown }): Promise<number> => {
        return table.rows.filter((row: StoredRow) => {
          return rowMatchesWhere(row, options.where);
        }).length;
      },
    ),
    save: getJestMockFunction().mockImplementation(
      async (entity: TBaseModel): Promise<TBaseModel> => {
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
      },
    ),
    update: getJestMockFunction().mockImplementation(
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
    delete: getJestMockFunction().mockImplementation(
      async (where: unknown): Promise<{ affected: number }> => {
        const removed: Array<StoredRow> = table.rows.filter(
          (row: StoredRow) => {
            return rowMatchesWhere(row, where);
          },
        );

        table.rows = table.rows.filter((row: StoredRow) => {
          return !removed.includes(row);
        });

        for (const row of removed) {
          table.deletes.push(String(row["_id"]));
        }

        return { affected: removed.length };
      },
    ),
  };

  getJestSpyOn(service, "getRepository").mockReturnValue(table.repository);
  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(undefined);
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(undefined);

  return table;
}

/*
 * Answers `service`'s hook-free writes of one row by id
 * (updateColumnsByIdWithoutHooks) from `table`, as the UPDATE it sends would
 * write the row - for a suite whose service writes rows that way as part of
 * a write under test (a drag-ordered list puts a row at the end of its list
 * this way). The statement itself is built from TypeORM's metadata, which an
 * in-memory table has none of. Each write is recorded in `updates`.
 */
export function useInMemoryHookFreeWrites<TBaseModel extends BaseModel>(
  service: DatabaseService<TBaseModel>,
  table: InMemoryTable,
): void {
  getJestSpyOn(service, "updateColumnsByIdWithoutHooks").mockImplementation(
    async (input: { id: ObjectID; data: unknown }): Promise<void> => {
      const row: StoredRow | undefined = table.get(input.id);

      if (!row) {
        return;
      }

      const written: StoredRow = { ...(input.data as StoredRow) };

      Object.assign(row, written);
      table.updates.push({ id: String(row["_id"]), set: written });
    },
  );
}

// What a write of a row's lists entry by entry added and took off (#10135).
export interface InMemoryListEntryWrite {
  rowId: string;
  // By the list's field: the IDs added, and the IDs taken off.
  writes: Record<string, { add: Array<string>; remove: Array<string> }>;
}

/*
 * Answers `service`'s writes of a row's lists entry by entry (#10135) from
 * `table`, as the junction table holding each list would: an entry added
 * once whatever is asked, one taken off only when the row has it, every
 * other entry left as it is. The row's own columns, written in the same
 * transaction (updateRowWithListEntries), are written as update() writes
 * them. Each write's entries are recorded in the list returned, in order.
 */
export function useInMemoryListEntryWrites<TBaseModel extends BaseModel>(
  service: DatabaseService<TBaseModel>,
  table: InMemoryTable,
): Array<InMemoryListEntryWrite> {
  const written: Array<InMemoryListEntryWrite> = [];

  const writeEntries: (data: InMemoryListEntryWrite) => void = (
    data: InMemoryListEntryWrite,
  ): void => {
    const row: StoredRow | undefined = table.get(data.rowId);

    const entries: Record<
      string,
      { add: Array<string>; remove: Array<string> }
    > = {};

    for (const [column, write] of Object.entries(data.writes)) {
      entries[column] = { add: [...write.add], remove: [...write.remove] };
    }

    written.push({ rowId: data.rowId, writes: entries });

    if (!row) {
      return;
    }

    for (const [column, write] of Object.entries(data.writes)) {
      const removed: Set<string | null> = new Set(write.remove.map(normalize));
      const entries: Array<unknown> = (
        Array.isArray(row[column]) ? (row[column] as Array<unknown>) : []
      ).filter((entry: unknown): boolean => {
        return !removed.has(normalize(entry));
      });

      for (const id of write.add) {
        const isThere: boolean = entries.some((entry: unknown): boolean => {
          return normalize(entry) === normalize(id);
        });

        if (!isThere) {
          entries.push({ _id: id });
        }
      }

      row[column] = entries;
    }
  };

  getJestSpyOn(service, "updateRowWithListEntries").mockImplementation(
    async (data: {
      criteria: Record<string, unknown>;
      values: Record<string, unknown>;
      rowId: string;
      writes: Record<string, { add: Array<string>; remove: Array<string> }>;
    }): Promise<{ affected: number }> => {
      const result: { affected: number } = (await table.repository.update(
        data.criteria,
        data.values,
      )) as { affected: number };

      if (result.affected > 0) {
        writeEntries({ rowId: data.rowId, writes: data.writes });
      }

      return result;
    },
  );

  getJestSpyOn(service, "writeListEntries").mockImplementation(
    async (data: InMemoryListEntryWrite): Promise<void> => {
      writeEntries(data);
    },
  );

  return written;
}
