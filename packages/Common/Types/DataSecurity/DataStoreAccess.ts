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
  /*
   * Not used in UNUSED_ACCESS_DAYS days, as far as its cloud can say: it
   * was last used before then, or never since it was made, longer ago
   * (isAccessUnused). Unknown is not unused.
   */
  isUnused?: boolean | undefined;
}

/*
 * How long an identity goes unused before its access counts as access it
 * does not need: the period access reviews (SOC 2 CC6.2, PCI DSS 7.2.4,
 * ISO/IEC 27001 A.5.18) look back over.
 */
export const UNUSED_ACCESS_DAYS: number = 90;

/*
 * Whether an identity has gone unused for UNUSED_ACCESS_DAYS days: its
 * last use is older than that, or the cloud records no use of it at all
 * and it was made longer ago than that (hasNoRecordedUse, which its reader
 * works out). An identity whose use the cloud does not say is never
 * unused: OneUptime does not guess.
 */
export function isAccessUnused(data: {
  lastUsedAt?: Date | null | undefined;
  hasNoRecordedUse?: boolean | undefined;
  now: Date;
}): boolean {
  const cutoff: number =
    data.now.getTime() - UNUSED_ACCESS_DAYS * 24 * 60 * 60 * 1000;

  if (data.lastUsedAt) {
    const time: number = new Date(data.lastUsedAt).getTime();

    return Number.isFinite(time) && time < cutoff;
  }

  return Boolean(data.hasNoRecordedUse);
}

// What identifies an entry within its store: one row per principal, level and grant.
export function getDataStoreAccessKey(entry: DataStoreAccessEntry): string {
  return [entry.principal, entry.accessLevel, entry.grantedVia]
    .join("|")
    .slice(0, 500);
}
