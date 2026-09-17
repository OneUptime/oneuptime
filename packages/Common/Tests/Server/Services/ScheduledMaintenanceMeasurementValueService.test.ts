import MutableMetric from "../../../Models/AnalyticsModels/MutableMetric";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceMeasurement from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import ScheduledMaintenanceMeasurementValue from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurementValue";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import ScheduledMaintenanceMeasurementService from "../../../Server/Services/ScheduledMaintenanceMeasurementService";
import ScheduledMaintenanceMeasurementValueService from "../../../Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import { JSONObject } from "../../../Types/JSON";
import MeasurementStatus from "../../../Types/Measurement/MeasurementStatus";
import ObjectID from "../../../Types/ObjectID";
import ScheduledMaintenanceMeasurementAnchorType from "../../../Types/ScheduledMaintenance/ScheduledMaintenanceMeasurementAnchorType";
import ScheduledMaintenanceStateRole from "../../../Types/ScheduledMaintenance/ScheduledMaintenanceStateRole";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const EVENT_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const SCHEDULED_STATE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0001-4000-8000-000000000001",
);
const ONGOING_STATE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0002-4000-8000-000000000002",
);
const ENDED_STATE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0003-4000-8000-000000000003",
);
const COMPLETED_STATE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0004-4000-8000-000000000004",
);

const METRIC_NAME_PREFIX: string =
  "oneuptime.scheduled-maintenance.measurement.";

function at(minutes: number): Date {
  return new Date(Date.UTC(2026, 7, 21, 10, minutes, 0));
}

/*
 * The event is created at +0 and PLANNED to run from +60 to +120. It actually
 * went ongoing at +75, ended at +110 and was marked completed at +115. Every
 * one of those five moments is distinct, so an anchor wired to the wrong
 * column produces a different number rather than accidentally the right one.
 */
const CREATED_AT: Date = at(0);
const SCHEDULED_STARTS_AT: Date = at(60);
const SCHEDULED_ENDS_AT: Date = at(120);
const WENT_ONGOING_AT: Date = at(75);
const ENDED_AT: Date = at(110);
const COMPLETED_AT: Date = at(115);

interface ReplaceEntityMetricsCall {
  projectId: ObjectID;
  primaryEntityId: ObjectID;
  primaryEntityType: ServiceType;
  metricNames: Array<string>;
  metrics: Array<MutableMetric>;
  retentionDate: Date;
}

function buildScheduledMaintenance(
  input: { withPlannedEnd?: boolean } = {},
): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();

  event._id = EVENT_ID.toString();
  event.id = EVENT_ID;
  event.projectId = PROJECT_ID;
  event.createdAt = CREATED_AT;
  event.startsAt = SCHEDULED_STARTS_AT;

  if (input.withPlannedEnd !== false) {
    event.endsAt = SCHEDULED_ENDS_AT;
  }

  return event;
}

function buildTimelineEntry(input: {
  stateId: ObjectID;
  stateName: string;
  order: number;
  startsAt: Date;
  isScheduledState?: boolean;
  isOngoingState?: boolean;
  isEndedState?: boolean;
  isResolvedState?: boolean;
}): ScheduledMaintenanceStateTimeline {
  const entry: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();

  entry._id = `bbbbbbbb-000${input.order}-4000-8000-00000000000${input.order}`;
  entry.id = new ObjectID(entry._id);
  entry.projectId = PROJECT_ID;
  entry.scheduledMaintenanceId = EVENT_ID;
  entry.scheduledMaintenanceStateId = input.stateId;
  entry.startsAt = input.startsAt;

  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = input.stateId.toString();
  state.id = input.stateId;
  state.name = input.stateName;
  state.order = input.order;
  state.isScheduledState = input.isScheduledState || false;
  state.isOngoingState = input.isOngoingState || false;
  state.isEndedState = input.isEndedState || false;
  state.isResolvedState = input.isResolvedState || false;
  entry.scheduledMaintenanceState = state;

  return entry;
}

function defaultTimeline(): Array<ScheduledMaintenanceStateTimeline> {
  return [
    buildTimelineEntry({
      stateId: SCHEDULED_STATE_ID,
      stateName: "Scheduled",
      order: 1,
      startsAt: CREATED_AT,
      isScheduledState: true,
    }),
    buildTimelineEntry({
      stateId: ONGOING_STATE_ID,
      stateName: "Ongoing",
      order: 2,
      startsAt: WENT_ONGOING_AT,
      isOngoingState: true,
    }),
    buildTimelineEntry({
      stateId: ENDED_STATE_ID,
      stateName: "Ended",
      order: 3,
      startsAt: ENDED_AT,
      isEndedState: true,
    }),
    buildTimelineEntry({
      stateId: COMPLETED_STATE_ID,
      stateName: "Completed",
      order: 4,
      startsAt: COMPLETED_AT,
      isResolvedState: true,
    }),
  ];
}

let nextMeasurementId: number = 0;

function buildMeasurement(input: {
  key: string;
  name: string;
  startAnchorType: ScheduledMaintenanceMeasurementAnchorType;
  endAnchorType: ScheduledMaintenanceMeasurementAnchorType;
  startStateRole?: ScheduledMaintenanceStateRole;
  endStateRole?: ScheduledMaintenanceStateRole;
}): ScheduledMaintenanceMeasurement {
  const measurement: ScheduledMaintenanceMeasurement =
    new ScheduledMaintenanceMeasurement();

  nextMeasurementId++;

  const id: ObjectID = new ObjectID(
    `cccccccc-000${nextMeasurementId}-4000-8000-00000000000${nextMeasurementId}`,
  );

  measurement._id = id.toString();
  measurement.id = id;
  measurement.projectId = PROJECT_ID;
  measurement.name = input.name;
  measurement.key = input.key;
  measurement.metricName = METRIC_NAME_PREFIX + input.key;
  measurement.isEnabled = true;
  measurement.startAnchorType = input.startAnchorType;
  measurement.endAnchorType = input.endAnchorType;

  if (input.startStateRole) {
    measurement.startScheduledMaintenanceStateRole = input.startStateRole;
  }

  if (input.endStateRole) {
    measurement.endScheduledMaintenanceStateRole = input.endStateRole;
  }

  return measurement;
}

// Created At -> whichever state carries the given role.
function fromCreationTo(
  key: string,
  role: ScheduledMaintenanceStateRole,
): ScheduledMaintenanceMeasurement {
  return buildMeasurement({
    key: key,
    name: key,
    startAnchorType: ScheduledMaintenanceMeasurementAnchorType.CreatedAt,
    endAnchorType: ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
    endStateRole: role,
  });
}

describe("ScheduledMaintenanceMeasurementValueService.recomputeForScheduledMaintenance", () => {
  let createdRows: Array<ScheduledMaintenanceMeasurementValue>;
  let replaceCalls: Array<ReplaceEntityMetricsCall>;

  function mockDefinitions(
    measurements: Array<ScheduledMaintenanceMeasurement>,
  ): void {
    jest
      .spyOn(ScheduledMaintenanceMeasurementService, "findBy")
      .mockResolvedValue(measurements as never);
  }

  function mockTimeline(
    entries: Array<ScheduledMaintenanceStateTimeline>,
  ): void {
    jest
      .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
      .mockResolvedValue(entries as never);
  }

  async function recompute(): Promise<void> {
    await ScheduledMaintenanceMeasurementValueService.recomputeForScheduledMaintenance(
      { scheduledMaintenanceId: EVENT_ID },
    );
  }

  function rowFor(
    measurement: ScheduledMaintenanceMeasurement,
  ): ScheduledMaintenanceMeasurementValue {
    const row: ScheduledMaintenanceMeasurementValue | undefined =
      createdRows.find((candidate: ScheduledMaintenanceMeasurementValue) => {
        return (
          candidate.scheduledMaintenanceMeasurementId?.toString() ===
          measurement._id
        );
      });

    expect(row).toBeDefined();

    return row!;
  }

  beforeEach(() => {
    createdRows = [];
    replaceCalls = [];
    nextMeasurementId = 0;

    jest
      .spyOn(ScheduledMaintenanceService, "findOneById")
      .mockResolvedValue(buildScheduledMaintenance() as never);
    mockTimeline(defaultTimeline());

    jest
      .spyOn(ScheduledMaintenanceMeasurementValueService, "findBy")
      .mockResolvedValue(
        [] as Array<ScheduledMaintenanceMeasurementValue> as never,
      );
    jest
      .spyOn(ScheduledMaintenanceMeasurementValueService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(ScheduledMaintenanceMeasurementValueService, "create")
      .mockImplementation((async (createBy: {
        data: ScheduledMaintenanceMeasurementValue;
      }): Promise<ScheduledMaintenanceMeasurementValue> => {
        createdRows.push(createBy.data);
        return createBy.data;
      }) as never);
    jest
      .spyOn(ScheduledMaintenanceMeasurementValueService, "updateOneById")
      .mockResolvedValue(1 as never);

    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MutableMetricService, "replaceEntityMetrics")
      .mockImplementation((async (
        data: ReplaceEntityMetricsCall,
      ): Promise<void> => {
        replaceCalls.push(data);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("measures the start delay from the PLANNED start, not from when the event actually began", async () => {
    /*
     * Comparing the planned window against what happened is the whole point of
     * this domain's measurements. If Scheduled Starts At resolved to the
     * ongoing timeline row instead of the startsAt column, every start-delay
     * measurement would read zero.
     */
    const startDelay: ScheduledMaintenanceMeasurement = buildMeasurement({
      key: "start-delay",
      name: "Start Delay",
      startAnchorType:
        ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt,
      endAnchorType: ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
      endStateRole: ScheduledMaintenanceStateRole.Ongoing,
    });

    mockDefinitions([startDelay]);

    await recompute();

    expect(rowFor(startDelay).startedAt).toEqual(SCHEDULED_STARTS_AT);
    expect(rowFor(startDelay).endedAt).toEqual(WENT_ONGOING_AT);
    expect(rowFor(startDelay).valueInSeconds).toBe(15 * 60);
  });

  test("reads the planned window off the event's own startsAt and endsAt columns", async () => {
    const plannedWindow: ScheduledMaintenanceMeasurement = buildMeasurement({
      key: "planned-window",
      name: "Planned Window",
      startAnchorType:
        ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt,
      endAnchorType: ScheduledMaintenanceMeasurementAnchorType.ScheduledEndsAt,
    });

    mockDefinitions([plannedWindow]);

    await recompute();

    expect(rowFor(plannedWindow).status).toBe(MeasurementStatus.Recorded);
    expect(rowFor(plannedWindow).startedAt).toEqual(SCHEDULED_STARTS_AT);
    expect(rowFor(plannedWindow).endedAt).toEqual(SCHEDULED_ENDS_AT);
    expect(rowFor(plannedWindow).valueInSeconds).toBe(60 * 60);
  });

  test("maps all four maintenance roles onto the states that carry their flags", async () => {
    /*
     * Maintenance has its own vocabulary -- scheduled, ongoing, ended,
     * resolved -- rather than the incident triple. Each role must land on the
     * state whose flag is set, and each of these four states is set at a
     * different minute so a mix-up cannot pass.
     */
    const toScheduled: ScheduledMaintenanceMeasurement = fromCreationTo(
      "to-scheduled",
      ScheduledMaintenanceStateRole.Scheduled,
    );
    const toOngoing: ScheduledMaintenanceMeasurement = fromCreationTo(
      "to-ongoing",
      ScheduledMaintenanceStateRole.Ongoing,
    );
    const toEnded: ScheduledMaintenanceMeasurement = fromCreationTo(
      "to-ended",
      ScheduledMaintenanceStateRole.Ended,
    );
    const toResolved: ScheduledMaintenanceMeasurement = fromCreationTo(
      "to-resolved",
      ScheduledMaintenanceStateRole.Resolved,
    );

    mockDefinitions([toScheduled, toOngoing, toEnded, toResolved]);

    await recompute();

    expect(rowFor(toScheduled).endedAt).toEqual(CREATED_AT);
    expect(rowFor(toOngoing).endedAt).toEqual(WENT_ONGOING_AT);
    expect(rowFor(toEnded).endedAt).toEqual(ENDED_AT);
    expect(rowFor(toResolved).endedAt).toEqual(COMPLETED_AT);
  });

  test("gives a state that is both Ended and Resolved both roles, as projects commonly configure", async () => {
    mockTimeline([
      buildTimelineEntry({
        stateId: SCHEDULED_STATE_ID,
        stateName: "Scheduled",
        order: 1,
        startsAt: CREATED_AT,
        isScheduledState: true,
      }),
      buildTimelineEntry({
        stateId: ENDED_STATE_ID,
        stateName: "Completed",
        order: 2,
        startsAt: ENDED_AT,
        isEndedState: true,
        isResolvedState: true,
      }),
    ]);

    const toEnded: ScheduledMaintenanceMeasurement = fromCreationTo(
      "to-ended",
      ScheduledMaintenanceStateRole.Ended,
    );
    const toResolved: ScheduledMaintenanceMeasurement = fromCreationTo(
      "to-resolved",
      ScheduledMaintenanceStateRole.Resolved,
    );

    mockDefinitions([toEnded, toResolved]);

    await recompute();

    expect(rowFor(toEnded).endedAt).toEqual(ENDED_AT);
    expect(rowFor(toResolved).endedAt).toEqual(ENDED_AT);
    expect(rowFor(toResolved).status).toBe(MeasurementStatus.Recorded);
  });

  test("writes the points against the event as a ScheduledMaintenance entity, under the maintenance metric prefix", async () => {
    const toOngoing: ScheduledMaintenanceMeasurement = fromCreationTo(
      "start-delay",
      ScheduledMaintenanceStateRole.Ongoing,
    );

    mockDefinitions([toOngoing]);

    await recompute();

    expect(replaceCalls).toHaveLength(1);
    expect(replaceCalls[0]!.primaryEntityType).toBe(
      ServiceType.ScheduledMaintenance,
    );
    expect(replaceCalls[0]!.primaryEntityId.toString()).toBe(
      EVENT_ID.toString(),
    );
    expect(replaceCalls[0]!.metricNames).toEqual([
      "oneuptime.scheduled-maintenance.measurement.start-delay",
    ]);
    expect(replaceCalls[0]!.metrics[0]!.name).toBe(
      "oneuptime.scheduled-maintenance.measurement.start-delay",
    );

    const attributes: JSONObject = replaceCalls[0]!.metrics[0]!
      .attributes as JSONObject;

    expect(attributes["scheduledMaintenanceId"]).toBe(EVENT_ID.toString());
    expect(attributes["projectId"]).toBe(PROJECT_ID.toString());
    expect(attributes["oneuptime.measurement.key"]).toBe("start-delay");
  });

  test("treats a missing planned window as never recorded, because both ends are required at creation", async () => {
    const event: ScheduledMaintenance = buildScheduledMaintenance({
      withPlannedEnd: false,
    });

    jest
      .spyOn(ScheduledMaintenanceService, "findOneById")
      .mockResolvedValue(event as never);

    const overrun: ScheduledMaintenanceMeasurement = buildMeasurement({
      key: "overrun",
      name: "Overrun",
      startAnchorType:
        ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt,
      endAnchorType: ScheduledMaintenanceMeasurementAnchorType.ScheduledEndsAt,
    });

    mockDefinitions([overrun]);

    await recompute();

    expect(rowFor(overrun).status).toBe(MeasurementStatus.NotApplicable);
    expect(rowFor(overrun).valueInSeconds).toBeNull();
    expect(replaceCalls[0]!.metrics).toHaveLength(0);
  });
});
