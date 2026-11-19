import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import {
  DataAssetFreshnessResult,
  getDataAssetFreshness,
} from "../../../Types/DataObservability/DataAssetFreshness";
import {
  DataCircuitBreakerAnswer,
  DataCircuitBreakerInput,
  DataCircuitBreakerPipeline,
  DataCircuitBreakerReason,
  DataCircuitBreakerRequest,
  DataCircuitBreakerVerdict,
  decideDataCircuitBreaker,
  formatDataCircuitBreakerAnswer,
  MAX_CIRCUIT_BREAKER_REASONS,
  readDataCircuitBreakerReasons,
} from "../../../Types/DataObservability/DataCircuitBreaker";
import {
  DataCheckHealth,
  DataCheckHealthAnswer,
} from "../../../Types/DataObservability/DataObservabilityAttention";
import { DataPipelineCircuitBreakerState } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { DataPipelineMetricName } from "../../../Types/DataObservability/DataPipelineMetric";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import ProductKey from "../../../Types/Product/ProductKey";
import ServerProducts from "../ServerProducts/ServerProducts";
import DataAssetService from "../../Services/DataAssetService";
import DataCheckService from "../../Services/DataCheckService";
import DataPipelineService from "../../Services/DataPipelineService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import MonitorMetricUtil from "../Monitor/MonitorMetricUtil";
import DataObservabilityAttentionReader from "./DataObservabilityAttentionReader";
import DataObservabilityReadScope, {
  DataObservabilityScope,
  withConditions,
} from "./DataObservabilityReadScope";
import DataTableLineageReader, {
  DataPipelineLineageReader,
  DataPipelineTables,
} from "./DataTableLineage";
import OpenLineageIngest, { buildPipelineMetricRow } from "./OpenLineageIngest";

/*
 * THE CIRCUIT BREAKER, ANSWERED (#6548).
 *
 * A pipeline step asks, with a project API key, before it runs: here is my
 * name (whose inputs lineage knows), or the tables I read - go, or stop?
 * The rule is DataCircuitBreaker's (Types): a failing check of a table it
 * reads stops it, and a late table too when its setting says so. This
 * reads what the rule needs, as its caller may read it:
 *
 *   - the pipeline, by its ID, its namespace/name or its name alone, among
 *     the pipelines the caller may read (DataObservabilityReadScope): a
 *     name two namespaces share is refused, with both, rather than guessed;
 *   - the tables it reads, from its lineage, through the reader every
 *     lineage view reads through - only the tables the caller may read -
 *     and the tables the request names, by ID, schema.table key or name,
 *     among those they may read. A name that matches none is told back as
 *     not found, never as a table that passed;
 *   - each table's freshness (DataAssetFreshness) and how its checks stand
 *     (DataObservabilityAttentionReader.getCheckHealth), by the alerts the
 *     caller may see. Alerts that cannot be read throw: a run is never let
 *     through because a read failed.
 *
 * A request that names a pipeline, and is not a dry run, keeps its answer
 * on the pipeline: when it was asked, and - while it says stop - since when
 * and why, for the pipeline's page and Needs Attention. A go clears the
 * stop; so does a run that starts after it (OpenLineageIngest). It writes
 * its answer as a metric too, oneuptime.data.pipeline.circuit_breaker_stopped
 * (#9683), for the recommended monitor whose alert tells the pipeline's
 * owners it was stopped.
 */

// The most tables of a pipeline's lineage the breaker judges.
export const MAX_CIRCUIT_BREAKER_INPUTS: number = 200;

// The most pipelines one name is looked up among.
const MAX_PIPELINES_BY_NAME: number = 5;

// The most tables one name is matched to.
const MAX_TABLES_BY_NAME: number = 5;

// The most checks of the judged tables read.
const MAX_CHECKS_READ: number = 2_000;

interface FoundTables {
  ids: Array<string>;
  notFound: Array<string>;
}

export default class DataCircuitBreaker {
  public static async check(data: {
    projectId: ObjectID;
    request: DataCircuitBreakerRequest;
    // Whoever asked: what they may read is what is judged.
    props: DatabaseCommonInteractionProps;
    now: Date;
  }): Promise<DataCircuitBreakerAnswer> {
    const { projectId, request, now } = data;

    /*
     * Switched off on the server, Data Observability collects nothing, so
     * every table would read as late and no check would run: nothing is
     * judged, nothing is kept, and the answer is go. Switching a product
     * off never stops what runs elsewhere.
     */
    if (await ServerProducts.getOffReason(ProductKey.DataObservability)) {
      return this.getSwitchedOffAnswer(request, now);
    }

    const scope: DataObservabilityScope = await DataObservabilityReadScope.get(
      projectId,
      data.props,
    );
    const pipeline: DataPipeline | null = request.pipeline
      ? await this.findPipeline({
          projectId,
          reference: request.pipeline,
          scope,
        })
      : null;

    const ids: Set<string> = new Set();

    if (pipeline?.id) {
      for (const id of await this.readPipelineInputs({
        projectId,
        dataPipelineId: pipeline.id,
        props: data.props,
        scope,
      })) {
        ids.add(id);
      }
    }

    const named: FoundTables = await this.findTables({
      projectId,
      references: request.tables,
      scope,
    });

    for (const id of named.ids) {
      ids.add(id);
    }

    const stopsOnLateTables: boolean =
      request.stopsOnLateTables ??
      pipeline?.circuitBreakerStopsOnLateTables === true;
    const inputs: Array<DataCircuitBreakerInput> = await this.readInputs({
      projectId,
      dataAssetIds: Array.from(ids),
      props: data.props,
      scope,
      now,
    });
    const decision: ReturnType<typeof decideDataCircuitBreaker> =
      decideDataCircuitBreaker({ tables: inputs, stopsOnLateTables });
    const answerPipeline: DataCircuitBreakerPipeline | null = pipeline?.id
      ? {
          dataPipelineId: pipeline.id.toString(),
          name: pipeline.jobName || pipeline.jobNamespace || "",
          namespace: pipeline.jobNamespace || "",
        }
      : null;
    const isRecorded: boolean = Boolean(pipeline?.id) && !request.isDryRun;

    if (pipeline?.id && isRecorded) {
      await this.record({
        projectId,
        pipeline,
        verdict: decision.verdict,
        reasons: decision.reasons,
        now,
      });
    }

    const answer: Omit<DataCircuitBreakerAnswer, "answer"> = {
      verdict: decision.verdict,
      reasons: decision.reasons,
      tables: inputs
        .map((input: DataCircuitBreakerInput) => {
          return {
            dataAssetId: input.dataAssetId,
            table: input.table,
            database: input.database,
            freshness: input.freshness,
            lateBySeconds: input.lateBySeconds,
            checkCount: input.checkCount,
            failingCheckCount: input.failingChecks.length,
          };
        })
        .sort((a: { table: string }, b: { table: string }) => {
          return a.table.localeCompare(b.table);
        }),
      notFound: named.notFound,
      stopsOnLateTables,
      pipeline: answerPipeline,
      isRecorded,
      isSwitchedOff: false,
      checkedAt: now.toISOString(),
    };

    return { ...answer, answer: formatDataCircuitBreakerAnswer(answer) };
  }

  // Go, having checked nothing: Data Observability is switched off on the server.
  public static getSwitchedOffAnswer(
    request: DataCircuitBreakerRequest,
    now: Date,
  ): DataCircuitBreakerAnswer {
    const answer: Omit<DataCircuitBreakerAnswer, "answer"> = {
      verdict: DataCircuitBreakerVerdict.Go,
      reasons: [],
      tables: [],
      notFound: [],
      stopsOnLateTables: request.stopsOnLateTables === true,
      pipeline: null,
      isRecorded: false,
      isSwitchedOff: true,
      checkedAt: now.toISOString(),
    };

    return { ...answer, answer: formatDataCircuitBreakerAnswer(answer) };
  }

  /*
   * The pipeline a reference names, of those the caller may read: by its
   * ID, its namespace/name key, or its name alone. A name two namespaces
   * share names both, so the step can say which it is.
   */
  public static async findPipeline(data: {
    projectId: ObjectID;
    reference: string;
    scope: DataObservabilityScope;
  }): Promise<DataPipeline> {
    const select: Record<string, true> = {
      _id: true,
      jobName: true,
      jobNamespace: true,
      pipelineKey: true,
      circuitBreakerStopsOnLateTables: true,
      circuitBreakerStoppedAt: true,
    };
    const reference: string = data.reference.trim();
    const readable: (
      conditions: Record<string, unknown>,
    ) => Promise<Array<DataPipeline>> = async (
      conditions: Record<string, unknown>,
    ): Promise<Array<DataPipeline>> => {
      return await DataPipelineService.findBy({
        query: withConditions<DataPipeline>(
          data.scope.pipelineQuery,
          conditions as never,
        ),
        select,
        sort: { lastRunStartedAt: SortOrder.Descending },
        skip: 0,
        limit: MAX_PIPELINES_BY_NAME,
        props: { isRoot: true },
      });
    };

    let pipelines: Array<DataPipeline> = ObjectID.isValidUUID(reference)
      ? await readable({ _id: new ObjectID(reference) })
      : await readable({
          pipelineKey: QueryHelper.findWithSameText(reference),
        });

    if (pipelines.length === 0 && !ObjectID.isValidUUID(reference)) {
      pipelines = await readable({
        jobName: QueryHelper.findWithSameText(reference),
      });
    }

    if (pipelines.length === 0) {
      throw new BadDataException(
        `No pipeline named ${reference} was found. Name it as Data Observability > Pipelines lists it, or by its ID, and check that the API key may read it.`,
      );
    }

    if (pipelines.length > 1) {
      throw new BadDataException(
        `More than one pipeline is named ${reference}: ${pipelines
          .map((pipeline: DataPipeline): string => {
            return pipeline.pipelineKey || pipeline.jobName || "";
          })
          .join(
            ", ",
          )}. Name it with its namespace, as namespace/name, or by its ID.`,
      );
    }

    return pipelines[0]!;
  }

  /*
   * The tables a pipeline reads, from its lineage, that its caller may read:
   * what it reads and does not write (DataTableLineageReader's rule), so a
   * table it reads and writes is judged as its output, never as an input.
   */
  public static async readPipelineInputs(data: {
    projectId: ObjectID;
    dataPipelineId: ObjectID;
    props: DatabaseCommonInteractionProps;
    scope: DataObservabilityScope;
  }): Promise<Array<string>> {
    const reader: DataPipelineLineageReader =
      await DataTableLineageReader.getScopedDatabaseReader(
        data.projectId,
        data.props,
        data.scope,
      );
    const tables: DataPipelineTables =
      await DataTableLineageReader.readPipelineTables(
        reader,
        data.dataPipelineId.toString(),
      );

    return Array.from(tables.read.keys()).slice(0, MAX_CIRCUIT_BREAKER_INPUTS);
  }

  /*
   * The tables a request names, of those its caller may read and that are
   * still in their databases: by ID, by schema.table key, or by name alone,
   * where a name several databases share judges every table of it.
   */
  public static async findTables(data: {
    projectId: ObjectID;
    references: Array<string>;
    scope: DataObservabilityScope;
  }): Promise<FoundTables> {
    const ids: Array<string> = [];
    const notFound: Array<string> = [];

    for (const reference of data.references) {
      const read: (
        conditions: Record<string, unknown>,
      ) => Promise<Array<DataAsset>> = async (
        conditions: Record<string, unknown>,
      ): Promise<Array<DataAsset>> => {
        return await DataAssetService.findBy({
          query: withConditions<DataAsset>(data.scope.assetQuery, {
            isDropped: false,
            ...conditions,
          } as never),
          select: { _id: true },
          skip: 0,
          limit: MAX_TABLES_BY_NAME,
          props: { isRoot: true },
        });
      };

      let tables: Array<DataAsset> = ObjectID.isValidUUID(reference)
        ? await read({ _id: new ObjectID(reference) })
        : await read({ assetKey: QueryHelper.findWithSameText(reference) });

      if (tables.length === 0 && !ObjectID.isValidUUID(reference)) {
        tables = await read({ name: QueryHelper.findWithSameText(reference) });
      }

      if (tables.length === 0) {
        notFound.push(reference);
        continue;
      }

      for (const table of tables) {
        const id: string = table.id?.toString() || "";

        if (id && !ids.includes(id)) {
          ids.push(id);
        }
      }
    }

    return { ids, notFound };
  }

  // Each table as the rule reads it: its freshness, and its failing checks.
  public static async readInputs(data: {
    projectId: ObjectID;
    dataAssetIds: Array<string>;
    props: DatabaseCommonInteractionProps;
    scope: DataObservabilityScope;
    now: Date;
  }): Promise<Array<DataCircuitBreakerInput>> {
    if (data.dataAssetIds.length === 0) {
      return [];
    }

    const assets: Array<DataAsset> = await DataAssetService.findBy({
      query: withConditions<DataAsset>(data.scope.assetQuery, {
        _id: QueryHelper.any(data.dataAssetIds),
        isDropped: false,
      }),
      select: {
        _id: true,
        assetKey: true,
        dataStoreName: true,
        assetKind: true,
        lastChangedAt: true,
        updateIntervalInSeconds: true,
      },
      skip: 0,
      limit: data.dataAssetIds.length,
      props: { isRoot: true },
    });

    if (assets.length === 0) {
      return [];
    }

    const checks: Array<DataCheck> = await DataCheckService.findBy({
      // A reconciliation's two checks are told of as the reconciliation.
      query: withConditions<DataCheck>(data.scope.checkQuery, {
        dataAssetId: QueryHelper.any(
          assets.map((asset: DataAsset): string => {
            return asset.id!.toString();
          }),
        ),
        dataReconciliationId: QueryHelper.isNull(),
      }),
      select: {
        _id: true,
        name: true,
        checkType: true,
        dataAssetId: true,
        isEnabled: true,
        lastRunAt: true,
        lastRunStatus: true,
        monitorId: true,
      },
      skip: 0,
      limit: MAX_CHECKS_READ,
      props: { isRoot: true },
    });
    const health: Map<string, DataCheckHealthAnswer> =
      await DataObservabilityAttentionReader.getCheckHealth({
        projectId: data.projectId,
        reader: data.props,
        checks,
        // Never "go" because the alerts could not be read.
        throwsWhenAlertsUnreadable: true,
      });

    return assets.map((asset: DataAsset): DataCircuitBreakerInput => {
      const id: string = asset.id!.toString();
      const freshness: DataAssetFreshnessResult = getDataAssetFreshness({
        kind: asset.assetKind as DataAssetKind,
        lastChangedAt: asset.lastChangedAt
          ? OneUptimeDate.fromString(asset.lastChangedAt)
          : null,
        updateIntervalInSeconds: asset.updateIntervalInSeconds,
        now: data.now,
      });
      const ofTable: Array<DataCheck> = checks.filter(
        (check: DataCheck): boolean => {
          return check.dataAssetId?.toString() === id;
        },
      );

      return {
        dataAssetId: id,
        table: asset.assetKey || "",
        database: asset.dataStoreName || null,
        freshness: freshness.freshness,
        lateBySeconds: freshness.overdueBySeconds,
        checkCount: ofTable.length,
        failingChecks: ofTable
          .filter((check: DataCheck): boolean => {
            return (
              health.get(check.id?.toString() || "")?.health ===
              DataCheckHealth.Failing
            );
          })
          .map((check: DataCheck) => {
            return {
              dataCheckId: check.id!.toString(),
              name: check.name || "",
            };
          }),
      };
    });
  }

  /*
   * The answer kept on the pipeline: when it was asked, and while it says
   * stop, since when - the first stop of a row, so Needs Attention says how
   * long it has been held - and the latest reasons. A go clears the stop.
   */
  public static async record(data: {
    projectId: ObjectID;
    pipeline: DataPipeline;
    verdict: DataCircuitBreakerVerdict;
    reasons: Array<DataCircuitBreakerReason>;
    now: Date;
  }): Promise<void> {
    const isStop: boolean = data.verdict === DataCircuitBreakerVerdict.Stop;

    await DataPipelineService.updateColumnsByIdWithoutHooks({
      id: data.pipeline.id!,
      data: {
        circuitBreakerCheckedAt: data.now,
        circuitBreakerStoppedAt: isStop
          ? data.pipeline.circuitBreakerStoppedAt || data.now
          : null,
        circuitBreakerReasons: isStop
          ? data.reasons.slice(0, MAX_CIRCUIT_BREAKER_REASONS)
          : null,
      } as never,
    });

    await this.writeStoppedMetric({
      projectId: data.projectId,
      pipeline: data.pipeline,
      isStopped: isStop,
      now: data.now,
    });
  }

  /*
   * oneuptime.data.pipeline.circuit_breaker_stopped (#9683): 1 as the
   * circuit breaker stops the pipeline, 0 as it says go, for the
   * recommended monitor "Pipeline Stopped by Circuit Breaker", whose alert
   * goes to the pipeline's owners. The five-minute schedule check writes
   * the kept answer again (DataPipelineScheduleCheck). Never fails the
   * answer: whether the run goes ahead is the answer's, whatever becomes of
   * its metric.
   */
  public static async writeStoppedMetric(data: {
    projectId: ObjectID;
    pipeline: DataPipeline;
    isStopped: boolean;
    now: Date;
  }): Promise<void> {
    try {
      await OpenLineageIngest.writeMetricRows(data.projectId, [
        buildPipelineMetricRow({
          projectId: data.projectId,
          pipeline: data.pipeline,
          metricName: DataPipelineMetricName.CircuitBreakerStopped,
          value: data.isStopped ? 1 : 0,
          at: data.now,
          retentionDays: await MonitorMetricUtil.getRetentionDays(),
        }),
      ]);
    } catch (error) {
      logger.error(
        `Data Observability: could not write the circuit breaker's answer for pipeline ${data.pipeline.id?.toString()} as a metric.`,
        { projectId: data.projectId.toString() },
      );
      logger.error(error);
    }
  }

  /*
   * How a pipeline's circuit breaker stands, for its page: its setting,
   * when it was last asked, and since when it has stopped the pipeline and
   * why - the reasons about tables its reader may read, the rest left out.
   * Null for a pipeline its reader may not read.
   */
  public static async readState(data: {
    projectId: ObjectID;
    dataPipelineId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataPipelineCircuitBreakerState | null> {
    const scope: DataObservabilityScope = await DataObservabilityReadScope.get(
      data.projectId,
      data.props,
    );
    const pipeline: DataPipeline | null = await DataPipelineService.findOneBy({
      query: withConditions<DataPipeline>(scope.pipelineQuery, {
        _id: data.dataPipelineId,
      }),
      select: {
        _id: true,
        circuitBreakerStopsOnLateTables: true,
        circuitBreakerCheckedAt: true,
        circuitBreakerStoppedAt: true,
        circuitBreakerReasons: true,
      },
      props: { isRoot: true },
    });

    if (!pipeline?.id) {
      return null;
    }

    const stoppedAt: Date | null = pipeline.circuitBreakerStoppedAt
      ? OneUptimeDate.fromString(pipeline.circuitBreakerStoppedAt)
      : null;

    return {
      dataPipelineId: pipeline.id.toString(),
      stopsOnLateTables: pipeline.circuitBreakerStopsOnLateTables === true,
      checkedAt: pipeline.circuitBreakerCheckedAt
        ? OneUptimeDate.fromString(
            pipeline.circuitBreakerCheckedAt,
          ).toISOString()
        : null,
      stoppedAt: stoppedAt ? stoppedAt.toISOString() : null,
      reasons: stoppedAt
        ? await this.keepReadableReasons({
            reasons: readDataCircuitBreakerReasons(
              pipeline.circuitBreakerReasons,
            ),
            scope,
          })
        : [],
    };
  }

  // The reasons about tables a reader may read: a table they may not read is never named.
  public static async keepReadableReasons(data: {
    reasons: Array<DataCircuitBreakerReason>;
    scope: DataObservabilityScope;
  }): Promise<Array<DataCircuitBreakerReason>> {
    if (data.scope.isWholeProject || data.reasons.length === 0) {
      return data.reasons;
    }

    const readable: Set<string> =
      await DataObservabilityReadScope.getReadableIds({
        service: DataAssetService,
        query: data.scope.assetQuery,
        ids: Array.from(
          new Set(
            data.reasons.map((reason: DataCircuitBreakerReason): string => {
              return reason.dataAssetId;
            }),
          ),
        ),
      });

    return data.reasons.filter((reason: DataCircuitBreakerReason): boolean => {
      return readable.has(reason.dataAssetId);
    });
  }
}
