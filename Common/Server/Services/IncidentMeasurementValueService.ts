import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IncidentMeasurementValue";
import IncidentMeasurement from "../../Models/DatabaseModels/IncidentMeasurement";
import IncidentMeasurementService from "./IncidentMeasurementService";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentService from "./IncidentService";
import IncidentStateTimeline from "../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentStateTimelineService from "./IncidentStateTimelineService";
import IncidentMeasurementAnchorType from "../../Types/Incident/IncidentMeasurementAnchorType";
import IncidentStateRole from "../../Types/Incident/IncidentStateRole";
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
  startIncidentStateTimelineId: ObjectID;
  endIncidentStateTimelineId: ObjectID;
  computedAt: Date;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Recomputes every measurement for one incident from scratch.
   *
   * This is deliberately a total function of the incident's current data: it
   * reads the timeline and the definitions, and never reads its own previous
   * output. That is what makes a corrected timestamp, a deleted timeline row
   * or an edited definition converge without a repair path -- there is no
   * accumulated state to be wrong.
   */
  @CaptureSpan()
  public async recomputeForIncident(data: {
    incidentId: ObjectID;
  }): Promise<void> {
    const incident: Incident | null = await IncidentService.findOneById({
      id: data.incidentId,
      select: {
        _id: true,
        projectId: true,
        createdAt: true,
        declaredAt: true,
        impactStartedAt: true,
        postmortemPostedAt: true,
        labels: { _id: true, name: true, color: true },
        customFields: true,
        monitors: { _id: true, name: true },
        incidentSeverity: { _id: true, name: true },
      },
      props: { isRoot: true },
    });

    if (!incident || !incident.projectId) {
      return;
    }

    const measurements: Array<IncidentMeasurement> =
      await IncidentMeasurementService.findBy({
        query: { projectId: incident.projectId },
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
          startIncidentStateId: true,
          endIncidentStateId: true,
          startIncidentStateRole: true,
          endIncidentStateRole: true,
          startStateOccurrence: true,
          endStateOccurrence: true,
          startIncidentState: { _id: true, name: true, order: true },
          endIncidentState: { _id: true, name: true, order: true },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    if (measurements.length === 0) {
      return;
    }

    const timeline: Array<MeasurementTimelineEntry> = await this.loadTimeline(
      data.incidentId,
    );

    const specs: Array<MeasurementDefinitionSpec> = measurements.map(
      (measurement: IncidentMeasurement) => {
        return this.toSpec({ measurement: measurement, incident: incident });
      },
    );

    const evaluations: Array<EvaluatedMeasurement> =
      MeasurementEvaluator.evaluate({ definitions: specs, timeline: timeline });

    await this.persist({
      projectId: incident.projectId,
      incidentId: data.incidentId,
      evaluations: evaluations,
    });

    await this.emitMetrics({
      incident: incident,
      measurements: measurements,
      evaluations: evaluations,
    });
  }

  private async loadTimeline(
    incidentId: ObjectID,
  ): Promise<Array<MeasurementTimelineEntry>> {
    const timelines: Array<IncidentStateTimeline> =
      await IncidentStateTimelineService.findBy({
        query: { incidentId: incidentId },
        select: {
          _id: true,
          incidentStateId: true,
          startsAt: true,
          incidentState: {
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
      .filter((timeline: IncidentStateTimeline) => {
        return Boolean(timeline.startsAt);
      })
      .map((timeline: IncidentStateTimeline) => {
        const roles: Array<string> = [];

        if (timeline.incidentState?.isCreatedState) {
          roles.push(IncidentStateRole.Created);
        }

        if (timeline.incidentState?.isAcknowledgedState) {
          roles.push(IncidentStateRole.Acknowledged);
        }

        if (timeline.incidentState?.isResolvedState) {
          roles.push(IncidentStateRole.Resolved);
        }

        return {
          id: timeline._id!.toString(),
          stateId: timeline.incidentStateId!.toString(),
          stateName: timeline.incidentState?.name,
          stateOrder: timeline.incidentState?.order,
          stateRoles: roles,
          startsAt: timeline.startsAt!,
        };
      });
  }

  private toSpec(data: {
    measurement: IncidentMeasurement;
    incident: Incident;
  }): MeasurementDefinitionSpec {
    const { measurement, incident } = data;

    return {
      id: measurement._id!.toString(),
      name: measurement.name || "",
      start: this.toAnchor({
        anchorType: measurement.startAnchorType,
        stateId: measurement.startIncidentStateId,
        stateName: measurement.startIncidentState?.name,
        stateOrder: measurement.startIncidentState?.order,
        stateRole: measurement.startIncidentStateRole,
        occurrence: measurement.startStateOccurrence,
        incident: incident,
      }),
      end: this.toAnchor({
        anchorType: measurement.endAnchorType,
        stateId: measurement.endIncidentStateId,
        stateName: measurement.endIncidentState?.name,
        stateOrder: measurement.endIncidentState?.order,
        stateRole: measurement.endIncidentStateRole,
        occurrence: measurement.endStateOccurrence,
        incident: incident,
      }),
    };
  }

  private toAnchor(data: {
    anchorType?: IncidentMeasurementAnchorType | undefined;
    stateId?: ObjectID | undefined;
    stateName?: string | undefined;
    stateOrder?: number | undefined;
    stateRole?: string | undefined;
    occurrence?: MeasurementOccurrence | undefined;
    incident: Incident;
  }): MeasurementAnchorSpec {
    const occurrence: MeasurementOccurrence =
      data.occurrence || MeasurementOccurrence.First;
    const { incident } = data;

    switch (data.anchorType) {
      case IncidentMeasurementAnchorType.StateEntered:
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

      case IncidentMeasurementAnchorType.StateRoleEntered:
        return {
          kind: MeasurementAnchorKind.StateRoleEntered,
          label: `The ${(data.stateRole || "").toLowerCase()} state`,
          stateRole: data.stateRole,
          occurrence: occurrence,
        };

      case IncidentMeasurementAnchorType.ImpactStartedAt:
        return {
          kind: MeasurementAnchorKind.Timestamp,
          label: "Impact Started At",
          timestamp: incident.impactStartedAt,
          /*
           * Recorded by a person after the fact, so a blank value on an open
           * incident is still coming rather than never arriving.
           */
          canResolveAfterTerminalState: true,
        };

      case IncidentMeasurementAnchorType.DeclaredAt:
        return {
          kind: MeasurementAnchorKind.Timestamp,
          label: "Declared At",
          timestamp: incident.declaredAt,
        };

      case IncidentMeasurementAnchorType.PostmortemPostedAt:
        return {
          kind: MeasurementAnchorKind.Timestamp,
          label: "Postmortem Posted At",
          timestamp: incident.postmortemPostedAt,
          // Postmortems are posted after resolution; resolution is not the end.
          canResolveAfterTerminalState: true,
        };

      case IncidentMeasurementAnchorType.TimelineStart:
        return {
          kind: MeasurementAnchorKind.Timestamp,
          label: "Timeline Start",
          /*
           * The origin the built-in incident metrics use, reproduced exactly
           * so a definition can match today's numbers rather than silently
           * disagreeing with them.
           */
          timestamp: incident.declaredAt || incident.createdAt,
        };

      case IncidentMeasurementAnchorType.CreatedAt:
      default:
        return {
          kind: MeasurementAnchorKind.Timestamp,
          label: "Created At",
          timestamp: incident.createdAt,
        };
    }
  }

  private async persist(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    evaluations: Array<EvaluatedMeasurement>;
  }): Promise<void> {
    const existingValues: Array<Model> = await this.findBy({
      query: { incidentId: data.incidentId },
      select: { _id: true, incidentMeasurementId: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    const existingByMeasurementId: Map<string, Model> = new Map<
      string,
      Model
    >();

    for (const existingValue of existingValues) {
      if (existingValue.incidentMeasurementId) {
        existingByMeasurementId.set(
          existingValue.incidentMeasurementId.toString(),
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
        startIncidentStateTimelineId: (evaluation.startTimelineEntryId
          ? new ObjectID(evaluation.startTimelineEntryId)
          : null) as unknown as ObjectID,
        endIncidentStateTimelineId: (evaluation.endTimelineEntryId
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
      value.incidentId = data.incidentId;
      value.incidentMeasurementId = new ObjectID(evaluation.measurementId);
      value.startedAt = fields.startedAt;
      value.endedAt = fields.endedAt;
      value.valueInSeconds = fields.valueInSeconds;
      value.status = fields.status;
      value.statusMessage = fields.statusMessage;
      value.startIncidentStateTimelineId = fields.startIncidentStateTimelineId;
      value.endIncidentStateTimelineId = fields.endIncidentStateTimelineId;
      value.computedAt = fields.computedAt;

      try {
        await this.create({ data: value, props: { isRoot: true } });
      } catch (err) {
        /*
         * Two pods can recompute the same incident concurrently -- the metric
         * refresh's semaphore only logs on failure and proceeds unlocked --
         * so both can miss the row and both try to insert it. The unique key
         * on (incidentId, incidentMeasurementId) turns the loser into an
         * error; treating it as an update is the correct resolution, since
         * both are computing the same total function of the same data.
         */
        const raced: Model | null = await this.findOneBy({
          query: {
            incidentId: data.incidentId,
            incidentMeasurementId: new ObjectID(evaluation.measurementId),
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
    incident: Incident;
    measurements: Array<IncidentMeasurement>;
    evaluations: Array<EvaluatedMeasurement>;
  }): Promise<void> {
    const { incident, measurements, evaluations } = data;

    const measurementsById: Map<string, IncidentMeasurement> = new Map<
      string,
      IncidentMeasurement
    >();

    for (const measurement of measurements) {
      measurementsById.set(measurement._id!.toString(), measurement);
    }

    const points: Array<MeasurementMetricPoint> = [];

    for (const evaluation of evaluations) {
      const measurement: IncidentMeasurement | undefined = measurementsById.get(
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
      .map((measurement: IncidentMeasurement) => {
        return measurement.metricName;
      })
      .filter((name: string | undefined) => {
        return Boolean(name);
      }) as Array<string>;

    const baseAttributes: JSONObject = {
      incidentId: incident._id!.toString(),
      projectId: incident.projectId!.toString(),
      incidentSeverityId: incident.incidentSeverity?._id?.toString(),
      incidentSeverityName: incident.incidentSeverity?.name?.toString(),
      ...MetricResourceAttributeUtil.getResourceAttributes({
        labels: incident.labels,
        customFields: incident.customFields,
      }),
    };

    try {
      await MeasurementMetricWriter.write({
        projectId: incident.projectId!,
        primaryEntityId: incident.id!,
        primaryEntityType: ServiceType.Incident,
        allMeasurementMetricNames: allMetricNames,
        points: points,
        baseAttributes: baseAttributes,
      });
    } catch (err) {
      /*
       * The stored value rows are the first-class artefact and are already
       * committed by this point. A ClickHouse outage should cost the charts,
       * not the field on the incident.
       */
      logger.error(err as Error);
    }
  }
}

export default new Service();
