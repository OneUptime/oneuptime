import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataReconciliation from "../../../Models/DatabaseModels/DataReconciliation";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import { DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES } from "../../../Types/DataObservability/DataCheckType";
import {
  DataReconciliationMeasure,
  doesMeasureNeedColumn,
  getMeasureCheckType,
} from "../../../Types/DataObservability/DataReconciliation";
import BadDataException from "../../../Types/Exception/BadDataException";
import { buildDataReconciliationMonitorStep } from "../../../Types/Monitor/DataReconciliationMonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import AlertSeverityService from "../../Services/AlertSeverityService";
import DataCheckService from "../../Services/DataCheckService";
import DataReconciliationService from "../../Services/DataReconciliationService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import MonitorService from "../../Services/MonitorService";
import MonitorStatusService from "../../Services/MonitorStatusService";

/*
 * A RECONCILIATION'S TWO CHECKS AND ITS MONITOR, KEPT IN STEP WITH IT.
 *
 *  - Each side is read by a data check of its own on its table: Row Count,
 *    Sum, Distinct Count or Custom SQL, at the reconciliation's interval,
 *    with its store's collection - by OneUptime or the store's probe, with
 *    every engine's SQL and safeguards a check has. A check is made as the
 *    person who saved the reconciliation, so it is validated against its
 *    table's catalog and their permissions, and then belongs to the
 *    reconciliation (dataReconciliationId): nobody changes it but from here.
 *    A side moved to another table gets a new check.
 *  - The monitor: a Metrics monitor over oneuptime.data.reconciliation.
 *    drifted (DataReconciliationMonitorStep), made as the same person.
 *
 * Both checks are then run at their stores' next collections, so the two
 * values are read together and compared (DataReconciliationCompare).
 */

const MAX_NAME_LENGTH: number = 100;

interface ProjectSeed {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  incidentSeverityId: ObjectID;
  alertSeverityId: ObjectID;
}

type Side = "source" | "target";

export interface DataReconciliationSyncResult {
  sourceDataCheckId: string;
  targetDataCheckId: string;
  monitorId: string;
}

// A side's check's name: unique on its table, as a check's name must be.
export function getReconciliationCheckName(
  reconciliationName: string,
  side: Side,
): string {
  const suffix: string = side === "source" ? " - source" : " - target";

  return `${reconciliationName.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
}

export default class DataReconciliationSync {
  public static async sync(data: {
    projectId: ObjectID;
    reconciliationId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataReconciliationSyncResult> {
    const reconciliation: DataReconciliation | null =
      await DataReconciliationService.findOneBy({
        query: { _id: data.reconciliationId, projectId: data.projectId },
        select: {
          _id: true,
          name: true,
          intervalInMinutes: true,
          sourceDataAssetId: true,
          sourceMeasure: true,
          sourceColumnName: true,
          sourceCustomSql: true,
          sourceDataCheckId: true,
          targetDataAssetId: true,
          targetMeasure: true,
          targetColumnName: true,
          targetCustomSql: true,
          targetDataCheckId: true,
          monitorId: true,
        },
        props: { isRoot: true },
      });

    if (!reconciliation?.id) {
      throw new BadDataException("Reconciliation not found.");
    }

    const sourceCheckId: ObjectID = await this.syncSide({
      projectId: data.projectId,
      reconciliation,
      side: "source",
      props: data.props,
    });
    const targetCheckId: ObjectID = await this.syncSide({
      projectId: data.projectId,
      reconciliation,
      side: "target",
      props: data.props,
    });
    const monitorId: ObjectID = await this.syncMonitor({
      projectId: data.projectId,
      reconciliation,
      props: data.props,
    });

    // Both read at their stores' next collections: together.
    const now: Date = OneUptimeDate.getCurrentDate();

    for (const id of [sourceCheckId, targetCheckId]) {
      await DataCheckService.updateColumnsByIdWithoutHooks({
        id,
        data: { nextRunAt: now } as never,
      });
    }

    return {
      sourceDataCheckId: sourceCheckId.toString(),
      targetDataCheckId: targetCheckId.toString(),
      monitorId: monitorId.toString(),
    };
  }

  private static async syncSide(data: {
    projectId: ObjectID;
    reconciliation: DataReconciliation;
    side: Side;
    props: DatabaseCommonInteractionProps;
  }): Promise<ObjectID> {
    const { reconciliation, side } = data;
    const isSource: boolean = side === "source";
    const dataAssetId: ObjectID | undefined = isSource
      ? reconciliation.sourceDataAssetId
      : reconciliation.targetDataAssetId;
    const measure: DataReconciliationMeasure = (
      isSource ? reconciliation.sourceMeasure : reconciliation.targetMeasure
    ) as DataReconciliationMeasure;
    const columnName: string | undefined = isSource
      ? reconciliation.sourceColumnName
      : reconciliation.targetColumnName;
    const customSql: string | undefined = isSource
      ? reconciliation.sourceCustomSql
      : reconciliation.targetCustomSql;
    const checkId: ObjectID | undefined = isSource
      ? reconciliation.sourceDataCheckId
      : reconciliation.targetDataCheckId;

    if (!dataAssetId) {
      throw new BadDataException(`The reconciliation's ${side} needs a table.`);
    }

    const definition: Record<string, unknown> = {
      name: getReconciliationCheckName(reconciliation.name || "", side),
      checkType: getMeasureCheckType(measure),
      columnName: doesMeasureNeedColumn(measure) ? columnName || null : null,
      customSql:
        measure === DataReconciliationMeasure.CustomSql
          ? customSql || null
          : null,
      intervalInMinutes:
        reconciliation.intervalInMinutes ||
        DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
      isEnabled: true,
    };
    const live: DataCheck | null = checkId
      ? await DataCheckService.findOneBy({
          query: { _id: checkId, projectId: data.projectId },
          select: { _id: true, dataAssetId: true },
          props: { isRoot: true },
        })
      : null;

    // The same table: the check is changed, validated against it as any change is.
    if (live?.id && live.dataAssetId?.toString() === dataAssetId.toString()) {
      await DataCheckService.updateOneById({
        id: live.id,
        data: definition as never,
        props: { isRoot: true },
      });

      return live.id;
    }

    // Another table: the old side's check goes, and the new table gets one.
    if (live?.id) {
      await DataCheckService.deleteBy({
        query: { _id: live.id, projectId: data.projectId },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });
    }

    const check: DataCheck = new DataCheck();
    check.projectId = data.projectId;
    check.dataAssetId = dataAssetId;
    Object.assign(check, definition);

    const created: DataCheck = await DataCheckService.create({
      data: check,
      props: data.props,
    });

    await DataCheckService.updateColumnsByIdWithoutHooks({
      id: created.id!,
      data: { dataReconciliationId: reconciliation.id! } as never,
    });
    await DataReconciliationService.updateColumnsByIdWithoutHooks({
      id: reconciliation.id!,
      data: (isSource
        ? { sourceDataCheckId: created.id! }
        : { targetDataCheckId: created.id! }) as never,
    });

    return created.id!;
  }

  private static async syncMonitor(data: {
    projectId: ObjectID;
    reconciliation: DataReconciliation;
    props: DatabaseCommonInteractionProps;
  }): Promise<ObjectID> {
    const { reconciliation } = data;
    const seed: ProjectSeed = await this.readSeed(data.projectId);
    const name: string =
      `${reconciliation.name || "Reconciliation"} - Reconciliation`.slice(
        0,
        MAX_NAME_LENGTH,
      );
    const steps: MonitorSteps = new MonitorSteps();

    steps.data = {
      monitorStepsInstanceArray: [
        buildDataReconciliationMonitorStep({
          reconciliationId: reconciliation.id!.toString(),
          reconciliationName: reconciliation.name || "Reconciliation",
          intervalInMinutes:
            reconciliation.intervalInMinutes ||
            DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
          monitorName: name,
          onlineMonitorStatusId: seed.onlineMonitorStatusId,
          offlineMonitorStatusId: seed.offlineMonitorStatusId,
          defaultIncidentSeverityId: seed.incidentSeverityId,
          defaultAlertSeverityId: seed.alertSeverityId,
        }),
      ],
      defaultMonitorStatusId: seed.onlineMonitorStatusId,
    };

    const live: Monitor | null = reconciliation.monitorId
      ? await MonitorService.findOneBy({
          query: { _id: reconciliation.monitorId, projectId: data.projectId },
          select: { _id: true },
          props: { isRoot: true },
        })
      : null;

    // Unless someone deleted it on the Monitors page.
    if (live?.id) {
      await MonitorService.updateOneById({
        id: live.id,
        data: { name, monitorSteps: steps } as never,
        props: data.props,
      });

      return live.id;
    }

    const monitor: Monitor = new Monitor();
    monitor.projectId = data.projectId;
    monitor.name = name;
    monitor.description = `Alerts when the two tables of the reconciliation "${reconciliation.name || ""}" drift beyond its tolerance, from Data Observability.`;
    monitor.monitorType = MonitorType.Metrics;
    monitor.monitorSteps = steps;

    const created: Monitor = await MonitorService.create({
      data: monitor,
      props: data.props,
    });

    await DataReconciliationService.updateColumnsByIdWithoutHooks({
      id: reconciliation.id!,
      data: { monitorId: created.id! } as never,
    });

    return created.id!;
  }

  private static async readSeed(projectId: ObjectID): Promise<ProjectSeed> {
    const byPriority: { priority: SortOrder; createdAt: SortOrder } = {
      priority: SortOrder.Ascending,
      createdAt: SortOrder.Ascending,
    };
    const online: MonitorStatus | null = await MonitorStatusService.findOneBy({
      query: { projectId, isOperationalState: true },
      select: { _id: true },
      sort: byPriority,
      props: { isRoot: true },
    });
    const offline: MonitorStatus | null = await MonitorStatusService.findOneBy({
      query: { projectId, isOfflineState: true },
      select: { _id: true },
      sort: byPriority,
      props: { isRoot: true },
    });
    const incidentSeverity: IncidentSeverity | null =
      await IncidentSeverityService.findOneBy({
        query: { projectId },
        select: { _id: true },
        sort: { order: SortOrder.Ascending },
        props: { isRoot: true },
      });
    const alertSeverity: AlertSeverity | null =
      await AlertSeverityService.findOneBy({
        query: { projectId },
        select: { _id: true },
        sort: { order: SortOrder.Ascending },
        props: { isRoot: true },
      });

    if (
      !online?.id ||
      !offline?.id ||
      !incidentSeverity?.id ||
      !alertSeverity?.id
    ) {
      throw new BadDataException(
        "This project is missing an operational or offline monitor status, or an incident or alert severity. Add them in Settings, then save the reconciliation again.",
      );
    }

    return {
      onlineMonitorStatusId: online.id,
      offlineMonitorStatusId: offline.id,
      incidentSeverityId: incidentSeverity.id,
      alertSeverityId: alertSeverity.id,
    };
  }
}
