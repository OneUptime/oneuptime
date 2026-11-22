/*
 * MonitorResource reaches the native isolated-vm addon through the criteria
 * evaluator's sandbox runner. Nothing here runs a sandbox, and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import OneUptimeDate from "../../../../Types/Date";
import { englishOfEvaluationSentence } from "../../../../Types/Monitor/EvaluationSentence";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../../Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import { mockMonitorRecordTables } from "../../TestingUtils/MonitorRecordTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * NO REQUEST TO AN INCOMING REQUEST MONITOR IS SKIPPED IN SILENCE (#10582).
 *
 * A monitor whose criteria group by a payload field evaluates every request
 * it receives, in order. Past what a monitor keeps waiting - a flood from one
 * sender - the oldest waiting are skipped, and so is a request whose
 * evaluation failed every try. An incident or alert one of them would have
 * opened or resolved is then missing or still open, so the next evaluation's
 * monitor log says how many were skipped, and why, before anything else:
 * MonitorResourceUtil.describeSkippedIncomingRequests, which monitorResource
 * puts first in the log of the evaluation the Telemetry worker passes it to.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10582000-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "10582000-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const ONLINE_STATUS_ID: ObjectID = new ObjectID(
  "10582000-cccc-4ccc-8ccc-cccccccccccc",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "10582000-dddd-4ddd-8ddd-dddddddddddd",
);

const OVER_LIMIT_MESSAGE: string =
  "More requests were waiting to be evaluated than this monitor keeps, so the oldest of them were skipped. An incident or alert a skipped request would have opened or resolved may be missing or still open.";

function monitorWithDownCriteria(): Monitor {
  const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  criteria.data = {
    ...criteria.data!,
    id: "10582000-eeee-4eee-8eee-eeeeeeeeeeee",
    name: "Down",
    monitorStatusId: OFFLINE_STATUS_ID,
    changeMonitorStatus: true,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
        value: "down",
      },
    ],
  };

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: [criteria] };

  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria = monitorCriteria;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE_STATUS_ID,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.name = "Webhooks";
  monitor.monitorType = MonitorType.IncomingRequest;
  monitor.monitorSteps = monitorSteps;
  monitor.currentMonitorStatusId = ONLINE_STATUS_ID;
  return monitor;
}

function request(body: string): IncomingMonitorRequest {
  const now: Date = OneUptimeDate.getCurrentDate();

  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    requestBody: { status: body },
    requestHeaders: { "content-type": "application/json" },
    incomingRequestReceivedAt: now,
    checkedAt: now,
    onlyCheckForIncomingRequestReceivedAt: false,
  };
}

describe("MonitorResourceUtil.describeSkippedIncomingRequests", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-21T09:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("says how many were skipped over the limit, and what that may have cost", () => {
    const events: Array<MonitorEvaluationEvent> =
      MonitorResourceUtil.describeSkippedIncomingRequests({
        overLimit: 250,
        afterFailures: 0,
        attempts: 3,
      });

    expect(events).toEqual([
      {
        type: "requests-skipped",
        title: "Requests not evaluated: 250",
        titleSentence: {
          template: "Requests not evaluated: {{skipped}}",
          values: { skipped: 250 },
        },
        message: OVER_LIMIT_MESSAGE,
        messageSentence: { template: OVER_LIMIT_MESSAGE },
        at: new Date("2026-11-21T09:00:00.000Z"),
      },
    ]);
  });

  it("says how many were skipped after failing, and after how many tries", () => {
    const [event]: Array<MonitorEvaluationEvent> =
      MonitorResourceUtil.describeSkippedIncomingRequests({
        overLimit: 0,
        afterFailures: 2,
        attempts: 3,
      });

    expect(event!.type).toBe("requests-skipped");
    expect(event!.title).toBe("Requests not evaluated: 2");
    expect(event!.message).toBe(
      "A request is skipped once evaluating it has failed 3 times. An incident or alert a skipped request would have opened or resolved may be missing or still open.",
    );
    expect(event!.messageSentence).toEqual({
      template:
        "A request is skipped once evaluating it has failed {{attempts}} times. An incident or alert a skipped request would have opened or resolved may be missing or still open.",
      values: { attempts: 3 },
    });
  });

  it("says each reason apart when both happened, the limit first", () => {
    const events: Array<MonitorEvaluationEvent> =
      MonitorResourceUtil.describeSkippedIncomingRequests({
        overLimit: 5,
        afterFailures: 1,
        attempts: 3,
      });

    expect(
      events.map((event: MonitorEvaluationEvent) => {
        return event.title;
      }),
    ).toEqual(["Requests not evaluated: 5", "Requests not evaluated: 1"]);
  });

  it("says nothing when nothing was skipped", () => {
    expect(
      MonitorResourceUtil.describeSkippedIncomingRequests({
        overLimit: 0,
        afterFailures: 0,
        attempts: 3,
      }),
    ).toEqual([]);
  });

  // The English stored is the sentence's own: the Dashboard words the same.
  it("stores the English its sentences make", () => {
    for (const event of MonitorResourceUtil.describeSkippedIncomingRequests({
      overLimit: 7,
      afterFailures: 4,
      attempts: 3,
    })) {
      expect(event.title).toBe(
        englishOfEvaluationSentence(event.titleSentence!),
      );
      expect(event.message).toBe(
        englishOfEvaluationSentence(event.messageSentence!),
      );
    }
  });
});

describe("monitorResource with requests skipped before this one", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-21T09:00:00.000Z"));

    const monitor: Monitor = monitorWithDownCriteria();

    mockMonitorRecordTables({
      getMonitor: (): Monitor => {
        return monitor;
      },
      projectId: PROJECT_ID,
      incidentSeverityId: ObjectID.generate(),
      alertSeverityId: ObjectID.generate(),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("puts what was skipped first in the evaluation's log, before what the evaluation did", async () => {
    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(request("down"), {
        skippedIncomingRequests: {
          overLimit: 40,
          afterFailures: 0,
          attempts: 3,
        },
      });

    const summary: MonitorEvaluationSummary = response.evaluationSummary!;
    const first: MonitorEvaluationEvent = summary.events[0]!;

    expect(first.type).toBe("requests-skipped");
    expect(first.title).toBe("Requests not evaluated: 40");
    // The evaluation itself goes on as it would have.
    expect(
      summary.events.some((event: MonitorEvaluationEvent) => {
        return event.type === "criteria-met";
      }),
    ).toBe(true);
  });

  it("says nothing of skipped requests when none were", async () => {
    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(request("down"));

    expect(
      response.evaluationSummary!.events.filter(
        (event: MonitorEvaluationEvent) => {
          return event.type === "requests-skipped";
        },
      ),
    ).toEqual([]);
  });
});
