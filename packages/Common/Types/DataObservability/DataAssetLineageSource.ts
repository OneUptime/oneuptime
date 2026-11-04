/*
 * WHERE AN EDGE OF LINEAGE WAS SEEN.
 *
 *  - Pipeline: a pipeline's run read one table and wrote the other
 *    (OpenLineage, or a dbt model built from its sources).
 *  - Query History: the database's own record of the queries it ran shows
 *    one that read the first table and wrote the second (BigQuery's jobs,
 *    Redshift's query log), so no pipeline has to say so.
 *  - View Definition: the second is a view the database defines over the
 *    first.
 */
enum DataAssetLineageSource {
  Pipeline = "Pipeline",
  QueryHistory = "Query History",
  ViewDefinition = "View Definition",
}

export function isDataAssetLineageSource(
  value: unknown,
): value is DataAssetLineageSource {
  return (
    typeof value === "string" &&
    Object.values(DataAssetLineageSource).includes(
      value as DataAssetLineageSource,
    )
  );
}

export default DataAssetLineageSource;
