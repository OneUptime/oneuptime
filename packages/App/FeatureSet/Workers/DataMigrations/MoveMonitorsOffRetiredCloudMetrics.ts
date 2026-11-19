import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { MonitorFeedEventType } from "Common/Models/DatabaseModels/MonitorFeed";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorFeedService from "Common/Server/Services/MonitorFeedService";
import MonitorService from "Common/Server/Services/MonitorService";
import CloudResourceMetrics from "Common/Server/Utils/CloudConnection/CloudResourceMetrics";
import CloudRetiredMetricReads from "Common/Server/Utils/CloudConnection/CloudRetiredMetricReads";
import logger from "Common/Server/Utils/Logger";
import { Gray500, Yellow500 } from "Common/Types/BrandColors";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
  resolveCloudMonitoredResource,
} from "Common/Types/Cloud/CloudMonitoredResource";
import {
  CloudResourceReadings,
  getCloudReadingKey,
  readCloudResourceReadings,
} from "Common/Types/Cloud/CloudResourceHealth";
import { CLOUD_UNREPORTED_LOOK_BACK_DAYS } from "Common/Types/Cloud/CloudUnreportedKeyMetrics";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "Common/Utils/Markdown/FeedMarkdown";
import {
  CosmosConnectionMode,
  CosmosLatencyEvidence,
  PUBSUB_PUBLISH_OPERATIONS_SCALE,
  RetiredCloudMetric,
  RetiredCloudMetricKept,
  RetiredCloudMetricKeptReason,
  RetiredCloudMetricMove,
  RetiredCloudMetricOutcome,
  RetiredCloudMetricQuery,
  findRetiredCloudMetricQueries,
  getCosmosLatencyReplacement,
  moveRetiredCloudMetricQueries,
} from "Common/Utils/Metrics/RetiredCloudMetricMoves";

/*
 * MONITORS MOVED OFF THE METRICS THEIR CLOUDS DEPRECATE (#9739).
 *
 * From this release the cloud connections no longer read a Pub/Sub topic's
 * send_message_operation_count, which Google deprecates, nor a Cosmos DB
 * account's ServerSideLatency, which Microsoft removes from Azure Monitor;
 * since #9565 they read what replaces each. A Metrics monitor whose query
 * read one would read nothing new. So each one moves to its replacement
 * (RetiredCloudMetricMoves, which pins how):
 *
 *   - Pub/Sub: the messages published a minute, each threshold compared
 *     with it 60 times what it was and each formula over it divided by 60
 *     (it was a rate a second), so it fires when it did;
 *   - Cosmos DB: the latency of the account's direct-mode or gateway-mode
 *     requests, whichever it reported most in the last 30 days (the metric
 *     store, and the latency its last read kept), else the gateway's for an
 *     account of the API for MongoDB, which connects through it alone. Both
 *     in milliseconds: nothing else changes.
 *
 * Each monitor moved says what changed in its feed, and asks for a review.
 * A query left as it is - one of a response code, a count of points, a
 * threshold in a unit of its own, a formula it could not read, an account
 * that reported neither latency - says in its feed what to read instead.
 * It is not left with nothing to judge: the connection keeps reading the
 * deprecated metric of the resources such a query reads, for as long as
 * one does (CloudRetiredMetricReads), and its Metrics card says so. Every
 * hour the same move is tried again (moveAll, from the job
 * MoveOffRetiredCloudMetrics), with the same rules and the same compare-
 * and-set: a Cosmos DB account that reported neither latency when this
 * ran - idle, or new - moves once it reports one, and its feed says so.
 *
 * Postgres and the metric store's reads only. A row is written only while
 * it still holds what was read, so a save made meanwhile is never
 * overwritten, and only a row written gets the feed entry that says it was
 * moved. Moved, a query reads no deprecated metric, and is never moved
 * again; a query left as it is gets its word once, as the migration runs
 * once.
 */

// Taken from Common's service so App does not resolve its own typeorm copy.
type ModelRepository = ReturnType<DatabaseService<BaseModel>["getRepository"]>;

interface MonitorRow {
  _id: string;
  projectId: string;
  monitorSteps: JSONObject | string | null;
}

export const PAGE_SIZE: number = 500;

/*
 * Only rows whose steps name one of the two can hold a query of one: read
 * only those, of the monitors that read metrics. Wide on purpose ("_" is
 * any character to LIKE, and a replacement's name holds the latency's):
 * which query reads a deprecated metric is the module's to say.
 */
export const NAMES_PUBSUB_PUBLISH_OPERATIONS: string =
  "%send_message_operation_count%";
export const NAMES_COSMOS_SERVER_SIDE_LATENCY: string = "%serversidelatency%";

// The look-back a Cosmos DB account's latencies are counted over: as a resource's page says "not reported in".
export const COSMOS_EVIDENCE_LOOK_BACK_MS: number =
  CLOUD_UNREPORTED_LOOK_BACK_DAYS * 24 * 60 * 60 * 1000;

// What a Cosmos DB account's queries are moved by, found for one query.
export type CosmosLatencyEvidenceFinder = (data: {
  projectId: ObjectID;
  query: RetiredCloudMetricQuery;
  now: Date;
}) => Promise<CosmosLatencyEvidence | null>;

// The rows an `UPDATE ... RETURNING` touched, however the driver shapes them.
export function countWrittenRows(result: unknown): number {
  if (!Array.isArray(result)) {
    return 0;
  }

  // pg returns [rows, rowCount] for UPDATE ... RETURNING through TypeORM.
  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[1];
  }

  return result.length;
}

/*
 * A query's attribute filter as the metric store matches it: every value
 * text. Null for one with any other (a search, a list): what it reads is
 * not one account's, and nothing is guessed of it.
 */
export function readPlainAttributes(
  attributes: unknown,
): Record<string, string> | null {
  if (
    !attributes ||
    typeof attributes !== "object" ||
    Array.isArray(attributes)
  ) {
    return attributes === undefined || attributes === null ? {} : null;
  }

  const plain: Record<string, string> = {};

  for (const [key, value] of Object.entries(
    attributes as Record<string, unknown>,
  )) {
    if (typeof value !== "string") {
      return null;
    }

    plain[key] = value;
  }

  return plain;
}

/*
 * What is known of the Cosmos DB account a query reads: how many points
 * each latency reported in the last 30 days for what its filter matches,
 * the latency its row's last read kept, and whether its API connects
 * through the gateway alone (its inventory's kind, MongoDB). A filter that
 * is not all text says nothing.
 */
export async function findCosmosLatencyEvidence(data: {
  projectId: ObjectID;
  query: RetiredCloudMetricQuery;
  now: Date;
}): Promise<CosmosLatencyEvidence | null> {
  const attributes: Record<string, string> | null = readPlainAttributes(
    data.query.attributes,
  );
  const direct: string | null = getCosmosLatencyReplacement(
    data.query.metricName,
    CosmosConnectionMode.Direct,
  );
  const gateway: string | null = getCosmosLatencyReplacement(
    data.query.metricName,
    CosmosConnectionMode.Gateway,
  );

  if (!attributes || !direct || !gateway) {
    return null;
  }

  const points: Map<string, number> =
    await CloudResourceMetrics.findReportedPoints({
      projectId: data.projectId,
      attributes,
      names: [direct, gateway],
      since: new Date(data.now.getTime() - COSMOS_EVIDENCE_LOOK_BACK_MS),
      until: data.now,
    });
  const account: CloudResource | null = await findAccountRow({
    projectId: data.projectId,
    query: data.query,
    attributes,
  });
  const readings: CloudResourceReadings = readCloudResourceReadings(
    account?.cloudReadings,
  );
  const hasReading: (name: string) => boolean = (name: string): boolean => {
    const key: string | null = getCloudReadingKey("azure", name);

    return Boolean(key && readings[key]);
  };
  const kind: unknown = (account?.cloudProperties as JSONObject | undefined)?.[
    "kind"
  ];

  return {
    directPoints: (points.get(direct) || 0) + (hasReading(direct) ? 1 : 0),
    gatewayPoints: (points.get(gateway) || 0) + (hasReading(gateway) ? 1 : 0),
    isGatewayOnly:
      typeof kind === "string" && kind.trim().toLowerCase() === "mongodb",
  };
}

// The account's own row, where the query's filter names one account by its id.
async function findAccountRow(data: {
  projectId: ObjectID;
  query: RetiredCloudMetricQuery;
  attributes: Record<string, string>;
}): Promise<CloudResource | null> {
  const resource: CloudMonitoredResource | null = resolveCloudMonitoredResource(
    {
      metricName: data.query.metricName,
      attributes: data.attributes,
    },
  );

  if (!resource) {
    return null;
  }

  return await CloudResourceService.findOneBy({
    query: {
      projectId: data.projectId,
      resourceIdentifier: buildCloudMonitoredResourceIdentifier(resource),
    },
    select: { _id: true, cloudReadings: true, cloudProperties: true },
    props: { isRoot: true },
  });
}

export default class MoveMonitorsOffRetiredCloudMetrics extends DataMigrationBase {
  // What moves a Cosmos DB query; replaced in tests.
  public static findEvidence: CosmosLatencyEvidenceFinder =
    findCosmosLatencyEvidence;

  // The migration's clock; replaced in tests.
  public static now: () => Date = (): Date => {
    return new Date();
  };

  public constructor() {
    super("MoveMonitorsOffRetiredCloudMetrics");
  }

  public override async migrate(): Promise<void> {
    await MoveMonitorsOffRetiredCloudMetrics.moveAll({ tellKept: true });
  }

  /*
   * Every Metrics monitor still on a deprecated metric, moved where it can
   * be. `tellKept`: whether a monitor none of whose queries moved is told
   * it stays (the migration, once); the hourly job tells only a move.
   */
  public static async moveAll(options: {
    tellKept: boolean;
  }): Promise<{ moved: number; kept: number; failed: number }> {
    const repository: ModelRepository = (
      MonitorService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    const tableName: string = repository.metadata.tableName;
    let lastId: string | null = null;
    let moved: number = 0;
    let kept: number = 0;
    let failed: number = 0;

    while (true) {
      const rows: Array<MonitorRow> = (await repository.manager.query(
        `SELECT "_id", "projectId", "monitorSteps" FROM "${tableName}" WHERE "monitorSteps" IS NOT NULL AND "monitorType" = $2 AND ("monitorSteps"::text LIKE $3 OR "monitorSteps"::text LIKE $4)${
          lastId ? ` AND "_id" > $5` : ""
        } ORDER BY "_id" ASC LIMIT $1`,
        lastId
          ? [
              PAGE_SIZE,
              MonitorType.Metrics,
              NAMES_PUBSUB_PUBLISH_OPERATIONS,
              NAMES_COSMOS_SERVER_SIDE_LATENCY,
              lastId,
            ]
          : [
              PAGE_SIZE,
              MonitorType.Metrics,
              NAMES_PUBSUB_PUBLISH_OPERATIONS,
              NAMES_COSMOS_SERVER_SIDE_LATENCY,
            ],
      )) as Array<MonitorRow>;

      for (const row of rows) {
        try {
          const outcome: RetiredCloudMetricOutcome | null =
            await MoveMonitorsOffRetiredCloudMetrics.moveRow({
              repository,
              tableName,
              row,
              tellKept: options.tellKept,
            });

          if (outcome) {
            moved += outcome.moved.length > 0 ? 1 : 0;
            kept += outcome.kept.length > 0 ? 1 : 0;
          }
        } catch (err) {
          /*
           * One monitor that cannot be moved must not hold the others back:
           * it keeps reading as it did, and a person can move it on its form.
           */
          failed++;
          logger.error(
            `MoveMonitorsOffRetiredCloudMetrics: could not move monitor ${row._id}:`,
          );
          logger.error(err);
        }
      }

      if (rows.length < PAGE_SIZE) {
        break;
      }

      lastId = rows[rows.length - 1]!._id;
    }

    if (options.tellKept || moved > 0 || failed > 0) {
      logger.info(
        `MoveMonitorsOffRetiredCloudMetrics: ${moved} monitor(s) moved off a metric their cloud deprecates; ${kept} left on one, still read for it${
          failed ? `; ${failed} could not be read or written` : ""
        }.`,
      );
    }

    return { moved, kept, failed };
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the deprecated metrics are no longer read, and a
     * query moved back would read nothing.
     */
  }

  /*
   * One monitor: its queries of a deprecated metric moved, its row written
   * while it holds what was read, and its feed told. The outcome, or null
   * for a row with none (its steps only named one in passing).
   */
  private static async moveRow(data: {
    repository: ModelRepository;
    tableName: string;
    row: MonitorRow;
    tellKept: boolean;
  }): Promise<RetiredCloudMetricOutcome | null> {
    const stored: JSONObject | null = MoveMonitorsOffRetiredCloudMetrics.parse(
      data.row.monitorSteps,
    );

    if (!stored || !data.row.projectId) {
      return null;
    }

    const queries: Array<RetiredCloudMetricQuery> =
      findRetiredCloudMetricQueries(stored);

    if (queries.length === 0) {
      return null;
    }

    const projectId: ObjectID = new ObjectID(data.row.projectId);
    const now: Date = MoveMonitorsOffRetiredCloudMetrics.now();
    const evidence: Map<string, CosmosLatencyEvidence | null> = new Map();

    for (const query of queries) {
      if (query.metric !== RetiredCloudMetric.CosmosServerSideLatency) {
        continue;
      }

      const key: string = MoveMonitorsOffRetiredCloudMetrics.evidenceKey(query);

      if (evidence.has(key)) {
        continue;
      }

      try {
        evidence.set(
          key,
          await MoveMonitorsOffRetiredCloudMetrics.findEvidence({
            projectId,
            query,
            now,
          }),
        );
      } catch (err) {
        // Not known is not moved: the monitor says what to read instead.
        logger.error(
          `MoveMonitorsOffRetiredCloudMetrics: could not tell which latency the Cosmos DB account of monitor ${data.row._id} reports:`,
        );
        logger.error(err);
        evidence.set(key, null);
      }
    }

    const before: string = JSON.stringify(stored);
    const monitorSteps: JSONObject = JSON.parse(before) as JSONObject;
    const outcome: RetiredCloudMetricOutcome = moveRetiredCloudMetricQueries({
      monitorStepsJSON: monitorSteps,
      evidenceOf: (
        query: RetiredCloudMetricQuery,
      ): CosmosLatencyEvidence | null => {
        return (
          evidence.get(MoveMonitorsOffRetiredCloudMetrics.evidenceKey(query)) ||
          null
        );
      },
    });

    if (outcome.moved.length > 0) {
      const written: unknown = await data.repository.manager.query(
        `UPDATE "${data.tableName}" SET "monitorSteps" = $1 WHERE "_id" = $2 AND "monitorSteps" = $3::jsonb RETURNING "_id"`,
        [JSON.stringify(monitorSteps), data.row._id, before],
      );

      // Saved again since it was read: its next save is its own.
      if (countWrittenRows(written) === 0) {
        return null;
      }

      // Its connections stop reading the deprecated metric for it at their next read.
      CloudRetiredMetricReads.forget(projectId);
    }

    // The hourly job tells a move; that a query stays was told once.
    if (!data.tellKept && outcome.moved.length === 0) {
      return outcome;
    }

    try {
      await MonitorFeedService.createMonitorFeedItem({
        monitorId: new ObjectID(data.row._id),
        projectId,
        monitorFeedEventType: MonitorFeedEventType.MonitorUpdated,
        displayColor: outcome.kept.length > 0 ? Yellow500 : Gray500,
        feedInfoInMarkdown:
          MoveMonitorsOffRetiredCloudMetrics.getFeedMarkdown(
            outcome,
          ).toString(),
      });
    } catch (err) {
      // It reads what it reads either way; only its feed misses the word.
      logger.error(
        `MoveMonitorsOffRetiredCloudMetrics: could not tell monitor ${data.row._id}'s feed:`,
      );
      logger.error(err);
    }

    return outcome;
  }

  // One account's evidence serves every query of it in a monitor.
  private static evidenceKey(query: RetiredCloudMetricQuery): string {
    return `${query.metricName.toLowerCase()}\n${JSON.stringify(query.attributes ?? null)}`;
  }

  /*
   * What a monitor's feed says: first what changed for the person who
   * reads it, then each query moved and why, and each left as it is, with
   * what to read instead. A review is asked for either way: a monitor
   * reads another metric now, or nothing new.
   */
  public static getFeedMarkdown(
    outcome: RetiredCloudMetricOutcome,
  ): MarkdownText {
    const lines: Array<MarkdownText> = [];

    for (const move of outcome.moved) {
      lines.push(MoveMonitorsOffRetiredCloudMetrics.describeMove(move));
    }

    for (const kept of outcome.kept) {
      lines.push(MoveMonitorsOffRetiredCloudMetrics.describeKept(kept));
    }

    const heading: MarkdownText =
      outcome.kept.length > 0
        ? mdText`⚠️ **This monitor reads a metric its cloud deprecates.**`
        : mdText`📊 **This monitor now reads what replaces a metric its cloud deprecates.**`;

    return mdText`${heading}

${FeedMarkdown.join(lines, "\n\n")}

Review its criteria: its thresholds were set against the metric it read before.`;
  }

  private static describeMove(move: RetiredCloudMetricMove): MarkdownText {
    if (move.metric === RetiredCloudMetric.PubSubPublishOperations) {
      const thresholds: MarkdownText =
        move.thresholds.length > 0
          ? mdText` Each threshold compared with it is ${String(PUBSUB_PUBLISH_OPERATIONS_SCALE)} times what it was (${FeedMarkdown.join(
              move.thresholds.map(
                (threshold: { from: number; to: number }): MarkdownText => {
                  return mdText`${String(threshold.from)} is now ${String(threshold.to)}`;
                },
              ),
            )}).`
          : mdText``;
      const formulas: MarkdownText =
        move.formulas.length > 0
          ? mdText` A formula over it reads it divided by ${String(PUBSUB_PUBLISH_OPERATIONS_SCALE)}: ${FeedMarkdown.join(
              move.formulas.map(
                (formula: { from: string; to: string }): MarkdownText => {
                  return FeedMarkdown.code(formula.to);
                },
              ),
            )}.`
          : mdText``;

      return mdText`Google deprecates ${FeedMarkdown.code(move.from)}, a Pub/Sub topic's publish operations, which OneUptime read as a rate a second. This monitor now reads ${FeedMarkdown.code(move.to)}, the messages the topic published, a minute at a time, so it fires when it did.${thresholds}${formulas}`;
    }

    const mode: string =
      move.connectionMode === CosmosConnectionMode.Gateway
        ? "gateway mode"
        : "direct mode";
    const also: MarkdownText = move.alsoReported
      ? mdText` The account reported ${FeedMarkdown.code(move.alsoReported)} too: its clients in the other mode are no longer read here, so add a criteria on it if they matter.`
      : mdText``;

    return mdText`Microsoft removes ${FeedMarkdown.code(move.from)}, a Cosmos DB account's server-side latency, from Azure Monitor. This monitor now reads ${FeedMarkdown.code(move.to)}, the latency of the account's requests in ${mode}, which it reports. Its thresholds are as they were: both are in milliseconds.${also}`;
  }

  private static describeKept(kept: RetiredCloudMetricKept): MarkdownText {
    const replacements: MarkdownText = FeedMarkdown.join(
      kept.replacements.map((name: string): MarkdownText => {
        return FeedMarkdown.code(name);
      }),
      " or ",
    );
    const why: string = MoveMonitorsOffRetiredCloudMetrics.whyKept(kept.reason);

    if (kept.reason === RetiredCloudMetricKeptReason.ConnectionModeUnknown) {
      return mdText`${FeedMarkdown.code(kept.metricName)} is left as it is: ${why}. OneUptime keeps reading it for this monitor, and moves the monitor to ${replacements} once the account reports one of them.`;
    }

    return mdText`${FeedMarkdown.code(kept.metricName)} is left as it is: ${why}. OneUptime keeps reading it for this monitor while its cloud publishes it: edit the monitor to read ${replacements} instead.`;
  }

  private static whyKept(reason: RetiredCloudMetricKeptReason): string {
    switch (reason) {
      case RetiredCloudMetricKeptReason.ResponseCode:
        return "it reads publishes by their response code, which what replaces it does not have: it counts the messages published";
      case RetiredCloudMetricKeptReason.PointCount:
        return "it counts the metric's points, which a rate a second and a count a minute do not share";
      case RetiredCloudMetricKeptReason.ThresholdUnit:
        return "a threshold on it is in a unit of its own, which OneUptime cannot convert from a rate a second to a count a minute";
      case RetiredCloudMetricKeptReason.Formula:
        return "a formula over it could not be read to divide it by 60";
      case RetiredCloudMetricKeptReason.ConnectionModeUnknown:
        return "the account reported neither latency in the last 30 days, so OneUptime cannot tell whether its clients connect in direct or gateway mode";
    }

    return "it could not be moved";
  }

  // jsonb comes back parsed; a driver configured otherwise hands back text.
  public static parse(value: JSONObject | string | null): JSONObject | null {
    if (!value) {
      return null;
    }

    if (typeof value === "string") {
      try {
        return JSON.parse(value) as JSONObject;
      } catch {
        return null;
      }
    }

    return value;
  }
}
