import {
  DataStoreExposureCheck,
  getDataStoreExposureCheck,
} from "./DataStoreKind";

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
 *
 * A self-managed store no cloud lists is read from its own endpoint
 * instead (#11140, Server/Utils/DataSecurity/Content/SearchEndpointCheck):
 * with each content scan, from where the scan runs, OneUptime asks it
 * without credentials whether it answers, and whether it takes connections
 * without TLS. That says nothing of what only its own network or its
 * operators know - whether the internet reaches it, what its firewall
 * lets in - so those facts are null and named in unknowableFacts: the
 * store's page says they cannot be checked from there, never Unknown as if
 * a read had failed.
 */

/*
 * Where a store's own endpoint was checked from (#11140): from outside your
 * networks - OneUptime's own servers, on OneUptime Cloud - or from inside
 * them: a probe, or the workers of a OneUptime you host yourself.
 */
export enum DataStorePostureReadFrom {
  Internet = "internet",
  Network = "network",
}

export interface DataStorePostureFacts {
  // When the facts were read, as ISO 8601.
  readAt?: string | undefined;

  /*
   * Where the facts were read from: absent for a cloud's own API, which
   * reads the store's configuration and who can reach it; set for a
   * self-managed store's own endpoint (#11140), which says only what that
   * endpoint answers - never who holds access to it.
   */
  readFrom?: DataStorePostureReadFrom | undefined;
  /*
   * The facts that cannot be known from where they were read, by key: null
   * among the facts, and drawn as "Can't be checked from there" rather than
   * Unknown.
   */
  unknowableFacts?: Array<string> | undefined;

  /*
   * Seen from the store's own endpoint, asked without credentials (#11140):
   * whether anyone who reaches it can read its data, and change it. True
   * when it answered a search without credentials - and, for changes, when
   * it reports no access control of its own at all - false when it refused
   * a request without credentials, null when it could not be told.
   */
  anonymousRead?: boolean | null | undefined;
  anonymousWrite?: boolean | null | undefined;

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

/*
 * Where a store sits relative to the internet and to other organizations -
 * or why OneUptime cannot say (#11140): it has not checked yet, it has no
 * way to check this kind of store, or it checked and could not tell. The
 * three read alike as "Unknown" before, so a store nothing will ever check
 * looked like one about to be.
 */
export enum DataStoreExposure {
  Public = "Public",
  OtherAccounts = "Other accounts",
  InternetReachable = "Internet reachable",
  Private = "Private",
  Unknown = "Unknown",
  NotChecked = "Not checked yet",
  CannotBeChecked = "Can't be checked",
}

export const ALL_DATA_STORE_EXPOSURES: ReadonlyArray<DataStoreExposure> = [
  DataStoreExposure.Public,
  DataStoreExposure.OtherAccounts,
  DataStoreExposure.InternetReachable,
  DataStoreExposure.Private,
  DataStoreExposure.Unknown,
  DataStoreExposure.NotChecked,
  DataStoreExposure.CannotBeChecked,
];

// The exposures that say OneUptime does not know, each for its own reason.
export const UNKNOWN_DATA_STORE_EXPOSURES: ReadonlyArray<DataStoreExposure> = [
  DataStoreExposure.Unknown,
  DataStoreExposure.NotChecked,
  DataStoreExposure.CannotBeChecked,
];

export function isDataStoreExposure(
  value: unknown,
): value is DataStoreExposure {
  return (
    typeof value === "string" &&
    (ALL_DATA_STORE_EXPOSURES as ReadonlyArray<string>).includes(value)
  );
}

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
    "OneUptime checked it, but could not tell from what it could read.",
  [DataStoreExposure.NotChecked]:
    "OneUptime has not checked how it can be reached yet.",
  [DataStoreExposure.CannotBeChecked]:
    "OneUptime has no way to check how this kind of store can be reached.",
};

/*
 * The weight exposure adds to an issue's risk score (DataSecurityRisk.ts).
 * Not knowing weighs the same whatever the reason.
 */
export const DATA_STORE_EXPOSURE_WEIGHT: Readonly<
  Record<DataStoreExposure, number>
> = {
  [DataStoreExposure.Public]: 1,
  [DataStoreExposure.OtherAccounts]: 0.8,
  [DataStoreExposure.InternetReachable]: 0.6,
  [DataStoreExposure.Private]: 0,
  [DataStoreExposure.Unknown]: 0.3,
  [DataStoreExposure.NotChecked]: 0.3,
  [DataStoreExposure.CannotBeChecked]: 0.3,
};

// Whether the facts were read from a cloud's own API: its configuration and who can reach it.
export function isPostureFromCloudApi(
  facts: DataStorePostureFacts | null | undefined,
): boolean {
  return Boolean(facts?.readAt) && !facts?.readFrom;
}

// Whether a fact cannot be known from where the facts were read (#11140).
export function isPostureFactUnknowable(
  facts: DataStorePostureFacts | null | undefined,
  key: string,
): boolean {
  return Array.isArray(facts?.unknowableFacts)
    ? facts!.unknowableFacts.includes(key)
    : false;
}

/*
 * A store's exposure from its facts: public beats shared, shared beats
 * reachable. A kind with no such facts at all (a DynamoDB table, a file
 * system: reached only with credentials) is Private, and so is a store
 * OneUptime holds itself. Nothing read at all is Not checked yet, or Can't
 * be checked for a kind nothing reads (getDataStoreExposureCheck); a store
 * whose reachability could not be read, or cannot be from where it was
 * read, is Unknown.
 */
export function getDataStoreExposure(
  facts: DataStorePostureFacts | null | undefined,
  kind?: string | null | undefined,
): DataStoreExposure {
  const check: DataStoreExposureCheck | null = kind
    ? getDataStoreExposureCheck(kind)
    : null;

  if (check === DataStoreExposureCheck.HeldByOneUptime) {
    return DataStoreExposure.Private;
  }

  if (!facts || !facts.readAt) {
    return check === DataStoreExposureCheck.None
      ? DataStoreExposure.CannotBeChecked
      : DataStoreExposure.NotChecked;
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
