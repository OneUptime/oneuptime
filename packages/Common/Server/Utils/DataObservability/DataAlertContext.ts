import Alert from "../../../Models/DatabaseModels/Alert";
import ChangeEvent from "../../../Models/AnalyticsModels/ChangeEvent";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetFeed, {
  DataAssetFeedEventType,
} from "../../../Models/DatabaseModels/DataAssetFeed";
import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataAssetUsage from "../../../Models/DatabaseModels/DataAssetUsage";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DataPipelineRun from "../../../Models/DatabaseModels/DataPipelineRun";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import {
  DataAssetFreshness,
  getDataAssetFreshness,
} from "../../../Types/DataObservability/DataAssetFreshness";
import { DataAssetAccessKind } from "../../../Types/DataObservability/DataAssetUsage";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import ChangeEventService from "../../Services/ChangeEventService";
import DataAlertService from "../../Services/DataAlertService";
import DataAssetFeedService from "../../Services/DataAssetFeedService";
import DataAssetLineageService from "../../Services/DataAssetLineageService";
import DataAssetService from "../../Services/DataAssetService";
import DataAssetUsageService from "../../Services/DataAssetUsageService";
import DataPipelineRunService from "../../Services/DataPipelineRunService";
import DataPipelineService from "../../Services/DataPipelineService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import DataTableAnswerer, {
  DataTableAnswer,
  describeDuration,
  formatDataTableAnswer,
} from "./DataTableAnswer";

/*
 * WHAT AN AI INVESTIGATION OF A DATA ALERT NEEDS TO KNOW.
 *
 * A data alert (DataAlert: a table, a pipeline or a database) is most often
 * explained by something next to it: a run of the pipeline that writes the
 * table failed, a service that writes it started failing its writes, or one
 * was deployed the hour before; or a table upstream went stale first. This
 * gathers those facts, in the window an investigation cares about (the day
 * before the alert, and the hour after), as plain text the investigation
 * reads with the rest of the alert's context:
 *
 *  - the table: fresh or late by its own rhythm, its open alerts, the data
 *    products it is part of (DataTableAnswer);
 *  - the alert this one is a consequence of, when it is one (DataAlertCause);
 *    a private one is not named;
 *  - the pipelines that write it, each with its runs in the window - a
 *    failed run with its error;
 *  - the services seen writing it in their database spans, with how many
 *    of their writes failed, and their deploys and other changes in the
 *    window;
 *  - the tables it is built from, with the ones that are late;
 *  - the columns of the table that changed in the window.
 *
 * Every read is bounded, and one that fails leaves its part out rather
 * than the investigation without the rest.
 *
 * Nobody in particular reads what this writes: the investigation's report
 * goes to the alert's feed and its Slack and Microsoft Teams channels,
 * which everyone who may see the alert reads. A private alert - seen only
 * by its owners - is never named there, nor its title written.
 */

const COLUMN_CHANGE_EVENTS: ReadonlyArray<DataAssetFeedEventType> = [
  DataAssetFeedEventType.ColumnAdded,
  DataAssetFeedEventType.ColumnRemoved,
  DataAssetFeedEventType.ColumnRenamed,
  DataAssetFeedEventType.ColumnTypeChanged,
  DataAssetFeedEventType.ColumnNullabilityChanged,
];

const CHANGES_BEFORE_IN_HOURS: number = 24;
const CHANGES_AFTER_IN_HOURS: number = 1;
const MAX_RUNS_PER_PIPELINE: number = 5;
const MAX_WRITERS: number = 5;
const MAX_CHANGES: number = 10;
const MAX_UPSTREAM: number = 10;
const MAX_ERROR_LENGTH: number = 300;

function clip(text: string | null | undefined, max: number): string {
  const value: string = (text || "").replace(/\s+/g, " ").trim();

  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function when(date: Date | null | undefined, now: Date): string {
  if (!date) {
    return "an unknown time";
  }

  const seconds: number = (now.getTime() - new Date(date).getTime()) / 1000;

  return seconds >= 0
    ? `${describeDuration(seconds)} ago (${new Date(date).toISOString()})`
    : new Date(date).toISOString();
}

async function orNothing<T>(read: Promise<T>, fallback: T): Promise<T> {
  try {
    return await read;
  } catch (error) {
    logger.debug(error);
    return fallback;
  }
}

export default class DataAlertContext {
  /*
   * The data facts of an alert, as a section of an investigation's context
   * (AlertInvestigationRunner), or "" when the alert is not a data alert.
   */
  public static async buildContextSection(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    now: Date;
  }): Promise<string> {
    const dataAlert: DataAlert | null = await DataAlertService.findOneBy({
      query: { projectId: data.projectId, alertId: data.alertId },
      select: {
        dataAssetId: true,
        dataPipelineId: true,
        dataStoreId: true,
        causeAlertId: true,
      },
      props: { isRoot: true },
    });

    if (!dataAlert) {
      return "";
    }

    const alert: Alert | null = await AlertService.findOneBy({
      query: { projectId: data.projectId, _id: data.alertId },
      select: { createdAt: true },
      props: { isRoot: true },
    });
    const alertedAt: Date = alert?.createdAt
      ? new Date(alert.createdAt)
      : data.now;
    const windowStart: Date = OneUptimeDate.addRemoveHours(
      alertedAt,
      -CHANGES_BEFORE_IN_HOURS,
    );
    const windowEnd: Date = OneUptimeDate.addRemoveHours(
      alertedAt,
      CHANGES_AFTER_IN_HOURS,
    );
    const sections: Array<string> = [
      "\n\n## Data Observability: this is a data alert",
      "A data alert is most often explained by what is next to it: a failed or missing run of a pipeline that writes the table, a writer service whose writes started failing or that was deployed shortly before, or a table upstream that went stale first. Name the run, deploy or upstream table behind it when these facts show one.",
    ];

    if (dataAlert.causeAlertId) {
      const cause: Alert | null = await orNothing(
        AlertService.findOneBy({
          query: { projectId: data.projectId, _id: dataAlert.causeAlertId },
          select: {
            title: true,
            alertNumberWithPrefix: true,
            createdAt: true,
            currentAlertState: { name: true },
            // A private cause is not named, as in this alert's feed (DataAlertCause).
            isPrivate: true,
          },
          props: { isRoot: true },
        }),
        null,
      );

      if (cause?.isPrivate) {
        sections.push(
          "- This alert is a consequence of a private alert, open on what this table is built from. Only its owners may see it, so it is not named here.",
        );
      } else if (cause) {
        sections.push(
          `- This alert is a consequence of ${cause.alertNumberWithPrefix || "another alert"} "${clip(cause.title, 200)}"${cause.currentAlertState?.name ? ` (${cause.currentAlertState.name})` : ""}, opened ${when(cause.createdAt, data.now)}, on what this table is built from: investigate that one first.`,
        );
      }
    }

    let pipelineIds: Array<ObjectID> = [];

    if (dataAlert.dataAssetId) {
      // For nobody in particular: the table's alerts that are not private.
      const answer: DataTableAnswer | null = await orNothing(
        DataTableAnswerer.answer(
          data.projectId,
          dataAlert.dataAssetId,
          data.now,
          null,
        ),
        null,
      );

      if (answer) {
        sections.push(
          `- The table: ${formatDataTableAnswer(answer, data.now)}`,
        );
      }

      const writes: Array<DataAssetLineage> = await orNothing(
        DataAssetLineageService.findBy({
          query: {
            projectId: data.projectId,
            downstreamDataAssetId: dataAlert.dataAssetId,
            dataPipelineId: QueryHelper.notNull(),
          },
          select: { dataPipelineId: true },
          limit: 20,
          skip: 0,
          props: { isRoot: true },
        }),
        [] as Array<DataAssetLineage>,
      );

      pipelineIds = Array.from(
        new Set(
          writes.map((edge: DataAssetLineage): string => {
            return edge.dataPipelineId!.toString();
          }),
        ),
      ).map((id: string): ObjectID => {
        return new ObjectID(id);
      });

      sections.push(
        ...(await this.describeWriters({
          projectId: data.projectId,
          dataAssetId: dataAlert.dataAssetId,
          windowStart,
          windowEnd,
          now: data.now,
        })),
        ...(await this.describeUpstream({
          projectId: data.projectId,
          dataAssetId: dataAlert.dataAssetId,
          now: data.now,
        })),
        ...(await this.describeSchemaChanges({
          projectId: data.projectId,
          dataAssetId: dataAlert.dataAssetId,
          windowStart,
          windowEnd,
          now: data.now,
        })),
      );
    }

    if (dataAlert.dataPipelineId) {
      pipelineIds.push(dataAlert.dataPipelineId);
    }

    sections.push(
      ...(await this.describePipelineRuns({
        projectId: data.projectId,
        pipelineIds,
        windowStart,
        now: data.now,
      })),
    );

    return sections.join("\n");
  }

  // A column that changed just before is often the whole story: a writer still using the old one fails.
  private static async describeSchemaChanges(data: {
    projectId: ObjectID;
    dataAssetId: ObjectID;
    windowStart: Date;
    windowEnd: Date;
    now: Date;
  }): Promise<Array<string>> {
    const changes: Array<DataAssetFeed> = await orNothing(
      DataAssetFeedService.findBy({
        query: {
          projectId: data.projectId,
          dataAssetId: data.dataAssetId,
          dataAssetFeedEventType: QueryHelper.any([...COLUMN_CHANGE_EVENTS]),
          postedAt: new InBetween(data.windowStart, data.windowEnd),
        },
        select: { feedInfoInMarkdown: true, postedAt: true },
        sort: { postedAt: SortOrder.Descending },
        limit: MAX_CHANGES,
        skip: 0,
        props: { isRoot: true },
      }),
      [] as Array<DataAssetFeed>,
    );

    return changes.map((change: DataAssetFeed): string => {
      return `- Its columns changed ${when(change.postedAt, data.now)}: ${clip(change.feedInfoInMarkdown, MAX_ERROR_LENGTH)}`;
    });
  }

  // Each writing pipeline's runs since the window began: a failed one names itself.
  private static async describePipelineRuns(data: {
    projectId: ObjectID;
    pipelineIds: Array<ObjectID>;
    windowStart: Date;
    now: Date;
  }): Promise<Array<string>> {
    const lines: Array<string> = [];
    const seen: Set<string> = new Set();

    for (const pipelineId of data.pipelineIds.slice(0, 10)) {
      if (seen.has(pipelineId.toString())) {
        continue;
      }

      seen.add(pipelineId.toString());

      const pipeline: DataPipeline | null = await orNothing(
        DataPipelineService.findOneBy({
          query: { projectId: data.projectId, _id: pipelineId },
          select: {
            jobName: true,
            jobNamespace: true,
            typicalRunDurationInSeconds: true,
            expectedRunIntervalInSeconds: true,
            lastRunStartedAt: true,
          },
          props: { isRoot: true },
        }),
        null,
      );

      if (!pipeline) {
        continue;
      }

      const runs: Array<DataPipelineRun> = await orNothing(
        DataPipelineRunService.findBy({
          query: {
            projectId: data.projectId,
            dataPipelineId: pipelineId,
            startedAt: QueryHelper.greaterThanEqualTo(data.windowStart),
          },
          select: {
            state: true,
            startedAt: true,
            endedAt: true,
            durationInSeconds: true,
            errorMessage: true,
          },
          sort: { startedAt: SortOrder.Descending },
          limit: MAX_RUNS_PER_PIPELINE,
          skip: 0,
          props: { isRoot: true },
        }),
        [] as Array<DataPipelineRun>,
      );
      const rhythm: string = [
        pipeline.expectedRunIntervalInSeconds
          ? `it usually runs every ${describeDuration(pipeline.expectedRunIntervalInSeconds)}`
          : null,
        pipeline.typicalRunDurationInSeconds
          ? `a run usually takes ${describeDuration(pipeline.typicalRunDurationInSeconds)}`
          : null,
      ]
        .filter(Boolean)
        .join(", and ");
      const name: string = `${pipeline.jobNamespace ? `${pipeline.jobNamespace}/` : ""}${pipeline.jobName || ""}`;

      if (runs.length === 0) {
        lines.push(
          `- The pipeline ${name} writes this table; it has not run since the day before the alert${pipeline.lastRunStartedAt ? ` (its last run started ${when(pipeline.lastRunStartedAt, data.now)})` : ""}${rhythm ? `, though ${rhythm}` : ""}. A missing run is a likely cause.`,
        );
        continue;
      }

      lines.push(
        `- The pipeline ${name} writes this table${rhythm ? ` (${rhythm})` : ""}. Its runs since the day before the alert, newest first:`,
      );

      for (const run of runs) {
        lines.push(
          `  - ${run.state || "UNKNOWN"}, started ${when(run.startedAt, data.now)}${run.durationInSeconds ? `, took ${describeDuration(run.durationInSeconds)}` : ""}${run.errorMessage ? `, error: ${clip(run.errorMessage, MAX_ERROR_LENGTH)}` : ""}`,
        );
      }
    }

    return lines;
  }

  // The services seen writing the table, their failed writes, and their changes in the window.
  private static async describeWriters(data: {
    projectId: ObjectID;
    dataAssetId: ObjectID;
    windowStart: Date;
    windowEnd: Date;
    now: Date;
  }): Promise<Array<string>> {
    const writers: Array<DataAssetUsage> = await orNothing(
      DataAssetUsageService.findBy({
        query: {
          projectId: data.projectId,
          dataAssetId: data.dataAssetId,
          accessKind: DataAssetAccessKind.Write,
        },
        select: {
          serviceId: true,
          serviceName: true,
          callCount: true,
          errorCount: true,
          lastSeenAt: true,
        },
        sort: { lastSeenAt: SortOrder.Descending },
        limit: MAX_WRITERS,
        skip: 0,
        props: { isRoot: true },
      }),
      [] as Array<DataAssetUsage>,
    );

    if (writers.length === 0) {
      return [];
    }

    const lines: Array<string> = [
      "- Services seen writing this table, from their database spans in the last hour they were read:",
    ];

    for (const writer of writers) {
      lines.push(
        `  - ${writer.serviceName || "a service"}: ${writer.callCount || 0} writes, ${writer.errorCount || 0} of them failed; last seen ${when(writer.lastSeenAt, data.now)}.`,
      );
    }

    const serviceIds: Array<ObjectID> = writers
      .map((writer: DataAssetUsage): ObjectID | undefined => {
        return writer.serviceId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });
    const changes: Array<ChangeEvent> =
      serviceIds.length > 0
        ? await orNothing(
            ChangeEventService.findBy({
              query: {
                projectId: data.projectId,
                time: new InBetween(data.windowStart, data.windowEnd),
                primaryEntityId: QueryHelper.any(serviceIds),
              } as never,
              select: {
                time: true,
                eventType: true,
                title: true,
                primaryEntityId: true,
              } as never,
              sort: { time: SortOrder.Descending } as never,
              limit: MAX_CHANGES,
              skip: 0,
              props: { isRoot: true },
            }),
            [] as Array<ChangeEvent>,
          )
        : [];
    const nameOf: Map<string, string> = new Map(
      writers.map((writer: DataAssetUsage): [string, string] => {
        return [writer.serviceId?.toString() || "", writer.serviceName || ""];
      }),
    );

    if (changes.length > 0) {
      lines.push(
        "- Deploys and other changes of those services from the day before the alert to the hour after, newest first:",
      );

      for (const change of changes) {
        lines.push(
          `  - ${change.eventType || "change"} of ${nameOf.get(change.primaryEntityId?.toString() || "") || "a writer"}: "${clip(change.title, 200)}", ${when(change.time, data.now)}.`,
        );
      }
    } else {
      lines.push(
        "- No deploy or other change of those services was recorded from the day before the alert to the hour after.",
      );
    }

    return lines;
  }

  // The tables this one is built from, the late ones named.
  private static async describeUpstream(data: {
    projectId: ObjectID;
    dataAssetId: ObjectID;
    now: Date;
  }): Promise<Array<string>> {
    const edges: Array<DataAssetLineage> = await orNothing(
      DataAssetLineageService.findBy({
        query: {
          projectId: data.projectId,
          downstreamDataAssetId: data.dataAssetId,
          upstreamDataAssetId: QueryHelper.notNull(),
        },
        select: { upstreamDataAssetId: true, source: true },
        limit: 50,
        skip: 0,
        props: { isRoot: true },
      }),
      [] as Array<DataAssetLineage>,
    );
    const ids: Array<ObjectID> = Array.from(
      new Set(
        edges.map((edge: DataAssetLineage): string => {
          return edge.upstreamDataAssetId!.toString();
        }),
      ),
    )
      .slice(0, MAX_UPSTREAM)
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });

    if (ids.length === 0) {
      return [];
    }

    const tables: Array<DataAsset> = await orNothing(
      DataAssetService.findBy({
        query: { projectId: data.projectId, _id: QueryHelper.any(ids) },
        select: {
          assetKey: true,
          dataStoreName: true,
          assetKind: true,
          lastChangedAt: true,
          updateIntervalInSeconds: true,
        },
        limit: ids.length,
        skip: 0,
        props: { isRoot: true },
      }),
      [] as Array<DataAsset>,
    );

    return [
      "- Tables this table is built from (lineage):",
      ...tables.map((table: DataAsset): string => {
        const freshness: DataAssetFreshness = getDataAssetFreshness({
          kind: table.assetKind as DataAssetKind,
          lastChangedAt: table.lastChangedAt
            ? new Date(table.lastChangedAt)
            : null,
          updateIntervalInSeconds: table.updateIntervalInSeconds,
          now: data.now,
        }).freshness;

        return `  - ${table.assetKey || ""}${table.dataStoreName ? ` (${table.dataStoreName})` : ""}: ${freshness.toLowerCase()}, last changed ${when(table.lastChangedAt, data.now)}.`;
      }),
    ];
  }
}
