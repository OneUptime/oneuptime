import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { withSearch } from "Common/UI/Components/EntityDropdown/EntityDropdownQuery";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import RecordsById from "Common/UI/Utils/RecordsById";

/*
 * A SAVED VIEW LIST, PAST ITS FIRST VIEWS (#10646).
 *
 * The Logs, Traces, Metrics and Exceptions explorers read their first 100
 * saved views by name, and knew no other: a view a link opened that sorted
 * past them was taken for one deleted (its id dropped from the link), the
 * project's default past them was never applied, and a view past them
 * could not be picked. These reads keep the first 100 for the list, and
 * add what they do not hold:
 *
 *   - the views a link or the explorer names, read by their ids;
 *   - the project's default, read by itself;
 *   - what is typed into the list's search, searched on the server.
 *
 * Every read keeps the explorer's own query (its project, its scope or
 * view type), so another page's views are never offered.
 */

// How many views the list reads first, and a search finds.
export const SAVED_VIEWS_READ_LIMIT: number = 100;

export interface SavedViewModel extends BaseModel {
  name?: string | undefined;
  isDefault?: boolean | undefined;
}

export interface FirstSavedViews<T> {
  views: Array<T>;
  // How many views the explorer has.
  count: number;
}

type ViewId = (view: BaseModel) => string;

const idOf: ViewId = (view: BaseModel): string => {
  return view.id?.toString().toLowerCase() || "";
};

export default class SavedViewReads {
  // The first views by name, and how many there are.
  public static async readFirst<T extends SavedViewModel>(data: {
    modelType: { new (): T };
    query: Query<T>;
    select: Select<T>;
  }): Promise<FirstSavedViews<T>> {
    const result: ListResult<T> = await ModelAPI.getList<T>({
      modelType: data.modelType,
      query: data.query,
      limit: SAVED_VIEWS_READ_LIMIT,
      skip: 0,
      select: data.select,
      sort: { name: SortOrder.Ascending } as Sort<T>,
    });

    return {
      views: result.data,
      count: Math.max(result.count ?? 0, result.data.length),
    };
  }

  /*
   * What the first views lack: the views named by id (a link's, the one
   * picked) and the default, when none of `known` is it. Each read is the
   * explorer's own query, so a view of another scope or project is never
   * read. Nothing is read for what `known` holds - nor at all when `known`
   * is every view there is (the first read held them all): a view it lacks
   * is gone, and with no default among them there is none.
   */
  public static async readHeld<T extends SavedViewModel>(data: {
    modelType: { new (): T };
    query: Query<T>;
    select: Select<T>;
    known: Array<T>;
    // How many views there are: more than `known` holds, or not.
    count: number;
    ids: Array<string | null | undefined>;
    readsDefault: boolean;
  }): Promise<Array<T>> {
    if (data.count <= data.known.length) {
      return [];
    }

    const knownIds: Set<string> = new Set<string>(data.known.map(idOf));
    const ids: Array<string> = data.ids
      .map((id: string | null | undefined): string => {
        return (id || "").trim();
      })
      .filter((id: string): boolean => {
        return Boolean(id) && !knownIds.has(id.toLowerCase());
      });

    const held: Array<T> = [];

    if (ids.length > 0) {
      held.push(
        ...(await RecordsById.read<T>({
          modelType: data.modelType,
          ids: ids,
          query: data.query,
          select: data.select,
        })),
      );
    }

    const hasDefault: boolean = [...data.known, ...held].some(
      (view: T): boolean => {
        return Boolean(view.isDefault);
      },
    );

    if (data.readsDefault && !hasDefault) {
      const result: ListResult<T> = await ModelAPI.getList<T>({
        modelType: data.modelType,
        query: { ...data.query, isDefault: true } as Query<T>,
        limit: 1,
        skip: 0,
        select: data.select,
        sort: { name: SortOrder.Ascending } as Sort<T>,
      });

      held.push(...result.data);
    }

    return held;
  }

  // The views whose name holds what is typed, by name.
  public static async search<T extends SavedViewModel>(data: {
    modelType: { new (): T };
    query: Query<T>;
    select: Select<T>;
    text: string;
  }): Promise<Array<T>> {
    const result: ListResult<T> = await ModelAPI.getList<T>({
      modelType: data.modelType,
      query: withSearch(
        data.query as Record<string, unknown>,
        "name",
        data.text,
      ) as Query<T>,
      limit: SAVED_VIEWS_READ_LIMIT,
      skip: 0,
      select: data.select,
      sort: { name: SortOrder.Ascending } as Sort<T>,
    });

    return result.data;
  }

  // Each view once - the first copy of it kept - in the order given.
  public static merge<T extends BaseModel>(
    ...lists: Array<Array<T>>
  ): Array<T> {
    const seen: Set<string> = new Set<string>();
    const merged: Array<T> = [];

    for (const list of lists) {
      for (const view of list) {
        const id: string = idOf(view);

        if (!id || seen.has(id)) {
          continue;
        }

        seen.add(id);
        merged.push(view);
      }
    }

    return merged;
  }
}
