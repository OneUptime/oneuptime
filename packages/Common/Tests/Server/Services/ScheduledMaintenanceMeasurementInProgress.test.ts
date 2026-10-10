import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceMeasurement from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import ScheduledMaintenanceMeasurementValue from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurementValue";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import ScheduledMaintenanceMeasurementService from "../../../Server/Services/ScheduledMaintenanceMeasurementService";
import ScheduledMaintenanceMeasurementValueService from "../../../Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import MeasurementStatus from "../../../Types/Measurement/MeasurementStatus";
import ObjectID from "../../../Types/ObjectID";
import ScheduledMaintenanceMeasurementAnchorType from "../../../Types/ScheduledMaintenance/ScheduledMaintenanceMeasurementAnchorType";
import ScheduledMaintenanceStateRole from "../../../Types/ScheduledMaintenance/ScheduledMaintenanceStateRole";
import {
  PROGRESS_PROJECT_ID,
  ProgressStateKey,
  makeProgressState,
  mockProgressStateReads,
  progressStateId,
} from "../TestingUtils/ScheduledMaintenanceProgressWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A maintenance measurement anchored on "the ongoing state entered" times
 * the event's START: the move into a state where it is in progress - its
 * project's ongoing state, or a state of the project's own placed between
 * Ongoing and Ended ("Verifying") - from one where it was not
 * (Common/Utils/ScheduledMaintenanceStart). It used to look for the ongoing
 * flag alone, so an event started straight into "Verifying" never recorded
 * a start delay at all, and a move on from Ongoing to "Verifying" is no
 * second start.
 *
 * "The ended state entered" and "the completed state entered" read the same
 * rule (getEndRows, getCompleteRows): the move into a state where the event
 * is over - Ended, Completed, or a state of the project's own after Ended
 * ("Reviewing") - from one where it was not, and the move into a state
 * where it is complete - Completed, or a state of the project's own after
 * it ("Archived") - from one where it was not. They used to look for the
 * ended and completed flags alone: an event completed straight from Ongoing
 * never recorded its end, and one archived straight from Ended never its
 * completion.
 */

const EVENT_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-000000000001");

function at(minutes: number): Date {
  return new Date(Date.UTC(2026, 7, 21, 10, minutes, 0));
}

const CREATED_AT: Date = at(0);
const SCHEDULED_STARTS_AT: Date = at(60);

let rowNumber: number = 0;

function row(
  key: ProgressStateKey,
  startsAt: Date,
): ScheduledMaintenanceStateTimeline {
  rowNumber++;
  const entry: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();
  entry._id = `5e000000-0000-4000-8000-0000000001${String(rowNumber).padStart(2, "0")}`;
  entry.id = new ObjectID(entry._id);
  entry.projectId = PROGRESS_PROJECT_ID;
  entry.scheduledMaintenanceId = EVENT_ID;
  entry.scheduledMaintenanceStateId = progressStateId(key);
  entry.scheduledMaintenanceState = makeProgressState(key);
  entry.startsAt = startsAt;
  return entry;
}

// From the planned start to the move into the state that carries `role`.
function measurementTo(
  role: ScheduledMaintenanceStateRole,
): ScheduledMaintenanceMeasurement {
  const measurement: ScheduledMaintenanceMeasurement =
    new ScheduledMaintenanceMeasurement();
  measurement._id = "5e000000-0000-4000-8000-000000000201";
  measurement.id = new ObjectID(measurement._id);
  measurement.projectId = PROGRESS_PROJECT_ID;
  measurement.name = "Start delay";
  measurement.key = "start-delay";
  measurement.metricName =
    "oneuptime.scheduled-maintenance.measurement.start-delay";
  measurement.isEnabled = true;
  measurement.startAnchorType =
    ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt;
  measurement.endAnchorType =
    ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered;
  measurement.endScheduledMaintenanceStateRole = role;
  return measurement;
}

let createdRows: Array<ScheduledMaintenanceMeasurementValue> = [];

function mockTimeline(rows: Array<ScheduledMaintenanceStateTimeline>): void {
  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
    .mockResolvedValue(rows as never);
}

// The one measurement's value, recomputed off the timeline.
async function measuredRow(): Promise<ScheduledMaintenanceMeasurementValue> {
  await ScheduledMaintenanceMeasurementValueService.recomputeForScheduledMaintenance(
    { scheduledMaintenanceId: EVENT_ID },
  );

  expect(createdRows).toHaveLength(1);
  return createdRows[0]!;
}

const startDelayRow: () => Promise<ScheduledMaintenanceMeasurementValue> =
  measuredRow;

// The event, its one measurement (to the state carrying `role`) and its writes.
function stubTheEventMeasuredTo(role: ScheduledMaintenanceStateRole): void {
  createdRows = [];
  rowNumber = 0;

  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = EVENT_ID.toString();
  event.id = EVENT_ID;
  event.projectId = PROGRESS_PROJECT_ID;
  event.createdAt = CREATED_AT;
  event.startsAt = SCHEDULED_STARTS_AT;
  event.endsAt = at(120);

  mockProgressStateReads();

  jest
    .spyOn(ScheduledMaintenanceService, "findOneById")
    .mockResolvedValue(event as never);
  jest
    .spyOn(ScheduledMaintenanceMeasurementService, "findBy")
    .mockResolvedValue([measurementTo(role)] as never);
  jest
    .spyOn(ScheduledMaintenanceMeasurementValueService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(ScheduledMaintenanceMeasurementValueService, "findOneBy")
    .mockResolvedValue(null as never);
  jest
    .spyOn(ScheduledMaintenanceMeasurementValueService, "create")
    .mockImplementation((async (createBy: {
      data: ScheduledMaintenanceMeasurementValue;
    }) => {
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
    .mockResolvedValue(undefined as never);
}

describe("a maintenance measurement's 'ongoing state entered' is the event's start, by the in-progress rule", () => {
  beforeEach(() => {
    stubTheEventMeasuredTo(ScheduledMaintenanceStateRole.Ongoing);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an event started straight into a state of the project's own between Ongoing and Ended starts there", async () => {
    mockTimeline([
      row("scheduled", CREATED_AT),
      row("verifying", at(70)),
      row("ended", at(110)),
      row("completed", at(115)),
    ]);

    const value: ScheduledMaintenanceMeasurementValue = await startDelayRow();

    expect(value.status).toBe(MeasurementStatus.Recorded);
    expect(value.endedAt).toEqual(at(70));
    expect(value.valueInSeconds).toBe(10 * 60);
  });

  test("an event moved on from Ongoing to such a state started when it went Ongoing - the move on is no second start", async () => {
    mockTimeline([
      row("scheduled", CREATED_AT),
      row("ongoing", at(75)),
      row("verifying", at(95)),
      row("ended", at(110)),
    ]);

    const value: ScheduledMaintenanceMeasurementValue = await startDelayRow();

    expect(value.endedAt).toEqual(at(75));
  });

  test("a state of the project's own before Ongoing is no start", async () => {
    mockTimeline([
      row("scheduled", CREATED_AT),
      row("confirmed", at(50)),
      row("ongoing", at(80)),
    ]);

    const value: ScheduledMaintenanceMeasurementValue = await startDelayRow();

    expect(value.endedAt).toEqual(at(80));
  });

  test("a state of the project's own after Ended is no start: an event that never ran never started", async () => {
    mockTimeline([row("scheduled", CREATED_AT), row("reviewing", at(90))]);

    const value: ScheduledMaintenanceMeasurementValue = await startDelayRow();

    expect(value.status).not.toBe(MeasurementStatus.Recorded);
    expect(value.valueInSeconds).toBeNull();
  });
});

describe("a maintenance measurement's 'ended state entered' is the event's end, by the phase rule", () => {
  beforeEach(() => {
    stubTheEventMeasuredTo(ScheduledMaintenanceStateRole.Ended);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an event that went Ongoing, then Ended, then Completed ended at Ended - Completed is no second end", async () => {
    mockTimeline([
      row("scheduled", CREATED_AT),
      row("ongoing", at(75)),
      row("ended", at(110)),
      row("completed", at(115)),
    ]);

    const value: ScheduledMaintenanceMeasurementValue = await measuredRow();

    expect(value.status).toBe(MeasurementStatus.Recorded);
    expect(value.endedAt).toEqual(at(110));
  });

  test("an event completed straight from Ongoing ended there", async () => {
    mockTimeline([
      row("scheduled", CREATED_AT),
      row("ongoing", at(75)),
      row("completed", at(115)),
    ]);

    const value: ScheduledMaintenanceMeasurementValue = await measuredRow();

    expect(value.status).toBe(MeasurementStatus.Recorded);
    expect(value.endedAt).toEqual(at(115));
  });

  test("an event moved from Verifying straight into a state of the project's own after Ended ended there", async () => {
    mockTimeline([
      row("scheduled", CREATED_AT),
      row("verifying", at(75)),
      row("reviewing", at(100)),
      row("completed", at(115)),
    ]);

    const value: ScheduledMaintenanceMeasurementValue = await measuredRow();

    expect(value.endedAt).toEqual(at(100));
  });

  test("an event still in progress has not ended", async () => {
    mockTimeline([
      row("scheduled", CREATED_AT),
      row("ongoing", at(75)),
      row("verifying", at(95)),
    ]);

    const value: ScheduledMaintenanceMeasurementValue = await measuredRow();

    expect(value.status).not.toBe(MeasurementStatus.Recorded);
    expect(value.valueInSeconds).toBeNull();
  });
});

describe("a maintenance measurement's 'completed state entered' is the event's completion, by the phase rule", () => {
  beforeEach(() => {
    stubTheEventMeasuredTo(ScheduledMaintenanceStateRole.Resolved);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an event that went on from Completed to a state of the project's own after it was completed at Completed", async () => {
    mockTimeline([
      row("scheduled", CREATED_AT),
      row("ongoing", at(75)),
      row("ended", at(110)),
      row("completed", at(115)),
      row("archived", at(118)),
    ]);

    const value: ScheduledMaintenanceMeasurementValue = await measuredRow();

    expect(value.status).toBe(MeasurementStatus.Recorded);
    expect(value.endedAt).toEqual(at(115));
  });

  test("an event archived straight from Ended was completed there", async () => {
    mockTimeline([
      row("scheduled", CREATED_AT),
      row("ongoing", at(75)),
      row("ended", at(110)),
      row("archived", at(118)),
    ]);

    const value: ScheduledMaintenanceMeasurementValue = await measuredRow();

    expect(value.status).toBe(MeasurementStatus.Recorded);
    expect(value.endedAt).toEqual(at(118));
  });

  test("an event over but in a state of the project's own before Completed is not complete yet", async () => {
    mockTimeline([
      row("scheduled", CREATED_AT),
      row("ongoing", at(75)),
      row("ended", at(110)),
      row("reviewing", at(112)),
    ]);

    const value: ScheduledMaintenanceMeasurementValue = await measuredRow();

    expect(value.status).not.toBe(MeasurementStatus.Recorded);
    expect(value.valueInSeconds).toBeNull();
  });
});
