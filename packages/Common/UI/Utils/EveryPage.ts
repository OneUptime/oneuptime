import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Query from "../../Types/BaseDatabase/Query";
import Select from "../../Types/BaseDatabase/Select";
import Sort from "../../Types/BaseDatabase/Sort";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ModelAPI, { ListResult } from "./ModelAPI/ModelAPI";

/*
 * EVERY RECORD A QUERY MATCHES, READ A PAGE AT A TIME (#11210).
 *
 * A list read once with `limit: LIMIT_PER_PROJECT` holds the first 10,000
 * records, whatever the query matches - the most one page of the list route
 * may hold. A page that has to weigh every record (a cloud account's
 * recommended monitors, across every resource the account holds) read only
 * those, and the rest got nothing, with nothing said. This reads them all:
 *
 *   - in pages of at most `pageSize` (LIMIT_PER_PROJECT unless less is
 *     asked), by skip, in the order asked for with the id after it, so a
 *     record never stands on two pages for sharing a name with another;
 *   - the first page alone, then - its count saying how many more there
 *     are - the rest at most `concurrency` at a time;
 *   - each record once, by its id, should one move between pages while
 *     they are read.
 *
 * A record made while the pages are read may be missed, as any read can
 * miss one made a moment after it; the next read finds it. A page that
 * fails fails the whole read: a part of the records read as all of them is
 * what this is here to stop.
 */

// The most pages read at once, after the first.
export const EVERY_PAGE_CONCURRENCY: number = 3;

export interface ReadEveryPageData<T extends BaseModel> {
  modelType: { new (): T };
  query: Query<T>;
  select: Select<T>;
  // The order to read them in; the id is added after it.
  sort?: Sort<T> | undefined;
  // The most records one page holds: LIMIT_PER_PROJECT unless less is asked.
  pageSize?: number | undefined;
  // The most pages read at once after the first.
  concurrency?: number | undefined;
  // The API the reads go through: the shared ModelAPI unless named.
  modelAPI?: typeof ModelAPI | undefined;
}

export default class EveryPage {
  public static async read<T extends BaseModel>(
    data: ReadEveryPageData<T>,
  ): Promise<Array<T>> {
    const pageSize: number = Math.max(
      1,
      Math.min(
        Math.floor(data.pageSize || LIMIT_PER_PROJECT),
        LIMIT_PER_PROJECT,
      ),
    );
    const concurrency: number = Math.max(
      1,
      Math.floor(data.concurrency || EVERY_PAGE_CONCURRENCY),
    );
    const modelAPI: typeof ModelAPI = data.modelAPI || ModelAPI;

    const sort: Sort<T> = {
      ...((data.sort || {}) as Record<string, SortOrder>),
      // Ties broken by the id, so no record is on two pages.
      _id: SortOrder.Ascending,
    } as Sort<T>;

    const readPage: (skip: number) => Promise<ListResult<T>> = (
      skip: number,
    ): Promise<ListResult<T>> => {
      return modelAPI.getList<T>({
        modelType: data.modelType,
        query: data.query,
        select: {
          _id: true,
          ...(data.select as Record<string, unknown>),
        } as Select<T>,
        sort: sort,
        limit: pageSize,
        skip: skip,
      });
    };

    const records: Array<T> = [];
    const seen: Set<string> = new Set<string>();

    const keep: (page: ListResult<T>) => void = (page: ListResult<T>): void => {
      for (const record of page.data || []) {
        const id: string = (record._id || record.id || "")
          .toString()
          .toLowerCase();

        if (id && seen.has(id)) {
          continue;
        }

        if (id) {
          seen.add(id);
        }

        records.push(record);
      }
    };

    const first: ListResult<T> = await readPage(0);

    keep(first);

    if ((first.data || []).length < pageSize) {
      return records;
    }

    const count: number | undefined =
      typeof first.count === "number" && Number.isFinite(first.count)
        ? first.count
        : undefined;

    // How many there are unknown: page after page until one is short.
    if (count === undefined) {
      for (let skip: number = pageSize; ; skip += pageSize) {
        const page: ListResult<T> = await readPage(skip);

        keep(page);

        if ((page.data || []).length < pageSize) {
          return records;
        }
      }
    }

    const skips: Array<number> = [];

    for (let skip: number = pageSize; skip < count; skip += pageSize) {
      skips.push(skip);
    }

    for (let start: number = 0; start < skips.length; start += concurrency) {
      const pages: Array<ListResult<T>> = await Promise.all(
        skips
          .slice(start, start + concurrency)
          .map((skip: number): Promise<ListResult<T>> => {
            return readPage(skip);
          }),
      );

      // In the order of their pages, whichever answered first.
      for (const page of pages) {
        keep(page);
      }
    }

    return records;
  }
}
