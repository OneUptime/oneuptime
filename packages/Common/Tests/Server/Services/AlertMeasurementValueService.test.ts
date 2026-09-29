import MutableMetric from "../../../Models/AnalyticsModels/MutableMetric";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertMeasurement from "../../../Models/DatabaseModels/AlertMeasurement";
import AlertMeasurementValue from "../../../Models/DatabaseModels/AlertMeasurementValue";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import AlertMeasurementService from "../../../Server/Services/AlertMeasurementService";
import AlertMeasurementValueService from "../../../Server/Services/AlertMeasurementValueService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import AlertMeasurementAnchorType from "../../../Types/Alerts/AlertMeasurementAnchorType";
import AlertStateRole from "../../../Types/Alerts/AlertStateRole";
import { JSONObject } from "../../../Types/JSON";
import MeasurementStatus from "../../../Types/Measurement/MeasurementStatus";
import ObjectID from "../../../Types/ObjectID";
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
const ALERT_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const CREATED_STATE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0001-4000-8000-000000000001",
);
const ACKNOWLEDGED_STATE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0002-4000-8000-000000000002",
);
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0003-4000-8000-000000000003",
);

const TIME_TO_ACKNOWLEDGE_ID: ObjectID = new ObjectID(
  "cccccccc-0001-4000-8000-000000000001",
);
const TIME_TO_RESOLVE_ID: ObjectID = new ObjectID(
  "cccccccc-0002-4000-8000-000000000002",
);

const METRIC_NAME_PREFIX: string = "oneuptime.alert.measurement.";

function at(minutes: number): Date {
  return new Date(Date.UTC(2026, 7, 21, 10, minutes, 0));
}

interface ReplaceEntityMetricsCall {
  projectId: ObjectID;
  primaryEntityId: ObjectID;
  primaryEntityType: ServiceType;
  metricNames: Array<string>;
  metrics: Array<MutableMetric>;
  retentionDate: Date;
}

function buildAlert(): Alert {
  const alert: Alert = new Alert();

  alert._id = ALERT_ID.toString();
  alert.id = ALERT_ID;
  alert.projectId = PROJECT_ID;
  // Deliberately earlier than the first timeline row -- see the anchor test.
  alert.createdAt = at(0);

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.id = MONITOR_ID;
  monitor.name = "Checkout API";
  alert.monitor = monitor;

  const severity: AlertSeverity = new AlertSeverity();
  severity._id = SEVERITY_ID.toString();
  severity.id = SEVERITY_ID;
  severity.name = "Warning";
  alert.alertSeverity = severity;

  return alert;
}

function buildTimelineEntry(input: {
  stateId: ObjectID;
  stateName: string;
  order: number;
  startsAt: Date;
  isCreatedState?: boolean;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}): AlertStateTimeline {
  const entry: AlertStateTimeline = new AlertStateTimeline();

  entry._id = `bbbbbbbb-000${input.order}-4000-8000-00000000000${input.order}`;
  entry.id = new ObjectID(entry._id);
  entry.projectId = PROJECT_ID;
  entry.alertId = ALERT_ID;
  entry.alertStateId = input.stateId;
  entry.startsAt = input.startsAt;

  const state: AlertState = new AlertState();
  state._id = input.stateId.toString();
  state.id = input.stateId;
  state.name = input.stateName;
  state.order = input.order;
  state.isCreatedState = input.isCreatedState || false;
  state.isAcknowledgedState = input.isAcknowledgedState || false;
  state.isResolvedState = input.isResolvedState || false;
  entry.alertState = state;

  return entry;
}

/*
 * The alert is created at +0 but its first timeline row is only written at
 * +2. The gap is what makes the Timeline Start anchor test meaningful.
 */
function defaultTimeline(): Array<AlertStateTimeline> {
  return [
    buildTimelineEntry({
      stateId: CREATED_STATE_ID,
      stateName: "Created",
      order: 1,
      startsAt: at(2),
      isCreatedState: true,
    }),
    buildTimelineEntry({
      stateId: ACKNOWLEDGED_STATE_ID,
      stateName: "Acknowledged",
      order: 2,
      startsAt: at(5),
      isAcknowledgedState: true,
    }),
    buildTimelineEntry({
      stateId: RESOLVED_STATE_ID,
      stateName: "Resolved",
      order: 3,
      startsAt: at(30),
      isResolvedState: true,
    }),
  ];
}

function buildMeasurement(input: {
  id: ObjectID;
  key: string;
  name: string;
  startAnchorType: AlertMeasurementAnchorType;
  endAnchorType: AlertMeasurementAnchorType;
  startStateRole?: AlertStateRole;
  endStateRole?: AlertStateRole;
}): AlertMeasurement {
  const measurement: AlertMeasurement = new AlertMeasurement();

  measurement._id = input.id.toString();
  measurement.id = input.id;
  measurement.projectId = PROJECT_ID;
  measurement.name = input.name;
  measurement.key = input.key;
  measurement.metricName = METRIC_NAME_PREFIX + input.key;
  measurement.isEnabled = true;
  measurement.startAnchorType = input.startAnchorType;
  measurement.endAnchorType = input.endAnchorType;

  if (input.startStateRole) {
    measurement.startAlertStateRole = input.startStateRole;
  }

  if (input.endStateRole) {
    measurement.endAlertStateRole = input.endStateRole;
  }

  return measurement;
}

// Timeline Start -> the acknowledged state.
function timeToAcknowledge(): AlertMeasurement {
  return buildMeasurement({
    id: TIME_TO_ACKNOWLEDGE_ID,
    key: "time-to-acknowledge",
    name: "Time to Acknowledge",
    startAnchorType: AlertMeasurementAnchorType.TimelineStart,
    endAnchorType: AlertMeasurementAnchorType.StateRoleEntered,
    endStateRole: AlertStateRole.Acknowledged,
  });
}

// Created At -> the resolved state.
function timeToResolve(): AlertMeasurement {
  return buildMeasurement({
    id: TIME_TO_RESOLVE_ID,
    key: "time-to-resolve",
    name: "Time to Resolve",
    startAnchorType: AlertMeasurementAnchorType.CreatedAt,
    endAnchorType: AlertMeasurementAnchorType.StateRoleEntered,
    endStateRole: AlertStateRole.Resolved,
  });
}

describe("AlertMeasurementValueService.recomputeForAlert", () => {
  let createdRows: Array<AlertMeasurementValue>;
  let replaceCalls: Array<ReplaceEntityMetricsCall>;

  function mockDefinitions(measurements: Array<AlertMeasurement>): void {
    jest
      .spyOn(AlertMeasurementService, "findBy")
      .mockResolvedValue(measurements as never);
  }

  async function recompute(): Promise<void> {
    await AlertMeasurementValueService.recomputeForAlert({
      alertId: ALERT_ID,
    });
  }

  function createdRowFor(measurementId: ObjectID): AlertMeasurementValue {
    const row: AlertMeasurementValue | undefined = createdRows.find(
      (candidate: AlertMeasurementValue) => {
        return (
          candidate.alertMeasurementId?.toString() === measurementId.toString()
        );
      },
    );

    expect(row).toBeDefined();

    return row!;
  }

  beforeEach(() => {
    createdRows = [];
    replaceCalls = [];

    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(buildAlert() as never);
    jest
      .spyOn(AlertStateTimelineService, "findBy")
      .mockResolvedValue(defaultTimeline() as never);
    mockDefinitions([timeToAcknowledge(), timeToResolve()]);

    jest
      .spyOn(AlertMeasurementValueService, "findBy")
      .mockResolvedValue([] as Array<AlertMeasurementValue> as never);
    jest
      .spyOn(AlertMeasurementValueService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(AlertMeasurementValueService, "create")
      .mockImplementation((async (createBy: {
        data: AlertMeasurementValue;
      }): Promise<AlertMeasurementValue> => {
        createdRows.push(createBy.data);
        return createBy.data;
      }) as never);
    jest
      .spyOn(AlertMeasurementValueService, "updateOneById")
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

  test("anchors Timeline Start to the alert's creation, not to its first state row", async () => {
    /*
     * An alert has no declaredAt, so Timeline Start is createdAt. Resolving it
     * to the first timeline row instead would quietly disagree with the
     * built-in alert metrics -- here by the two minutes it took to write that
     * row.
     */
    await recompute();

    expect(createdRowFor(TIME_TO_ACKNOWLEDGE_ID).startedAt).toEqual(at(0));
    expect(createdRowFor(TIME_TO_ACKNOWLEDGE_ID).valueInSeconds).toBe(5 * 60);
  });

  test("resolves the acknowledged and resolved roles from the alert state flags", async () => {
    await recompute();

    expect(createdRowFor(TIME_TO_ACKNOWLEDGE_ID).status).toBe(
      MeasurementStatus.Recorded,
    );
    expect(createdRowFor(TIME_TO_ACKNOWLEDGE_ID).endedAt).toEqual(at(5));
    expect(createdRowFor(TIME_TO_RESOLVE_ID).endedAt).toEqual(at(30));
    expect(createdRowFor(TIME_TO_RESOLVE_ID).valueInSeconds).toBe(30 * 60);
  });

  test("writes the points against the alert as an Alert entity, so they cannot collide with incident points", async () => {
    await recompute();

    expect(replaceCalls).toHaveLength(1);
    expect(replaceCalls[0]!.primaryEntityType).toBe(ServiceType.Alert);
    expect(replaceCalls[0]!.primaryEntityId.toString()).toBe(
      ALERT_ID.toString(),
    );
  });

  test("names alert measurement metrics under the alert prefix", async () => {
    await recompute();

    expect(replaceCalls[0]!.metricNames).toEqual([
      "oneuptime.alert.measurement.time-to-acknowledge",
      "oneuptime.alert.measurement.time-to-resolve",
    ]);
    expect(
      replaceCalls[0]!.metrics.map((metric: MutableMetric) => {
        return metric.name;
      }),
    ).toEqual([
      "oneuptime.alert.measurement.time-to-acknowledge",
      "oneuptime.alert.measurement.time-to-resolve",
    ]);
  });

  test("carries the alert's single monitor as monitorId/monitorName, matching the rest of the alert metrics", async () => {
    /*
     * An alert belongs to one monitor, unlike an incident which carries a list.
     * Emitting the plural incident dimensions here would make an alert chart
     * impossible to group by monitor.
     */
    await recompute();

    const attributes: JSONObject = replaceCalls[0]!.metrics[0]!
      .attributes as JSONObject;

    expect(attributes["monitorId"]).toBe(MONITOR_ID.toString());
    expect(attributes["monitorName"]).toBe("Checkout API");
    expect(attributes["monitorIds"]).toBeUndefined();
    expect(attributes["monitorNames"]).toBeUndefined();

    expect(attributes["alertId"]).toBe(ALERT_ID.toString());
    expect(attributes["alertSeverityName"]).toBe("Warning");
    expect(attributes["oneuptime.measurement.key"]).toBe("time-to-acknowledge");
  });

  test("leaves an unrecorded impact time Pending rather than declaring it never happened", async () => {
    /*
     * Impact onset is typed in by a person after the fact, so a blank one on an
     * open alert is still coming.
     */
    mockDefinitions([
      buildMeasurement({
        id: TIME_TO_ACKNOWLEDGE_ID,
        key: "time-to-detect",
        name: "Time to Detect",
        startAnchorType: AlertMeasurementAnchorType.ImpactStartedAt,
        endAnchorType: AlertMeasurementAnchorType.CreatedAt,
      }),
    ]);

    await recompute();

    const row: AlertMeasurementValue = createdRowFor(TIME_TO_ACKNOWLEDGE_ID);

    expect(row.status).toBe(MeasurementStatus.Pending);
    expect(row.valueInSeconds).toBeNull();
    expect(replaceCalls[0]!.metrics).toHaveLength(0);
  });
});
