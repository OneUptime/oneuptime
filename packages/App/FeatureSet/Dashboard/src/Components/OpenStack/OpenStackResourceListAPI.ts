import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GroupBy from "Common/Types/BaseDatabase/GroupBy";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import {
  OpenStackListSeek,
  OpenStackListSeekValue,
  getOpenStackListSeekSort,
  toOpenStackListSeekValue,
} from "Common/Types/OpenStack/OpenStackListSeek";
import ModelAPI, {
  ListResult,
  RequestOptions,
} from "Common/UI/Utils/ModelAPI/ModelAPI";
import OldestKeyMap from "Common/Utils/OldestKeyMap";

/*
 * An OpenStack list, a page at a time, from where the last page ended (OpenStackListSeek). Each list
 * remembers how each page it has read ended, so moving on a page or back one, and walking a whole
 * list to export it, never asks Postgres to count its way there. A jump to a page nobody has been
 * through goes by offset, and ties broken the same way, so both read rows in one order.
 */

interface ListMemory {
  // Where the page starting at this row ended, by that row's number.
  ends: Map<number, { value: OpenStackListSeekValue; id: string }>;
  count: number;
}

const LISTS_REMEMBERED: number = 16;

export class OpenStackListPages {
  private readonly lists: OldestKeyMap<string, ListMemory> = new OldestKeyMap();

  private keyOf(data: {
    query: unknown;
    sort: unknown;
    limit: number;
    groupBy?: unknown;
  }): string {
    return JSON.stringify([data.query, data.sort, data.limit, data.groupBy]);
  }

  // What to ask for: where to start, and a sort that always breaks a tie the same way.
  public plan(data: {
    query: Record<string, unknown>;
    sort: Record<string, unknown>;
    limit: number;
    skip: number;
    groupBy?: unknown;
  }): {
    sort: Record<string, unknown>;
    seek?: OpenStackListSeek | undefined;
  } {
    const sorted: { column: string; order: SortOrder } | null =
      getOpenStackListSeekSort(data.sort);

    if (!sorted || data.query[sorted.column] !== undefined) {
      return { sort: data.sort };
    }

    const sort: Record<string, unknown> = {
      [sorted.column]: sorted.order,
      _id: SortOrder.Ascending,
    };
    const memory: ListMemory | undefined = this.lists.get(
      this.keyOf({ ...data, sort }),
    );
    const end: { value: OpenStackListSeekValue; id: string } | undefined =
      data.skip > 0 ? memory?.ends.get(data.skip) : undefined;

    return end && memory
      ? {
          sort,
          seek: {
            column: sorted.column,
            value: end.value,
            id: end.id,
            count: memory.count,
          },
        }
      : { sort };
  }

  // How a page ended, for the page after it.
  public remember(data: {
    query: Record<string, unknown>;
    sort: Record<string, unknown>;
    limit: number;
    skip: number;
    groupBy?: unknown;
    rows: ReadonlyArray<Record<string, unknown>>;
    count: number;
  }): void {
    const sorted: { column: string; order: SortOrder } | null =
      getOpenStackListSeekSort(data.sort);
    const last: Record<string, unknown> | undefined =
      data.rows[data.rows.length - 1];

    if (!sorted || !last) {
      return;
    }

    const value: OpenStackListSeekValue | undefined = toOpenStackListSeekValue(
      last[sorted.column],
    );
    const id: string | undefined = last["_id"]?.toString();

    if (value === undefined || !id) {
      return;
    }

    const key: string = this.keyOf(data);
    const memory: ListMemory = this.lists.get(key) || {
      ends: new Map(),
      count: data.count,
    };

    memory.count = data.count;
    memory.ends.set(data.skip + data.rows.length, { value, id });

    // The newest last, and the oldest list goes first.
    this.lists.delete(key);
    this.lists.set(key, memory);

    if (this.lists.size > LISTS_REMEMBERED) {
      this.lists.delete(this.lists.oldestKey() as string);
    }
  }
}

const pages: OpenStackListPages = new OpenStackListPages();

export default class OpenStackResourceListAPI extends ModelAPI {
  public static override async getList<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    query: Query<TBaseModel>;
    groupBy?: GroupBy<TBaseModel> | undefined;
    limit: number;
    skip: number;
    select: Select<TBaseModel>;
    sort: Sort<TBaseModel>;
    requestOptions?: RequestOptions | undefined;
  }): Promise<ListResult<TBaseModel>> {
    const query: Record<string, unknown> = data.query as Record<
      string,
      unknown
    >;
    const plan: {
      sort: Record<string, unknown>;
      seek?: OpenStackListSeek | undefined;
    } = pages.plan({
      query: query,
      sort: data.sort as Record<string, unknown>,
      limit: data.limit,
      skip: data.skip,
      groupBy: data.groupBy,
    });
    const select: Record<string, unknown> = {
      ...(data.select as Record<string, unknown>),
    };

    // Its last row has to say where it ended.
    for (const column of Object.keys(plan.sort)) {
      select[column] = true;
    }

    const result: ListResult<TBaseModel> = await ModelAPI.getList<TBaseModel>({
      ...data,
      select: select as Select<TBaseModel>,
      sort: plan.sort as Sort<TBaseModel>,
      requestOptions: plan.seek
        ? {
            ...data.requestOptions,
            additionalRequestBody: {
              ...data.requestOptions?.additionalRequestBody,
              seek: plan.seek as unknown as JSONObject,
            },
          }
        : data.requestOptions,
    });

    pages.remember({
      query: query,
      sort: plan.sort,
      limit: data.limit,
      skip: data.skip,
      groupBy: data.groupBy,
      rows: result.data as unknown as Array<Record<string, unknown>>,
      count: result.count,
    });

    return result;
  }
}
