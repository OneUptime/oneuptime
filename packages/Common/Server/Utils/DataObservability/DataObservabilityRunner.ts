import DataStore from "../../../Models/DatabaseModels/DataStore";
import OneUptimeDate from "../../../Types/Date";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import DataStoreService from "../../Services/DataStoreService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import {
  getDatabaseEngineOfKind,
  PROBE_SCANNABLE_KINDS,
} from "../DataSecurity/DataSecurityProbeScan";
import { TABLE_HEALTH_CLAIM_IN_MINUTES } from "./DataObservabilityProbeCollect";
import DataCheckIngest from "./DataCheckIngest";
import DataCheckPlanner, { DataCheckPlan } from "./DataCheckPlanner";
import {
  collectTableHealth,
  DEFAULT_COLLECT_OPTIONS,
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
        kind: new Includes([...PROBE_SCANNABLE_KINDS]),
        connectionString: QueryHelper.notNull(),
        scanProbeId: QueryHelper.isNull(),
        nextTableHealthCollectionAt: QueryHelper.lessThanEqualToOrNull(now),
      },
      select: { _id: true, projectId: true },
      skip: 0,
      limit,
      props: { isRoot: true },
    });

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

    const engine: ReturnType<typeof getDatabaseEngineOfKind> =
      getDatabaseEngineOfKind(store.kind);

    if (!engine) {
      return null;
    }

    if (!store.connectionString) {
      await TableHealthIngest.recordFailure({
        storeId: store.id,
        error:
          "No connection string is saved on this store. Save one, or have a probe collect it with an environment variable.",
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
        { engine, connectionString: store.connectionString },
        {
          ...DEFAULT_COLLECT_OPTIONS,
          checks: plan.planned,
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
}
