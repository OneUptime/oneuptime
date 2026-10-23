import SecurityCaseTriage, {
  SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES,
  SecurityCaseTriageNotStartedCode,
  SecurityCaseTriageStartResult,
} from "../../../../../Server/Utils/AI/Security/SecurityCaseTriage";
import AIInvestigationEngine from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIRunService from "../../../../../Server/Services/AIRunService";
import AIService from "../../../../../Server/Services/AIService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import logger from "../../../../../Server/Utils/Logger";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../../Types/AI/AIRunType";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * When OneUptime AI triages a security case, and the one way a triage
 * starts. Everything AI needs is checked before a run is recorded - AI on
 * for the project (its one AI switch), an LLM provider, credits, room under
 * the daily limits - and an automatic triage also needs the project's
 * "Triage new cases" switch, which a person's Triage with AI does not.
 */

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const securityCaseId: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const runId: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: projectId,
    enableAi: true,
    enableAutomaticSecurityCaseTriage: true,
    ...overrides,
  } as unknown as Project;
}

describe("SecurityCaseTriage", () => {
  let findProject: jest.SpyInstance;
  let providerOrBalance: jest.SpyInstance;
  let dailyLimit: jest.SpyInstance;
  let findActive: jest.SpyInstance;
  let enqueue: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    findProject = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project());
    providerOrBalance = jest
      .spyOn(AIInvestigationEngine, "getProviderOrBalanceReason")
      .mockResolvedValue(null);
    dailyLimit = jest
      .spyOn(AIService, "getReachedProjectDailyLimit")
      .mockResolvedValue(null);
    findActive = jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    enqueue = jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(runId);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function reason(
    automatic: boolean,
  ): Promise<SecurityCaseTriageNotStartedCode | null> {
    return await SecurityCaseTriage.getNotStartedReason({
      projectId,
      automatic,
    });
  }

  test("nothing in the way: no reason", async () => {
    expect(await reason(true)).toBeNull();
    expect(await reason(false)).toBeNull();
  });

  test("AI off for the project stops every triage, automatic or asked for", async () => {
    findProject.mockResolvedValue(project({ enableAi: false }));

    expect(await reason(true)).toBe("ai_disabled");
    expect(await reason(false)).toBe("ai_disabled");
    expect(providerOrBalance).not.toHaveBeenCalled();
  });

  test("the Triage new cases switch stops only the automatic triage", async () => {
    findProject.mockResolvedValue(
      project({ enableAutomaticSecurityCaseTriage: false }),
    );

    expect(await reason(true)).toBe("automatic_triage_disabled");
    expect(await reason(false)).toBeNull();
  });

  test("no LLM provider, no credits", async () => {
    providerOrBalance.mockResolvedValueOnce("provider_missing");
    expect(await reason(false)).toBe("provider_missing");

    providerOrBalance.mockResolvedValueOnce("insufficient_ai_balance");
    expect(await reason(false)).toBe("insufficient_ai_balance");
  });

  test("the project's own daily AI limit", async () => {
    dailyLimit.mockResolvedValue({ reached: true } as never);

    expect(await reason(false)).toBe("project_daily_limit_reached");
  });

  test("a project that cannot be read, or a check that throws, says so rather than starting", async () => {
    findProject.mockResolvedValueOnce(null);
    expect(await reason(false)).toBe("eligibility_check_failed");

    findProject.mockRejectedValueOnce(new Error("db down"));
    expect(await reason(false)).toBe("eligibility_check_failed");
  });

  test("the project is read as root, with the switches and the daily limit columns", async () => {
    await reason(true);

    const args: {
      id: ObjectID;
      select: Record<string, boolean>;
      props: unknown;
    } = findProject.mock.calls[0]![0] as never;

    expect(args.id).toBe(projectId);
    expect(args.props).toEqual({ isRoot: true });
    expect(args.select).toMatchObject({
      enableAi: true,
      enableAutomaticSecurityCaseTriage: true,
      aiDailyTokenLimitReachedAt: true,
      aiDailySpendLimitReachedAt: true,
    });
  });

  test("a person's Triage with AI queues an Investigation run with the case as its subject", async () => {
    const result: SecurityCaseTriageStartResult =
      await SecurityCaseTriage.startTriage({ projectId, securityCaseId });

    expect(result).toEqual({ started: true, runId });
    expect(enqueue).toHaveBeenCalledWith({
      projectId,
      subjectSecurityCaseId: securityCaseId,
    });
  });

  test("one triage at a time: a case with a run on its way is not queued again", async () => {
    findActive.mockResolvedValue({
      id: runId,
      status: AIRunStatus.Running,
    } as unknown as AIRun);

    expect(
      await SecurityCaseTriage.startTriage({ projectId, securityCaseId }),
    ).toEqual({ started: false, code: "already_triaging" });
    expect(enqueue).not.toHaveBeenCalled();

    expect(findActive.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId,
        runType: AIRunType.Investigation,
        triggeredBySecurityCaseId: securityCaseId,
        status: new Includes([AIRunStatus.Queued, AIRunStatus.Running]),
      },
      props: { isRoot: true },
    });
  });

  test("a queue that records nothing is said", async () => {
    enqueue.mockResolvedValue(null);

    expect(
      await SecurityCaseTriage.startTriage({ projectId, securityCaseId }),
    ).toEqual({ started: false, code: "not_enqueued" });
  });

  test("a new case is triaged when the project triages new cases", async () => {
    expect(
      await SecurityCaseTriage.triageNewCase({ projectId, securityCaseId }),
    ).toEqual(runId);
  });

  test("a new case is not triaged with the switch off, and nothing throws", async () => {
    findProject.mockResolvedValue(
      project({ enableAutomaticSecurityCaseTriage: false }),
    );

    expect(
      await SecurityCaseTriage.triageNewCase({ projectId, securityCaseId }),
    ).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();

    // A case opens whether or not it is triaged.
    enqueue.mockRejectedValue(new Error("redis down"));
    findProject.mockResolvedValue(project());

    expect(
      await SecurityCaseTriage.triageNewCase({ projectId, securityCaseId }),
    ).toBeNull();
  });

  test("every reason has a message that says what to do", () => {
    const codes: Array<SecurityCaseTriageNotStartedCode> = [
      "ai_disabled",
      "automatic_triage_disabled",
      "provider_missing",
      "insufficient_ai_balance",
      "project_daily_limit_reached",
      "already_triaging",
      "not_enqueued",
      "eligibility_check_failed",
    ];

    expect(
      Object.keys(SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES).sort(),
    ).toEqual([...codes].sort());

    for (const code of codes) {
      expect(
        SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES[code].endsWith("."),
      ).toBe(true);
    }

    expect(SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES.ai_disabled).toContain(
      "Project Settings → AI → AI Features",
    );
    expect(
      SECURITY_CASE_TRIAGE_NOT_STARTED_MESSAGES.provider_missing,
    ).toContain("Project Settings → AI → LLM Providers");
  });
});
