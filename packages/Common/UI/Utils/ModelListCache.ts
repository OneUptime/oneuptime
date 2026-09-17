import ListResult from "../../Types/BaseDatabase/ListResult";
import Query from "../../Types/BaseDatabase/Query";
import Select from "../../Types/BaseDatabase/Select";
import Sort from "../../Types/BaseDatabase/Sort";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelAPI, { RequestOptions } from "./ModelAPI/ModelAPI";

/*
 * A tiny read-through cache for reference-data lists (incident states, alert
 * states, custom-field definitions, ...): tables that hold a handful of rows
 * per project and change approximately never, yet are fetched independently by
 * every component that needs them - the Home view alone used to request the
 * IncidentState list three times.
 *
 * Modeled on GlobalConfigUtil (./GlobalConfig.ts): a module-level cache plus
 * in-flight promise dedup, so concurrent callers share one request and
 * callers within the TTL share one response. Entries are keyed by the model's
 * table name, the project id and the serialized query/select/sort/paging, so
 * different projects and different shapes of the same list never collide.
 *
 * Callers share the returned ListResult (and the model instances inside it) -
 * treat it as read-only and copy before mutating.
 *
 * Invalidation: the key carries the project id, so a project switch can never
 * be served another project's rows even before anything is invalidated; the
 * 60-second TTL bounds staleness after someone edits the underlying rows in
 * settings. Screens that edit reference data and need to see the change
 * immediately should call invalidate(modelType) on success.
 */

const TTL_IN_MS: number = 60 * 1000;

interface CacheEntry {
  tableName: string;
  expiresAt: number;
  result: ListResult<BaseModel>;
}

interface InFlightEntry {
  tableName: string;
  promise: Promise<ListResult<BaseModel>>;
}

export default class ModelListCache {
  private static cache: Dictionary<CacheEntry> = {};
  private static inFlight: Dictionary<InFlightEntry> = {};

  public static async getList<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    query: Query<TBaseModel>;
    limit: number;
    skip: number;
    select: Select<TBaseModel>;
    sort: Sort<TBaseModel>;
    projectId?: ObjectID | null | undefined;
    requestOptions?: RequestOptions | undefined;
  }): Promise<ListResult<TBaseModel>> {
    const tableName: string = new data.modelType().tableName || "";
    const key: string = ModelListCache.buildKey({
      tableName: tableName,
      projectId: data.projectId,
      query: data.query,
      select: data.select,
      sort: data.sort,
      skip: data.skip,
      limit: data.limit,
      requestOptions: data.requestOptions,
    });

    const cached: CacheEntry | undefined = ModelListCache.cache[key];

    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached.result as ListResult<TBaseModel>;
      }

      delete ModelListCache.cache[key];
    }

    const existing: InFlightEntry | undefined = ModelListCache.inFlight[key];

    if (existing) {
      return existing.promise as Promise<ListResult<TBaseModel>>;
    }

    const promise: Promise<ListResult<TBaseModel>> =
      ModelAPI.getList<TBaseModel>({
        modelType: data.modelType,
        query: data.query,
        limit: data.limit,
        skip: data.skip,
        select: data.select,
        sort: data.sort,
        ...(data.requestOptions ? { requestOptions: data.requestOptions } : {}),
      });

    const entry: InFlightEntry = {
      tableName: tableName,
      promise: promise as Promise<ListResult<BaseModel>>,
    };

    ModelListCache.inFlight[key] = entry;

    try {
      const result: ListResult<TBaseModel> = await promise;

      /*
       * Only cache while this request is still the current one for its key -
       * an invalidate() that ran mid-flight must not have its effect undone
       * by a stale response landing afterwards. (Failures are never cached:
       * the next caller simply issues a fresh request.)
       */
      if (ModelListCache.inFlight[key] === entry) {
        ModelListCache.cache[key] = {
          tableName: tableName,
          expiresAt: Date.now() + TTL_IN_MS,
          result: result as ListResult<BaseModel>,
        };
      }

      return result;
    } finally {
      if (ModelListCache.inFlight[key] === entry) {
        delete ModelListCache.inFlight[key];
      }
    }
  }

  // Drop every entry for one model type, or everything when none is given.
  public static invalidate(modelType?: { new (): BaseModel }): void {
    if (!modelType) {
      ModelListCache.invalidateAll();
      return;
    }

    const tableName: string = new modelType().tableName || "";

    for (const key of Object.keys(ModelListCache.cache)) {
      if (ModelListCache.cache[key]?.tableName === tableName) {
        delete ModelListCache.cache[key];
      }
    }

    for (const key of Object.keys(ModelListCache.inFlight)) {
      if (ModelListCache.inFlight[key]?.tableName === tableName) {
        delete ModelListCache.inFlight[key];
      }
    }
  }

  // Call on project switch (and logout): the next reads refetch everything.
  public static invalidateAll(): void {
    ModelListCache.cache = {};
    ModelListCache.inFlight = {};
  }

  private static buildKey(data: {
    tableName: string;
    projectId?: ObjectID | null | undefined;
    query: Query<BaseModel>;
    select: Select<BaseModel>;
    sort: Sort<BaseModel>;
    skip: number;
    limit: number;
    requestOptions?: RequestOptions | undefined;
  }): string {
    /*
     * JSONFunctions.serialize is the same serialization ModelAPI sends over
     * the wire, so two requests get one key exactly when the server would see
     * the same request body. Key order inside the literals is stable because
     * call sites are static object literals.
     */
    return JSON.stringify({
      tableName: data.tableName,
      projectId: data.projectId?.toString() || "",
      query: JSONFunctions.serialize(data.query as JSONObject),
      select: JSONFunctions.serialize(data.select as JSONObject),
      sort: JSONFunctions.serialize(data.sort as JSONObject),
      skip: data.skip,
      limit: data.limit,
      url: data.requestOptions?.overrideRequestUrl?.toString() || "",
    });
  }
}
