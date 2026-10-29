import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import { DataStoreFeedEventType } from "../../../Models/DatabaseModels/DataStoreFeed";
import CloudConnectionService from "../../Services/CloudConnectionService";
import DataStoreFeedService from "../../Services/DataStoreFeedService";
import DataStoreService from "../../Services/DataStoreService";
import { CloudConnectionSettings } from "../CloudConnection/CloudConnectorTypes";
import {
  blockS3BucketPublicAccess,
  revokeRdsSnapshotSharing,
} from "./Cloud/Aws/AwsDataSecurityResponse";
import { blockAzureStoragePublicAccess } from "./Cloud/Azure/AzureDataSecurityResponse";
import { blockGcsBucketPublicAccess } from "./Cloud/Gcp/GcpDataSecurityResponse";
import { DataSecurityResponseOutcome } from "./Cloud/DataSecurityCloudTypes";
import { queueDataSecurityConnectionRead } from "./DataSecurityJobs";
import DataSecurityRunner from "./DataSecurityRunner";
import { Blue500 } from "../../../Types/BrandColors";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  DATA_SECURITY_RESPONSE_FIELD_KEY,
  isCloudConnectionDataSecurityResponseOn,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { DataStorePostureFacts } from "../../../Types/DataSecurity/DataStorePosture";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";

/*
 * CLOSING A STORE'S EXPOSURE: DATA SECURITY'S RESPONSE ACTIONS.
 *
 * What a Security Operations playbook - or a person, from an issue - can
 * do to a cloud store that is exposed:
 *
 *  - Block public access: an S3 bucket's four Block Public Access
 *    settings on, an Azure storage account's anonymous blob access off, a
 *    Cloud Storage bucket's public access prevention enforced.
 *  - Revoke sharing: an RDS snapshot - or every manual snapshot of an RDS
 *    database or cluster that is shared - no longer restorable by everyone,
 *    or by accounts outside the ones the project has connected.
 *
 * Each changes the store's configuration only, never its data; reads first
 * and changes only what is not already so, so a second run changes
 * nothing; and runs only when the store's cloud connection has its "Data
 * security response" setting on (whose setup command grants the narrow
 * write role). The store's feed records what was done, and the connection
 * is read again at once, so the store's exposure and its issues follow.
 */

export enum DataSecurityResponseAction {
  BlockPublicAccess = "Block public access",
  RevokeSharing = "Revoke sharing",
}

const BLOCKABLE_KINDS: ReadonlyArray<DataStoreKind> = [
  DataStoreKind.AwsS3Bucket,
  DataStoreKind.AzureStorageAccount,
  DataStoreKind.GcpStorageBucket,
];

const SHAREABLE_KINDS: ReadonlyArray<DataStoreKind> = [
  DataStoreKind.AwsRdsSnapshot,
  DataStoreKind.AwsRdsInstance,
  DataStoreKind.AwsRdsCluster,
  DataStoreKind.AwsDocumentDbCluster,
];

// The kinds whose snapshots are cluster snapshots (DescribeDBClusterSnapshots).
const CLUSTER_KINDS: ReadonlyArray<DataStoreKind> = [
  DataStoreKind.AwsRdsCluster,
  DataStoreKind.AwsDocumentDbCluster,
];

// The response actions a store of this kind can take.
export function getDataSecurityResponseActions(
  kind: DataStoreKind | string | undefined,
): Array<DataSecurityResponseAction> {
  const actions: Array<DataSecurityResponseAction> = [];

  if (BLOCKABLE_KINDS.includes(kind as DataStoreKind)) {
    actions.push(DataSecurityResponseAction.BlockPublicAccess);
  }

  if (SHAREABLE_KINDS.includes(kind as DataStoreKind)) {
    actions.push(DataSecurityResponseAction.RevokeSharing);
  }

  return actions;
}

export function isDataSecurityResponseAction(
  value: unknown,
): value is DataSecurityResponseAction {
  return (Object.values(DataSecurityResponseAction) as Array<unknown>).includes(
    value,
  );
}

interface ResponseTarget {
  store: DataStore;
  connection: CloudConnection;
  settings: CloudConnectionSettings;
}

export default class DataSecurityResponse {
  public static async run(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    action: DataSecurityResponseAction;
    // Who asked, for the store's feed: a person, or a playbook run (none).
    userId?: ObjectID | undefined;
  }): Promise<DataSecurityResponseOutcome> {
    const target: ResponseTarget = await this.readTarget(
      data.projectId,
      data.dataStoreId,
      data.action,
    );
    const outcome: DataSecurityResponseOutcome =
      data.action === DataSecurityResponseAction.BlockPublicAccess
        ? await this.blockPublicAccess(target)
        : await this.revokeSharing(data.projectId, target);

    await DataStoreFeedService.createDataStoreFeedItem({
      projectId: data.projectId,
      dataStoreId: data.dataStoreId,
      dataStoreFeedEventType: DataStoreFeedEventType.ResponseActionTaken,
      displayColor: Blue500,
      feedInfoInMarkdown: mdText`**${data.action}**: ${outcome.summary}`.toString(),
      userId: data.userId,
    });

    if (outcome.changed && target.connection.id) {
      await queueDataSecurityConnectionRead({
        projectId: data.projectId,
        cloudConnectionId: target.connection.id,
      });
    }

    return outcome;
  }

  // The store, its connection and that connection's settings, or why not.
  private static async readTarget(
    projectId: ObjectID,
    dataStoreId: ObjectID,
    action: DataSecurityResponseAction,
  ): Promise<ResponseTarget> {
    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: dataStoreId, projectId },
      select: {
        _id: true,
        name: true,
        kind: true,
        region: true,
        cloudAccountNumber: true,
        cloudConnectionId: true,
        providerResourceId: true,
        posture: true,
      },
      props: { isRoot: true },
    });

    if (!store?.id) {
      throw new BadDataException("Data store not found.");
    }

    if (!getDataSecurityResponseActions(store.kind).includes(action)) {
      throw new BadDataException(
        `${action} is not something Data Security can do to a ${store.kind || "store of this kind"}.`,
      );
    }

    if (!store.cloudConnectionId) {
      throw new BadDataException(
        "This store was not found through a cloud connection, so Data Security cannot change it.",
      );
    }

    const connection: CloudConnection | null =
      await CloudConnectionService.findOneBy({
        query: { _id: store.cloudConnectionId, projectId },
        select: {
          _id: true,
          projectId: true,
          provider: true,
          config: true,
          secrets: true,
          isEnabled: true,
        },
        props: { isRoot: true },
      });

    if (!connection?.id || connection.isEnabled === false) {
      throw new BadDataException(
        "The store's cloud connection is gone or turned off.",
      );
    }

    if (
      !isCloudConnectionDataSecurityResponseOn(
        connection.config
          ? connection.config[DATA_SECURITY_RESPONSE_FIELD_KEY]
          : undefined,
      )
    ) {
      throw new BadDataException(
        'Turn on "Data security response" on the store\'s cloud connection and run its updated setup command: it grants the narrow write role this needs.',
      );
    }

    return {
      store,
      connection,
      settings: await CloudConnectionService.getConnectorSettings(connection),
    };
  }

  private static async blockPublicAccess(
    target: ResponseTarget,
  ): Promise<DataSecurityResponseOutcome> {
    const { store, connection, settings } = target;

    if (store.kind === DataStoreKind.AwsS3Bucket) {
      return blockS3BucketPublicAccess(settings, {
        connectionId: connection.id!,
        bucket: store.name || "",
        region: store.region || "us-east-1",
        accountNumber: store.cloudAccountNumber || "",
      });
    }

    if (store.kind === DataStoreKind.AzureStorageAccount) {
      return blockAzureStoragePublicAccess(settings, {
        connectionId: connection.id!.toString(),
        resourceId: store.providerResourceId || "",
      });
    }

    return blockGcsBucketPublicAccess(settings, {
      connectionId: connection.id!.toString(),
      bucket: store.name || "",
    });
  }

  private static async revokeSharing(
    projectId: ObjectID,
    target: ResponseTarget,
  ): Promise<DataSecurityResponseOutcome> {
    const { store, connection, settings } = target;
    const connectedAccountIds: Array<string> =
      await DataSecurityRunner.connectedAccounts(projectId, CloudProvider.AWS);
    const posture: DataStorePostureFacts =
      (store.posture as DataStorePostureFacts | undefined) || {};
    const snapshots: Array<{ id: string; isCluster: boolean }> =
      store.kind === DataStoreKind.AwsRdsSnapshot
        ? [
            {
              id: store.name || "",
              isCluster: (store.providerResourceId || "").includes(
                ":cluster-snapshot:",
              ),
            },
          ]
        : (posture.sharedSnapshotIds || []).map(
            (id: string): { id: string; isCluster: boolean } => {
              return {
                id,
                isCluster: CLUSTER_KINDS.includes(store.kind as DataStoreKind),
              };
            },
          );

    if (snapshots.length === 0) {
      return {
        changed: false,
        summary: `No manual snapshot of ${store.name || "this store"} was shared when its configuration was last read; nothing changed.`,
      };
    }

    const summaries: Array<string> = [];
    let changed: boolean = false;

    for (const snapshot of snapshots) {
      const outcome: DataSecurityResponseOutcome =
        await revokeRdsSnapshotSharing(settings, {
          connectionId: connection.id!,
          region: store.region || "us-east-1",
          snapshotIdentifier: snapshot.id,
          isClusterSnapshot: snapshot.isCluster,
          connectedAccountIds,
          accountNumber: store.cloudAccountNumber || undefined,
        });

      changed = changed || outcome.changed;
      summaries.push(outcome.summary);
    }

    return { changed, summary: summaries.join(" ") };
  }
}
