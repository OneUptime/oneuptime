import InvestigationEligibility, {
  InvestigationSubject,
} from "../../../../Server/Utils/AI/SRE/InvestigationEligibility";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AIService, {
  AI_BALANCE_INSUFFICIENT_MESSAGE,
} from "../../../../Server/Services/AIService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import LlmLogService from "../../../../Server/Services/LlmLogService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import ObjectID from "../../../../Types/ObjectID";
import logger from "../../../../Server/Utils/Logger";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
} from "../../../../Types/AI/InvestigationNotStartedReason";

const projectId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const subjects: Array<InvestigationSubject> = [
  { projectId, alertId },
  { projectId, incidentId },
];
const codes: Array<InvestigationNotStartedCode> = [
  "ai_disabled",
  "automatic_investigation_disabled",
  "provider_missing",
  "insufficient_ai_balance",
  "project_daily_limit_reached",
  "severity_below_threshold",
  "monitor_cooldown",
  "created_resolved",
  "daily_budget_exhausted",
  "budget_check_failed",
  "enqueue_failed",
  "eligibility_check_failed",
  "no_run_recorded",
];
const configurationCodes: Array<InvestigationNotStartedCode> = [
  "ai_disabled",
  "automatic_investigation_disabled",
  "provider_missing",
  "insufficient_ai_balance",
  "severity_below_threshold",
];

const BALANCE_BLOCKER: string = AI_BALANCE_INSUFFICIENT_MESSAGE;

/*
 * AIService.getAiBalanceBlocker — the one AI balance predicate shared with
 * the Kubernetes cluster's ai_balance_insufficient gap. null = no blocker.
 */
function mockBalanceBlocker(
  outcome: string | null | Error = null,
): jest.SpyInstance {
  const spy: jest.SpyInstance = jest.spyOn(AIService, "getAiBalanceBlocker");
  if (outcome instanceof Error) {
    spy.mockRejectedValue(outcome);
  } else {
    spy.mockResolvedValue(outcome);
  }
  return spy;
}

afterEach(() => {
  jest.restoreAllMocks();
});

function enabledProject(): Project {
  const project: Project = new Project(projectId);
  project.enableAi = true;
  project.enableAutomaticAlertInvestigation = true;
  project.enableAutomaticIncidentInvestigation = true;
  return project;
}

function mockMissingDecision(): void {
  jest.spyOn(AlertService, "findOneBy").mockResolvedValue(new Alert(alertId));
  jest
    .spyOn(IncidentService, "findOneBy")
    .mockResolvedValue(new Incident(incidentId));
  jest
    .spyOn(AIInvestigationEngine, "getDisabledReason")
    .mockResolvedValue(null);
  jest
    .spyOn(AIAlertInvestigationRunner, "shouldInvestigateAlert")
    .mockResolvedValue({ investigate: true, reason: "eligible" });
  jest
    .spyOn(AIIncidentInvestigationRunner, "shouldInvestigateIncident")
    .mockResolvedValue({ investigate: true, reason: "eligible" });
  jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockResolvedValue({
    exhausted: false,
    limitInTokens: null,
    usedTokensToday: 0,
  });
}

async function trigger(subject: InvestigationSubject): Promise<boolean> {
  return subject.alertId
    ? AIAlertInvestigationRunner.investigateNewAlert({ projectId, alertId })
    : AIIncidentInvestigationRunner.investigateNewIncident({
        projectId,
        incidentId,
      });
}

describe("investigation enablement reasons", () => {
  it.each(["Alert", "Incident"] as const)(
    "explains project AI being disabled for %s",
    async (kind: "Alert" | "Incident") => {
      const project: Project = enabledProject();
      project.enableAi = false;
      jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);
      const provider: jest.SpyInstance = jest.spyOn(
        LlmProviderService,
        "getLLMProviderForProject",
      );
      expect(
        await AIInvestigationEngine.getDisabledReason(projectId, kind),
      ).toBe("ai_disabled");
      expect(
        await AIInvestigationEngine.isEnabledForProject(projectId, kind),
      ).toBe(false);
      expect(provider).not.toHaveBeenCalled();
    },
  );
  it.each(["Alert", "Incident"] as const)(
    "distinguishes the independent %s opt-in",
    async (kind: "Alert" | "Incident") => {
      const project: Project = enabledProject();
      if (kind === "Alert") {
        project.enableAutomaticAlertInvestigation = false;
      } else {
        project.enableAutomaticIncidentInvestigation = false;
      }
      jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);
      expect(
        await AIInvestigationEngine.getDisabledReason(projectId, kind),
      ).toBe("automatic_investigation_disabled");
    },
  );
  it("explains an unavailable provider without returning provider credentials", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(enabledProject());
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(null);
    expect(
      await AIInvestigationEngine.getDisabledReason(projectId, "Alert"),
    ).toBe("provider_missing");
  });
  it("preserves legacy unset project AI enablement with an available provider", async () => {
    const project: Project = enabledProject();
    delete project.enableAi;
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(new LlmProvider());
    mockBalanceBlocker(null);
    expect(
      await AIInvestigationEngine.getDisabledReason(projectId, "Incident"),
    ).toBeNull();
    expect(
      await AIInvestigationEngine.isEnabledForProject(projectId, "Incident"),
    ).toBe(true);
  });
  it("does not claim a missing project's AI setting is off", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null);
    expect(
      await AIInvestigationEngine.getDisabledReason(projectId, "Alert"),
    ).toBe("eligibility_check_failed");
  });
});

/*
 * On OneUptime's own billed provider, a project with no AI credits (and
 * auto-recharge off) has every model call refused with "Insufficient AI
 * balance". Starting an investigation then only produces a failed run that
 * is retried once, with nothing on the incident saying why — so the gate
 * refuses up front with a reason people can act on. It is the same
 * predicate as the cluster's ai_balance_insufficient gap, and it fails OPEN:
 * the model call still enforces the balance.
 */
describe("the AI balance gate (insufficient_ai_balance)", () => {
  function mockReadyProject(): jest.SpyInstance {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(enabledProject());
    return jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(new LlmProvider());
  }

  it.each(["Alert", "Incident"] as const)(
    "refuses a %s investigation when the project is out of AI credits",
    async (kind: "Alert" | "Incident") => {
      mockReadyProject();
      mockBalanceBlocker(BALANCE_BLOCKER);

      expect(
        await AIInvestigationEngine.getDisabledReason(projectId, kind),
      ).toBe("insufficient_ai_balance");
      expect(
        await AIInvestigationEngine.isEnabledForProject(projectId, kind),
      ).toBe(false);
    },
  );

  it("asks the shared predicate about this project, handing it the provider it already resolved", async () => {
    const llmProvider: LlmProvider = new LlmProvider();
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(enabledProject());
    const providerLookup: jest.SpyInstance = jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(llmProvider);
    const blocker: jest.SpyInstance = mockBalanceBlocker(null);

    await AIInvestigationEngine.getDisabledReason(projectId, "Incident");

    expect(blocker).toHaveBeenCalledTimes(1);
    expect(blocker).toHaveBeenCalledWith({ projectId, llmProvider });
    // One provider lookup for the whole gate, not one per check.
    expect(providerLookup).toHaveBeenCalledTimes(1);
  });

  it("lets the investigation start when there is no blocker", async () => {
    mockReadyProject();
    mockBalanceBlocker(null);

    expect(
      await AIInvestigationEngine.getDisabledReason(projectId, "Alert"),
    ).toBeNull();
  });

  it("an empty blocker string is not a blocker", async () => {
    mockReadyProject();
    mockBalanceBlocker("");

    expect(
      await AIInvestigationEngine.getDisabledReason(projectId, "Alert"),
    ).toBeNull();
  });

  it("fails OPEN when the balance cannot be read — logged, never blocking", async () => {
    mockReadyProject();
    mockBalanceBlocker(new Error("billing store unavailable"));
    const errorLog: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    expect(
      await AIInvestigationEngine.getDisabledReason(projectId, "Incident"),
    ).toBeNull();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("could not check the AI balance"),
    );
  });

  it.each([
    ["AI is off", { enableAi: false }, "ai_disabled"],
    [
      "automatic investigation is off",
      { enableAutomaticIncidentInvestigation: false },
      "automatic_investigation_disabled",
    ],
  ] as const)(
    "is not consulted when %s — the switch is the reason, not the balance",
    async (
      _label: string,
      overrides: Partial<Project>,
      expected: InvestigationNotStartedCode,
    ) => {
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(Object.assign(enabledProject(), overrides));
      const blocker: jest.SpyInstance = mockBalanceBlocker(BALANCE_BLOCKER);

      expect(
        await AIInvestigationEngine.getDisabledReason(projectId, "Incident"),
      ).toBe(expected);
      expect(blocker).not.toHaveBeenCalled();
    },
  );

  it("is not consulted without a provider — a missing provider is the reason", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(enabledProject());
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(null);
    const blocker: jest.SpyInstance = mockBalanceBlocker(BALANCE_BLOCKER);

    expect(
      await AIInvestigationEngine.getDisabledReason(projectId, "Alert"),
    ).toBe("provider_missing");
    expect(blocker).not.toHaveBeenCalled();
  });

  describe("getProviderOrBalanceReason — the half of the gate that is not a switch", () => {
    it("reports a missing provider first", async () => {
      jest
        .spyOn(LlmProviderService, "getLLMProviderForProject")
        .mockResolvedValue(null);
      const blocker: jest.SpyInstance = mockBalanceBlocker(BALANCE_BLOCKER);

      expect(
        await AIInvestigationEngine.getProviderOrBalanceReason(projectId),
      ).toBe("provider_missing");
      expect(blocker).not.toHaveBeenCalled();
    });

    it("reports an empty balance", async () => {
      jest
        .spyOn(LlmProviderService, "getLLMProviderForProject")
        .mockResolvedValue(new LlmProvider());
      mockBalanceBlocker(BALANCE_BLOCKER);

      expect(
        await AIInvestigationEngine.getProviderOrBalanceReason(projectId),
      ).toBe("insufficient_ai_balance");
    });

    it("reports nothing when a model can be called and paid for", async () => {
      jest
        .spyOn(LlmProviderService, "getLLMProviderForProject")
        .mockResolvedValue(new LlmProvider());
      mockBalanceBlocker(null);

      expect(
        await AIInvestigationEngine.getProviderOrBalanceReason(projectId),
      ).toBeNull();
    });

    it("never reads the project's switches — callers own those", async () => {
      jest
        .spyOn(LlmProviderService, "getLLMProviderForProject")
        .mockResolvedValue(new LlmProvider());
      mockBalanceBlocker(null);
      const projectRead: jest.SpyInstance = jest.spyOn(
        ProjectService,
        "findOneById",
      );

      await AIInvestigationEngine.getProviderOrBalanceReason(projectId);

      expect(projectRead).not.toHaveBeenCalled();
    });
  });

  it.each(subjects)(
    "explains the recorded reason in plain words for %o",
    (subject: InvestigationSubject) => {
      const reason: InvestigationNotStartedReason =
        InvestigationEligibility.reason("insufficient_ai_balance", subject);

      expect(reason.code).toBe("insufficient_ai_balance");
      expect(reason.title).toBe(
        "The project was out of AI credits at creation",
      );
      expect(reason.description).toBe(
        `This project had no AI credits left when this ${
          subject.alertId ? "alert" : "incident"
        } was created, so its automatic investigation did not start.`,
      );
      expect(reason.nextStep).toContain("Project Settings → AI Credits");
      /*
       * Not "turn on auto-recharge": AI credits are recharged after a call
       * they paid for, so a used-up balance stays used up until someone
       * adds credits. And no command: the card names who can, or links.
       */
      expect(reason.nextStep).not.toMatch(/auto-?recharge/i);
      expect(reason.nextStep).toBe(
        `Review AI credits under Project Settings → AI Credits. Adding credits later does not retry this ${subject.alertId ? "alert" : "incident"}.`,
      );
    },
  );

  it.each(subjects)(
    "explains the current condition, pointing at AI Credits, for %o",
    async (subject: InvestigationSubject) => {
      mockMissingDecision();
      jest
        .spyOn(AIInvestigationEngine, "getDisabledReason")
        .mockResolvedValue("insufficient_ai_balance");

      const reason: InvestigationNotStartedReason =
        await InvestigationEligibility.getNotStartedReason(subject);

      expect(reason.code).toBe("insufficient_ai_balance");
      expect(reason.source).toBe("current_configuration");
      expect(reason.title).toBe("The project is currently out of AI credits");
      expect(reason.nextStep).toBe(
        `New ${subject.alertId ? "alert" : "incident"}s can be investigated once AI credits are added under Project Settings → AI Credits. Existing records are not automatically retried.`,
      );
      expect(reason.nextStep).not.toMatch(/auto-?recharge/i);
      // The subject gate and the daily budget are never reached.
      expect(
        AIAlertInvestigationRunner.shouldInvestigateAlert,
      ).not.toHaveBeenCalled();
      expect(
        AIIncidentInvestigationRunner.shouldInvestigateIncident,
      ).not.toHaveBeenCalled();
      expect(AIService.getAutonomousDailyBudgetStatus).not.toHaveBeenCalled();
    },
  );
});

describe("the AI switches page is named where AI is off", () => {
  it.each(subjects)(
    "recorded and current ai_disabled next steps name Project Settings → AI Features for %o",
    async (subject: InvestigationSubject) => {
      const recorded: InvestigationNotStartedReason =
        InvestigationEligibility.reason("ai_disabled", subject);
      expect(recorded.nextStep).toContain("Project Settings → AI Features");
      expect(recorded.nextStep).not.toContain("AI Credits");

      mockMissingDecision();
      jest
        .spyOn(AIInvestigationEngine, "getDisabledReason")
        .mockResolvedValue("ai_disabled");
      const current: InvestigationNotStartedReason =
        await InvestigationEligibility.getNotStartedReason(subject);
      expect(current.nextStep).toContain("Project Settings → AI Features");
      expect(current.nextStep).not.toContain("AI Credits");
    },
  );
});

describe.each(subjects)(
  "recorded explanation time context for %o",
  (subject: InvestigationSubject) => {
    it.each(configurationCodes)(
      "describes %s as a condition at creation rather than a current setting",
      (code: InvestigationNotStartedCode) => {
        const reason: InvestigationNotStartedReason =
          InvestigationEligibility.reason(code, subject, undefined, {
            severityName: "High",
            minimumSeverityName: "Critical",
          });
        expect(reason.source).toBe("recorded");
        expect(reason.title).toMatch(/\bwas\b/);
        expect(reason.title).toContain("at creation");
        expect(reason.description).toContain(
          `this ${subject.alertId ? "alert" : "incident"} was created`,
        );
        expect(reason.title).not.toContain("currently");
        expect(reason.nextStep).toMatch(/^Review /);
      },
    );
    it.each([0, 1000])(
      "describes the %s-token budget as a historical admission decision",
      (limit: number) => {
        const reason: InvestigationNotStartedReason =
          InvestigationEligibility.reason("daily_budget_exhausted", subject, {
            exhausted: true,
            limitInTokens: limit,
            usedTokensToday: limit,
          });
        expect(reason.source).toBe("recorded");
        expect(reason.title).toMatch(/\b(was|had)\b/);
        expect(reason.description).toContain("when checked at creation");
        expect(reason.description).toContain("No investigation was queued");
        expect(reason.title).not.toContain("currently");
      },
    );
  },
);

describe.each(subjects)(
  "recorded decision persistence for %o",
  (subject: InvestigationSubject) => {
    it.each(codes)(
      "stores %s using a first-write-only, project-scoped update without hooks",
      async (code: InvestigationNotStartedCode) => {
        const updateAlert: jest.SpyInstance = jest
          .spyOn(AlertService, "updateColumnsByIdWithoutHooks")
          .mockResolvedValue(undefined);
        const updateIncident: jest.SpyInstance = jest
          .spyOn(IncidentService, "updateColumnsByIdWithoutHooks")
          .mockResolvedValue(undefined);
        await InvestigationEligibility.recordSkipped(subject, code);
        const update: jest.SpyInstance = subject.alertId
          ? updateAlert
          : updateIncident;
        expect(update).toHaveBeenCalledWith({
          id: subject.alertId || subject.incidentId,
          expectedData: { projectId, aiInvestigationDecision: null },
          data: {
            aiInvestigationDecision: expect.objectContaining({
              code,
              source: "recorded",
              title: expect.any(String),
              nextStep: expect.any(String),
              evaluatedAt: expect.any(String),
            }),
          },
          skipUpdateDateColumn: true,
        });
        expect(
          subject.alertId ? updateIncident : updateAlert,
        ).not.toHaveBeenCalled();
      },
    );
    it("does not propagate a failed decision write", async () => {
      jest
        .spyOn(AlertService, "updateColumnsByIdWithoutHooks")
        .mockRejectedValue(new Error("storage failed"));
      jest
        .spyOn(IncidentService, "updateColumnsByIdWithoutHooks")
        .mockRejectedValue(new Error("storage failed"));
      await expect(
        InvestigationEligibility.recordSkipped(subject, "provider_missing"),
      ).resolves.toBeUndefined();
    });
    it("retains the original reason even after configuration changes", async () => {
      const decision: InvestigationNotStartedReason = {
        ...InvestigationEligibility.reason(
          "automatic_investigation_disabled",
          subject,
        ),
        evaluatedAt: "2026-09-01T00:00:00.000Z",
      };
      const alert: Alert = new Alert(alertId);
      alert.aiInvestigationDecision = decision;
      const incident: Incident = new Incident(incidentId);
      incident.aiInvestigationDecision = decision;
      jest.spyOn(AlertService, "findOneBy").mockResolvedValue(alert);
      jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
      const current: jest.SpyInstance = jest
        .spyOn(AIInvestigationEngine, "getDisabledReason")
        .mockResolvedValue(null);
      const result: InvestigationNotStartedReason =
        await InvestigationEligibility.getNotStartedReason(subject);
      expect(result).toEqual(decision);
      expect(result.title).toBe(
        `Automatic ${subject.alertId ? "alert" : "incident"} investigation was off at creation`,
      );
      expect(result.description).toContain("was not enabled");
      expect(result.description).toContain("was created");
      expect(result.title).not.toContain("is turned off");
      expect(result.nextStep).toMatch(/^Review /);
      expect(current).not.toHaveBeenCalled();
      expect(
        subject.alertId ? AlertService.findOneBy : IncidentService.findOneBy,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            _id: (subject.alertId || subject.incidentId)!.toString(),
            projectId,
          },
        }),
      );
    });
  },
);

describe.each(subjects)(
  "historical no-run fallback for %o",
  (subject: InvestigationSubject) => {
    beforeEach(() => {
      mockMissingDecision();
    });
    it.each([
      "ai_disabled",
      "automatic_investigation_disabled",
      "provider_missing",
      "insufficient_ai_balance",
    ] as const)(
      "labels %s as current conditions, never historical proof",
      async (code: InvestigationNotStartedCode) => {
        jest
          .spyOn(AIInvestigationEngine, "getDisabledReason")
          .mockResolvedValue(code);
        const result: InvestigationNotStartedReason =
          await InvestigationEligibility.getNotStartedReason(subject);
        expect(result.code).toBe(code);
        expect(result.source).toBe("current_configuration");
        expect(result.title).toContain("currently");
        expect(result.description).toMatch(/\bis (not )?currently\b/);
        expect(result.description).not.toContain(
          "so its automatic investigation did not start",
        );
        expect(result.description).toContain(
          "do not confirm why this record was skipped at creation",
        );
        expect(AIService.getAutonomousDailyBudgetStatus).not.toHaveBeenCalled();
      },
    );
    it.each(["severity_below_threshold", "monitor_cooldown"] as const)(
      "uses the real subject gate's %s outcome",
      async (code: InvestigationNotStartedCode) => {
        jest
          .spyOn(AIAlertInvestigationRunner, "shouldInvestigateAlert")
          .mockResolvedValue({
            investigate: false,
            reason: "blocked",
            notStartedCode: code,
          });
        jest
          .spyOn(AIIncidentInvestigationRunner, "shouldInvestigateIncident")
          .mockResolvedValue({
            investigate: false,
            reason: "blocked",
            notStartedCode: code,
          });
        const result: InvestigationNotStartedReason =
          await InvestigationEligibility.getNotStartedReason(subject);
        expect(result.code).toBe(code);
        expect(result.source).toBe("current_configuration");
        expect(result.title).toContain("current");
        expect(result.description).toContain(
          "the original decision was not recorded",
        );
        if (code === "severity_below_threshold") {
          expect(result.description).toContain("severity does not meet");
          expect(result.description).not.toContain("severity did not meet");
        } else {
          expect(result.description).toContain("right now");
          expect(result.description).not.toContain(
            "did not start another investigation",
          );
        }
        expect(AIService.getAutonomousDailyBudgetStatus).not.toHaveBeenCalled();
      },
    );
    it.each([0, 1000])(
      "explains the current %s-token budget without claiming a historical skip",
      async (limit: number) => {
        jest
          .spyOn(AIService, "getAutonomousDailyBudgetStatus")
          .mockResolvedValue({
            exhausted: true,
            usedTokensToday: limit,
            limitInTokens: limit,
          });
        const result: InvestigationNotStartedReason =
          await InvestigationEligibility.getNotStartedReason(subject);
        expect(result.code).toBe("daily_budget_exhausted");
        expect(result.source).toBe("current_configuration");
        expect(result.title).toContain("currently");
        expect(result.description).toContain(limit.toLocaleString("en-US"));
        expect(result.description).toContain("has used");
        expect(result.description).toContain(
          "the original decision was not recorded",
        );
        expect(result.description).not.toContain("No investigation was queued");
        expect(result.nextStep).toContain("not automatically retried");
        expect(AIService.getAutonomousDailyBudgetStatus).toHaveBeenCalledWith(
          projectId,
          { incidentId: subject.incidentId, alertId: subject.alertId },
        );
      },
    );
    it("preserves severity names verbatim in both historical and current explanations", async () => {
      const details: {
        severityName: string;
        minimumSeverityName: string;
      } = {
        severityName: "High is available",
        minimumSeverityName: "Critical was not enabled",
      };
      const recorded: InvestigationNotStartedReason =
        InvestigationEligibility.reason(
          "severity_below_threshold",
          subject,
          undefined,
          details,
        );
      jest
        .spyOn(AIAlertInvestigationRunner, "shouldInvestigateAlert")
        .mockResolvedValue({
          investigate: false,
          reason: "below threshold",
          notStartedCode: "severity_below_threshold",
          notStartedDetails: details,
        });
      jest
        .spyOn(AIIncidentInvestigationRunner, "shouldInvestigateIncident")
        .mockResolvedValue({
          investigate: false,
          reason: "below threshold",
          notStartedCode: "severity_below_threshold",
          notStartedDetails: details,
        });
      const current: InvestigationNotStartedReason =
        await InvestigationEligibility.getNotStartedReason(subject);
      for (const reason of [recorded, current]) {
        expect(reason.description).toContain(details.severityName);
        expect(reason.description).toContain(details.minimumSeverityName);
      }
      expect(recorded.description).toContain("severity did not meet");
      expect(current.description).toContain("severity does not meet");
    });
    it("reports no historical reason when all current checks pass and performs no writes", async () => {
      const update: jest.SpyInstance = jest.spyOn(
        AlertService,
        "updateColumnsByIdWithoutHooks",
      );
      const incidentUpdate: jest.SpyInstance = jest.spyOn(
        IncidentService,
        "updateColumnsByIdWithoutHooks",
      );
      const enqueue: jest.SpyInstance = jest.spyOn(
        AIInvestigationQueue,
        "enqueue",
      );
      const result: InvestigationNotStartedReason =
        await InvestigationEligibility.getNotStartedReason(subject);
      expect(result.code).toBe("no_run_recorded");
      expect(result.source).toBe("unknown");
      expect(result.description).toContain("current");
      expect(result.nextStep).toContain("does not backfill");
      expect(update).not.toHaveBeenCalled();
      expect(incidentUpdate).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });
    it("returns a safe unknown explanation on an eligibility error", async () => {
      jest
        .spyOn(AIInvestigationEngine, "getDisabledReason")
        .mockRejectedValue(
          new Error("provider key secret-token host private.internal"),
        );
      const result: InvestigationNotStartedReason =
        await InvestigationEligibility.getNotStartedReason(subject);
      expect(result.source).toBe("unknown");
      expect(result.code).toBe("eligibility_check_failed");
      expect(JSON.stringify(result)).not.toMatch(
        /secret-token|private.internal/,
      );
    });
  },
);

describe.each(subjects)(
  "creation hook and queue decision integration for %o",
  (subject: InvestigationSubject) => {
    beforeEach(() => {
      mockMissingDecision();
      jest
        .spyOn(AlertService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);
      jest
        .spyOn(IncidentService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);
      jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
      jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
      jest
        .spyOn(AIRunService, "create")
        .mockResolvedValue(new AIRun(ObjectID.generate()));
      jest
        .spyOn(AIInvestigationQueue, "processRun")
        .mockResolvedValue(undefined);
    });
    function expectRecorded(code: InvestigationNotStartedCode): void {
      expect(
        subject.alertId
          ? AlertService.updateColumnsByIdWithoutHooks
          : IncidentService.updateColumnsByIdWithoutHooks,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            aiInvestigationDecision: expect.objectContaining({
              code,
              source: "recorded",
            }),
          },
        }),
      );
    }
    it.each([
      "ai_disabled",
      "automatic_investigation_disabled",
      "provider_missing",
      "insufficient_ai_balance",
    ] as const)(
      "records disabled admission %s",
      async (code: InvestigationNotStartedCode) => {
        jest
          .spyOn(AIInvestigationEngine, "getDisabledReason")
          .mockResolvedValue(code);
        expect(await trigger(subject)).toBe(false);
        expectRecorded(code);
        expect(AIRunService.create).not.toHaveBeenCalled();
      },
    );
    it.each(["severity_below_threshold", "monitor_cooldown"] as const)(
      "records subject gate %s without creating a fake run",
      async (code: InvestigationNotStartedCode) => {
        jest
          .spyOn(AIAlertInvestigationRunner, "shouldInvestigateAlert")
          .mockResolvedValue({
            investigate: false,
            reason: "blocked",
            notStartedCode: code,
          });
        jest
          .spyOn(AIIncidentInvestigationRunner, "shouldInvestigateIncident")
          .mockResolvedValue({
            investigate: false,
            reason: "blocked",
            notStartedCode: code,
          });
        expect(await trigger(subject)).toBe(false);
        expectRecorded(code);
        expect(AIRunService.create).not.toHaveBeenCalled();
      },
    );
    it.each([0, 1000])(
      "records an exhausted budget of %s and no run",
      async (limit: number) => {
        jest
          .spyOn(AIService, "getAutonomousDailyBudgetStatus")
          .mockResolvedValue({
            exhausted: true,
            usedTokensToday: limit,
            limitInTokens: limit,
          });
        expect(await trigger(subject)).toBe(false);
        expectRecorded("daily_budget_exhausted");
        expect(AIRunService.create).not.toHaveBeenCalled();
      },
    );
    it("records the budget-check error category without exposing its raw error", async () => {
      jest
        .spyOn(AIService, "getAutonomousDailyBudgetStatus")
        .mockRejectedValue(new Error("secret: budget storage offline"));
      expect(await trigger(subject)).toBe(false);
      expectRecorded("budget_check_failed");
      expect(AIRunService.create).not.toHaveBeenCalled();
      const update: jest.Mock = (
        subject.alertId
          ? AlertService.updateColumnsByIdWithoutHooks
          : IncidentService.updateColumnsByIdWithoutHooks
      ) as jest.Mock;
      expect(JSON.stringify(update.mock.calls)).not.toContain("secret");
    });
    it("records durable queue write failure", async () => {
      jest
        .spyOn(AIRunService, "create")
        .mockRejectedValue(new Error("insert failed"));
      expect(await trigger(subject)).toBe(false);
      expectRecorded("enqueue_failed");
      expect(AIInvestigationQueue.processRun).not.toHaveBeenCalled();
    });
    it("keeps the failed admission result even if diagnostic persistence fails", async () => {
      jest
        .spyOn(AlertService, "updateColumnsByIdWithoutHooks")
        .mockRejectedValue(new Error("storage failed"));
      jest
        .spyOn(IncidentService, "updateColumnsByIdWithoutHooks")
        .mockRejectedValue(new Error("storage failed"));
      jest
        .spyOn(AIRunService, "create")
        .mockRejectedValue(new Error("insert failed"));
      await expect(trigger(subject)).resolves.toBe(false);
      expectRecorded("enqueue_failed");
    });
    it("does not write a skip reason for successfully enqueued investigations", async () => {
      expect(await trigger(subject)).toBe(true);
      expect(AlertService.updateColumnsByIdWithoutHooks).not.toHaveBeenCalled();
      expect(
        IncidentService.updateColumnsByIdWithoutHooks,
      ).not.toHaveBeenCalled();
      expect(AIInvestigationQueue.processRun).toHaveBeenCalled();
    });
    it("records an empty AI balance through the real engine gate and never creates a run", async () => {
      (
        AIInvestigationEngine.getDisabledReason as unknown as jest.SpyInstance
      ).mockRestore();
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(enabledProject());
      jest
        .spyOn(LlmProviderService, "getLLMProviderForProject")
        .mockResolvedValue(new LlmProvider());
      mockBalanceBlocker(BALANCE_BLOCKER);

      expect(await trigger(subject)).toBe(false);
      expectRecorded("insufficient_ai_balance");
      expect(AIRunService.create).not.toHaveBeenCalled();
      expect(AIInvestigationQueue.processRun).not.toHaveBeenCalled();
    });
    it("still starts the investigation through the real engine gate when the balance cannot be read", async () => {
      (
        AIInvestigationEngine.getDisabledReason as unknown as jest.SpyInstance
      ).mockRestore();
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(enabledProject());
      jest
        .spyOn(LlmProviderService, "getLLMProviderForProject")
        .mockResolvedValue(new LlmProvider());
      mockBalanceBlocker(new Error("billing store unavailable"));
      jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });

      expect(await trigger(subject)).toBe(true);
      expect(AIRunService.create).toHaveBeenCalled();
    });
    it("records unexpected eligibility failures without stranding remediation", async () => {
      jest
        .spyOn(AIInvestigationEngine, "getDisabledReason")
        .mockRejectedValue(new Error("unexpected"));
      expect(await trigger(subject)).toBe(false);
      expectRecorded("eligibility_check_failed");
      expect(AIRunService.create).not.toHaveBeenCalled();
    });
  },
);

describe("investigation diagnostic boundaries", () => {
  it.each(subjects)(
    "survives an unavailable decision column during deployment for %o",
    async (subject: InvestigationSubject) => {
      jest
        .spyOn(AlertService, "findOneBy")
        .mockRejectedValue(
          new Error("column aiInvestigationDecision does not exist"),
        );
      jest
        .spyOn(IncidentService, "findOneBy")
        .mockRejectedValue(
          new Error("column aiInvestigationDecision does not exist"),
        );
      const result: InvestigationNotStartedReason =
        await InvestigationEligibility.getNotStartedReason(subject);
      expect(result.source).toBe("unknown");
      expect(result.code).toBe("eligibility_check_failed");
      expect(JSON.stringify(result)).not.toContain("column");
      expect(result.description).toContain("could not be loaded");
      expect(result.description).not.toContain("was not recorded");
    },
  );
  it.each([false, true])(
    "does not write a creation decision for non-automatic enqueue (remediation: %s)",
    async (remediation: boolean) => {
      jest
        .spyOn(AIService, "getAutonomousDailyBudgetStatus")
        .mockResolvedValue({
          exhausted: true,
          usedTokensToday: 0,
          limitInTokens: 0,
        });
      const alertUpdate: jest.SpyInstance = jest.spyOn(
        AlertService,
        "updateColumnsByIdWithoutHooks",
      );
      const incidentUpdate: jest.SpyInstance = jest.spyOn(
        IncidentService,
        "updateColumnsByIdWithoutHooks",
      );
      expect(
        await AIInvestigationQueue.enqueue({
          projectId,
          subjectAlertId: alertId,
          ...(remediation
            ? { subjectAutoRemediationSuggestionId: ObjectID.generate() }
            : {}),
        }),
      ).toBeNull();
      expect(alertUpdate).not.toHaveBeenCalled();
      expect(incidentUpdate).not.toHaveBeenCalled();
    },
  );
  it("retains actual severity names and the configured cooldown in the recorded explanation", () => {
    const severity: InvestigationNotStartedReason =
      InvestigationEligibility.reason(
        "severity_below_threshold",
        subjects[0]!,
        undefined,
        { severityName: "High", minimumSeverityName: "Critical" },
      );
    expect(severity.description).toContain("High");
    expect(severity.description).toContain("Critical");
    const cooldown: InvestigationNotStartedReason =
      InvestigationEligibility.reason(
        "monitor_cooldown",
        subjects[0]!,
        undefined,
        { cooldownWindowMinutes: 75 },
      );
    expect(cooldown.description).toContain("75-minute");
    expect(cooldown.title).not.toContain("covers");
  });
  /*
   * Alerts used to be investigated from the top two severity tiers only
   * unless a floor was set, and the explanation said so. There is no floor
   * by default now, so a severity skip only ever comes from a floor a
   * project set — the explanation must not claim a default.
   */
  it.each(subjects)(
    "explains a severity skip by the configured floor alone, never a default, for %o",
    (subject: InvestigationSubject) => {
      for (const source of [
        InvestigationEligibility.reason(
          "severity_below_threshold",
          subject,
          undefined,
          { severityName: "Low", minimumSeverityName: "High" },
        ),
        InvestigationEligibility.reason("severity_below_threshold", subject),
      ]) {
        expect(source.description).not.toMatch(/by default/i);
        expect(source.description).not.toMatch(/two highest/i);
        expect(source.description).not.toMatch(/top two/i);
      }
    },
  );
  it("does not let a failed caller diagnostic callback make enqueue throw", async () => {
    jest.spyOn(AIService, "getAutonomousDailyBudgetStatus").mockResolvedValue({
      exhausted: true,
      usedTokensToday: 0,
      limitInTokens: 0,
    });
    await expect(
      AIInvestigationQueue.enqueue({
        projectId,
        subjectAlertId: alertId,
        onNotEnqueued: async () => {
          throw new Error("diagnostics unavailable");
        },
      }),
    ).resolves.toBeNull();
  });
});

/*
 * An incident or alert created already resolved was over before it was
 * recorded: its create queues no investigation and records why
 * (created_resolved), so its AI card says so instead of "no investigation
 * was recorded". Only ever recorded at creation, never derived from the
 * current settings, and nothing in the settings would change it.
 */
describe("a record created already resolved (created_resolved)", () => {
  it.each([
    [{ projectId, incidentId }, "incident"],
    [{ projectId, alertId }, "alert"],
  ] as Array<[InvestigationSubject, string]>)(
    "says plainly why the %o was not investigated, and what to do instead",
    (subject: InvestigationSubject, kind: string) => {
      const reason: InvestigationNotStartedReason =
        InvestigationEligibility.reason("created_resolved", subject);

      expect(reason.code).toBe("created_resolved");
      expect(reason.source).toBe("recorded");
      expect(reason.title).toBe(`This ${kind} was created already resolved`);
      expect(reason.description).toBe(
        "It was already resolved when it was created, so OneUptime AI did not investigate it automatically.",
      );
      expect(reason.nextStep).toBe(
        "To look into it anyway, ask OneUptime AI below.",
      );
      // A recorded fact, not a reading of the current settings.
      expect(reason.description).not.toContain("current conditions");
      expect(Number.isFinite(Date.parse(reason.evaluatedAt))).toBe(true);
    },
  );

  it.each(subjects)(
    "is recorded once, without hooks, for %o",
    async (subject: InvestigationSubject) => {
      const updateAlert: jest.SpyInstance = jest
        .spyOn(AlertService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);
      const updateIncident: jest.SpyInstance = jest
        .spyOn(IncidentService, "updateColumnsByIdWithoutHooks")
        .mockResolvedValue(undefined);

      await InvestigationEligibility.recordSkipped(subject, "created_resolved");

      const update: jest.SpyInstance = subject.alertId
        ? updateAlert
        : updateIncident;

      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedData: { projectId, aiInvestigationDecision: null },
          data: {
            aiInvestigationDecision: expect.objectContaining({
              code: "created_resolved",
              source: "recorded",
            }),
          },
        }),
      );
    },
  );

  it.each(subjects)(
    "the recorded reason is what the card reads back for %o",
    async (subject: InvestigationSubject) => {
      const recorded: InvestigationNotStartedReason =
        InvestigationEligibility.reason("created_resolved", subject);

      jest
        .spyOn(AlertService, "findOneBy")
        .mockResolvedValue({ aiInvestigationDecision: recorded } as never);
      jest
        .spyOn(IncidentService, "findOneBy")
        .mockResolvedValue({ aiInvestigationDecision: recorded } as never);

      expect(await InvestigationEligibility.getNotStartedReason(subject)).toBe(
        recorded,
      );
    },
  );
});

/*
 * The project's own daily AI limits (Project Settings → AI Features → More
 * settings) are a ceiling over everything its AI does. Once one is reached
 * every model call is refused until midnight UTC, so an investigation
 * started then would only fail and be retried: the gate refuses up front,
 * with a reason that names where the limit is changed. It reads the limits
 * on the row it already reads (no second project read) and fails OPEN, like
 * the balance check: the model call itself still enforces the limits.
 */
describe("the project's own daily AI limits (project_daily_limit_reached)", () => {
  function projectWithLimit(limit: number | undefined): Project {
    const project: Project = enabledProject();

    if (limit !== undefined) {
      project.aiDailyTokenLimit = limit;
    }

    return project;
  }

  function mockUsage(usedTokensToday: number): jest.SpyInstance {
    return jest.spyOn(LlmLogService, "getProjectUsageSince").mockResolvedValue({
      totalTokens: usedTokensToday,
      billedCostInUSDCents: 0,
    });
  }

  beforeEach(() => {
    jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(new LlmProvider());
    mockBalanceBlocker(null);
  });

  it.each(["Alert", "Incident"] as const)(
    "refuses a %s investigation once the project's daily token limit is reached",
    async (kind: "Alert" | "Incident") => {
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(projectWithLimit(1000));
      mockUsage(1000);

      expect(
        await AIInvestigationEngine.getDisabledReason(projectId, kind),
      ).toBe("project_daily_limit_reached");
      expect(
        await AIInvestigationEngine.isEnabledForProject(projectId, kind),
      ).toBe(false);
    },
  );

  it("lets the investigation start while there is room", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithLimit(1000));
    mockUsage(999);

    expect(
      await AIInvestigationEngine.getDisabledReason(projectId, "Incident"),
    ).toBeNull();
  });

  it("with no limit set, counts nothing at all", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithLimit(undefined));
    const usage: jest.SpyInstance = mockUsage(999_999_999);

    expect(
      await AIInvestigationEngine.getDisabledReason(projectId, "Incident"),
    ).toBeNull();
    expect(usage).not.toHaveBeenCalled();
  });

  it("reads the limits on the row it already reads: one project read", async () => {
    const read: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithLimit(1000));
    mockUsage(10);

    await AIInvestigationEngine.getDisabledReason(projectId, "Alert");

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          aiDailyTokenLimit: true,
          aiDailySpendLimitInUSD: true,
        }),
      }),
    );
  });

  it("fails OPEN when the usage cannot be read: logged, never blocking", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithLimit(1000));
    jest
      .spyOn(LlmLogService, "getProjectUsageSince")
      .mockRejectedValue(new Error("database down"));
    const errorLog: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    expect(
      await AIInvestigationEngine.getDisabledReason(projectId, "Incident"),
    ).toBeNull();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("could not check the daily AI limits"),
    );
  });

  it.each([
    ["AI is off", { enableAi: false }, "ai_disabled"],
    [
      "automatic investigation is off",
      { enableAutomaticAlertInvestigation: false },
      "automatic_investigation_disabled",
    ],
  ] as const)(
    "is not what is said when %s - the switch is the reason",
    async (
      _label: string,
      overrides: Partial<Project>,
      expected: InvestigationNotStartedCode,
    ) => {
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(Object.assign(projectWithLimit(1), overrides));
      const usage: jest.SpyInstance = mockUsage(5);

      expect(
        await AIInvestigationEngine.getDisabledReason(projectId, "Alert"),
      ).toBe(expected);
      expect(usage).not.toHaveBeenCalled();
    },
  );

  it("an empty balance is said before the limit", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithLimit(1));
    mockBalanceBlocker(BALANCE_BLOCKER);
    const usage: jest.SpyInstance = mockUsage(5);

    expect(
      await AIInvestigationEngine.getDisabledReason(projectId, "Alert"),
    ).toBe("insufficient_ai_balance");
    expect(usage).not.toHaveBeenCalled();
  });

  it.each(subjects)(
    "explains the recorded skip, pointing at the project's daily limits, for %o",
    (subject: InvestigationSubject) => {
      const reason: InvestigationNotStartedReason =
        InvestigationEligibility.reason("project_daily_limit_reached", subject);

      expect(reason.code).toBe("project_daily_limit_reached");
      expect(reason.source).toBe("recorded");
      expect(reason.title).toBe(
        "The project's daily AI limit had been reached at creation",
      );
      expect(reason.description).toBe(
        `This project had reached one of its own daily AI limits when this ${
          subject.alertId ? "alert" : "incident"
        } was created, so its automatic investigation did not start.`,
      );
      // It is taken back after the reset (InvestigationLimitCatchUp).
      expect(reason.nextStep).toBe(
        `OneUptime AI investigates this ${
          subject.alertId ? "alert" : "incident"
        } after the limit resets at midnight UTC, if it is still open then, or as soon as the limit is raised or removed under Project Settings → AI Features → More settings.`,
      );
      expect(reason.nextStep).not.toContain("not automatically retried");
    },
  );

  it.each(subjects)(
    "explains the current condition, pointing at the project's daily limits, for %o",
    async (subject: InvestigationSubject) => {
      mockMissingDecision();
      jest
        .spyOn(AIInvestigationEngine, "getDisabledReason")
        .mockResolvedValue("project_daily_limit_reached");

      const reason: InvestigationNotStartedReason =
        await InvestigationEligibility.getNotStartedReason(subject);

      expect(reason.code).toBe("project_daily_limit_reached");
      expect(reason.source).toBe("current_configuration");
      expect(reason.title).toBe(
        "The project's daily AI limit is currently reached",
      );
      expect(reason.nextStep).toContain(
        "Project Settings → AI Features → More settings",
      );
      expect(reason.nextStep).toContain("midnight UTC");
      // The subject gate and the lane budget are never reached.
      expect(
        AIAlertInvestigationRunner.shouldInvestigateAlert,
      ).not.toHaveBeenCalled();
      expect(AIService.getAutonomousDailyBudgetStatus).not.toHaveBeenCalled();
    },
  );

  it.each(subjects)(
    "records the skip when a %o is created past the limit, and queues nothing",
    async (subject: InvestigationSubject) => {
      jest
        .spyOn(ProjectService, "findOneById")
        .mockResolvedValue(projectWithLimit(100));
      mockUsage(100);
      const create: jest.SpyInstance = jest.spyOn(AIRunService, "create");
      const recorded: jest.SpyInstance = jest
        .spyOn(InvestigationEligibility, "recordSkipped")
        .mockResolvedValue(undefined);

      expect(await trigger(subject)).toBe(false);
      expect(recorded).toHaveBeenCalledWith(
        expect.objectContaining({ projectId }),
        "project_daily_limit_reached",
      );
      expect(create).not.toHaveBeenCalled();
    },
  );
});
