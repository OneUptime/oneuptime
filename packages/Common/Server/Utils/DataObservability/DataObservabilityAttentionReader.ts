import Alert from "../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DataProduct from "../../../Models/DatabaseModels/DataProduct";
import DataReconciliation from "../../../Models/DatabaseModels/DataReconciliation";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import {
  DataAttentionAlert,
  DataAttentionItem,
  DataAttentionKind,
  DataCheckHealth,
  DataCheckHealthAnswer,
  getDataCheckHealth,
  sortDataAttentionItems,
} from "../../../Types/DataObservability/DataObservabilityAttention";
import {
  DataObservabilityOverviewAsset,
  DataObservabilityStoreSummary,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { DataCheckType } from "../../../Types/DataObservability/DataCheckType";
import {
  DataPipelineLateness,
  DataPipelineTimeliness,
  MAX_LATENESS_WATCH_IN_SECONDS,
  getDataPipelineLateness,
} from "../../../Types/DataObservability/DataPipelineSchedule";
import { DataProductStatus } from "../../../Types/DataObservability/DataProductFreshness";
import { DataReconciliationStatus } from "../../../Types/DataObservability/DataReconciliation";
import { DATA_STORE_ID_SCOPE_ATTRIBUTE } from "../../../Types/Monitor/DataObservabilityAlertTemplates";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import DataAlertService from "../../Services/DataAlertService";
import DataAssetOwnerRuleService from "../../Services/DataAssetOwnerRuleService";
import DataAssetOwnerTeamService from "../../Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "../../Services/DataAssetOwnerUserService";
import DataCheckService from "../../Services/DataCheckService";
import DataPipelineService from "../../Services/DataPipelineService";
import DataProductService from "../../Services/DataProductService";
import DataReconciliationService from "../../Services/DataReconciliationService";
import MonitorService from "../../Services/MonitorService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { applyAlertSelfPrivacyFilter } from "../Alert/AlertPrivacyFilter";
import logger from "../Logger";
import { DataAlertScope, getDataAlertScope } from "./DataAlertCause";
import { isFailedState } from "./OpenLineageIngest";

/*
 * WHAT NEEDS SOMEONE, READ FOR THE OVERVIEW (DataObservabilityAttention).
 *
 * Every source is read as OneUptime, as the rest of the Overview is, and
 * hands back only names, states and times. The alerts are the exception:
 * an alert is named only when its reader may see it - a private alert is
 * seen by its owners and the project's owners and admins alone
 * (Utils/Alert/AlertPrivacyFilter) - so a check whose only open alert is
 * private to others is not called failing to them.
 *
 * Each source is extra to the others: one that cannot be read is left out,
 * and logged, and the Overview still says what the rest found.
 */

// The most of each record one Overview reads: far more than a project watches.
export const MAX_ATTENTION_RECORDS_READ: number = 5_000;

// The most open alerts one Overview names.
const MAX_ALERTS_READ: number = 2_000;

export interface DataObservabilityAttention {
  // Every item, worst first.
  items: Array<DataAttentionItem>;
  failingCheckCount: number;
  // Checks a person made (a reconciliation's own two are not counted), and pipelines seen.
  checkCount: number;
  pipelineCount: number;
}

function toIso(value: Date | string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const date: Date = OneUptimeDate.fromString(value);

  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function emptyItem(kind: DataAttentionKind, name: string): DataAttentionItem {
  return {
    kind,
    name,
    where: null,
    message: null,
    overdueBySeconds: 0,
    since: null,
    dataStoreId: null,
    dataAssetId: null,
    dataPipelineId: null,
    dataCheckId: null,
    dataProductId: null,
    dataReconciliationId: null,
    alert: null,
  };
}

function toAttentionAlert(alert: Alert): DataAttentionAlert {
  return {
    alertId: alert.id!.toString(),
    number: alert.alertNumberWithPrefix || null,
    title: alert.title || "",
  };
}

// A source that cannot be read is left out of the answer, never the reason it fails.
async function readOrNothing<T>(
  what: string,
  read: () => Promise<Array<T>>,
): Promise<Array<T>> {
  try {
    return await read();
  } catch (error) {
    logger.error(`Data Observability: could not read ${what}: ${error}`);
    return [];
  }
}

export default class DataObservabilityAttentionReader {
  public static async read(data: {
    projectId: ObjectID;
    now: Date;
    // Whoever asked: the alerts they may see are the ones named.
    reader: DatabaseCommonInteractionProps;
    stores: Array<DataObservabilityStoreSummary>;
    // Every late table, as the Overview found them.
    lateAssets: Array<DataObservabilityOverviewAsset>;
  }): Promise<DataObservabilityAttention> {
    const items: Array<DataAttentionItem> = [];

    for (const store of data.stores) {
      if (store.isTableHealthEnabled && store.status === "Failed") {
        items.push({
          ...emptyItem(DataAttentionKind.CollectionFailed, store.name),
          where: store.kind || null,
          message: store.message,
          since: store.collectedAt,
          dataStoreId: store.dataStoreId,
        });
      }
    }

    for (const asset of data.lateAssets) {
      items.push({
        ...emptyItem(DataAttentionKind.TableLate, asset.assetKey),
        where: asset.dataStoreName || null,
        overdueBySeconds: asset.overdueBySeconds,
        since: asset.lastChangedAt,
        dataAssetId: asset.dataAssetId,
        dataStoreId: asset.dataStoreId || null,
      });
    }

    const pipelines: Array<DataPipeline> = await readOrNothing(
      "pipelines",
      async () => {
        return await DataPipelineService.findBy({
          query: { projectId: data.projectId },
          select: {
            _id: true,
            jobName: true,
            jobNamespace: true,
            lastRunState: true,
            lastRunStartedAt: true,
            lastRunEndedAt: true,
            lastFailureAt: true,
            lastErrorMessage: true,
            expectedRunIntervalInSeconds: true,
          },
          skip: 0,
          limit: MAX_ATTENTION_RECORDS_READ,
          props: { isRoot: true },
        });
      },
    );

    items.push(...this.getPipelineItems(pipelines, data.now));

    const checks: Array<DataCheck> = await readOrNothing("checks", async () => {
      return await DataCheckService.findBy({
        // A reconciliation's two checks are told of as the reconciliation.
        query: {
          projectId: data.projectId,
          dataReconciliationId: QueryHelper.isNull(),
        },
        select: {
          _id: true,
          name: true,
          checkType: true,
          dataAssetId: true,
          dataAsset: { assetKey: true },
          isEnabled: true,
          lastRunAt: true,
          lastRunStatus: true,
          lastRunMessage: true,
          monitorId: true,
        },
        skip: 0,
        limit: MAX_ATTENTION_RECORDS_READ,
        props: { isRoot: true },
      });
    });

    const checkHealth: Map<string, DataCheckHealthAnswer> =
      await this.getCheckHealth({
        projectId: data.projectId,
        reader: data.reader,
        checks,
      });
    let failingCheckCount: number = 0;

    for (const check of checks) {
      const answer: DataCheckHealthAnswer | undefined = checkHealth.get(
        check.id?.toString() || "",
      );

      if (!answer) {
        continue;
      }

      if (answer.health === DataCheckHealth.Failing) {
        failingCheckCount++;
      }

      if (
        answer.health === DataCheckHealth.Failing ||
        answer.health === DataCheckHealth.CouldNotRun
      ) {
        items.push({
          ...emptyItem(
            answer.health === DataCheckHealth.Failing
              ? DataAttentionKind.CheckFailing
              : DataAttentionKind.CheckCouldNotRun,
            check.name || "",
          ),
          where: check.dataAsset?.assetKey || null,
          message: check.lastRunMessage || null,
          since: toIso(check.lastRunAt),
          dataCheckId: check.id!.toString(),
          dataAssetId: check.dataAssetId?.toString() || null,
          alert: answer.alert,
        });
      }
    }

    const products: Array<DataProduct> = await readOrNothing(
      "data products",
      async () => {
        return await DataProductService.findBy({
          query: { projectId: data.projectId, status: DataProductStatus.Late },
          select: {
            _id: true,
            name: true,
            lateTableCount: true,
            statusChangedAt: true,
          },
          skip: 0,
          limit: MAX_ATTENTION_RECORDS_READ,
          props: { isRoot: true },
        });
      },
    );

    for (const product of products) {
      items.push({
        ...emptyItem(DataAttentionKind.DataProductLate, product.name || ""),
        since: toIso(product.statusChangedAt),
        dataProductId: product.id!.toString(),
      });
    }

    const reconciliations: Array<DataReconciliation> = await readOrNothing(
      "reconciliations",
      async () => {
        return await DataReconciliationService.findBy({
          query: {
            projectId: data.projectId,
            status: new Includes([
              DataReconciliationStatus.Drifted,
              DataReconciliationStatus.Failed,
            ]),
          },
          select: {
            _id: true,
            name: true,
            status: true,
            statusMessage: true,
            statusChangedAt: true,
          },
          skip: 0,
          limit: MAX_ATTENTION_RECORDS_READ,
          props: { isRoot: true },
        });
      },
    );

    for (const reconciliation of reconciliations) {
      items.push({
        ...emptyItem(
          reconciliation.status === DataReconciliationStatus.Drifted
            ? DataAttentionKind.ReconciliationDrifted
            : DataAttentionKind.ReconciliationCouldNotRun,
          reconciliation.name || "",
        ),
        message: reconciliation.statusMessage || null,
        since: toIso(reconciliation.statusChangedAt),
        dataReconciliationId: reconciliation.id!.toString(),
      });
    }

    await this.addOpenAlerts({
      projectId: data.projectId,
      reader: data.reader,
      items,
    });

    return {
      items: sortDataAttentionItems(items),
      failingCheckCount,
      checkCount: checks.filter((check: DataCheck) => {
        return check.checkType !== DataCheckType.DbtTest;
      }).length,
      pipelineCount: pipelines.length,
    };
  }

  // A pipeline whose last run failed, or that has not started when it usually has.
  public static getPipelineItems(
    pipelines: Array<DataPipeline>,
    now: Date,
  ): Array<DataAttentionItem> {
    const items: Array<DataAttentionItem> = [];

    for (const pipeline of pipelines) {
      if (!pipeline.id) {
        continue;
      }

      const name: string = pipeline.jobName || pipeline.jobNamespace || "";
      const where: string | null =
        pipeline.jobName && pipeline.jobNamespace
          ? pipeline.jobNamespace
          : null;
      const startedAt: Date | null = pipeline.lastRunStartedAt
        ? OneUptimeDate.fromString(pipeline.lastRunStartedAt)
        : null;

      if (isFailedState(pipeline.lastRunState)) {
        // A pipeline nobody has run for a month is retired, as lateness is: no longer told of.
        if (
          startedAt &&
          now.getTime() - startedAt.getTime() >
            MAX_LATENESS_WATCH_IN_SECONDS * 1000
        ) {
          continue;
        }

        items.push({
          ...emptyItem(DataAttentionKind.PipelineFailed, name),
          where,
          message: pipeline.lastErrorMessage || null,
          since: toIso(
            pipeline.lastFailureAt ||
              pipeline.lastRunEndedAt ||
              pipeline.lastRunStartedAt,
          ),
          dataPipelineId: pipeline.id.toString(),
        });
        continue;
      }

      const lateness: DataPipelineLateness = getDataPipelineLateness({
        lastRunStartedAt: startedAt,
        expectedRunIntervalInSeconds: pipeline.expectedRunIntervalInSeconds,
        now,
      });

      if (lateness.timeliness === DataPipelineTimeliness.Late) {
        items.push({
          ...emptyItem(DataAttentionKind.PipelineLate, name),
          where,
          overdueBySeconds: lateness.overdueBySeconds,
          since: toIso(lateness.lateAt),
          dataPipelineId: pipeline.id.toString(),
        });
      }
    }

    return items;
  }

  /*
   * How each check stands now: failing when an alert of its monitor is open
   * that the reader may see, else as its last run went.
   */
  public static async getCheckHealth(data: {
    projectId: ObjectID;
    reader: DatabaseCommonInteractionProps;
    checks: Array<DataCheck>;
  }): Promise<Map<string, DataCheckHealthAnswer>> {
    const monitorIds: Array<string> = Array.from(
      new Set(
        data.checks
          .map((check: DataCheck): string => {
            return check.monitorId?.toString() || "";
          })
          .filter(Boolean),
      ),
    );
    const openByMonitor: Map<string, Alert> = new Map();

    if (monitorIds.length > 0) {
      const alerts: Array<Alert> = await readOrNothing(
        "the open alerts of checks",
        async () => {
          return await AlertService.findBy({
            query: applyAlertSelfPrivacyFilter(
              {
                projectId: data.projectId,
                monitorId: QueryHelper.any(monitorIds),
                currentAlertStateId: QueryHelper.any(
                  await AlertStateService.getUnresolvedAlertStateIds(
                    data.projectId,
                  ),
                ),
              },
              this.getPrivacyReader(data.reader),
            ),
            select: {
              _id: true,
              title: true,
              alertNumberWithPrefix: true,
              monitorId: true,
            },
            // The oldest open one first: what was told of first.
            sort: { createdAt: SortOrder.Ascending },
            skip: 0,
            limit: MAX_ALERTS_READ,
            props: { isRoot: true },
          });
        },
      );

      for (const alert of alerts) {
        const monitorId: string = alert.monitorId?.toString() || "";

        if (alert.id && monitorId && !openByMonitor.has(monitorId)) {
          openByMonitor.set(monitorId, alert);
        }
      }
    }

    const answers: Map<string, DataCheckHealthAnswer> = new Map();

    for (const check of data.checks) {
      if (!check.id) {
        continue;
      }

      const open: Alert | undefined = check.monitorId
        ? openByMonitor.get(check.monitorId.toString())
        : undefined;

      answers.set(check.id.toString(), {
        health: getDataCheckHealth({
          isEnabled: check.isEnabled,
          lastRunAt: check.lastRunAt,
          lastRunStatus: check.lastRunStatus,
          isDbtTest: check.checkType === DataCheckType.DbtTest,
          hasAlert: Boolean(check.monitorId),
          hasOpenAlert: Boolean(open),
        }),
        alert: open ? toAttentionAlert(open) : null,
      });
    }

    return answers;
  }

  /*
   * The open alert about each table, pipeline and database told of, as the
   * data alerts record what each alert is about (DataAlert): a table's
   * alert, whether from its database's monitors or a check of it; a
   * pipeline's; a database's own. Only one its reader may see.
   */
  public static async addOpenAlerts(data: {
    projectId: ObjectID;
    reader: DatabaseCommonInteractionProps;
    items: Array<DataAttentionItem>;
  }): Promise<void> {
    const wanted: Array<DataAttentionItem> = data.items.filter(
      (item: DataAttentionItem): boolean => {
        return (
          !item.alert &&
          (item.kind === DataAttentionKind.TableLate ||
            item.kind === DataAttentionKind.PipelineFailed ||
            item.kind === DataAttentionKind.PipelineLate ||
            item.kind === DataAttentionKind.CollectionFailed)
        );
      },
    );

    if (wanted.length === 0) {
      return;
    }

    const assetIds: Array<string> = [];
    const pipelineIds: Array<string> = [];
    const storeIds: Array<string> = [];

    for (const item of wanted) {
      if (item.kind === DataAttentionKind.TableLate && item.dataAssetId) {
        assetIds.push(item.dataAssetId);
      } else if (item.dataPipelineId) {
        pipelineIds.push(item.dataPipelineId);
      } else if (item.dataStoreId) {
        storeIds.push(item.dataStoreId);
      }
    }

    const subjects: Array<Query<DataAlert>> = [];

    if (assetIds.length > 0) {
      subjects.push({ dataAssetId: QueryHelper.any(assetIds) });
    }

    if (pipelineIds.length > 0) {
      subjects.push({ dataPipelineId: QueryHelper.any(pipelineIds) });
    }

    // A database's own alert: not one about a table of it.
    if (storeIds.length > 0) {
      subjects.push({
        dataStoreId: QueryHelper.any(storeIds),
        dataAssetId: QueryHelper.isNull(),
      });
    }

    const rows: Array<DataAlert> = [];

    for (const subject of subjects) {
      rows.push(
        ...(await readOrNothing("data alerts", async () => {
          return await DataAlertService.findBy({
            query: { projectId: data.projectId, ...subject },
            select: {
              alertId: true,
              dataAssetId: true,
              dataPipelineId: true,
              dataStoreId: true,
            },
            sort: { createdAt: SortOrder.Descending },
            skip: 0,
            limit: MAX_ALERTS_READ,
            props: { isRoot: true },
          });
        })),
      );
    }

    const alertIds: Array<string> = Array.from(
      new Set(
        rows
          .map((row: DataAlert): string => {
            return row.alertId?.toString() || "";
          })
          .filter(Boolean),
      ),
    );

    if (alertIds.length === 0) {
      return;
    }

    const open: Array<Alert> = await readOrNothing("open alerts", async () => {
      return await AlertService.findBy({
        query: applyAlertSelfPrivacyFilter(
          {
            projectId: data.projectId,
            _id: QueryHelper.any(alertIds),
            currentAlertStateId: QueryHelper.any(
              await AlertStateService.getUnresolvedAlertStateIds(
                data.projectId,
              ),
            ),
          },
          this.getPrivacyReader(data.reader),
        ),
        select: { _id: true, title: true, alertNumberWithPrefix: true },
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: alertIds.length,
        props: { isRoot: true },
      });
    });
    const openById: Map<string, Alert> = new Map();

    for (const alert of open) {
      if (alert.id) {
        openById.set(alert.id.toString(), alert);
      }
    }

    // The oldest open alert about each subject: what was told of first.
    const bySubject: Map<string, Alert> = new Map();

    for (const row of [...rows].reverse()) {
      const alert: Alert | undefined = openById.get(
        row.alertId?.toString() || "",
      );

      if (!alert) {
        continue;
      }

      for (const key of [
        row.dataAssetId ? `asset:${row.dataAssetId.toString()}` : "",
        row.dataPipelineId ? `pipeline:${row.dataPipelineId.toString()}` : "",
        row.dataStoreId && !row.dataAssetId
          ? `store:${row.dataStoreId.toString()}`
          : "",
      ]) {
        if (key && !bySubject.has(key)) {
          bySubject.set(key, alert);
        }
      }
    }

    for (const item of wanted) {
      const key: string =
        item.kind === DataAttentionKind.TableLate
          ? `asset:${item.dataAssetId}`
          : item.dataPipelineId
            ? `pipeline:${item.dataPipelineId}`
            : `store:${item.dataStoreId}`;
      const alert: Alert | undefined = bySubject.get(key);

      if (alert) {
        item.alert = toAttentionAlert(alert);
      }
    }
  }

  /*
   * How many monitors each database has on, scoped to the whole database
   * (its recommended alerts, or ones made like them) - not a check's or a
   * pipeline's. The steps are read only of the project's Metrics monitors
   * that name a database at all.
   */
  public static async getAlertMonitorCountByStore(
    projectId: ObjectID,
  ): Promise<Map<string, number>> {
    const counts: Map<string, number> = new Map();
    const monitors: Array<Monitor> = await readOrNothing(
      "the monitors of databases",
      async () => {
        return await MonitorService.findBy({
          query: {
            projectId,
            monitorType: MonitorType.Metrics,
            disableActiveMonitoring: false,
            monitorSteps: QueryHelper.textContainsAnyOf([
              DATA_STORE_ID_SCOPE_ATTRIBUTE,
            ]),
          },
          select: { _id: true, monitorSteps: true },
          skip: 0,
          limit: MAX_ATTENTION_RECORDS_READ,
          props: { isRoot: true },
        });
      },
    );

    for (const monitor of monitors) {
      const scope: DataAlertScope | null = getDataAlertScope(
        monitor.monitorSteps,
      );

      if (!scope?.dataStoreId || scope.dataCheckId || scope.dataPipelineId) {
        continue;
      }

      counts.set(scope.dataStoreId, (counts.get(scope.dataStoreId) || 0) + 1);
    }

    return counts;
  }

  // The owners named on tables, people and teams, and the project's owner rules.
  public static async getOwnerCounts(projectId: ObjectID): Promise<{
    tableOwnerCount: number;
    ownerRuleCount: number;
  }> {
    const count: (
      what: string,
      read: () => Promise<number>,
    ) => Promise<number> = async (
      what: string,
      read: () => Promise<number>,
    ): Promise<number> => {
      try {
        return await read();
      } catch (error) {
        logger.error(`Data Observability: could not count ${what}: ${error}`);
        return 0;
      }
    };

    const [users, teams, rules]: [number, number, number] = await Promise.all([
      count("table owners", async () => {
        return (
          await DataAssetOwnerUserService.countBy({
            query: { projectId },
            props: { isRoot: true },
          })
        ).toNumber();
      }),
      count("table owner teams", async () => {
        return (
          await DataAssetOwnerTeamService.countBy({
            query: { projectId },
            props: { isRoot: true },
          })
        ).toNumber();
      }),
      count("owner rules", async () => {
        return (
          await DataAssetOwnerRuleService.countBy({
            query: { projectId },
            props: { isRoot: true },
          })
        ).toNumber();
      }),
    ]);

    return { tableOwnerCount: users + teams, ownerRuleCount: rules };
  }

  /*
   * The reader whose privacy clause the alerts are read with: the person who
   * asked, or for a run of OneUptime's own, read as root, a reader who is no
   * one - the alerts that are not private (as DataTableAnswer reads them).
   */
  private static getPrivacyReader(
    reader: DatabaseCommonInteractionProps,
  ): DatabaseCommonInteractionProps {
    return reader && !reader.isRoot ? reader : {};
  }
}
