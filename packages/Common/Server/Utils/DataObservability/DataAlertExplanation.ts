import Alert from "../../../Models/DatabaseModels/Alert";
import ChangeEvent from "../../../Models/AnalyticsModels/ChangeEvent";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetFeed, {
  DataAssetFeedEventType,
} from "../../../Models/DatabaseModels/DataAssetFeed";
import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataAssetOwnerTeam from "../../../Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerUser from "../../../Models/DatabaseModels/DataAssetOwnerUser";
import DataAssetUsage from "../../../Models/DatabaseModels/DataAssetUsage";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DataPipelineRun from "../../../Models/DatabaseModels/DataPipelineRun";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import {
  DataAlertCauseKind,
  DataAlertExplanation,
  DataAlertImpactItem,
  DataAlertLikelyCause,
  rankLikelyCauses,
} from "../../../Types/DataObservability/DataAlertFeedback";
import { DataAssetAccessKind } from "../../../Types/DataObservability/DataAssetUsage";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import ChangeEventService from "../../Services/ChangeEventService";
import DataAlertService from "../../Services/DataAlertService";
import DataAssetFeedService from "../../Services/DataAssetFeedService";
import DataAssetLineageService from "../../Services/DataAssetLineageService";
import DataAssetOwnerTeamService from "../../Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "../../Services/DataAssetOwnerUserService";
import DataAssetService from "../../Services/DataAssetService";
import DataAssetUsageService from "../../Services/DataAssetUsageService";
import DataPipelineRunService from "../../Services/DataPipelineRunService";
import DataPipelineService from "../../Services/DataPipelineService";
import DataStoreService from "../../Services/DataStoreService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import DataTableDashboards, { TableDashboard } from "./Bi/DataTableDashboards";
import { isFailedState } from "./OpenLineageEvent";

/*
 * WHY A DATA ALERT MOST LIKELY HAPPENED, AND WHAT IT REACHES.
 *
 * What the alert's card says with no AI to run: the facts next to it, each
 * read on its own so one that fails leaves only itself out, ranked: an alert
 * upstream, a failed run of a pipeline that writes the table, a deploy of a
 * service that writes it, its failing writes, a column that changed, the
 * database itself. And what depends on the table: tables down its lineage,
 * most relied on first, dashboards, the services reading it, and the people
 * who own any of them.
 */

const CHANGES_BEFORE_IN_HOURS: number = 24;
const CHANGES_AFTER_IN_HOURS: number = 1;
const MAX_CAUSES_OF_A_KIND: number = 3;
const LINEAGE_DEPTH: number = 3;
const MAX_DOWNSTREAM_TABLES: number = 100;
const MAX_LISTED: number = 10;
const MAX_DETAIL_LENGTH: number = 300;

const SCHEMA_EVENTS: ReadonlyArray<DataAssetFeedEventType> = [
  DataAssetFeedEventType.ColumnRemoved,
  DataAssetFeedEventType.ColumnRenamed,
  DataAssetFeedEventType.ColumnTypeChanged,
  DataAssetFeedEventType.ColumnNullabilityChanged,
];

async function orNothing<T>(read: Promise<T>, fallback: T): Promise<T> {
  try {
    return await read;
  } catch (error) {
    logger.debug(error);
    return fallback;
  }
}

function clip(text: string | null | undefined): string | undefined {
  const value: string = (text || "").replace(/\s+/g, " ").trim();

  return value ? value.slice(0, MAX_DETAIL_LENGTH) : undefined;
}

function toTime(value: Date | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

// Bold and links stay readable as plain words.
const MARKDOWN_MARKS: RegExp = /[*_`]|\[|\]\([^)]*\)/g;

export default class DataAlertExplanationReader {
  public static async read(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<DataAlertExplanation | null> {
    const row: DataAlert | null = await DataAlertService.findOneBy({
      query: { projectId: data.projectId, alertId: data.alertId },
      select: {
        dataAssetId: true,
        dataPipelineId: true,
        dataStoreId: true,
        causeAlertId: true,
        feedback: true,
        isCauseConfirmed: true,
      },
      props: { isRoot: true },
    });

    if (!row) {
      return null;
    }

    const alert: Alert | null = await AlertService.findOneBy({
      query: { projectId: data.projectId, _id: data.alertId },
      select: { createdAt: true },
      props: { isRoot: true },
    });
    const alertedAt: Date = alert?.createdAt
      ? new Date(alert.createdAt)
      : new Date();
    const windowStart: Date = OneUptimeDate.addRemoveHours(
      alertedAt,
      -CHANGES_BEFORE_IN_HOURS,
    );
    const windowEnd: Date = OneUptimeDate.addRemoveHours(
      alertedAt,
      CHANGES_AFTER_IN_HOURS,
    );
    const causes: Array<Array<DataAlertLikelyCause>> = await Promise.all([
      this.readUpstream(data.projectId, row),
      this.readFailedRuns(data.projectId, row, windowStart),
      this.readWriters(data.projectId, row, windowStart, windowEnd),
      this.readSchemaChanges(data.projectId, row, windowStart, windowEnd),
      this.readDatabase(data.projectId, row),
    ]);

    return {
      causes: rankLikelyCauses(causes.flat()),
      impact: await this.readImpact(data.projectId, row),
      feedback: row.feedback || null,
      isCauseConfirmed:
        row.isCauseConfirmed === undefined || row.isCauseConfirmed === null
          ? null
          : row.isCauseConfirmed,
    };
  }

  private static async readUpstream(
    projectId: ObjectID,
    row: DataAlert,
  ): Promise<Array<DataAlertLikelyCause>> {
    if (!row.causeAlertId) {
      return [];
    }

    const cause: Alert | null = await orNothing(
      AlertService.findOneBy({
        query: { projectId, _id: row.causeAlertId },
        select: {
          title: true,
          alertNumberWithPrefix: true,
          createdAt: true,
          isPrivate: true,
        },
        props: { isRoot: true },
      }),
      null,
    );

    if (!cause) {
      return [];
    }

    return [
      {
        kind: DataAlertCauseKind.UpstreamAlert,
        title: cause.isPrivate
          ? "A private alert upstream"
          : [cause.alertNumberWithPrefix, cause.title]
              .filter(Boolean)
              .join(" "),
        at: toTime(cause.createdAt),
      },
    ];
  }

  private static async readFailedRuns(
    projectId: ObjectID,
    row: DataAlert,
    windowStart: Date,
  ): Promise<Array<DataAlertLikelyCause>> {
    const edges: Array<DataAssetLineage> = row.dataAssetId
      ? await orNothing(
          DataAssetLineageService.findBy({
            query: {
              projectId,
              downstreamDataAssetId: row.dataAssetId,
              dataPipelineId: QueryHelper.notNull(),
            },
            select: { dataPipelineId: true },
            limit: 20,
            skip: 0,
            props: { isRoot: true },
          }),
          [] as Array<DataAssetLineage>,
        )
      : [];
    const pipelineIds: Array<string> = Array.from(
      new Set([
        ...edges.map((edge: DataAssetLineage): string => {
          return edge.dataPipelineId!.toString();
        }),
        ...(row.dataPipelineId ? [row.dataPipelineId.toString()] : []),
      ]),
    );
    const causes: Array<DataAlertLikelyCause> = [];

    for (const pipelineId of pipelineIds.slice(0, 10)) {
      const runs: Array<DataPipelineRun> = await orNothing(
        DataPipelineRunService.findBy({
          query: {
            projectId,
            dataPipelineId: new ObjectID(pipelineId),
            startedAt: QueryHelper.greaterThanEqualTo(windowStart),
          },
          select: { state: true, startedAt: true, errorMessage: true },
          sort: { startedAt: SortOrder.Descending },
          limit: 5,
          skip: 0,
          props: { isRoot: true },
        }),
        [] as Array<DataPipelineRun>,
      );
      const failed: DataPipelineRun | undefined = runs.find(
        (run: DataPipelineRun): boolean => {
          return isFailedState(run.state);
        },
      );

      if (failed) {
        const pipeline: DataPipeline | null = await orNothing(
          DataPipelineService.findOneById({
            id: new ObjectID(pipelineId),
            select: { jobName: true },
            props: { isRoot: true },
          }),
          null,
        );

        causes.push({
          kind: DataAlertCauseKind.FailedRun,
          title: `${pipeline?.jobName || "A pipeline"} failed`,
          detail: clip(failed.errorMessage),
          at: toTime(failed.startedAt),
        });
      }
    }

    return causes.slice(0, MAX_CAUSES_OF_A_KIND);
  }

  // The services that write the table: their failing writes and their changes around the alert.
  private static async readWriters(
    projectId: ObjectID,
    row: DataAlert,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<Array<DataAlertLikelyCause>> {
    if (!row.dataAssetId) {
      return [];
    }

    const writers: Array<DataAssetUsage> = await orNothing(
      DataAssetUsageService.findBy({
        query: {
          projectId,
          dataAssetId: row.dataAssetId,
          accessKind: DataAssetAccessKind.Write,
        },
        select: {
          serviceId: true,
          serviceName: true,
          callCount: true,
          errorCount: true,
          lastSeenAt: true,
        },
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      }),
      [] as Array<DataAssetUsage>,
    );
    const causes: Array<DataAlertLikelyCause> = [];

    for (const writer of writers) {
      if (writer.errorCount) {
        causes.push({
          kind: DataAlertCauseKind.FailingWrites,
          title: `${writer.serviceName || "A service"}: ${writer.errorCount} of ${writer.callCount || 0} writes failed`,
          at: toTime(writer.lastSeenAt),
        });
      }
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
                projectId,
                time: new InBetween(windowStart, windowEnd),
                primaryEntityId: QueryHelper.any(serviceIds),
              },
              select: { title: true, primaryEntityId: true, time: true },
              sort: { time: SortOrder.Descending },
              limit: MAX_CAUSES_OF_A_KIND,
              skip: 0,
              props: { isRoot: true },
            }),
            [] as Array<ChangeEvent>,
          )
        : [];
    const names: Map<string, string> = new Map(
      writers.map((writer: DataAssetUsage): [string, string] => {
        return [writer.serviceId?.toString() || "", writer.serviceName || ""];
      }),
    );

    for (const change of changes) {
      causes.push({
        kind: DataAlertCauseKind.Deploy,
        title: [
          names.get(change.primaryEntityId?.toString() || ""),
          change.title,
        ]
          .filter(Boolean)
          .join(": "),
        at: toTime(change.time),
      });
    }

    return causes;
  }

  private static async readSchemaChanges(
    projectId: ObjectID,
    row: DataAlert,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<Array<DataAlertLikelyCause>> {
    if (!row.dataAssetId) {
      return [];
    }

    const items: Array<DataAssetFeed> = await orNothing(
      DataAssetFeedService.findBy({
        query: {
          projectId,
          dataAssetId: row.dataAssetId,
          dataAssetFeedEventType: QueryHelper.any([...SCHEMA_EVENTS]),
          postedAt: new InBetween(windowStart, windowEnd),
        },
        select: { feedInfoInMarkdown: true, postedAt: true },
        sort: { postedAt: SortOrder.Descending },
        limit: MAX_CAUSES_OF_A_KIND,
        skip: 0,
        props: { isRoot: true },
      }),
      [] as Array<DataAssetFeed>,
    );

    return items.map((item: DataAssetFeed): DataAlertLikelyCause => {
      return {
        kind: DataAlertCauseKind.SchemaChange,
        title:
          clip((item.feedInfoInMarkdown || "").replace(MARKDOWN_MARKS, "")) ||
          "A column changed",
        at: toTime(item.postedAt),
      };
    });
  }

  private static async readDatabase(
    projectId: ObjectID,
    row: DataAlert,
  ): Promise<Array<DataAlertLikelyCause>> {
    let storeId: ObjectID | undefined = row.dataStoreId;

    if (!storeId && row.dataAssetId) {
      const asset: DataAsset | null = await orNothing(
        DataAssetService.findOneById({
          id: row.dataAssetId,
          select: { dataStoreId: true },
          props: { isRoot: true },
        }),
        null,
      );

      storeId = asset?.dataStoreId;
    }

    if (!storeId) {
      return [];
    }

    const store: DataStore | null = await orNothing(
      DataStoreService.findOneBy({
        query: { projectId, _id: storeId },
        select: {
          name: true,
          tableHealthStatus: true,
          tableHealthMessage: true,
          tableHealthCollectedAt: true,
        },
        props: { isRoot: true },
      }),
      null,
    );

    return store?.tableHealthStatus === "Failed"
      ? [
          {
            kind: DataAlertCauseKind.Database,
            title: `${store.name || "The database"} could not be read`,
            detail: clip(store.tableHealthMessage),
            at: toTime(store.tableHealthCollectedAt),
          },
        ]
      : [];
  }

  private static async readImpact(
    projectId: ObjectID,
    row: DataAlert,
  ): Promise<DataAlertExplanation["impact"]> {
    const impact: DataAlertExplanation["impact"] = {
      tables: [],
      dashboards: [],
      services: [],
      people: [],
    };

    if (!row.dataAssetId) {
      return impact;
    }

    // The tables down the lineage, and how many tables feed from each.
    const dependents: Map<string, number> = new Map();
    let frontier: Array<string> = [row.dataAssetId.toString()];
    const seen: Set<string> = new Set(frontier);

    for (let depth: number = 0; depth < LINEAGE_DEPTH; depth++) {
      if (frontier.length === 0 || seen.size > MAX_DOWNSTREAM_TABLES) {
        break;
      }

      const edges: Array<DataAssetLineage> = await orNothing(
        DataAssetLineageService.findBy({
          query: {
            projectId,
            upstreamDataAssetId: QueryHelper.any(frontier),
            downstreamDataAssetId: QueryHelper.notNull(),
          },
          select: { upstreamDataAssetId: true, downstreamDataAssetId: true },
          limit: 500,
          skip: 0,
          props: { isRoot: true },
        }),
        [] as Array<DataAssetLineage>,
      );
      const next: Array<string> = [];

      for (const edge of edges) {
        const upstream: string = edge.upstreamDataAssetId!.toString();
        const downstream: string = edge.downstreamDataAssetId!.toString();

        dependents.set(upstream, (dependents.get(upstream) || 0) + 1);

        if (!seen.has(downstream)) {
          seen.add(downstream);
          next.push(downstream);
        }
      }

      frontier = next;
    }

    seen.delete(row.dataAssetId.toString());

    const downstreamIds: Array<string> = Array.from(seen).slice(
      0,
      MAX_DOWNSTREAM_TABLES,
    );

    if (downstreamIds.length > 0) {
      const assets: Array<DataAsset> = await orNothing(
        DataAssetService.findBy({
          query: { projectId, _id: QueryHelper.any(downstreamIds) },
          select: { _id: true, assetKey: true, name: true },
          limit: downstreamIds.length,
          skip: 0,
          props: { isRoot: true },
        }),
        [] as Array<DataAsset>,
      );

      impact.tables = assets
        .map((asset: DataAsset): DataAlertImpactItem => {
          return {
            name: asset.assetKey || asset.name || "",
            dependents: dependents.get(asset.id!.toString()) || 0,
          };
        })
        .sort((a: DataAlertImpactItem, b: DataAlertImpactItem): number => {
          return b.dependents - a.dependents || (a.name < b.name ? -1 : 1);
        })
        .slice(0, MAX_LISTED);
    }

    const dashboards: Array<TableDashboard> = await orNothing(
      DataTableDashboards.find({ projectId, dataAssetId: row.dataAssetId }),
      [] as Array<TableDashboard>,
    );

    impact.dashboards = dashboards
      .slice(0, MAX_LISTED)
      .map((dashboard: TableDashboard): string => {
        return dashboard.name;
      });

    const allIds: Array<string> = [row.dataAssetId.toString(), ...downstreamIds];
    const readers: Array<DataAssetUsage> = await orNothing(
      DataAssetUsageService.findBy({
        query: {
          projectId,
          dataAssetId: QueryHelper.any(allIds),
          accessKind: DataAssetAccessKind.Read,
        },
        select: { serviceName: true },
        limit: 100,
        skip: 0,
        props: { isRoot: true },
      }),
      [] as Array<DataAssetUsage>,
    );

    impact.services = Array.from(
      new Set(
        readers
          .map((usage: DataAssetUsage): string => {
            return usage.serviceName || "";
          })
          .filter(Boolean),
      ),
    ).slice(0, MAX_LISTED);

    const ownerUsers: Array<DataAssetOwnerUser> = await orNothing(
      DataAssetOwnerUserService.findBy({
        query: { projectId, dataAssetId: QueryHelper.any(allIds) },
        select: { user: { name: true } as never },
        limit: 50,
        skip: 0,
        props: { isRoot: true },
      }),
      [] as Array<DataAssetOwnerUser>,
    );
    const ownerTeams: Array<DataAssetOwnerTeam> = await orNothing(
      DataAssetOwnerTeamService.findBy({
        query: { projectId, dataAssetId: QueryHelper.any(allIds) },
        select: { team: { name: true } as never },
        limit: 50,
        skip: 0,
        props: { isRoot: true },
      }),
      [] as Array<DataAssetOwnerTeam>,
    );

    impact.people = Array.from(
      new Set([
        ...ownerTeams.map((owner: DataAssetOwnerTeam): string => {
          return owner.team?.name || "";
        }),
        ...ownerUsers.map((owner: DataAssetOwnerUser): string => {
          return owner.user?.name?.toString() || "";
        }),
      ]),
    )
      .filter(Boolean)
      .slice(0, MAX_LISTED);

    return impact;
  }
}
