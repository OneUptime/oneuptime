/*
 * Where a sort puts the records with no value in its field, as in
 * { "declaredAt": { "direction": "DESC", "nulls": "LAST" } } (#8141). The
 * API reads either case (SortValidator); the OpenAPI spec and the MCP list
 * tools publish these.
 */
enum SortNulls {
  First = "FIRST",
  Last = "LAST",
}

export default SortNulls;
