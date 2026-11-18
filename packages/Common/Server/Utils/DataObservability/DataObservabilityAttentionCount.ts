import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import Includes from "../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../Types/Date";
import { DATA_CHECK_HEALTHS_NEEDING_ATTENTION } from "../../../Types/DataObservability/DataObservabilityAttention";
import { MAX_LATENESS_WATCH_IN_SECONDS } from "../../../Types/DataObservability/DataPipelineSchedule";
import { DataProductStatus } from "../../../Types/DataObservability/DataProductFreshness";
import { DataReconciliationStatus } from "../../../Types/DataObservability/DataReconciliation";
import { OBJECT_STORE_KINDS } from "../../../Types/DataObservability/StoragePaths";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import DataAssetService from "../../Services/DataAssetService";
import DataCheckService from "../../Services/DataCheckService";
import DataPipelineService from "../../Services/DataPipelineService";
import DataProductService from "../../Services/DataProductService";
import DataReconciliationService from "../../Services/DataReconciliationService";
import DataStoreService from "../../Services/DataStoreService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import { DATA_OBSERVABILITY_KINDS } from "./DataObservabilityEngines";
import {
  DataObservabilityScope,
  withConditions,
} from "./DataObservabilityReadScope";
import { isStoreConnected } from "./DataSourceSuggestions";
import { FAILED_RUN_STATES } from "./OpenLineageEvent";

/*
 * HOW MANY THINGS NEED SOMEONE, COUNTED - NEVER LISTED (#6552).
 *
 * The count beside Overview in the Data Observability menu, on every page of
 * it. It is the Overview's Needs Attention count, by the same rules
 * (DataObservabilityAttentionReader), asked of what each record keeps rather
 * than worked out row by row:
 *
 *   - a watched database whose last collection failed;
 *   - a table whose lateAt has passed (DataAsset.lateAt);
 *   - a pipeline whose last run failed in the last thirty days, or whose
 *     lateAt has passed since its last start in them (DataPipeline.lateAt);
 *   - a check failing, or that could not run (DataCheck.health);
 *   - a data product past its promise, and a reconciliation that drifted or
 *     could not compare (their status).
 *
 * Each is one COUNT on an indexed column, run side by side; only the failed
 * databases - a handful - are read, to say each is still connected. No
 * table, check or pipeline row is read, so asking costs the same on a
 * project of fifty thousand tables as on one of five. A caller who reads
 * the whole project shares the count for half a minute with everyone else
 * who does (a menu drawn on every page asks once); a caller whose grants
 * narrow their reads counts what they may read, and is not kept (#6553).
 *
 * A check is counted by the health kept on it, which counts only alerts
 * every reader may see: one whose only open alert is private is counted by
 * no one, where the Overview counts it for those who may see the alert.
 */

export const ATTENTION_COUNT_CACHE_TTL_MS: number = 30_000;

// The most failed databases read to count: far more than a project watches.
const MAX_FAILED_STORES_READ: number = 500;

// The kinds Data Observability reads a database of: its engines, and buckets once paths of them are watched.
const COUNTED_STORE_KINDS: ReadonlyArray<DataStoreKind> = [
  ...DATA_OBSERVABILITY_KINDS,
  ...OBJECT_STORE_KINDS,
];

export interface DataObservabilityAttentionCounts {
  failedStores: number;
  lateTables: number;
  failedPipelines: number;
  latePipelines: number;
  checks: number;
  lateDataProducts: number;
  reconciliations: number;
}

export function sumAttentionCounts(
  counts: DataObservabilityAttentionCounts,
): number {
  return (
    counts.failedStores +
    counts.lateTables +
    counts.failedPipelines +
    counts.latePipelines +
    counts.checks +
    counts.lateDataProducts +
    counts.reconciliations
  );
}

// A part that cannot be counted counts nothing, and says why in the log.
async function countOrNothing(
  what: string,
  count: () => Promise<number>,
): Promise<number> {
  try {
    return await count();
  } catch (error) {
    logger.error(`Data Observability: could not count ${what}: ${error}`);
    return 0;
  }
}

export default class DataObservabilityAttentionCount {
  // Counts kept for the callers who read the whole project, by project.
  private static kept: InMemoryTTLCache<number> = new InMemoryTTLCache<number>(
    5_000,
  );

  // Answers that are being worked out, by project: callers who ask together share one.
  private static inFlight: Map<string, Promise<number>> = new Map();

  // How many things need someone now, for this caller's scope.
  public static async count(data: {
    projectId: ObjectID;
    now: Date;
    scope: DataObservabilityScope;
  }): Promise<number> {
    if (!data.scope.isWholeProject) {
      return sumAttentionCounts(await this.countEach(data));
    }

    const key: string = data.projectId.toString();
    const kept: number | undefined = this.kept.get(key);

    if (kept !== undefined) {
      return kept;
    }

    let counting: Promise<number> | undefined = this.inFlight.get(key);

    if (!counting) {
      const thisCount: Promise<number> = this.countEach(data).then(
        (counts: DataObservabilityAttentionCounts): number => {
          return sumAttentionCounts(counts);
        },
      );
      counting = thisCount;
      this.inFlight.set(key, thisCount);

      thisCount
        .then((value: number) => {
          this.kept.set(key, value, ATTENTION_COUNT_CACHE_TTL_MS);
        })
        .catch(() => {
          // Never kept: the next caller counts again.
        })
        .finally(() => {
          if (this.inFlight.get(key) === thisCount) {
            this.inFlight.delete(key);
          }
        });
    }

    return await counting;
  }

  /*
   * Forgets what was kept, and what is being counted: for tests, and a
   * project whose records just changed under them. The next caller counts
   * again.
   */
  public static forget(projectId?: ObjectID | undefined): void {
    if (projectId) {
      this.kept.delete(projectId.toString());
      this.inFlight.delete(projectId.toString());
      return;
    }

    this.kept = new InMemoryTTLCache<number>(5_000);
    this.inFlight = new Map();
  }

  // Each kind of thing that needs someone, counted.
  public static async countEach(data: {
    projectId: ObjectID;
    now: Date;
    scope: DataObservabilityScope;
  }): Promise<DataObservabilityAttentionCounts> {
    const { projectId, now, scope } = data;
    // A pipeline not started in thirty days is retired: never late or failing again.
    const retiredBefore: Date = OneUptimeDate.addRemoveSeconds(
      now,
      -MAX_LATENESS_WATCH_IN_SECONDS,
    );

    const [
      failedStores,
      lateTables,
      failedPipelines,
      latePipelines,
      checks,
      lateDataProducts,
      reconciliations,
    ]: Array<number> = await Promise.all([
      countOrNothing("databases that could not be read", async () => {
        return await this.countFailedStores({ projectId, scope });
      }),
      countOrNothing("late tables", async () => {
        return (
          await DataAssetService.countBy({
            query: withConditions<DataAsset>(scope.assetQuery, {
              isDropped: false,
              lateAt: QueryHelper.lessThanEqualTo(now),
            }),
            props: { isRoot: true },
          })
        ).toNumber();
      }),
      countOrNothing("failed pipelines", async () => {
        return (
          await DataPipelineService.countBy({
            query: withConditions<DataPipeline>(scope.pipelineQuery, {
              lastRunState: new Includes([...FAILED_RUN_STATES]),
              lastRunStartedAt:
                QueryHelper.greaterThanEqualToOrNull(retiredBefore),
            }),
            props: { isRoot: true },
          })
        ).toNumber();
      }),
      countOrNothing("late pipelines", async () => {
        return (
          await DataPipelineService.countBy({
            query: withConditions<DataPipeline>(scope.pipelineQuery, {
              lateAt: QueryHelper.lessThanEqualTo(now),
              lastRunStartedAt: QueryHelper.greaterThanEqualTo(retiredBefore),
              lastRunState: QueryHelper.notIn([...FAILED_RUN_STATES]),
            }),
            props: { isRoot: true },
          })
        ).toNumber();
      }),
      countOrNothing("checks", async () => {
        return (
          await DataCheckService.countBy({
            // A reconciliation's two checks are told of as the reconciliation.
            query: withConditions<DataCheck>(scope.checkQuery, {
              dataReconciliationId: QueryHelper.isNull(),
              health: new Includes([...DATA_CHECK_HEALTHS_NEEDING_ATTENTION]),
            }),
            props: { isRoot: true },
          })
        ).toNumber();
      }),
      countOrNothing("late data products", async () => {
        return (
          await DataProductService.countBy({
            query: { projectId, status: DataProductStatus.Late },
            props: { isRoot: true },
          })
        ).toNumber();
      }),
      countOrNothing("reconciliations", async () => {
        return (
          await DataReconciliationService.countBy({
            query: {
              projectId,
              status: new Includes([
                DataReconciliationStatus.Drifted,
                DataReconciliationStatus.Failed,
              ]),
            },
            props: { isRoot: true },
          })
        ).toNumber();
      }),
    ]);

    return {
      failedStores: failedStores || 0,
      lateTables: lateTables || 0,
      failedPipelines: failedPipelines || 0,
      latePipelines: latePipelines || 0,
      checks: checks || 0,
      lateDataProducts: lateDataProducts || 0,
      reconciliations: reconciliations || 0,
    };
  }

  /*
   * The watched databases whose last collection failed, that are still
   * connected - and, for a narrowed caller, that hold a table they may read.
   * Only these few rows are read.
   */
  private static async countFailedStores(data: {
    projectId: ObjectID;
    scope: DataObservabilityScope;
  }): Promise<number> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId: data.projectId,
        isArchived: false,
        isTableHealthEnabled: true,
        tableHealthStatus: "Failed",
        kind: new Includes([...COUNTED_STORE_KINDS]),
      },
      select: {
        _id: true,
        kind: true,
        connectionString: true,
        scanProbeId: true,
        cloudConnectionId: true,
        watchedPaths: true,
      },
      skip: 0,
      limit: MAX_FAILED_STORES_READ,
      props: { isRoot: true },
    });
    const connected: Array<DataStore> = stores.filter(
      (store: DataStore): boolean => {
        return Boolean(store.id) && isStoreConnected(store);
      },
    );

    if (data.scope.isWholeProject || connected.length === 0) {
      return connected.length;
    }

    let visible: number = 0;

    for (const store of connected) {
      const readableTables: number = (
        await DataAssetService.countBy({
          query: withConditions<DataAsset>(data.scope.assetQuery, {
            dataStoreId: store.id!,
          }),
          props: { isRoot: true },
        })
      ).toNumber();

      if (readableTables > 0) {
        visible++;
      }
    }

    return visible;
  }
}
