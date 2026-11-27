/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import ReceivingSilence from "../../../../Server/Utils/Monitor/ReceivingSilence";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import OneUptimeDate from "../../../../Types/Date";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * ONLY A CRITERIA THAT CHANGES THE STATUS DECIDES IT (OneUptime issue
 * #11238), as the evaluator judges a check.
 *
 * A monitor's criteria are judged in order. The first that matches acts on
 * the check - the incidents and alerts it opens and resolves - as it always
 * has. The status comes from the first match among the criteria that change
 * the status: the first match itself whenever it changes the status, and
 * otherwise a criteria after it, judged for the status alone. A criteria
 * that changes no status - an alert-only one - decides none.
 *
 * These read processMonitorStep's answer: criteriaMetId (what acts),
 * statusCriteriaId and statusRootCause (what sets the status), and each
 * criteria's row of the evaluation summary, which the evaluation log reads.
 */

const ONLINE: ObjectID = new ObjectID("11238aaa-0001-4000-8000-000000000001");
const DEGRADED: ObjectID = new ObjectID("11238aaa-0002-4000-8000-000000000002");
const OFFLINE: ObjectID = new ObjectID("11238aaa-0003-4000-8000-000000000003");

const MONITOR_ID: ObjectID = new ObjectID(
  "11238aaa-0004-4000-8000-000000000004",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "11238aaa-0005-4000-8000-000000000005",
);

interface CriteriaSpec {
  id: string;
  name: string;
  filters: Array<CriteriaFilter>;
  status?: ObjectID | undefined;
  incident?: boolean | undefined;
  alert?: boolean | undefined;
  isEnabled?: boolean | undefined;
  // Turned on to change the status, but with no status picked.
  changeStatusWithoutOne?: boolean | undefined;
}

function criteria(spec: CriteriaSpec): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: spec.id,
    name: spec.name,
    description: "",
    monitorStatusId: spec.status,
    filterCondition: FilterCondition.All,
    filters: spec.filters,
    incidents: spec.incident
      ? [
          {
            id: `${spec.id}-incident`,
            title: spec.name,
            description: "",
            incidentSeverityId: ObjectID.generate(),
            autoResolveIncident: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    alerts: spec.alert
      ? [
          {
            id: `${spec.id}-alert`,
            title: spec.name,
            description: "",
            alertSeverityId: ObjectID.generate(),
            autoResolveAlert: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    changeMonitorStatus:
      Boolean(spec.status) || Boolean(spec.changeStatusWithoutOne),
    createIncidents: Boolean(spec.incident),
    createAlerts: Boolean(spec.alert),
    isEnabled: spec.isEnabled !== false,
  };

  return instance;
}

const isOffline: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.False,
  value: undefined,
};
const isOnline: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.True,
  value: undefined,
};

function slowerThan(ms: number): CriteriaFilter {
  return {
    checkOn: CheckOn.ResponseTime,
    filterType: FilterType.GreaterThan,
    value: ms,
  };
}

function fasterThanOrAt(ms: number): CriteriaFilter {
  return {
    checkOn: CheckOn.ResponseTime,
    filterType: FilterType.LessThanOrEqualTo,
    value: ms,
  };
}

function statusCodeAtLeast(code: number): CriteriaFilter {
  return {
    checkOn: CheckOn.ResponseStatusCode,
    filterType: FilterType.GreaterThanOrEqualTo,
    value: code,
  };
}

// The criteria a website monitor of this suite is built from.
const SITE_DOWN: CriteriaSpec = {
  id: "site-down",
  name: "Site is down",
  filters: [isOffline],
  status: OFFLINE,
  incident: true,
};
const SITE_SLOW: CriteriaSpec = {
  id: "site-slow",
  name: "Site is slow",
  filters: [slowerThan(2000)],
  alert: true,
};
const SITE_VERY_SLOW: CriteriaSpec = {
  id: "site-very-slow",
  name: "Site is very slow",
  filters: [slowerThan(5000)],
  alert: true,
};
const SERVER_ERRORS: CriteriaSpec = {
  id: "server-errors",
  name: "Server errors",
  filters: [statusCodeAtLeast(500)],
  status: DEGRADED,
  incident: true,
};
const SITE_UP: CriteriaSpec = {
  id: "site-up",
  name: "Site is up",
  filters: [isOnline],
  status: ONLINE,
};

function monitorWith(input: {
  criteria: Array<CriteriaSpec>;
  currentStatus?: ObjectID | undefined;
  monitorType?: MonitorType | undefined;
}): Monitor {
  const step: MonitorStep = new MonitorStep();
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: input.criteria.map(criteria),
  };
  step.data!.monitorCriteria = monitorCriteria;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.name = "Acme";
  monitor.monitorType = input.monitorType || MonitorType.Website;
  monitor.monitorSteps = monitorSteps;
  monitor.currentMonitorStatusId = input.currentStatus || ONLINE;
  return monitor;
}

function siteCheck(input: {
  isUp: boolean;
  responseTimeInMs?: number | undefined;
  statusCode?: number | undefined;
}): DataToProcess {
  const check: ProbeMonitorResponse = {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    isOnline: input.isUp,
    responseTimeInMs: input.responseTimeInMs ?? 120,
    responseCode: input.isUp ? input.statusCode ?? 200 : undefined,
    responseBody: "ok",
    responseHeaders: {},
    failureCause: input.isUp ? "" : "Request timed out",
    monitoredAt: OneUptimeDate.getCurrentDate(),
  };

  return check as DataToProcess;
}

interface Judged {
  response: ProbeApiIngestResponse;
  summary: MonitorEvaluationSummary;
}

async function judge(monitor: Monitor, check: DataToProcess): Promise<Judged> {
  const summary: MonitorEvaluationSummary = {
    evaluatedAt: OneUptimeDate.getCurrentDate(),
    criteriaResults: [],
    events: [],
  };

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: check,
      monitorStep: monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!,
      monitor: monitor,
      probeApiIngestResponse: {
        monitorId: MONITOR_ID,
        criteriaMetId: undefined,
        rootCause: null,
      },
      evaluationSummary: summary,
    });

  return { response, summary };
}

// Each criteria's row: met, not met, or why it was not evaluated.
function rows(summary: MonitorEvaluationSummary): Record<string, string> {
  const read: Record<string, string> = {};

  for (const result of summary.criteriaResults) {
    read[result.criteriaId || ""] = result.skipped
      ? `skipped: ${result.skipCause}`
      : result.met
        ? "met"
        : "not met";
  }

  return read;
}

function rowOf(
  summary: MonitorEvaluationSummary,
  criteriaId: string,
): MonitorEvaluationCriteriaResult {
  return summary.criteriaResults.find(
    (result: MonitorEvaluationCriteriaResult): boolean => {
      return result.criteriaId === criteriaId;
    },
  )!;
}

beforeEach(() => {
  jest.spyOn(ReceivingSilence, "measure").mockResolvedValue({
    wallMinutes: 0,
    receivingMinutes: 0,
    notReceivingMinutes: 0,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorCriteriaInstance.changesMonitorStatus", () => {
  it("is true for a criteria turned on to change the status that names one", () => {
    expect(
      MonitorCriteriaInstance.changesMonitorStatus(criteria(SITE_DOWN).data),
    ).toBe(true);
  });

  it("is false for an alert-only criteria, one with no status picked, and none at all", () => {
    expect(
      MonitorCriteriaInstance.changesMonitorStatus(criteria(SITE_SLOW).data),
    ).toBe(false);
    expect(
      MonitorCriteriaInstance.changesMonitorStatus(
        criteria({
          id: "no-status",
          name: "Turned on, nothing picked",
          filters: [isOnline],
          changeStatusWithoutOne: true,
        }).data,
      ),
    ).toBe(false);
    expect(MonitorCriteriaInstance.changesMonitorStatus(undefined)).toBe(false);
  });

  it("is false for a status picked while the switch is off", () => {
    const instance: MonitorCriteriaInstance = criteria(SITE_UP);
    instance.data!.changeMonitorStatus = false;

    expect(MonitorCriteriaInstance.changesMonitorStatus(instance.data)).toBe(
      false,
    );
  });
});

describe("a monitor whose first match changes the status: as it always was", () => {
  it("the first match acts and sets the status; nothing after it is evaluated", async () => {
    const { response, summary } = await judge(
      monitorWith({ criteria: [SITE_DOWN, SITE_SLOW, SITE_UP] }),
      siteCheck({ isUp: false }),
    );

    expect(response.criteriaMetId).toBe("site-down");
    expect(response.statusCriteriaId).toBe("site-down");
    expect(response.statusRootCause).toBe(response.rootCause);
    expect(rows(summary)).toEqual({
      "site-down": "met",
      "site-slow": "skipped: earlier-criterion-matched",
      "site-up": "skipped: earlier-criterion-matched",
    });
    expect(rowOf(summary, "site-up").skipReason).toBe(
      "An earlier criterion already matched. Criteria are evaluated in order for this monitor, so evaluation stopped at the first match.",
    );
  });

  it("a healthy check matches the healthy criteria, which sets the status", async () => {
    const { response, summary } = await judge(
      monitorWith({ criteria: [SITE_DOWN, SITE_SLOW, SITE_UP] }),
      siteCheck({ isUp: true }),
    );

    expect(response.criteriaMetId).toBe("site-up");
    expect(response.statusCriteriaId).toBe("site-up");
    expect(rows(summary)).toEqual({
      "site-down": "not met",
      "site-slow": "not met",
      "site-up": "met",
    });
  });

  it("nothing matches: no criteria acts and none sets the status", async () => {
    const { response } = await judge(
      monitorWith({ criteria: [SITE_DOWN, SITE_SLOW] }),
      siteCheck({ isUp: true }),
    );

    expect(response.criteriaMetId).toBeUndefined();
    expect(response.statusCriteriaId).toBeUndefined();
    expect(response.statusRootCause).toBeUndefined();
  });
});

describe("a monitor whose first match changes no status (#11238)", () => {
  /*
   * THE REPORT, on a website monitor: down, then back but slow. "Site is
   * slow" is the first match, an alert; it used to leave the monitor Offline.
   */
  it("a slow answer: the alert acts, and the healthy criteria after it sets the status", async () => {
    const { response, summary } = await judge(
      monitorWith({
        criteria: [SITE_DOWN, SITE_SLOW, SITE_UP],
        currentStatus: OFFLINE,
      }),
      siteCheck({ isUp: true, responseTimeInMs: 3500 }),
    );

    expect(response.criteriaMetId).toBe("site-slow");
    expect(response.rootCause).toContain("**Criteria Name**: Site is slow");
    expect(response.statusCriteriaId).toBe("site-up");
    expect(response.statusRootCause).toContain("**Criteria Name**: Site is up");
    expect(rows(summary)).toEqual({
      "site-down": "not met",
      "site-slow": "met",
      "site-up": "met",
    });
  });

  it("the criteria judged for the status opens nothing: no series, no list of matches", async () => {
    const { response } = await judge(
      monitorWith({ criteria: [SITE_DOWN, SITE_SLOW, SITE_UP] }),
      siteCheck({ isUp: true, responseTimeInMs: 3500 }),
    );

    // An ungrouped monitor publishes no list of matches, as before.
    expect(response.matchedCriteria).toBeUndefined();
    expect(response.evaluatedCriteriaIds).toBeUndefined();
    expect(response.perSeriesMatches).toBeUndefined();
  });

  it("the order of the criteria that change the status decides which status wins", async () => {
    const { response, summary } = await judge(
      monitorWith({
        criteria: [SITE_SLOW, SERVER_ERRORS, SITE_UP],
      }),
      siteCheck({ isUp: true, responseTimeInMs: 3500, statusCode: 503 }),
    );

    expect(response.criteriaMetId).toBe("site-slow");
    expect(response.statusCriteriaId).toBe("server-errors");
    expect(rows(summary)).toEqual({
      "site-slow": "met",
      "server-errors": "met",
      "site-up": "skipped: status-already-set",
    });
    expect(rowOf(summary, "site-up").skipReason).toBe(
      "An earlier criterion already matched and set the monitor's status. Criteria are evaluated in order for this monitor, so evaluation stopped at the first match that changes the status.",
    );
  });

  it("the same criteria the other way round: the healthy one comes first, and wins", async () => {
    const { response, summary } = await judge(
      monitorWith({
        criteria: [SITE_SLOW, SITE_UP, SERVER_ERRORS],
      }),
      siteCheck({ isUp: true, responseTimeInMs: 3500, statusCode: 503 }),
    );

    expect(response.statusCriteriaId).toBe("site-up");
    expect(rows(summary)["server-errors"]).toBe("skipped: status-already-set");
  });

  it("a criteria that changes no status after the first match is passed over, and one that changes it judged", async () => {
    const { response, summary } = await judge(
      monitorWith({
        criteria: [SITE_SLOW, SITE_VERY_SLOW, SITE_DOWN, SITE_UP],
      }),
      siteCheck({ isUp: true, responseTimeInMs: 6000 }),
    );

    // The first match acts: one alert, as before ("very slow" is not opened).
    expect(response.criteriaMetId).toBe("site-slow");
    expect(response.statusCriteriaId).toBe("site-up");
    expect(rows(summary)).toEqual({
      "site-slow": "met",
      "site-very-slow": "skipped: changes-no-status",
      "site-down": "not met",
      "site-up": "met",
    });
    expect(rowOf(summary, "site-very-slow").skipReason).toBe(
      "An earlier criterion already matched, and this one changes no status, so it was not evaluated. After the first match, only the criteria that change the status are evaluated, until one of them matches.",
    );
  });

  it("no criteria after it changes the status: the evaluation stops at the first match, as it always did", async () => {
    const { response, summary } = await judge(
      monitorWith({ criteria: [SITE_SLOW, SITE_VERY_SLOW] }),
      siteCheck({ isUp: true, responseTimeInMs: 6000 }),
    );

    expect(response.criteriaMetId).toBe("site-slow");
    expect(response.statusCriteriaId).toBeUndefined();
    expect(rows(summary)).toEqual({
      "site-slow": "met",
      "site-very-slow": "skipped: earlier-criterion-matched",
    });
  });

  it("the criteria that change the status are judged and none matches: no criteria sets the status", async () => {
    const { response, summary } = await judge(
      monitorWith({ criteria: [SITE_SLOW, SITE_DOWN, SERVER_ERRORS] }),
      siteCheck({ isUp: true, responseTimeInMs: 3500, statusCode: 200 }),
    );

    expect(response.criteriaMetId).toBe("site-slow");
    expect(response.statusCriteriaId).toBeUndefined();
    expect(response.statusRootCause).toBeUndefined();
    expect(rows(summary)).toEqual({
      "site-slow": "met",
      "site-down": "not met",
      "server-errors": "not met",
    });
  });

  it("a disabled criteria after the first match says it is disabled, and decides nothing", async () => {
    const { response, summary } = await judge(
      monitorWith({
        criteria: [SITE_SLOW, { ...SERVER_ERRORS, isEnabled: false }, SITE_UP],
      }),
      siteCheck({ isUp: true, responseTimeInMs: 3500, statusCode: 503 }),
    );

    expect(response.statusCriteriaId).toBe("site-up");
    expect(rows(summary)["server-errors"]).toBe("skipped: disabled");
  });

  it("a criteria turned on to change the status with none picked changes none, and is passed over", async () => {
    const { response, summary } = await judge(
      monitorWith({
        criteria: [
          SITE_SLOW,
          {
            id: "no-status-picked",
            name: "Turned on, nothing picked",
            filters: [isOnline],
            changeStatusWithoutOne: true,
          },
          SITE_UP,
        ],
      }),
      siteCheck({ isUp: true, responseTimeInMs: 3500 }),
    );

    expect(response.statusCriteriaId).toBe("site-up");
    expect(rows(summary)["no-status-picked"]).toBe(
      "skipped: changes-no-status",
    );
  });

  it("a first match that opens nothing and changes no status decides nothing either", async () => {
    const { response } = await judge(
      monitorWith({
        criteria: [
          {
            id: "does-nothing",
            name: "Matches and does nothing",
            filters: [isOnline],
          },
          SITE_DOWN,
          SITE_UP,
        ],
      }),
      siteCheck({ isUp: true }),
    );

    expect(response.criteriaMetId).toBe("does-nothing");
    expect(response.statusCriteriaId).toBe("site-up");
  });
});

describe("the recovery margin (#10743) with a first match that changes no status", () => {
  const FIRING: CriteriaSpec = {
    id: "slow-firing",
    name: "Response above 3 s",
    filters: [slowerThan(3000)],
    status: DEGRADED,
    incident: true,
  };
  const WARNING: CriteriaSpec = {
    id: "slow-warning",
    name: "Response above 2 s",
    filters: [slowerThan(2000)],
    alert: true,
  };
  const RECOVERED: CriteriaSpec = {
    id: "slow-recovered",
    name: "Response at or below 2.7 s",
    filters: [fasterThanOrAt(2700)],
    status: ONLINE,
  };

  it("inside the margin, with the warning alert matching: the status waits for the recovery criteria", async () => {
    const { response } = await judge(
      monitorWith({
        criteria: [FIRING, WARNING, RECOVERED],
        currentStatus: DEGRADED,
      }),
      siteCheck({ isUp: true, responseTimeInMs: 2900 }),
    );

    expect(response.criteriaMetId).toBe("slow-warning");
    expect(response.statusCriteriaId).toBeUndefined();
    expect(response.statusKeptForRecoveryCriteriaIds).toEqual([
      "slow-recovered",
    ]);
  });

  it("past the margin, with the warning alert still matching: the recovery criteria sets the status", async () => {
    const { response } = await judge(
      monitorWith({
        criteria: [FIRING, WARNING, RECOVERED],
        currentStatus: DEGRADED,
      }),
      siteCheck({ isUp: true, responseTimeInMs: 2500 }),
    );

    expect(response.criteriaMetId).toBe("slow-warning");
    expect(response.statusCriteriaId).toBe("slow-recovered");
  });

  it("the judgement is said whatever matched, for probes that agree on another check", async () => {
    const { response } = await judge(
      monitorWith({
        criteria: [FIRING, WARNING, RECOVERED],
        currentStatus: DEGRADED,
      }),
      siteCheck({ isUp: true, responseTimeInMs: 3500 }),
    );

    expect(response.statusCriteriaId).toBe("slow-firing");
    expect(response.statusKeptForRecoveryCriteriaIds).toEqual([
      "slow-recovered",
    ]);
  });

  it("at the default status nothing is waited for", async () => {
    const { response } = await judge(
      monitorWith({
        criteria: [FIRING, WARNING, RECOVERED],
        currentStatus: ONLINE,
      }),
      siteCheck({ isUp: true, responseTimeInMs: 2900 }),
    );

    expect(response.statusKeptForRecoveryCriteriaIds).toBeUndefined();
  });

  it("MonitorCriteriaEvaluator.getStatusKeptForRecoveryCriteriaIds reads the monitor alone", () => {
    const monitor: Monitor = monitorWith({
      criteria: [FIRING, WARNING, RECOVERED],
      currentStatus: DEGRADED,
    });

    expect(
      MonitorCriteriaEvaluator.getStatusKeptForRecoveryCriteriaIds({
        monitor: monitor,
        monitorStep: monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!,
      }),
    ).toEqual(["slow-recovered"]);

    monitor.currentMonitorStatusId = ONLINE;

    expect(
      MonitorCriteriaEvaluator.getStatusKeptForRecoveryCriteriaIds({
        monitor: monitor,
        monitorStep: monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!,
      }),
    ).toBeUndefined();
  });
});

describe("an Incoming Request monitor whose first match changes no status", () => {
  const WARNING_PAYLOAD: CriteriaSpec = {
    id: "payload-warning",
    name: "A warning was reported",
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
        value: "warning",
      },
    ],
    alert: true,
  };
  const ERROR_PAYLOAD: CriteriaSpec = {
    id: "payload-error",
    name: "An error was reported",
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
        value: "error",
      },
    ],
    status: OFFLINE,
    incident: true,
  };
  const OK_PAYLOAD: CriteriaSpec = {
    id: "payload-ok",
    name: "All is well",
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.NotContains,
        value: "error",
      },
    ],
    status: ONLINE,
  };

  function request(body: string): DataToProcess {
    return {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      requestBody: body,
      requestHeaders: {},
      requestMethod: "POST",
      incomingRequestReceivedAt: OneUptimeDate.getCurrentDate(),
      checkedAt: OneUptimeDate.getCurrentDate(),
    } as unknown as DataToProcess;
  }

  it("a warning: the alert acts, the healthy criteria sets the status", async () => {
    const { response, summary } = await judge(
      monitorWith({
        criteria: [WARNING_PAYLOAD, ERROR_PAYLOAD, OK_PAYLOAD],
        monitorType: MonitorType.IncomingRequest,
        currentStatus: OFFLINE,
      }),
      request('{"level":"warning"}'),
    );

    expect(response.criteriaMetId).toBe("payload-warning");
    expect(response.statusCriteriaId).toBe("payload-ok");
    // Only the criteria that acts says how it groups.
    expect(
      summary.events.filter((event: { type: string }): boolean => {
        return event.type === "grouping";
      }),
    ).toEqual([]);
  });

  it("a warning and an error together: the error's status, the warning's alert", async () => {
    const { response } = await judge(
      monitorWith({
        criteria: [WARNING_PAYLOAD, ERROR_PAYLOAD, OK_PAYLOAD],
        monitorType: MonitorType.IncomingRequest,
      }),
      request('{"level":"warning","detail":"error"}'),
    );

    expect(response.criteriaMetId).toBe("payload-warning");
    expect(response.statusCriteriaId).toBe("payload-error");
  });
});
