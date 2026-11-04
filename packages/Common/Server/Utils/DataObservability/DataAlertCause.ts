import Alert from "../../../Models/DatabaseModels/Alert";
import AlertOwnerTeam from "../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../Models/DatabaseModels/AlertOwnerUser";
import DataAssetOwnerTeam from "../../../Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerUser from "../../../Models/DatabaseModels/DataAssetOwnerUser";
import DataStoreOwnerTeam from "../../../Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "../../../Models/DatabaseModels/DataStoreOwnerUser";
import AlertOwnerTeamService from "../../Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../Services/AlertOwnerUserService";
import DataAssetOwnerTeamService from "../../Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "../../Services/DataAssetOwnerUserService";
import DataStoreOwnerTeamService from "../../Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../Services/DataStoreOwnerUserService";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Gray500 } from "../../../Types/BrandColors";
import { getDataAssetFreshness } from "../../../Types/DataObservability/DataAssetFreshness";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import { DataCheckAttribute } from "../../../Types/DataObservability/DataCheckMetric";
import { DataObservabilityAttribute } from "../../../Types/DataObservability/DataObservabilityMetric";
import { DataPipelineAttribute } from "../../../Types/DataObservability/DataPipelineMetric";
import { JSONObject } from "../../../Types/JSON";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import ObjectID from "../../../Types/ObjectID";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import AlertFeedService from "../../Services/AlertFeedService";
import AlertGroupingEngineService from "../../Services/AlertGroupingEngineService";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import DataAlertService from "../../Services/DataAlertService";
import DataAssetLineageService from "../../Services/DataAssetLineageService";
import DataAssetService from "../../Services/DataAssetService";
import DataCheckService from "../../Services/DataCheckService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * ONE ISSUE PER CAUSE: A DATA ALERT WHOSE CAUSE IS ALREADY OPEN.
 *
 * When a table goes stale, every table built from it goes stale too, and
 * one alert per table would page people for each of them. So before a data
 * monitor opens an alert, what the alert is about is resolved (getSubject) -
 * a table, by its store's monitor and the table its series is, or by its
 * check; a pipeline; or a whole store that stopped reporting - and the open
 * data alerts on what that is built from are looked for, through lineage:
 * the tables it is built from, the pipelines that write them, and the stores
 * they live in, up to five steps up. The earliest open one is the cause.
 *
 * When there is one, the new alert is its consequence: it starts
 * acknowledged, so nobody is paged twice for one problem, it says so in its
 * feed, and it joins the cause's episode when the cause is in one. Every
 * data alert records what it is about and its cause (DataAlert), so the
 * cause's page lists its downstream impact.
 */

// The most people and teams one data alert takes from what it is about.
const MAX_OWNERS_PER_ALERT: number = 50;

// How far up lineage a cause is looked for.
export const MAX_CAUSE_DEPTH: number = 5;

// The most tables and pipelines upstream of one alert's subject that are read.
export const MAX_UPSTREAM_NODES: number = 500;

export interface DataAlertScope {
  dataStoreId: string | null;
  dataPipelineId: string | null;
  dataCheckId: string | null;
}

export interface DataAlertSubject {
  dataAssetId: ObjectID | null;
  dataPipelineId: ObjectID | null;
  dataStoreId: ObjectID | null;
}

interface Upstream {
  assetIds: Set<string>;
  pipelineIds: Set<string>;
  storeIds: Set<string>;
}

function readId(value: unknown): string | null {
  return typeof value === "string" && ObjectID.isValidUUID(value)
    ? value
    : null;
}

// What a data monitor's metric queries are scoped to; null for any other monitor.
// What a data monitor measures: the metric its query reads.
export function getDataAlertMetricName(
  monitorSteps: MonitorSteps | undefined | null,
): string | null {
  for (const step of monitorSteps?.data?.monitorStepsInstanceArray || []) {
    for (const query of step.data?.metricMonitor?.metricViewConfig
      ?.queryConfigs || []) {
      const name: unknown = query.metricQueryData?.filterData?.metricName;

      if (typeof name === "string" && name) {
        return name;
      }
    }
  }

  return null;
}

export function getDataAlertScope(
  monitorSteps: MonitorSteps | undefined | null,
): DataAlertScope | null {
  const steps: Array<MonitorStep> =
    monitorSteps?.data?.monitorStepsInstanceArray || [];

  for (const step of steps) {
    const queries: Array<MetricQueryConfigData> =
      step.data?.metricMonitor?.metricViewConfig?.queryConfigs || [];

    for (const query of queries) {
      const attributes: JSONObject = (query.metricQueryData?.filterData
        ?.attributes || {}) as JSONObject;
      const scope: DataAlertScope = {
        dataStoreId: readId(attributes[DataObservabilityAttribute.DataStoreId]),
        dataPipelineId: readId(attributes[DataPipelineAttribute.PipelineId]),
        dataCheckId: readId(attributes[DataCheckAttribute.CheckId]),
      };

      if (scope.dataStoreId || scope.dataPipelineId || scope.dataCheckId) {
        return scope;
      }
    }
  }

  return null;
}

// The table a series of a store's monitor is: its oneuptime.data.table.key.
export function getSeriesTableKey(
  seriesLabels: JSONObject | undefined | null,
): string | null {
  const key: unknown = seriesLabels?.[DataObservabilityAttribute.TableKey];

  return typeof key === "string" && key.trim() ? key.trim() : null;
}

/*
 * The feed line of an alert that started acknowledged, its cause open
 * upstream. The cause's title is placed as text (mdText): a table or check
 * name is the project's own words, and its Markdown stays words.
 *
 * A private cause is never named. Its owners alone may see it, and anyone
 * who may read this alert reads this line, so the line says only that a
 * private alert is the cause.
 */
export function describeConsequence(cause: {
  title: string;
  alertNumberWithPrefix: string | null;
  isPrivate: boolean;
}): string {
  if (cause.isPrivate) {
    return mdText`**Caused upstream.** A private alert is open on what this alert's table or pipeline is built from, so this alert started acknowledged: nobody is paged twice for one problem. It recovers on its own once its data does.`.toString();
  }

  const name: string = cause.alertNumberWithPrefix
    ? `${cause.alertNumberWithPrefix} ${cause.title}`
    : cause.title;

  return mdText`**Caused upstream.** Alert ${name} is open on what this alert's table or pipeline is built from, so this alert started acknowledged: nobody is paged twice for one problem. It recovers on its own once its data does.`.toString();
}

export default class DataAlertCause {
  // What a data monitor's new alert is about; null for any other monitor.
  public static async getSubject(data: {
    projectId: ObjectID;
    monitorSteps: MonitorSteps | undefined | null;
    seriesLabels: JSONObject | undefined | null;
  }): Promise<DataAlertSubject | null> {
    const scope: DataAlertScope | null = getDataAlertScope(data.monitorSteps);

    if (!scope) {
      return null;
    }

    if (scope.dataPipelineId) {
      return {
        dataAssetId: null,
        dataPipelineId: new ObjectID(scope.dataPipelineId),
        dataStoreId: null,
      };
    }

    if (scope.dataCheckId) {
      const check: DataCheck | null = await DataCheckService.findOneBy({
        query: { _id: scope.dataCheckId, projectId: data.projectId },
        select: { _id: true, dataAssetId: true, dataStoreId: true },
        props: { isRoot: true },
      });

      return check?.dataAssetId
        ? {
            dataAssetId: check.dataAssetId,
            dataPipelineId: null,
            dataStoreId: check.dataStoreId || null,
          }
        : null;
    }

    const dataStoreId: ObjectID = new ObjectID(scope.dataStoreId!);
    const tableKey: string | null = getSeriesTableKey(data.seriesLabels);

    // A store's monitor that is not split by table: the whole store.
    if (!tableKey) {
      return { dataAssetId: null, dataPipelineId: null, dataStoreId };
    }

    const asset: DataAsset | null = await DataAssetService.findOneBy({
      query: { projectId: data.projectId, dataStoreId, assetKey: tableKey },
      select: { _id: true },
      props: { isRoot: true },
    });

    return asset?.id
      ? { dataAssetId: asset.id, dataPipelineId: null, dataStoreId }
      : null;
  }

  // The open alert the subject's new alert is a consequence of, if any.
  public static async findCause(data: {
    projectId: ObjectID;
    subject: DataAlertSubject;
  }): Promise<Alert | null> {
    const upstream: Upstream = await this.readUpstream(
      data.projectId,
      data.subject,
    );

    if (
      upstream.assetIds.size === 0 &&
      upstream.pipelineIds.size === 0 &&
      upstream.storeIds.size === 0
    ) {
      return null;
    }

    const candidates: Set<string> = new Set();
    const queries: Array<JSONObject> = [];

    if (upstream.assetIds.size > 0) {
      queries.push({
        dataAssetId: QueryHelper.any(Array.from(upstream.assetIds)),
      });
    }

    if (upstream.pipelineIds.size > 0) {
      queries.push({
        dataPipelineId: QueryHelper.any(Array.from(upstream.pipelineIds)),
      });
    }

    if (upstream.storeIds.size > 0) {
      // A store that stopped reporting: every table in it went quiet with it.
      queries.push({
        dataStoreId: QueryHelper.any(Array.from(upstream.storeIds)),
        dataAssetId: QueryHelper.isNull(),
        dataPipelineId: QueryHelper.isNull(),
      });
    }

    for (const query of queries) {
      const rows: Array<DataAlert> = await DataAlertService.findBy({
        query: { projectId: data.projectId, ...query } as never,
        select: { alertId: true },
        sort: { createdAt: SortOrder.Descending },
        limit: 200,
        skip: 0,
        props: { isRoot: true },
      });

      for (const row of rows) {
        if (row.alertId) {
          candidates.add(row.alertId.toString());
        }
      }
    }

    if (candidates.size === 0) {
      return null;
    }

    // The earliest still open: the cause the others are consequences of.
    return await AlertService.findOneBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(Array.from(candidates)),
        currentAlertStateId: QueryHelper.any(
          await AlertStateService.getUnresolvedAlertStateIds(data.projectId),
        ),
      },
      select: {
        _id: true,
        title: true,
        alertNumberWithPrefix: true,
        alertEpisodeId: true,
        // A private cause is not named in its consequences' feeds.
        isPrivate: true,
      },
      sort: { createdAt: SortOrder.Ascending },
      props: { isRoot: true },
    });
  }

  // The project's acknowledged state, for an alert whose cause is open.
  public static async getAcknowledgedStateId(
    projectId: ObjectID,
  ): Promise<ObjectID | null> {
    return (
      (
        await AlertStateService.getAcknowledgedAlertState({
          projectId,
          props: { isRoot: true },
        })
      )?.id || null
    );
  }

  // What the new alert is about, and - with a cause - its place beside it.
  /*
   * A data alert goes to who owns what it is about: the table's owners, else
   * the database's. An owner the alert already has is left as it is, and one
   * that cannot be added never stops the alert.
   */
  private static async addOwners(data: {
    alert: Alert;
    subject: DataAlertSubject;
  }): Promise<void> {
    const alertId: ObjectID = data.alert.id!;
    const projectId: ObjectID = data.alert.projectId!;

    try {
      let userIds: Array<ObjectID> = [];
      let teamIds: Array<ObjectID> = [];

      if (data.subject.dataAssetId) {
        const query: { dataAssetId: ObjectID; projectId: ObjectID } = {
          dataAssetId: data.subject.dataAssetId,
          projectId,
        };

        userIds = (
          await DataAssetOwnerUserService.findBy({
            query,
            select: { userId: true },
            skip: 0,
            limit: MAX_OWNERS_PER_ALERT,
            props: { isRoot: true },
          })
        ).map((owner: DataAssetOwnerUser): ObjectID => {
          return owner.userId!;
        });
        teamIds = (
          await DataAssetOwnerTeamService.findBy({
            query,
            select: { teamId: true },
            skip: 0,
            limit: MAX_OWNERS_PER_ALERT,
            props: { isRoot: true },
          })
        ).map((owner: DataAssetOwnerTeam): ObjectID => {
          return owner.teamId!;
        });
      }

      if (
        userIds.length === 0 &&
        teamIds.length === 0 &&
        data.subject.dataStoreId
      ) {
        const query: { dataStoreId: ObjectID; projectId: ObjectID } = {
          dataStoreId: data.subject.dataStoreId,
          projectId,
        };

        userIds = (
          await DataStoreOwnerUserService.findBy({
            query,
            select: { userId: true },
            skip: 0,
            limit: MAX_OWNERS_PER_ALERT,
            props: { isRoot: true },
          })
        ).map((owner: DataStoreOwnerUser): ObjectID => {
          return owner.userId!;
        });
        teamIds = (
          await DataStoreOwnerTeamService.findBy({
            query,
            select: { teamId: true },
            skip: 0,
            limit: MAX_OWNERS_PER_ALERT,
            props: { isRoot: true },
          })
        ).map((owner: DataStoreOwnerTeam): ObjectID => {
          return owner.teamId!;
        });
      }

      for (const userId of userIds) {
        const owner: AlertOwnerUser = new AlertOwnerUser();
        owner.alertId = alertId;
        owner.projectId = projectId;
        owner.userId = userId;
        await AlertOwnerUserService.create({
          data: owner,
          props: { isRoot: true },
        }).catch((error: Error) => {
          logger.debug(`Data alert owner not added: ${error.message}`);
        });
      }

      for (const teamId of teamIds) {
        const owner: AlertOwnerTeam = new AlertOwnerTeam();
        owner.alertId = alertId;
        owner.projectId = projectId;
        owner.teamId = teamId;
        await AlertOwnerTeamService.create({
          data: owner,
          props: { isRoot: true },
        }).catch((error: Error) => {
          logger.debug(`Data alert owner not added: ${error.message}`);
        });
      }
    } catch (error) {
      logger.error(`Could not add a data alert's owners: ${error}`);
    }
  }

  public static async record(data: {
    alert: Alert;
    subject: DataAlertSubject;
    cause: Alert | null;
  }): Promise<void> {
    const row: DataAlert = new DataAlert();
    row.projectId = data.alert.projectId!;
    row.alertId = data.alert.id!;

    if (data.subject.dataAssetId) {
      row.dataAssetId = data.subject.dataAssetId;
    }

    if (data.subject.dataPipelineId) {
      row.dataPipelineId = data.subject.dataPipelineId;
    }

    if (data.subject.dataStoreId) {
      row.dataStoreId = data.subject.dataStoreId;
    }

    if (data.cause?.id) {
      row.causeAlertId = data.cause.id;
    }

    // How long after its update was due a late table's alert opened.
    if (data.subject.dataAssetId) {
      try {
        const asset: DataAsset | null = await DataAssetService.findOneById({
          id: data.subject.dataAssetId,
          select: {
            assetKind: true,
            lastChangedAt: true,
            updateIntervalInSeconds: true,
          },
          props: { isRoot: true },
        });
        const overdue: number = getDataAssetFreshness({
          kind: asset?.assetKind as DataAssetKind | undefined,
          lastChangedAt: asset?.lastChangedAt,
          updateIntervalInSeconds: asset?.updateIntervalInSeconds,
          now: new Date(),
        }).overdueBySeconds;

        if (overdue > 0) {
          row.detectedAfterInSeconds = overdue;
        }
      } catch (error) {
        // A measure of how quickly it was seen: never a reason to lose the alert's record.
        logger.debug(error);
      }
    }

    await DataAlertService.create({ data: row, props: { isRoot: true } });

    await this.addOwners(data);

    if (!data.cause?.id) {
      return;
    }

    await AlertFeedService.createAlertFeedItem({
      alertId: data.alert.id!,
      projectId: data.alert.projectId!,
      alertFeedEventType: AlertFeedEventType.RootCause,
      displayColor: Gray500,
      feedInfoInMarkdown: describeConsequence({
        title: data.cause.title || "",
        alertNumberWithPrefix: data.cause.alertNumberWithPrefix || null,
        isPrivate: Boolean(data.cause.isPrivate),
      }),
    });

    // The cause's episode holds its consequences, when it has one.
    if (data.cause.alertEpisodeId) {
      try {
        await AlertGroupingEngineService.addAlertToEpisodeManually(
          data.alert,
          data.cause.alertEpisodeId,
        );
      } catch (error) {
        // Already in an episode a grouping rule chose: it stays there.
        logger.debug(error);
      }
    }
  }

  /*
   * What the subject is built from, up to five steps up: the tables, the
   * pipelines that write them (and it), and the stores they live in.
   */
  private static async readUpstream(
    projectId: ObjectID,
    subject: DataAlertSubject,
  ): Promise<Upstream> {
    const upstream: Upstream = {
      assetIds: new Set(),
      pipelineIds: new Set(),
      storeIds: new Set(),
    };
    let frontier: Array<string> = [];

    if (subject.dataAssetId) {
      frontier = [subject.dataAssetId.toString()];

      if (subject.dataStoreId) {
        upstream.storeIds.add(subject.dataStoreId.toString());
      }
    } else if (subject.dataPipelineId) {
      // A pipeline is built from the tables it reads.
      const reads: Array<DataAssetLineage> =
        await DataAssetLineageService.findBy({
          query: {
            projectId,
            dataPipelineId: subject.dataPipelineId,
            upstreamDataAssetId: QueryHelper.notNull(),
          },
          select: { upstreamDataAssetId: true },
          limit: MAX_UPSTREAM_NODES,
          skip: 0,
          props: { isRoot: true },
        });

      for (const edge of reads) {
        const id: string = edge.upstreamDataAssetId!.toString();

        if (!upstream.assetIds.has(id)) {
          upstream.assetIds.add(id);
          frontier.push(id);
        }
      }
    } else {
      // A store that stopped reporting is a cause, never a consequence.
      return upstream;
    }

    const own: string | null = subject.dataAssetId?.toString() || null;

    for (
      let depth: number = 0;
      depth < MAX_CAUSE_DEPTH && frontier.length > 0;
      depth++
    ) {
      const edges: Array<DataAssetLineage> =
        await DataAssetLineageService.findBy({
          query: {
            projectId,
            downstreamDataAssetId: QueryHelper.any(frontier),
          },
          select: { upstreamDataAssetId: true, dataPipelineId: true },
          limit: MAX_UPSTREAM_NODES * 4,
          skip: 0,
          props: { isRoot: true },
        });
      const next: Array<string> = [];

      for (const edge of edges) {
        if (
          edge.dataPipelineId &&
          edge.dataPipelineId.toString() !== subject.dataPipelineId?.toString()
        ) {
          upstream.pipelineIds.add(edge.dataPipelineId.toString());
        }

        const id: string | undefined = edge.upstreamDataAssetId?.toString();

        if (id && id !== own && !upstream.assetIds.has(id)) {
          upstream.assetIds.add(id);
          next.push(id);
        }
      }

      if (
        upstream.assetIds.size + upstream.pipelineIds.size >=
        MAX_UPSTREAM_NODES
      ) {
        break;
      }

      frontier = next;
    }

    // The stores the upstream tables live in: one that stopped reporting is their cause.
    const ids: Array<string> = Array.from(upstream.assetIds);

    for (let start: number = 0; start < ids.length; start += 200) {
      const assets: Array<DataAsset> = await DataAssetService.findBy({
        query: {
          projectId,
          _id: QueryHelper.any(ids.slice(start, start + 200)),
        },
        select: { dataStoreId: true },
        limit: 200,
        skip: 0,
        props: { isRoot: true },
      });

      for (const asset of assets) {
        if (asset.dataStoreId) {
          upstream.storeIds.add(asset.dataStoreId.toString());
        }
      }
    }

    return upstream;
  }
}
