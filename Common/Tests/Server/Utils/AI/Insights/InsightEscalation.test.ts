import InsightEscalation, {
  DEFAULT_ESCALATION_MINIMUM_SEVERITY,
  ESCALATED_ALERT_DETAIL_MAX_LENGTH,
  ESCALATED_ALERT_TITLE_MAX_LENGTH,
  ESCALATED_ALERT_TITLE_PREFIX,
  EscalationScanCounter,
  InsightEscalationResult,
  MAX_ESCALATIONS_PER_PROJECT_PER_SCAN,
} from "../../../../../Server/Utils/AI/SRE/Insights/InsightEscalation";
import ProjectService from "../../../../../Server/Services/ProjectService";
import AlertService from "../../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../../Server/Services/AlertSeverityService";
import OnCallDutyPolicyService from "../../../../../Server/Services/OnCallDutyPolicyService";
import AIInsightService from "../../../../../Server/Services/AIInsightService";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../../Types/ObjectID";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The escalation bridge is the ONLY path by which an AI Insight can ever
 * page anyone, so these tests pin every gate in order (env kill switch,
 * master AI switch, strict opt-in, severity floor, permanent dedupe,
 * per-scan cap), the alert's shape (plain [AI] title, provenance-first
 * description, no user attribution), the severity fallback, the verified
 * on-call attach, the escalatedToAlertId stamp, and the fire-safe contract:
 * nothing in here may ever throw into the insight scan.
 */

type MockEnvGlobal = typeof globalThis & {
  __oneuptimeInsightEscalationTestDisableAlertCreation: boolean;
};

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mockedEnvironmentConfig: Record<string, unknown> = { ...actual };
  const mockGlobal: MockEnvGlobal = globalThis as MockEnvGlobal;
  mockGlobal.__oneuptimeInsightEscalationTestDisableAlertCreation = false;

  Object.defineProperty(
    mockedEnvironmentConfig,
    "DisableAutomaticAlertCreation",
    {
      configurable: true,
      enumerable: true,
      get: (): boolean => {
        return mockGlobal.__oneuptimeInsightEscalationTestDisableAlertCreation;
      },
    },
  );

  return mockedEnvironmentConfig;
});

function setDisableAutomaticAlertCreation(value: boolean): void {
  (
    globalThis as MockEnvGlobal
  ).__oneuptimeInsightEscalationTestDisableAlertCreation = value;
}

const projectId: ObjectID = ObjectID.generate();
const insightId: ObjectID = ObjectID.generate();
const createdAlertId: ObjectID = ObjectID.generate();
const configuredSeverityId: ObjectID = ObjectID.generate();
const fallbackSeverityId: ObjectID = ObjectID.generate();
const onCallPolicyId: ObjectID = ObjectID.generate();

function fakeProject(overrides: Record<string, unknown> = {}): Project {
  return {
    id: projectId,
    enableAi: true,
    enableAiInsightEscalation: true,
    aiInsightEscalationMinimumSeverity: undefined,
    aiInsightEscalationAlertSeverityId: configuredSeverityId,
    aiInsightEscalationOnCallDutyPolicyId: undefined,
    ...overrides,
  } as unknown as Project;
}

function fakeInsight(overrides: Record<string, unknown> = {}): AIInsight {
  return {
    id: insightId,
    projectId,
    insightType: AIInsightType.ExceptionSpike,
    severity: AIInsightSeverity.High,
    title: "Exception spike in checkout",
    detailMarkdown: "**42 occurrences** in the last hour.",
    ...overrides,
  } as unknown as AIInsight;
}

function newCounter(escalations: number = 0): EscalationScanCounter {
  return { escalations };
}

describe("InsightEscalation.escalateNewInsight", () => {
  let findProject: jest.SpyInstance;
  let createAlert: jest.SpyInstance;
  let findSeverity: jest.SpyInstance;
  let findOnCallPolicy: jest.SpyInstance;
  let stampInsight: jest.SpyInstance;

  beforeEach(() => {
    setDisableAutomaticAlertCreation(false);
    findProject = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject());
    createAlert = jest
      .spyOn(AlertService, "create")
      .mockResolvedValue({ id: createdAlertId } as unknown as Alert);
    findSeverity = jest
      .spyOn(AlertSeverityService, "findOneBy")
      .mockResolvedValue({ id: fallbackSeverityId } as never);
    findOnCallPolicy = jest
      .spyOn(OnCallDutyPolicyService, "findOneBy")
      .mockResolvedValue(null);
    stampInsight = jest
      .spyOn(AIInsightService, "updateOneById")
      .mockResolvedValue(1 as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("gate 1 — the DISABLE_AUTOMATIC_ALERT_CREATION kill switch", () => {
    test("kill switch on → nothing happens, not even the project read", async () => {
      setDisableAutomaticAlertCreation(true);

      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter: newCounter(),
        });

      expect(result.escalated).toBe(false);
      expect(findProject).not.toHaveBeenCalled();
      expect(createAlert).not.toHaveBeenCalled();
    });

    test("kill switch off → the escalation proceeds", async () => {
      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter: newCounter(),
        });

      expect(result.escalated).toBe(true);
      expect(createAlert).toHaveBeenCalledTimes(1);
    });
  });

  describe("gate 2 — the master AI switch", () => {
    test("enableAi === false kills the path", async () => {
      findProject.mockResolvedValue(fakeProject({ enableAi: false }));

      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter: newCounter(),
        });

      expect(result.escalated).toBe(false);
      expect(createAlert).not.toHaveBeenCalled();
    });

    test("enableAi undefined passes — the column defaults true, only an explicit false kills", async () => {
      findProject.mockResolvedValue(fakeProject({ enableAi: undefined }));

      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter: newCounter(),
        });

      expect(result.escalated).toBe(true);
    });

    test("project not found → skip", async () => {
      findProject.mockResolvedValue(null);

      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter: newCounter(),
        });

      expect(result.escalated).toBe(false);
      expect(createAlert).not.toHaveBeenCalled();
    });
  });

  describe("gate 3 — the strict escalation opt-in", () => {
    test.each([[false], [undefined]])(
      "enableAiInsightEscalation %s → skip (only an explicit true opts in)",
      async (flagValue: boolean | undefined) => {
        findProject.mockResolvedValue(
          fakeProject({ enableAiInsightEscalation: flagValue }),
        );

        const result: InsightEscalationResult =
          await InsightEscalation.escalateNewInsight({
            insight: fakeInsight(),
            counter: newCounter(),
          });

        expect(result.escalated).toBe(false);
        expect(createAlert).not.toHaveBeenCalled();
      },
    );
  });

  describe("gate 4 — the severity floor", () => {
    // [configured floor, insight severity, escalates] — the full matrix.
    test.each([
      // Unset floor defaults to High: only High findings ever page.
      [undefined, AIInsightSeverity.High, true],
      [undefined, AIInsightSeverity.Medium, false],
      [undefined, AIInsightSeverity.Low, false],
      ["High", AIInsightSeverity.High, true],
      ["High", AIInsightSeverity.Medium, false],
      ["High", AIInsightSeverity.Low, false],
      ["Medium", AIInsightSeverity.High, true],
      ["Medium", AIInsightSeverity.Medium, true],
      ["Medium", AIInsightSeverity.Low, false],
      ["Low", AIInsightSeverity.High, true],
      ["Low", AIInsightSeverity.Medium, true],
      ["Low", AIInsightSeverity.Low, true],
      // An unparseable stored floor falls back to High — fail-safe quiet.
      ["Critical", AIInsightSeverity.High, true],
      ["Critical", AIInsightSeverity.Medium, false],
    ])(
      "floor %j + insight severity %s → escalates: %s",
      async (
        floor: string | undefined,
        severity: AIInsightSeverity,
        escalates: boolean,
      ) => {
        findProject.mockResolvedValue(
          fakeProject({ aiInsightEscalationMinimumSeverity: floor }),
        );

        const result: InsightEscalationResult =
          await InsightEscalation.escalateNewInsight({
            insight: fakeInsight({ severity }),
            counter: newCounter(),
          });

        expect(result.escalated).toBe(escalates);
        expect(createAlert).toHaveBeenCalledTimes(escalates ? 1 : 0);
      },
    );

    test("the default floor is High — pinned, because it is the never-page-by-default posture", () => {
      expect(DEFAULT_ESCALATION_MINIMUM_SEVERITY).toBe(AIInsightSeverity.High);
    });

    test("MetricDrift (always Low) can never pass the default floor", async () => {
      findProject.mockResolvedValue(
        fakeProject({ aiInsightEscalationMinimumSeverity: undefined }),
      );

      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight({
            insightType: AIInsightType.MetricDrift,
            severity: AIInsightSeverity.Low,
          }),
          counter: newCounter(),
        });

      expect(result.escalated).toBe(false);
      expect(createAlert).not.toHaveBeenCalled();
    });

    test("an insight without a severity cannot prove it qualifies → skip", async () => {
      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight({ severity: undefined }),
          counter: newCounter(),
        });

      expect(result.escalated).toBe(false);
      expect(createAlert).not.toHaveBeenCalled();
    });
  });

  describe("gate 5 — the permanent one-alert-per-insight dedupe", () => {
    test("escalatedToAlertId already set → skip, no second alert ever", async () => {
      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight({ escalatedToAlertId: ObjectID.generate() }),
          counter: newCounter(),
        });

      expect(result.escalated).toBe(false);
      expect(createAlert).not.toHaveBeenCalled();
    });
  });

  describe("gate 6 — the per-scan escalation cap", () => {
    test("counter at the cap → skip, no alert", async () => {
      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter: newCounter(MAX_ESCALATIONS_PER_PROJECT_PER_SCAN),
        });

      expect(result.escalated).toBe(false);
      expect(createAlert).not.toHaveBeenCalled();
    });

    test("each successful escalation increments the shared counter", async () => {
      const counter: EscalationScanCounter = newCounter();

      await InsightEscalation.escalateNewInsight({
        insight: fakeInsight({ id: ObjectID.generate() }),
        counter,
      });
      await InsightEscalation.escalateNewInsight({
        insight: fakeInsight({ id: ObjectID.generate() }),
        counter,
      });

      expect(counter.escalations).toBe(2);
    });

    test("a scan tick with more qualifying insights than the cap creates exactly the cap", async () => {
      const counter: EscalationScanCounter = newCounter();

      for (
        let i: number = 0;
        i < MAX_ESCALATIONS_PER_PROJECT_PER_SCAN + 1;
        i++
      ) {
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight({ id: ObjectID.generate() }),
          counter,
        });
      }

      expect(createAlert).toHaveBeenCalledTimes(
        MAX_ESCALATIONS_PER_PROJECT_PER_SCAN,
      );
      expect(counter.escalations).toBe(MAX_ESCALATIONS_PER_PROJECT_PER_SCAN);
    });

    test("a skipped escalation does not consume the cap", async () => {
      const counter: EscalationScanCounter = newCounter();

      await InsightEscalation.escalateNewInsight({
        insight: fakeInsight({ severity: AIInsightSeverity.Low }),
        counter,
      });

      expect(counter.escalations).toBe(0);
    });
  });

  describe("alert severity selection", () => {
    test("the configured escalation severity wins — no fallback query", async () => {
      await InsightEscalation.escalateNewInsight({
        insight: fakeInsight(),
        counter: newCounter(),
      });

      const alert: Alert = createAlert.mock.calls[0]?.[0]?.data as Alert;
      expect(alert.alertSeverityId?.toString()).toBe(
        configuredSeverityId.toString(),
      );
      expect(findSeverity).not.toHaveBeenCalled();
    });

    test("unset → the project's most critical severity by sort order (the MonitorAlert fallback)", async () => {
      findProject.mockResolvedValue(
        fakeProject({ aiInsightEscalationAlertSeverityId: undefined }),
      );

      await InsightEscalation.escalateNewInsight({
        insight: fakeInsight(),
        counter: newCounter(),
      });

      expect(findSeverity).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ projectId }),
          sort: expect.objectContaining({ order: SortOrder.Ascending }),
          props: expect.objectContaining({ isRoot: true }),
        }),
      );
      const alert: Alert = createAlert.mock.calls[0]?.[0]?.data as Alert;
      expect(alert.alertSeverityId?.toString()).toBe(
        fallbackSeverityId.toString(),
      );
    });

    test("a project with ZERO alert severities logs and skips — never throws (unlike MonitorAlert)", async () => {
      findProject.mockResolvedValue(
        fakeProject({ aiInsightEscalationAlertSeverityId: undefined }),
      );
      findSeverity.mockResolvedValue(null);
      const counter: EscalationScanCounter = newCounter();

      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter,
        });

      expect(result.escalated).toBe(false);
      expect(createAlert).not.toHaveBeenCalled();
      expect(counter.escalations).toBe(0);
    });
  });

  describe("on-call policy attach", () => {
    test("a configured policy is verified (exists AND belongs to the project) and attached as an id-stub", async () => {
      findProject.mockResolvedValue(
        fakeProject({ aiInsightEscalationOnCallDutyPolicyId: onCallPolicyId }),
      );
      findOnCallPolicy.mockResolvedValue({ id: onCallPolicyId } as never);

      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter: newCounter(),
        });

      expect(result.escalated).toBe(true);
      // The lookup is scoped to the project — a foreign policy cannot match.
      expect(findOnCallPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            _id: onCallPolicyId.toString(),
            projectId,
          }),
          props: expect.objectContaining({ isRoot: true }),
        }),
      );
      const alert: Alert = createAlert.mock.calls[0]?.[0]?.data as Alert;
      expect(alert.onCallDutyPolicies).toHaveLength(1);
      expect(alert.onCallDutyPolicies?.[0]?._id).toBe(
        onCallPolicyId.toString(),
      );
    });

    test("a missing/foreign policy → the alert is still created, WITHOUT the policy", async () => {
      findProject.mockResolvedValue(
        fakeProject({ aiInsightEscalationOnCallDutyPolicyId: onCallPolicyId }),
      );
      findOnCallPolicy.mockResolvedValue(null);

      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter: newCounter(),
        });

      expect(result.escalated).toBe(true);
      const alert: Alert = createAlert.mock.calls[0]?.[0]?.data as Alert;
      expect(alert.onCallDutyPolicies).toHaveLength(0);
    });

    test("no policy configured → no lookup, no policies", async () => {
      await InsightEscalation.escalateNewInsight({
        insight: fakeInsight(),
        counter: newCounter(),
      });

      expect(findOnCallPolicy).not.toHaveBeenCalled();
      const alert: Alert = createAlert.mock.calls[0]?.[0]?.data as Alert;
      expect(alert.onCallDutyPolicies).toHaveLength(0);
    });
  });

  describe("the created alert's shape", () => {
    test("plain [AI]-prefixed title, no template rendering", async () => {
      await InsightEscalation.escalateNewInsight({
        insight: fakeInsight({ title: "Exception spike in {{checkout}}" }),
        counter: newCounter(),
      });

      const alert: Alert = createAlert.mock.calls[0]?.[0]?.data as Alert;
      // {{...}} stays literal — this path never renders templates.
      expect(alert.title).toBe(
        `${ESCALATED_ALERT_TITLE_PREFIX}Exception spike in {{checkout}}`,
      );
    });

    test("the title is clamped to the Alert title column length", async () => {
      await InsightEscalation.escalateNewInsight({
        insight: fakeInsight({ title: "x".repeat(600) }),
        counter: newCounter(),
      });

      const alert: Alert = createAlert.mock.calls[0]?.[0]?.data as Alert;
      expect(alert.title?.length).toBe(ESCALATED_ALERT_TITLE_MAX_LENGTH);
      expect(alert.title?.startsWith(ESCALATED_ALERT_TITLE_PREFIX)).toBe(true);
    });

    test("description = provenance line first, then the insight's detail", async () => {
      await InsightEscalation.escalateNewInsight({
        insight: fakeInsight({
          insightType: AIInsightType.ErrorLogSpike,
          detailMarkdown: "**Error volume 12x** over baseline.",
        }),
        counter: newCounter(),
      });

      const alert: Alert = createAlert.mock.calls[0]?.[0]?.data as Alert;
      expect(
        alert.description?.startsWith(
          "Escalated automatically from AI Insight ErrorLogSpike",
        ),
      ).toBe(true);
      expect(alert.description).toContain(
        "**Error volume 12x** over baseline.",
      );
    });

    test("an oversized detail is truncated to the cap with a pointer back to the insight", async () => {
      const hugeDetail: string = "d".repeat(
        ESCALATED_ALERT_DETAIL_MAX_LENGTH + 1000,
      );

      await InsightEscalation.escalateNewInsight({
        insight: fakeInsight({ detailMarkdown: hugeDetail }),
        counter: newCounter(),
      });

      const alert: Alert = createAlert.mock.calls[0]?.[0]?.data as Alert;
      expect(alert.description).toContain("truncated — see the AI Insight");
      expect(alert.description).not.toContain(hugeDetail);
      expect(alert.description).toContain(
        "d".repeat(ESCALATED_ALERT_DETAIL_MAX_LENGTH),
      );
    });

    test("no detailMarkdown → the description is just the provenance line", async () => {
      await InsightEscalation.escalateNewInsight({
        insight: fakeInsight({ detailMarkdown: undefined }),
        counter: newCounter(),
      });

      const alert: Alert = createAlert.mock.calls[0]?.[0]?.data as Alert;
      expect(alert.description).toBe(
        "Escalated automatically from AI Insight ExceptionSpike — review the insight for full evidence.",
      );
    });

    test("system-created: isRoot props, isCreatedAutomatically, and NO user attribution", async () => {
      await InsightEscalation.escalateNewInsight({
        insight: fakeInsight(),
        counter: newCounter(),
      });

      expect(createAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({ isRoot: true }),
        }),
      );
      const alert: Alert = createAlert.mock.calls[0]?.[0]?.data as Alert;
      expect(alert.projectId?.toString()).toBe(projectId.toString());
      expect(alert.isCreatedAutomatically).toBe(true);
      expect(alert.createdByUserId).toBeUndefined();
      expect(alert.createdByUser).toBeUndefined();
    });
  });

  describe("the escalatedToAlertId stamp", () => {
    test("the created alert's id is stamped onto the insight as root", async () => {
      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter: newCounter(),
        });

      expect(result.alertId?.toString()).toBe(createdAlertId.toString());
      expect(stampInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          id: insightId,
          data: expect.objectContaining({
            escalatedToAlertId: createdAlertId,
          }),
          props: expect.objectContaining({ isRoot: true }),
        }),
      );
    });

    test("a failed stamp write does not fail the escalation — the alert already exists and pages", async () => {
      stampInsight.mockRejectedValue(new Error("write conflict"));
      const counter: EscalationScanCounter = newCounter();

      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter,
        });

      expect(result.escalated).toBe(true);
      expect(counter.escalations).toBe(1);
    });
  });

  describe("fire-safe contract — escalation can never break the scan", () => {
    test("AlertService.create rejecting → escalated:false, counter untouched, nothing stamped, no throw", async () => {
      createAlert.mockRejectedValue(new Error("db down"));
      const counter: EscalationScanCounter = newCounter();

      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter,
        });

      expect(result.escalated).toBe(false);
      expect(counter.escalations).toBe(0);
      expect(stampInsight).not.toHaveBeenCalled();
    });

    test("the project read rejecting → quiet skip, no throw", async () => {
      findProject.mockRejectedValue(new Error("db down"));

      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter: newCounter(),
        });

      expect(result.escalated).toBe(false);
      expect(createAlert).not.toHaveBeenCalled();
    });

    test("the on-call policy read rejecting → quiet skip, no throw", async () => {
      findProject.mockResolvedValue(
        fakeProject({ aiInsightEscalationOnCallDutyPolicyId: onCallPolicyId }),
      );
      findOnCallPolicy.mockRejectedValue(new Error("db down"));

      const result: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight(),
          counter: newCounter(),
        });

      expect(result.escalated).toBe(false);
    });

    test("an insight without an id or projectId is skipped defensively", async () => {
      const withoutId: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight({ id: undefined }),
          counter: newCounter(),
        });
      const withoutProject: InsightEscalationResult =
        await InsightEscalation.escalateNewInsight({
          insight: fakeInsight({ projectId: undefined }),
          counter: newCounter(),
        });

      expect(withoutId.escalated).toBe(false);
      expect(withoutProject.escalated).toBe(false);
      expect(createAlert).not.toHaveBeenCalled();
    });
  });
});
