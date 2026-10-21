import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MutableMetric from "../../../Models/AnalyticsModels/MutableMetric";
import AIRunService from "../../../Server/Services/AIRunService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import WorkspaceNotificationSummaryService from "../../../Server/Services/WorkspaceNotificationSummaryService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import AlertMetricType from "../../../Types/Alerts/AlertMetricType";
import IncidentMetricType from "../../../Types/Incident/IncidentMetricType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import URL from "../../../Types/API/URL";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceNotificationSummaryItem from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  ALERT_STATE_IDS,
  INCIDENT_STATE_IDS,
  makeAlertStates,
  makeIncidentStates,
  mockProjectStates,
} from "../TestingUtils/Services/ProjectStatesHelper";

/*
 * TIME TO ACKNOWLEDGE, BY THE ONE ACKNOWLEDGED RULE
 * (Common/Utils/AcknowledgedState): the incident's and the alert's metric
 * runs to the first move into a state that counts as acknowledged - the
 * acknowledged state, a state placed after it ("Investigating"), or a
 * resolved one - as the overview's stat bar counts it. Reading the
 * acknowledged flag alone left an incident moved straight into
 * "Investigating" without a time to acknowledge at all.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222223");
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

// A state of the project's own placed between Acknowledged and Resolved.
const INCIDENT_INVESTIGATING: ObjectID = new ObjectID(
  "7c0a3f10-0000-4000-8000-0000000000a9",
);
const ALERT_INVESTIGATING: ObjectID = new ObjectID(
  "7c0a3f10-0000-4000-8000-0000000000b9",
);

const START: Date = new Date("2026-08-10T10:00:00.000Z");

function at(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60 * 1000);
}

function investigating<T extends IncidentState | AlertState>(
  modelType: { new (): T },
  id: ObjectID,
): T {
  const state: T = new modelType();
  state._id = id.toString();
  state.name = "Investigating";
  state.order = 2.5;
  state.isCreatedState = false;
  state.isAcknowledgedState = false;
  state.isResolvedState = false;
  return state;
}

function incidentRow(
  stateId: ObjectID,
  startsAt: Date,
  endsAt?: Date,
): IncidentStateTimeline {
  const timeline: IncidentStateTimeline = new IncidentStateTimeline();
  timeline._id = ObjectID.generate().toString();
  timeline.id = new ObjectID(timeline._id);
  timeline.projectId = PROJECT_ID;
  timeline.incidentStateId = stateId;
  timeline.startsAt = startsAt;

  if (endsAt) {
    timeline.endsAt = endsAt;
  }

  const state: IncidentState = new IncidentState();
  state.name = "State";
  timeline.incidentState = state;

  return timeline;
}

function alertRow(
  stateId: ObjectID,
  startsAt: Date,
  endsAt?: Date,
): AlertStateTimeline {
  const timeline: AlertStateTimeline = new AlertStateTimeline();
  timeline._id = ObjectID.generate().toString();
  timeline.id = new ObjectID(timeline._id);
  timeline.projectId = PROJECT_ID;
  timeline.alertStateId = stateId;
  timeline.startsAt = startsAt;

  if (endsAt) {
    timeline.endsAt = endsAt;
  }

  return timeline;
}

let savedMetrics: Array<MutableMetric> = [];

function metricsNamed(name: string): Array<MutableMetric> {
  return savedMetrics.filter((metric: MutableMetric): boolean => {
    return metric.name === name;
  });
}

beforeEach(() => {
  savedMetrics = [];

  mockProjectStates({
    incidentStates: [
      ...makeIncidentStates(),
      investigating(IncidentState, INCIDENT_INVESTIGATING),
    ],
    alertStates: [
      ...makeAlertStates(),
      investigating(AlertState, ALERT_INVESTIGATING),
    ],
  });

  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.id = INCIDENT_ID;
  incident.projectId = PROJECT_ID;
  incident.createdAt = START;
  incident.declaredAt = START;
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.id = MONITOR_ID;
  monitor.name = "Checkout API";
  incident.monitors = [monitor];
  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = SEVERITY_ID.toString();
  severity.id = SEVERITY_ID;
  severity.name = "Critical";
  incident.incidentSeverity = severity;

  jest
    .spyOn(IncidentService, "findOneById")
    .mockResolvedValue(incident as never);

  const alert: Alert = new Alert();
  alert._id = ALERT_ID.toString();
  alert.id = ALERT_ID;
  alert.projectId = PROJECT_ID;
  alert.createdAt = START;
  alert.monitor = monitor;
  const alertSeverity: AlertSeverity = new AlertSeverity();
  alertSeverity._id = SEVERITY_ID.toString();
  alertSeverity.id = SEVERITY_ID;
  alertSeverity.name = "Critical";
  alert.alertSeverity = alertSeverity;

  jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert as never);

  jest
    .spyOn(IncidentOwnerUserService, "findBy")
    .mockResolvedValue([] as Array<IncidentOwnerUser> as never);
  jest
    .spyOn(IncidentOwnerTeamService, "findBy")
    .mockResolvedValue([] as Array<IncidentOwnerTeam> as never);
  jest
    .spyOn(AIRunService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest.spyOn(GlobalConfigService, "findOneBy").mockResolvedValue(null as never);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MutableMetricService, "replaceEntityMetrics")
    .mockImplementation(
      async (data: { metrics: Array<MutableMetric> }): Promise<void> => {
        savedMetrics.push(...data.metrics);
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an incident's time to acknowledge", () => {
  async function refresh(rows: Array<IncidentStateTimeline>): Promise<void> {
    jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue(rows as never);

    await IncidentService.refreshIncidentMetrics({ incidentId: INCIDENT_ID });
  }

  test("an incident moved straight into a state after Acknowledged was acknowledged then", async () => {
    await refresh([
      incidentRow(INCIDENT_STATE_IDS.created, at(0), at(7)),
      incidentRow(INCIDENT_INVESTIGATING, at(7), at(30)),
      incidentRow(INCIDENT_STATE_IDS.resolved, at(30)),
    ]);

    const metrics: Array<MutableMetric> = metricsNamed(
      IncidentMetricType.TimeToAcknowledge,
    );

    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.value).toBe(7 * 60);
    expect(metrics[0]!.time).toEqual(at(7));
  });

  test("moving on from Acknowledged into a state after it keeps the first acknowledgement", async () => {
    await refresh([
      incidentRow(INCIDENT_STATE_IDS.created, at(0), at(4)),
      incidentRow(INCIDENT_STATE_IDS.acknowledged, at(4), at(9)),
      incidentRow(INCIDENT_INVESTIGATING, at(9)),
    ]);

    expect(metricsNamed(IncidentMetricType.TimeToAcknowledge)[0]!.value).toBe(
      4 * 60,
    );
  });

  test("an incident resolved straight from the start was acknowledged by that resolve", async () => {
    await refresh([
      incidentRow(INCIDENT_STATE_IDS.created, at(0), at(20)),
      incidentRow(INCIDENT_STATE_IDS.resolved, at(20)),
    ]);

    expect(metricsNamed(IncidentMetricType.TimeToAcknowledge)[0]!.value).toBe(
      20 * 60,
    );
  });

  test("an incident still in its first state has no time to acknowledge yet", async () => {
    await refresh([incidentRow(INCIDENT_STATE_IDS.created, at(0))]);

    expect(metricsNamed(IncidentMetricType.TimeToAcknowledge)).toEqual([]);
  });

  test("time in a state says whether the state is acknowledged short of resolved, as it says whether it is resolved", async () => {
    await refresh([
      incidentRow(INCIDENT_STATE_IDS.created, at(0), at(7)),
      incidentRow(INCIDENT_INVESTIGATING, at(7), at(30)),
      incidentRow(INCIDENT_STATE_IDS.resolved, at(30), at(40)),
      incidentRow(INCIDENT_STATE_IDS.closed, at(40)),
    ]);

    const byState: Map<string, JSONObject> = new Map();

    for (const metric of metricsNamed(IncidentMetricType.TimeInState)) {
      const attributes: JSONObject = metric.attributes as JSONObject;
      byState.set(String(attributes["incidentStateId"]), attributes);
    }

    const created: JSONObject = byState.get(
      INCIDENT_STATE_IDS.created.toString(),
    )!;
    const investigatingAttributes: JSONObject = byState.get(
      INCIDENT_INVESTIGATING.toString(),
    )!;
    const resolved: JSONObject = byState.get(
      INCIDENT_STATE_IDS.resolved.toString(),
    )!;

    expect(created["isAcknowledgedState"]).toBe("false");
    expect(investigatingAttributes["isAcknowledgedState"]).toBe("true");
    expect(investigatingAttributes["isResolvedState"]).toBe("false");
    expect(resolved["isAcknowledgedState"]).toBe("false");
    expect(resolved["isResolvedState"]).toBe("true");
  });
});

describe("an alert's time to acknowledge", () => {
  async function refresh(rows: Array<AlertStateTimeline>): Promise<void> {
    jest
      .spyOn(AlertStateTimelineService, "findBy")
      .mockResolvedValue(rows as never);

    await AlertService.refreshAlertMetrics({ alertId: ALERT_ID });
  }

  test("an alert moved straight into a state after Acknowledged was acknowledged then", async () => {
    await refresh([
      alertRow(ALERT_STATE_IDS.created, at(0), at(3)),
      alertRow(ALERT_INVESTIGATING, at(3)),
    ]);

    const metrics: Array<MutableMetric> = metricsNamed(
      AlertMetricType.TimeToAcknowledge,
    );

    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.value).toBe(3 * 60);
  });

  test("an alert still in its first state has no time to acknowledge yet", async () => {
    await refresh([alertRow(ALERT_STATE_IDS.created, at(0))]);

    expect(metricsNamed(AlertMetricType.TimeToAcknowledge)).toEqual([]);
  });
});

/*
 * The workspace summary's MTTA and "who acknowledged" read the same rule: the
 * first move into a state that counts as acknowledged. An incident moved
 * straight into "Investigating" was counted as never acknowledged.
 */
describe("the workspace summary's time to acknowledge", () => {
  type BuildBlocks = (data: {
    blocks: Array<{ text?: string }>;
    items: Array<WorkspaceNotificationSummaryItem>;
    type: WorkspaceNotificationSummaryType;
    fromDate: Date;
    projectId: ObjectID;
  }) => Promise<void>;

  function row(
    stateId: ObjectID,
    createdAt: Date,
    byName: string,
  ): IncidentStateTimeline {
    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline.incidentId = INCIDENT_ID;
    timeline.incidentStateId = stateId;
    timeline.createdAt = createdAt;
    const user: User = new User();
    user.name = byName as never;
    timeline.createdByUser = user;
    return timeline;
  }

  async function summaryLines(
    rows: Array<IncidentStateTimeline>,
  ): Promise<Array<string>> {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.title = "Checkout latency";
    incident.createdAt = START;
    incident.declaredAt = START;
    incident.currentIncidentStateId = rows[rows.length - 1]!.incidentStateId!;

    jest
      .spyOn(IncidentService, "findAllBy")
      .mockResolvedValue([incident] as never);
    jest
      .spyOn(IncidentStateTimelineService, "findAllBy")
      .mockResolvedValue(rows as never);
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.example") as never);

    const blocks: Array<{ text?: string }> = [];

    await (
      WorkspaceNotificationSummaryService as unknown as {
        buildIncidentBlocks: BuildBlocks;
      }
    ).buildIncidentBlocks({
      blocks: blocks,
      items: [WorkspaceNotificationSummaryItem.TimeToAcknowledge],
      type: WorkspaceNotificationSummaryType.Incident,
      fromDate: new Date(START.getTime() - 24 * 60 * 60 * 1000),
      projectId: PROJECT_ID,
    });

    return blocks.map((block: { text?: string }): string => {
      return block.text || "";
    });
  }

  test("an incident moved straight into a state after Acknowledged counts as acknowledged, then", async () => {
    const lines: Array<string> = await summaryLines([
      row(INCIDENT_STATE_IDS.created, at(0), "Monitor"),
      row(INCIDENT_INVESTIGATING, at(7), "Ada"),
    ]);

    const mtta: string | undefined = lines.find((line: string): boolean => {
      return line.includes("MTTA");
    });

    expect(mtta).toContain("**7m**");
    expect(mtta).toContain("_(1 acknowledged)_");
  });

  test("an incident still in its first state is not acknowledged", async () => {
    const lines: Array<string> = await summaryLines([
      row(INCIDENT_STATE_IDS.created, at(0), "Monitor"),
    ]);

    expect(
      lines.find((line: string): boolean => {
        return line.includes("MTTA");
      }),
    ).toContain("_No incidents acknowledged_");
  });
});
