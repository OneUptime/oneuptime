import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import CloudConnectionService from "../../Services/CloudConnectionService";
import {
  CloudConnectionSettings,
  readCloudSetting,
} from "../CloudConnection/CloudConnectorTypes";
import { buildBigQueryConnectionString } from "./BigQueryApi";
import OneUptimeDate from "../../../Types/Date";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import DataStoreService from "../../Services/DataStoreService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import {
  DATA_OBSERVABILITY_KINDS,
  getCollectorEngineOfKind,
} from "./DataObservabilityEngines";
import { TABLE_HEALTH_CLAIM_IN_MINUTES } from "./DataObservabilityProbeCollect";
import DataCheckIngest from "./DataCheckIngest";
import DataCheckPlanner, { DataCheckPlan } from "./DataCheckPlanner";
import {
  collectTableHealth,
  DEFAULT_COLLECT_OPTIONS,
  getQueryHistoryLookbackInSeconds,
  TableHealthSnapshot,
} from "./TableHealthCollector";
import TableHealthIngest, {
  IngestStore,
  TableHealthIngestResult,
} from "./TableHealthIngest";

/*
 * TABLE HEALTH COLLECTED BY ONEUPTIME'S OWN WORKERS.
 *
 * A self-managed database with a connection string saved on its store is
 * collected here; one scanned by a probe is collected by that probe
 * (DataObservabilityProbeCollect) and never here, so its connection string
 * never has to leave the customer's network. Every five minutes the
 * schedule claims the stores that are due and queues a job for each
 * (Jobs/DataObservability); the job collects the store and records what
 * it found (TableHealthIngest).
 */
export default class DataObservabilityRunner {
  // The stores due for a collection on a worker, each held so the next schedule skips it.
  public static async claimDueStores(
    limit: number,
  ): Promise<Array<{ projectId: ObjectID; dataStoreId: ObjectID }>> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        isArchived: false,
        isTableHealthEnabled: true,
        kind: new Includes([...DATA_OBSERVABILITY_KINDS]),
        connectionString: QueryHelper.notNull(),
        scanProbeId: QueryHelper.isNull(),
        nextTableHealthCollectionAt: QueryHelper.lessThanEqualToOrNull(now),
      },
      select: { _id: true, projectId: true },
      skip: 0,
      limit,
      props: { isRoot: true },
    });

    // BigQuery datasets a Google Cloud connection found: collected with its service account.
    if (stores.length < limit) {
      stores.push(
        ...(await DataStoreService.findBy({
          query: {
            isArchived: false,
            isTableHealthEnabled: true,
            kind: DataStoreKind.GcpBigQueryDataset,
            connectionString: QueryHelper.isNull(),
            cloudConnectionId: QueryHelper.notNull(),
            nextTableHealthCollectionAt: QueryHelper.lessThanEqualToOrNull(now),
          },
          select: { _id: true, projectId: true },
          skip: 0,
          limit: limit - stores.length,
          props: { isRoot: true },
        })),
      );
    }

    const claimed: Array<{ projectId: ObjectID; dataStoreId: ObjectID }> = [];

    for (const store of stores) {
      if (!store.id || !store.projectId) {
        continue;
      }

      // Held until the collection sets its real next time.
      await DataStoreService.updateColumnsByIdWithoutHooks({
        id: store.id,
        data: {
          nextTableHealthCollectionAt: OneUptimeDate.addRemoveMinutes(
            now,
            TABLE_HEALTH_CLAIM_IN_MINUTES,
          ),
        } as never,
      });

      claimed.push({ projectId: store.projectId, dataStoreId: store.id });
    }

    return claimed;
  }

  public static async collectStore(
    projectId: ObjectID,
    dataStoreId: ObjectID,
  ): Promise<TableHealthIngestResult | null> {
    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: dataStoreId, projectId },
      select: {
        _id: true,
        name: true,
        kind: true,
        connectionString: true,
        scanExclusions: true,
        scanProbeId: true,
        isTableHealthEnabled: true,
        isArchived: true,
        cloudConnectionId: true,
        cloudAccountNumber: true,
        region: true,
        tableHealthCollectedAt: true,
      },
      props: { isRoot: true },
    });

    if (
      !store?.id ||
      store.isArchived ||
      store.isTableHealthEnabled === false
    ) {
      return null;
    }

    // A probe's store is collected by its probe.
    if (store.scanProbeId) {
      return null;
    }

    const engine: ReturnType<typeof getCollectorEngineOfKind> =
      getCollectorEngineOfKind(store.kind);

    if (!engine) {
      return null;
    }

    const connectionString: string | null =
      store.connectionString ||
      (engine === "bigquery"
        ? await this.readCloudBigQueryConnection(projectId, store)
        : null);

    if (!connectionString) {
      await TableHealthIngest.recordFailure({
        storeId: store.id,
        error:
          engine === "bigquery"
            ? "This dataset's Google Cloud connection is off, gone, or holds no service account key. Turn it on, or save a connection on the store."
            : "No connection string is saved on this store. Save one, or have a probe collect it with an environment variable.",
      });
      return null;
    }

    let snapshot: TableHealthSnapshot;

    // The store's checks that are due run in the same session.
    const plan: DataCheckPlan = await DataCheckPlanner.planDueChecks({
      dataStoreId: store.id,
      engine,
      now: OneUptimeDate.getCurrentDate(),
    });

    try {
      snapshot = await collectTableHealth(
        { engine, connectionString },
        {
          ...DEFAULT_COLLECT_OPTIONS,
          checks: plan.planned,
          queryHistoryLookbackInSeconds: getQueryHistoryLookbackInSeconds(
            store.tableHealthCollectedAt,
            OneUptimeDate.getCurrentDate(),
          ),
          exclusions: (store.scanExclusions || []).filter(
            (exclusion: unknown): exclusion is string => {
              return typeof exclusion === "string";
            },
          ),
        },
      );
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      logger.debug(
        `Data Observability: collecting store ${store.id.toString()} failed: ${message}`,
      );
      await TableHealthIngest.recordFailure({
        storeId: store.id,
        error: message,
      });
      return null;
    }

    const ingestStore: IngestStore = {
      id: store.id,
      projectId,
      name: store.name || "",
      kind: store.kind || "",
    };
    const result: TableHealthIngestResult =
      await TableHealthIngest.recordSnapshot({
        store: ingestStore,
        snapshot,
      });

    await DataCheckIngest.recordResults({
      store: ingestStore,
      results: [...plan.refused, ...(snapshot.checkResults || [])],
      collectedAt: OneUptimeDate.fromString(snapshot.collectedAt),
    });

    return result;
  }

  /*
   * A dataset a Google Cloud connection found, as BigQueryApi connects to
   * it: its project, its name, its location, and the connection's own
   * service account - read here for this collection and kept nowhere.
   */
  private static async readCloudBigQueryConnection(
    projectId: ObjectID,
    store: DataStore,
  ): Promise<string | null> {
    if (!store.cloudConnectionId || !store.cloudAccountNumber || !store.name) {
      return null;
    }

    const connection: CloudConnection | null =
      await CloudConnectionService.findOneBy({
        query: { _id: store.cloudConnectionId, projectId },
        select: {
          _id: true,
          projectId: true,
          provider: true,
          isEnabled: true,
          config: true,
          secrets: true,
        },
        props: { isRoot: true },
      });

    if (!connection || connection.isEnabled === false) {
      return null;
    }

    const settings: CloudConnectionSettings =
      await CloudConnectionService.getConnectorSettings(connection);
    const serviceAccountJson: string = readCloudSetting(
      settings.secrets,
      "serviceAccountJson",
    );

    if (!serviceAccountJson) {
      return null;
    }

    return buildBigQueryConnectionString({
      projectId: store.cloudAccountNumber,
      dataset: store.name,
      location: store.region || null,
      serviceAccountJson,
    });
  }
}
