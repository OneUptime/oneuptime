import RemediationPlanRunner from "../../../../Server/Utils/AI/Remediation/RemediationPlanRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import { ConfidenceSignal } from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import { ObservabilityAssistantResult } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIRunService from "../../../../Server/Services/AIRunService";
import AutoRemediationRuleService from "../../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import RunbookService from "../../../../Server/Services/RunbookService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the RemediationPlan runner:
 *
 * - the mandatory trailing "SelectedRunbook: <id>" parse is last-match-wins,
 *   validates against the candidate set, and fails closed to none;
 * - the run rides the shared engine under the persisted budget label
 *   "AI Remediation Planning" (a rename would silently hand every project a
 *   fresh daily budget — the literal is pinned on purpose);
 * - retried attempts are idempotent (a suggestion no longer in Planning is
 *   never rewritten), and every settle path goes through the CAS.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const RUNBOOK_A_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNBOOK_B_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

function candidateIds(): Set<string> {
  return new Set<string>([RUNBOOK_A_ID.toString(), RUNBOOK_B_ID.toString()]);
}

function fakeSuggestion(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    status: AutoRemediationSuggestionStatus.Planning,
    incidentId: INCIDENT_ID,
    autoRemediationRuleId: RULE_ID,
    ruleNameSnapshot: "Restart API pods",
    ...overrides,
  } as unknown as AutoRemediationSuggestion;
}

function fakeRunbook(id: ObjectID, name: string): Runbook {
  return {
    id,
    _id: id.toString(),
    name,
    description: `${name} description`,
  } as unknown as Runbook;
}

function mockHappyPathLoads(): void {
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockResolvedValue(fakeSuggestion());
  jest.spyOn(AutoRemediationRuleService, "findOneById").mockResolvedValue({
    id: RULE_ID,
    runbooks: [{ id: RUNBOOK_A_ID }],
  } as unknown as AutoRemediationRule);
  jest
    .spyOn(RunbookService, "findBy")
    .mockResolvedValue([
      fakeRunbook(RUNBOOK_A_ID, "Restart pods"),
      fakeRunbook(RUNBOOK_B_ID, "Failover database"),
    ]);
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    id: INCIDENT_ID,
    title: "API error rate is high",
    description: "5xx spike",
    incidentNumber: 42,
  } as unknown as Incident);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
}

describe("RemediationPlanRunner.parseSelectedRunbook", () => {
  it("parses a valid trailing selection", () => {
    expect(
      RemediationPlanRunner.parseSelectedRunbook(
        `Some analysis.\nSelectedRunbook: ${RUNBOOK_A_ID.toString()}`,
        candidateIds(),
      ),
    ).toBe(RUNBOOK_A_ID.toString());
  });

  it("parses none as no selection", () => {
    expect(
      RemediationPlanRunner.parseSelectedRunbook(
        "Nothing applies here.\nSelectedRunbook: none",
        candidateIds(),
      ),
    ).toBeNull();
  });

  it("uses the LAST selection line when the model discusses earlier", () => {
    const markdown: string = [
      `SelectedRunbook: ${RUNBOOK_B_ID.toString()}`,
      "…on reflection, that runbook targets the wrong service.",
      `SelectedRunbook: ${RUNBOOK_A_ID.toString()}`,
    ].join("\n");
    expect(
      RemediationPlanRunner.parseSelectedRunbook(markdown, candidateIds()),
    ).toBe(RUNBOOK_A_ID.toString());
  });

  it("tolerates markdown bold around the label", () => {
    expect(
      RemediationPlanRunner.parseSelectedRunbook(
        `**SelectedRunbook:** ${RUNBOOK_A_ID.toString()}`,
        candidateIds(),
      ),
    ).toBe(RUNBOOK_A_ID.toString());
  });

  it("fails closed on an id outside the candidate set", () => {
    expect(
      RemediationPlanRunner.parseSelectedRunbook(
        `SelectedRunbook: ${SUGGESTION_ID.toString()}`,
        candidateIds(),
      ),
    ).toBeNull();
  });

  it("fails closed on unparseable output", () => {
    expect(
      RemediationPlanRunner.parseSelectedRunbook(
        "I think you should restart the pods.",
        candidateIds(),
      ),
    ).toBeNull();
    expect(
      RemediationPlanRunner.parseSelectedRunbook("", candidateIds()),
    ).toBeNull();
  });
});

describe("RemediationPlanRunner.executePlan", () => {
  beforeEach(() => {
    jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);
    jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("runs the engine under the pinned budget feature label and settles a Suggested pick", async () => {
    mockHappyPathLoads();
    const settle: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);

    const executeRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockImplementation(
        async (data: {
          aiRunId: ObjectID;
          projectId: ObjectID;
          attemptCount: number;
          request: InvestigationRequest;
        }): Promise<void> => {
          await data.request.postAnalysis({
            analysisMarkdown: `The pods are crash-looping.\nSelectedRunbook: ${RUNBOOK_A_ID.toString()}`,
            confidence: {
              confident: true,
              source: "classification",
            } as ConfidenceSignal,
            result: {} as ObservabilityAssistantResult,
          });
        },
      );

    await RemediationPlanRunner.executePlan({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      attemptCount: 1,
    });

    expect(executeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: RUN_ID,
        projectId: PROJECT_ID,
        request: expect.objectContaining({
          // Persisted budget-ledger string — pinned as a literal on purpose.
          feature: "AI Remediation Planning",
        }),
      }),
    );

    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestionId: SUGGESTION_ID,
        fromStatus: AutoRemediationSuggestionStatus.Planning,
        set: expect.objectContaining({
          status: AutoRemediationSuggestionStatus.Suggested,
          runbookId: RUNBOOK_A_ID.toString(),
          runbookNameSnapshot: "Restart pods",
        }),
      }),
    );
  });

  it("settles NoneApplicable when the model picks nothing", async () => {
    mockHappyPathLoads();
    const settle: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);

    jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockImplementation(
        async (data: {
          aiRunId: ObjectID;
          projectId: ObjectID;
          attemptCount: number;
          request: InvestigationRequest;
        }): Promise<void> => {
          await data.request.postAnalysis({
            analysisMarkdown: "Nothing here applies.\nSelectedRunbook: none",
            confidence: {
              confident: false,
              source: "classification",
            } as ConfidenceSignal,
            result: {} as ObservabilityAssistantResult,
          });
        },
      );

    await RemediationPlanRunner.executePlan({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      attemptCount: 1,
    });

    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: AutoRemediationSuggestionStatus.Planning,
        set: expect.objectContaining({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
        }),
      }),
    );
  });

  it("is idempotent on retry: a suggestion no longer Planning completes the run without writes", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(
        fakeSuggestion({
          status: AutoRemediationSuggestionStatus.Suggested,
        }),
      );
    const finalize: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);
    const executeRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined as never);

    await RemediationPlanRunner.executePlan({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      attemptCount: 2,
    });

    expect(executeRun).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: RUN_ID,
        fromStatus: AIRunStatus.Running,
        set: expect.objectContaining({ status: AIRunStatus.Completed }),
      }),
    );
  });

  it("finalizes the run as a permanent error on a cross-project suggestion", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(
        fakeSuggestion({
          projectId: new ObjectID("99999999-9999-4999-8999-999999999999"),
        }),
      );
    const finalize: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);
    const executeRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined as never);

    await RemediationPlanRunner.executePlan({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      attemptCount: 1,
    });

    expect(executeRun).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ status: AIRunStatus.Error }),
      }),
    );
  });

  it("settles NoneApplicable when the rule was deleted — never widens to the whole project", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(fakeSuggestion());
    jest
      .spyOn(AutoRemediationRuleService, "findOneById")
      .mockResolvedValue(null);
    const findRunbooks: jest.SpyInstance = jest
      .spyOn(RunbookService, "findBy")
      .mockResolvedValue([fakeRunbook(RUNBOOK_A_ID, "Restart pods")]);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    const settle: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);
    const executeRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined as never);

    await RemediationPlanRunner.executePlan({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      attemptCount: 1,
    });

    expect(executeRun).not.toHaveBeenCalled();
    expect(findRunbooks).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: AutoRemediationSuggestionStatus.Planning,
        set: expect.objectContaining({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
        }),
      }),
    );
  });

  it("settles NoneApplicable without an LLM call when no candidates exist", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(fakeSuggestion());
    jest.spyOn(AutoRemediationRuleService, "findOneById").mockResolvedValue({
      id: RULE_ID,
      runbooks: [],
    } as unknown as AutoRemediationRule);
    jest.spyOn(RunbookService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    const settle: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);
    const executeRun: jest.SpyInstance = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined as never);

    await RemediationPlanRunner.executePlan({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      attemptCount: 1,
    });

    expect(executeRun).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
        }),
      }),
    );
  });

  it("skips the feed item when the settle CAS loses the race", async () => {
    mockHappyPathLoads();
    jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(0 as never);
    const feed: jest.SpyInstance = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockImplementation(
        async (data: {
          aiRunId: ObjectID;
          projectId: ObjectID;
          attemptCount: number;
          request: InvestigationRequest;
        }): Promise<void> => {
          await data.request.postAnalysis({
            analysisMarkdown: `SelectedRunbook: ${RUNBOOK_A_ID.toString()}`,
            confidence: {
              confident: true,
              source: "classification",
            } as ConfidenceSignal,
            result: {} as ObservabilityAssistantResult,
          });
        },
      );

    await RemediationPlanRunner.executePlan({
      aiRunId: RUN_ID,
      projectId: PROJECT_ID,
      suggestionId: SUGGESTION_ID,
      attemptCount: 1,
    });

    expect(feed).not.toHaveBeenCalled();
  });
});

describe("RemediationPlanRunner.settleStrandedPlanningSuggestions", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockPlanningList(
    overrides: Partial<Record<string, unknown>> = {},
  ): void {
    jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([fakeSuggestion({ aiRunId: RUN_ID, ...overrides })]);
  }

  function mockRun(overrides: Partial<Record<string, unknown>>): void {
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue({
      id: RUN_ID,
      _id: RUN_ID.toString(),
      ...overrides,
    } as unknown as AIRun);
  }

  it("settles a suggestion whose plan run was TTL-cancelled", async () => {
    mockPlanningList();
    mockRun({ status: AIRunStatus.Cancelled });
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    const settle: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);

    await RemediationPlanRunner.settleStrandedPlanningSuggestions();

    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestionId: SUGGESTION_ID,
        fromStatus: AutoRemediationSuggestionStatus.Planning,
        set: expect.objectContaining({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
        }),
      }),
    );
  });

  it("leaves a suggestion alone while its plan run is still Running", async () => {
    mockPlanningList();
    mockRun({ status: AIRunStatus.Running });
    const settle: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);

    await RemediationPlanRunner.settleStrandedPlanningSuggestions();

    expect(settle).not.toHaveBeenCalled();
  });

  it("gives a Completed run a settle grace window before concluding it stranded", async () => {
    mockPlanningList();
    mockRun({
      status: AIRunStatus.Completed,
      completedAt: new Date(),
    });
    const settle: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);

    await RemediationPlanRunner.settleStrandedPlanningSuggestions();

    expect(settle).not.toHaveBeenCalled();
  });

  it("settles a suggestion whose Completed run never recorded a proposal (grace elapsed)", async () => {
    mockPlanningList();
    mockRun({
      status: AIRunStatus.Completed,
      completedAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    const settle: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);

    await RemediationPlanRunner.settleStrandedPlanningSuggestions();

    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("settles a suggestion that never got a plan run linked (grace elapsed)", async () => {
    mockPlanningList({
      aiRunId: undefined,
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
    });
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    const settle: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);

    await RemediationPlanRunner.settleStrandedPlanningSuggestions();

    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("posts no feed item when the settle CAS loses to a concurrent actor", async () => {
    mockPlanningList();
    mockRun({ status: AIRunStatus.Error });
    jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(0 as never);
    const feed: jest.SpyInstance = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);

    await RemediationPlanRunner.settleStrandedPlanningSuggestions();

    expect(feed).not.toHaveBeenCalled();
  });
});
