import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Includes from "../../Types/BaseDatabase/Includes";
import Query from "../../Types/BaseDatabase/Query";
import Select from "../../Types/BaseDatabase/Select";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import ModelAPI, { ListResult } from "./ModelAPI/ModelAPI";

/*
 * THE RECORDS A PAGE HOLDS, READ BY THEIR IDS (#10646).
 *
 * A form's settings, a rule's conditions and a monitor's criteria name
 * records by their ids. Pages named them from a read of the project's
 * records - "the first 10,000 by name" - and a record past that read was
 * not among them: it read as deleted, showed blank, or was left out the
 * next time the form was saved. What a page holds is read here instead, by
 * those values only: every record the reader may see among them, each
 * once. A value the read does not answer is one that names nothing now -
 * deleted since, or out of the reader's reach.
 *
 * The values are asked for in pages (RECORDS_BY_ID_PAGE_SIZE), so a long
 * list never makes one request too large to send. Read by ids (the
 * default column), a value that is not one is left out: the server refuses
 * a whole read for one malformed id, and the real ones would lose their
 * names with it.
 */

// The most values one request asks for.
export const RECORDS_BY_ID_PAGE_SIZE: number = 500;

export interface ReadRecordsByIdData<T extends BaseModel> {
  modelType: { new (): T };
  // The values to read: ids, or (column) the values of another column.
  ids: Iterable<string | ObjectID>;
  select: Select<T>;
  /*
   * What else a record must match: the project it is in, the cloud a
   * project of an OpenStack cloud belongs to.
   */
  query?: Query<T> | undefined;
  /*
   * The column the values are in. Unset, "_id". Another column may hold one
   * value on several records (an inventory item's key, kept per type), so
   * every record holding one is read.
   */
  column?: string | undefined;
  // The API the reads go through: the shared ModelAPI unless named.
  modelAPI?: typeof ModelAPI | undefined;
}

export default class RecordsById {
  // The distinct values to read, as they are sent.
  public static getValuesToRead(data: {
    ids: Iterable<string | ObjectID>;
    column?: string | undefined;
  }): Array<string> {
    const isIdColumn: boolean = !data.column || data.column === "_id";
    const seen: Set<string> = new Set<string>();
    const values: Array<string> = [];

    for (const entry of data.ids) {
      const value: string =
        entry === undefined || entry === null ? "" : entry.toString().trim();

      if (!value) {
        continue;
      }

      if (isIdColumn && !ObjectID.isValidUUID(value)) {
        continue;
      }

      const key: string = isIdColumn ? value.toLowerCase() : value;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      values.push(isIdColumn ? key : value);
    }

    return values;
  }

  public static async read<T extends BaseModel>(
    data: ReadRecordsByIdData<T>,
  ): Promise<Array<T>> {
    const column: string = data.column || "_id";
    const isIdColumn: boolean = column === "_id";
    const values: Array<string> = RecordsById.getValuesToRead({
      ids: data.ids,
      column: column,
    });
    const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;
    const records: Array<T> = [];

    for (
      let start: number = 0;
      start < values.length;
      start += RECORDS_BY_ID_PAGE_SIZE
    ) {
      const page: Array<string> = values.slice(
        start,
        start + RECORDS_BY_ID_PAGE_SIZE,
      );

      const result: ListResult<T> = await modelAPI.getList<T>({
        modelType: data.modelType,
        query: {
          ...((data.query || {}) as Record<string, unknown>),
          [column]: new Includes(
            isIdColumn
              ? page.map((value: string): ObjectID => {
                  return new ObjectID(value);
                })
              : page,
          ),
        } as Query<T>,
        select: {
          _id: true,
          ...(isIdColumn ? {} : { [column]: true }),
          ...(data.select as Record<string, unknown>),
        } as Select<T>,
        sort: {},
        // An id names one record; another column's value may name several.
        limit: isIdColumn ? page.length : LIMIT_MAX,
        skip: 0,
      });

      records.push(...result.data);
    }

    return records;
  }

  /*
   * The records read, by the value they were asked for (lower-cased ids, or
   * another column's values as written): the first record read for each.
   */
  public static byValue<T extends BaseModel>(data: {
    records: Array<T>;
    column?: string | undefined;
  }): Map<string, T> {
    const column: string = data.column || "_id";
    const isIdColumn: boolean = column === "_id";
    const byValue: Map<string, T> = new Map<string, T>();

    for (const record of data.records) {
      const raw: unknown = (record as unknown as Record<string, unknown>)[
        column
      ];

      if (raw === undefined || raw === null) {
        continue;
      }

      const key: string = isIdColumn
        ? raw.toString().toLowerCase()
        : raw.toString();

      if (!byValue.has(key)) {
        byValue.set(key, record);
      }
    }

    return byValue;
  }
}
