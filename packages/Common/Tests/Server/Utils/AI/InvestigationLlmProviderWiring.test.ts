import AIIncidentInvestigationRunner, {
  IncidentGateDecision,
} from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIAlertInvestigationRunner, {
  AlertGateDecision,
} from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import InvestigationEligibility from "../../../../Server/Utils/AI/SRE/InvestigationEligibility";
import InvestigationGrader from "../../../../Server/Utils/AI/SRE/InvestigationGrader";
import InvestigationRuleWait, {
  StartNowResult,
} from "../../../../Server/Utils/AI/SRE/InvestigationRuleWait";
import InvestigationRules from "../../../../Server/Utils/AI/SRE/InvestigationRules";
import PostedRootCause from "../../../../Server/Utils/AI/SRE/PostedRootCause";
import LlmProviderChoice from "../../../../Server/Utils/AI/LlmProviderChoice";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIService, { AILogRequest } from "../../../../Server/Services/AIService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import LlmLog from "../../../../Models/DatabaseModels/LlmLog";
import Project from "../../../../Models/DatabaseModels/Project";
import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import { LlmProviderSource } from "../../../../Types/AI/LlmProviderChoice";
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
 * EVERY INVESTIGATION OF AN INCIDENT OR ALERT USES THE LLM PROVIDER ITS
 * INVESTIGATION RULES PICK (Types/AI/LlmProviderChoice): the run the rules
 * start records the pick (AIInvestigationQueue.enqueue -> AIRun
 * .llmProviderId), as does one someone starts at once (Investigate now)
 * and one Ask AI starts; the grade on resolve uses the run's pick; and
 * the gate that asks whether AI can run at all asks about the provider the
 * run would use, so a rule's own provider runs what the project's cannot.
 */

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
const OPUS: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-ccccccccccc1");

type EnqueueRequest = Parameters<typeof AIInvestigationQueue.enqueue>[0];

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a new incident's investigation records the provider its rules pick", () => {
  let enqueue: SpyInstance<typeof AIInvestigationQueue.enqueue>;
  let gate: SpyInstance<
    typeof AIIncidentInvestigationRunner.shouldInvestigateIncident
  >;

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

  beforeEach(() => {
    enqueue = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(RUN_ID);
    gate = jest
      .spyOn(AIIncidentInvestigationRunner, "shouldInvestigateIncident")
      .mockResolvedValue(incidentGate());
    jest
      .spyOn(InvestigationEligibility, "recordSkipped")
      .mockResolvedValue(undefined);
  });

  test("the pick goes on the run", async () => {
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null);
    gate.mockResolvedValue(incidentGate({ llmProviderId: OPUS }));

    expect(
      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      }),
    ).toBe(true);

    const request: EnqueueRequest = enqueue.mock.calls[0]![0];
    expect(request.llmProviderId).toEqual(OPUS);
    expect(request.subjectIncidentId).toEqual(INCIDENT_ID);
  });

  test("no pick: the run is queued as it always was", async () => {
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null);

    await AIIncidentInvestigationRunner.investigateNewIncident({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
    });

    expect(enqueue.mock.calls[0]![0]).not.toHaveProperty("llmProviderId");
  });

  test("the project has no provider of its own, but the rules' pick can run it: it is queued", async () => {
    const disabled: SpyInstance<
      typeof AIInvestigationEngine.getDisabledReason
    > = jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValueOnce("provider_missing")
      .mockResolvedValueOnce(null);
    const subjectPick: SpyInstance<
      typeof InvestigationRules.getSubjectLlmProviderId
    > = jest
      .spyOn(InvestigationRules, "getSubjectLlmProviderId")
      .mockResolvedValue(OPUS);
    gate.mockResolvedValue(incidentGate({ llmProviderId: OPUS }));

    expect(
      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      }),
    ).toBe(true);
    expect(subjectPick).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });
    expect(disabled.mock.calls[1]).toEqual([
      PROJECT_ID,
      "Incident",
      { llmProviderId: OPUS },
    ]);
    expect(enqueue.mock.calls[0]![0].llmProviderId).toEqual(OPUS);
  });

  test("no provider anywhere, and no rule picks one: not queued, recorded as before", async () => {
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue("provider_missing");
    jest
      .spyOn(InvestigationRules, "getSubjectLlmProviderId")
      .mockResolvedValue(undefined);
    const recordSkipped: SpyInstance<
      typeof InvestigationEligibility.recordSkipped
    > = jest
      .spyOn(InvestigationEligibility, "recordSkipped")
      .mockResolvedValue(undefined);

    expect(
      await AIIncidentInvestigationRunner.investigateNewIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      }),
    ).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(recordSkipped.mock.calls[0]![1]).toBe("provider_missing");
  });

  test("AI switched off is the project's: the rules are not even read", async () => {
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue("ai_disabled");
    const subjectPick: SpyInstance<
      typeof InvestigationRules.getSubjectLlmProviderId
    > = jest.spyOn(InvestigationRules, "getSubjectLlmProviderId");

    await AIIncidentInvestigationRunner.investigateNewIncident({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
    });

    expect(subjectPick).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("a new alert's investigation records the provider its rules pick", () => {
  test("the pick goes on the run; and the project's missing provider is made up by it", async () => {
    const enqueue: SpyInstance<typeof AIInvestigationQueue.enqueue> = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(RUN_ID);
    const gateDecision: AlertGateDecision = {
      investigate: true,
      reason: "passed severity and dedupe gates",
      monitorId: MONITOR_ID,
      llmProviderId: OPUS,
    };
    jest
      .spyOn(AIAlertInvestigationRunner, "shouldInvestigateAlert")
      .mockResolvedValue(gateDecision);
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValueOnce("insufficient_ai_balance")
      .mockResolvedValueOnce(null);
    const subjectPick: SpyInstance<
      typeof InvestigationRules.getSubjectLlmProviderId
    > = jest
      .spyOn(InvestigationRules, "getSubjectLlmProviderId")
      .mockResolvedValue(OPUS);

    expect(
      await AIAlertInvestigationRunner.investigateNewAlert({
        alertId: ALERT_ID,
        projectId: PROJECT_ID,
      }),
    ).toBe(true);
    expect(subjectPick).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
    });
    expect(enqueue.mock.calls[0]![0]).toMatchObject({
      subjectAlertId: ALERT_ID,
      llmProviderId: OPUS,
    });
  });
});

describe("the gates carry the rules' pick", () => {
  test("an incident's gate carries the scope's pick", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(
      Object.assign(new Incident(), {
        monitors: [{ _id: MONITOR_ID.toString() }],
      }),
    );
    jest.spyOn(InvestigationRules, "getIncidentScope").mockResolvedValue({
      isInScope: true,
      rulesChecked: 1,
      llmProviderId: OPUS,
    });
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(new Project(PROJECT_ID));

    expect(
      await AIIncidentInvestigationRunner.shouldInvestigateIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      }),
    ).toMatchObject({ investigate: true, llmProviderId: OPUS });
  });

  test("a scope with no pick: the gate carries none", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(new Incident());
    jest
      .spyOn(InvestigationRules, "getIncidentScope")
      .mockResolvedValue({ isInScope: true, rulesChecked: 0 });
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(new Project(PROJECT_ID));

    expect(
      await AIIncidentInvestigationRunner.shouldInvestigateIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      }),
    ).not.toHaveProperty("llmProviderId");
  });

  test("an alert's gate carries the scope's pick", async () => {
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(Object.assign(new Alert(), { monitorId: MONITOR_ID }));
    jest.spyOn(InvestigationRules, "getAlertScope").mockResolvedValue({
      isInScope: true,
      rulesChecked: 1,
      llmProviderId: OPUS,
    });
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(new Project(PROJECT_ID));

    expect(
      await AIAlertInvestigationRunner.shouldInvestigateAlert({
        alertId: ALERT_ID,
        projectId: PROJECT_ID,
      }),
    ).toMatchObject({ investigate: true, llmProviderId: OPUS });
  });
});

describe("Investigate now on a waiting record uses the rules' pick", () => {
  function waitingIncident(): Incident {
    const createdAt: Date = new Date(Date.now() - 2 * 60 * 1000);

    return Object.assign(new Incident(), {
      _id: INCIDENT_ID.toString(),
      createdAt,
      aiInvestigationWaitUntil: new Date(createdAt.getTime() + 10 * 60 * 1000),
      monitors: [{ _id: MONITOR_ID.toString() }],
    });
  }

  beforeEach(() => {
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(waitingIncident());
    jest
      .spyOn(IncidentService, "compareAndSetColumnsByIdWithoutHooks")
      .mockResolvedValue(true);
    jest
      .spyOn(AIRunService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
  });

  test("the run it queues records the pick", async () => {
    jest
      .spyOn(InvestigationRules, "getSubjectLlmProviderId")
      .mockResolvedValue(OPUS);
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue(null);
    const enqueue: SpyInstance<typeof AIInvestigationQueue.enqueue> = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(RUN_ID);

    const result: StartNowResult = await InvestigationRuleWait.startNow({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });

    expect(result).toEqual({ isStarted: true, runId: RUN_ID });
    expect(enqueue.mock.calls[0]![0].llmProviderId).toEqual(OPUS);
  });

  test("the project's missing provider is made up by the pick", async () => {
    jest
      .spyOn(InvestigationRules, "getSubjectLlmProviderId")
      .mockResolvedValue(OPUS);
    const disabled: SpyInstance<
      typeof AIInvestigationEngine.getDisabledReason
    > = jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValueOnce("provider_missing")
      .mockResolvedValueOnce(null);
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
    expect(disabled.mock.calls[1]![2]).toEqual({ llmProviderId: OPUS });
  });

  test("no pick, and no provider: not started, saying why", async () => {
    jest
      .spyOn(InvestigationRules, "getSubjectLlmProviderId")
      .mockResolvedValue(undefined);
    jest
      .spyOn(AIInvestigationEngine, "getDisabledReason")
      .mockResolvedValue("provider_missing" as InvestigationNotStartedCode);
    const enqueue: SpyInstance<typeof AIInvestigationQueue.enqueue> =
      jest.spyOn(AIInvestigationQueue, "enqueue");

    const result: StartNowResult = await InvestigationRuleWait.startNow({
      lane: "Incident",
      projectId: PROJECT_ID,
      subjectId: INCIDENT_ID,
    });

    expect(result.isStarted).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("the queue records the pick on the run", () => {
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
      .spyOn(AIInvestigationQueue, "sendToWorkers")
      .mockResolvedValue(undefined);
  });

  test("a pick is written on the run", async () => {
    const create: SpyInstance<typeof AIRunService.create> = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue(
        Object.assign(new AIRun(), { _id: RUN_ID.toString() }),
      );

    await AIInvestigationQueue.enqueue({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
      llmProviderId: OPUS,
    });

    expect(
      (create.mock.calls[0]![0] as { data: AIRun }).data.llmProviderId,
    ).toEqual(OPUS);
  });

  test("no pick: the run has none", async () => {
    const create: SpyInstance<typeof AIRunService.create> = jest
      .spyOn(AIRunService, "create")
      .mockResolvedValue(
        Object.assign(new AIRun(), { _id: RUN_ID.toString() }),
      );

    await AIInvestigationQueue.enqueue({
      projectId: PROJECT_ID,
      subjectIncidentId: INCIDENT_ID,
    });

    expect(
      (create.mock.calls[0]![0] as { data: AIRun }).data.llmProviderId,
    ).toBeUndefined();
  });
});

describe("the grade on resolve uses the run's pick", () => {
  function completedRun(llmProviderId?: ObjectID): AIRun {
    return Object.assign(new AIRun(), {
      _id: RUN_ID.toString(),
      completedAt: new Date(),
      ...(llmProviderId ? { llmProviderId } : {}),
    });
  }

  let execute: SpyInstance<typeof AIService.executeWithLogging>;

  beforeEach(() => {
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
    jest
      .spyOn(AIService, "getReachedProjectDailyLimit")
      .mockResolvedValue(null as never);
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(
      Object.assign(new Incident(), {
        _id: INCIDENT_ID.toString(),
        rootCause: "A bad deploy of shop-api.",
      }),
    );
    jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue("**Summary** - a bad deploy.");
    jest.spyOn(AIRunService, "updateOneById").mockResolvedValue(undefined);
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1);
    execute = jest
      .spyOn(AIService, "executeWithLogging")
      .mockImplementation(async (request: AILogRequest) => {
        void request;
        return { content: "MATCH", llmLog: new LlmLog() };
      });
  });

  test("a run whose rule picked a provider is graded with it", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(completedRun(OPUS));
    const decide: SpyInstance<typeof LlmProviderChoice.decideIfPicked> = jest
      .spyOn(LlmProviderChoice, "decideIfPicked")
      .mockResolvedValue({
        provider: { id: OPUS.toString(), name: "Opus", isGlobal: false },
        source: LlmProviderSource.RulePick,
        fallbackReason: null,
        pickedProviderId: OPUS.toString(),
        llmProviderId: OPUS,
        activity: null,
      });

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
    });

    expect(decide).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      pickedProviderId: OPUS,
    });
    expect(execute.mock.calls[0]![0].llmProviderId).toEqual(OPUS);
  });

  test("the latest run is read with its pick", async () => {
    const find: SpyInstance<typeof AIRunService.findOneBy> = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(completedRun());

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
    });

    expect(find.mock.calls[0]![0].select).toMatchObject({
      llmProviderId: true,
    });
    expect(execute.mock.calls[0]![0].llmProviderId).toBeUndefined();
  });
});
