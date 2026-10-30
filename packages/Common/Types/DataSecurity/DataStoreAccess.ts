/*
 * WHO CAN REACH A STORE, IN ONE SHAPE FOR EVERY CLOUD.
 *
 * Each provider's reader turns its own access settings - bucket policies
 * and ACLs, Azure role assignments, Google Cloud IAM bindings, snapshot
 * shares - into these entries; the service map adds the services seen
 * using a store. DataStoreAccess rows are written from them.
 */

export enum DataStorePrincipalType {
  Public = "Public",
  Account = "Account",
  Role = "Role",
  User = "User",
  Group = "Group",
  ServicePrincipal = "Service Principal",
  ServiceAccount = "Service Account",
  Service = "Service",
}

export enum DataStoreAccessLevel {
  Read = "Read",
  Write = "Write",
  Admin = "Admin",
}

export interface DataStoreAccessEntry {
  // Who or what has access, as its cloud names it.
  principal: string;
  principalName?: string | undefined;
  principalType: DataStorePrincipalType;
  accessLevel: DataStoreAccessLevel;
  // What grants it: "Bucket policy", "ACL", "Role assignment: Storage Blob Data Reader".
  grantedVia: string;
  // Outside the project's connected accounts, tenants or projects.
  isExternal: boolean;
  isPublic: boolean;
  isSeenInTraces?: boolean | undefined;
  lastUsedAt?: Date | undefined;
}

// What identifies an entry within its store: one row per principal, level and grant.
export function getDataStoreAccessKey(entry: DataStoreAccessEntry): string {
  return [entry.principal, entry.accessLevel, entry.grantedVia]
    .join("|")
    .slice(0, 500);
}
