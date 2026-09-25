import {
  ManualDatabaseEndpoint,
  isKubernetesServiceDnsHost,
  parseManualDatabaseEndpoint,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";

/*
 * The "add a database by hand" form's Server Address field: what it says,
 * and what it checks before the form is sent. parseManualDatabaseEndpoint
 * is isomorphic and is the same interpretation the identity rules use, so
 * the form refuses what could never become an endpoint — `user@host`, a
 * cluster qualifier on a public name, loopback, a port out of range — with
 * a message that says what to change, and offers the `@<cluster>` form for
 * an address that only resolves inside one cluster or private network.
 *
 * For a private IP or a private-zone name (`.internal`, `.local`) that is
 * advice only: virtual machines and the Database Agent report those names
 * unqualified. A Kubernetes Service name (`pg.shop.svc.cluster.local`,
 * `pg.shop.svc`) is different: the server refuses it without its cluster
 * once the project has a Kubernetes cluster
 * (DatabaseServerService.refuseUnqualifiedKubernetesServiceName). The form
 * cannot tell whether the project has one, so it keeps the value and says
 * so up front, and the server's refusal names the project's clusters.
 *
 * No React here; the page wires these into its form field.
 */

/*
 * Every example is read the way the create form reads it — without a
 * namespace to complete a short name — so the cluster-only examples are
 * ones that parse as cluster-only there: `pg.shop.svc`, not `pg.shop`
 * (a two-label name is an ordinary DNS domain without a namespace).
 */
export const DATABASE_SERVER_ADDRESS_DESCRIPTION: string =
  "The host name or IP your applications connect to — what their traces report as server.address. Never localhost. For an address that only resolves inside one Kubernetes cluster (pg.shop.svc.cluster.local, pg.shop.svc) or a private IP, add the cluster your agent reports: pg.shop.svc.cluster.local:5432@prod-eu. A SQL Server named instance is host\\INSTANCE. Do not include a user name (user@host).";

/*
 * Appended to the `@<cluster>` advice for a Kubernetes Service name: for
 * those the qualifier is required, not just advised, in a project with
 * Kubernetes clusters.
 */
export const DATABASE_SERVER_SERVICE_NAME_CLUSTER_REQUIRED: string =
  "For a Kubernetes Service name the cluster is required once this project has a Kubernetes cluster: the database is not added without it.";

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
 * that is refused — the error says what to change). For a Kubernetes
 * Service name it also says the cluster is required in a project with
 * clusters — the same test the server's refusal applies.
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
  if (!result.endpoint || !result.clusterQualifierHint) {
    return null;
  }
  return isKubernetesServiceDnsHost(result.endpoint.host)
    ? `${result.clusterQualifierHint} ${DATABASE_SERVER_SERVICE_NAME_CLUSTER_REQUIRED}`
    : result.clusterQualifierHint;
}
