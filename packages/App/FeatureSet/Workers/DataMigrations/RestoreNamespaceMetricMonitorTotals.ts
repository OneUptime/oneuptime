import DataMigrationBase from "./DataMigrationBase";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { MonitorFeedEventType } from "Common/Models/DatabaseModels/MonitorFeed";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorFeedService from "Common/Server/Services/MonitorFeedService";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import { Gray500 } from "Common/Types/BrandColors";
import { getCloudResourceTypeLabel } from "Common/Types/Cloud/CloudResourceCatalog";
import { AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudMonitoredResource";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "Common/Utils/Markdown/FeedMarkdown";
import MetricQueryCloudAggregation, {
  MetricQueryAggregationRestore,
  MetricQueryCloudResource,
} from "Common/Utils/Metrics/MetricQueryCloudAggregation";

/*
 * Metrics monitors on a Service Bus or Event Hubs namespace read its
 * metrics with the average. While Azure reported each metric once for the
 * namespace, that was the namespace's number. Since the Azure connection
 * reads them once per queue, topic and event hub (#6415) - as the
 * collector's azure_monitor receiver always did - it is the average queue:
 * a namespace of three queues taking 10, 20 and 30 messages a minute reads
 * 20, not 60, and a monitor set to fire once 100 messages wait fires, in a
 * namespace of four queues, only once 400 do.
 *
 * So each stored Metrics step that reads such a metric with the average a
 * minute at a time - a window of up to 3 hours - reads it with the catalog's
 * Sum from now on (MetricQueryCloudAggregation.restoreResourceTotals): the
 * namespace's number again, which its Metrics tab shows as the "total of
 * series" too, so its criteria's thresholds mean what they meant. Each
 * monitor moved says so in its feed. A step read in longer intervals or
 * whole, and a query with an aggregation of its own (Max, Min, a
 * percentile, Sum), is left as it is (see restoreResourceTotals).
 *
 * Postgres only. Idempotent: a moved query reads with Sum, which is never
 * moved again. A row is written only while it still holds what was read,
 * so a save made meanwhile is never overwritten, and only a row written
 * gets a feed entry.
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
 * Only rows whose steps name an Azure resource can hold a namespace's query:
 * read only those, of the monitors that read metrics.
 */
export const NAMES_AN_AZURE_RESOURCE: string = `%"${AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE}"%`;

// The rows an `UPDATE ... RETURNING` touched, however the driver shapes them.
function countWrittenRows(result: unknown): number {
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

export default class RestoreNamespaceMetricMonitorTotals extends DataMigrationBase {
  public constructor() {
    super("RestoreNamespaceMetricMonitorTotals");
  }

  public override async migrate(): Promise<void> {
    const repository: ModelRepository = (
      MonitorService as unknown as DatabaseService<BaseModel>
    ).getRepository();
    const tableName: string = repository.metadata.tableName;
    let lastId: string | null = null;
    let moved: number = 0;
    let failed: number = 0;

    while (true) {
      const rows: Array<MonitorRow> = (await repository.manager.query(
        `SELECT "_id", "projectId", "monitorSteps" FROM "${tableName}" WHERE "monitorSteps" IS NOT NULL AND "monitorType" = $2 AND "monitorSteps"::text LIKE $3${
          lastId ? ` AND "_id" > $4` : ""
        } ORDER BY "_id" ASC LIMIT $1`,
        lastId
          ? [PAGE_SIZE, MonitorType.Metrics, NAMES_AN_AZURE_RESOURCE, lastId]
          : [PAGE_SIZE, MonitorType.Metrics, NAMES_AN_AZURE_RESOURCE],
      )) as Array<MonitorRow>;

      for (const row of rows) {
        try {
          const stored: JSONObject | null =
            RestoreNamespaceMetricMonitorTotals.parse(row.monitorSteps);

          if (!stored || !row.projectId) {
            continue;
          }

          const before: string = JSON.stringify(stored);
          const monitorSteps: JSONObject = JSON.parse(before) as JSONObject;
          const restored: Array<MetricQueryAggregationRestore> = [];

          for (const metricMonitor of MetricQueryCloudAggregation.getStoredMetricMonitors(
            monitorSteps,
          )) {
            restored.push(
              ...MetricQueryCloudAggregation.restoreResourceTotals(
                metricMonitor,
              ),
            );
          }

          if (restored.length === 0) {
            continue;
          }

          const written: unknown = await repository.manager.query(
            `UPDATE "${tableName}" SET "monitorSteps" = $1 WHERE "_id" = $2 AND "monitorSteps" = $3::jsonb RETURNING "_id"`,
            [JSON.stringify(monitorSteps), row._id, before],
          );

          // Saved again since it was read: its next save is its own.
          if (countWrittenRows(written) === 0) {
            continue;
          }

          moved++;

          try {
            await MonitorFeedService.createMonitorFeedItem({
              monitorId: new ObjectID(row._id),
              projectId: new ObjectID(row.projectId),
              monitorFeedEventType: MonitorFeedEventType.MonitorUpdated,
              displayColor: Gray500,
              feedInfoInMarkdown:
                RestoreNamespaceMetricMonitorTotals.getFeedMarkdown(
                  restored,
                ).toString(),
            });
          } catch (err) {
            // It reads its total either way; only its feed misses the word.
            logger.error(
              `RestoreNamespaceMetricMonitorTotals: could not tell monitor ${row._id}'s feed:`,
            );
            logger.error(err);
          }
        } catch (err) {
          /*
           * One monitor that cannot be moved must not hold the others back:
           * it keeps reading as it did, and a person can move it on its form.
           */
          failed++;
          logger.error(
            `RestoreNamespaceMetricMonitorTotals: could not move monitor ${row._id}:`,
          );
          logger.error(err);
        }
      }

      if (rows.length < PAGE_SIZE) {
        break;
      }

      lastId = rows[rows.length - 1]!._id;
    }

    logger.info(
      `RestoreNamespaceMetricMonitorTotals: ${moved} monitor(s) read their namespace's metrics as its total${
        failed ? `; ${failed} could not be written` : ""
      }.`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: a monitor's aggregation is its own setting, and the
     * average it read before is the average queue.
     */
  }

  /*
   * What a moved monitor's feed says: which resource and which of its
   * metrics, what they read now and why, and that the criteria are as they
   * were. One line per resource, in the order its queries are.
   */
  public static getFeedMarkdown(
    restored: Array<MetricQueryAggregationRestore>,
  ): MarkdownText {
    const byResource: Map<
      string,
      { resource: MetricQueryCloudResource; metricNames: Array<string> }
    > = new Map();

    for (const query of restored) {
      const key: string = `${query.resource.type}|${query.resource.name}`;
      const entry: {
        resource: MetricQueryCloudResource;
        metricNames: Array<string>;
      } = byResource.get(key) || {
        resource: query.resource,
        metricNames: [],
      };

      if (!entry.metricNames.includes(query.metricName)) {
        entry.metricNames.push(query.metricName);
      }

      byResource.set(key, entry);
    }

    const lines: Array<MarkdownText> = Array.from(byResource.values()).map(
      (entry: {
        resource: MetricQueryCloudResource;
        metricNames: Array<string>;
      }): MarkdownText => {
        const metrics: MarkdownText =
          RestoreNamespaceMetricMonitorTotals.listOf(
            entry.metricNames.map((metricName: string): MarkdownText => {
              return FeedMarkdown.code(metricName);
            }),
          );

        return mdText`Azure reports the metrics of the ${getCloudResourceTypeLabel(
          entry.resource.provider,
          entry.resource.type,
        )} **${entry.resource.name}** once per queue, topic and event hub, so an average of them is the average queue. This monitor now reads ${metrics} with **Sum**: the namespace's total, the number its **Metrics** tab shows.`;
      },
    );

    return mdText`📊 **This monitor reads its namespace's total.**

${FeedMarkdown.join(lines, "\n\n")}

Its criteria are unchanged.`;
  }

  // "a", "a and b", "a, b and c".
  private static listOf(items: Array<MarkdownText>): MarkdownText {
    if (items.length < 2) {
      return FeedMarkdown.join(items);
    }

    return mdText`${FeedMarkdown.join(items.slice(0, -1))} and ${items[items.length - 1]!}`;
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
