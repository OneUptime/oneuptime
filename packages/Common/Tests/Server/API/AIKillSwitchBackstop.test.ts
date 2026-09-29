import AIService, {
  AILogResponse,
  AI_ALERT_INVESTIGATION_FEATURE,
  AI_CODE_FIX_FEATURE,
  AI_CONFIDENCE_CLASSIFICATION_FEATURE,
  AI_DISABLED_MESSAGE,
  AI_INCIDENT_INVESTIGATION_FEATURE,
  AI_INVESTIGATION_GRADING_FEATURE,
  RUNBOOK_AI_STEP_FEATURE,
  WORKFLOW_AI_FEATURE,
} from "../../../Server/Services/AIService";
import AIBillingService from "../../../Server/Services/AIBillingService";
import IncidentService from "../../../Server/Services/IncidentService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import IncidentAIContextBuilder from "../../../Server/Utils/AI/IncidentAIContextBuilder";
import InvestigationGrader from "../../../Server/Utils/AI/SRE/InvestigationGrader";
import LLMService from "../../../Server/Utils/LLM/LLMService";
import Incident from "../../../Models/DatabaseModels/Incident";
import LlmLog from "../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Project.enableAi is the per-project kill switch for AI — the switch a
 * project flips when it does not want its data going to a model, or does not
 * want to spend money on one.
 *
 * It used to be enforced as ADMISSION CONTROL: each entry point that wanted to
 * honour it read the toggle itself. That is the arrangement this suite exists
 * to prevent coming back, because it leaked exactly the way per-site checks
 * always leak — five "Generate with AI" endpoints were gated while nine other
 * paths into the same provider call were not. A project with AI switched off
 * could still be billed for tokens through a runbook step, a Slack question, a
 * Teams question, on-resolve grading, the code-fix agent loop, or the
 * postmortem service method under the gated route.
 *
 * The gate now lives INSIDE AIService.executeWithLogging, which every AI call
 * in the codebase passes through. That is the guarantee, and it is what the
 * first two describes below pin: the refusal, its cost (nothing), and the
 * single project read that pays for it.
 *
 * Entry-point checks still exist, but their job is DELIVERY, not enforcement:
 *   - throw          — the caller already turns exceptions into a message a
 *                      human reads (runbook step, HTTP handler, agent worker)
 *   - post-to-thread — Slack/Teams run their work in a detached IIFE whose
 *                      .catch only logs, so an exception reaches nobody
 *   - silent skip    — fire-and-forget autonomous work, where "AI is off" is
 *                      a setting and logging it as an error is noise
 *
 * The last describe is the anti-drift guard. A new executeWithLogging caller
 * is covered by the backstop automatically, but it still has to declare which
 * of those three lanes it is in — and no caller may be handed a way to switch
 * the gate off.
 */

type MockBillingGlobal = typeof globalThis & {
  __oneuptimeKillSwitchTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__oneuptimeKillSwitchTestBillingEnabled = false;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__oneuptimeKillSwitchTestBillingEnabled;
    },
  });

  return mocked;
});

function setMockIsBillingEnabled(value: boolean): void {
  (globalThis as MockBillingGlobal).__oneuptimeKillSwitchTestBillingEnabled =
    value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

/*
 * A feature OUTSIDE AUTONOMOUS_AI_FEATURES, used wherever a test counts
 * project reads. The autonomous features carry a second, unrelated read of
 * their own — getAutonomousDailyBudgetStatus loads the project's daily token
 * limits — which would make "how many times was the project read?" measure
 * the daily budget rather than the kill switch.
 */
const INTERACTIVE_FEATURE: string = "Slack ChatOps";

const INCIDENT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..", "..");

/*
 * The shape of a field that would let a caller ask executeWithLogging to skip
 * the kill switch. No such field may exist on AILogRequest.
 */
const OPT_OUT_FIELD_PATTERN: RegExp =
  /skip|bypass|ignore|force|disableCheck|unsafe/i;

// Spies asserted against on every row of the table below.
let projectLookup: jest.SpyInstance;
let getProvider: jest.SpyInstance;
let getCompletion: jest.SpyInstance;
let createLlmLog: jest.SpyInstance;

function mockProject(
  enableAi: boolean | undefined,
  balanceInUSDCents: number = 1000,
): void {
  projectLookup.mockResolvedValue({
    id: PROJECT_ID,
    enableAi,
    aiCurrentBalanceInUSDCents: balanceInUSDCents,
  } as unknown as Project);
}

function mockProvider(
  overrides: Partial<LlmProvider> = {},
): jest.SpyInstance<Promise<LlmProvider | null>> {
  return getProvider.mockResolvedValue({
    id: ObjectID.generate(),
    llmType: LlmType.OpenAI,
    name: "test-provider",
    modelName: "test-model",
    isGlobalLlm: false,
    costPerMillionTokensInUSDCents: 0,
    ...overrides,
  } as unknown as LlmProvider) as jest.SpyInstance<Promise<LlmProvider | null>>;
}

async function execute(feature: string): Promise<unknown> {
  return AIService.executeWithLogging({
    projectId: PROJECT_ID,
    feature,
    messages: [{ role: "user", content: "do the thing" }],
  });
}

beforeEach(() => {
  setMockIsBillingEnabled(false);
  projectLookup = jest.spyOn(ProjectService, "findOneById");
  getProvider = jest.spyOn(LlmProviderService, "getProviderForChat");
  getCompletion = jest.spyOn(LLMService, "getCompletion");
  createLlmLog = jest
    .spyOn(LlmLogService, "create")
    .mockResolvedValue(new LlmLog());

  /*
   * The metered tail of a successful call — only reached by the billing-path
   * tests below, and only ever a write. Stubbed so those tests can assert on
   * the READS the gate makes without a real balance deduction on the end.
   */
  jest
    .spyOn(ProjectService, "deductAiBalanceInUSDCents")
    .mockResolvedValue(undefined);
  jest
    .spyOn(AIBillingService, "rechargeIfBalanceIsLow")
    .mockResolvedValue(undefined as never);

  mockProvider();
  getCompletion.mockResolvedValue({
    content: "the model answered",
    usage: { totalTokens: 10 },
  } as Awaited<ReturnType<typeof LLMService.getCompletion>>);
  mockProject(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  setMockIsBillingEnabled(false);
});

/*
 * Every lane that reaches a provider does so through executeWithLogging, so
 * every lane is represented here by the feature label it actually writes to
 * LlmLog. The point of the table is that the verdict does NOT vary by lane:
 * interactive, autonomous, chat-ops and agent-loop features are refused
 * identically, because the switch is about the project, not about who asked.
 */
const LANES: Array<{ name: string; feature: string }> = [
  { name: "a runbook AI step", feature: RUNBOOK_AI_STEP_FEATURE },
  { name: "the code-fix agent loop", feature: AI_CODE_FIX_FEATURE },
  { name: "a workflow AI component", feature: WORKFLOW_AI_FEATURE },
  { name: "Slack / Teams chat-ops", feature: "Slack ChatOps" },
  {
    name: "an autonomous incident investigation",
    feature: AI_INCIDENT_INVESTIGATION_FEATURE,
  },
  {
    name: "an autonomous alert investigation",
    feature: AI_ALERT_INVESTIGATION_FEATURE,
  },
  {
    name: "on-resolve investigation grading",
    feature: AI_INVESTIGATION_GRADING_FEATURE,
  },
  {
    name: "the post-run confidence signal",
    feature: AI_CONFIDENCE_CLASSIFICATION_FEATURE,
  },
];

describe.each(LANES)(
  "AIService.executeWithLogging refuses $name when the project switch is off",
  ({ feature }: { name: string; feature: string }) => {
    test("throws, naming the screen where the switch can be turned back on", async () => {
      mockProject(false);

      await expect(execute(feature)).rejects.toBeInstanceOf(BadDataException);
      await expect(execute(feature)).rejects.toThrow(AI_DISABLED_MESSAGE);
    });

    /*
     * The whole point of the bug. A refusal that still reached the provider
     * would still cost the project money — which is what the switch was
     * flipped to prevent.
     */
    test("spends no provider tokens", async () => {
      mockProject(false);

      await expect(execute(feature)).rejects.toThrow();

      expect(getCompletion).not.toHaveBeenCalled();
    });

    /*
     * Ordering. Resolving a provider is a query, and on the metered path it
     * is the step that decides who gets billed. A gate that fires after it
     * has already done work for a request it is about to refuse.
     */
    test("refuses before a provider is even resolved", async () => {
      mockProject(false);

      await expect(execute(feature)).rejects.toThrow();

      expect(getProvider).not.toHaveBeenCalled();
    });

    /*
     * No LlmLog row. Nothing was spent, so nothing belongs in the ledger —
     * and for the autonomous features in this table that ledger IS the daily
     * budget (LlmLogService.getTotalTokensUsedSince matches on feature), so a
     * refusal row would be a refusal that eats the budget it never used.
     */
    test("writes no LlmLog row, so the autonomous budget ledger is untouched", async () => {
      mockProject(false);

      await expect(execute(feature)).rejects.toThrow();

      expect(createLlmLog).not.toHaveBeenCalled();
    });

    test("runs normally once the switch is on", async () => {
      mockProject(true);

      const response: AILogResponse = (await execute(feature)) as AILogResponse;

      expect(response.content).toBe("the model answered");
      expect(getCompletion).toHaveBeenCalledTimes(1);
    });
  },
);

describe("the shape of the backstop's project read", () => {
  /*
   * enableAi is NOT NULL DEFAULT true, so an unselected column means "not
   * disabled". A backstop that read undefined as off would switch AI off for
   * every project that never touched the setting — the loudest possible
   * regression, and one no "it refuses when false" test would catch.
   */
  test("an unselected enableAi is not a disabled one", async () => {
    mockProject(undefined);

    await expect(execute(INTERACTIVE_FEATURE)).resolves.toBeDefined();
    expect(getCompletion).toHaveBeenCalledTimes(1);
  });

  /*
   * Fail closed. With no readable row there is no basis for saying AI is
   * enabled, and "enabled" is the expensive guess.
   */
  test("fails closed when the project row cannot be read", async () => {
    projectLookup.mockResolvedValue(null);

    await expect(execute(INTERACTIVE_FEATURE)).rejects.toThrow(
      "Project not found.",
    );
    expect(getProvider).not.toHaveBeenCalled();
    expect(getCompletion).not.toHaveBeenCalled();
  });

  /*
   * Both halves of this read are load-bearing, and each fails silently rather
   * than loudly if it drifts:
   *
   *   - drop enableAi from `select` and every row comes back with it
   *     undefined, which this gate deliberately reads as "not disabled". The
   *     kill switch would pass every request and stay green above.
   *   - drop isRoot and a permission-filtered read returns null for callers
   *     who cannot see the project row, flipping fail-closed into refusing
   *     legitimate traffic.
   */
  test("asks for enableAi as root", async () => {
    await execute(INTERACTIVE_FEATURE);

    const read: {
      select: Dictionary<boolean>;
      props: { isRoot?: boolean };
    } = projectLookup.mock.calls[0]![0] as {
      select: Dictionary<boolean>;
      props: { isRoot?: boolean };
    };

    expect(read.select["enableAi"]).toBe(true);
    expect(read.props.isRoot).toBe(true);
  });

  /*
   * The gate is on the hot path of every AI call, so it does not get to add a
   * query. It reads the balance column in the same round trip and hands the
   * row to the billing check below — one read where there used to be one,
   * not two.
   */
  test("reads the balance in the same round trip, not a second one", async () => {
    setMockIsBillingEnabled(true);
    mockProvider({
      isGlobalLlm: true,
      costPerMillionTokensInUSDCents: 100,
    });

    await execute(INTERACTIVE_FEATURE);

    expect(projectLookup).toHaveBeenCalledTimes(1);

    const read: { select: Dictionary<boolean> } = projectLookup.mock
      .calls[0]![0] as {
      select: Dictionary<boolean>;
    };

    expect(read.select["enableAi"]).toBe(true);
    expect(read.select["aiCurrentBalanceInUSDCents"]).toBe(true);
  });

  /*
   * Sharing the row must not have cost the billing gate its teeth: an
   * enabled project with no balance is still refused, and still logged as
   * InsufficientBalance.
   */
  test("the billing gate still fires on the shared row", async () => {
    setMockIsBillingEnabled(true);
    mockProject(true, 0);
    mockProvider({
      isGlobalLlm: true,
      costPerMillionTokensInUSDCents: 100,
    });

    await expect(execute(INTERACTIVE_FEATURE)).rejects.toThrow(
      /Insufficient AI balance/,
    );
    expect(getCompletion).not.toHaveBeenCalled();
    expect(createLlmLog).toHaveBeenCalledTimes(1);
  });

  /*
   * Order between the two gates the shared row now serves. A project that
   * switched AI off and also has no balance is refused for the reason it
   * chose, not for a billing state it never asked about.
   */
  test("the kill switch is reported ahead of the balance", async () => {
    setMockIsBillingEnabled(true);
    mockProject(false, 0);
    mockProvider({
      isGlobalLlm: true,
      costPerMillionTokensInUSDCents: 100,
    });

    await expect(execute(INTERACTIVE_FEATURE)).rejects.toThrow(
      AI_DISABLED_MESSAGE,
    );
  });
});

/*
 * The delivery lanes. Each of these already reaches the backstop; what is
 * asserted here is that it reaches the USER the way that lane can actually
 * deliver a message.
 */
describe("delivery: fire-and-forget autonomous work skips silently", () => {
  /*
   * gradeInvestigationOnResolve runs detached off an incident resolve, inside
   * a catch that logs at error level. Letting the backstop throw would file a
   * permanent error for every incident a switched-off project ever resolves —
   * so this lane asks first and returns.
   */
  test("on-resolve grading returns without touching AI, and without erroring", async () => {
    mockProject(false);
    const execution: jest.SpyInstance = jest.spyOn(
      AIService,
      "executeWithLogging",
    );

    await expect(
      InvestigationGrader.gradeInvestigationOnResolve({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();

    expect(execution).not.toHaveBeenCalled();
  });
});

describe("delivery: the postmortem service method refuses at its own layer", () => {
  /*
   * generatePostmortemFromAI is public and has two callers — the (gated) HTTP
   * handler and IncidentPostmortemRunner. Gating only the route would leave
   * the switch true for one entry point and false for the other, so the
   * service method reads it too.
   */
  test("refuses before the context builder reads the incident dossier", async () => {
    mockProject(false);
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      id: INCIDENT_ID,
      projectId: PROJECT_ID,
    } as unknown as Incident);
    const buildContext: jest.SpyInstance = jest.spyOn(
      IncidentAIContextBuilder,
      "buildIncidentContext",
    );

    await expect(
      IncidentService.generatePostmortemFromAI({ incidentId: INCIDENT_ID }),
    ).rejects.toThrow(AI_DISABLED_MESSAGE);

    expect(buildContext).not.toHaveBeenCalled();
    expect(getCompletion).not.toHaveBeenCalled();
  });
});

/*
 * ============================== anti-drift ==============================
 *
 * The backstop covers a new caller the moment it is written, which is the
 * point of putting it inside executeWithLogging. But two things can still go
 * wrong silently, and both are architectural rather than behavioural — no
 * assertion above would notice either.
 */
type CallSite = {
  file: string;
  /*
   * How a refusal reaches whoever triggered this call:
   *   "throw"  — an exception here already becomes a message a human reads
   *   "post"   — detached work; an exception reaches nobody, so the site
   *              checks first and posts the refusal itself
   *   "skip"   — autonomous; "AI is off" is a setting, not an error
   */
  delivery: "throw" | "post" | "skip";
};

/*
 * Every place in the codebase that calls executeWithLogging, and the lane it
 * belongs to. Adding a caller without adding it here fails the test below —
 * which is the prompt to decide, once, whether an exception can actually
 * reach that caller's user.
 */
const KNOWN_CALL_SITES: Array<CallSite> = [
  {
    file: "App/FeatureSet/Runbook/Services/AIStepExecutor.ts",
    delivery: "throw",
  },
  {
    file: "Common/Server/Types/Workflow/Components/AI/GenerateText.ts",
    delivery: "throw",
  },
  {
    file: "Common/Server/Utils/AI/Chat/ObservabilityAssistant.ts",
    delivery: "post",
  },
  { file: "Common/Server/Utils/AI/Chat/ChatAgentRunner.ts", delivery: "throw" },
  {
    file: "Common/Server/Utils/AI/CodeFix/CodeFixAgentCompletion.ts",
    delivery: "throw",
  },
  {
    file: "Common/Server/Utils/AI/SRE/InvestigationGrader.ts",
    delivery: "skip",
  },
  { file: "Common/Server/Utils/AI/SRE/ConfidenceSignal.ts", delivery: "skip" },
  { file: "Common/Server/Utils/AI/SRE/InvestigationTldr.ts", delivery: "skip" },
  { file: "Common/Server/API/IncidentAPI.ts", delivery: "throw" },
  { file: "Common/Server/API/IncidentEpisodeAPI.ts", delivery: "throw" },
  { file: "Common/Server/API/AlertAPI.ts", delivery: "throw" },
  { file: "Common/Server/API/ScheduledMaintenanceAPI.ts", delivery: "throw" },
  { file: "Common/Server/Services/IncidentService.ts", delivery: "throw" },
];

function sourceFilesUnder(dir: string): Array<string> {
  const absolute: string = path.join(REPO_ROOT, dir);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  const found: Array<string> = [];

  const walk: (current: string) => void = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full: string = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "Tests") {
          continue;
        }
        walk(full);
        continue;
      }

      if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        found.push(path.relative(REPO_ROOT, full));
      }
    }
  };

  walk(absolute);

  return found;
}

describe("no executeWithLogging caller escapes the kill switch", () => {
  /*
   * The registry is only a guarantee if it is exhaustive. A caller that is
   * not listed is a caller whose error-delivery lane nobody chose — and the
   * lanes are not interchangeable: a throw into detached Slack work is a
   * question that never gets answered, and a throw into on-resolve grading is
   * a permanent error on a correctly-configured project.
   */
  test("every call site is in the registry", () => {
    const calling: Array<string> = [
      ...sourceFilesUnder("Common/Server"),
      ...sourceFilesUnder("App/FeatureSet"),
    ]
      .filter((file: string) => {
        return fs
          .readFileSync(path.join(REPO_ROOT, file), "utf8")
          .includes("AIService.executeWithLogging(");
      })
      .sort();

    const registered: Array<string> = KNOWN_CALL_SITES.map((site: CallSite) => {
      return site.file;
    }).sort();

    expect(calling).toEqual(registered);
  });

  /*
   * The other way this decision could be undone. An opt-out on the request —
   * `skipProjectAICheck`, `force`, anything of that shape — would hand every
   * future caller a one-word way back to the bug this suite is about, and the
   * caller most likely to reach for it is the one that has not thought about
   * the switch. The gate takes no parameters, and that is deliberate.
   */
  test("executeWithLogging offers no way to switch the gate off", () => {
    const source: string = fs.readFileSync(
      path.join(REPO_ROOT, "Common/Server/Services/AIService.ts"),
      "utf8",
    );

    const requestInterface: string = (source.match(
      /export interface AILogRequest \{[\s\S]*?\n\}/,
    ) || [""])[0];

    expect(requestInterface).toContain("projectId");

    const optOutFields: Array<string> = (
      requestInterface.match(/^\s*(\w+)\??:/gm) || []
    ).filter((field: string) => {
      return OPT_OUT_FIELD_PATTERN.test(field);
    });

    expect(optOutFields).toEqual([]);
  });
});
