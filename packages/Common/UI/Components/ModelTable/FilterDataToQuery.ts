import Filter from "../ModelFilter/Filter";
import { toDateFilterQueryValue } from "../Filters/DateFilterValue";
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

export type RenameFilterDataKeysFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  filterData: FilterData<TBaseModel>;
  // A filter's old key, by the key the table filters by now.
  renamedKeys?: Readonly<Record<string, string>> | undefined;
}) => FilterData<TBaseModel>;

/**
 * A filter snapshot made when a table keyed a filter by another field - a
 * link someone shared, a bookmark - read under the key the table uses now,
 * so it still filters by what it said (UX principle 8: nothing to relearn).
 * The Devices list's Vendor filter read `vendor` before it read the maker
 * the server keeps, `manufacturer` (#9363). A key the snapshot already holds
 * under its new name keeps that value; an old key with no new name is left
 * for sanitizeFilterData to drop.
 */
const renameFilterDataKeys: RenameFilterDataKeysFunction = <
  TBaseModel extends BaseModel | AnalyticsBaseModel,
>(data: {
  filterData: FilterData<TBaseModel>;
  renamedKeys?: Readonly<Record<string, string>> | undefined;
}): FilterData<TBaseModel> => {
  const renamedKeys: Readonly<Record<string, string>> = data.renamedKeys || {};
  const renamed: FilterData<TBaseModel> = {};

  for (const key in data.filterData || {}) {
    const value: unknown = (data.filterData as any)[key];
    const newKey: string | undefined = Object.prototype.hasOwnProperty.call(
      renamedKeys,
      key,
    )
      ? renamedKeys[key]
      : undefined;

    if (!newKey) {
      (renamed as any)[key] = value;
      continue;
    }

    if ((data.filterData as any)[newKey] === undefined) {
      (renamed as any)[newKey] = value;
    }
  }

  return renamed;
};

export { renameFilterDataKeys };

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

    const filterType: FieldType | undefined = filters.find(
      (f: Filter<TBaseModel>) => {
        return f.field && (f.field as any)[key];
      },
    )?.type;

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

    if (filterType === FieldType.JSON && typeof value === Typeof.Object) {
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

    /*
     * A date filter asks for the span its moments stand for - the whole
     * minute, or the whole day for a date - as its controls and its chip
     * read it (DateFilterValue, #7719), whether its value came from the
     * controls, a link or a saved view from before: an old "Is" was the
     * instant 11:15:00.000, and found nothing its chip named.
     */
    if (
      (filterType === FieldType.Date || filterType === FieldType.DateTime) &&
      query[key as keyof TBaseModel] !== undefined
    ) {
      query[key as keyof TBaseModel] = toDateFilterQueryValue(
        query[key as keyof TBaseModel],
        filterType === FieldType.DateTime,
      ) as any;
    }
  }

  return query;
};

export default buildQueryFromFilterData;
