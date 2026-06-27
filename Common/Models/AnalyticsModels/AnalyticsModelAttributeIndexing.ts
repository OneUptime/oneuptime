import AnalyticsTableColumn, {
  SkipIndex,
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";

/*
 * Shared indexing for the telemetry `attributes` Map(String, String) column.
 *
 * Raw `attributes['k'] = 'v'` filters (every dashboard widget, telemetry
 * monitor, and facet) compile to a Map subscript with NO skip index, forcing a
 * full granule scan. These two helpers make arbitrary attribute filtering
 * granule-prunable, for EVERY consumer, with no query-code changes:
 *
 *  - attributeMapSkipIndexes()  (Option A): bloom filters on mapKeys/mapValues
 *    of `attributes`, so any equality (value presence) and key-existence
 *    (mapContains) filter can prune granules. Cheap, value-only precision.
 *
 *  - attributeValueTokensColumn() (Option B): a MATERIALIZED Array(String) of
 *    cityHash64('key=value') for every attribute entry, with its own bloom
 *    filter. StatementGenerator rewrites `attributes['k']='v'` to
 *    `has(attributeValueTokens, toString(cityHash64(concat('k','=','v')))) OR
 *    attributes['k']='v'` — key+value precision. ClickHouse computes the hash
 *    on both ingest (MATERIALIZED) and read, so they byte-match.
 *
 * They reinforce each other: A's mapValues index prunes B's OR-fallback branch
 * so the OR does not defeat B's token index, and B is correct even for rows
 * ingested before the column existed.
 *
 * Both expressions MUST be identical across every attributes-bearing table
 * (Log/Span/Metric/ExceptionInstance/Profile) — keep them here, never inline.
 */

const ATTRIBUTES_COLUMN: string = "attributes";

export function attributeMapSkipIndexes(): Array<SkipIndex> {
  return [
    {
      name: "idx_attributes_keys",
      type: SkipIndexType.BloomFilter,
      params: [0.01],
      granularity: 1,
      expression: `mapKeys(${ATTRIBUTES_COLUMN})`,
    },
    {
      name: "idx_attributes_values",
      type: SkipIndexType.BloomFilter,
      params: [0.01],
      granularity: 1,
      expression: `mapValues(${ATTRIBUTES_COLUMN})`,
    },
  ];
}

export function attributeValueTokensColumn(
  accessControl: ColumnAccessControl,
): AnalyticsTableColumn {
  return new AnalyticsTableColumn({
    key: "attributeValueTokens",
    title: "Attribute Value Tokens",
    description:
      "Index-only: cityHash64('key=value') for each entry of `attributes`, computed by ClickHouse (MATERIALIZED). Lets attributes['k']='v' filters use a bloom-filter skip index instead of scanning the Map.",
    required: true,
    defaultValue: [],
    type: TableColumnType.ArrayText,
    codec: { codec: "ZSTD", level: 1 },
    /*
     * MATERIALIZED — never inserted by the app. mapKeys/mapValues return
     * parallel arrays in matching order, so arrayMap zips each key with its
     * value. '=' is an unambiguous separator: OTel attribute keys never
     * contain '='. Must byte-match the read-side rewrite in StatementGenerator
     * (toString(cityHash64(concat(k, '=', v)))).
     */
    computedExpression: `arrayMap((k, v) -> toString(cityHash64(concat(k, '=', v))), mapKeys(${ATTRIBUTES_COLUMN}), mapValues(${ATTRIBUTES_COLUMN}))`,
    skipIndex: {
      name: "idx_attribute_value_tokens",
      type: SkipIndexType.BloomFilter,
      params: [0.01],
      granularity: 1,
    },
    accessControl,
  });
}
