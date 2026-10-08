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
 */

const EVENT_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-000000000001");

function at(minutes: number): Date {
  return new Date(Date.UTC(2026, 7, 21, 10, minutes, 0));
}

const CREATED_AT: Date = at(0);
const SCHEDULED_STARTS_AT: Date = at(60);

let rowNumber: number = 0;

function row(key: ProgressStateKey, startsAt: Date): ScheduledMaintenanceStateTimeline {
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
  measurement.metricName = "oneuptime.scheduled-maintenance.measurement.start-delay";
  measurement.isEnabled = true;
  measurement.startAnchorType =
    ScheduledMaintenanceMeasurementAnchorType.ScheduledStartsAt;
  measurement.endAnchorType =
    ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered;
  measurement.endScheduledMaintenanceStateRole = role;
  return measurement;
}

describe("a maintenance measurement's 'ongoing state entered' is the event's start, by the in-progress rule", () => {
  let createdRows: Array<ScheduledMaintenanceMeasurementValue> = [];

  function mockTimeline(rows: Array<ScheduledMaintenanceStateTimeline>): void {
    jest
      .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
      .mockResolvedValue(rows as never);
  }

  async function startDelayRow(): Promise<ScheduledMaintenanceMeasurementValue> {
    await ScheduledMaintenanceMeasurementValueService.recomputeForScheduledMaintenance(
      { scheduledMaintenanceId: EVENT_ID },
    );

    expect(createdRows).toHaveLength(1);
    return createdRows[0]!;
  }

  beforeEach(() => {
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
      .mockResolvedValue([
        measurementTo(ScheduledMaintenanceStateRole.Ongoing),
      ] as never);
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
    jest.spyOn(GlobalConfigService, "findOneBy").mockResolvedValue(null as never);
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MutableMetricService, "replaceEntityMetrics")
      .mockResolvedValue(undefined as never);
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
