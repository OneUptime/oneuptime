import { DataStoreKind } from "./DataStoreKind";

/*
 * WHAT IDENTIFIES A STORE WITHIN A PROJECT.
 *
 * Discovery finds the same store over and over - from inventory, from
 * metrics, from traces - so every source builds its key the same way, and
 * DataStore's unique (projectId, storeKey) index keeps one row per store.
 * Cloud stores are keyed by their provider's own id (an ARN, an Azure
 * resource id, a Google Cloud resource name), lower-cased where the cloud
 * treats ids without case; telemetry stores by service and signal;
 * monitored databases by their Database product row.
 */

export function cloudDataStoreKey(data: {
  provider: string;
  kind: DataStoreKind;
  providerResourceId: string;
}): string {
  const id: string =
    data.provider === "azure"
      ? data.providerResourceId.toLowerCase()
      : data.providerResourceId;

  return `cloud:${data.provider}:${data.kind}:${id}`.slice(0, 500);
}

export function telemetryDataStoreKey(data: {
  serviceId: string;
  kind: DataStoreKind;
}): string {
  return `telemetry:${data.serviceId}:${data.kind}`;
}

export function databaseServerDataStoreKey(databaseServerId: string): string {
  return `database:${databaseServerId}`;
}

/*
 * A database seen only in traces: its engine, address and database name,
 * lower-cased, as the service map names it.
 */
export function tracedDatabaseDataStoreKey(data: {
  system: string;
  address: string;
  namespace?: string | undefined;
}): string {
  return `traced:${data.system}:${data.address}:${data.namespace || ""}`
    .toLowerCase()
    .slice(0, 500);
}

/*
 * The entity a store is in Security Operations - on cases, in entity risk
 * and criticality: its key behind a "data-store:" prefix, so that a store
 * is never taken for a URL or a host name.
 */
export const DATA_STORE_ENTITY_PREFIX: string = "data-store:";

export function dataStoreEntityValue(storeKey: string): string {
  return `${DATA_STORE_ENTITY_PREFIX}${storeKey}`;
}
