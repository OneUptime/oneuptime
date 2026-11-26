import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ProjectMilestoneService from "../../../../Server/Services/ProjectMilestoneService";
import ProjectService from "../../../../Server/Services/ProjectService";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorEvaluationClock from "../../../../Server/Utils/Monitor/MonitorEvaluationClock";
import MonitorHeartbeatState from "../../../../Server/Utils/Monitor/MonitorHeartbeatState";
import MonitorLogUtil from "../../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorNotEvaluated, {
  MONITOR_NOT_EVALUATED_SELECT,
} from "../../../../Server/Utils/Monitor/MonitorNotEvaluated";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ServerMonitorResponse from "../../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import { MonitorPauseReason } from "../../../../Utils/Monitor/MonitorPauseState";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * WHAT REACHES A MONITOR THAT IS NOT BEING CHECKED (issue #11141).
 *
 * An Incoming Request monitor's requests, an Incoming Email monitor's emails
 * and a Server monitor's agent reports are sent from outside whatever the
 * monitor is doing. While it is paused - by an incident declared by hand,
 * by maintenance - turned off or archived, they are not evaluated, and they
 * used to be dropped without a trace: a webhook receiver lost every event
 * an incident's pause let through, with nothing to say any had come. Now
 * each one is listed in the monitor's Logs as it came, with why it was not
 * evaluated, and its arrival is kept (MonitorNotEvaluated).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11141f00-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11141f00-0000-4000-8000-0000000000f1",
);
const RECEIVED_AT: Date = new Date("2026-11-25T03:06:50.000Z");

function monitorOfType(
  monitorType: MonitorType,
  keepResponseContent?: boolean | undefined,
): Monitor {
  const monitor: Monitor = new Monitor(MONITOR_ID);
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = monitorType;
  if (keepResponseContent !== undefined) {
    monitor.keepResponseContent = keepResponseContent;
  }
  return monitor;
}

function webhookRequest(
  overrides: Partial<IncomingMonitorRequest> = {},
): IncomingMonitorRequest {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    requestHeaders: { "content-type": "application/json" },
    requestBody: { alert: "PaymentsErrorRateHigh", status: "firing" },
    incomingRequestReceivedAt: RECEIVED_AT,
    onlyCheckForIncomingRequestReceivedAt: false,
    checkedAt: RECEIVED_AT,
    ...overrides,
  } as IncomingMonitorRequest;
}

let saved: ReturnType<typeof getJestSpyOn>;
let requestArrivals: ReturnType<typeof getJestSpyOn>;
let reportArrivals: ReturnType<typeof getJestSpyOn>;

beforeEach(() => {
  saved = getJestSpyOn(MonitorLogUtil, "saveMonitorLog").mockImplementation(
    (() => {
      return undefined;
    }) as never,
  );
  requestArrivals = getJestSpyOn(
    MonitorHeartbeatState,
    "recordIncomingRequest",
  ).mockResolvedValue(undefined as never);
  reportArrivals = getJestSpyOn(
    MonitorHeartbeatState,
    "recordServerReport",
  ).mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// What the one saved log entry held.
function savedEntry(): {
  monitorId: ObjectID;
  projectId: ObjectID;
  dataToProcess: DataToProcess & {
    evaluationSummary: MonitorEvaluationSummary;
  };
  keepResponseContent: boolean;
  isNotEvaluated: boolean;
} {
  expect(saved).toHaveBeenCalledTimes(1);
  return saved.mock.calls[0]![0] as never;
}

describe("isSentFromOutside: what is listed while the monitor is not checked", () => {
  test.each([
    [MonitorType.IncomingRequest, true],
    [MonitorType.IncomingEmail, true],
    [MonitorType.Server, true],
    [MonitorType.Website, false],
    [MonitorType.API, false],
    [MonitorType.Ping, false],
    [MonitorType.SyntheticMonitor, false],
    [MonitorType.Logs, false],
    [MonitorType.NetworkDevice, false],
    [MonitorType.Manual, false],
  ])("%s: %s", (monitorType: MonitorType, expected: boolean) => {
    expect(MonitorNotEvaluated.isSentFromOutside(monitorType)).toBe(expected);
  });

  test("a monitor read without its type lists nothing", () => {
    expect(MonitorNotEvaluated.isSentFromOutside(undefined)).toBe(false);
    expect(MonitorNotEvaluated.isSentFromOutside(null)).toBe(false);
  });

  test("the select names what record reads", () => {
    expect(MONITOR_NOT_EVALUATED_SELECT).toEqual({
      _id: true,
      projectId: true,
      monitorType: true,
      keepResponseContent: true,
    });
  });
});

describe("getEvent: why it was not evaluated, for every reason", () => {
  test.each([
    [
      MonitorPauseReason.ManualIncident,
      "Not evaluated: monitoring is paused by an incident",
      "An incident declared by hand paused this monitor's checks, so this was not evaluated against its criteria and opened or resolved nothing. Checks resume when the incident is resolved. To keep checking during incidents, turn on Keep monitoring during incidents in the monitor's settings.",
    ],
    [
      MonitorPauseReason.ScheduledMaintenance,
      "Not evaluated: monitoring is paused for scheduled maintenance",
      "A maintenance event paused this monitor's checks, so this was not evaluated against its criteria and opened or resolved nothing. Checks resume when the event ends.",
    ],
    [
      MonitorPauseReason.Disabled,
      "Not evaluated: monitoring is turned off",
      "This monitor's monitoring is turned off, so this was not evaluated against its criteria and opened or resolved nothing.",
    ],
    [
      MonitorPauseReason.Archived,
      "Not evaluated: the monitor is archived",
      "This monitor is archived, so this was not evaluated against its criteria and opened or resolved nothing.",
    ],
  ])("%s", (reason: MonitorPauseReason, title: string, message: string) => {
    const event: MonitorEvaluationEvent = MonitorNotEvaluated.getEvent(reason);

    expect(event.type).toBe("not-evaluated");
    expect(event.notEvaluatedReason).toBe(reason);
    expect(event.title).toBe(title);
    expect(event.message).toBe(message);
    // Worded in each reader's language from the sentences beside them.
    expect(event.titleSentence).toBeDefined();
    expect(event.messageSentence).toBeDefined();
    expect(event.at).toBeInstanceOf(Date);
  });
});

describe("record: listed in the monitor's Logs, its arrival kept", () => {
  test("an Incoming Request monitor's request is listed as it came, not evaluated and why", async () => {
    const request: IncomingMonitorRequest = webhookRequest();

    await MonitorNotEvaluated.record({
      monitor: monitorOfType(MonitorType.IncomingRequest),
      dataToProcess: request,
      reason: MonitorPauseReason.ManualIncident,
    });

    const entry: ReturnType<typeof savedEntry> = savedEntry();

    expect(entry.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(entry.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(entry.isNotEvaluated).toBe(true);
    // The request as it came: the body a person needs to read what was missed.
    expect(
      (entry.dataToProcess as unknown as IncomingMonitorRequest).requestBody,
    ).toEqual({ alert: "PaymentsErrorRateHigh", status: "firing" });
    // No criteria were run, and the one event says why.
    expect(entry.dataToProcess.evaluationSummary.criteriaResults).toEqual([]);
    expect(
      entry.dataToProcess.evaluationSummary.events.map(
        (event: MonitorEvaluationEvent): string => {
          return `${event.type}:${event.notEvaluatedReason}`;
        },
      ),
    ).toEqual(["not-evaluated:ManualIncident"]);
  });

  test("the request handed in is not changed: the summary goes on a copy", async () => {
    const request: IncomingMonitorRequest = webhookRequest();

    await MonitorNotEvaluated.record({
      monitor: monitorOfType(MonitorType.IncomingRequest),
      dataToProcess: request,
      reason: MonitorPauseReason.ManualIncident,
    });

    expect(
      (request as unknown as { evaluationSummary?: unknown }).evaluationSummary,
    ).toBeUndefined();
  });

  test("its content is kept as the monitor keeps it: a monitor that keeps none keeps none here either", async () => {
    await MonitorNotEvaluated.record({
      monitor: monitorOfType(MonitorType.IncomingRequest, false),
      dataToProcess: webhookRequest(),
      reason: MonitorPauseReason.Disabled,
    });

    expect(savedEntry().keepResponseContent).toBe(false);
  });

  test("a monitor read without the switch keeps its content, as the switch's default does", async () => {
    await MonitorNotEvaluated.record({
      monitor: monitorOfType(MonitorType.IncomingRequest),
      dataToProcess: webhookRequest(),
      reason: MonitorPauseReason.ScheduledMaintenance,
    });

    expect(savedEntry().keepResponseContent).toBe(true);
  });

  test("the request's arrival is kept for the monitor's page", async () => {
    await MonitorNotEvaluated.record({
      monitor: monitorOfType(MonitorType.IncomingRequest),
      dataToProcess: webhookRequest(),
      reason: MonitorPauseReason.ManualIncident,
    });

    expect(requestArrivals).toHaveBeenCalledTimes(1);
    expect(
      (requestArrivals.mock.calls[0]![0] as { receivedAt: Date }).receivedAt,
    ).toEqual(RECEIVED_AT);
    expect(reportArrivals).not.toHaveBeenCalled();
  });

  test("a heartbeat check's re-read is no arrival", async () => {
    await MonitorNotEvaluated.record({
      monitor: monitorOfType(MonitorType.IncomingRequest),
      dataToProcess: webhookRequest({
        onlyCheckForIncomingRequestReceivedAt: true,
      }),
      reason: MonitorPauseReason.ManualIncident,
    });

    expect(requestArrivals).not.toHaveBeenCalled();
  });

  test("a Server monitor's report is listed, and its arrival kept so the agent is not judged silent once checks resume", async () => {
    const report: ServerMonitorResponse = {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      hostname: "payments-1",
      requestReceivedAt: RECEIVED_AT,
      timeNow: RECEIVED_AT,
    } as ServerMonitorResponse;

    await MonitorNotEvaluated.record({
      monitor: monitorOfType(MonitorType.Server),
      dataToProcess: report,
      reason: MonitorPauseReason.ScheduledMaintenance,
    });

    expect(savedEntry().isNotEvaluated).toBe(true);
    expect(reportArrivals).toHaveBeenCalledTimes(1);
    expect(requestArrivals).not.toHaveBeenCalled();
  });

  test("the online check's own re-read of a Server monitor is no arrival", async () => {
    await MonitorNotEvaluated.record({
      monitor: monitorOfType(MonitorType.Server),
      dataToProcess: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        hostname: "payments-1",
        requestReceivedAt: RECEIVED_AT,
        timeNow: RECEIVED_AT,
        onlyCheckRequestReceivedAt: true,
      } as ServerMonitorResponse,
      reason: MonitorPauseReason.ManualIncident,
    });

    expect(reportArrivals).not.toHaveBeenCalled();
  });

  test("an Incoming Email monitor's email is listed; its arrival is kept by its own ingest", async () => {
    await MonitorNotEvaluated.record({
      monitor: monitorOfType(MonitorType.IncomingEmail),
      dataToProcess: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        emailSubject: "Disk full on db-1",
      } as unknown as DataToProcess,
      reason: MonitorPauseReason.ManualIncident,
    });

    expect(savedEntry().isNotEvaluated).toBe(true);
    expect(requestArrivals).not.toHaveBeenCalled();
    expect(reportArrivals).not.toHaveBeenCalled();
  });

  test("a probe's check is OneUptime's own: nothing is listed", async () => {
    await MonitorNotEvaluated.record({
      monitor: monitorOfType(MonitorType.Website),
      dataToProcess: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
      } as unknown as DataToProcess,
      reason: MonitorPauseReason.ManualIncident,
    });

    expect(saved).not.toHaveBeenCalled();
  });

  test("a monitor read without its id or project lists nothing", async () => {
    const monitor: Monitor = monitorOfType(MonitorType.IncomingRequest);
    monitor.projectId = undefined;

    await MonitorNotEvaluated.record({
      monitor: monitor,
      dataToProcess: webhookRequest(),
      reason: MonitorPauseReason.ManualIncident,
    });

    expect(saved).not.toHaveBeenCalled();
  });

  test("never throws: the refusal after it stays the refusal it was", async () => {
    requestArrivals.mockRejectedValue(new Error("Redis is down"));

    await expect(
      MonitorNotEvaluated.record({
        monitor: monitorOfType(MonitorType.IncomingRequest),
        dataToProcess: webhookRequest(),
        reason: MonitorPauseReason.ManualIncident,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("listNotEvaluated: never for a blocked project", () => {
  let record: ReturnType<typeof getJestSpyOn>;

  beforeEach(() => {
    record = getJestSpyOn(MonitorNotEvaluated, "record").mockResolvedValue(
      undefined as never,
    );
  });

  test("lists what an outside sender sent to a monitor of a project that is not blocked", async () => {
    getJestSpyOn(ProjectService, "isProjectBlocked").mockResolvedValue(
      false as never,
    );

    await MonitorResourceUtil.listNotEvaluated({
      monitor: monitorOfType(MonitorType.IncomingRequest),
      dataToProcess: webhookRequest(),
      reason: MonitorPauseReason.ManualIncident,
    });

    expect(record).toHaveBeenCalledTimes(1);
  });

  test("a blocked project records nothing of what reaches it", async () => {
    getJestSpyOn(ProjectService, "isProjectBlocked").mockResolvedValue(
      true as never,
    );

    await MonitorResourceUtil.listNotEvaluated({
      monitor: monitorOfType(MonitorType.IncomingRequest),
      dataToProcess: webhookRequest(),
      reason: MonitorPauseReason.ManualIncident,
    });

    expect(record).not.toHaveBeenCalled();
  });

  test("a probe's check is not even asked about", async () => {
    const blocked: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ProjectService,
      "isProjectBlocked",
    ).mockResolvedValue(false as never);

    await MonitorResourceUtil.listNotEvaluated({
      monitor: monitorOfType(MonitorType.API),
      dataToProcess: webhookRequest(),
      reason: MonitorPauseReason.Disabled,
    });

    expect(blocked).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  test("a project that cannot be read records nothing, and nothing throws", async () => {
    getJestSpyOn(ProjectService, "isProjectBlocked").mockRejectedValue(
      new Error("Postgres is down") as never,
    );

    await expect(
      MonitorResourceUtil.listNotEvaluated({
        monitor: monitorOfType(MonitorType.IncomingRequest),
        dataToProcess: webhookRequest(),
        reason: MonitorPauseReason.ManualIncident,
      }),
    ).resolves.toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });
});

describe("saveMonitorLog: a result not evaluated is no evaluation and no first check", () => {
  let milestones: ReturnType<typeof getJestSpyOn>;
  let clockEnds: ReturnType<typeof getJestSpyOn>;

  beforeEach(() => {
    // The real one, with what it calls stubbed.
    saved.mockRestore();
    milestones = getJestSpyOn(
      ProjectMilestoneService,
      "reachInBackground",
    ).mockImplementation((() => {
      return undefined;
    }) as never);
    clockEnds = getJestSpyOn(MonitorEvaluationClock, "end").mockImplementation(
      (() => {
        return undefined;
      }) as never,
    );
    getJestSpyOn(MonitorLogUtil, "getRetentionDays").mockResolvedValue(
      1 as never,
    );
    getJestSpyOn(MonitorLogUtil as never, "enqueueRow").mockImplementation(
      (() => {
        return undefined;
      }) as never,
    );
  });

  test("listed not evaluated: the project's first check result is not reached, and nothing is timed", () => {
    MonitorLogUtil.saveMonitorLog({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: webhookRequest(),
      keepResponseContent: true,
      isNotEvaluated: true,
    });

    expect(milestones).not.toHaveBeenCalled();
    expect(clockEnds).not.toHaveBeenCalled();
  });

  test("an evaluation's entry still reaches it, and is timed, as before", () => {
    MonitorLogUtil.saveMonitorLog({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: webhookRequest(),
      keepResponseContent: true,
    });

    expect(milestones).toHaveBeenCalledTimes(1);
    expect(clockEnds).toHaveBeenCalledTimes(1);
  });
});
