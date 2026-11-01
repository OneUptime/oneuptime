/*
 * WHAT A STORE'S CONFIGURATION SAYS ABOUT ITS SAFETY, IN ONE SHAPE FOR EVERY
 * CLOUD.
 *
 * Each cloud says the same things in its own words - an S3 bucket's public
 * access block, an Azure storage account's allowBlobPublicAccess, a Cloud
 * Storage bucket's allUsers binding - so the readers (one per provider)
 * translate what they read into these facts, and every check reads only
 * the facts. A check written once then holds for every cloud, and a new
 * cloud needs a reader, not new checks.
 *
 * Every fact is three-valued. true and false are what the cloud said; null
 * means the reader could not tell (the permission was missing, the call
 * failed) and a check of it reports Unknown rather than guessing; a fact
 * that is absent does not apply to the store's kind.
 */

export interface DataStorePostureFacts {
  // When the facts were read, as ISO 8601.
  readAt?: string | undefined;

  // Exposure.
  publicRead?: boolean | null | undefined;
  publicWrite?: boolean | null | undefined;
  // In the cloud's words: what makes it public.
  publicReason?: string | undefined;
  blockPublicAccess?: boolean | null | undefined;
  publicNetworkAccess?: boolean | null | undefined;
  openToAllAddresses?: boolean | null | undefined;
  // Accounts, tenants or projects outside the connected ones that have access.
  sharedWithExternal?: Array<string> | undefined;
  snapshotPublic?: boolean | null | undefined;
  snapshotSharedWith?: Array<string> | undefined;
  /*
   * The store's own manual snapshots that are public or shared outside the
   * connected accounts, by id: what a response that revokes sharing acts on.
   */
  sharedSnapshotIds?: Array<string> | undefined;

  // Encryption.
  encryptedAtRest?: boolean | null | undefined;
  customerManagedKey?: boolean | null | undefined;
  encryptionInTransitEnforced?: boolean | null | undefined;
  minimumTlsVersion?: string | null | undefined;

  // Recovery.
  backupsEnabled?: boolean | null | undefined;
  backupRetentionDays?: number | null | undefined;
  pointInTimeRecovery?: boolean | null | undefined;
  deletionProtection?: boolean | null | undefined;
  versioning?: boolean | null | undefined;
  softDelete?: boolean | null | undefined;

  // Visibility: whether reads of the data are recorded somewhere.
  accessLogging?: boolean | null | undefined;

  // Access controls.
  sharedKeyAccess?: boolean | null | undefined;
  uniformAccess?: boolean | null | undefined;

  // Regions the data is copied to (replication, geo-redundancy, replicas).
  replicationRegions?: Array<string> | undefined;

  // What the reader could not read, in words, for the store's page.
  readWarnings?: Array<string> | undefined;
}

// Where a store sits relative to the internet and to other organizations.
export enum DataStoreExposure {
  Public = "Public",
  OtherAccounts = "Other accounts",
  InternetReachable = "Internet reachable",
  Private = "Private",
  Unknown = "Unknown",
}

export const ALL_DATA_STORE_EXPOSURES: ReadonlyArray<DataStoreExposure> = [
  DataStoreExposure.Public,
  DataStoreExposure.OtherAccounts,
  DataStoreExposure.InternetReachable,
  DataStoreExposure.Private,
  DataStoreExposure.Unknown,
];

export const DATA_STORE_EXPOSURE_DESCRIPTION: Readonly<
  Record<DataStoreExposure, string>
> = {
  [DataStoreExposure.Public]: "Anyone on the internet can read it.",
  [DataStoreExposure.OtherAccounts]:
    "Accounts outside your connected ones can reach it.",
  [DataStoreExposure.InternetReachable]:
    "Its network endpoint accepts connections from the internet.",
  [DataStoreExposure.Private]: "Only your own accounts and networks reach it.",
  [DataStoreExposure.Unknown]:
    "OneUptime could not read enough of its configuration to tell.",
};

// The weight exposure adds to an issue's risk score (DataSecurityRisk.ts).
export const DATA_STORE_EXPOSURE_WEIGHT: Readonly<
  Record<DataStoreExposure, number>
> = {
  [DataStoreExposure.Public]: 1,
  [DataStoreExposure.OtherAccounts]: 0.8,
  [DataStoreExposure.InternetReachable]: 0.6,
  [DataStoreExposure.Private]: 0,
  [DataStoreExposure.Unknown]: 0.3,
};

/*
 * A store's exposure from its facts: public beats shared, shared beats
 * reachable. Nothing read at all is Unknown, and so is a store whose
 * reachability could not be read; a kind with no such facts at all (a
 * DynamoDB table, a file system: reached only with credentials) is
 * Private.
 */
export function getDataStoreExposure(
  facts: DataStorePostureFacts | null | undefined,
): DataStoreExposure {
  if (!facts || !facts.readAt) {
    return DataStoreExposure.Unknown;
  }

  if (
    facts.publicRead === true ||
    facts.publicWrite === true ||
    facts.snapshotPublic === true
  ) {
    return DataStoreExposure.Public;
  }

  if (
    (facts.sharedWithExternal || []).length > 0 ||
    (facts.snapshotSharedWith || []).length > 0
  ) {
    return DataStoreExposure.OtherAccounts;
  }

  if (facts.publicNetworkAccess === true || facts.openToAllAddresses === true) {
    return DataStoreExposure.InternetReachable;
  }

  /*
   * Private only when nothing that decides it is missing. A store's policy
   * side - who may read or write it anonymously - is unknown when either
   * could not be read, unless public access is blocked outright; its
   * network side is unknown when the network rules could not be read,
   * unless public network access is off (then the firewall rules do not
   * matter).
   */
  const policyUnknown: boolean =
    (facts.publicRead === null || facts.publicWrite === null) &&
    facts.blockPublicAccess !== true;
  const networkUnknown: boolean =
    facts.publicNetworkAccess !== false &&
    (facts.publicNetworkAccess === null || facts.openToAllAddresses === null);

  if (policyUnknown || networkUnknown) {
    return DataStoreExposure.Unknown;
  }

  return DataStoreExposure.Private;
}

// TLS versions as numbers, so "1.0" < "1.2" compares as people mean it.
export function tlsVersionNumber(version: string | null | undefined): number {
  if (!version) {
    return 0;
  }

  const match: RegExpMatchArray | null = version.match(/([0-9])[._]([0-9])/);

  return match ? Number(match[1]) + Number(match[2]) / 10 : 0;
}
