import DataMigrationBase from "./DataMigrationBase";
import MoveMonitorsOffRetiredCloudMetrics, {
  PAGE_SIZE,
  countWrittenRows,
} from "./MoveMonitorsOffRetiredCloudMetrics";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ServiceLevelObjectiveFeedEventType } from "Common/Models/DatabaseModels/ServiceLevelObjectiveFeed";
import DashboardService from "Common/Server/Services/DashboardService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import ServiceLevelObjectiveFeedService from "Common/Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveService from "Common/Server/Services/ServiceLevelObjectiveService";
import CloudRetiredMetricReads, {
  NAMES_RETIRED_COSMOS_METRIC,
  NAMES_RETIRED_PUBSUB_METRIC,
} from "Common/Server/Utils/CloudConnection/CloudRetiredMetricReads";
import logger from "Common/Server/Utils/Logger";
import { Gray500, Yellow500 } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "Common/Utils/Markdown/FeedMarkdown";
import {
  findRetiredCloudMetricQueriesOfDashboard,
  findRetiredCloudMetricQueryOfSlo,
  moveRetiredCloudMetricQueriesOfDashboard,
  moveRetiredCloudMetricQueryOfSlo,
} from "Common/Utils/Metrics/RetiredCloudMetricChartMoves";
import {
  CosmosLatencyEvidence,
  PUBSUB_PUBLISH_OPERATIONS_SCALE,
  RetiredCloudMetric,
  RetiredCloudMetricKept,
  RetiredCloudMetricKeptReason,
  RetiredCloudMetricMove,
  RetiredCloudMetricOutcome,
  RetiredCloudMetricQuery,
} from "Common/Utils/Metrics/RetiredCloudMetricMoves";

/*
 * DASHBOARD CHARTS AND SLOS MOVED OFF THE METRICS THEIR CLOUDS DEPRECATE
 * (#9980), as their monitors were (MoveMonitorsOffRetiredCloudMetrics).
 *
 * A dashboard's widgets and an SLO's metric that read Cosmos DB's
 * ServerSideLatency or Pub/Sub's send_message_operation_count move to what
 * replaces each, by the monitors' rules (RetiredCloudMetricChartMoves): a
 * Cosmos DB account's latency by what the account reported, the same
 * evidence; Pub/Sub's messages published a minute, each threshold 60 times
 * what it was and each formula over it divided by 60. A widget or an SLO it
 * cannot move stays: the connection keeps reading the old metric of what a
 * widget reads (CloudRetiredMetricReads), the chart says what to read
 * instead, and every hour the move is tried again (moveAll, from the job
 * MoveOffRetiredCloudMetrics).
 *
 * A dashboard has no feed: a widget moved reads what replaces its metric,
 * and one kept says so on the dashboard. An SLO's feed says what changed,
 * or - from this migration, once - why it stays. Each row is written only
 * while it still holds what was read, so a save made meanwhile is never
 * overwritten.
 */

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface DashboardRow {
  _id: string;
  projectId: string;
  dashboardViewConfig: JSONObject | string | null;
}

interface SloRow {
  _id: string;
  projectId: string;
  metricQueryConfig: JSONObject | string | null;
}

export interface RetiredCloudMetricMoveCounts {
  moved: number;
  kept: number;
  failed: number;
}

function parse(value: JSONObject | string | null): JSONObject | null {
  return MoveMonitorsOffRetiredCloudMetrics.parse(value);
}

// One account's evidence serves every query of it in a row.
function evidenceKey(query: RetiredCloudMetricQuery): string {
  return `${query.metricName.toLowerCase()}\n${JSON.stringify(query.attributes ?? null)}`;
}

/*
 * The evidence of each Cosmos DB account the queries read, found once each;
 * one that cannot be found is none, and its query stays.
 */
async function findEvidence(data: {
  projectId: ObjectID;
  queries: Array<RetiredCloudMetricQuery>;
  rowId: string;
}): Promise<Map<string, CosmosLatencyEvidence | null>> {
  const evidence: Map<string, CosmosLatencyEvidence | null> = new Map();
  const now: Date = MoveMonitorsOffRetiredCloudMetrics.now();

  for (const query of data.queries) {
    if (query.metric !== RetiredCloudMetric.CosmosServerSideLatency) {
      continue;
    }

    const key: string = evidenceKey(query);

    if (evidence.has(key)) {
      continue;
    }

    try {
      evidence.set(
        key,
        await MoveMonitorsOffRetiredCloudMetrics.findEvidence({
          projectId: data.projectId,
          query,
          now,
        }),
      );
    } catch (err) {
      logger.error(
        `MoveChartsAndSlosOffRetiredCloudMetrics: could not tell which latency the Cosmos DB account of ${data.rowId} reports:`,
      );
      logger.error(err);
      evidence.set(key, null);
    }
  }

  return evidence;
}

export default class MoveChartsAndSlosOffRetiredCloudMetrics extends DataMigrationBase {
  public constructor() {
    super("MoveChartsAndSlosOffRetiredCloudMetrics");
  }

  public override async migrate(): Promise<void> {
    await MoveChartsAndSlosOffRetiredCloudMetrics.moveAll({ tellKept: true });
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: a widget or an SLO moved back would read a metric
     * nothing reads for it.
     */
  }

  /*
   * Every dashboard and SLO still on a deprecated metric, moved where it
   * can be. `tellKept`: whether an SLO none of whose metric moved is told
   * it stays (the migration, once).
   */
  public static async moveAll(options: { tellKept: boolean }): Promise<{
    dashboards: RetiredCloudMetricMoveCounts;
    slos: RetiredCloudMetricMoveCounts;
  }> {
    const dashboards: RetiredCloudMetricMoveCounts =
      await MoveChartsAndSlosOffRetiredCloudMetrics.moveDashboards();
    const slos: RetiredCloudMetricMoveCounts =
      await MoveChartsAndSlosOffRetiredCloudMetrics.moveSlos(options);

    if (
      options.tellKept ||
      dashboards.moved + slos.moved + dashboards.failed + slos.failed > 0
    ) {
      logger.info(
        `MoveChartsAndSlosOffRetiredCloudMetrics: ${dashboards.moved} dashboard(s) and ${slos.moved} SLO(s) moved off a metric their cloud deprecates; ${dashboards.kept} dashboard(s) and ${slos.kept} SLO(s) left on one${
          dashboards.failed + slos.failed
            ? `; ${dashboards.failed + slos.failed} could not be read or written`
            : ""
        }.`,
      );
    }

    return { dashboards, slos };
  }

  // Rows of `table` whose `column` names a deprecated metric, a page at a time, by id.
  private static async readPage<T>(data: {
    repository: ModelRepository;
    table: string;
    column: string;
    lastId: string | null;
  }): Promise<Array<T>> {
    return (await data.repository.manager.query(
      `SELECT "_id", "projectId", "${data.column}" FROM "${data.table}" WHERE "${data.column}" IS NOT NULL AND "deletedAt" IS NULL AND ("${data.column}"::text ILIKE $2 OR "${data.column}"::text ILIKE $3)${
        data.lastId ? ` AND "_id" > $4` : ""
      } ORDER BY "_id" ASC LIMIT $1`,
      data.lastId
        ? [
            PAGE_SIZE,
            NAMES_RETIRED_PUBSUB_METRIC,
            NAMES_RETIRED_COSMOS_METRIC,
            data.lastId,
          ]
        : [PAGE_SIZE, NAMES_RETIRED_PUBSUB_METRIC, NAMES_RETIRED_COSMOS_METRIC],
    )) as Array<T>;
  }

  // Writes `value` while the row still holds `before`: whether it did.
  private static async writeWhileUnchanged(data: {
    repository: ModelRepository;
    table: string;
    column: string;
    id: string;
    value: JSONObject;
    before: string;
  }): Promise<boolean> {
    const written: unknown = await data.repository.manager.query(
      `UPDATE "${data.table}" SET "${data.column}" = $1 WHERE "_id" = $2 AND "${data.column}" = $3::jsonb RETURNING "_id"`,
      [JSON.stringify(data.value), data.id, data.before],
    );

    return countWrittenRows(written) > 0;
  }

  public static async moveDashboards(): Promise<RetiredCloudMetricMoveCounts> {
    const repository: ModelRepository = (
      DashboardService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    const table: string = repository.metadata.tableName;
    const counts: RetiredCloudMetricMoveCounts = {
      moved: 0,
      kept: 0,
      failed: 0,
    };
    let lastId: string | null = null;

    while (true) {
      const rows: Array<DashboardRow> =
        await MoveChartsAndSlosOffRetiredCloudMetrics.readPage<DashboardRow>({
          repository,
          table,
          column: "dashboardViewConfig",
          lastId,
        });

      for (const row of rows) {
        try {
          const outcome: RetiredCloudMetricOutcome | null =
            await MoveChartsAndSlosOffRetiredCloudMetrics.moveDashboardRow({
              repository,
              table,
              row,
            });

          counts.moved += outcome && outcome.moved.length > 0 ? 1 : 0;
          counts.kept += outcome && outcome.kept.length > 0 ? 1 : 0;
        } catch (err) {
          // One dashboard that cannot be moved must not hold the others back.
          counts.failed++;
          logger.error(
            `MoveChartsAndSlosOffRetiredCloudMetrics: could not move dashboard ${row._id}:`,
          );
          logger.error(err);
        }
      }

      if (rows.length < PAGE_SIZE) {
        break;
      }

      lastId = rows[rows.length - 1]!._id;
    }

    return counts;
  }

  private static async moveDashboardRow(data: {
    repository: ModelRepository;
    table: string;
    row: DashboardRow;
  }): Promise<RetiredCloudMetricOutcome | null> {
    const stored: JSONObject | null = parse(data.row.dashboardViewConfig);

    if (!stored || !data.row.projectId) {
      return null;
    }

    const queries: Array<RetiredCloudMetricQuery> =
      findRetiredCloudMetricQueriesOfDashboard(stored);

    if (queries.length === 0) {
      return null;
    }

    const projectId: ObjectID = new ObjectID(data.row.projectId);
    const evidence: Map<string, CosmosLatencyEvidence | null> =
      await findEvidence({
        projectId,
        queries,
        rowId: `dashboard ${data.row._id}`,
      });
    const before: string = JSON.stringify(stored);
    const viewConfig: JSONObject = JSON.parse(before) as JSONObject;
    const outcome: RetiredCloudMetricOutcome =
      moveRetiredCloudMetricQueriesOfDashboard({
        dashboardViewConfigJSON: viewConfig,
        evidenceOf: (
          query: RetiredCloudMetricQuery,
        ): CosmosLatencyEvidence | null => {
          return evidence.get(evidenceKey(query)) || null;
        },
      });

    if (outcome.moved.length > 0) {
      const written: boolean =
        await MoveChartsAndSlosOffRetiredCloudMetrics.writeWhileUnchanged({
          repository: data.repository,
          table: data.table,
          column: "dashboardViewConfig",
          id: data.row._id,
          value: viewConfig,
          before,
        });

      // Saved again since it was read: its next save is its own.
      if (!written) {
        return null;
      }

      CloudRetiredMetricReads.forget(projectId);
    }

    return outcome;
  }

  public static async moveSlos(options: {
    tellKept: boolean;
  }): Promise<RetiredCloudMetricMoveCounts> {
    const repository: ModelRepository = (
      ServiceLevelObjectiveService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    const table: string = repository.metadata.tableName;
    const counts: RetiredCloudMetricMoveCounts = {
      moved: 0,
      kept: 0,
      failed: 0,
    };
    let lastId: string | null = null;

    while (true) {
      const rows: Array<SloRow> =
        await MoveChartsAndSlosOffRetiredCloudMetrics.readPage<SloRow>({
          repository,
          table,
          column: "metricQueryConfig",
          lastId,
        });

      for (const row of rows) {
        try {
          const outcome: RetiredCloudMetricOutcome | null =
            await MoveChartsAndSlosOffRetiredCloudMetrics.moveSloRow({
              repository,
              table,
              row,
              tellKept: options.tellKept,
            });

          counts.moved += outcome && outcome.moved.length > 0 ? 1 : 0;
          counts.kept += outcome && outcome.kept.length > 0 ? 1 : 0;
        } catch (err) {
          counts.failed++;
          logger.error(
            `MoveChartsAndSlosOffRetiredCloudMetrics: could not move SLO ${row._id}:`,
          );
          logger.error(err);
        }
      }

      if (rows.length < PAGE_SIZE) {
        break;
      }

      lastId = rows[rows.length - 1]!._id;
    }

    return counts;
  }

  private static async moveSloRow(data: {
    repository: ModelRepository;
    table: string;
    row: SloRow;
    tellKept: boolean;
  }): Promise<RetiredCloudMetricOutcome | null> {
    const stored: JSONObject | null = parse(data.row.metricQueryConfig);
    const query: RetiredCloudMetricQuery | null =
      findRetiredCloudMetricQueryOfSlo(stored);

    if (!stored || !query || !data.row.projectId) {
      return null;
    }

    const projectId: ObjectID = new ObjectID(data.row.projectId);
    const evidence: Map<string, CosmosLatencyEvidence | null> =
      await findEvidence({
        projectId,
        queries: [query],
        rowId: `SLO ${data.row._id}`,
      });
    const before: string = JSON.stringify(stored);
    const config: JSONObject = JSON.parse(before) as JSONObject;
    const outcome: RetiredCloudMetricOutcome = moveRetiredCloudMetricQueryOfSlo(
      {
        metricQueryConfig: config,
        evidenceOf: (
          candidate: RetiredCloudMetricQuery,
        ): CosmosLatencyEvidence | null => {
          return evidence.get(evidenceKey(candidate)) || null;
        },
      },
    );

    if (outcome.moved.length > 0) {
      const written: boolean =
        await MoveChartsAndSlosOffRetiredCloudMetrics.writeWhileUnchanged({
          repository: data.repository,
          table: data.table,
          column: "metricQueryConfig",
          id: data.row._id,
          value: config,
          before,
        });

      if (!written) {
        return null;
      }
    } else if (!data.tellKept) {
      return outcome;
    }

    try {
      await ServiceLevelObjectiveFeedService.createServiceLevelObjectiveFeedItem(
        {
          serviceLevelObjectiveId: new ObjectID(data.row._id),
          projectId,
          serviceLevelObjectiveFeedEventType:
            ServiceLevelObjectiveFeedEventType.ServiceLevelObjectiveUpdated,
          displayColor: outcome.kept.length > 0 ? Yellow500 : Gray500,
          feedInfoInMarkdown:
            MoveChartsAndSlosOffRetiredCloudMetrics.getSloFeedMarkdown(
              outcome,
            ).toString(),
        },
      );
    } catch (err) {
      // It counts what it counts either way; only its feed misses the word.
      logger.error(
        `MoveChartsAndSlosOffRetiredCloudMetrics: could not tell SLO ${data.row._id}'s feed:`,
      );
      logger.error(err);
    }

    return outcome;
  }

  // What an SLO's feed says: what changed, or why it stays and what to count instead.
  public static getSloFeedMarkdown(
    outcome: RetiredCloudMetricOutcome,
  ): MarkdownText {
    const move: RetiredCloudMetricMove | undefined = outcome.moved[0];

    if (move) {
      const goodValue: MarkdownText =
        move.thresholds.length > 0
          ? mdText` Its good value is ${String(PUBSUB_PUBLISH_OPERATIONS_SCALE)} times what it was (${String(move.thresholds[0]!.from)} is now ${String(move.thresholds[0]!.to)}): the publish operations were a rate a second, the messages published a count a minute.`
          : mdText``;

      return mdText`📊 **This SLO now counts what replaces a metric its cloud deprecates.**

${FeedMarkdown.code(move.from)} is now ${FeedMarkdown.code(move.to)}.${goodValue} Review its settings.`;
    }

    const kept: RetiredCloudMetricKept = outcome.kept[0]!;
    const replacements: MarkdownText = FeedMarkdown.join(
      kept.replacements.map((name: string): MarkdownText => {
        return FeedMarkdown.code(name);
      }),
      " or ",
    );
    const why: string =
      kept.reason === RetiredCloudMetricKeptReason.ResponseCode
        ? "its filter names a response code, which what replaces it does not have"
        : "the account reported neither latency in the last 30 days, so OneUptime cannot tell whether its clients connect in direct or gateway mode";

    return mdText`⚠️ **This SLO counts a metric its cloud deprecates.**

${FeedMarkdown.code(kept.metricName)} is left as it is: ${why}. Choose ${replacements} instead in its settings.`;
  }
}
