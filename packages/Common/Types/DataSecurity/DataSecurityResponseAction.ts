import { DataStoreKind } from "./DataStoreKind";

/*
 * FIXING A STORE FROM ITS ISSUE, AS DATA.
 *
 * What Data Security can change on a cloud store, through the store's
 * cloud connection - and only when that connection's "Data security
 * response" setting is on, whose setup command grants the narrow write
 * role (CloudConnectionSetupCommands):
 *
 *   Block public access     an S3 bucket's four Block Public Access
 *                           settings on, an Azure storage account's
 *                           anonymous blob access off, a Cloud Storage
 *                           bucket's public access prevention enforced;
 *   Revoke sharing          an RDS snapshot - or every manual snapshot of
 *                           an RDS database, Aurora or DocumentDB cluster -
 *                           no longer restorable by everyone, or by
 *                           accounts outside the ones the project connected;
 *   Turn on versioning      an S3 or Cloud Storage bucket keeps the earlier
 *                           versions of what is overwritten or deleted;
 *   Turn on soft delete     an Azure storage account keeps deleted blobs and
 *                           containers for 14 days;
 *   Turn off object ACLs    an S3 bucket's Object Ownership set to Bucket
 *                           owner enforced: its policy alone decides access;
 *   Turn on uniform access  a Cloud Storage bucket's uniform bucket-level
 *                           access: its IAM policy alone decides access;
 *   Require secure transfer an Azure storage account takes HTTPS only, with
 *                           TLS 1.2 or later;
 *   Turn on point-in-time recovery
 *                           a DynamoDB table can be restored to any second
 *                           of the last 35 days.
 *
 * Each changes the store's configuration, never its data, and nothing it
 * does deletes anything. A person runs it from the issue it fixes
 * (Server/API/DataSecurityAPI); a Security Operations playbook runs the
 * first two, as approved steps. The server, the Dashboard and the playbook
 * steps read the same lists here.
 */

export enum DataSecurityResponseAction {
  BlockPublicAccess = "Block public access",
  RevokeSharing = "Revoke sharing",
  TurnOnVersioning = "Turn on versioning",
  TurnOnSoftDelete = "Turn on soft delete",
  TurnOffObjectAcls = "Turn off object ACLs",
  TurnOnUniformAccess = "Turn on uniform access",
  RequireSecureTransfer = "Require secure transfer",
  TurnOnPointInTimeRecovery = "Turn on point-in-time recovery",
}

export const ALL_DATA_SECURITY_RESPONSE_ACTIONS: ReadonlyArray<DataSecurityResponseAction> =
  [
    DataSecurityResponseAction.BlockPublicAccess,
    DataSecurityResponseAction.RevokeSharing,
    DataSecurityResponseAction.TurnOnVersioning,
    DataSecurityResponseAction.TurnOnSoftDelete,
    DataSecurityResponseAction.TurnOffObjectAcls,
    DataSecurityResponseAction.TurnOnUniformAccess,
    DataSecurityResponseAction.RequireSecureTransfer,
    DataSecurityResponseAction.TurnOnPointInTimeRecovery,
  ];

// The stores whose public access can be blocked.
export const BLOCKABLE_DATA_STORE_KINDS: ReadonlyArray<DataStoreKind> = [
  DataStoreKind.AwsS3Bucket,
  DataStoreKind.AzureStorageAccount,
  DataStoreKind.GcpStorageBucket,
];

// The stores whose snapshots' sharing can be revoked.
export const SHAREABLE_DATA_STORE_KINDS: ReadonlyArray<DataStoreKind> = [
  DataStoreKind.AwsRdsSnapshot,
  DataStoreKind.AwsRdsInstance,
  DataStoreKind.AwsRdsCluster,
  DataStoreKind.AwsDocumentDbCluster,
];

// The kinds whose snapshots are cluster snapshots (DescribeDBClusterSnapshots).
export const CLUSTER_SNAPSHOT_DATA_STORE_KINDS: ReadonlyArray<DataStoreKind> = [
  DataStoreKind.AwsRdsCluster,
  DataStoreKind.AwsDocumentDbCluster,
];

// The kinds of store each action can change.
export const DATA_SECURITY_RESPONSE_ACTION_KINDS: Readonly<
  Record<DataSecurityResponseAction, ReadonlyArray<DataStoreKind>>
> = {
  [DataSecurityResponseAction.BlockPublicAccess]: BLOCKABLE_DATA_STORE_KINDS,
  [DataSecurityResponseAction.RevokeSharing]: SHAREABLE_DATA_STORE_KINDS,
  [DataSecurityResponseAction.TurnOnVersioning]: [
    DataStoreKind.AwsS3Bucket,
    DataStoreKind.GcpStorageBucket,
  ],
  [DataSecurityResponseAction.TurnOnSoftDelete]: [
    DataStoreKind.AzureStorageAccount,
  ],
  [DataSecurityResponseAction.TurnOffObjectAcls]: [DataStoreKind.AwsS3Bucket],
  [DataSecurityResponseAction.TurnOnUniformAccess]: [
    DataStoreKind.GcpStorageBucket,
  ],
  [DataSecurityResponseAction.RequireSecureTransfer]: [
    DataStoreKind.AzureStorageAccount,
  ],
  [DataSecurityResponseAction.TurnOnPointInTimeRecovery]: [
    DataStoreKind.AwsDynamoDbTable,
  ],
};

/*
 * The checks each action fixes: an issue of one of these, on a store the
 * action can change, offers the action on its page.
 */
export const DATA_SECURITY_RESPONSE_ACTION_CHECKS: Readonly<
  Record<DataSecurityResponseAction, ReadonlyArray<string>>
> = {
  [DataSecurityResponseAction.BlockPublicAccess]: [
    "public-read",
    "public-write",
    "public-access-not-blocked",
  ],
  [DataSecurityResponseAction.RevokeSharing]: [
    "snapshot-public",
    "snapshot-shared-externally",
  ],
  [DataSecurityResponseAction.TurnOnVersioning]: [
    "deleted-data-not-recoverable",
  ],
  [DataSecurityResponseAction.TurnOnSoftDelete]: [
    "deleted-data-not-recoverable",
  ],
  [DataSecurityResponseAction.TurnOffObjectAcls]: ["object-acls-enabled"],
  [DataSecurityResponseAction.TurnOnUniformAccess]: ["object-acls-enabled"],
  [DataSecurityResponseAction.RequireSecureTransfer]: [
    "encryption-in-transit-not-enforced",
    "weak-tls",
  ],
  [DataSecurityResponseAction.TurnOnPointInTimeRecovery]: [
    "no-point-in-time-recovery",
  ],
};

/*
 * The actions that close an exposure - the internet, or accounts outside -
 * rather than harden a store: a store marked public by design is never
 * blocked, and a Security Operations playbook runs these as steps.
 */
export const EXPOSURE_RESPONSE_ACTIONS: ReadonlyArray<DataSecurityResponseAction> =
  [
    DataSecurityResponseAction.BlockPublicAccess,
    DataSecurityResponseAction.RevokeSharing,
  ];

export function isDataSecurityResponseAction(
  value: unknown,
): value is DataSecurityResponseAction {
  return (
    ALL_DATA_SECURITY_RESPONSE_ACTIONS as ReadonlyArray<unknown>
  ).includes(value);
}

// The response actions a store of this kind can take.
export function getDataSecurityResponseActions(
  kind: DataStoreKind | string | undefined,
): Array<DataSecurityResponseAction> {
  return ALL_DATA_SECURITY_RESPONSE_ACTIONS.filter(
    (action: DataSecurityResponseAction): boolean => {
      return DATA_SECURITY_RESPONSE_ACTION_KINDS[action].includes(
        kind as DataStoreKind,
      );
    },
  );
}

// The action that fixes an issue of this check on a store of this kind, if any.
export function getDataSecurityResponseActionForIssue(
  checkId: string | undefined,
  kind: DataStoreKind | string | undefined,
): DataSecurityResponseAction | undefined {
  if (!checkId) {
    return undefined;
  }

  return getDataSecurityResponseActions(kind).find(
    (action: DataSecurityResponseAction): boolean => {
      return DATA_SECURITY_RESPONSE_ACTION_CHECKS[action].includes(checkId);
    },
  );
}

/*
 * What the action changes on a store of this kind, in a sentence a person
 * reads before they confirm it - and what stops working as a result.
 */
export function describeDataSecurityResponseAction(
  action: DataSecurityResponseAction,
  kind: DataStoreKind | string | undefined,
): string {
  if (action === DataSecurityResponseAction.BlockPublicAccess) {
    switch (kind) {
      case DataStoreKind.AzureStorageAccount:
        return "Turns off anonymous blob access on the storage account, so no container is readable by anyone on the internet. Anything that reads it without a key stops working. No blob is changed.";
      case DataStoreKind.GcpStorageBucket:
        return "Enforces public access prevention on the bucket, so nobody on the internet can read it. Anything that reads it publicly stops working. No object is changed.";
      default:
        return "Turns on the bucket's four Block Public Access settings, so nobody on the internet can read it. Anything that reads it publicly - a website, a download link - stops working. No object is changed.";
    }
  }

  if (action === DataSecurityResponseAction.TurnOnVersioning) {
    return kind === DataStoreKind.GcpStorageBucket
      ? "Turns on Object Versioning for the bucket, so an object that is overwritten or deleted can be restored from its earlier version. Earlier versions are kept, and billed, until a lifecycle rule removes them. No object is changed."
      : "Turns on versioning for the bucket, so an object that is overwritten or deleted can be restored from its earlier version. Earlier versions are kept, and billed, until a lifecycle rule removes them. No object is changed.";
  }

  if (action === DataSecurityResponseAction.TurnOnSoftDelete) {
    return "Turns on soft delete for the storage account's blobs and containers, for 14 days: a deleted blob or container can be restored in that time. Deleted data is kept, and billed, for those 14 days. No blob is changed.";
  }

  if (action === DataSecurityResponseAction.TurnOffObjectAcls) {
    return "Sets the bucket's Object Ownership to Bucket owner enforced: object ACLs no longer grant access, and the bucket's policy alone decides who reads it. Anything that is given access through an ACL - another account, a public link - stops working. No object is changed.";
  }

  if (action === DataSecurityResponseAction.TurnOnUniformAccess) {
    return "Turns on uniform bucket-level access: object ACLs no longer grant access, and the bucket's IAM policy alone decides who reads it. Anything that is given access through an ACL stops working, and after 90 days it cannot be turned off again. No object is changed.";
  }

  if (action === DataSecurityResponseAction.RequireSecureTransfer) {
    return "Turns on Secure transfer required, and sets the minimum TLS version to 1.2, on the storage account: it then takes HTTPS only, with TLS 1.2 or later. Anything that connects over HTTP, or with older TLS, stops working. No blob is changed.";
  }

  if (action === DataSecurityResponseAction.TurnOnPointInTimeRecovery) {
    return "Turns on point-in-time recovery for the table, so it can be restored to any second of the last 35 days. AWS bills it by the table's size. No item is changed.";
  }

  if (kind === DataStoreKind.AwsRdsSnapshot) {
    return "Stops sharing the snapshot with everyone, and with any account outside the ones this project has connected. The snapshot itself is not changed.";
  }

  return "Stops sharing every manual snapshot of it with everyone, and with any account outside the ones this project has connected. No snapshot or database is changed.";
}
