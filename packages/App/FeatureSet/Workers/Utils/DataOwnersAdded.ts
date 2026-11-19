/*
 * THE "YOU WERE ADDED AS AN OWNER" JOBS OF DATA OBSERVABILITY'S TABLES AND
 * PIPELINES, AND OF THE DATA STORES IT SHARES WITH DATA SECURITY (#9681).
 *
 * Three jobs tell their new owners as every other record's are told
 * (OwnersAdded): DataAssetOwners, DataPipelineOwners and DataStoreOwners.
 * Each waits while every product its owner rows serve is switched off on
 * the server - a table's or a pipeline's while Data Observability is off, a
 * data store's while Data Observability and Data Security both are - and
 * says the same thing on every channel, through the messages every
 * owner-added job builds (ResourceOwnersAdded), in an email of its own.
 * What only they share - how a table and a pipeline are named - is here.
 *
 * The owner rows that were already not notified when the jobs came were
 * marked told by a migration (MarkDataOwnersAddedBeforeNotificationsAsTold),
 * so the first run sends no old news.
 */

// A table as its page names it: "analytics.orders", or its name alone.
export function getDataTableName(data: {
  name?: string | undefined;
  schemaName?: string | undefined;
}): string {
  const name: string = data.name || "table";

  return data.schemaName ? `${data.schemaName}.${name}` : name;
}

// A pipeline as its page names it: its job's name, else its namespace.
export function getDataPipelineName(data: {
  jobName?: string | undefined;
  jobNamespace?: string | undefined;
}): string {
  return data.jobName || data.jobNamespace || "pipeline";
}
