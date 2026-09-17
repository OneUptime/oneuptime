import MutableMetric from "../../../Models/AnalyticsModels/MutableMetric";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentMeasurement from "../../../Models/DatabaseModels/IncidentMeasurement";
import IncidentMeasurementValue from "../../../Models/DatabaseModels/IncidentMeasurementValue";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import IncidentMeasurementService from "../../../Server/Services/IncidentMeasurementService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import logger from "../../../Server/Utils/Logger";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import IncidentMeasurementAnchorType from "../../../Types/Incident/IncidentMeasurementAnchorType";
import IncidentStateRole from "../../../Types/Incident/IncidentStateRole";
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
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const IDENTIFIED_STATE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0001-4000-8000-000000000001",
);
const ACKNOWLEDGED_STATE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0002-4000-8000-000000000002",
);
const MITIGATED_STATE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0003-4000-8000-000000000003",
);
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0004-4000-8000-000000000004",
);
const CLOSED_STATE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0005-4000-8000-000000000005",
);

const IDENTIFIED_TIMELINE_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0001-4000-8000-000000000001",
);
const ACKNOWLEDGED_TIMELINE_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0002-4000-8000-000000000002",
);
const RESOLVED_TIMELINE_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0003-4000-8000-000000000003",
);

const TIME_TO_ACKNOWLEDGE_ID: ObjectID = new ObjectID(
  "cccccccc-0001-4000-8000-000000000001",
);
const TIME_TO_RESOLVE_ID: ObjectID = new ObjectID(
  "cccccccc-0002-4000-8000-000000000002",
);
const TIME_TO_MITIGATE_ID: ObjectID = new ObjectID(
  "cccccccc-0003-4000-8000-000000000003",
);
const TIME_TO_CLOSE_ID: ObjectID = new ObjectID(
  "cccccccc-0004-4000-8000-000000000004",
);
const TIME_TO_DETECT_ID: ObjectID = new ObjectID(
  "cccccccc-0005-4000-8000-000000000005",
);

const METRIC_NAME_PREFIX: string = "oneuptime.incident.measurement.";

/*
 * 2026-08-21 10:00Z is the incident's creation moment. Everything else in
 * this file is expressed as minutes from it so the expected durations can be
 * read off the test without arithmetic.
 */
function at(minutes: number): Date {
  return new Date(Date.UTC(2026, 7, 21, 10, minutes, 0));
}

// Recorded before the incident existed, which is legitimate for impact onset.
const IMPACT_STARTED_AT: Date = at(-60);

interface ReplaceEntityMetricsCall {
  projectId: ObjectID;
  primaryEntityId: ObjectID;
  primaryEntityType: ServiceType;
  metricNames: Array<string>;
  metrics: Array<MutableMetric>;
  retentionDate: Date;
}

interface UpdateCall {
  id: ObjectID;
  data: Record<string, unknown>;
}

function buildIncident(input: { impactStartedAt?: Date } = {}): Incident {
  const incident: Incident = new Incident();

  incident._id = INCIDENT_ID.toString();
  incident.id = INCIDENT_ID;
  incident.projectId = PROJECT_ID;
  incident.createdAt = at(0);
  incident.declaredAt = at(0);

  if (input.impactStartedAt) {
    incident.impactStartedAt = input.impactStartedAt;
  }

  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = SEVERITY_ID.toString();
  severity.id = SEVERITY_ID;
  severity.name = "Critical";
  incident.incidentSeverity = severity;

  return incident;
}

function buildTimelineEntry(input: {
  id: ObjectID;
  stateId: ObjectID;
  stateName: string;
  order: number;
  startsAt: Date;
  isCreatedState?: boolean;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}): IncidentStateTimeline {
  const entry: IncidentStateTimeline = new IncidentStateTimeline();

  entry._id = input.id.toString();
  entry.id = input.id;
  entry.projectId = PROJECT_ID;
  entry.incidentId = INCIDENT_ID;
  entry.incidentStateId = input.stateId;
  entry.startsAt = input.startsAt;

  const state: IncidentState = new IncidentState();

  state._id = input.stateId.toString();
  state.id = input.stateId;
  state.name = input.stateName;
  state.order = input.order;
  state.isCreatedState = input.isCreatedState || false;
  state.isAcknowledgedState = input.isAcknowledgedState || false;
  state.isResolvedState = input.isResolvedState || false;

  entry.incidentState = state;

  return entry;
}

/*
 * Identified(1) at +0, Acknowledged(2) at +5, Resolved(4) at +30. The project
 * also defines Mitigated(3) and Closed(5); this incident entered neither, one
 * because it was jumped over and one because it has not got there yet.
 */
function defaultTimeline(): Array<IncidentStateTimeline> {
  return [
    buildTimelineEntry({
      id: IDENTIFIED_TIMELINE_ID,
      stateId: IDENTIFIED_STATE_ID,
      stateName: "Identified",
      order: 1,
      startsAt: at(0),
      isCreatedState: true,
    }),
    buildTimelineEntry({
      id: ACKNOWLEDGED_TIMELINE_ID,
      stateId: ACKNOWLEDGED_STATE_ID,
      stateName: "Acknowledged",
      order: 2,
      startsAt: at(5),
      isAcknowledgedState: true,
    }),
    buildTimelineEntry({
      id: RESOLVED_TIMELINE_ID,
      stateId: RESOLVED_STATE_ID,
      stateName: "Resolved",
      order: 4,
      startsAt: at(30),
      isResolvedState: true,
    }),
  ];
}

function buildMeasurement(input: {
  id: ObjectID;
  key: string;
  name: string;
  startAnchorType: IncidentMeasurementAnchorType;
  endAnchorType: IncidentMeasurementAnchorType;
  startStateRole?: IncidentStateRole;
  endStateRole?: IncidentStateRole;
  startState?: { id: ObjectID; name: string; order: number };
  endState?: { id: ObjectID; name: string; order: number };
  isEnabled?: boolean;
  unit?: string;
  description?: string;
}): IncidentMeasurement {
  const measurement: IncidentMeasurement = new IncidentMeasurement();

  measurement._id = input.id.toString();
  measurement.id = input.id;
  measurement.projectId = PROJECT_ID;
  measurement.name = input.name;
  measurement.key = input.key;
  measurement.metricName = METRIC_NAME_PREFIX + input.key;
  measurement.isEnabled = input.isEnabled ?? true;
  measurement.startAnchorType = input.startAnchorType;
  measurement.endAnchorType = input.endAnchorType;

  if (input.description) {
    measurement.description = input.description;
  }

  if (input.unit) {
    measurement.unit = input.unit;
  }

  if (input.startStateRole) {
    measurement.startIncidentStateRole = input.startStateRole;
  }

  if (input.endStateRole) {
    measurement.endIncidentStateRole = input.endStateRole;
  }

  if (input.startState) {
    const state: IncidentState = new IncidentState();
    state._id = input.startState.id.toString();
    state.id = input.startState.id;
    state.name = input.startState.name;
    state.order = input.startState.order;
    measurement.startIncidentStateId = input.startState.id;
    measurement.startIncidentState = state;
  }

  if (input.endState) {
    const state: IncidentState = new IncidentState();
    state._id = input.endState.id.toString();
    state.id = input.endState.id;
    state.name = input.endState.name;
    state.order = input.endState.order;
    measurement.endIncidentStateId = input.endState.id;
    measurement.endIncidentState = state;
  }

  return measurement;
}

// Created(+0) -> Acknowledged(+5). Recorded, 300 seconds.
function timeToAcknowledge(
  overrides: { isEnabled?: boolean } = {},
): IncidentMeasurement {
  return buildMeasurement({
    id: TIME_TO_ACKNOWLEDGE_ID,
    key: "time-to-acknowledge",
    name: "Time to Acknowledge",
    description: "How long until somebody picked it up",
    unit: "seconds",
    startAnchorType: IncidentMeasurementAnchorType.StateRoleEntered,
    startStateRole: IncidentStateRole.Created,
    endAnchorType: IncidentMeasurementAnchorType.StateRoleEntered,
    endStateRole: IncidentStateRole.Acknowledged,
    isEnabled: overrides.isEnabled ?? true,
  });
}

// Created(+0) -> Resolved(+30). Recorded, 1800 seconds.
function timeToResolve(): IncidentMeasurement {
  return buildMeasurement({
    id: TIME_TO_RESOLVE_ID,
    key: "time-to-resolve",
    name: "Time to Resolve",
    startAnchorType: IncidentMeasurementAnchorType.StateRoleEntered,
    startStateRole: IncidentStateRole.Created,
    endAnchorType: IncidentMeasurementAnchorType.StateRoleEntered,
    endStateRole: IncidentStateRole.Resolved,
  });
}

/*
 * Ends at Mitigated(3), which the incident jumped over on its way to
 * Resolved(4). It can never be entered now.
 */
function timeToMitigate(): IncidentMeasurement {
  return buildMeasurement({
    id: TIME_TO_MITIGATE_ID,
    key: "time-to-mitigate",
    name: "Time to Mitigate",
    startAnchorType: IncidentMeasurementAnchorType.CreatedAt,
    endAnchorType: IncidentMeasurementAnchorType.StateEntered,
    endState: { id: MITIGATED_STATE_ID, name: "Mitigated", order: 3 },
  });
}

// Ends at Closed(5), which is still ahead of the incident.
function timeToClose(): IncidentMeasurement {
  return buildMeasurement({
    id: TIME_TO_CLOSE_ID,
    key: "time-to-close",
    name: "Time to Close",
    startAnchorType: IncidentMeasurementAnchorType.CreatedAt,
    endAnchorType: IncidentMeasurementAnchorType.StateEntered,
    endState: { id: CLOSED_STATE_ID, name: "Closed", order: 5 },
  });
}

/*
 * Created At(+0) -> Impact Started At(-60). Both ends resolve, but the end
 * lands an hour before the start: somebody's recorded timestamps disagree.
 */
function timeToDetect(): IncidentMeasurement {
  return buildMeasurement({
    id: TIME_TO_DETECT_ID,
    key: "time-to-detect",
    name: "Time to Detect",
    startAnchorType: IncidentMeasurementAnchorType.CreatedAt,
    endAnchorType: IncidentMeasurementAnchorType.ImpactStartedAt,
  });
}

function buildExistingValueRow(input: {
  id: ObjectID;
  measurementId: ObjectID;
}): IncidentMeasurementValue {
  const row: IncidentMeasurementValue = new IncidentMeasurementValue();

  row._id = input.id.toString();
  row.id = input.id;
  row.projectId = PROJECT_ID;
  row.incidentId = INCIDENT_ID;
  row.incidentMeasurementId = input.measurementId;

  return row;
}

describe("IncidentMeasurementValueService.recomputeForIncident", () => {
  let createdRows: Array<IncidentMeasurementValue>;
  let updateCalls: Array<UpdateCall>;
  let replaceCalls: Array<ReplaceEntityMetricsCall>;

  function mockDefinitions(measurements: Array<IncidentMeasurement>): void {
    jest
      .spyOn(IncidentMeasurementService, "findBy")
      .mockResolvedValue(measurements as never);
  }

  function mockTimeline(entries: Array<IncidentStateTimeline>): void {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue(entries as never);
  }

  function mockExistingValueRows(rows: Array<IncidentMeasurementValue>): void {
    jest
      .spyOn(IncidentMeasurementValueService, "findBy")
      .mockResolvedValue(rows as never);
  }

  function emittedMetrics(): Array<MutableMetric> {
    return replaceCalls[0]?.metrics || [];
  }

  function emittedMetricNames(): Array<string> {
    return emittedMetrics().map((metric: MutableMetric) => {
      return metric.name || "";
    });
  }

  function createdRowFor(measurementId: ObjectID): IncidentMeasurementValue {
    const row: IncidentMeasurementValue | undefined = createdRows.find(
      (candidate: IncidentMeasurementValue) => {
        return (
          candidate.incidentMeasurementId?.toString() ===
          measurementId.toString()
        );
      },
    );

    expect(row).toBeDefined();

    return row!;
  }

  beforeEach(() => {
    createdRows = [];
    updateCalls = [];
    replaceCalls = [];

    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(
        buildIncident({ impactStartedAt: IMPACT_STARTED_AT }) as never,
      );

    mockDefinitions([timeToAcknowledge(), timeToResolve()]);
    mockTimeline(defaultTimeline());
    mockExistingValueRows([]);

    jest
      .spyOn(IncidentMeasurementValueService, "create")
      .mockImplementation((async (createBy: {
        data: IncidentMeasurementValue;
      }): Promise<IncidentMeasurementValue> => {
        createdRows.push(createBy.data);
        return createBy.data;
      }) as never);

    jest
      .spyOn(IncidentMeasurementValueService, "updateOneById")
      .mockImplementation((async (updateBy: {
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<number> => {
        updateCalls.push({ id: updateBy.id, data: updateBy.data });
        return 1;
      }) as never);

    jest
      .spyOn(IncidentMeasurementValueService, "findOneBy")
      .mockResolvedValue(null as never);

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

  test("computes one value row per definition, each with its own duration", async () => {
    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    expect(createdRows).toHaveLength(2);

    const acknowledge: IncidentMeasurementValue = createdRowFor(
      TIME_TO_ACKNOWLEDGE_ID,
    );
    const resolve: IncidentMeasurementValue = createdRowFor(TIME_TO_RESOLVE_ID);

    expect(acknowledge.status).toBe(MeasurementStatus.Recorded);
    expect(acknowledge.valueInSeconds).toBe(5 * 60);
    expect(acknowledge.startedAt).toEqual(at(0));
    expect(acknowledge.endedAt).toEqual(at(5));

    expect(resolve.status).toBe(MeasurementStatus.Recorded);
    expect(resolve.valueInSeconds).toBe(30 * 60);
  });

  test("stamps each row with the timeline entries it was derived from, so a number can be traced back", async () => {
    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    const acknowledge: IncidentMeasurementValue = createdRowFor(
      TIME_TO_ACKNOWLEDGE_ID,
    );

    expect(acknowledge.startIncidentStateTimelineId?.toString()).toBe(
      IDENTIFIED_TIMELINE_ID.toString(),
    );
    expect(acknowledge.endIncidentStateTimelineId?.toString()).toBe(
      ACKNOWLEDGED_TIMELINE_ID.toString(),
    );
  });

  test("a skipped milestone is written as Not Applicable with no number, so it cannot drag an average towards zero", async () => {
    mockDefinitions([timeToMitigate()]);

    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    const mitigate: IncidentMeasurementValue =
      createdRowFor(TIME_TO_MITIGATE_ID);

    expect(mitigate.status).toBe(MeasurementStatus.NotApplicable);
    expect(mitigate.valueInSeconds).toBeNull();
    expect(mitigate.statusMessage).toContain("skipped");

    // The row exists so the page can say why; the chart gets nothing at all.
    expect(emittedMetrics()).toHaveLength(0);
  });

  test("a milestone still ahead of the incident is Pending, and stays out of the charts until it happens", async () => {
    mockDefinitions([timeToClose()]);

    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    const close: IncidentMeasurementValue = createdRowFor(TIME_TO_CLOSE_ID);

    expect(close.status).toBe(MeasurementStatus.Pending);
    expect(close.valueInSeconds).toBeNull();
    expect(emittedMetrics()).toHaveLength(0);
  });

  test("an end that precedes its start is written as Invalid and says so, rather than being clamped to zero", async () => {
    mockDefinitions([timeToDetect()]);

    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    const detect: IncidentMeasurementValue = createdRowFor(TIME_TO_DETECT_ID);

    expect(detect.status).toBe(MeasurementStatus.Invalid);
    expect(detect.valueInSeconds).toBeNull();
    expect(detect.statusMessage).toContain("precedes");
    // Both timestamps are kept, because they are the evidence of the mistake.
    expect(detect.startedAt).toEqual(at(0));
    expect(detect.endedAt).toEqual(IMPACT_STARTED_AT);

    expect(emittedMetrics()).toHaveLength(0);
  });

  test("out of a mixed batch only the Recorded values become metric points", async () => {
    mockDefinitions([
      timeToAcknowledge(),
      timeToMitigate(),
      timeToClose(),
      timeToDetect(),
    ]);

    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    // Every definition still gets a stored row.
    expect(createdRows).toHaveLength(4);

    expect(emittedMetricNames()).toEqual([
      `${METRIC_NAME_PREFIX}time-to-acknowledge`,
    ]);
  });

  test("a disabled definition keeps its metric name in the tombstone scope, so its old points leave the charts", async () => {
    /*
     * The tombstone pass diffs live points against the desired set scoped to
     * `metricNames`. Dropping a disabled definition's name from that list
     * would leave its points live in every chart until the retention date --
     * disabling it would visibly do nothing.
     */
    mockDefinitions([timeToAcknowledge({ isEnabled: false }), timeToResolve()]);

    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    const disabledName: string = `${METRIC_NAME_PREFIX}time-to-acknowledge`;

    expect(replaceCalls).toHaveLength(1);
    expect(replaceCalls[0]!.metricNames).toContain(disabledName);
    expect(emittedMetricNames()).not.toContain(disabledName);
    expect(emittedMetricNames()).toEqual([
      `${METRIC_NAME_PREFIX}time-to-resolve`,
    ]);

    // The stored value is still computed; only the chart series goes away.
    expect(createdRowFor(TIME_TO_ACKNOWLEDGE_ID).valueInSeconds).toBe(5 * 60);
  });

  test("gives every definition its own metric point identity, so one refresh cannot overwrite another", async () => {
    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    const pointIds: Array<string> = emittedMetrics().map(
      (metric: MutableMetric) => {
        return metric.metricPointId || "";
      },
    );

    expect(pointIds).toEqual([
      `measurement:${TIME_TO_ACKNOWLEDGE_ID.toString()}`,
      `measurement:${TIME_TO_RESOLVE_ID.toString()}`,
    ]);
    expect(new Set(pointIds).size).toBe(2);
  });

  test("labels every metric point with the definition it came from, so a chart can be filtered to one measurement", async () => {
    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    const attributes: JSONObject = emittedMetrics()[0]
      ?.attributes as JSONObject;

    expect(attributes["oneuptime.measurement.id"]).toBe(
      TIME_TO_ACKNOWLEDGE_ID.toString(),
    );
    expect(attributes["oneuptime.measurement.key"]).toBe("time-to-acknowledge");
    expect(attributes["oneuptime.measurement.name"]).toBe(
      "Time to Acknowledge",
    );

    // The incident's own dimensions are still carried alongside.
    expect(attributes["incidentId"]).toBe(INCIDENT_ID.toString());
    expect(attributes["projectId"]).toBe(PROJECT_ID.toString());
    expect(attributes["incidentSeverityName"]).toBe("Critical");
  });

  test("writes the points against the incident as an Incident entity", async () => {
    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    expect(replaceCalls[0]!.primaryEntityType).toBe(ServiceType.Incident);
    expect(replaceCalls[0]!.primaryEntityId.toString()).toBe(
      INCIDENT_ID.toString(),
    );
    expect(emittedMetrics()[0]!.time).toEqual(at(5));
    expect(emittedMetrics()[0]!.value).toBe(5 * 60);
  });

  test("updates the existing row on a second recompute instead of inserting a duplicate", async () => {
    const existingId: ObjectID = new ObjectID(
      "dddddddd-0001-4000-8000-000000000001",
    );

    mockDefinitions([timeToAcknowledge()]);
    mockExistingValueRows([
      buildExistingValueRow({
        id: existingId,
        measurementId: TIME_TO_ACKNOWLEDGE_ID,
      }),
    ]);

    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    expect(createdRows).toHaveLength(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.id.toString()).toBe(existingId.toString());
    expect(updateCalls[0]!.data["valueInSeconds"]).toBe(5 * 60);
    expect(updateCalls[0]!.data["status"]).toBe(MeasurementStatus.Recorded);
  });

  test("clears the old number when a recorded value turns Invalid, rather than leaving a stale one on the page", async () => {
    const existingId: ObjectID = new ObjectID(
      "dddddddd-0002-4000-8000-000000000002",
    );

    mockDefinitions([timeToDetect()]);
    mockExistingValueRows([
      buildExistingValueRow({
        id: existingId,
        measurementId: TIME_TO_DETECT_ID,
      }),
    ]);

    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.data["status"]).toBe(MeasurementStatus.Invalid);
    // Written as NULL, not omitted from the update.
    expect(updateCalls[0]!.data).toHaveProperty("valueInSeconds");
    expect(updateCalls[0]!.data["valueInSeconds"]).toBeNull();
  });

  test("clears the old number when a recorded value turns Not Applicable", async () => {
    const existingId: ObjectID = new ObjectID(
      "dddddddd-0003-4000-8000-000000000003",
    );

    mockDefinitions([timeToMitigate()]);
    mockExistingValueRows([
      buildExistingValueRow({
        id: existingId,
        measurementId: TIME_TO_MITIGATE_ID,
      }),
    ]);

    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.data["valueInSeconds"]).toBeNull();
    expect(updateCalls[0]!.data["endedAt"]).toBeNull();
    expect(updateCalls[0]!.data["endIncidentStateTimelineId"]).toBeNull();
  });

  test("resolves a lost insert race by updating the row the other pod wrote", async () => {
    const racedId: ObjectID = new ObjectID(
      "dddddddd-0004-4000-8000-000000000004",
    );

    mockDefinitions([timeToAcknowledge()]);

    jest
      .spyOn(IncidentMeasurementValueService, "create")
      .mockRejectedValue(
        new Error(
          'duplicate key value violates unique constraint "IncidentMeasurementValue_incidentId_incidentMeasurementId"',
        ) as never,
      );

    jest.spyOn(IncidentMeasurementValueService, "findOneBy").mockResolvedValue(
      buildExistingValueRow({
        id: racedId,
        measurementId: TIME_TO_ACKNOWLEDGE_ID,
      }) as never,
    );

    await expect(
      IncidentMeasurementValueService.recomputeForIncident({
        incidentId: INCIDENT_ID,
      }),
    ).resolves.toBeUndefined();

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.id.toString()).toBe(racedId.toString());
    expect(updateCalls[0]!.data["valueInSeconds"]).toBe(5 * 60);
  });

  test("rethrows an insert failure that is not a lost race, so a real write error is not swallowed", async () => {
    mockDefinitions([timeToAcknowledge()]);

    jest
      .spyOn(IncidentMeasurementValueService, "create")
      .mockRejectedValue(new Error("connection terminated") as never);

    await expect(
      IncidentMeasurementValueService.recomputeForIncident({
        incidentId: INCIDENT_ID,
      }),
    ).rejects.toThrow("connection terminated");

    expect(updateCalls).toHaveLength(0);
  });

  test("writes nothing at all for a project that has defined no measurements", async () => {
    mockDefinitions([]);

    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    expect(IncidentStateTimelineService.findBy).not.toHaveBeenCalled();
    expect(IncidentMeasurementValueService.findBy).not.toHaveBeenCalled();
    expect(createdRows).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
    expect(replaceCalls).toHaveLength(0);
  });

  test("writes nothing when the incident no longer exists", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);

    await IncidentMeasurementValueService.recomputeForIncident({
      incidentId: INCIDENT_ID,
    });

    expect(IncidentMeasurementService.findBy).not.toHaveBeenCalled();
    expect(createdRows).toHaveLength(0);
    expect(replaceCalls).toHaveLength(0);
  });

  test("keeps the stored value rows when ClickHouse is down, because a metrics outage should cost the charts and not the incident", async () => {
    const loggedErrors: Array<unknown> = [];

    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      loggedErrors.push(message);
    });

    jest
      .spyOn(MutableMetricService, "replaceEntityMetrics")
      .mockRejectedValue(new Error("ClickHouse is unreachable") as never);

    await expect(
      IncidentMeasurementValueService.recomputeForIncident({
        incidentId: INCIDENT_ID,
      }),
    ).resolves.toBeUndefined();

    expect(createdRows).toHaveLength(2);
    expect(createdRowFor(TIME_TO_ACKNOWLEDGE_ID).valueInSeconds).toBe(5 * 60);
    expect(createdRowFor(TIME_TO_RESOLVE_ID).valueInSeconds).toBe(30 * 60);

    // Swallowed for the caller, but not silently: the outage is still logged.
    expect(loggedErrors).toHaveLength(1);
  });
});
