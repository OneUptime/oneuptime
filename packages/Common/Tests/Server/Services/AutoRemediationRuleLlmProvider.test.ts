import AutoRemediationRuleEngineService, {
  MAX_SUGGESTIONS_PER_SUBJECT,
} from "../../../Server/Services/AutoRemediationRuleEngineService";
import AIRunService from "../../../Server/Services/AIRunService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AutoRemediationDecisionService from "../../../Server/Services/AutoRemediationDecisionService";
import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import ExternalMcpServerService from "../../../Server/Services/ExternalMcpServerService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import MonitorService from "../../../Server/Services/MonitorService";
import ProjectService from "../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import RunbookService from "../../../Server/Services/RunbookService";
import RunnerJobService from "../../../Server/Services/RunnerJobService";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import LlmProviderChoice, {
  RuleLlmProviderChoice,
} from "../../../Server/Utils/AI/LlmProviderChoice";
import AIInvestigationQueue from "../../../Server/Utils/AI/SRE/InvestigationQueue";
import logger from "../../../Server/Utils/Logger";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import Alert from "../../../Models/DatabaseModels/Alert";
import AutoRemediationDecision from "../../../Models/DatabaseModels/AutoRemediationDecision";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../Models/DatabaseModels/Incident";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import AIRunType from "../../../Types/AI/AIRunType";
import {
  LlmProviderFallbackReason,
  LlmProviderSource,
} from "../../../Types/AI/LlmProviderChoice";
import AutoRemediationAction from "../../../Types/AutoRemediation/AutoRemediationAction";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionLane,
  AutoRemediationDecisionReason,
} from "../../../Types/AutoRemediation/AutoRemediationDecision";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * Contract under test - the LLM provider of what an auto remediation rule
 * starts (Types/AI/LlmProviderChoice, Server/Utils/AI/LlmProviderChoice):
 *
 * - every run a matching rule starts records the provider the rule picks
 *   (AIRun.llmProviderId, through AIInvestigationQueue.enqueue): OneUptime
 *   AI's runbook pick, its fix through MCP servers, the commands it
 *   composes on the rule's Runner, and the two shapes saved before rules
 *   were simplified alike. Its executor then uses the pick, or says why it
 *   used another (AIInvestigationEngine.executeRun);
 * - a rule that picks none, and the project's own fixes with no rule set
 *   up, record none: the run uses the project's default provider, else the
 *   global one, as it always did;
 * - the AI agent rounds on the signal's Kubernetes cluster or resource use
 *   the pick of the first matching OneUptime AI rule, by name, that picks
 *   one. A rule that runs its runbooks every time picks no provider for
 *   them - it uses no AI;
 * - whether AI can run for a rule is asked of the provider it would use -
 *   its pick, or what that falls back to - once per pick: a rule whose pick
 *   leaves nothing to run on is skipped for want of a provider, while the
 *   other rules go on;
 * - a follow-up round ("ask again") uses the provider the round before it
 *   on the same cluster or resource was started with.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const ALERT_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const CLUSTER_ID: string = "33333333-3333-4333-8333-333333333331";
const RESOURCE_ID: string = "55555555-5555-4555-8555-555555555551";
const RUNBOOK_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666661",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777771",
);
const PREVIOUS_RUN_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888881",
);

// The providers the rules pick.
const OPUS: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const AZURE: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const GONE: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const UNUSED: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";

interface QueuedRun {
  projectId: ObjectID;
  subjectAutoRemediationSuggestionId: ObjectID;
  remediationRunType?: AIRunType;
  llmProviderId?: ObjectID;
}

interface Harness {
  // Every suggestion the engine created, in order, with the id it got.
  created: Array<AutoRemediationSuggestion>;
  queued: Array<QueuedRun>;
  saved: Array<AutoRemediationDecision>;
  decide: SpyInstance<typeof LlmProviderChoice.decide>;
  projectProvider: SpyInstance<
    typeof LlmProviderService.getLLMProviderForProject
  >;
}

let ruleCount: number = 0;

function runbook(): Runbook {
  return Object.assign(new Runbook(), {
    _id: RUNBOOK_ID.toString(),
    name: "Restart the checkout pods",
  });
}

/*
 * A matching OneUptime AI rule: what every new rule is. It names a runbook
 * unless told otherwise, so each such rule gets its own pick.
 */
function aiRule(
  name: string,
  overrides: Partial<AutoRemediationRule> = {},
): AutoRemediationRule {
  ruleCount += 1;

  return Object.assign(new AutoRemediationRule(), {
    _id: `11111111-1111-4111-8111-${String(ruleCount).padStart(12, "0")}`,
    name,
    executionMode: AutoRemediationExecutionMode.Suggest,
    remediationAction: AutoRemediationAction.OneUptimeAI,
    runbooks: [runbook()],
    ...overrides,
  });
}

function choice(
  pick: string,
  overrides: Partial<RuleLlmProviderChoice> = {},
): RuleLlmProviderChoice {
  return {
    provider: { id: pick, name: `Provider ${pick.slice(-1)}`, isGlobal: false },
    source: LlmProviderSource.RulePick,
    fallbackReason: null,
    pickedProviderId: pick,
    llmProviderId: new ObjectID(pick),
    providerRow: null,
    activity: {
      source: LlmProviderSource.RulePick,
      providerName: `Provider ${pick.slice(-1)}`,
    },
    ...overrides,
  };
}

// A pick that leaves nothing to run on: gone, and the project has no other.
function nothingFor(pick: string): RuleLlmProviderChoice {
  return {
    provider: null,
    source: null,
    fallbackReason: LlmProviderFallbackReason.Unavailable,
    pickedProviderId: pick,
    providerRow: null,
    activity: { fallbackReason: LlmProviderFallbackReason.Unavailable },
  };
}

function readyCluster(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID,
    clusterName: "prod-us",
    runner: null,
    accessMethod: "ai_agent",
    aiAgent: null,
    automaticInvestigation: { incidents: true, alerts: true },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
  } as unknown as KubernetesClusterAiAccessStatus;
}

function readyResource(): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    agent: null,
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
  } as unknown as ResourceAiAccessStatus;
}

function incident(): Incident {
  return {
    id: INCIDENT_ID,
    _id: INCIDENT_ID.toString(),
    projectId: PROJECT_ID,
    title: "Checkout website is down",
    monitors: [],
    labels: [],
  } as unknown as Incident;
}

function alert(): Alert {
  return {
    id: ALERT_ID,
    _id: ALERT_ID.toString(),
    projectId: PROJECT_ID,
    title: "Checkout website is down",
  } as unknown as Alert;
}

function mockEngine(
  data: {
    rules?: Array<AutoRemediationRule> | undefined;
    // Which rules match; every rule unless said.
    matchingRuleIds?: Array<string> | undefined;
    clusters?: Array<KubernetesClusterAiAccessStatus> | undefined;
    resources?: Array<ResourceAiAccessStatus> | undefined;
    enabledRunbooks?: number | undefined;
    mcpServersMayFix?: boolean | undefined;
    // Whether the project has a provider of its own choosing (default or global).
    hasProjectProvider?: boolean | undefined;
    // What each pick decides; the pick itself unless said.
    decisions?: Record<string, RuleLlmProviderChoice> | undefined;
  } = {},
): Harness {
  const harness: Omit<Harness, "decide" | "projectProvider"> = {
    created: [],
    queued: [],
    saved: [],
  };

  stubProjectDirectory({});

  for (const level of ["error", "warn", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    enableAi: true,
    enableAutomaticIncidentRemediation: true,
    enableAutomaticAlertRemediation: true,
  } as unknown as Project);

  // The subject's existing suggestions, and every in-flight check: none.
  jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest
    .spyOn(AutoRemediationSuggestionService, "create")
    .mockImplementation(async (createBy: unknown) => {
      const suggestion: AutoRemediationSuggestion = (
        createBy as { data: AutoRemediationSuggestion }
      ).data;
      suggestion.id = ObjectID.generate();
      harness.created.push(suggestion);
      return suggestion;
    });
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
    .mockResolvedValue(data.clusters || []);
  jest
    .spyOn(ResourceAiAccessService, "getStatusesForSubject")
    .mockResolvedValue(data.resources || []);

  const rules: Array<AutoRemediationRule> = data.rules || [];
  const matching: Array<string> =
    data.matchingRuleIds ||
    rules.map((rule: AutoRemediationRule): string => {
      return rule.id!.toString();
    });

  jest.spyOn(AutoRemediationRuleService, "findBy").mockResolvedValue(rules);
  jest
    .spyOn(AutoRemediationRuleEngineService, "doesIncidentMatchRule")
    .mockImplementation(async (_subject: Incident, r: AutoRemediationRule) => {
      return matching.includes(r.id?.toString() || "");
    });
  jest
    .spyOn(AutoRemediationRuleEngineService, "doesAlertMatchRule")
    .mockImplementation(async (_subject: Alert, r: AutoRemediationRule) => {
      return matching.includes(r.id?.toString() || "");
    });

  const projectProvider: Harness["projectProvider"] = jest
    .spyOn(LlmProviderService, "getLLMProviderForProject")
    .mockResolvedValue(
      data.hasProjectProvider === false
        ? (null as never)
        : (Object.assign(new LlmProvider(), {
            _id: UNUSED,
            name: "Project default",
          }) as never),
    );
  const decide: Harness["decide"] = jest
    .spyOn(LlmProviderChoice, "decide")
    .mockImplementation(
      async (args: {
        projectId: ObjectID;
        pickedProviderId?: unknown;
      }): Promise<RuleLlmProviderChoice> => {
        const pick: string = String(args.pickedProviderId);
        return data.decisions?.[pick] || choice(pick);
      },
    );

  jest
    .spyOn(RunbookService, "countBy")
    .mockResolvedValue(new PositiveNumber(data.enabledRunbooks ?? 1));
  jest
    .spyOn(ExternalMcpServerService, "hasServersThatMayFix")
    .mockResolvedValue(data.mcpServersMayFix === true);
  jest.spyOn(MonitorService, "findBy").mockResolvedValue([]);
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
  jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(AutoRemediationDecisionService, "create")
    .mockImplementation(async (createBy: unknown) => {
      const decision: AutoRemediationDecision = (
        createBy as { data: AutoRemediationDecision }
      ).data;
      harness.saved.push(decision);
      return decision;
    });

  jest
    .spyOn(AIInvestigationQueue, "enqueue")
    .mockImplementation(async (args: unknown): Promise<ObjectID> => {
      harness.queued.push(args as QueuedRun);
      return ObjectID.generate();
    });
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockResolvedValue(undefined as never);

  return { ...harness, decide, projectProvider };
}

// The suggestion a queued run works on.
function suggestionOf(
  harness: Harness,
  run: QueuedRun,
): AutoRemediationSuggestion {
  const suggestion: AutoRemediationSuggestion | undefined =
    harness.created.find((candidate: AutoRemediationSuggestion): boolean => {
      return (
        candidate.id?.toString() ===
        run.subjectAutoRemediationSuggestionId.toString()
      );
    });
  expect(suggestion).toBeDefined();
  return suggestion!;
}

// What each queued run records of a provider: "" for none.
function picksOf(harness: Harness): Array<string> {
  return harness.queued.map((run: QueuedRun): string => {
    return run.llmProviderId?.toString() || "";
  });
}

function ruleEntries(harness: Harness): Array<AutoRemediationDecisionEntry> {
  expect(harness.saved).toHaveLength(1);
  return (
    (harness.saved[0]!.entries ||
      []) as unknown as Array<AutoRemediationDecisionEntry>
  ).filter((entry: AutoRemediationDecisionEntry): boolean => {
    return entry.lane === AutoRemediationDecisionLane.Rule;
  });
}

function reasonOf(
  harness: Harness,
  ruleName: string,
): Array<AutoRemediationDecisionReason> {
  return ruleEntries(harness)
    .filter((entry: AutoRemediationDecisionEntry): boolean => {
      return entry.ruleName === ruleName;
    })
    .map(
      (entry: AutoRemediationDecisionEntry): AutoRemediationDecisionReason => {
        return entry.reason;
      },
    );
}

describe("Auto remediation rules: every run a rule starts records the LLM provider it picks", () => {
  beforeEach(() => {
    ruleCount = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("OneUptime AI's runbook pick, its fix through MCP servers and its commands on the rule's Runner all record the pick", async () => {
    const harness: Harness = mockEngine({
      rules: [
        aiRule("Checkout", {
          llmProviderId: new ObjectID(OPUS),
          runnerId: RUNNER_ID,
        }),
      ],
      mcpServersMayFix: true,
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    // The three runs the rule starts: the budget allows exactly three.
    expect(MAX_SUGGESTIONS_PER_SUBJECT).toBe(3);
    expect(harness.queued).toHaveLength(3);
    expect(picksOf(harness)).toEqual([OPUS, OPUS, OPUS]);
    expect(
      harness.queued.map((run: QueuedRun): string => {
        return String(suggestionOf(harness, run).suggestionType || "");
      }),
    ).toEqual(["", "McpToolCalls", "CommandPlan"]);
    expect(reasonOf(harness, "Checkout")).toEqual([
      AutoRemediationDecisionReason.RuleMatchedAiFixAsks,
      AutoRemediationDecisionReason.RuleAiPickingRunbook,
      AutoRemediationDecisionReason.RuleAiFixingThroughMcpServers,
      AutoRemediationDecisionReason.RuleAiComposingCommands,
    ]);
    // Whether AI can run is asked of the pick - once for all three.
    expect(harness.decide).toHaveBeenCalledTimes(1);
    expect(harness.decide).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      pickedProviderId: OPUS,
    });
  });

  it("an alert's rule records its pick as an incident's does", async () => {
    const harness: Harness = mockEngine({
      rules: [aiRule("Checkout", { llmProviderId: new ObjectID(OPUS) })],
    });

    await AutoRemediationRuleEngineService.applyRulesToAlert(alert());

    expect(picksOf(harness)).toEqual([OPUS]);
    expect(
      (harness.queued[0] as unknown as { subjectAlertId: ObjectID })
        .subjectAlertId,
    ).toEqual(ALERT_ID);
  });

  it("a rule saved before rules were simplified records its pick too: AI composing commands, and AI picking a runbook", async () => {
    const harness: Harness = mockEngine({
      rules: [
        aiRule("Commands", {
          aiComposesCommands: true,
          llmProviderId: new ObjectID(OPUS),
        }),
        aiRule("Picks", {
          aiSelectsRunbook: true,
          llmProviderId: new ObjectID(AZURE),
        }),
      ],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(picksOf(harness)).toEqual([OPUS, AZURE]);
    expect(reasonOf(harness, "Commands")).toEqual([
      AutoRemediationDecisionReason.RuleAiComposingCommands,
    ]);
    expect(reasonOf(harness, "Picks")).toEqual([
      AutoRemediationDecisionReason.RuleAiPickingRunbook,
    ]);
  });

  it("a pick stored as text, or as the relation, is read the same", async () => {
    const harness: Harness = mockEngine({
      rules: [
        aiRule("Text", {
          llmProviderId: OPUS.toUpperCase() as unknown as ObjectID,
        }),
        aiRule("Relation", {
          llmProvider: Object.assign(new LlmProvider(), { _id: AZURE }),
        }),
      ],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(picksOf(harness)).toEqual([OPUS, AZURE]);
  });

  it("a rule that picks none records none: its runs use the project's default, else the global provider", async () => {
    const harness: Harness = mockEngine({
      rules: [aiRule("Checkout", { runnerId: RUNNER_ID })],
      mcpServersMayFix: true,
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(harness.queued).toHaveLength(3);
    for (const run of harness.queued) {
      expect(Object.keys(run)).not.toContain("llmProviderId");
    }
    // Availability is the project's provider's, asked once.
    expect(harness.decide).not.toHaveBeenCalled();
    expect(harness.projectProvider).toHaveBeenCalledTimes(1);
    expect(harness.projectProvider).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("with no rule set up, the project's own fixes record no pick", async () => {
    const harness: Harness = mockEngine({ mcpServersMayFix: true });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(harness.queued).toHaveLength(2);
    expect(picksOf(harness)).toEqual(["", ""]);
    expect(harness.decide).not.toHaveBeenCalled();
  });

  it("a pick that is not a provider id records nothing", async () => {
    const harness: Harness = mockEngine({
      rules: [
        aiRule("Checkout", {
          llmProviderId: "not-a-provider" as unknown as ObjectID,
        }),
      ],
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(picksOf(harness)).toEqual([""]);
  });
});

describe("Auto remediation rules: the AI agent rounds use the pick of the first matching OneUptime AI rule", () => {
  beforeEach(() => {
    ruleCount = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function roundRuns(harness: Harness): Array<QueuedRun> {
    return harness.queued.filter((run: QueuedRun): boolean => {
      const suggestion: AutoRemediationSuggestion = suggestionOf(harness, run);
      return Boolean(suggestion.kubernetesClusterId || suggestion.resourceId);
    });
  }

  it("the cluster round: the first rule by name that picks one, whatever order the rules are read in", async () => {
    const harness: Harness = mockEngine({
      rules: [
        aiRule("zeta", { llmProviderId: new ObjectID(AZURE) }),
        aiRule("Beta"),
        aiRule("alpha", { llmProviderId: new ObjectID(OPUS) }),
      ],
      clusters: [readyCluster()],
      // The rules start nothing of their own: only the round runs.
      enabledRunbooks: 0,
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    const rounds: Array<QueuedRun> = roundRuns(harness);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.remediationRunType).toBe(AIRunType.RemediationExecution);
    expect(
      suggestionOf(harness, rounds[0]!).kubernetesClusterId?.toString(),
    ).toBe(CLUSTER_ID);
    expect(rounds[0]!.llmProviderId?.toString()).toBe(OPUS);
  });

  it("the resource round, when no cluster round started", async () => {
    const harness: Harness = mockEngine({
      rules: [aiRule("Checkout", { llmProviderId: new ObjectID(OPUS) })],
      resources: [readyResource()],
      enabledRunbooks: 0,
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    const rounds: Array<QueuedRun> = roundRuns(harness);
    expect(rounds).toHaveLength(1);
    expect(suggestionOf(harness, rounds[0]!).resourceId?.toString()).toBe(
      RESOURCE_ID,
    );
    expect(rounds[0]!.llmProviderId?.toString()).toBe(OPUS);
  });

  it("a rule that runs its runbooks every time picks nothing for the rounds - it uses no AI", async () => {
    jest
      .spyOn(
        AutoRemediationRuleEngineService as unknown as {
          suggestRunbook: (data: unknown) => Promise<void>;
        },
        "suggestRunbook",
      )
      .mockResolvedValue(undefined);
    jest.spyOn(RunbookService, "findBy").mockResolvedValue([runbook()]);
    const harness: Harness = mockEngine({
      rules: [
        aiRule("aaa every time", {
          remediationAction: AutoRemediationAction.Runbooks,
          llmProviderId: new ObjectID(AZURE),
        }),
        aiRule("zzz", { llmProviderId: new ObjectID(OPUS) }),
      ],
      clusters: [readyCluster()],
      enabledRunbooks: 0,
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(roundRuns(harness)[0]!.llmProviderId?.toString()).toBe(OPUS);
  });

  it("no matching OneUptime AI rule picks one: the round records none", async () => {
    const harness: Harness = mockEngine({
      rules: [
        aiRule("Checkout"),
        aiRule("Not matching", { llmProviderId: new ObjectID(OPUS) }),
      ],
      matchingRuleIds: ["11111111-1111-4111-8111-000000000001"],
      clusters: [readyCluster()],
      enabledRunbooks: 0,
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    const rounds: Array<QueuedRun> = roundRuns(harness);
    expect(rounds).toHaveLength(1);
    expect(Object.keys(rounds[0]!)).not.toContain("llmProviderId");
  });

  it("with no rule set up, the round records none", async () => {
    const harness: Harness = mockEngine({
      clusters: [readyCluster()],
      enabledRunbooks: 0,
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(picksOf(harness)).toEqual([""]);
  });
});

describe("Auto remediation rules: whether AI can run is asked of the provider each rule would use", () => {
  beforeEach(() => {
    ruleCount = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("a rule whose pick leaves nothing to run on is skipped for want of a provider; the other rules go on", async () => {
    const harness: Harness = mockEngine({
      rules: [
        aiRule("Gone", { llmProviderId: new ObjectID(GONE) }),
        aiRule("Opus", { llmProviderId: new ObjectID(OPUS) }),
      ],
      decisions: { [GONE]: nothingFor(GONE) },
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(reasonOf(harness, "Gone")).toEqual([
      AutoRemediationDecisionReason.RuleMatchedAiFixAsks,
      AutoRemediationDecisionReason.RuleSkippedNoLlmProvider,
    ]);
    expect(reasonOf(harness, "Opus")).toEqual([
      AutoRemediationDecisionReason.RuleMatchedAiFixAsks,
      AutoRemediationDecisionReason.RuleAiPickingRunbook,
    ]);
    expect(picksOf(harness)).toEqual([OPUS]);
  });

  it("a rule's pick runs even when the project has no provider of its own", async () => {
    const harness: Harness = mockEngine({
      rules: [
        aiRule("Opus", { llmProviderId: new ObjectID(OPUS) }),
        aiRule("None"),
      ],
      hasProjectProvider: false,
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(reasonOf(harness, "Opus")).toContain(
      AutoRemediationDecisionReason.RuleAiPickingRunbook,
    );
    expect(reasonOf(harness, "None")).toContain(
      AutoRemediationDecisionReason.RuleSkippedNoLlmProvider,
    );
    expect(picksOf(harness)).toEqual([OPUS]);
  });

  it("a pick that falls back still runs, and its run records the pick so it can say why it used another", async () => {
    const harness: Harness = mockEngine({
      rules: [aiRule("Gone", { llmProviderId: new ObjectID(GONE) })],
      decisions: {
        [GONE]: choice(UNUSED, {
          source: LlmProviderSource.ProjectDefault,
          fallbackReason: LlmProviderFallbackReason.Unavailable,
          pickedProviderId: GONE,
        }),
      },
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(reasonOf(harness, "Gone")).toContain(
      AutoRemediationDecisionReason.RuleAiPickingRunbook,
    );
    expect(picksOf(harness)).toEqual([GONE]);
  });

  it("each pick is asked about once, however many rules and runs share it", async () => {
    const harness: Harness = mockEngine({
      rules: [
        aiRule("Gone", { llmProviderId: new ObjectID(GONE) }),
        // Two runs of its own: the runbook pick and commands on its Runner.
        aiRule("Opus with a Runner", {
          llmProviderId: new ObjectID(OPUS),
          runnerId: RUNNER_ID,
        }),
        aiRule("Opus", { llmProviderId: new ObjectID(OPUS) }),
      ],
      decisions: { [GONE]: nothingFor(GONE) },
    });

    await AutoRemediationRuleEngineService.applyRulesToIncident(incident());

    expect(picksOf(harness)).toEqual([OPUS, OPUS, OPUS]);
    const asked: Array<string> = harness.decide.mock.calls.map(
      (call: Parameters<typeof LlmProviderChoice.decide>): string => {
        return String(call[0].pickedProviderId);
      },
    );
    expect(asked).toEqual([GONE, OPUS]);
    expect(harness.projectProvider).not.toHaveBeenCalled();
  });
});

describe("Auto remediation: a follow-up round uses the provider of the round before it", () => {
  const PREVIOUS: AutoRemediationSuggestion = Object.assign(
    new AutoRemediationSuggestion(),
    { _id: "99999999-9999-4999-8999-999999999991", aiRunId: PREVIOUS_RUN_ID },
  );

  let harness: Harness;
  let previousRound: SpyInstance<
    typeof AutoRemediationSuggestionService.findOneBy
  >;
  let previousRun: SpyInstance<typeof AIRunService.findOneById>;

  beforeEach(() => {
    harness = mockEngine({});
    jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(readyCluster());
    jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockResolvedValue(readyResource());
    previousRound = jest
      .spyOn(AutoRemediationSuggestionService, "findOneBy")
      .mockResolvedValue(PREVIOUS);
    previousRun = jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(
        Object.assign(new AIRun(), { llmProviderId: new ObjectID(OPUS) }),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function askAgainOnCluster(): Promise<boolean> {
    return AutoRemediationRuleEngineService.startFollowUpClusterRemediation({
      projectId: PROJECT_ID,
      kubernetesClusterId: new ObjectID(CLUSTER_ID),
      incidentId: INCIDENT_ID,
    });
  }

  function askAgainOnResource(): Promise<boolean> {
    return AutoRemediationRuleEngineService.startFollowUpResourceRemediation({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: new ObjectID(RESOURCE_ID),
      alertId: ALERT_ID,
    });
  }

  it("on a cluster: the subject's latest round there, and the provider its run recorded", async () => {
    expect(await askAgainOnCluster()).toBe(true);

    expect(picksOf(harness)).toEqual([OPUS]);
    const read: Parameters<
      typeof AutoRemediationSuggestionService.findOneBy
    >[0] = previousRound.mock.calls[0]![0];
    expect(read.query).toMatchObject({
      incidentId: INCIDENT_ID,
      kubernetesClusterId: new ObjectID(CLUSTER_ID),
    });
    expect(read.query).toHaveProperty("aiRunId");
    expect(read.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(read.props).toEqual({ isRoot: true });
    expect(previousRun).toHaveBeenCalledWith({
      id: PREVIOUS_RUN_ID,
      select: { llmProviderId: true },
      props: { isRoot: true },
    });
  });

  it("on a resource: the latest round on that resource, for an alert", async () => {
    expect(await askAgainOnResource()).toBe(true);

    expect(picksOf(harness)).toEqual([OPUS]);
    expect(previousRound.mock.calls[0]![0].query).toMatchObject({
      alertId: ALERT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: new ObjectID(RESOURCE_ID),
    });
  });

  it("a round before it that recorded none: none", async () => {
    previousRun.mockResolvedValue(new AIRun());

    expect(await askAgainOnCluster()).toBe(true);

    expect(Object.keys(harness.queued[0]!)).not.toContain("llmProviderId");
  });

  it("no round before it with a run: none, and no run is read", async () => {
    previousRound.mockResolvedValue(null);

    expect(await askAgainOnResource()).toBe(true);

    expect(picksOf(harness)).toEqual([""]);
    expect(previousRun).not.toHaveBeenCalled();
  });

  it("a failed read still asks again, with the project's provider", async () => {
    previousRound.mockRejectedValue(new Error("connection reset"));

    expect(await askAgainOnCluster()).toBe(true);

    expect(picksOf(harness)).toEqual([""]);
  });
});
