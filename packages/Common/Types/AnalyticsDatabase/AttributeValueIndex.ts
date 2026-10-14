import { SkipIndex, SkipIndexExpression, SkipIndexType } from "./TableColumn";

/*
 * The attribute value index of the telemetry tables people search by
 * attribute: LogItemV3 and SpanItemV3.
 *
 * Why it exists (issue #4706): a search such as `@http.route:/orders` used
 * to decompress the whole `attributes` map - the widest column of the table
 * - for every row in the time range. idx_attribute_keys cannot help with
 * that: it skips granules that lack a KEY, and almost every granule of a
 * busy service carries almost every key. Nothing indexed the values, so a
 * day of a busy project read tens of millions of rows and hit the 45 s
 * query limit.
 *
 * What it is: a bloom filter over `mapValues(attributes)`, one filter per
 * granule. A granule whose filter says "no attribute here has the value
 * '/orders'" is skipped without being read.
 *
 * Which filters can use it - only those that need one exact value to be
 * present under some key:
 *  - `attributes['k'] = 'v'` and `attributes['k'] IN (...)` with non-empty
 *    values: ClickHouse maps the subscript to the value index itself, so
 *    the logs / traces LIST (StatementGenerator) skips granules with no
 *    query change.
 *  - `has(mapValues(attributes), 'v')` / `hasAny(...)`: the form the
 *    histogram, facets, analytics and export add in front of their
 *    case-insensitive `arrayExists` match (AttributeFilterStatement), which
 *    no index can see through.
 *  Everything else reads what it read before: a blank value (a missing key
 *  reads as ''), `!=`, `NOT IN`, contains / starts with / ends with /
 *  wildcards, numeric comparisons and exists / does not exist.
 *
 * How much it helps depends on how rare the value is per GRANULE, not per
 * table: a value in one row of a few thousand is in most granules and
 * prunes little; a request path, user, tenant, order or session id that a
 * few hundred rows of a day carry - or a burst of rows close in time -
 * prunes almost everything.
 *
 * bloom_filter(0.01): one granule in a hundred that lacks the value is read
 * anyway. GRANULARITY 1: one filter per granule, the same as
 * idx_attribute_keys, so the index can skip each granule on its own.
 *
 * Existing installs: boot schema-sync (AnalyticsTableManagement
 * .reconcileSkipIndexes) adds the index definition - metadata only, no part
 * is rewritten. Parts written from then on carry it, and older parts gain
 * it when they merge; MaterializeAttributeValuesIndex builds it for the
 * most recent days in the background so the searches people run most are
 * fast straight away. Data older than that is searched as before until it
 * is merged or ages out.
 */
export const ATTRIBUTE_VALUES_INDEX_NAME: string = "idx_attribute_values";

type AttributeValuesSkipIndexFunction = () => SkipIndex;

// A fresh object per model, so one table's schema can never alter another's.
export const attributeValuesSkipIndex: AttributeValuesSkipIndexFunction =
  (): SkipIndex => {
    return {
      name: ATTRIBUTE_VALUES_INDEX_NAME,
      type: SkipIndexType.BloomFilter,
      params: [0.01],
      granularity: 1,
      expression: SkipIndexExpression.MapValues,
    };
  };
