import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AlertMeasurementValue";
import AlertMeasurement from "../../Models/DatabaseModels/AlertMeasurement";
import AlertMeasurementService from "./AlertMeasurementService";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertService from "./AlertService";
import AlertStateTimeline from "../../Models/DatabaseModels/AlertStateTimeline";
import AlertStateTimelineService from "./AlertStateTimelineService";
import AlertMeasurementAnchorType from "../../Types/Alerts/AlertMeasurementAnchorType";
import AlertStateRole from "../../Types/Alerts/AlertStateRole";
import MeasurementEvaluator, {
  EvaluatedMeasurement,
  MeasurementAnchorSpec,
  MeasurementDefinitionSpec,
  MeasurementTimelineEntry,
} from "../../Utils/Measurement/MeasurementEvaluator";
import MeasurementMetricWriter, {
  MeasurementMetricPoint,
} from "../Utils/Measurement/MeasurementMetricWriter";
import MeasurementAnchorKind from "../../Types/Measurement/MeasurementAnchorKind";
import MeasurementOccurrence from "../../Types/Measurement/MeasurementOccurrence";
import MeasurementStatus from "../../Types/Measurement/MeasurementStatus";
import MetricResourceAttributeUtil from "../../Utils/Metrics/MetricResourceAttributeUtil";
import ServiceType from "../../Types/Telemetry/ServiceType";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";

/*
 * Every field the recompute writes, always fully populated.
 *
 * Typed non-optional on purpose: an absent part of a measurement is written
 * as NULL rather than omitted, so a value that stops being Recorded loses its
 * old number instead of keeping a stale one.
 */
interface ComputedValueFields {
  startedAt: Date;
  endedAt: Date;
  valueInSeconds: number;
  status: MeasurementStatus;
  statusMessage: string;
  startAlertStateTimelineId: ObjectID;
  endAlertStateTimelineId: ObjectID;
  computedAt: Date;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Recomputes every measurement for one alert from scratch.
   *
   * This is deliberately a total function of the alert's current data: it
   * reads the timeline and the definitions, and never reads its own previous
   * output. That is what makes a corrected timestamp, a deleted timeline row
   * or an edited definition converge without a repair path -- there is no
   * accumulated state to be wrong.
   */
  @CaptureSpan()
  public async recomputeForAlert(data: { alertId: ObjectID }): Promise<void> {
    const alert: Alert | null = await AlertService.findOneById({
      id: data.alertId,
      select: {
        _id: true,
        projectId: true,
        createdAt: true,
        impactStartedAt: true,
        labels: { _id: true, name: true, color: true },
        customFields: true,
        monitor: { _id: true, name: true },
        alertSeverity: { _id: true, name: true },
      },
      props: { isRoot: true },
    });

    if (!alert || !alert.projectId) {
      return;
    }

    const measurements: Array<AlertMeasurement> =
      await AlertMeasurementService.findBy({
        query: { projectId: alert.projectId },
        select: {
          _id: true,
          name: true,
          key: true,
          description: true,
          metricName: true,
          unit: true,
          isEnabled: true,
          startAnchorType: true,
          endAnchorType: true,
          startAlertStateId: true,
          endAlertStateId: true,
          startAlertStateRole: true,
          endAlertStateRole: true,
          startStateOccurrence: true,
          endStateOccurrence: true,
          startAlertState: { _id: true, name: true, order: true },
          endAlertState: { _id: true, name: true, order: true },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    if (measurements.length === 0) {
      return;
    }

    const timeline: Array<MeasurementTimelineEntry> = await this.loadTimeline(
      data.alertId,
    );

    const specs: Array<MeasurementDefinitionSpec> = measurements.map(
      (measurement: AlertMeasurement) => {
        return this.toSpec({ measurement: measurement, alert: alert });
      },
    );

    const evaluations: Array<EvaluatedMeasurement> =
      MeasurementEvaluator.evaluate({
        definitions: specs,
        timeline: timeline,
      });

    await this.persist({
      projectId: alert.projectId,
      alertId: data.alertId,
      evaluations: evaluations,
    });

    await this.emitMetrics({
      alert: alert,
      measurements: measurements,
      evaluations: evaluations,
    });
  }

  private async loadTimeline(
    alertId: ObjectID,
  ): Promise<Array<MeasurementTimelineEntry>> {
    const timelines: Array<AlertStateTimeline> =
      await AlertStateTimelineService.findBy({
        query: { alertId: alertId },
        select: {
          _id: true,
          alertStateId: true,
          startsAt: true,
          alertState: {
            _id: true,
            name: true,
            order: true,
            isCreatedState: true,
            isAcknowledgedState: true,
            isResolvedState: true,
          },
        },
        sort: { startsAt: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    return timelines
      .filter((timeline: AlertStateTimeline) => {
        return Boolean(timeline.startsAt);
      })
      .map((timeline: AlertStateTimeline) => {
        const roles: Array<string> = [];

        if (timeline.alertState?.isCreatedState) {
          roles.push(AlertStateRole.Created);
        }

        if (timeline.alertState?.isAcknowledgedState) {
          roles.push(AlertStateRole.Acknowledged);
        }

        if (timeline.alertState?.isResolvedState) {
          roles.push(AlertStateRole.Resolved);
        }

        return {
          id: timeline._id!.toString(),
          stateId: timeline.alertStateId!.toString(),
          stateName: timeline.alertState?.name,
          stateOrder: timeline.alertState?.order,
          stateRoles: roles,
          startsAt: timeline.startsAt!,
        };
      });
  }

  private toSpec(data: {
    measurement: AlertMeasurement;
    alert: Alert;
  }): MeasurementDefinitionSpec {
    const { measurement, alert } = data;

    return {
      id: measurement._id!.toString(),
      name: measurement.name || "",
      start: this.toAnchor({
        anchorType: measurement.startAnchorType,
        stateId: measurement.startAlertStateId,
        stateName: measurement.startAlertState?.name,
        stateOrder: measurement.startAlertState?.order,
        stateRole: measurement.startAlertStateRole,
        occurrence: measurement.startStateOccurrence,
        alert: alert,
      }),
      end: this.toAnchor({
        anchorType: measurement.endAnchorType,
        stateId: measurement.endAlertStateId,
        stateName: measurement.endAlertState?.name,
        stateOrder: measurement.endAlertState?.order,
        stateRole: measurement.endAlertStateRole,
        occurrence: measurement.endStateOccurrence,
        alert: alert,
      }),
    };
  }

  private toAnchor(data: {
    anchorType?: AlertMeasurementAnchorType | undefined;
    stateId?: ObjectID | undefined;
    stateName?: string | undefined;
    stateOrder?: number | undefined;
    stateRole?: string | undefined;
    occurrence?: MeasurementOccurrence | undefined;
    alert: Alert;
  }): MeasurementAnchorSpec {
    const occurrence: MeasurementOccurrence =
      data.occurrence || MeasurementOccurrence.First;
    const { alert } = data;

    switch (data.anchorType) {
      case AlertMeasurementAnchorType.StateEntered:
        return {
          kind: MeasurementAnchorKind.StateEntered,
          label: data.stateName || "The chosen state",
          stateId: data.stateId?.toString(),
          stateOrder: data.stateOrder,
          occurrence: occurrence,
          /*
           * The FK is SET NULL rather than RESTRICT, so that deleting a
           * state never blocks a project from reordering its states. The
           * measurement degrades and says why instead of throwing.
           */
          isDanglingStateReference: !data.stateId,
        };

      case AlertMeasurementAnchorType.StateRoleEntered:
        return {
          kind: MeasurementAnchorKind.StateRoleEntered,
          label: `The ${(data.stateRole || "").toLowerCase()} state`,
          stateRole: data.stateRole,
          occurrence: occurrence,
        };

      case AlertMeasurementAnchorType.ImpactStartedAt:
        return {
          kind: MeasurementAnchorKind.Timestamp,
          label: "Impact Started At",
          timestamp: alert.impactStartedAt,
          /*
           * Recorded by a person after the fact, so a blank value on an open
           * alert is still coming rather than never arriving.
           */
          canResolveAfterTerminalState: true,
        };

      case AlertMeasurementAnchorType.TimelineStart:
        return {
          kind: MeasurementAnchorKind.Timestamp,
          label: "Timeline Start",
          /*
           * The origin the built-in alert metrics use, reproduced exactly so
           * a definition can match today's numbers rather than silently
           * disagreeing with them.
           */
          timestamp: alert.createdAt,
        };

      case AlertMeasurementAnchorType.CreatedAt:
      default:
        return {
          kind: MeasurementAnchorKind.Timestamp,
          label: "Created At",
          timestamp: alert.createdAt,
        };
    }
  }

  private async persist(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    evaluations: Array<EvaluatedMeasurement>;
  }): Promise<void> {
    const existingValues: Array<Model> = await this.findBy({
      query: { alertId: data.alertId },
      select: { _id: true, alertMeasurementId: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    const existingByMeasurementId: Map<string, Model> = new Map<
      string,
      Model
    >();

    for (const existingValue of existingValues) {
      if (existingValue.alertMeasurementId) {
        existingByMeasurementId.set(
          existingValue.alertMeasurementId.toString(),
          existingValue,
        );
      }
    }

    const computedAt: Date = OneUptimeDate.getCurrentDate();

    for (const evaluation of data.evaluations) {
      /*
       * Absent parts are written as NULL rather than skipped. A measurement
       * that was Recorded and becomes Invalid after a timestamp correction
       * must lose its old value -- leaving the previous number in place is
       * exactly the "field that looks fine and is wrong" this feature exists
       * to remove.
       */
      const fields: ComputedValueFields = {
        startedAt: (evaluation.startedAt ?? null) as unknown as Date,
        endedAt: (evaluation.endedAt ?? null) as unknown as Date,
        valueInSeconds: (evaluation.valueInSeconds ??
          null) as unknown as number,
        status: evaluation.status,
        statusMessage: (evaluation.statusMessage ?? null) as unknown as string,
        startAlertStateTimelineId: (evaluation.startTimelineEntryId
          ? new ObjectID(evaluation.startTimelineEntryId)
          : null) as unknown as ObjectID,
        endAlertStateTimelineId: (evaluation.endTimelineEntryId
          ? new ObjectID(evaluation.endTimelineEntryId)
          : null) as unknown as ObjectID,
        computedAt: computedAt,
      };

      const existing: Model | undefined = existingByMeasurementId.get(
        evaluation.measurementId,
      );

      if (existing) {
        await this.updateOneById({
          id: existing.id!,
          data: fields,
          props: { isRoot: true },
        });

        continue;
      }

      const value: Model = new Model();
      value.projectId = data.projectId;
      value.alertId = data.alertId;
      value.alertMeasurementId = new ObjectID(evaluation.measurementId);
      value.startedAt = fields.startedAt;
      value.endedAt = fields.endedAt;
      value.valueInSeconds = fields.valueInSeconds;
      value.status = fields.status;
      value.statusMessage = fields.statusMessage;
      value.startAlertStateTimelineId = fields.startAlertStateTimelineId;
      value.endAlertStateTimelineId = fields.endAlertStateTimelineId;
      value.computedAt = fields.computedAt;

      try {
        await this.create({ data: value, props: { isRoot: true } });
      } catch (err) {
        /*
         * Two pods can recompute the same alert concurrently -- the metric
         * refresh's semaphore only logs on failure and proceeds unlocked --
         * so both can miss the row and both try to insert it. The unique key
         * on (alertId, alertMeasurementId) turns the loser into an error;
         * treating it as an update is the correct resolution, since both are
         * computing the same total function of the same data.
         */
        const raced: Model | null = await this.findOneBy({
          query: {
            alertId: data.alertId,
            alertMeasurementId: new ObjectID(evaluation.measurementId),
          },
          select: { _id: true },
          props: { isRoot: true },
        });

        if (!raced) {
          throw err;
        }

        await this.updateOneById({
          id: raced.id!,
          data: fields,
          props: { isRoot: true },
        });
      }
    }
  }

  private async emitMetrics(data: {
    alert: Alert;
    measurements: Array<AlertMeasurement>;
    evaluations: Array<EvaluatedMeasurement>;
  }): Promise<void> {
    const { alert, measurements, evaluations } = data;

    const measurementsById: Map<string, AlertMeasurement> = new Map<
      string,
      AlertMeasurement
    >();

    for (const measurement of measurements) {
      measurementsById.set(measurement._id!.toString(), measurement);
    }

    const points: Array<MeasurementMetricPoint> = [];

    for (const evaluation of evaluations) {
      const measurement: AlertMeasurement | undefined = measurementsById.get(
        evaluation.measurementId,
      );

      if (!measurement || !measurement.isEnabled || !measurement.metricName) {
        continue;
      }

      /*
       * Only a Recorded value becomes a metric point. A skipped state or an
       * unrecorded timestamp writes nothing at all rather than a zero, so a
       * milestone nobody reached cannot drag an average towards it.
       */
      if (
        evaluation.status !== MeasurementStatus.Recorded ||
        evaluation.valueInSeconds === undefined ||
        !evaluation.endedAt
      ) {
        continue;
      }

      points.push({
        metricName: measurement.metricName,
        measurementId: evaluation.measurementId,
        measurementKey: measurement.key || "",
        measurementName: measurement.name || "",
        description: measurement.description,
        unit: measurement.unit,
        valueInSeconds: evaluation.valueInSeconds,
        time: evaluation.endedAt,
      });
    }

    const allMetricNames: Array<string> = measurements
      .map((measurement: AlertMeasurement) => {
        return measurement.metricName;
      })
      .filter((name: string | undefined) => {
        return Boolean(name);
      }) as Array<string>;

    const baseAttributes: JSONObject = {
      alertId: alert._id!.toString(),
      projectId: alert.projectId!.toString(),
      monitorId: alert.monitor?._id?.toString(),
      monitorName: alert.monitor?.name?.toString(),
      alertSeverityId: alert.alertSeverity?._id?.toString(),
      alertSeverityName: alert.alertSeverity?.name?.toString(),
      ...MetricResourceAttributeUtil.getResourceAttributes({
        labels: alert.labels,
        customFields: alert.customFields,
      }),
    };

    try {
      await MeasurementMetricWriter.write({
        projectId: alert.projectId!,
        primaryEntityId: alert.id!,
        primaryEntityType: ServiceType.Alert,
        allMeasurementMetricNames: allMetricNames,
        points: points,
        baseAttributes: baseAttributes,
      });
    } catch (err) {
      /*
       * The stored value rows are the first-class artefact and are already
       * committed by this point. A ClickHouse outage should cost the charts,
       * not the field on the alert.
       */
      logger.error(err as Error);
    }
  }
}

export default new Service();
