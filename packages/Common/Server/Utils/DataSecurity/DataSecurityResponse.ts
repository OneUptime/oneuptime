import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import { DataStoreFeedEventType } from "../../../Models/DatabaseModels/DataStoreFeed";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import CloudConnectionService from "../../Services/CloudConnectionService";
import DataSecurityIssueFeedService from "../../Services/DataSecurityIssueFeedService";
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
import {
  DataSecurityResponseActionAvailability,
  DataSecurityResponseAvailability,
  DataSecurityResponseUnavailableReason,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import {
  CLUSTER_SNAPSHOT_DATA_STORE_KINDS,
  DataSecurityResponseAction,
  getDataSecurityResponseActions,
  isDataSecurityResponseAction,
} from "../../../Types/DataSecurity/DataSecurityResponseAction";
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
 * write role). The store's feed records what was done - and the issue's
 * timeline, when a person ran it from an issue - and the connection is read
 * again at once, so the store's exposure and its issues follow.
 *
 * A store marked public by design (its Settings) is never blocked: a public
 * website's bucket is meant to be read by anyone, and the person who marked
 * it so is the one to say otherwise.
 *
 * Which action a store can take, and which checks it fixes, is data in
 * Types/DataSecurity/DataSecurityResponseAction, which the Dashboard and
 * the playbook steps read too.
 */

export {
  DataSecurityResponseAction,
  getDataSecurityResponseActions,
  isDataSecurityResponseAction,
};

// Why a store cannot take the action: the store, then its connection.
const PUBLIC_BY_DESIGN_MESSAGE: string =
  "This store is marked public by design, so its public access is left as it is. Turn that off in the store's Settings first if it should not be public.";

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
    // The issue a person ran it from, whose timeline says what was done.
    dataSecurityIssueId?: ObjectID | undefined;
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

    if (data.dataSecurityIssueId) {
      await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
        projectId: data.projectId,
        dataSecurityIssueId: data.dataSecurityIssueId,
        eventType: DataSecurityIssueFeedEventType.ResponseActionTaken,
        displayColor: Blue500,
        feedInfoInMarkdown: (outcome.changed
          ? mdText`**${data.action}** on the store, through its cloud connection: ${outcome.summary} The store is being checked again.`
          : mdText`**${data.action}** on the store changed nothing: ${outcome.summary}`
        ).toString(),
        userId: data.userId,
      });
    }

    if (outcome.changed && target.connection.id) {
      await queueDataSecurityConnectionRead({
        projectId: data.projectId,
        cloudConnectionId: target.connection.id,
      });
    }

    return outcome;
  }

  /*
   * Which actions a store can take now, and why not when it cannot: what
   * its page shows before anybody presses anything. Reads the store's
   * connection as OneUptime - the person asking may not read connections -
   * and answers only whether the response is on, never the connection.
   */
  public static async getAvailability(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<DataSecurityResponseAvailability> {
    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: data.dataStoreId, projectId: data.projectId },
      select: {
        _id: true,
        kind: true,
        cloudConnectionId: true,
        isPublicByDesign: true,
      },
      props: { isRoot: true },
    });

    if (!store?.id) {
      throw new BadDataException("Data store not found.");
    }

    const actions: Array<DataSecurityResponseAction> =
      getDataSecurityResponseActions(store.kind);

    if (actions.length === 0) {
      return { actions: [] };
    }

    const connection: CloudConnection | null = store.cloudConnectionId
      ? await CloudConnectionService.findOneBy({
          query: { _id: store.cloudConnectionId, projectId: data.projectId },
          select: { _id: true, config: true, isEnabled: true },
          props: { isRoot: true },
        })
      : null;

    const connectionReason: DataSecurityResponseUnavailableReason | undefined =
      !store.cloudConnectionId
        ? DataSecurityResponseUnavailableReason.NotThroughACloud
        : !connection?.id || connection.isEnabled === false
          ? DataSecurityResponseUnavailableReason.ConnectionGone
          : !isCloudConnectionDataSecurityResponseOn(
                connection.config
                  ? connection.config[DATA_SECURITY_RESPONSE_FIELD_KEY]
                  : undefined,
              )
            ? DataSecurityResponseUnavailableReason.ResponseOff
            : undefined;

    return {
      actions: actions.map(
        (
          action: DataSecurityResponseAction,
        ): DataSecurityResponseActionAvailability => {
          const reason: DataSecurityResponseUnavailableReason | undefined =
            action === DataSecurityResponseAction.BlockPublicAccess &&
            store.isPublicByDesign
              ? DataSecurityResponseUnavailableReason.PublicByDesign
              : connectionReason;

          return reason
            ? { action, isAvailable: false, unavailableReason: reason }
            : { action, isAvailable: true };
        },
      ),
      ...(connectionReason ===
        DataSecurityResponseUnavailableReason.ResponseOff && connection?.id
        ? { cloudConnectionId: connection.id.toString() }
        : {}),
    };
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
        isPublicByDesign: true,
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

    if (
      action === DataSecurityResponseAction.BlockPublicAccess &&
      store.isPublicByDesign
    ) {
      throw new BadDataException(PUBLIC_BY_DESIGN_MESSAGE);
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
                isCluster: CLUSTER_SNAPSHOT_DATA_STORE_KINDS.includes(
                  store.kind as DataStoreKind,
                ),
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
