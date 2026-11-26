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
  enforceS3BucketOwnership,
  revokeRdsSnapshotSharing,
  turnOnDynamoDbPointInTimeRecovery,
  turnOnS3BucketVersioning,
} from "./Cloud/Aws/AwsDataSecurityResponse";
import {
  blockAzureStoragePublicAccess,
  requireAzureSecureTransfer,
  turnOnAzureBlobSoftDelete,
} from "./Cloud/Azure/AzureDataSecurityResponse";
import {
  blockGcsBucketPublicAccess,
  turnOnGcsBucketVersioning,
  turnOnGcsUniformAccess,
} from "./Cloud/Gcp/GcpDataSecurityResponse";
import { DataSecurityResponseOutcome } from "./Cloud/DataSecurityCloudTypes";
import { getResponseActionStoreFeedMarkdown } from "./DataSecurityResponseFeed";
import { queueDataSecurityConnectionRead } from "./DataSecurityJobs";
import DataSecurityRunner from "./DataSecurityRunner";
import { Gray500, Green500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
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
  getDataSecurityResponseActionForIssue,
  getDataSecurityResponseActions,
  isDataSecurityResponseAction,
} from "../../../Types/DataSecurity/DataSecurityResponseAction";
import DataSecurityIssueResolution, {
  DataSecurityIssuePendingResolution,
} from "../../../Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { DataStorePostureFacts } from "../../../Types/DataSecurity/DataStorePosture";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import logger from "../Logger";

// The most issues a store has: one per check.
const MAX_ISSUES_OF_A_STORE: number = 100;

/*
 * FIXING A STORE FROM ITS ISSUE: DATA SECURITY'S RESPONSE ACTIONS.
 *
 * What a person, from an issue - or a Security Operations playbook, for the
 * first two - can do to a cloud store:
 *
 *  - Block public access: an S3 bucket's four Block Public Access
 *    settings on, an Azure storage account's anonymous blob access off, a
 *    Cloud Storage bucket's public access prevention enforced.
 *  - Revoke sharing: an RDS snapshot - or every manual snapshot of an RDS
 *    database or cluster that is shared - no longer restorable by everyone,
 *    or by accounts outside the ones the project has connected.
 *  - Turn on versioning (S3, Cloud Storage), Turn on soft delete (Azure
 *    storage), Turn off object ACLs (S3), Turn on uniform access (Cloud
 *    Storage), Require secure transfer (Azure storage), Turn on
 *    point-in-time recovery (DynamoDB): one setting that hardens the store.
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
    const outcome: DataSecurityResponseOutcome = await this.perform(
      data.projectId,
      data.action,
      target,
    );

    // Green when the store's configuration changed, grey when it was already so.
    const displayColor: Color = outcome.changed ? Green500 : Gray500;

    // The line a change OneUptime made in its own session is tied to (DataSecurityResponseFeed).
    await DataStoreFeedService.createDataStoreFeedItem({
      projectId: data.projectId,
      dataStoreId: data.dataStoreId,
      dataStoreFeedEventType: DataStoreFeedEventType.ResponseActionTaken,
      displayColor: displayColor,
      feedInfoInMarkdown: getResponseActionStoreFeedMarkdown({
        action: data.action,
        outcome,
      }).toString(),
      userId: data.userId,
    });

    if (data.dataSecurityIssueId) {
      await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
        projectId: data.projectId,
        dataSecurityIssueId: data.dataSecurityIssueId,
        eventType: DataSecurityIssueFeedEventType.ResponseActionTaken,
        displayColor: displayColor,
        feedInfoInMarkdown: (outcome.changed
          ? mdText`**${data.action}** on the store, through its cloud connection: ${outcome.summary} The store is being checked again.`
          : mdText`**${data.action}** on the store changed nothing: ${outcome.summary}`
        ).toString(),
        userId: data.userId,
      });
    }

    if (outcome.changed) {
      await this.markIssuesFixedFromHere({
        projectId: data.projectId,
        store: target.store,
        action: data.action,
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
   * The store's open issues this action fixes wait for their check to pass
   * as fixed from here (#10368): the read that follows resolves each, and
   * says it was this action, not a check that passed for no reason known.
   * Never throws: the change is made either way.
   */
  public static async markIssuesFixedFromHere(data: {
    projectId: ObjectID;
    store: DataStore;
    action: DataSecurityResponseAction;
    userId?: ObjectID | undefined;
    now?: Date | undefined;
  }): Promise<void> {
    try {
      const issues: Array<DataSecurityIssue> =
        await DataSecurityIssueService.findBy({
          query: {
            projectId: data.projectId,
            dataStoreId: data.store.id!,
            status: DataSecurityIssueStatus.Open,
          },
          select: { _id: true, checkId: true },
          skip: 0,
          limit: MAX_ISSUES_OF_A_STORE,
          props: { isRoot: true },
        });
      const pending: DataSecurityIssuePendingResolution = {
        resolution: DataSecurityIssueResolution.FixedFromHere,
        responseAction: data.action,
        at: (data.now || OneUptimeDate.getCurrentDate()).toISOString(),
        ...(data.userId ? { userId: data.userId.toString() } : {}),
      };

      for (const issue of issues) {
        if (
          !issue.id ||
          getDataSecurityResponseActionForIssue(
            issue.checkId,
            data.store.kind,
          ) !== data.action
        ) {
          continue;
        }

        await DataSecurityIssueService.updateColumnsByIdWithoutHooks({
          id: issue.id,
          data: {
            pendingResolution: pending as unknown as JSONObject,
          } as never,
        });
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not note on store ${data.store.id?.toString()}'s issues that ${data.action} fixed them from here: ${error}`,
      );
    }
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

  // The action itself, as the store's cloud takes it.
  private static async perform(
    projectId: ObjectID,
    action: DataSecurityResponseAction,
    target: ResponseTarget,
  ): Promise<DataSecurityResponseOutcome> {
    const { store, connection, settings } = target;
    const bucket: {
      connectionId: ObjectID;
      bucket: string;
      region: string;
      accountNumber: string;
    } = {
      connectionId: connection.id!,
      bucket: store.name || "",
      region: store.region || "us-east-1",
      accountNumber: store.cloudAccountNumber || "",
    };
    const azure: { connectionId: string; resourceId: string } = {
      connectionId: connection.id!.toString(),
      resourceId: store.providerResourceId || "",
    };
    const gcs: { connectionId: string; bucket: string } = {
      connectionId: connection.id!.toString(),
      bucket: store.name || "",
    };

    switch (action) {
      case DataSecurityResponseAction.BlockPublicAccess:
        return await this.blockPublicAccess(target);
      case DataSecurityResponseAction.RevokeSharing:
        return await this.revokeSharing(projectId, target);
      case DataSecurityResponseAction.TurnOnVersioning:
        return store.kind === DataStoreKind.GcpStorageBucket
          ? await turnOnGcsBucketVersioning(settings, gcs)
          : await turnOnS3BucketVersioning(settings, bucket);
      case DataSecurityResponseAction.TurnOnSoftDelete:
        return await turnOnAzureBlobSoftDelete(settings, azure);
      case DataSecurityResponseAction.TurnOffObjectAcls:
        return await enforceS3BucketOwnership(settings, bucket);
      case DataSecurityResponseAction.TurnOnUniformAccess:
        return await turnOnGcsUniformAccess(settings, gcs);
      case DataSecurityResponseAction.RequireSecureTransfer:
        return await requireAzureSecureTransfer(settings, azure);
      case DataSecurityResponseAction.TurnOnPointInTimeRecovery:
        return await turnOnDynamoDbPointInTimeRecovery(settings, {
          connectionId: connection.id!,
          table: store.name || "",
          region: store.region || "us-east-1",
          accountNumber: store.cloudAccountNumber || undefined,
        });
    }
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
