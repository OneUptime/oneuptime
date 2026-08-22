import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ScheduledMaintenanceMeasurementValue";
import ScheduledMaintenanceMeasurement from "../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import ScheduledMaintenanceMeasurementService from "./ScheduledMaintenanceMeasurementService";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimeline from "../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ScheduledMaintenanceStateTimelineService from "./ScheduledMaintenanceStateTimelineService";
import ScheduledMaintenanceMeasurementAnchorType from "../../Types/ScheduledMaintenance/ScheduledMaintenanceMeasurementAnchorType";
import ScheduledMaintenanceStateRole from "../../Types/ScheduledMaintenance/ScheduledMaintenanceStateRole";
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
  startScheduledMaintenanceStateTimelineId: ObjectID;
  endScheduledMaintenanceStateTimelineId: ObjectID;
  computedAt: Date;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Recomputes every measurement for one scheduled maintenance event from
   * scratch.
   *
   * This is deliberately a total function of the event's current data: it
   * reads the timeline and the definitions, and never reads its own previous
   * output. That is what makes a corrected timestamp, a deleted timeline row
   * or an edited definition converge without a repair path -- there is no
   * accumulated state to be wrong.
   */
  @CaptureSpan()
  public async recomputeForScheduledMaintenance(data: {
    scheduledMaintenanceId: ObjectID;
  }): Promise<void> {
    const scheduledMaintenance: ScheduledMaintenance | null =
      await ScheduledMaintenanceService.findOneById({
        id: data.scheduledMaintenanceId,
        select: {
          _id: true,
          projectId: true,
          createdAt: true,
          startsAt: true,
          endsAt: true,
          labels: { _id: true, name: true, color: true },
          customFields: true,
        },
        props: { isRoot: true },
      });

    if (!scheduledMaintenance || !scheduledMaintenance.projectId) {
      return;
    }

    const measurements: Array<ScheduledMaintenanceMeasurement> =
      await ScheduledMaintenanceMeasurementService.findBy({
        query: { projectId: scheduledMaintenance.projectId },
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
          startScheduledMaintenanceStateId: true,
          endScheduledMaintenanceStateId: true,
          startScheduledMaintenanceStateRole: true,
          endScheduledMaintenanceStateRole: true,
          startStateOccurrence: true,
          endStateOccurrence: true,
          startScheduledMaintenanceState: {
            _id: true,
            name: true,
            order: true,
          },
          endScheduledMaintenanceState: { _id: true, name: true, order: true },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    if (measurements.length === 0) {
      return;
    }

    const timeline: Array<MeasurementTimelineEntry> = await this.loadTimeline(
      data.scheduledMaintenanceId,
    );

    const specs: Array<MeasurementDefinitionSpec> = measurements.map(
      (measurement: ScheduledMaintenanceMeasurement) => {
        return this.toSpec({
          measurement: measurement,
          scheduledMaintenance: scheduledMaintenance,
        });
      },
    );

    const evaluations: Array<EvaluatedMeasurement> =
      MeasurementEvaluator.evaluate({
        definitions: specs,
        timeline: timeline,
      });

    await this.persist({
      projectId: scheduledMaintenance.projectId,
      scheduledMaintenanceId: data.scheduledMaintenanceId,
      evaluations: evaluations,
    });

    await this.emitMetrics({
      scheduledMaintenance: scheduledMaintenance,
      measurements: measurements,
      evaluations: evaluations,
    });
  }

  private async loadTimeline(
    scheduledMaintenanceId: ObjectID,
  ): Promise<Array<MeasurementTimelineEntry>> {
    const timelines: Array<ScheduledMaintenanceStateTimeline> =
      await ScheduledMaintenanceStateTimelineService.findBy({
        query: { scheduledMaintenanceId: scheduledMaintenanceId },
        select: {
          _id: true,
          scheduledMaintenanceStateId: true,
          startsAt: true,
          scheduledMaintenanceState: {
            _id: true,
            name: true,
            order: true,
            isScheduledState: true,
            isOngoingState: true,
            isEndedState: true,
            isResolvedState: true,
          },
        },
        sort: { startsAt: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    return timelines
      .filter((timeline: ScheduledMaintenanceStateTimeline) => {
        return Boolean(timeline.startsAt);
      })
      .map((timeline: ScheduledMaintenanceStateTimeline) => {
        /*
         * A single state can carry more than one of these flags -- projects
         * commonly mark the same state Ended and Resolved -- so every role
         * that is true is pushed rather than the first match winning.
         */
        const roles: Array<string> = [];

        if (timeline.scheduledMaintenanceState?.isScheduledState) {
          roles.push(ScheduledMaintenanceStateRole.Scheduled);
        }

        if (timeline.scheduledMaintenanceState?.isOngoingState) {
          roles.push(ScheduledMaintenanceStateRole.Ongoing);
        }

        if (timeline.scheduledMaintenanceState?.isEndedState) {
          roles.push(ScheduledMaintenanceStateRole.Ended);
        }

        if (timeline.scheduledMaintenanceState?.isResolvedState) {
          roles.push(ScheduledMaintenanceStateRole.Resolved);
        }

        return {
          id: timeline._id!.toString(),
          stateId: timeline.scheduledMaintenanceStateId!.toString(),
          stateName: timeline.scheduledMaintenanceState?.name,
          stateOrder: timeline.scheduledMaintenanceState?.order,
          stateRoles: roles,
          startsAt: timeline.startsAt!,
        };
      });
  }

  private toSpec(data: {
    measurement: ScheduledMaintenanceMeasurement;
    scheduledMaintenance: ScheduledMaintenance;
  }): MeasurementDefinitionSpec {
    const { measurement, scheduledMaintenance } = data;

    return {
      id: measurement._id!.toString(),
      name: measurement.name || "",
      start: this.toAnchor({
        anchorType: measurement.startAnchorType,
        stateId: measurement.startScheduledMaintenanceStateId,
        stateName: measurement.startScheduledMaintenanceState?.name,
        stateOrder: measurement.startScheduledMaintenanceState?.order,
        stateRole: measurement.startScheduledMaintenanceStateRole,
        occurrence: measurement.startStateOccurrence,
        scheduledMaintenance: scheduledMaintenance,
      }),
      end: this.toAnchor({
        anchorType: measurement.endAnchorType,
        stateId: measurement.endScheduledMaintenanceStateId,
        stateName: measurement.endScheduledMaintenanceState?.name,
        stateOrder: measurement.endScheduledMaintenanceState?.order,
        stateRole: measurement.endScheduledMaintenanceStateRole,
        occurrence: measurement.endStateOccurrence,
        scheduledMaintenance: scheduledMaintenance,
      }),
    };
  }

  private toAnchor(data: {
    anchorType?: ScheduledMaintenanceMeasurementAnchorType | undefined;
    stateId?: ObjectID | undefined;
    stateName?: string | undefined;
    stateOrder?: number | undefined;
    stateRole?: string | undefined;
    occurrence?: MeasurementOccurrence | undefined;
    scheduledMaintenance: ScheduledMaintenance;
  }): MeasurementAnchorSpec {
    const occurrence: MeasurementOccurrence =
      data.occurrence || MeasurementOccurrence.First;
    const { scheduledMaintenance } = data;

    switch (data.anchorType) {
      case ScheduledMaintenanceMeasurementAnchorType.StateEntered:
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

      case ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered:
        return {
          kind: MeasurementAnchorKind.StateRoleEntered,
          label: `The ${(data.stateRole || "").toLowerCase()} state`,
          stateRole: data.stateRole,
          occurrence: occurrence,
        };

      case ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt:
        return {
          kind: MeasurementAnchorKind.Timestamp,
          /*
           * The PLANNED window, not what happened. Labelled to say so, so a
           * status message reads "Scheduled Starts At" and cannot be mistaken
           * for the moment the event actually went ongoing -- comparing the
           * two is the whole point of this domain's measurements.
           *
           * Both ends of the window are required at creation, so a missing
           * value is never "still coming" and this is not
           * canResolveAfterTerminalState.
           */
          label: "Scheduled Starts At",
          timestamp: scheduledMaintenance.startsAt,
        };

      case ScheduledMaintenanceMeasurementAnchorType.ScheduledEndsAt:
        return {
          kind: MeasurementAnchorKind.Timestamp,
          label: "Scheduled Ends At",
          timestamp: scheduledMaintenance.endsAt,
        };

      case ScheduledMaintenanceMeasurementAnchorType.TimelineStart:
        return {
          kind: MeasurementAnchorKind.Timestamp,
          label: "Timeline Start",
          /*
           * Maintenance has no declaredAt -- it is planned rather than
           * detected -- so creation time is the origin the timeline is
           * measured from.
           */
          timestamp: scheduledMaintenance.createdAt,
        };

      case ScheduledMaintenanceMeasurementAnchorType.CreatedAt:
      default:
        return {
          kind: MeasurementAnchorKind.Timestamp,
          label: "Created At",
          timestamp: scheduledMaintenance.createdAt,
        };
    }
  }

  private async persist(data: {
    projectId: ObjectID;
    scheduledMaintenanceId: ObjectID;
    evaluations: Array<EvaluatedMeasurement>;
  }): Promise<void> {
    const existingValues: Array<Model> = await this.findBy({
      query: { scheduledMaintenanceId: data.scheduledMaintenanceId },
      select: { _id: true, scheduledMaintenanceMeasurementId: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    const existingByMeasurementId: Map<string, Model> = new Map<
      string,
      Model
    >();

    for (const existingValue of existingValues) {
      if (existingValue.scheduledMaintenanceMeasurementId) {
        existingByMeasurementId.set(
          existingValue.scheduledMaintenanceMeasurementId.toString(),
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
        startScheduledMaintenanceStateTimelineId:
          (evaluation.startTimelineEntryId
            ? new ObjectID(evaluation.startTimelineEntryId)
            : null) as unknown as ObjectID,
        endScheduledMaintenanceStateTimelineId: (evaluation.endTimelineEntryId
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
      value.scheduledMaintenanceId = data.scheduledMaintenanceId;
      value.scheduledMaintenanceMeasurementId = new ObjectID(
        evaluation.measurementId,
      );
      value.startedAt = fields.startedAt;
      value.endedAt = fields.endedAt;
      value.valueInSeconds = fields.valueInSeconds;
      value.status = fields.status;
      value.statusMessage = fields.statusMessage;
      value.startScheduledMaintenanceStateTimelineId =
        fields.startScheduledMaintenanceStateTimelineId;
      value.endScheduledMaintenanceStateTimelineId =
        fields.endScheduledMaintenanceStateTimelineId;
      value.computedAt = fields.computedAt;

      try {
        await this.create({ data: value, props: { isRoot: true } });
      } catch (err) {
        /*
         * Two pods can recompute the same event concurrently -- the timeline
         * hooks fire on every pod that handles a write -- so both can miss
         * the row and both try to insert it. The unique key on
         * (scheduledMaintenanceId, scheduledMaintenanceMeasurementId) turns
         * the loser into an error; treating it as an update is the correct
         * resolution, since both are computing the same total function of
         * the same data.
         */
        const raced: Model | null = await this.findOneBy({
          query: {
            scheduledMaintenanceId: data.scheduledMaintenanceId,
            scheduledMaintenanceMeasurementId: new ObjectID(
              evaluation.measurementId,
            ),
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
    scheduledMaintenance: ScheduledMaintenance;
    measurements: Array<ScheduledMaintenanceMeasurement>;
    evaluations: Array<EvaluatedMeasurement>;
  }): Promise<void> {
    const { scheduledMaintenance, measurements, evaluations } = data;

    const measurementsById: Map<string, ScheduledMaintenanceMeasurement> =
      new Map<string, ScheduledMaintenanceMeasurement>();

    for (const measurement of measurements) {
      measurementsById.set(measurement._id!.toString(), measurement);
    }

    const points: Array<MeasurementMetricPoint> = [];

    for (const evaluation of evaluations) {
      const measurement: ScheduledMaintenanceMeasurement | undefined =
        measurementsById.get(evaluation.measurementId);

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
      .map((measurement: ScheduledMaintenanceMeasurement) => {
        return measurement.metricName;
      })
      .filter((name: string | undefined) => {
        return Boolean(name);
      }) as Array<string>;

    /*
     * Maintenance carries no severity and no per-monitor breakdown worth
     * charting, so the only dimensions are the identity of the event plus
     * the project's own taxonomy from labels and custom fields.
     */
    const baseAttributes: JSONObject = {
      scheduledMaintenanceId: scheduledMaintenance._id!.toString(),
      projectId: scheduledMaintenance.projectId!.toString(),
      ...MetricResourceAttributeUtil.getResourceAttributes({
        labels: scheduledMaintenance.labels,
        customFields: scheduledMaintenance.customFields,
      }),
    };

    try {
      await MeasurementMetricWriter.write({
        projectId: scheduledMaintenance.projectId!,
        primaryEntityId: scheduledMaintenance.id!,
        primaryEntityType: ServiceType.ScheduledMaintenance,
        allMeasurementMetricNames: allMetricNames,
        points: points,
        baseAttributes: baseAttributes,
      });
    } catch (err) {
      /*
       * The stored value rows are the first-class artefact and are already
       * committed by this point. A ClickHouse outage should cost the charts,
       * not the field on the maintenance event.
       */
      logger.error(err as Error);
    }
  }
}

export default new Service();
