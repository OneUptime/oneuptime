import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataReconciliation from "../../../Models/DatabaseModels/DataReconciliation";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import {
  DataCheckRunStatus,
  DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
} from "../../../Types/DataObservability/DataCheckType";
import {
  DATA_RECONCILIATION_METRICS,
  DataReconciliationAttribute,
  DataReconciliationMetricName,
  DataReconciliationOutcome,
  DataReconciliationSide,
  DataReconciliationToleranceType,
  isComparedOutcome,
  reconcileSides,
} from "../../../Types/DataObservability/DataReconciliation";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import DataCheckService from "../../Services/DataCheckService";
import DataReconciliationService from "../../Services/DataReconciliationService";
import MetricService from "../../Services/MetricService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import MonitorMetricUtil from "../Monitor/MonitorMetricUtil";
import TelemetryUtil from "../Telemetry/Telemetry";

/*
 * A RECONCILIATION'S TWO SIDES, COMPARED ONCE READ TOGETHER.
 *
 * As soon as a collection records a side's value (DataCheckIngest), and
 * every fifteen minutes for every reconciliation, the two sides' last
 * values are reconciled (reconcileSides): a failed side fails it, a side
 * not read yet or read too far from the other makes it wait, and two values
 * read together are compared - once per pair, written as the reconciliation
 * metrics its monitor reads. After each comparison, and whenever the two
 * were read too far apart, both checks are set to run at the same time, so
 * their next values are read together.
 */

const RECONCILIATIONS_PER_PAGE: number = 200;
const MAX_RECONCILIATIONS_PER_RUN: number = 20_000;

const RECONCILIATION_SELECT: Record<string, true> = {
  _id: true,
  projectId: true,
  name: true,
  intervalInMinutes: true,
  toleranceType: true,
  tolerance: true,
  sourceDataCheckId: true,
  targetDataCheckId: true,
  status: true,
  statusMessage: true,
  comparedAt: true,
};

function readSide(check: DataCheck | undefined): DataReconciliationSide {
  if (!check) {
    return {
      value: null,
      readAt: null,
      failed: true,
      message:
        "its check was deleted. Save the reconciliation to make it again.",
    };
  }

  return {
    value:
      check.lastValue === undefined || check.lastValue === null
        ? null
        : Number(check.lastValue),
    readAt: check.lastRunAt ? new Date(check.lastRunAt) : null,
    failed: check.lastRunStatus === DataCheckRunStatus.Failed,
    message: check.lastRunMessage || null,
  };
}

export function buildReconciliationMetricRow(data: {
  projectId: ObjectID;
  reconciliationId: ObjectID;
  reconciliationName: string;
  metricName: DataReconciliationMetricName;
  value: number;
  at: Date;
  retentionDays: number;
}): JSONObject {
  const time: string = OneUptimeDate.toClickhouseDateTime(data.at);
  const attributes: JSONObject = {
    [DataReconciliationAttribute.ReconciliationId]:
      data.reconciliationId.toString(),
    [DataReconciliationAttribute.ReconciliationName]: data.reconciliationName,
  };

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: time,
    projectId: data.projectId.toString(),
    primaryEntityId: data.reconciliationId.toString(),
    primaryEntityType: ServiceType.DataReconciliation,
    name: data.metricName,
    aggregationTemporality: null,
    metricPointType: MetricPointType.Gauge,
    time: time,
    startTime: null,
    timeUnixNano: OneUptimeDate.toUnixNano(data.at).toString(),
    startTimeUnixNano: null,
    attributes: attributes,
    attributeKeys: TelemetryUtil.getAttributeKeys(attributes),
    isMonotonic: null,
    count: null,
    sum: null,
    min: null,
    max: null,
    bucketCounts: [],
    explicitBounds: [],
    value: data.value,
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(data.at, data.retentionDays),
    ),
  } as JSONObject;
}

export default class DataReconciliationCompare {
  // The reconciliations a collection's checks read sides of, right away.
  public static async compareForReconciliations(
    reconciliationIds: Array<ObjectID>,
    now: Date,
  ): Promise<void> {
    if (reconciliationIds.length === 0) {
      return;
    }

    const reconciliations: Array<DataReconciliation> =
      await DataReconciliationService.findBy({
        query: { _id: QueryHelper.any(reconciliationIds) },
        select: RECONCILIATION_SELECT,
        limit: reconciliationIds.length,
        skip: 0,
        props: { isRoot: true },
      });

    await this.compareMany(reconciliations, now);
  }

  // Every reconciliation: the sweep that notices a side that stopped being read.
  public static async compareAll(now: Date): Promise<number> {
    let compared: number = 0;

    for (
      let skip: number = 0;
      skip < MAX_RECONCILIATIONS_PER_RUN;
      skip += RECONCILIATIONS_PER_PAGE
    ) {
      const reconciliations: Array<DataReconciliation> =
        await DataReconciliationService.findBy({
          query: {},
          select: RECONCILIATION_SELECT,
          sort: { createdAt: SortOrder.Ascending },
          skip,
          limit: RECONCILIATIONS_PER_PAGE,
          props: { isRoot: true },
        });

      compared += await this.compareMany(reconciliations, now);

      if (reconciliations.length < RECONCILIATIONS_PER_PAGE) {
        break;
      }
    }

    return compared;
  }

  private static async compareMany(
    reconciliations: Array<DataReconciliation>,
    now: Date,
  ): Promise<number> {
    if (reconciliations.length === 0) {
      return 0;
    }

    const checkIds: Array<ObjectID> = reconciliations.flatMap(
      (reconciliation: DataReconciliation): Array<ObjectID> => {
        return [
          reconciliation.sourceDataCheckId,
          reconciliation.targetDataCheckId,
        ].filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        });
      },
    );
    const checks: Array<DataCheck> =
      checkIds.length > 0
        ? await DataCheckService.findBy({
            query: { _id: QueryHelper.any(checkIds) },
            select: {
              _id: true,
              lastValue: true,
              lastRunAt: true,
              lastRunStatus: true,
              lastRunMessage: true,
              nextRunAt: true,
            },
            limit: checkIds.length,
            skip: 0,
            props: { isRoot: true },
          })
        : [];
    const checkById: Map<string, DataCheck> = new Map(
      checks.map((check: DataCheck): [string, DataCheck] => {
        return [check.id!.toString(), check];
      }),
    );
    const retentionDays: number = await MonitorMetricUtil.getRetentionDays();
    const rowsByProject: Map<string, Array<JSONObject>> = new Map();
    let compared: number = 0;

    for (const reconciliation of reconciliations) {
      try {
        const rows: Array<JSONObject> = await this.compareOne({
          reconciliation,
          source: checkById.get(
            reconciliation.sourceDataCheckId?.toString() || "",
          ),
          target: checkById.get(
            reconciliation.targetDataCheckId?.toString() || "",
          ),
          now,
          retentionDays,
        });
        const projectRows: Array<JSONObject> =
          rowsByProject.get(reconciliation.projectId!.toString()) || [];

        projectRows.push(...rows);
        rowsByProject.set(reconciliation.projectId!.toString(), projectRows);
        compared++;
      } catch (error) {
        logger.error(
          `Data Observability: could not compare reconciliation ${reconciliation.id?.toString()}`,
        );
        logger.error(error);
      }
    }

    for (const [projectId, rows] of rowsByProject) {
      await this.writeMetricRows(new ObjectID(projectId), rows);
    }

    return compared;
  }

  private static async compareOne(data: {
    reconciliation: DataReconciliation;
    source: DataCheck | undefined;
    target: DataCheck | undefined;
    now: Date;
    retentionDays: number;
  }): Promise<Array<JSONObject>> {
    const { reconciliation, now } = data;

    // Not set up yet: its first save makes its checks.
    if (
      !reconciliation.id ||
      !reconciliation.projectId ||
      (!reconciliation.sourceDataCheckId && !reconciliation.targetDataCheckId)
    ) {
      return [];
    }

    const outcome: DataReconciliationOutcome = reconcileSides({
      source: readSide(data.source),
      target: readSide(data.target),
      toleranceType:
        (reconciliation.toleranceType as DataReconciliationToleranceType) ||
        DataReconciliationToleranceType.Absolute,
      tolerance: Number(reconciliation.tolerance) || 0,
    });
    const intervalInMinutes: number =
      reconciliation.intervalInMinutes ||
      DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES;
    const statusChanged: boolean = reconciliation.status !== outcome.status;

    if (!isComparedOutcome(outcome)) {
      if (statusChanged || reconciliation.statusMessage !== outcome.message) {
        await DataReconciliationService.updateColumnsByIdWithoutHooks({
          id: reconciliation.id,
          data: {
            status: outcome.status,
            statusMessage: outcome.message,
            ...(statusChanged ? { statusChangedAt: now } : {}),
          } as never,
        });
      }

      // Read too far apart: both run at the later of their next runs, together.
      if (data.source?.id && data.target?.id) {
        const nextRuns: Array<number> = [data.source, data.target]
          .map((check: DataCheck): number => {
            return check.nextRunAt ? new Date(check.nextRunAt).getTime() : 0;
          })
          .filter((time: number) => {
            return time > 0;
          });

        if (nextRuns.length === 2 && nextRuns[0] !== nextRuns[1]) {
          await this.runBothAt(
            [data.source.id, data.target.id],
            new Date(Math.max(...nextRuns)),
          );
        }
      }

      return [];
    }

    // A pair already compared: nothing new.
    if (
      reconciliation.comparedAt &&
      new Date(reconciliation.comparedAt).getTime() >=
        outcome.comparedAt.getTime()
    ) {
      return [];
    }

    await DataReconciliationService.updateColumnsByIdWithoutHooks({
      id: reconciliation.id,
      data: {
        status: outcome.status,
        statusMessage: null,
        sourceValue: readSide(data.source).value,
        targetValue: readSide(data.target).value,
        difference: outcome.comparison.difference,
        differencePercent: outcome.comparison.differencePercent,
        comparedAt: outcome.comparedAt,
        ...(statusChanged ? { statusChangedAt: now } : {}),
      } as never,
    });

    // The next pair is read together too.
    await this.runBothAt(
      [data.source!.id!, data.target!.id!],
      OneUptimeDate.addRemoveMinutes(outcome.comparedAt, intervalInMinutes),
    );

    const base: {
      projectId: ObjectID;
      reconciliationId: ObjectID;
      reconciliationName: string;
      at: Date;
      retentionDays: number;
    } = {
      projectId: reconciliation.projectId,
      reconciliationId: reconciliation.id,
      reconciliationName: reconciliation.name || "",
      at: outcome.comparedAt,
      retentionDays: data.retentionDays,
    };

    return [
      buildReconciliationMetricRow({
        ...base,
        metricName: DataReconciliationMetricName.Drifted,
        value: outcome.comparison.isDrifted ? 1 : 0,
      }),
      buildReconciliationMetricRow({
        ...base,
        metricName: DataReconciliationMetricName.Difference,
        value: outcome.comparison.difference,
      }),
      buildReconciliationMetricRow({
        ...base,
        metricName: DataReconciliationMetricName.DifferencePercent,
        value: outcome.comparison.differencePercent,
      }),
    ];
  }

  private static async runBothAt(
    checkIds: Array<ObjectID>,
    at: Date,
  ): Promise<void> {
    for (const id of checkIds) {
      await DataCheckService.updateColumnsByIdWithoutHooks({
        id,
        data: { nextRunAt: at } as never,
      });
    }
  }

  private static async writeMetricRows(
    projectId: ObjectID,
    rows: Array<JSONObject>,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await MetricService.insertJsonRows(rows);

    const metricTypes: Dictionary<MetricType> = {};

    for (const definition of DATA_RECONCILIATION_METRICS) {
      const metricType: MetricType = new MetricType();
      metricType.name = definition.name;
      metricType.description = definition.description;
      metricType.unit = definition.unit;
      metricTypes[definition.name] = metricType;
    }

    TelemetryUtil.indexMetricNameServiceNameMap({
      projectId,
      metricNameServiceNameMap: metricTypes,
    }).catch((error: Error) => {
      logger.error(error);
    });
  }
}
