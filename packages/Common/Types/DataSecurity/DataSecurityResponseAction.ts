import { DataStoreKind } from "./DataStoreKind";

/*
 * CLOSING A STORE'S EXPOSURE, AS DATA.
 *
 * What Data Security can do to a cloud store that is exposed, through the
 * store's cloud connection - and only when that connection's "Data
 * security response" setting is on, whose setup command grants the one
 * narrow write role (CloudConnectionSetupCommands):
 *
 *   Block public access  an S3 bucket's four Block Public Access settings
 *                        on, an Azure storage account's anonymous blob
 *                        access off, a Cloud Storage bucket's public access
 *                        prevention enforced;
 *   Revoke sharing       an RDS snapshot - or every manual snapshot of an
 *                        RDS database, Aurora or DocumentDB cluster - no
 *                        longer restorable by everyone, or by accounts
 *                        outside the ones the project connected.
 *
 * Each changes the store's configuration, never its data. A person runs it
 * from the issue it fixes (Server/API/DataSecurityAPI), or a Security
 * Operations playbook does, as an approved step. The server, the Dashboard
 * and the playbook steps read the same lists here.
 */

export enum DataSecurityResponseAction {
  BlockPublicAccess = "Block public access",
  RevokeSharing = "Revoke sharing",
}

export const ALL_DATA_SECURITY_RESPONSE_ACTIONS: ReadonlyArray<DataSecurityResponseAction> =
  [
    DataSecurityResponseAction.BlockPublicAccess,
    DataSecurityResponseAction.RevokeSharing,
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
export const CLUSTER_SNAPSHOT_DATA_STORE_KINDS: ReadonlyArray<DataStoreKind> =
  [DataStoreKind.AwsRdsCluster, DataStoreKind.AwsDocumentDbCluster];

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
};

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
  const actions: Array<DataSecurityResponseAction> = [];

  if (BLOCKABLE_DATA_STORE_KINDS.includes(kind as DataStoreKind)) {
    actions.push(DataSecurityResponseAction.BlockPublicAccess);
  }

  if (SHAREABLE_DATA_STORE_KINDS.includes(kind as DataStoreKind)) {
    actions.push(DataSecurityResponseAction.RevokeSharing);
  }

  return actions;
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

  if (kind === DataStoreKind.AwsRdsSnapshot) {
    return "Stops sharing the snapshot with everyone, and with any account outside the ones this project has connected. The snapshot itself is not changed.";
  }

  return "Stops sharing every manual snapshot of it with everyone, and with any account outside the ones this project has connected. No snapshot or database is changed.";
}
