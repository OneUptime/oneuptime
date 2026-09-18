import InvestigationEligibility, {
  InvestigationSubject,
} from "../../../../Server/Utils/AI/SRE/InvestigationEligibility";
import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AIService from "../../../../Server/Services/AIService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import ObjectID from "../../../../Types/ObjectID";
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
  "severity_below_threshold",
  "monitor_cooldown",
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
  "severity_below_threshold",
];

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
