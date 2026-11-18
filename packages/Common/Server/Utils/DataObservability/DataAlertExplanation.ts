import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import { DataObservabilityTableErrors } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import DatabaseServerService from "../../Services/DatabaseServerService";
import DataTableErrors from "./DataTableErrors";
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
import {
  getFailedRunCauseTitle,
  getFailedWritesCauseTitle,
  getRaisedErrorCauseTitle,
  getSchemaChangeCauseTitle,
  getUnreadableDatabaseCauseTitle,
  getUnwellServerCauseTitle,
  getUpstreamAlertCauseTitle,
  titleAsWritten,
} from "../../../Types/DataObservability/DataAlertCauseTitles";
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
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import logger from "../Logger";
import DataTableDashboards, { TableDashboard } from "./Bi/DataTableDashboards";
import DataObservabilityReadScope from "./DataObservabilityReadScope";
import DataTableLineageReader, {
  DataLineageReadable,
  keepReadableWrites,
} from "./DataTableLineage";
import { isFailedState } from "./OpenLineageIngest";
import { TableHealthStatus } from "./TableHealthIngest";

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
 *
 * Only the tables and pipelines its reader may read are told (#9526,
 * #9562), as the alert's Lineage card beside it draws them: a role limited
 * to what its members own, or to some labels, is never told of a pipeline
 * or a table it may not read - not as a cause, not down the lineage, not
 * as the table a dashboard reads, nor by its owners - and nothing left out
 * is counted, not even in how many tables feed from one. An alert whose own
 * table or pipeline they may not read is explained by its cause upstream
 * alone, as its Lineage card draws nothing.
 *
 * A title the reader words itself is written with DataAlertCauseTitles: its
 * English, and its sentence's code with the names in it, so the Dashboard
 * says it in the reader's language (#8343). A record's own words - an
 * alert's title, a change's - are titled as written.
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

// A backslash and the mark it escapes (FeedMarkdown's mdText escapes a value's marks).
const ESCAPED_MARK: RegExp = /\\([!-/:-@[-`{-~])/g;
const HELD_MARK: RegExp = /\uE000(\d+)\uE000/g;
const LINK: RegExp = /\[([^\]]*)\]\([^)]*\)/g;

/*
 * A feed line's words as plain text: its bold and code marks gone, a link
 * as its words, a mark a value escaped as the mark it is. The names in it
 * keep every letter: stripping each "_" and "*" read a removed customer_id
 * column as "customerid", its int_4 type as "int4".
 */
export function getFeedLineAsPlainText(markdown: string): string {
  const escaped: Array<string> = [];
  const held: string = markdown.replace(
    ESCAPED_MARK,
    (_match: string, mark: string): string => {
      escaped.push(mark);
      return `\uE000${escaped.length - 1}\uE000`;
    },
  );

  return held
    .replace(LINK, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(HELD_MARK, (_match: string, index: string): string => {
      return escaped[Number(index)] || "";
    });
}

export default class DataAlertExplanationReader {
  public static async read(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    /*
     * Who it is explained to: the person, or API key, who asked, whose
     * grants decide which tables and pipelines it tells of (see above).
     * Left out, OneUptime's own read of every one.
     */
    reader?: DatabaseCommonInteractionProps | null | undefined;
  }): Promise<DataAlertExplanation | null> {
    const found: DataAlert | null = await DataAlertService.findOneBy({
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

    if (!found) {
      return null;
    }

    const readable: DataLineageReadable | null =
      DataTableLineageReader.getNamedReadable(
        await DataObservabilityReadScope.get(data.projectId, data.reader),
      );
    const row: DataAlert = await this.keepReadableSubject(found, readable);

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
      this.readFailedRuns(data.projectId, row, windowStart, readable),
      this.readWriters(data.projectId, row, windowStart, windowEnd),
      this.readSchemaChanges(data.projectId, row, windowStart, windowEnd),
      this.readDatabase(data.projectId, row),
    ]);

    return {
      causes: rankLikelyCauses(causes.flat()),
      impact: await this.readImpact(data.projectId, row, readable),
      feedback: row.feedback || null,
      isCauseConfirmed:
        row.isCauseConfirmed === undefined || row.isCauseConfirmed === null
          ? null
          : row.isCauseConfirmed,
    };
  }

  /*
   * What the alert is about, as its reader may be told it: its table and
   * its pipeline only when they may read them (#9562). One they may not
   * read leaves every fact read from it out - its writers, its runs, its
   * columns, its database, what is built from it - as the alert's Lineage
   * card draws nothing around it. Every one, for a reader whose scope
   * narrows nothing (null).
   */
  private static async keepReadableSubject(
    row: DataAlert,
    readable: DataLineageReadable | null,
  ): Promise<DataAlert> {
    if (!readable) {
      return row;
    }

    const kept: DataAlert = new DataAlert();

    kept.causeAlertId = row.causeAlertId!;
    kept.feedback = row.feedback!;
    kept.isCauseConfirmed = row.isCauseConfirmed!;

    if (row.dataAssetId) {
      const tables: Set<string> = await readable.readableTableIds([
        row.dataAssetId.toString(),
      ]);

      if (!tables.has(row.dataAssetId.toString())) {
        return kept;
      }

      kept.dataAssetId = row.dataAssetId;
    }

    if (row.dataPipelineId) {
      const pipelines: Set<string> = await readable.readablePipelineIds([
        row.dataPipelineId.toString(),
      ]);

      if (!pipelines.has(row.dataPipelineId.toString())) {
        return kept;
      }

      kept.dataPipelineId = row.dataPipelineId;
    }

    // A whole database's alert names its database itself.
    kept.dataStoreId = row.dataStoreId!;

    return kept;
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
        ...getUpstreamAlertCauseTitle({
          isPrivate: cause.isPrivate,
          alertNumberWithPrefix: cause.alertNumberWithPrefix,
          title: cause.title,
        }),
        at: toTime(cause.createdAt),
      },
    ];
  }

  // The runs of the pipelines that write the table, of those its reader may be told of (keepReadableWrites).
  private static async readFailedRuns(
    projectId: ObjectID,
    row: DataAlert,
    windowStart: Date,
    readable: DataLineageReadable | null,
  ): Promise<Array<DataAlertLikelyCause>> {
    const edges: Array<DataAssetLineage> = row.dataAssetId
      ? await orNothing(
          (async (): Promise<Array<DataAssetLineage>> => {
            return await keepReadableWrites(
              await DataAssetLineageService.findBy({
                query: {
                  projectId,
                  downstreamDataAssetId: row.dataAssetId!,
                  dataPipelineId: QueryHelper.notNull(),
                },
                select: {
                  upstreamDataAssetId: true,
                  downstreamDataAssetId: true,
                  dataPipelineId: true,
                },
                limit: 20,
                skip: 0,
                props: { isRoot: true },
              }),
              readable,
            );
          })(),
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
          ...getFailedRunCauseTitle(pipeline?.jobName),
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

    // What the writers' own errors say, when they name the table.
    if (row.dataAssetId) {
      const errors: DataObservabilityTableErrors = await orNothing(
        DataTableErrors.read({
          projectId,
          dataAssetId: row.dataAssetId,
          now: windowEnd,
        }),
        { services: [], exceptions: [], logs: [] },
      );

      for (const exception of errors.exceptions.slice(
        0,
        MAX_CAUSES_OF_A_KIND,
      )) {
        causes.push({
          kind: DataAlertCauseKind.FailingWrites,
          ...getRaisedErrorCauseTitle({
            serviceName: exception.serviceName,
            errorType: exception.type,
          }),
          detail: clip(exception.message),
          at: exception.lastSeenAt || undefined,
        });
      }
    }

    for (const writer of writers) {
      if (writer.errorCount) {
        causes.push({
          kind: DataAlertCauseKind.FailingWrites,
          ...getFailedWritesCauseTitle({
            serviceName: writer.serviceName,
            failed: writer.errorCount,
            total: writer.callCount,
          }),
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
        ...titleAsWritten(
          [names.get(change.primaryEntityId?.toString() || ""), change.title]
            .filter(Boolean)
            .join(": "),
        ),
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
        ...getSchemaChangeCauseTitle(
          clip(getFeedLineAsPlainText(item.feedInfoInMarkdown || "")),
        ),
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
          databaseServerId: true,
        },
        props: { isRoot: true },
      }),
      null,
    );
    const causes: Array<DataAlertLikelyCause> =
      store?.tableHealthStatus === TableHealthStatus.Failed
        ? [
            {
              kind: DataAlertCauseKind.Database,
              ...getUnreadableDatabaseCauseTitle(store.name),
              detail: clip(store.tableHealthMessage),
              at: toTime(store.tableHealthCollectedAt),
            },
          ]
        : [];

    // The server under it, from the Database product: a server that is unwell explains its tables.
    if (store?.databaseServerId) {
      const server: DatabaseServer | null = await orNothing(
        DatabaseServerService.findOneBy({
          query: { projectId, _id: store.databaseServerId },
          select: { name: true, engineHealth: true, engineReadingsAt: true },
          props: { isRoot: true },
        }),
        null,
      );

      if (server?.engineHealth && server.engineHealth !== "healthy") {
        causes.push({
          kind: DataAlertCauseKind.Database,
          ...getUnwellServerCauseTitle({
            serverName: server.name,
            health: server.engineHealth,
          }),
          at: toTime(server.engineReadingsAt),
        });
      }
    }

    return causes;
  }

  private static async readImpact(
    projectId: ObjectID,
    row: DataAlert,
    readable: DataLineageReadable | null,
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

    /*
     * The tables down the lineage, and how many tables feed from each: of
     * those its reader may read alone, walked through those alone - one
     * they may not read is neither told nor counted as feeding from another.
     */
    const dependents: Map<string, number> = new Map();
    let frontier: Array<string> = [row.dataAssetId.toString()];
    const seen: Set<string> = new Set(frontier);
    const unreadable: Set<string> = new Set();

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

      if (readable) {
        const reached: Array<string> = Array.from(
          new Set(
            edges
              .map((edge: DataAssetLineage): string => {
                return edge.downstreamDataAssetId!.toString();
              })
              .filter((id: string): boolean => {
                return !seen.has(id) && !unreadable.has(id);
              }),
          ),
        );
        const readableIds: Set<string> =
          reached.length > 0
            ? await readable.readableTableIds(reached)
            : new Set();

        for (const id of reached) {
          if (!readableIds.has(id)) {
            unreadable.add(id);
          }
        }
      }

      const next: Array<string> = [];

      for (const edge of edges) {
        const upstream: string = edge.upstreamDataAssetId!.toString();
        const downstream: string = edge.downstreamDataAssetId!.toString();

        if (unreadable.has(downstream)) {
          continue;
        }

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
      DataTableDashboards.find({
        projectId,
        dataAssetId: row.dataAssetId,
        // Reached through the tables its reader may read alone.
        readable,
      }),
      [] as Array<TableDashboard>,
    );

    impact.dashboards = dashboards
      .slice(0, MAX_LISTED)
      .map((dashboard: TableDashboard): string => {
        return dashboard.name;
      });

    const allIds: Array<string> = [
      row.dataAssetId.toString(),
      ...downstreamIds,
    ];
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
