import {
  ManualDatabaseEndpoint,
  parseManualDatabaseEndpoint,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";

/*
 * The "add a database by hand" form's Server Address field: what it says,
 * and what it checks before the form is sent. parseManualDatabaseEndpoint
 * is isomorphic and is the same interpretation the identity rules use, so
 * the form refuses what could never become an endpoint — `user@host`, a
 * cluster qualifier on a public name, loopback, a port out of range — with
 * a message that says what to change, and offers (never forces) the
 * `@<cluster>` form for an address that only resolves inside one cluster
 * or private network.
 *
 * No React here; the page wires these into its form field.
 */

export const DATABASE_SERVER_ADDRESS_DESCRIPTION: string =
  "The host name or IP your applications connect to — what their traces report as server.address. Never localhost. For an address that only resolves inside one Kubernetes cluster (pg.shop.svc.cluster.local, pg.shop) or a private IP, add the cluster your agent reports: pg.shop.svc.cluster.local:5432@prod-eu. A SQL Server named instance is host\\INSTANCE. Do not include a user name (user@host).";

// The create form's values these helpers read.
export interface DatabaseServerAddressFormValues {
  dbSystem?: unknown;
  serverAddress?: unknown;
  serverPort?: unknown;
}

function interpret(
  values: DatabaseServerAddressFormValues | null | undefined,
): ManualDatabaseEndpoint {
  return parseManualDatabaseEndpoint(values?.serverAddress, {
    system: typeof values?.dbSystem === "string" ? values.dbSystem : "",
    port: values?.serverPort,
  });
}

/**
 * The form error for the typed address (and port field), or null when it
 * can be used.
 */
export function validateDatabaseServerAddress(
  values: DatabaseServerAddressFormValues | null | undefined,
): string | null {
  return interpret(values).error;
}

/**
 * Advice for an accepted address that only resolves inside one cluster or
 * private network and names no cluster; null otherwise (and for an address
 * that is refused — the error says what to change).
 */
export function getDatabaseServerAddressHint(
  values: DatabaseServerAddressFormValues | null | undefined,
): string | null {
  const text: string =
    typeof values?.serverAddress === "string"
      ? values.serverAddress.trim()
      : "";
  if (!text) {
    return null;
  }
  const result: ManualDatabaseEndpoint = interpret(values);
  return result.endpoint ? result.clusterQualifierHint : null;
}
