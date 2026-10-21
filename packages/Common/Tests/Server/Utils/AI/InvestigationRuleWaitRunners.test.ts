import AIIncidentInvestigationRunner, {
  IncidentGateDecision,
} from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIAlertInvestigationRunner, {
  AlertGateDecision,
} from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue, {
  MAX_INVESTIGATION_ATTEMPTS,
} from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import InvestigationEligibility from "../../../../Server/Utils/AI/SRE/InvestigationEligibility";
import InvestigationRuleWait from "../../../../Server/Utils/AI/SRE/InvestigationRuleWait";
import InvestigationRules from "../../../../Server/Utils/AI/SRE/InvestigationRules";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../../../../Server/Utils/AI/IncidentAIContextBuilder";
import AlertAIContextBuilder, {
  AlertContextData,
} from "../../../../Server/Utils/AI/AlertAIContextBuilder";
import AIMemory from "../../../../Server/Utils/AI/SRE/AIMemory";
import LinkedInfrastructureContext from "../../../../Server/Utils/AI/SRE/LinkedInfrastructureContext";
import IncidentFollowUpCheck from "../../../../Server/Utils/AI/SRE/IncidentFollowUpCheck";
import RecentChangesContext from "../../../../Server/Utils/AI/SRE/RecentChangesContext";
import RemediationHandoff from "../../../../Server/Utils/AI/SRE/RemediationHandoff";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIService from "../../../../Server/Services/AIService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE RUNNERS AND THE QUEUE WITH A RULE THAT WAITS (issue #5074).
 *
 * - A new incident (or alert) whose matching investigation rules all wait
 *   is not queued: it waits until its creation plus the shortest wait, and
 *   the runner answers "nothing queued", so auto remediation runs at once.
 * - When the wait ends (afterWaitMinutes) everything is decided as of then:
 *   the rules (a longer wait waits again, no match is skipped), what stops
 *   AI, the limits - each recorded as decided after the wait - and a run
 *   that does start says it waited (ruleWaitMinutes) and is the record's one
 *   investigation (admitted only while it has none).
 * - Such a run never hands its record to auto remediation, which did not
 *   wait for it: not when it settles, fails for good, expires or goes stale.
 *   An incident's still asks whether an alert opened while it read.
 * - Nothing changes for a record whose rules do not wait.
 */

jest.mock("../../../../Server/Utils/AI/SRE/RemediationHandoff", () => {
  return {
    __esModule: true,
    default: {
      runForSettledInvestigation: jest.fn(),
    },
  };
});

const handoff: jest.Mock =
  RemediationHandoff.runForSettledInvestigation as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const MONITOR_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const RUN_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

const MINUTE: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

function incidentGate(
  overrides: Partial<IncidentGateDecision> = {},
): IncidentGateDecision {
  return {
    investigate: true,
    reason: "passed severity and dedupe gates",
    monitorId: MONITOR_ID,
    ...overrides,
  };
}

function alertGate(
  overrides: Partial<AlertGateDecision> = {},
): AlertGateDecision {
  return {
    investigate: true,
    reason: "passed severity and dedupe gates",
    monitorId: MONITOR_ID,
    ...overrides,
  };
}

type EnqueueRequest = Parameters<typeof AIInvestigationQueue.enqueue>[0];

describe("a new incident whose rules wait", () => {
  let enqueue: jest.SpyInstance;
  let startWaiting: jest.SpyInstance;
  let recordSkipped: jest.SpyInstance;
  let gate: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null);
    gate = jest
      .spyOn(AIIncidentInvestigationRunner, "shouldInvestigateIncident")
      .mockResolvedValue(incidentGate());
    enqueue = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(RUN_ID);
    startWaiting = jest
      .spyOn(InvestigationRuleWait, "startWaiting")
      .mockResolvedValue(true);
    recordSkipped = jest
      .spyOn(InvestigationEligibility, "recordSkipped")
      .mockResolvedValue(undefined);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    handoff.mockClear();
  });

  test("waits until its declaration plus the wait, queues nothing, records nothing, and says nothing was queued", async () => {
    const createdAt: Date = minutesAgo(0);
    gate.mockResolvedValue(incidentGate({ waitMinutes: 10, createdAt }));

    expect(
      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      }),
    ).toBe(false);

    expect(startWaiting).toHaveBeenCalledWith({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
      waitUntil: new Date(createdAt.getTime() + 10 * MINUTE),
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(recordSkipped).not.toHaveBeenCalled();
  });

  test("a rule with no wait queues it at once, exactly as before rules could wait", async () => {
    expect(
      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      }),
    ).toBe(true);

    expect(startWaiting).not.toHaveBeenCalled();
    const request: EnqueueRequest = enqueue.mock.calls[0]![0];
    expect(request).toMatchObject({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
      subjectMonitorId: MONITOR_ID,
    });
    expect(request.ruleWaitMinutes).toBeUndefined();
    expect(request.admitInsideSubjectLock).toBeUndefined();
  });

  test("a wait that cannot be written: investigated at once, as a run its remediation waits for", async () => {
    startWaiting.mockResolvedValue(false);
    gate.mockResolvedValue(
      incidentGate({ waitMinutes: 10, createdAt: minutesAgo(0) }),
    );

    expect(
      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      }),
    ).toBe(true);

    const request: EnqueueRequest = enqueue.mock.calls[0]![0];
    // Not stamped: it releases remediation when it settles, like any run.
    expect(request.ruleWaitMinutes).toBeUndefined();
  });

  test("caught up after its wait had passed (the daily limit catch-up): queued at once, saying it waited, as its one investigation", async () => {
    gate.mockResolvedValue(
      incidentGate({ waitMinutes: 10, createdAt: minutesAgo(45) }),
    );

    expect(
      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      }),
    ).toBe(true);

    expect(startWaiting).not.toHaveBeenCalled();
    const request: EnqueueRequest = enqueue.mock.calls[0]![0];
    expect(request.ruleWaitMinutes).toBe(10);
    expect(await request.admitInsideSubjectLock!()).toBe(true);
  });

  test("an incident declared resolved is not investigated, whatever its rules wait", async () => {
    gate.mockResolvedValue(
      incidentGate({ waitMinutes: 10, createdAt: minutesAgo(0) }),
    );

    expect(
      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        createdResolved: true,
      }),
    ).toBe(false);

    expect(startWaiting).not.toHaveBeenCalled();
    expect(recordSkipped).toHaveBeenCalledWith(
      { incidentId: INCIDENT_ID, projectId: PROJECT_ID },
      "created_resolved",
    );
  });

  describe("when the wait ends (afterWaitMinutes)", () => {
    test("still in scope: queued now, saying it waited, admitted only while it has no investigation", async () => {
      gate.mockResolvedValue(
        incidentGate({ waitMinutes: 10, createdAt: minutesAgo(10) }),
      );

      expect(
        await AIIncidentInvestigationRunner.investigateNewIncident({
          incidentId: INCIDENT_ID,
          projectId: PROJECT_ID,
          afterWaitMinutes: 10,
        }),
      ).toBe(true);

      const request: EnqueueRequest = enqueue.mock.calls[0]![0];
      expect(request.ruleWaitMinutes).toBe(10);
      expect(await request.admitInsideSubjectLock!()).toBe(true);

      (AIRunService.countBy as unknown as jest.Mock).mockResolvedValue(
        new PositiveNumber(1),
      );
      expect(await request.admitInsideSubjectLock!()).toBe(false);
      expect(
        (AIRunService.countBy as unknown as jest.Mock).mock.calls[1]![0],
      ).toEqual({
        query: {
          projectId: PROJECT_ID,
          runType: AIRunType.Investigation,
          triggeredByIncidentId: INCIDENT_ID,
        },
        props: { isRoot: true },
      });
    });

    test("now matching a rule with no wait: queued at once, still saying the wait it had", async () => {
      gate.mockResolvedValue(incidentGate());

      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        afterWaitMinutes: 30,
      });

      expect(enqueue.mock.calls[0]![0].ruleWaitMinutes).toBe(30);
    });

    test("its severity now matching a rule that waits longer: it waits again, until the longer wait ends", async () => {
      const createdAt: Date = minutesAgo(10);
      gate.mockResolvedValue(incidentGate({ waitMinutes: 30, createdAt }));

      expect(
        await AIIncidentInvestigationRunner.investigateNewIncident({
          incidentId: INCIDENT_ID,
          projectId: PROJECT_ID,
          afterWaitMinutes: 10,
        }),
      ).toBe(false);

      expect(startWaiting).toHaveBeenCalledWith(
        expect.objectContaining({
          waitUntil: new Date(createdAt.getTime() + 30 * MINUTE),
        }),
      );
      expect(enqueue).not.toHaveBeenCalled();
    });

    test("matching no rule any more: skipped, recorded as decided after the wait", async () => {
      gate.mockResolvedValue({
        investigate: false,
        notStartedCode: "no_investigation_rule_matched",
        notStartedDetails: { rulesChecked: 2 },
        reason: "none of the 2 investigation rules matched",
      });

      expect(
        await AIIncidentInvestigationRunner.investigateNewIncident({
          incidentId: INCIDENT_ID,
          projectId: PROJECT_ID,
          afterWaitMinutes: 10,
        }),
      ).toBe(false);

      expect(recordSkipped).toHaveBeenCalledWith(
        { incidentId: INCIDENT_ID, projectId: PROJECT_ID },
        "no_investigation_rule_matched",
        undefined,
        { rulesChecked: 2, waitMinutes: 10 },
      );
    });

    test.each([
      ["ai_disabled"],
      ["automatic_investigation_disabled"],
      ["provider_missing"],
      ["insufficient_ai_balance"],
      ["project_daily_limit_reached"],
    ])(
      "what stops AI then (%s) is recorded as decided after the wait",
      async (code: string) => {
        (
          AIInvestigationEngine.getDisabledReason as unknown as jest.Mock
        ).mockResolvedValue(code);

        await AIIncidentInvestigationRunner.investigateNewIncident({
          incidentId: INCIDENT_ID,
          projectId: PROJECT_ID,
          afterWaitMinutes: 15,
        });

        expect(recordSkipped).toHaveBeenCalledWith(
          { incidentId: INCIDENT_ID, projectId: PROJECT_ID },
          code,
          undefined,
          { waitMinutes: 15 },
        );
        expect(enqueue).not.toHaveBeenCalled();
      },
    );

    test("a limit that stops it at the queue is recorded as decided after the wait", async () => {
      gate.mockResolvedValue(incidentGate());
      enqueue.mockImplementation(
        async (request: EnqueueRequest): Promise<ObjectID | null> => {
          await request.onNotEnqueued!("daily_budget_exhausted", {
            exhausted: true,
            limitInTokens: 1000,
            usedTokensToday: 1200,
          });
          return null;
        },
      );

      expect(
        await AIIncidentInvestigationRunner.investigateNewIncident({
          incidentId: INCIDENT_ID,
          projectId: PROJECT_ID,
          afterWaitMinutes: 10,
        }),
      ).toBe(false);

      expect(recordSkipped).toHaveBeenCalledWith(
        { incidentId: INCIDENT_ID, projectId: PROJECT_ID },
        "daily_budget_exhausted",
        { exhausted: true, limitInTokens: 1000, usedTokensToday: 1200 },
        { waitMinutes: 10 },
      );
    });

    test("an unexpected failure is recorded as decided after the wait", async () => {
      gate.mockRejectedValue(new Error("boom"));
      jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });

      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        afterWaitMinutes: 10,
      });

      expect(recordSkipped).toHaveBeenCalledWith(
        { incidentId: INCIDENT_ID, projectId: PROJECT_ID },
        "eligibility_check_failed",
        undefined,
        { waitMinutes: 10 },
      );
    });
  });

  test("without a wait, what it records carries nothing of one", async () => {
    gate.mockResolvedValue({
      investigate: false,
      notStartedCode: "monitor_cooldown",
      notStartedDetails: { cooldownWindowMinutes: 30 },
      reason: "cooldown",
    });

    await AIIncidentInvestigationRunner.investigateNewIncident({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
    });

    expect(recordSkipped).toHaveBeenCalledWith(
      { incidentId: INCIDENT_ID, projectId: PROJECT_ID },
      "monitor_cooldown",
      undefined,
      { cooldownWindowMinutes: 30 },
    );
  });
});

describe("the gate carries the rules' wait and the declaration", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an incident whose rules wait: the gate says how long, and from when", async () => {
    const createdAt: Date = minutesAgo(2);
    const findOneById: jest.SpyInstance = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(
        Object.assign(new Incident(), {
          createdAt,
          monitors: [{ _id: MONITOR_ID.toString() }],
        }),
      );
    jest
      .spyOn(InvestigationRules, "getIncidentScope")
      .mockResolvedValue({ isInScope: true, rulesChecked: 2, waitMinutes: 10 });
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(new Project(PROJECT_ID));

    const decision: IncidentGateDecision =
      await AIIncidentInvestigationRunner.shouldInvestigateIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      });

    expect(decision).toMatchObject({
      investigate: true,
      waitMinutes: 10,
      createdAt,
      monitorId: MONITOR_ID,
    });
    expect(findOneById.mock.calls[0]![0].select).toMatchObject({
      createdAt: true,
    });
  });

  test("an incident whose rules do not wait: the gate says nothing of a wait", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(
        Object.assign(new Incident(), { createdAt: minutesAgo(1) }),
      );
    jest
      .spyOn(InvestigationRules, "getIncidentScope")
      .mockResolvedValue({ isInScope: true, rulesChecked: 0 });
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(new Project(PROJECT_ID));

    const decision: IncidentGateDecision =
      await AIIncidentInvestigationRunner.shouldInvestigateIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      });

    expect(decision.investigate).toBe(true);
    expect(decision.waitMinutes).toBeUndefined();
    expect(decision.createdAt).toBeUndefined();
  });

  test("an alert's gate says it the same way", async () => {
    const createdAt: Date = minutesAgo(1);
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(
        Object.assign(new Alert(), { createdAt, monitorId: MONITOR_ID }),
      );
    jest
      .spyOn(InvestigationRules, "getAlertScope")
      .mockResolvedValue({ isInScope: true, rulesChecked: 1, waitMinutes: 5 });
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(new Project(PROJECT_ID));

    const decision: AlertGateDecision =
      await AIAlertInvestigationRunner.shouldInvestigateAlert({
        alertId: ALERT_ID,
        projectId: PROJECT_ID,
      });

    expect(decision).toMatchObject({
      investigate: true,
      waitMinutes: 5,
      createdAt,
    });
  });
});

describe("a new alert whose rules wait", () => {
  let enqueue: jest.SpyInstance;
  let startWaiting: jest.SpyInstance;
  let recordSkipped: jest.SpyInstance;
  let gate: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null);
    gate = jest
      .spyOn(AIAlertInvestigationRunner, "shouldInvestigateAlert")
      .mockResolvedValue(alertGate());
    enqueue = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(RUN_ID);
    startWaiting = jest
      .spyOn(InvestigationRuleWait, "startWaiting")
      .mockResolvedValue(true);
    recordSkipped = jest
      .spyOn(InvestigationEligibility, "recordSkipped")
      .mockResolvedValue(undefined);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("waits on the alert, and queues nothing", async () => {
    const createdAt: Date = minutesAgo(0);
    gate.mockResolvedValue(alertGate({ waitMinutes: 5, createdAt }));

    expect(
      await AIAlertInvestigationRunner.investigateNewAlert({
        alertId: ALERT_ID,
        projectId: PROJECT_ID,
      }),
    ).toBe(false);

    expect(startWaiting).toHaveBeenCalledWith({
      lane: "Alert",
      projectId: PROJECT_ID,
      subjectId: ALERT_ID,
      waitUntil: new Date(createdAt.getTime() + 5 * MINUTE),
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("when the wait ends it is queued saying it waited, as the alert's one investigation", async () => {
    gate.mockResolvedValue(
      alertGate({ waitMinutes: 5, createdAt: minutesAgo(5) }),
    );

    expect(
      await AIAlertInvestigationRunner.investigateNewAlert({
        alertId: ALERT_ID,
        projectId: PROJECT_ID,
        afterWaitMinutes: 5,
      }),
    ).toBe(true);

    const request: EnqueueRequest = enqueue.mock.calls[0]![0];
    expect(request).toMatchObject({
      subjectAlertId: ALERT_ID,
      ruleWaitMinutes: 5,
    });
    expect(await request.admitInsideSubjectLock!()).toBe(true);
    expect(
      (AIRunService.countBy as unknown as jest.Mock).mock.calls[0]![0],
    ).toMatchObject({ query: { triggeredByAlertId: ALERT_ID } });
  });

  test("what stops it after the wait is recorded as decided then", async () => {
    gate.mockResolvedValue({
      investigate: false,
      notStartedCode: "severity_below_threshold",
      notStartedDetails: { severityName: "Low", minimumSeverityName: "High" },
      reason: "below the floor",
    });

    await AIAlertInvestigationRunner.investigateNewAlert({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
      afterWaitMinutes: 20,
    });

    expect(recordSkipped).toHaveBeenCalledWith(
      { alertId: ALERT_ID, projectId: PROJECT_ID },
      "severity_below_threshold",
      undefined,
      { severityName: "Low", minimumSeverityName: "High", waitMinutes: 20 },
    );
  });

  test("a rule with no wait queues it at once, unstamped", async () => {
    await AIAlertInvestigationRunner.investigateNewAlert({
      alertId: ALERT_ID,
      projectId: PROJECT_ID,
    });

    expect(startWaiting).not.toHaveBeenCalled();
    expect(enqueue.mock.calls[0]![0].ruleWaitMinutes).toBeUndefined();
  });
});

describe("a waited run and auto remediation", () => {
  let executeRun: jest.SpyInstance;
  let onSettledCheck: jest.SpyInstance;

  function sentRequest(): InvestigationRequest {
    return (executeRun.mock.calls[0]![0] as { request: InvestigationRequest })
      .request;
  }

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(new Project(PROJECT_ID));
    executeRun = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([]);
    jest
      .spyOn(ResourceAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([]);
    jest
      .spyOn(LinkedInfrastructureContext, "readForIncident")
      .mockResolvedValue(null as never);
    jest
      .spyOn(LinkedInfrastructureContext, "readForAlert")
      .mockResolvedValue(null as never);
    jest.spyOn(RecentChangesContext, "read").mockResolvedValue(null);
    jest
      .spyOn(AIMemory, "getPriorSimilarIncidentsContext")
      .mockResolvedValue("");
    onSettledCheck = jest
      .spyOn(IncidentFollowUpCheck, "onInvestigationSettled")
      .mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    handoff.mockClear();
  });

  async function investigateIncident(ruleWaitMinutes?: number): Promise<void> {
    jest
      .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
      .mockResolvedValue({
        incident: Object.assign(new Incident(INCIDENT_ID), {
          title: "Checkout is down",
        }),
        stateTimeline: [],
        internalNotes: [],
        publicNotes: [],
        workspaceMessages: [],
      } as unknown as IncidentContextData);

    await AIIncidentInvestigationRunner.executeInvestigation({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      attemptCount: 1,
      ...(ruleWaitMinutes ? { ruleWaitMinutes } : {}),
    });
  }

  test("an incident's waited run, settled, releases no remediation, and still asks whether an alert opened while it read", async () => {
    await investigateIncident(10);
    await sentRequest().onSettled!();

    expect(handoff).not.toHaveBeenCalled();
    expect(onSettledCheck).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      aiRunId: RUN_ID,
    });
  });

  test("an incident's run that did not wait, settled, releases remediation as before", async () => {
    await investigateIncident();
    await sentRequest().onSettled!();

    expect(handoff).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });
  });

  test("a waited run whose context fails for good releases no remediation", async () => {
    jest
      .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
      .mockRejectedValue(new Error("Database not connected"));
    jest
      .spyOn(AIInvestigationQueue, "failOrRequeue")
      .mockResolvedValue("finalized");

    await AIIncidentInvestigationRunner.executeInvestigation({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      attemptCount: MAX_INVESTIGATION_ATTEMPTS,
      ruleWaitMinutes: 10,
    });

    expect(handoff).not.toHaveBeenCalled();
    expect(executeRun).not.toHaveBeenCalled();
  });

  test("an alert's waited run, settled or failed for good, releases no remediation", async () => {
    jest.spyOn(AlertAIContextBuilder, "buildAlertContext").mockResolvedValue({
      alert: Object.assign(new Alert(ALERT_ID), { title: "CPU high" }),
      stateTimeline: [],
      internalNotes: [],
    } as unknown as AlertContextData);

    await AIAlertInvestigationRunner.executeInvestigation({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      attemptCount: 1,
      ruleWaitMinutes: 5,
    });
    await sentRequest().onSettled!();
    expect(handoff).not.toHaveBeenCalled();

    jest
      .spyOn(AlertAIContextBuilder, "buildAlertContext")
      .mockRejectedValue(new Error("Database not connected"));
    jest
      .spyOn(AIInvestigationQueue, "failOrRequeue")
      .mockResolvedValue("finalized");

    await AIAlertInvestigationRunner.executeInvestigation({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      attemptCount: MAX_INVESTIGATION_ATTEMPTS,
      ruleWaitMinutes: 5,
    });
    expect(handoff).not.toHaveBeenCalled();
  });

  test("an alert's run that did not wait still releases remediation when it settles", async () => {
    jest.spyOn(AlertAIContextBuilder, "buildAlertContext").mockResolvedValue({
      alert: Object.assign(new Alert(ALERT_ID), { title: "CPU high" }),
      stateTimeline: [],
      internalNotes: [],
    } as unknown as AlertContextData);

    await AIAlertInvestigationRunner.executeInvestigation({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      attemptCount: 1,
    });
    await sentRequest().onSettled!();

    expect(handoff).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
    });
  });
});

describe("the queue and a waited run", () => {
  beforeEach(() => {
    jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockResolvedValue({
      exhausted: false,
      limitInTokens: null,
      usedTokensToday: 0,
    });
    jest
      .spyOn(AIService, "getReachedProjectDailyLimit")
      .mockResolvedValue(null as never);
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue();
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(new Project(PROJECT_ID));
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    handoff.mockClear();
  });

  test("enqueue stamps the wait on the run and carries it to the inline kick", async () => {
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: RUN_ID } as unknown as AIRun);
    const processRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationQueue, "processRun")
      .mockResolvedValue(undefined);

    await AIInvestigationQueue.enqueue({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
      ruleWaitMinutes: 10,
    });

    expect(
      (create.mock.calls[0]![0] as { data: AIRun }).data.ruleWaitMinutes,
    ).toBe(10);
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 0);
    });
    expect(processRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: RUN_ID, ruleWaitMinutes: 10 }),
    );
  });

  test("a run with no wait (or a 0 one) is created unstamped, as it always was", async () => {
    const create: jest.SpyInstance = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue({ id: RUN_ID } as unknown as AIRun);
    jest.spyOn(AIInvestigationQueue, "processRun").mockResolvedValue(undefined);

    await AIInvestigationQueue.enqueue({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
    });
    await AIInvestigationQueue.enqueue({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
      ruleWaitMinutes: 0,
    });

    for (const call of create.mock.calls) {
      expect((call[0] as { data: AIRun }).data.ruleWaitMinutes).toBeUndefined();
    }
  });

  test.each([
    ["incident", { triggeredByIncidentId: INCIDENT_ID }],
    ["alert", { triggeredByAlertId: ALERT_ID }],
  ])(
    "the poller reads the wait with the run and carries it to the %s runner",
    async (kind: string, subject: Record<string, ObjectID>) => {
      jest
        .spyOn(AIRunService, "findBy")
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: RUN_ID,
            projectId: PROJECT_ID,
            attemptCount: 0,
            runType: AIRunType.Investigation,
            ruleWaitMinutes: 30,
            ...subject,
          } as unknown as AIRun,
        ]);
      jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
      const execute: jest.SpyInstance =
        kind === "incident"
          ? jest
              .spyOn(AIIncidentInvestigationRunner, "executeInvestigation")
              .mockResolvedValue(undefined)
          : jest
              .spyOn(AIAlertInvestigationRunner, "executeInvestigation")
              .mockResolvedValue(undefined);

      await AIInvestigationQueue.processQueuedRuns();
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });

      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ aiRunId: RUN_ID, ruleWaitMinutes: 30 }),
      );
      for (const call of (AIRunService.findBy as unknown as jest.Mock).mock
        .calls) {
        expect(
          (call[0] as { select: Record<string, boolean> }).select[
            "ruleWaitMinutes"
          ],
        ).toBe(true);
      }
    },
  );

  test("a waited run that expires in the queue is cancelled and releases no remediation", async () => {
    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValueOnce([
        {
          id: ObjectID.generate(),
          projectId: PROJECT_ID,
          runType: AIRunType.Investigation,
          triggeredByIncidentId: INCIDENT_ID,
          ruleWaitMinutes: 10,
        } as unknown as AIRun,
      ])
      .mockResolvedValueOnce([]);
    const transition: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await AIInvestigationQueue.processQueuedRuns();

    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ status: AIRunStatus.Cancelled }),
      }),
    );
    expect(handoff).not.toHaveBeenCalled();
  });

  test("a waited run that goes stale for good releases no remediation; one that did not wait still does", async () => {
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);

    expect(
      await AIInvestigationQueue.requeueOrMarkStale({
        id: ObjectID.generate(),
        attemptCount: MAX_INVESTIGATION_ATTEMPTS,
        runType: AIRunType.Investigation,
        projectId: PROJECT_ID,
        triggeredByAlertId: ALERT_ID,
        ruleWaitMinutes: 5,
      }),
    ).toBe("stale");
    expect(handoff).not.toHaveBeenCalled();

    await AIInvestigationQueue.requeueOrMarkStale({
      id: ObjectID.generate(),
      attemptCount: MAX_INVESTIGATION_ATTEMPTS,
      runType: AIRunType.Investigation,
      projectId: PROJECT_ID,
      triggeredByAlertId: ALERT_ID,
    });
    expect(handoff).toHaveBeenCalledTimes(1);
  });
});

/*
 * The create hook's half: a record whose investigation waits is one whose
 * investigation was not queued, so auto remediation runs at once. The hooks
 * pass the runners' answer straight through (CreatedClosedNoAutomations and
 * the services' own suites pin that); here the answer itself.
 */
describe("what auto remediation is told when an incident waits", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a waiting incident is reported as not queued", async () => {
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null as InvestigationNotStartedCode | null);
    jest
      .spyOn(AIIncidentInvestigationRunner, "shouldInvestigateIncident")
      .mockResolvedValue(
        incidentGate({ waitMinutes: 30, createdAt: minutesAgo(0) }),
      );
    jest.spyOn(InvestigationRuleWait, "startWaiting").mockResolvedValue(true);
    const enqueue: jest.SpyInstance = jest.spyOn(
      AIInvestigationQueue,
      "enqueue",
    );

    const isQueued: boolean =
      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      });

    expect(isQueued).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
