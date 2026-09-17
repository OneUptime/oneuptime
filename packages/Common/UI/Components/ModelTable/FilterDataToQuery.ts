import Filter from "../ModelFilter/Filter";
import FilterData from "../Filters/Types/FilterData";
import FieldType from "../Types/FieldType";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Includes from "../../../Types/BaseDatabase/Includes";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Query from "../../../Types/BaseDatabase/Query";
import QueryOperator from "../../../Types/BaseDatabase/QueryOperator";
import Search from "../../../Types/BaseDatabase/Search";
import Typeof from "../../../Types/Typeof";

/**
 * Translate the filter popup's selections into the database query the table
 * fetches with.
 *
 * Lives outside `BaseModelTable` on purpose: the table needs to derive the
 * query *synchronously during its first render* when filters are restored from
 * the URL (otherwise the first fetch would go out unfiltered and be
 * immediately superseded), and a pure function is the only way to do that
 * without an effect.
 */
export type GetFilterKeysFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  filters: Array<Filter<TBaseModel>>,
) => Array<string>;

/**
 * The model fields this table actually exposes a filter for.
 */
export const getFilterKeys: GetFilterKeysFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(
  filters: Array<Filter<TBaseModel>>,
): Array<string> => {
  const keys: Array<string> = [];

  for (const filter of filters || []) {
    const key: string | undefined = filter.field
      ? Object.keys(filter.field)[0]
      : undefined;

    if (key) {
      keys.push(key);
    }
  }

  return keys;
};

export type SanitizeFilterDataFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  filterData: FilterData<TBaseModel>;
  filters: Array<Filter<TBaseModel>>;
}) => FilterData<TBaseModel>;

/**
 * Drop any key that this table does not expose as a filter.
 *
 * The filter snapshot arrives from the URL, which anyone can edit, and the
 * result is spread into the outgoing list query *after* the caller's own
 * scoping query. Without this, a hand-crafted link could add a constraint on a
 * field the table never offered — or overwrite the page's own scoping (say the
 * `projectId` on a nested list) — just by naming it in the query string.
 *
 * Restricting to declared filter keys keeps a shared link to exactly what the
 * filter UI could have produced.
 */
const sanitizeFilterData: SanitizeFilterDataFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  filterData: FilterData<TBaseModel>;
  filters: Array<Filter<TBaseModel>>;
}): FilterData<TBaseModel> => {
  const allowedKeys: Array<string> = getFilterKeys<TBaseModel>(data.filters);
  const sanitized: FilterData<TBaseModel> = {};

  for (const key in data.filterData || {}) {
    if (!allowedKeys.includes(key)) {
      continue;
    }

    const value: unknown = (data.filterData as any)[key];

    if (value === undefined || value === null) {
      continue;
    }

    (sanitized as any)[key] = value;
  }

  return sanitized;
};

export { sanitizeFilterData };

export type BuildQueryFromFilterDataFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  filterData: FilterData<TBaseModel>;
  filters: Array<Filter<TBaseModel>>;
}) => Query<TBaseModel>;

const buildQueryFromFilterData: BuildQueryFromFilterDataFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  filterData: FilterData<TBaseModel>;
  filters: Array<Filter<TBaseModel>>;
}): Query<TBaseModel> => {
  const filterData: FilterData<TBaseModel> = data.filterData || {};
  const filters: Array<Filter<TBaseModel>> = data.filters || [];

  const query: Query<TBaseModel> = {};

  for (const key in filterData) {
    const value: unknown = filterData[key];

    if (value && typeof value === Typeof.String) {
      query[key as keyof TBaseModel] = (value || "").toString();
    }

    if (typeof value === Typeof.Boolean) {
      query[key as keyof TBaseModel] = Boolean(value);
    }

    if (typeof value === Typeof.Number) {
      query[key as keyof TBaseModel] = value as any;
    }

    if (value instanceof Date) {
      query[key as keyof TBaseModel] = value as any;
    }

    if (value instanceof Search) {
      query[key as keyof TBaseModel] = value as any;
    }

    if (value instanceof InBetween) {
      query[key as keyof TBaseModel] = value as any;
    }

    if (
      filters.find((f: Filter<TBaseModel>) => {
        return f.field && (f.field as any)[key];
      })?.type === FieldType.JSON &&
      typeof value === Typeof.Object
    ) {
      query[key as keyof TBaseModel] = value as any;
    }

    if (Array.isArray(value)) {
      query[key as keyof TBaseModel] = new Includes(
        value as Array<string>,
      ) as any;
    }

    /*
     * Pass any QueryOperator instance (IncludesAll, IncludesNone, StartsWith,
     * EndsWith, NotContains, EqualTo, NotEqual, GreaterThan, LessThan,
     * InBetween, IsNull, NotNull, ...) through to the query as-is.
     */
    if (value instanceof QueryOperator) {
      query[key as keyof TBaseModel] = value as any;
    }
  }

  return query;
};

export default buildQueryFromFilterData;
