import AutoRemediationRuleEngineService, {
  MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR,
  MAX_SUGGESTIONS_PER_SUBJECT,
} from "../../../Server/Services/AutoRemediationRuleEngineService";
import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import MonitorService from "../../../Server/Services/MonitorService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import AIInvestigationQueue from "../../../Server/Utils/AI/SRE/InvestigationQueue";
import Alert from "../../../Models/DatabaseModels/Alert";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../Models/DatabaseModels/Incident";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the auto-remediation rule engine that runs as the
 * sixth step of IncidentService/AlertService.onCreateSuccess:
 *
 * - matching semantics (monitors / severities / labels / monitor labels /
 *   regex; skip-if-empty, AND across criteria; invalid regex never matches
 *   and never throws);
 * - the guardrails: project kill switch, per-subject suggestion cap,
 *   per-rule dedupe, the FullAuto hourly circuit breaker, and the
 *   AI-picks-runbook-is-never-FullAuto invariant;
 * - the engine-never-throws-out-of-onCreateSuccess contract.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const ALERT_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const RUNBOOK_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const LABEL_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const SEVERITY_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const AI_RUN_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

type FakeRef = { id: ObjectID };

function ref(id: ObjectID): FakeRef {
  return { id } as FakeRef;
}

function fakeRule(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    name: "Restart API pods",
    executionMode: AutoRemediationExecutionMode.Suggest,
    aiSelectsRunbook: false,
    runbooks: [{ id: RUNBOOK_ID, name: "Restart pods" }],
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
    incidentSeverityId: SEVERITY_ID,
    monitors: [ref(MONITOR_ID)],
    labels: [ref(LABEL_ID)],
    ...overrides,
  } as unknown as Incident;
}

function fakeAlert(overrides: Partial<Record<string, unknown>> = {}): Alert {
  return {
    id: ALERT_ID,
    _id: ALERT_ID.toString(),
    projectId: PROJECT_ID,
    title: "CPU is high",
    description: "cpu > 95%",
    alertSeverityId: SEVERITY_ID,
    monitorId: MONITOR_ID,
    labels: [ref(LABEL_ID)],
    ...overrides,
  } as unknown as Alert;
}

function mockProject(overrides: Partial<Record<string, unknown>> = {}): void {
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
    enableAutoRemediation: true,
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

describe("AutoRemediationRuleEngineService", () => {
  beforeEach(() => {
    mockProject();
    mockExistingSuggestions([]);
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

  describe("deterministic Suggest rules", () => {
    it("creates a Suggested suggestion when every criterion matches", async () => {
      mockRules([
        fakeRule({
          monitors: [ref(MONITOR_ID)],
          incidentSeverities: [ref(SEVERITY_ID)],
          labels: [ref(LABEL_ID)],
          titlePattern: "error rate",
        }),
      ]);
      const create: jest.SpyInstance = mockSuggestionCreate();

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.Suggested,
            runbookId: RUNBOOK_ID,
            incidentId: INCIDENT_ID,
            executionMode: AutoRemediationExecutionMode.Suggest,
          }),
          props: expect.objectContaining({ isRoot: true }),
        }),
      );
    });

    it("does not suggest when the severity does not match", async () => {
      mockRules([
        fakeRule({
          incidentSeverities: [ref(new ObjectID(RULE_ID.toString()))],
        }),
      ]);
      const create: jest.SpyInstance = mockSuggestionCreate();

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(create).not.toHaveBeenCalled();
    });

    it("matches monitor labels through the monitor's own labels", async () => {
      mockRules([fakeRule({ monitorLabels: [ref(LABEL_ID)] })]);
      jest.spyOn(MonitorService, "findOneById").mockResolvedValue({
        id: MONITOR_ID,
        labels: [ref(LABEL_ID)],
      } as unknown as Monitor);
      const create: jest.SpyInstance = mockSuggestionCreate();

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(create).toHaveBeenCalledTimes(1);
    });

    it("does not match monitor labels the monitor lacks", async () => {
      mockRules([fakeRule({ monitorLabels: [ref(LABEL_ID)] })]);
      jest.spyOn(MonitorService, "findOneById").mockResolvedValue({
        id: MONITOR_ID,
        labels: [],
      } as unknown as Monitor);
      const create: jest.SpyInstance = mockSuggestionCreate();

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(create).not.toHaveBeenCalled();
    });

    it("never matches — and never throws on — an invalid regex pattern", async () => {
      mockRules([fakeRule({ titlePattern: "*error*" })]);
      const create: jest.SpyInstance = mockSuggestionCreate();

      await expect(
        AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident()),
      ).resolves.toBeUndefined();

      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("FullAuto rules", () => {
    it("starts the runbook and records an AutoExecuted suggestion", async () => {
      mockRules([
        fakeRule({ executionMode: AutoRemediationExecutionMode.FullAuto }),
      ]);
      const start: jest.SpyInstance = jest
        .spyOn(RunbookRuleEngineService, "startRunbookFor")
        .mockResolvedValue({
          id: new ObjectID("99999999-9999-4999-8999-999999999999"),
          _id: "99999999-9999-4999-8999-999999999999",
        } as unknown as RunbookExecution);
      const create: jest.SpyInstance = mockSuggestionCreate();

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          runbookId: RUNBOOK_ID,
          linkage: expect.objectContaining({ incidentId: INCIDENT_ID }),
        }),
      );
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            executionMode: AutoRemediationExecutionMode.FullAuto,
          }),
        }),
      );
    });

    it("downgrades to Suggest when the hourly circuit breaker trips", async () => {
      mockRules([
        fakeRule({ executionMode: AutoRemediationExecutionMode.FullAuto }),
      ]);
      jest
        .spyOn(AutoRemediationSuggestionService, "countBy")
        .mockResolvedValue(
          new PositiveNumber(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR),
        );
      const start: jest.SpyInstance = jest
        .spyOn(RunbookRuleEngineService, "startRunbookFor")
        .mockResolvedValue(null);
      const create: jest.SpyInstance = mockSuggestionCreate();

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(start).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.Suggested,
          }),
        }),
      );
    });
  });

  describe("AI rules", () => {
    beforeEach(() => {
      jest
        .spyOn(LlmProviderService, "getLLMProviderForProject")
        .mockResolvedValue({
          id: ObjectID.generate(),
        } as unknown as LlmProvider);
    });

    it("creates a Planning suggestion and enqueues a RemediationPlan run — never FullAuto", async () => {
      mockRules([
        fakeRule({
          aiSelectsRunbook: true,
          // Even a FullAuto AI rule must stay suggest-only.
          executionMode: AutoRemediationExecutionMode.FullAuto,
        }),
      ]);
      const enqueue: jest.SpyInstance = jest
        .spyOn(AIInvestigationQueue, "enqueue")
        .mockResolvedValue(AI_RUN_ID);
      const start: jest.SpyInstance = jest
        .spyOn(RunbookRuleEngineService, "startRunbookFor")
        .mockResolvedValue(null);
      const create: jest.SpyInstance = mockSuggestionCreate();

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(start).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.Planning,
            executionMode: AutoRemediationExecutionMode.Suggest,
          }),
        }),
      );
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          subjectIncidentId: INCIDENT_ID,
          subjectAutoRemediationSuggestionId: SUGGESTION_ID,
        }),
      );
    });

    it("settles the suggestion as NoneApplicable when the enqueue is budget-skipped", async () => {
      mockRules([fakeRule({ aiSelectsRunbook: true })]);
      jest.spyOn(AIInvestigationQueue, "enqueue").mockResolvedValue(null);
      mockSuggestionCreate();
      const update: jest.SpyInstance = jest
        .spyOn(AutoRemediationSuggestionService, "updateOneById")
        .mockResolvedValue(undefined as never);

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: SUGGESTION_ID,
          data: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.NoneApplicable,
          }),
          props: expect.objectContaining({ isRoot: true }),
        }),
      );
    });

    it("skips AI rules when the project has AI disabled", async () => {
      mockProject({ enableAi: false });
      mockRules([fakeRule({ aiSelectsRunbook: true })]);
      const create: jest.SpyInstance = mockSuggestionCreate();

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("guardrails", () => {
    it("does nothing when the project kill switch is off", async () => {
      mockProject({ enableAutoRemediation: false });
      const findRules: jest.SpyInstance = jest
        .spyOn(AutoRemediationRuleService, "findBy")
        .mockResolvedValue([]);

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(findRules).not.toHaveBeenCalled();
    });

    it("stops at the per-subject suggestion cap", async () => {
      mockRules([fakeRule()]);
      mockExistingSuggestions(
        Array.from({ length: MAX_SUGGESTIONS_PER_SUBJECT }, () => {
          return {
            id: ObjectID.generate(),
            autoRemediationRuleId: ObjectID.generate(),
          } as unknown as AutoRemediationSuggestion;
        }),
      );
      const create: jest.SpyInstance = mockSuggestionCreate();

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(create).not.toHaveBeenCalled();
    });

    it("never re-proposes for a rule that already produced a suggestion", async () => {
      mockRules([fakeRule()]);
      mockExistingSuggestions([
        {
          id: SUGGESTION_ID,
          autoRemediationRuleId: RULE_ID,
        } as unknown as AutoRemediationSuggestion,
      ]);
      const create: jest.SpyInstance = mockSuggestionCreate();

      await AutoRemediationRuleEngineService.applyRulesToIncident(
        fakeIncident(),
      );

      expect(create).not.toHaveBeenCalled();
    });

    it("never throws out of onCreateSuccess even when the rule query fails", async () => {
      jest
        .spyOn(AutoRemediationRuleService, "findBy")
        .mockRejectedValue(new Error("db down"));

      await expect(
        AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident()),
      ).resolves.toBeUndefined();
    });
  });

  describe("alert matching", () => {
    it("matches an alert through its scalar monitorId", async () => {
      mockRules([fakeRule({ monitors: [ref(MONITOR_ID)] })]);
      const create: jest.SpyInstance = mockSuggestionCreate();

      await AutoRemediationRuleEngineService.applyRulesToAlert(fakeAlert());

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.Suggested,
            alertId: ALERT_ID,
          }),
        }),
      );
    });

    it("does not match an alert from a different monitor", async () => {
      mockRules([
        fakeRule({ monitors: [ref(new ObjectID(LABEL_ID.toString()))] }),
      ]);
      const create: jest.SpyInstance = mockSuggestionCreate();

      await AutoRemediationRuleEngineService.applyRulesToAlert(fakeAlert());

      expect(create).not.toHaveBeenCalled();
    });

    it("matches alert severities against alertSeverityId", async () => {
      mockRules([fakeRule({ alertSeverities: [ref(SEVERITY_ID)] })]);
      const create: jest.SpyInstance = mockSuggestionCreate();

      await AutoRemediationRuleEngineService.applyRulesToAlert(fakeAlert());

      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  it("filters rules by trigger entity type in the query", async () => {
    const findRules: jest.SpyInstance = jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockResolvedValue([]);

    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());

    expect(findRules).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          triggerEntityType: AutoRemediationTriggerEntity.Incident,
          isEnabled: true,
        }),
      }),
    );
  });
});
