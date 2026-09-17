import AutoRemediationRuleEngineService, {
  DEFAULT_VERIFICATION_WINDOW_MINUTES,
  MAX_SUGGESTIONS_PER_SUBJECT,
} from "../../../Server/Services/AutoRemediationRuleEngineService";
import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import AIInvestigationQueue from "../../../Server/Utils/AI/SRE/InvestigationQueue";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../Models/DatabaseModels/Incident";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import AIRunType from "../../../Types/AI/AIRunType";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the aiComposesCommands branch of the
 * auto-remediation rule engine (AI-composed commands, Phase 3):
 *
 * - a matched command rule needs BOTH the AI gate (enableAi + an LLM
 *   provider) AND the strict project opt-in
 *   enableAiCommandExecution === true — anything else skips silently;
 * - the happy path creates a Planning CommandPlan suggestion that
 *   snapshots the rule's executionMode and verification window, enqueues a
 *   RemediationExecution run carrying the suggestion id, and links the
 *   created aiRunId back onto the suggestion;
 * - a budget-skipped enqueue (null) settles the suggestion as
 *   NoneApplicable instead of leaving it stuck in Planning;
 * - command composition wins over runbook selection when a rule carries
 *   both flags — exactly one run, and it is a RemediationExecution;
 * - the per-rule dedupe and the per-subject suggestion cap apply to
 *   command rules exactly as they do to every other rule kind.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const AI_RUN_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

function fakeCommandRule(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    name: "Restart the api service",
    executionMode: AutoRemediationExecutionMode.Suggest,
    aiSelectsRunbook: false,
    aiComposesCommands: true,
    runbooks: [],
    ...overrides,
  } as unknown as AutoRemediationRule;
}

function fakeIncident(
  overrides: Partial<Record<string, unknown>> = {},
): Incident {
  return {
    id: INCIDENT_ID,
    _id: INCIDENT_ID.toString(),
    projectId: PROJECT_ID,
    title: "API error rate is high",
    description: "5xx spike on the api service",
    ...overrides,
  } as unknown as Incident;
}

function mockProject(overrides: Partial<Record<string, unknown>> = {}): void {
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
    enableAutoRemediation: true,
    enableAiCommandExecution: true,
    ...overrides,
  } as unknown as Project);
}

function mockRules(rules: Array<AutoRemediationRule>): void {
  jest.spyOn(AutoRemediationRuleService, "findBy").mockResolvedValue(rules);
}

function mockExistingSuggestions(
  suggestions: Array<AutoRemediationSuggestion>,
): void {
  jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockResolvedValue(suggestions);
}

function mockSuggestionCreate(): jest.SpyInstance {
  return jest
    .spyOn(AutoRemediationSuggestionService, "create")
    .mockResolvedValue({
      id: SUGGESTION_ID,
      _id: SUGGESTION_ID.toString(),
    } as unknown as AutoRemediationSuggestion);
}

function mockLlmProviderConfigured(): void {
  jest.spyOn(LlmProviderService, "getLLMProviderForProject").mockResolvedValue({
    id: ObjectID.generate(),
  } as unknown as LlmProvider);
}

function mockEnqueue(aiRunId: ObjectID | null): jest.SpyInstance {
  return jest.spyOn(AIInvestigationQueue, "enqueue").mockResolvedValue(aiRunId);
}

describe("AutoRemediationRuleEngineService — aiComposesCommands rules", () => {
  beforeEach(() => {
    mockProject();
    mockExistingSuggestions([]);
    mockLlmProviderConfigured();
    jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("skips a matched command rule when the project has not opted in to AI command execution", async () => {
    mockProject({ enableAiCommandExecution: false });
    mockRules([fakeCommandRule()]);
    const create: jest.SpyInstance = mockSuggestionCreate();
    const enqueue: jest.SpyInstance = mockEnqueue(AI_RUN_ID);

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("skips a matched command rule when the opt-in column is absent (opt-in is === true, not truthy-default)", async () => {
    mockProject({ enableAiCommandExecution: undefined });
    mockRules([fakeCommandRule()]);
    const create: jest.SpyInstance = mockSuggestionCreate();

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(create).not.toHaveBeenCalled();
  });

  it("skips a matched command rule when no LLM provider is configured", async () => {
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(null);
    mockRules([fakeCommandRule()]);
    const create: jest.SpyInstance = mockSuggestionCreate();
    const enqueue: jest.SpyInstance = mockEnqueue(AI_RUN_ID);

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("creates a Planning CommandPlan suggestion, enqueues a RemediationExecution run and links the aiRunId back", async () => {
    mockRules([
      fakeCommandRule({
        executionMode: AutoRemediationExecutionMode.FullAuto,
        verificationWindowMinutes: 30,
      }),
    ]);
    const create: jest.SpyInstance = mockSuggestionCreate();
    const enqueue: jest.SpyInstance = mockEnqueue(AI_RUN_ID);
    const update: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AutoRemediationSuggestionStatus.Planning,
          suggestionType: AutoRemediationSuggestionType.CommandPlan,
          /*
           * Unlike aiSelectsRunbook (always Suggest), the command path
           * snapshots the rule's intent — the execution runner re-decides
           * Suggest vs FullAuto at run time.
           */
          executionMode: AutoRemediationExecutionMode.FullAuto,
          verificationWindowMinutes: 30,
          incidentId: INCIDENT_ID,
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        subjectIncidentId: INCIDENT_ID,
        subjectAutoRemediationSuggestionId: SUGGESTION_ID,
        remediationRunType: AIRunType.RemediationExecution,
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SUGGESTION_ID,
        data: expect.objectContaining({ aiRunId: AI_RUN_ID }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  it("falls back to the default verification window when the rule sets none", async () => {
    mockRules([fakeCommandRule()]);
    const create: jest.SpyInstance = mockSuggestionCreate();
    mockEnqueue(AI_RUN_ID);

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          executionMode: AutoRemediationExecutionMode.Suggest,
          verificationWindowMinutes: DEFAULT_VERIFICATION_WINDOW_MINUTES,
        }),
      }),
    );
  });

  it("settles the suggestion as NoneApplicable when the enqueue is budget-skipped", async () => {
    mockRules([fakeCommandRule()]);
    mockSuggestionCreate();
    mockEnqueue(null);
    const update: jest.SpyInstance = jest
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SUGGESTION_ID,
        data: expect.objectContaining({
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          rationaleMarkdown: expect.stringContaining("budget"),
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  it("prefers command composition over runbook selection when a rule has both flags", async () => {
    mockRules([fakeCommandRule({ aiSelectsRunbook: true })]);
    const create: jest.SpyInstance = mockSuggestionCreate();
    const enqueue: jest.SpyInstance = mockEnqueue(AI_RUN_ID);

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    // One rule, one run — and it is the command run, not the planning run.
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          suggestionType: AutoRemediationSuggestionType.CommandPlan,
        }),
      }),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        remediationRunType: AIRunType.RemediationExecution,
      }),
    );
  });

  it("never re-proposes for a command rule that already produced a suggestion", async () => {
    mockRules([fakeCommandRule()]);
    mockExistingSuggestions([
      {
        id: SUGGESTION_ID,
        autoRemediationRuleId: RULE_ID,
      } as unknown as AutoRemediationSuggestion,
    ]);
    const create: jest.SpyInstance = mockSuggestionCreate();
    const enqueue: jest.SpyInstance = mockEnqueue(AI_RUN_ID);

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("stops at the per-subject suggestion cap", async () => {
    mockRules([fakeCommandRule()]);
    mockExistingSuggestions(
      Array.from({ length: MAX_SUGGESTIONS_PER_SUBJECT }, () => {
        return {
          id: ObjectID.generate(),
          autoRemediationRuleId: ObjectID.generate(),
        } as unknown as AutoRemediationSuggestion;
      }),
    );
    const create: jest.SpyInstance = mockSuggestionCreate();
    const enqueue: jest.SpyInstance = mockEnqueue(AI_RUN_ID);

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
