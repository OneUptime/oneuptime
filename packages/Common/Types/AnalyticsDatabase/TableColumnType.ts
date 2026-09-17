enum ColumnType {
  ObjectID = "Object ID",
  Date = "Date",
  Boolean = "Boolean",
  Number = "Number",
  Text = "Text",
  JSON = "JSON",
  JSONArray = "JSON Array",
  Decimal = "Decimal",
  ArrayNumber = "Array of Numbers",
  ArrayText = "Array of Text",
  LongNumber = "Long Number",
  BigNumber = "Big Number",
  DateTime64 = "DateTime64",
  IP = "IP",
  Port = "Port",
  MapStringString = "Map(String, String)",
  ArrayBigNumber = "Array of Big Numbers",
  ArrayDecimal = "Array of Decimals",
  /*
   * ClickHouse AggregateFunction(...) state column. Used by the target
   * tables of AggregatingMergeTree materialized views (e.g. the
   * per-minute metric pre-aggregate, anomaly baseline rolls).
   *
   * The concrete function and argument types live in the column's
   * `aggregateFunctionDefinition` field — e.g. "stddevPop, Float64" —
   * because the parameterization can't be expressed as a single enum
   * value (you'd need a combinatorial explosion). The schema generator
   * emits `AggregateFunction(<aggregateFunctionDefinition>)` for these
   * columns and skips the usual `Nullable(...)` wrap (ClickHouse does
   * not support nullable AggregateFunction columns).
   */
  AggregateFunction = "AggregateFunction",
  /*
   * 8-bit unsigned integer. We don't have a generic `UInt*` family; this
   * is added so columns like `hourOfWeek` (range 0..167) can declare
   * their tight ClickHouse type instead of paying for an Int32. Future
   * UInt sizes can be added if there's a reason.
   */
  UInt8 = "UInt8",
  UInt64 = "UInt64",
}

export default ColumnType;
