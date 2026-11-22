import { jest } from "@jest/globals";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Includes from "../../../Types/BaseDatabase/Includes";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI, { ListResult } from "../../../UI/Utils/ModelAPI/ModelAPI";

/*
 * A PROJECT WITH MORE RECORDS THAN A PICKER EVER READ, FAKED (#10646).
 *
 * ModelAPI.getList, answered from the rows kept for each model the way the
 * list route answers it: the query's conditions (a value, Includes, Search,
 * MultiSearch), then the sort, the page (skip and limit) and the count of
 * every row that matched. So a picker that reads "the first 10,000 by name"
 * gets exactly those, and a record whose name sorts after them is missing
 * from what it read - as on a real project - while a search, or a read by
 * id, finds it.
 *
 * What the server answers to the same reads, through the real list routes
 * on migrated Postgres, is pinned in Tests/Server/API/*PickerSearchPostgres.
 *
 * A condition this fake does not know fails the read loudly, so a test never
 * passes on a query it did not understand.
 */

type ListOptions = Parameters<typeof ModelAPI.getList<BaseModel>>[0];

export interface CappedListCall {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
}

type Row = Record<string, unknown>;

// A column's value as the fake compares it: ids and text, case-insensitive.
const comparable: (value: unknown) => string = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).toLowerCase();
};

const matchesCondition: (
  row: Row,
  key: string,
  condition: unknown,
) => boolean = (row: Row, key: string, condition: unknown): boolean => {
  if (condition instanceof MultiSearch) {
    const text: string = comparable(condition.value);

    return condition.fields.some((field: string): boolean => {
      return comparable(row[field]).includes(text);
    });
  }

  const value: unknown = row[key];

  if (condition instanceof Includes) {
    return condition.values
      .map((entry: unknown): string => {
        return comparable(entry);
      })
      .includes(comparable(value));
  }

  if (condition instanceof Search) {
    return comparable(value).includes(comparable(condition.value));
  }

  if (condition instanceof ObjectID) {
    return comparable(value) === comparable(condition);
  }

  if (typeof condition === "boolean") {
    // A column the row never set holds its default, false.
    return Boolean(value) === condition;
  }

  if (typeof condition === "string" || typeof condition === "number") {
    return comparable(value) === comparable(condition);
  }

  throw new Error(
    `CappedListServer does not know the condition on "${key}": ${String(
      (condition as { constructor?: { name?: string } })?.constructor?.name,
    )}`,
  );
};

export default class CappedListServer {
  public readonly calls: Array<CappedListCall> = [];

  // The rows of each model, by its table name.
  private readonly rowsByTable: Map<string, Array<BaseModel>> = new Map();

  /*
   * Columns every row is read as matching, whatever the query says of them:
   * the project, which the tenant header scopes on the real server.
   */
  private readonly scopeColumns: Set<string> = new Set<string>(["projectId"]);

  public add<T extends BaseModel>(
    modelType: { new (): T },
    rows: Array<Record<string, unknown>>,
  ): Array<T> {
    const table: string = new modelType().tableName || modelType.name;
    const models: Array<T> = rows.map((values: Record<string, unknown>): T => {
      const model: T = new modelType();

      for (const [key, value] of Object.entries(values)) {
        (model as unknown as Row)[key] = value;
      }

      return model;
    });

    this.rowsByTable.set(table, [
      ...(this.rowsByTable.get(table) || []),
      ...models,
    ]);

    return models;
  }

  // The reads made of one model, in order.
  public callsFor(modelType: { new (): BaseModel }): Array<CappedListCall> {
    return this.calls.filter((call: CappedListCall): boolean => {
      return call.modelType === modelType;
    });
  }

  public list(options: ListOptions): ListResult<BaseModel> {
    const call: CappedListCall = {
      modelType: options.modelType,
      query: (options.query || {}) as Record<string, unknown>,
      select: (options.select || {}) as Record<string, unknown>,
      sort: (options.sort || {}) as Record<string, unknown>,
      limit: options.limit,
      skip: options.skip || 0,
    };

    this.calls.push(call);

    const table: string =
      new (options.modelType as { new (): BaseModel })().tableName || "";

    const matched: Array<BaseModel> = (
      this.rowsByTable.get(table) || []
    ).filter((model: BaseModel): boolean => {
      return Object.entries(call.query).every(
        ([key, condition]: [string, unknown]): boolean => {
          if (this.scopeColumns.has(key)) {
            return true;
          }

          return matchesCondition(model as unknown as Row, key, condition);
        },
      );
    });

    const sortEntry: [string, unknown] | undefined = Object.entries(
      call.sort,
    )[0];

    if (sortEntry) {
      const [column, order] = sortEntry;
      const direction: number = order === SortOrder.Descending ? -1 : 1;

      matched.sort((a: BaseModel, b: BaseModel): number => {
        const left: unknown = (a as unknown as Row)[column];
        const right: unknown = (b as unknown as Row)[column];

        if (typeof left === "number" && typeof right === "number") {
          return (left - right) * direction;
        }

        return comparable(left).localeCompare(comparable(right)) * direction;
      });
    }

    return {
      data: matched.slice(call.skip, call.skip + call.limit),
      count: matched.length,
      skip: call.skip,
      limit: call.limit,
    };
  }

  // Answers every ModelAPI.getList from here, until jest restores the mocks.
  public install(): this {
    jest.spyOn(ModelAPI, "getList").mockImplementation((async (
      options: ListOptions,
    ): Promise<ListResult<BaseModel>> => {
      return this.list(options);
    }) as never);

    return this;
  }
}

/*
 * More rows than a picker ever read, every one named to sort before a
 * name that starts with "W": "AP000001", "AP000002" ...
 */
export const namesSortingFirst: (
  count: number,
  prefix?: string,
) => Array<string> = (count: number, prefix?: string): Array<string> => {
  const names: Array<string> = [];

  for (let index: number = 1; index <= count; index++) {
    names.push(`${prefix || "AP"}${String(index).padStart(6, "0")}`);
  }

  return names;
};
