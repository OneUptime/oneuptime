import InvestigationRuleWait, {
  EndedWait,
  RULE_WAIT_BATCH_SIZE,
  RuleWaitResult,
  StartNowResult,
  WaitingInvestigation,
} from "../../../../Server/Utils/AI/SRE/InvestigationRuleWait";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import InvestigationEligibility from "../../../../Server/Utils/AI/SRE/InvestigationEligibility";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import InvestigationRules from "../../../../Server/Utils/AI/SRE/InvestigationRules";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import logger from "../../../../Server/Utils/Logger";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import AIRunType from "../../../../Types/AI/AIRunType";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * An investigation rule makes OneUptime AI wait (issue #5074): "only if the
 * incident is still open after N minutes". The wait lives on the incident
 * (or alert); the rule-wait job ends it once - investigated if still open,
 * "resolved before the investigation started" otherwise - a change of what
 * the rules read moves it, and someone may start the investigation now.
 * Every entry point is best-effort and never throws.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OPEN_STATE: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RESOLVED_STATE: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const RUN_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

const MINUTE: number = 60 * 1000;

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * MINUTE);
}

// The dates a raw QueryHelper operator compares with.
function operatorDates(operator: unknown): Array<Date> {
  const parameters: Record<string, unknown> =
    (operator as { _objectLiteralParameters?: Record<string, unknown> })
      ._objectLiteralParameters || {};

  return Object.values(parameters).filter((value: unknown): value is Date => {
    return value instanceof Date;
  });
}

function endedWait(overrides: Partial<EndedWait> = {}): EndedWait {
  const createdAt: Date = minutesFromNow(-11);

  return {
    lane: "Incident",
    projectId: PROJECT_ID,
    subjectId: INCIDENT_ID,
    createdAt,
    waitUntil: new Date(createdAt.getTime() + 10 * MINUTE),
    currentStateId: OPEN_STATE,
    ...overrides,
  };
}

type CompareAndSetSpy = SpyInstance<
  typeof IncidentService.compareAndSetColumnsByIdWithoutHooks
>;

interface Mocks {
  incidentCas: CompareAndSetSpy;
  alertCas: SpyInstance<
    typeof AlertService.compareAndSetColumnsByIdWithoutHooks
  >;
  runCount: SpyInstance<typeof AIRunService.countBy>;
  recordSkipped: SpyInstance<typeof InvestigationEligibility.recordSkipped>;
  investigateIncident: SpyInstance<
    typeof AIIncidentInvestigationRunner.investigateNewIncident
  >;
  investigateAlert: SpyInstance<
    typeof AIAlertInvestigationRunner.investigateNewAlert
  >;
  loggerError: SpyInstance<typeof logger.error>;
}

let mocks: Mocks;

beforeEach(() => {
  mocks = {
    incidentCas: jest
      .spyOn(IncidentService, "compareAndSetColumnsByIdWithoutHooks")
      .mockResolvedValue(true),
    alertCas: jest
      .spyOn(AlertService, "compareAndSetColumnsByIdWithoutHooks")
      .mockResolvedValue(true),
    runCount: jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0)),
    recordSkipped: jest
      .spyOn(InvestigationEligibility, "recordSkipped")
      .mockResolvedValue(undefined),
    investigateIncident: jest
      .spyOn(AIIncidentInvestigationRunner, "investigateNewIncident")
      .mockResolvedValue(true),
    investigateAlert: jest
      .spyOn(AIAlertInvestigationRunner, "investigateNewAlert")
      .mockResolvedValue(true),
    loggerError: jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    }),
  };

  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockResolvedValue([OPEN_STATE]);
  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([OPEN_STATE]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("startWaiting: a new record starts waiting", () => {
  test("writes when the wait ends, only while the record is the project's and waits for nothing yet", async () => {
    const waitUntil: Date = minutesFromNow(10);

    expect(
      await InvestigationRuleWait.startWaiting({
        lane: "Incident",
        projectId: PROJECT_ID,
        subjectId: INCIDENT_ID,
        waitUntil,
      }),
    ).toBe(true);

    expect(mocks.incidentCas).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      data: { aiInvestigationWaitUntil: waitUntil },
      expectedData: { projectId: PROJECT_ID, aiInvestigationWaitUntil: null },
      skipUpdateDateColumn: true,
    });
    expect(mocks.alertCas).not.toHaveBeenCalled();
  });

  test("an alert's wait is written on the alert", async () => {
    await InvestigationRuleWait.startWaiting({
      lane: "Alert",
      projectId: PROJECT_ID,
      subjectId: ALERT_ID,
      waitUntil: minutesFromNow(5),
    });

    expect(mocks.alertCas).toHaveBeenCalledTimes(1);
    expect(mocks.incidentCas).not.toHaveBeenCalled();
  });

  test("a wait already being kept is not overwritten: the write says it did nothing", async () => {
    mocks.incidentCas.mockResolvedValue(false);

    expect(
      await InvestigationRuleWait.startWaiting({
        lane: "Incident",
        projectId: PROJECT_ID,
        subjectId: INCIDENT_ID,
        waitUntil: minutesFromNow(10),
      }),
    ).toBe(false);
  });

  test("a failed write never throws: the record is investigated right away instead", async () => {
    mocks.incidentCas.mockRejectedValue(new Error("database is down"));

    expect(
      await InvestigationRuleWait.startWaiting({
        lane: "Incident",
        projectId: PROJECT_ID,
        subjectId: INCIDENT_ID,
        waitUntil: minutesFromNow(10),
      }),
    ).toBe(false);
    expect(String(mocks.loggerError.mock.calls[0]![0])).toContain(
      "investigating it right away instead",
    );
  });
});

describe("getEndedWaits: the records whose wait has ended", () => {
  test("reads the incidents whose wait ended, the earliest first, a batch at a time, as root", async () => {
    const findBy: SpyInstance<typeof IncidentService.findBy> = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([]);

    await InvestigationRuleWait.getEndedWaits("Incident");

    const call: Parameters<typeof IncidentService.findBy>[0] =
      findBy.mock.calls[0]![0];

    expect(Object.keys(call.query)).toEqual(["aiInvestigationWaitUntil"]);
    // "<= :now": the raw operator QueryHelper.lessThanEqualTo writes.
    expect(
      (call.query.aiInvestigationWaitUntil as unknown as { _type: string })
        ._type,
    ).toBe(
      (QueryHelper.lessThanEqualTo(new Date()) as unknown as { _type: string })
        ._type,
    );
    expect(operatorDates(call.query.aiInvestigationWaitUntil)).toHaveLength(1);
    expect(call.select).toEqual({
      _id: true,
      projectId: true,
      createdAt: true,
      aiInvestigationWaitUntil: true,
      currentIncidentStateId: true,
    });
    expect(call.sort).toEqual({
      aiInvestigationWaitUntil: SortOrder.Ascending,
    });
    expect(call.limit).toBe(RULE_WAIT_BATCH_SIZE);
    expect(call.props).toEqual({ isRoot: true });
  });

  test("the time it reads up to is now: a wait that ends later is not read", async () => {
    const findBy: SpyInstance<typeof IncidentService.findBy> = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([]);
    const before: number = Date.now();

    await InvestigationRuleWait.getEndedWaits("Incident");

    const upTo: Date = operatorDates(
      findBy.mock.calls[0]![0].query.aiInvestigationWaitUntil,
    )[0]!;

    expect(upTo.getTime()).toBeGreaterThanOrEqual(before);
    expect(upTo.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("alerts are read from the alerts, with their own state", async () => {
    const alertFindBy: SpyInstance<typeof AlertService.findBy> = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([]);
    const incidentFindBy: SpyInstance<typeof IncidentService.findBy> =
      jest.spyOn(IncidentService, "findBy");

    await InvestigationRuleWait.getEndedWaits("Alert");

    expect(incidentFindBy).not.toHaveBeenCalled();
    expect(alertFindBy.mock.calls[0]![0].select).toEqual({
      _id: true,
      projectId: true,
      createdAt: true,
      aiInvestigationWaitUntil: true,
      currentAlertStateId: true,
    });
  });

  test("rows it cannot read a wait from are left out", async () => {
    const createdAt: Date = minutesFromNow(-20);
    const waitUntil: Date = minutesFromNow(-10);

    jest.spyOn(IncidentService, "findBy").mockResolvedValue([
      Object.assign(new Incident(), {
        _id: INCIDENT_ID.toString(),
        projectId: PROJECT_ID,
        createdAt,
        aiInvestigationWaitUntil: waitUntil,
        currentIncidentStateId: OPEN_STATE,
      }),
      // No wait any more.
      Object.assign(new Incident(), {
        _id: ObjectID.generate().toString(),
        projectId: PROJECT_ID,
        createdAt,
      }),
      // No project.
      Object.assign(new Incident(), {
        _id: ObjectID.generate().toString(),
        createdAt,
        aiInvestigationWaitUntil: waitUntil,
      }),
    ]);

    expect(await InvestigationRuleWait.getEndedWaits("Incident")).toEqual([
      {
        lane: "Incident",
        projectId: PROJECT_ID,
        subjectId: INCIDENT_ID,
        createdAt,
        waitUntil,
        currentStateId: OPEN_STATE,
      },
    ]);
  });
});

describe("onWaitEnded: a wait ends once", () => {
  test("takes the record off the waiting list with a compare-and-set of the time read", async () => {
    const wait: EndedWait = endedWait();

    await InvestigationRuleWait.onWaitEnded(wait);

    expect(mocks.incidentCas).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      data: { aiInvestigationWaitUntil: null },
      expectedData: {
        projectId: PROJECT_ID,
        aiInvestigationWaitUntil: wait.waitUntil,
      },
      skipUpdateDateColumn: true,
    });
  });

  test("still open: it goes down the new-incident path again, as decided after its wait", async () => {
    expect(await InvestigationRuleWait.onWaitEnded(endedWait())).toBe("queued");

    expect(mocks.investigateIncident).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      afterWaitMinutes: 10,
    });
    expect(mocks.recordSkipped).not.toHaveBeenCalled();
  });

  test("still open, but not queued then (a gate, a limit, a longer wait): says so", async () => {
    mocks.investigateIncident.mockResolvedValue(false);

    expect(await InvestigationRuleWait.onWaitEnded(endedWait())).toBe(
      "not_queued",
    );
  });

  test("resolved by then: not investigated, and its AI card says why, with the wait", async () => {
    expect(
      await InvestigationRuleWait.onWaitEnded(
        endedWait({ currentStateId: RESOLVED_STATE }),
      ),
    ).toBe("resolved");

    expect(mocks.investigateIncident).not.toHaveBeenCalled();
    expect(mocks.recordSkipped).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, incidentId: INCIDENT_ID },
      "resolved_before_investigation",
      undefined,
      { waitMinutes: 10 },
    );
  });

  test("a state after Resolved counts as resolved too: only the unresolved states are open", async () => {
    const closed: ObjectID = ObjectID.generate();

    expect(
      await InvestigationRuleWait.onWaitEnded(
        endedWait({ currentStateId: closed }),
      ),
    ).toBe("resolved");
  });

  test("a record whose state cannot be told is investigated rather than skipped", async () => {
    expect(
      await InvestigationRuleWait.onWaitEnded(
        endedWait({ currentStateId: undefined }),
      ),
    ).toBe("queued");
  });

  test("taken by another worker first (or its wait moved): nothing more happens", async () => {
    mocks.incidentCas.mockResolvedValue(false);

    expect(await InvestigationRuleWait.onWaitEnded(endedWait())).toBe(
      "taken_elsewhere",
    );
    expect(mocks.runCount).not.toHaveBeenCalled();
    expect(mocks.investigateIncident).not.toHaveBeenCalled();
    expect(mocks.recordSkipped).not.toHaveBeenCalled();
  });

  test("investigated meanwhile (Investigate now, Ask AI): no second investigation, nothing recorded", async () => {
    mocks.runCount.mockResolvedValue(new PositiveNumber(1));

    expect(
      await InvestigationRuleWait.onWaitEnded(
        endedWait({ currentStateId: RESOLVED_STATE }),
      ),
    ).toBe("already_investigated");

    expect(mocks.runCount.mock.calls[0]![0]).toEqual({
      query: {
        projectId: PROJECT_ID,
        runType: AIRunType.Investigation,
        triggeredByIncidentId: INCIDENT_ID,
      },
      props: { isRoot: true },
    });
    expect(mocks.investigateIncident).not.toHaveBeenCalled();
    expect(mocks.recordSkipped).not.toHaveBeenCalled();
  });

  test("a wait a change ended early says the wait it gives", async () => {
    await InvestigationRuleWait.onWaitEnded(endedWait(), { waitMinutes: 5 });

    expect(mocks.investigateIncident).toHaveBeenCalledWith(
      expect.objectContaining({ afterWaitMinutes: 5 }),
    );
  });

  test("an alert's wait ends on the alert's path, with the alert's states", async () => {
    const alertCreatedAt: Date = minutesFromNow(-31);

    expect(
      await InvestigationRuleWait.onWaitEnded({
        lane: "Alert",
        projectId: PROJECT_ID,
        subjectId: ALERT_ID,
        createdAt: alertCreatedAt,
        waitUntil: new Date(alertCreatedAt.getTime() + 30 * MINUTE),
        currentStateId: OPEN_STATE,
      }),
    ).toBe("queued");

    expect(mocks.alertCas).toHaveBeenCalledTimes(1);
    expect(mocks.incidentCas).not.toHaveBeenCalled();
    expect(mocks.investigateAlert).toHaveBeenCalledWith({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
      afterWaitMinutes: 30,
    });
    expect(mocks.runCount.mock.calls[0]![0].query).toMatchObject({
      triggeredByAlertId: ALERT_ID,
    });
  });

  test("a resolved alert's AI card says why", async () => {
    const alertCreatedAt: Date = minutesFromNow(-16);

    await InvestigationRuleWait.onWaitEnded({
      lane: "Alert",
      projectId: PROJECT_ID,
      subjectId: ALERT_ID,
      createdAt: alertCreatedAt,
      waitUntil: new Date(alertCreatedAt.getTime() + 15 * MINUTE),
      currentStateId: RESOLVED_STATE,
    });

    expect(mocks.recordSkipped).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, alertId: ALERT_ID },
      "resolved_before_investigation",
      undefined,
      { waitMinutes: 15 },
    );
  });

  test("never throws: a failure is logged and the record is not queued", async () => {
    mocks.investigateIncident.mockRejectedValue(new Error("boom"));

    expect(await InvestigationRuleWait.onWaitEnded(endedWait())).toBe(
      "not_queued",
    );
    expect(String(mocks.loggerError.mock.calls[0]![0])).toContain(
      "could not end the investigation wait",
    );
  });
});

describe("run: the rule-wait job's tick", () => {
  test("ends every wait that ended, incidents then alerts, and says what happened to each", async () => {
    const incidentCreatedAt: Date = minutesFromNow(-12);
    const alertCreatedAt: Date = minutesFromNow(-7);

    jest.spyOn(IncidentService, "findBy").mockResolvedValue([
      Object.assign(new Incident(), {
        _id: INCIDENT_ID.toString(),
        projectId: PROJECT_ID,
        createdAt: incidentCreatedAt,
        aiInvestigationWaitUntil: new Date(
          incidentCreatedAt.getTime() + 10 * MINUTE,
        ),
        currentIncidentStateId: RESOLVED_STATE,
      }),
    ]);
    jest.spyOn(AlertService, "findBy").mockResolvedValue([
      Object.assign(new Alert(), {
        _id: ALERT_ID.toString(),
        projectId: PROJECT_ID,
        createdAt: alertCreatedAt,
        aiInvestigationWaitUntil: new Date(
          alertCreatedAt.getTime() + 5 * MINUTE,
        ),
        currentAlertStateId: OPEN_STATE,
      }),
    ]);

    const results: Array<RuleWaitResult> = await InvestigationRuleWait.run();

    expect(results).toEqual([
      {
        lane: "Incident",
        projectId: PROJECT_ID,
        subjectId: INCIDENT_ID,
        outcome: "resolved",
      },
      {
        lane: "Alert",
        projectId: PROJECT_ID,
        subjectId: ALERT_ID,
        outcome: "queued",
      },
    ]);
  });

  test("nothing waiting: nothing happens", async () => {
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
    jest.spyOn(AlertService, "findBy").mockResolvedValue([]);

    expect(await InvestigationRuleWait.run()).toEqual([]);
    expect(mocks.incidentCas).not.toHaveBeenCalled();
    expect(mocks.alertCas).not.toHaveBeenCalled();
  });

  test("a lane that cannot be read is read again next time; the other still runs", async () => {
    jest
      .spyOn(IncidentService, "findBy")
      .mockRejectedValue(new Error("database is down"));
    jest.spyOn(AlertService, "findBy").mockResolvedValue([
      Object.assign(new Alert(), {
        _id: ALERT_ID.toString(),
        projectId: PROJECT_ID,
        createdAt: minutesFromNow(-20),
        aiInvestigationWaitUntil: minutesFromNow(-10),
        currentAlertStateId: OPEN_STATE,
      }),
    ]);

    const results: Array<RuleWaitResult> = await InvestigationRuleWait.run();

    expect(results.map((result: RuleWaitResult) => result.lane)).toEqual([
      "Alert",
    ]);
    expect(String(mocks.loggerError.mock.calls[0]![0])).toContain(
      "read again on the next run",
    );
  });

  test("a worker that was down ends every wait that ended meanwhile, however long ago", async () => {
    const longAgo: Date = minutesFromNow(-6 * 60);

    jest.spyOn(IncidentService, "findBy").mockResolvedValue([
      Object.assign(new Incident(), {
        _id: INCIDENT_ID.toString(),
        projectId: PROJECT_ID,
        createdAt: longAgo,
        aiInvestigationWaitUntil: new Date(longAgo.getTime() + 30 * MINUTE),
        currentIncidentStateId: OPEN_STATE,
      }),
    ]);
    jest.spyOn(AlertService, "findBy").mockResolvedValue([]);

    expect(
      (await InvestigationRuleWait.run()).map((result: RuleWaitResult) => {
        return result.outcome;
      }),
    ).toEqual(["queued"]);
    expect(mocks.investigateIncident).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      afterWaitMinutes: 30,
    });
  });

  test("two workers running the same tick end each wait once", async () => {
    const createdAt: Date = minutesFromNow(-11);
    const row: Incident = Object.assign(new Incident(), {
      _id: INCIDENT_ID.toString(),
      projectId: PROJECT_ID,
      createdAt,
      aiInvestigationWaitUntil: new Date(createdAt.getTime() + 10 * MINUTE),
      currentIncidentStateId: OPEN_STATE,
    });

    jest.spyOn(IncidentService, "findBy").mockResolvedValue([row]);
    jest.spyOn(AlertService, "findBy").mockResolvedValue([]);

    // The database's compare-and-set: one caller wins.
    let isWaiting: boolean = true;
    mocks.incidentCas.mockImplementation(async (): Promise<boolean> => {
      if (!isWaiting) {
        return false;
      }

      isWaiting = false;
      return true;
    });

    const [first, second]: [Array<RuleWaitResult>, Array<RuleWaitResult>] =
      await Promise.all([
        InvestigationRuleWait.run(),
        InvestigationRuleWait.run(),
      ]);

    expect(
      [...first, ...second]
        .map((result: RuleWaitResult) => {
          return result.outcome;
        })
        .sort(),
    ).toEqual(["queued", "taken_elsewhere"]);
    expect(mocks.investigateIncident).toHaveBeenCalledTimes(1);
  });
});

describe("onSubjectChanged: the wait follows what the rules read", () => {
  function waitingIncident(data: { waitedMinutes: number; wait: number }): {
    incident: Incident;
    createdAt: Date;
  } {
    const createdAt: Date = minutesFromNow(-data.waitedMinutes);

    return {
      createdAt,
      incident: Object.assign(new Incident(), {
        _id: INCIDENT_ID.toString(),
        createdAt,
        aiInvestigationWaitUntil: new Date(
          createdAt.getTime() + data.wait * MINUTE,
        ),
        currentIncidentStateId: OPEN_STATE,
      }),
    };
  }

  test("a record that does not wait is left alone, and no rule is read", async () => {
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(Object.assign(new Incident(), { _id: "x" }));
    const scope: SpyInstance<typeof InvestigationRules.getIncidentScope> =
      jest.spyOn(InvestigationRules, "getIncidentScope");

    await InvestigationRuleWait.onSubjectChanged({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });

    expect(scope).not.toHaveBeenCalled();
    expect(mocks.incidentCas).not.toHaveBeenCalled();
  });

  test("reads the waiting record with what the rules match on", async () => {
    const findOneBy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(null);

    await InvestigationRuleWait.onSubjectChanged({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });

    expect(findOneBy.mock.calls[0]![0]).toMatchObject({
      query: { _id: INCIDENT_ID.toString(), projectId: PROJECT_ID },
      select: {
        createdAt: true,
        aiInvestigationWaitUntil: true,
        title: true,
        description: true,
        incidentSeverityId: true,
        labels: { _id: true },
        monitors: { _id: true },
      },
      props: { isRoot: true },
    });
  });

  test("raised to a severity a longer wait applies to: it waits on, until the new end", async () => {
    const { incident, createdAt } = waitingIncident({
      waitedMinutes: 3,
      wait: 10,
    });

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
    jest
      .spyOn(InvestigationRules, "getIncidentScope")
      .mockResolvedValue({ isInScope: true, rulesChecked: 2, waitMinutes: 30 });

    await InvestigationRuleWait.onSubjectChanged({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });

    expect(mocks.incidentCas).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      data: {
        aiInvestigationWaitUntil: new Date(createdAt.getTime() + 30 * MINUTE),
      },
      expectedData: {
        projectId: PROJECT_ID,
        aiInvestigationWaitUntil: incident.aiInvestigationWaitUntil,
      },
      skipUpdateDateColumn: true,
    });
    expect(mocks.investigateIncident).not.toHaveBeenCalled();
  });

  test("a shorter wait that has not passed yet moves the end earlier", async () => {
    const { incident, createdAt } = waitingIncident({
      waitedMinutes: 3,
      wait: 30,
    });

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
    jest
      .spyOn(InvestigationRules, "getIncidentScope")
      .mockResolvedValue({ isInScope: true, rulesChecked: 2, waitMinutes: 10 });

    await InvestigationRuleWait.onSubjectChanged({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });

    expect(mocks.incidentCas.mock.calls[0]![0].data).toEqual({
      aiInvestigationWaitUntil: new Date(createdAt.getTime() + 10 * MINUTE),
    });
    expect(mocks.investigateIncident).not.toHaveBeenCalled();
  });

  test("a shorter wait that has already passed ends the wait now, under the new wait", async () => {
    const { incident } = waitingIncident({ waitedMinutes: 12, wait: 30 });

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
    jest
      .spyOn(InvestigationRules, "getIncidentScope")
      .mockResolvedValue({ isInScope: true, rulesChecked: 2, waitMinutes: 10 });

    await InvestigationRuleWait.onSubjectChanged({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });

    // Taken off the list under the time it held, then investigated.
    expect(mocks.incidentCas).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { aiInvestigationWaitUntil: null },
        expectedData: {
          projectId: PROJECT_ID,
          aiInvestigationWaitUntil: incident.aiInvestigationWaitUntil,
        },
      }),
    );
    expect(mocks.investigateIncident).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      afterWaitMinutes: 10,
    });
  });

  test("raised to a severity whose rule investigates right away: investigated now, saying the wait it had", async () => {
    const { incident } = waitingIncident({ waitedMinutes: 4, wait: 30 });

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
    jest
      .spyOn(InvestigationRules, "getIncidentScope")
      .mockResolvedValue({ isInScope: true, rulesChecked: 2 });

    await InvestigationRuleWait.onSubjectChanged({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });

    expect(mocks.investigateIncident).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      afterWaitMinutes: 30,
    });
  });

  test("the same wait as before changes nothing", async () => {
    const { incident } = waitingIncident({ waitedMinutes: 4, wait: 10 });

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
    jest
      .spyOn(InvestigationRules, "getIncidentScope")
      .mockResolvedValue({ isInScope: true, rulesChecked: 1, waitMinutes: 10 });

    await InvestigationRuleWait.onSubjectChanged({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });

    expect(mocks.incidentCas).not.toHaveBeenCalled();
    expect(mocks.investigateIncident).not.toHaveBeenCalled();
  });

  test("lowered to a severity no rule matches: the wait stays, and it is decided when it ends", async () => {
    const { incident } = waitingIncident({ waitedMinutes: 4, wait: 10 });

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
    jest
      .spyOn(InvestigationRules, "getIncidentScope")
      .mockResolvedValue({ isInScope: false, rulesChecked: 2 });

    await InvestigationRuleWait.onSubjectChanged({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });

    expect(mocks.incidentCas).not.toHaveBeenCalled();
    expect(mocks.recordSkipped).not.toHaveBeenCalled();
  });

  test("an alert's wait follows its own rules", async () => {
    const createdAt: Date = minutesFromNow(-2);
    const alert: Alert = Object.assign(new Alert(), {
      _id: ALERT_ID.toString(),
      createdAt,
      aiInvestigationWaitUntil: new Date(createdAt.getTime() + 5 * MINUTE),
      currentAlertStateId: OPEN_STATE,
    });
    const findOneBy: SpyInstance<typeof AlertService.findOneBy> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(alert);
    const scope: SpyInstance<typeof InvestigationRules.getAlertScope> = jest
      .spyOn(InvestigationRules, "getAlertScope")
      .mockResolvedValue({ isInScope: true, rulesChecked: 1, waitMinutes: 20 });

    await InvestigationRuleWait.onSubjectChanged({
      lane: "Alert",
      projectId: PROJECT_ID,
      subjectId: ALERT_ID,
    });

    expect(findOneBy.mock.calls[0]![0].select).toMatchObject({
      alertSeverityId: true,
      monitorId: true,
      labels: { _id: true },
    });
    expect(scope).toHaveBeenCalledWith({ projectId: PROJECT_ID, alert });
    expect(mocks.alertCas.mock.calls[0]![0].data).toEqual({
      aiInvestigationWaitUntil: new Date(createdAt.getTime() + 20 * MINUTE),
    });
  });

  test("never throws: a failure is logged and the wait ends as it was", async () => {
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      InvestigationRuleWait.onSubjectChanged({
        lane: "Incident",
        projectId: PROJECT_ID,
        subjectId: INCIDENT_ID,
      }),
    ).resolves.toBeUndefined();
    expect(String(mocks.loggerError.mock.calls[0]![0])).toContain(
      "the wait ends as it was",
    );
  });
});

describe("startNow: someone starts a waiting investigation at once", () => {
  function waiting(minutes: number = 10): Incident {
    const createdAt: Date = minutesFromNow(-2);

    return Object.assign(new Incident(), {
      _id: INCIDENT_ID.toString(),
      createdAt,
      aiInvestigationWaitUntil: new Date(
        createdAt.getTime() + minutes * MINUTE,
      ),
      monitors: [{ _id: MONITOR_ID.toString() }],
    });
  }

  type EnqueueSpy = SpyInstance<typeof AIInvestigationQueue.enqueue>;

  test("queues the investigation now, saying it waited, as the record's one investigation, and ends the wait", async () => {
    const incident: Incident = waiting(10);

    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null);
    const enqueue: EnqueueSpy = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(RUN_ID);

    const result: StartNowResult = await InvestigationRuleWait.startNow({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });

    expect(result).toEqual({ isStarted: true, runId: RUN_ID });

    const request: Parameters<typeof AIInvestigationQueue.enqueue>[0] =
      enqueue.mock.calls[0]![0];
    expect(request).toMatchObject({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
      subjectMonitorId: MONITOR_ID,
      ruleWaitMinutes: 10,
    });
    expect(request.subjectAlertId).toBeUndefined();

    // Admitted only while the incident has no investigation of its own.
    expect(await request.admitInsideSubjectLock!()).toBe(true);
    mocks.runCount.mockResolvedValue(new PositiveNumber(1));
    expect(await request.admitInsideSubjectLock!()).toBe(false);

    // Off the waiting list, under the time read.
    expect(mocks.incidentCas).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      data: { aiInvestigationWaitUntil: null },
      expectedData: {
        projectId: PROJECT_ID,
        aiInvestigationWaitUntil: incident.aiInvestigationWaitUntil,
      },
      skipUpdateDateColumn: true,
    });
  });

  test("ignores the rules, the severity floor and the cooldown: it never goes through the gates", async () => {
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(waiting());
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null);
    jest.spyOn(AIInvestigationQueue, "enqueue").mockResolvedValue(RUN_ID);
    const gate: SpyInstance<
      typeof AIIncidentInvestigationRunner.shouldInvestigateIncident
    > = jest.spyOn(AIIncidentInvestigationRunner, "shouldInvestigateIncident");
    const scope: SpyInstance<typeof InvestigationRules.getIncidentScope> =
      jest.spyOn(InvestigationRules, "getIncidentScope");

    await InvestigationRuleWait.startNow({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });

    expect(gate).not.toHaveBeenCalled();
    expect(scope).not.toHaveBeenCalled();
    expect(mocks.investigateIncident).not.toHaveBeenCalled();
  });

  test("starts even when automatic investigation was switched off since: someone is asking", async () => {
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(waiting());
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue("automatic_investigation_disabled");
    jest.spyOn(AIInvestigationQueue, "enqueue").mockResolvedValue(RUN_ID);

    expect(
      (
        await InvestigationRuleWait.startNow({
          lane: "Incident",
          projectId: PROJECT_ID,
          subjectId: INCIDENT_ID,
        })
      ).isStarted,
    ).toBe(true);
  });

  test.each([
    ["ai_disabled", "AI is turned off for this project"],
    ["provider_missing", "no AI provider"],
    ["insufficient_ai_balance", "out of AI credits"],
    ["project_daily_limit_reached", "daily AI limit"],
  ])(
    "does not start while %s, saying so, and the wait stays",
    async (code: string, words: string) => {
      jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(waiting());
      jest
        .spyOn(AIInvestigationEngine, "getDisabledReason")
        .mockResolvedValue(code as InvestigationNotStartedCode);
      const enqueue: EnqueueSpy = jest.spyOn(AIInvestigationQueue, "enqueue");

      const result: StartNowResult = await InvestigationRuleWait.startNow({
        lane: "Incident",
        projectId: PROJECT_ID,
        subjectId: INCIDENT_ID,
      });

      expect(result.isStarted).toBe(false);
      expect(result.isStarted === false && result.problem).toBe(code);
      expect(result.isStarted === false && result.message).toContain(words);
      expect(enqueue).not.toHaveBeenCalled();
      expect(mocks.incidentCas).not.toHaveBeenCalled();
    },
  );

  test("a limit that stops it at the queue is told to the person, not recorded on the card", async () => {
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(waiting());
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null);
    jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockImplementation(
        async (
          data: Parameters<typeof AIInvestigationQueue.enqueue>[0],
        ): Promise<ObjectID | null> => {
          await data.onNotEnqueued!("daily_budget_exhausted");
          return null;
        },
      );

    const result: StartNowResult = await InvestigationRuleWait.startNow({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });

    expect(result).toEqual({
      isStarted: false,
      problem: "daily_budget_exhausted",
      message:
        "The daily AI token limit for this kind of record is reached. It resets at midnight UTC.",
    });
    expect(mocks.recordSkipped).not.toHaveBeenCalled();
    expect(mocks.incidentCas).not.toHaveBeenCalled();
  });

  test("started by someone else first (not admitted): says it has already started", async () => {
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(waiting());
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null);
    jest.spyOn(AIInvestigationQueue, "enqueue").mockResolvedValue(null);

    expect(
      await InvestigationRuleWait.startNow({
        lane: "Incident",
        projectId: PROJECT_ID,
        subjectId: INCIDENT_ID,
      }),
    ).toEqual({
      isStarted: false,
      problem: "already_investigated",
      message: "OneUptime AI has already started investigating this.",
    });
  });

  test("a record that no longer waits says so: already investigated, or nothing to start", async () => {
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(Object.assign(new Incident(), { _id: "x" }));

    expect(
      (
        await InvestigationRuleWait.startNow({
          lane: "Incident",
          projectId: PROJECT_ID,
          subjectId: INCIDENT_ID,
        })
      ).isStarted === false,
    ).toBe(true);

    const notWaiting: StartNowResult = await InvestigationRuleWait.startNow({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });
    expect(notWaiting.isStarted === false && notWaiting.problem).toBe(
      "not_waiting",
    );

    mocks.runCount.mockResolvedValue(new PositiveNumber(1));
    const investigated: StartNowResult = await InvestigationRuleWait.startNow({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });
    expect(investigated.isStarted === false && investigated.problem).toBe(
      "already_investigated",
    );
  });

  test("an alert starts on the alert's lane, with its monitor", async () => {
    const createdAt: Date = minutesFromNow(-1);

    jest.spyOn(AlertService, "findOneBy").mockResolvedValue(
      Object.assign(new Alert(), {
        _id: ALERT_ID.toString(),
        createdAt,
        aiInvestigationWaitUntil: new Date(createdAt.getTime() + 15 * MINUTE),
        monitorId: MONITOR_ID,
      }),
    );
    const disabled: SpyInstance<
      typeof AIInvestigationEngine.getDisabledReason
    > = jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null);
    const enqueue: EnqueueSpy = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(RUN_ID);

    await InvestigationRuleWait.startNow({
      lane: "Alert",
      projectId: PROJECT_ID,
      subjectId: ALERT_ID,
    });

    expect(disabled).toHaveBeenCalledWith(PROJECT_ID, "Alert");
    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      subjectAlertId: ALERT_ID,
      subjectMonitorId: MONITOR_ID,
      ruleWaitMinutes: 15,
    });
    expect(mocks.alertCas).toHaveBeenCalledTimes(1);
  });

  test("never throws: a failure says it could not be started", async () => {
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(waiting());
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockRejectedValue(new Error("boom"));

    expect(
      await InvestigationRuleWait.startNow({
        lane: "Incident",
        projectId: PROJECT_ID,
        subjectId: INCIDENT_ID,
      }),
    ).toEqual({
      isStarted: false,
      problem: "enqueue_failed",
      message: "The investigation could not be started. Try again in a moment.",
    });
  });
});

describe("getWaiting: what the AI card shows while it waits", () => {
  test("until when, and the wait in minutes, read as root inside the project", async () => {
    const createdAt: Date = new Date("2026-10-20T10:00:00.000Z");
    const findOneBy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(
        Object.assign(new Incident(), {
          _id: INCIDENT_ID.toString(),
          createdAt,
          aiInvestigationWaitUntil: new Date("2026-10-20T10:30:00.000Z"),
        }),
      );

    const result: WaitingInvestigation | null =
      await InvestigationRuleWait.getWaiting({
        lane: "Incident",
        projectId: PROJECT_ID,
        subjectId: INCIDENT_ID,
      });

    expect(result).toEqual({
      waitUntil: new Date("2026-10-20T10:30:00.000Z"),
      waitMinutes: 30,
    });
    expect(findOneBy.mock.calls[0]![0]).toMatchObject({
      query: { _id: INCIDENT_ID.toString(), projectId: PROJECT_ID },
      props: { isRoot: true },
    });
  });

  test("a record that does not wait has nothing to show", async () => {
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(
        Object.assign(new Incident(), { createdAt: new Date() }),
      );

    expect(
      await InvestigationRuleWait.getWaiting({
        lane: "Incident",
        projectId: PROJECT_ID,
        subjectId: INCIDENT_ID,
      }),
    ).toBeNull();
  });

  test("a record that cannot be read has nothing to show, and nothing throws", async () => {
    jest.spyOn(AlertService, "findOneBy").mockRejectedValue(new Error("down"));

    expect(
      await InvestigationRuleWait.getWaiting({
        lane: "Alert",
        projectId: PROJECT_ID,
        subjectId: ALERT_ID,
      }),
    ).toBeNull();
  });
});
