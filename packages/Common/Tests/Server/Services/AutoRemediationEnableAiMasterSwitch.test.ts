import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import AutoRemediationRuleService from "../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import ProjectService from "../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import RunnerJobService from "../../../Server/Services/RunnerJobService";
import AIInvestigationQueue from "../../../Server/Utils/AI/SRE/InvestigationQueue";
import logger from "../../../Server/Utils/Logger";
import Alert from "../../../Models/DatabaseModels/Alert";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../Models/DatabaseModels/Incident";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import Project from "../../../Models/DatabaseModels/Project";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import AIRunType from "../../../Types/AI/AIRunType";
import AutoRemediationExecutionMode from "../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

/*
 * Contract under test — Enable AI (Project.enableAi) is the project's only
 * AI switch, and it is the auto-remediation engine's kill switch. The
 * project used to have two more, "Enable auto-remediation" and "Enable AI
 * command execution"; both were folded into it.
 *
 * - Off: a new incident or alert starts NOTHING. No cluster round, no
 *   resource round, and no rule is even read — so deterministic runbook
 *   rules (Suggest and Full Auto) stop along with the AI ones. No provider
 *   lookup, no AI run, no runbook, no suggestion, no feed entry. A project
 *   that cannot be read counts as off.
 * - On, or not selected (undefined: the column is NOT NULL DEFAULT true):
 *   every lane runs with no other project switch — the cluster lane, the
 *   resource lane, deterministic Suggest and Full Auto rules, rules where AI
 *   picks the runbook, and rules where AI composes commands (which used to
 *   need the separate command-execution opt-in).
 * - The project read selects exactly { enableAi: true }: the retired
 *   enableAutoRemediation / enableAiCommandExecution columns are never
 *   asked for (they no longer exist).
 * - With no LLM provider the AI rules skip quietly, and deterministic rules
 *   still run.
 * - The verifier's follow-up rounds, on a cluster and on a resource, obey
 *   the same switch and read it the same way.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const ALERT_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RESOURCE_ID: string = "34343434-3434-4343-8343-343434343434";
const RUNBOOK_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const AI_RUN_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const RUNBOOK_EXECUTION_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const SUGGEST_RULE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const FULL_AUTO_RULE_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121212",
);
const AI_PICKS_RUNBOOK_RULE_ID: ObjectID = new ObjectID(
  "13131313-1313-4131-8131-131313131313",
);
const AI_COMPOSES_COMMANDS_RULE_ID: ObjectID = new ObjectID(
  "14141414-1414-4141-8141-141414141414",
);

// Every kind of rule the engine knows, each matching any signal.
type RuleKind =
  | "deterministic Suggest"
  | "deterministic Full Auto"
  | "AI picks the runbook"
  | "AI composes commands";

const RULE_KINDS: Array<RuleKind> = [
  "deterministic Suggest",
  "deterministic Full Auto",
  "AI picks the runbook",
  "AI composes commands",
];

function fakeRule(kind: RuleKind): AutoRemediationRule {
  const byKind: Record<RuleKind, Record<string, unknown>> = {
    "deterministic Suggest": {
      id: SUGGEST_RULE_ID,
      name: "Restart API pods",
      executionMode: AutoRemediationExecutionMode.Suggest,
    },
    "deterministic Full Auto": {
      id: FULL_AUTO_RULE_ID,
      name: "Restart API pods, unattended",
      executionMode: AutoRemediationExecutionMode.FullAuto,
    },
    "AI picks the runbook": {
      id: AI_PICKS_RUNBOOK_RULE_ID,
      name: "Let AI pick",
      executionMode: AutoRemediationExecutionMode.Suggest,
      aiSelectsRunbook: true,
    },
    "AI composes commands": {
      id: AI_COMPOSES_COMMANDS_RULE_ID,
      name: "Let AI compose commands",
      executionMode: AutoRemediationExecutionMode.FullAuto,
      aiComposesCommands: true,
    },
  };

  const fields: Record<string, unknown> = byKind[kind];

  return {
    _id: (fields["id"] as ObjectID).toString(),
    aiSelectsRunbook: false,
    aiComposesCommands: false,
    runbooks: [{ id: RUNBOOK_ID, name: "Restart pods" }],
    ...fields,
  } as unknown as AutoRemediationRule;
}

function allRules(): Array<AutoRemediationRule> {
  return RULE_KINDS.map((kind: RuleKind): AutoRemediationRule => {
    return fakeRule(kind);
  });
}

function readyCluster(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    runner: {
      id: "44444444-4444-4444-8444-444444444444",
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
    },
    accessMethod: "in_cluster",
    aiAgent: null,
    automaticInvestigation: { incidents: false, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Automatic,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
  };
}

function readyResource(): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: [],
    agent: {
      agentId: "45454545-4545-4545-8545-454545454545",
      connectionStatus: "connected",
      isOnline: true,
      posture: {
        resourceType: AiResourceType.DockerHost,
        resourceIdentifier: "web-1",
        allowWrites: true,
        writeTargets: [],
        protectedTargets: [],
        reachable: true,
      },
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
  };
}

function fakeIncident(): Incident {
  return {
    id: INCIDENT_ID,
    _id: INCIDENT_ID.toString(),
    projectId: PROJECT_ID,
    title: "API error rate is high",
    description: "5xx spike on the api service",
    monitors: [],
    labels: [],
  } as unknown as Incident;
}

function fakeAlert(): Alert {
  return {
    id: ALERT_ID,
    _id: ALERT_ID.toString(),
    projectId: PROJECT_ID,
    title: "CPU is high",
    description: "cpu > 95%",
    labels: [],
  } as unknown as Alert;
}

// The project row the engine reads, as findOneById would return it.
function projectRow(enableAi: boolean | undefined): Project {
  return (enableAi === undefined
    ? { _id: PROJECT_ID.toString() }
    : { enableAi }) as unknown as Project;
}

interface EngineSpies {
  findProject: jest.SpyInstance;
  clusterStatuses: jest.SpyInstance;
  resourceStatuses: jest.SpyInstance;
  findSuggestions: jest.SpyInstance;
  findRules: jest.SpyInstance;
  llmProvider: jest.SpyInstance;
  createSuggestion: jest.SpyInstance;
  enqueue: jest.SpyInstance;
  startRunbook: jest.SpyInstance;
  incidentFeed: jest.SpyInstance;
  alertFeed: jest.SpyInstance;
}

function mockEngine(data: {
  project: Project | null;
  clusters?: Array<KubernetesClusterAiAccessStatus> | undefined;
  resources?: Array<ResourceAiAccessStatus> | undefined;
  rules?: Array<AutoRemediationRule> | undefined;
  hasLlmProvider?: boolean | undefined;
}): EngineSpies {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });

  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest
    .spyOn(AutoRemediationSuggestionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  // The hold and breaker checks find no AI jobs on the target.
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);

  return {
    findProject: jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(data.project),
    clusterStatuses: jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
      .mockResolvedValue(data.clusters || []),
    resourceStatuses: jest
      .spyOn(ResourceAiAccessService, "getStatusesForSubject")
      .mockResolvedValue(data.resources || []),
    findSuggestions: jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([]),
    findRules: jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockResolvedValue(data.rules || []),
    llmProvider: jest
      .spyOn(LlmProviderService, "getLLMProviderForProject")
      .mockResolvedValue(
        data.hasLlmProvider === false
          ? null
          : ({ id: ObjectID.generate() } as unknown as LlmProvider),
      ),
    createSuggestion: jest
      .spyOn(AutoRemediationSuggestionService, "create")
      .mockImplementation(
        async (args: unknown): Promise<AutoRemediationSuggestion> => {
          const suggestion: AutoRemediationSuggestion = (
            args as { data: AutoRemediationSuggestion }
          ).data;
          suggestion.id = SUGGESTION_ID;
          return suggestion;
        },
      ),
    enqueue: jest
      .spyOn(AIInvestigationQueue, "enqueue")
      .mockResolvedValue(AI_RUN_ID),
    startRunbook: jest
      .spyOn(RunbookRuleEngineService, "startRunbookFor")
      .mockResolvedValue({
        id: RUNBOOK_EXECUTION_ID,
        _id: RUNBOOK_EXECUTION_ID.toString(),
      } as unknown as RunbookExecution),
    incidentFeed: jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never),
    alertFeed: jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never),
  };
}

// Everything a new signal could start or read past the project switch.
function expectNothingStarted(spies: EngineSpies): void {
  expect(spies.clusterStatuses).not.toHaveBeenCalled();
  expect(spies.resourceStatuses).not.toHaveBeenCalled();
  expect(spies.findSuggestions).not.toHaveBeenCalled();
  expect(spies.findRules).not.toHaveBeenCalled();
  expect(spies.llmProvider).not.toHaveBeenCalled();
  expect(spies.createSuggestion).not.toHaveBeenCalled();
  expect(spies.enqueue).not.toHaveBeenCalled();
  expect(spies.startRunbook).not.toHaveBeenCalled();
  expect(spies.incidentFeed).not.toHaveBeenCalled();
  expect(spies.alertFeed).not.toHaveBeenCalled();
}

function createdSuggestions(
  spies: EngineSpies,
): Array<AutoRemediationSuggestion> {
  return spies.createSuggestion.mock.calls.map(
    (call: Array<unknown>): AutoRemediationSuggestion => {
      return (call[0] as { data: AutoRemediationSuggestion }).data;
    },
  );
}

type Signal = "incident" | "alert";

async function raise(signal: Signal): Promise<void> {
  if (signal === "incident") {
    await AutoRemediationRuleEngineService.applyRulesToIncident(fakeIncident());
    return;
  }

  await AutoRemediationRuleEngineService.applyRulesToAlert(fakeAlert());
}

describe("Enable AI is the auto-remediation engine's kill switch", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each<[Signal]>([["incident"], ["alert"]])(
    "a new %s in a project with Enable AI off",
    (signal: Signal) => {
      it("starts nothing: no cluster round, no resource round, no rule of any kind — not even read", async () => {
        const spies: EngineSpies = mockEngine({
          project: projectRow(false),
          clusters: [readyCluster()],
          resources: [readyResource()],
          rules: allRules(),
        });

        await raise(signal);

        expectNothingStarted(spies);
      });

      it("stops deterministic runbook rules too — Suggest and Full Auto — not only the AI ones", async () => {
        const spies: EngineSpies = mockEngine({
          project: projectRow(false),
          rules: [
            fakeRule("deterministic Suggest"),
            fakeRule("deterministic Full Auto"),
          ],
        });

        await raise(signal);

        expect(spies.findRules).not.toHaveBeenCalled();
        expect(spies.startRunbook).not.toHaveBeenCalled();
        expect(spies.createSuggestion).not.toHaveBeenCalled();
      });

      it("reads the project once, as root, selecting Enable AI and nothing else", async () => {
        const spies: EngineSpies = mockEngine({ project: projectRow(false) });

        await raise(signal);

        expect(spies.findProject).toHaveBeenCalledTimes(1);
        expect(spies.findProject.mock.calls[0]![0]).toEqual({
          id: PROJECT_ID,
          select: { enableAi: true },
          props: { isRoot: true },
        });
      });

      it("never throws out of the create hook", async () => {
        mockEngine({
          project: projectRow(false),
          clusters: [readyCluster()],
          rules: allRules(),
        });

        await expect(raise(signal)).resolves.toBeUndefined();
      });
    },
  );

  it("treats a project it cannot read as off: nothing starts", async () => {
    const spies: EngineSpies = mockEngine({
      project: null,
      clusters: [readyCluster()],
      resources: [readyResource()],
      rules: allRules(),
    });

    await raise("incident");

    expectNothingStarted(spies);
  });

  it("negative control: the same signal, rules and targets with Enable AI on do start work", async () => {
    const spies: EngineSpies = mockEngine({
      project: projectRow(true),
      clusters: [readyCluster()],
      resources: [readyResource()],
      rules: allRules(),
    });

    await raise("incident");

    expect(spies.clusterStatuses).toHaveBeenCalledTimes(1);
    expect(spies.findRules).toHaveBeenCalledTimes(1);
    expect(spies.createSuggestion).toHaveBeenCalled();
  });
});

describe("Enable AI on: every lane runs with no other project switch", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Undefined is "not selected", never "off": the column is NOT NULL
   * DEFAULT true, so every read of it is `=== false`.
   */
  describe.each<[string, boolean | undefined]>([
    ["on", true],
    ["not selected (undefined)", undefined],
  ])("Enable AI %s", (_label: string, enableAi: boolean | undefined) => {
    it("starts a cluster round for a ready Automatic cluster", async () => {
      const spies: EngineSpies = mockEngine({
        project: projectRow(enableAi),
        clusters: [readyCluster()],
      });

      await raise("incident");

      const created: Array<AutoRemediationSuggestion> =
        createdSuggestions(spies);
      expect(created).toHaveLength(1);
      expect(created[0]!.kubernetesClusterId?.toString()).toBe(
        CLUSTER_ID.toString(),
      );
      expect(created[0]!.suggestionType).toBe(
        AutoRemediationSuggestionType.CommandPlan,
      );
      expect(spies.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          remediationRunType: AIRunType.RemediationExecution,
        }),
      );
    });

    it("starts a resource round for a ready Automatic resource", async () => {
      const spies: EngineSpies = mockEngine({
        project: projectRow(enableAi),
        resources: [readyResource()],
      });

      await raise("alert");

      const created: Array<AutoRemediationSuggestion> =
        createdSuggestions(spies);
      expect(created).toHaveLength(1);
      expect(created[0]!.resourceType).toBe(AiResourceType.DockerHost);
      expect(created[0]!.resourceId?.toString()).toBe(RESOURCE_ID);
      expect(created[0]!.alertId?.toString()).toBe(ALERT_ID.toString());
      expect(spies.enqueue).toHaveBeenCalledTimes(1);
    });

    it("proposes a runbook for a deterministic Suggest rule", async () => {
      const spies: EngineSpies = mockEngine({
        project: projectRow(enableAi),
        rules: [fakeRule("deterministic Suggest")],
      });

      await raise("incident");

      const created: Array<AutoRemediationSuggestion> =
        createdSuggestions(spies);
      expect(created).toHaveLength(1);
      expect(created[0]!.status).toBe(
        AutoRemediationSuggestionStatus.Suggested,
      );
      expect(created[0]!.runbookId?.toString()).toBe(RUNBOOK_ID.toString());
      expect(spies.startRunbook).not.toHaveBeenCalled();
    });

    it("starts the runbook for a deterministic Full Auto rule", async () => {
      const spies: EngineSpies = mockEngine({
        project: projectRow(enableAi),
        rules: [fakeRule("deterministic Full Auto")],
      });

      await raise("incident");

      expect(spies.startRunbook).toHaveBeenCalledTimes(1);
      expect(spies.startRunbook).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          runbookId: RUNBOOK_ID,
        }),
      );
      expect(createdSuggestions(spies)[0]!.status).toBe(
        AutoRemediationSuggestionStatus.AutoExecuted,
      );
    });

    it("starts AI planning for a rule where AI picks the runbook", async () => {
      const spies: EngineSpies = mockEngine({
        project: projectRow(enableAi),
        rules: [fakeRule("AI picks the runbook")],
      });

      await raise("incident");

      const created: Array<AutoRemediationSuggestion> =
        createdSuggestions(spies);
      expect(created).toHaveLength(1);
      expect(created[0]!.status).toBe(AutoRemediationSuggestionStatus.Planning);
      expect(spies.enqueue).toHaveBeenCalledTimes(1);
      expect(spies.enqueue).not.toHaveBeenCalledWith(
        expect.objectContaining({
          remediationRunType: AIRunType.RemediationExecution,
        }),
      );
    });

    it("starts a command run for a rule where AI composes commands — no command-execution opt-in exists", async () => {
      const spies: EngineSpies = mockEngine({
        project: projectRow(enableAi),
        rules: [fakeRule("AI composes commands")],
      });

      await raise("incident");

      const created: Array<AutoRemediationSuggestion> =
        createdSuggestions(spies);
      expect(created).toHaveLength(1);
      expect(created[0]!.suggestionType).toBe(
        AutoRemediationSuggestionType.CommandPlan,
      );
      expect(created[0]!.autoRemediationRuleId?.toString()).toBe(
        AI_COMPOSES_COMMANDS_RULE_ID.toString(),
      );
      // The rule's own mode is the consent: Full Auto stays Full Auto.
      expect(created[0]!.executionMode).toBe(
        AutoRemediationExecutionMode.FullAuto,
      );
      expect(spies.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          subjectIncidentId: INCIDENT_ID,
          subjectAutoRemediationSuggestionId: SUGGESTION_ID,
          remediationRunType: AIRunType.RemediationExecution,
        }),
      );
    });
  });

  it("still reads nothing from the project but Enable AI when every lane runs", async () => {
    const spies: EngineSpies = mockEngine({
      project: projectRow(true),
      clusters: [readyCluster()],
      rules: allRules(),
    });

    await raise("incident");

    expect(spies.findProject).toHaveBeenCalledTimes(1);
    const select: Record<string, unknown> = (
      spies.findProject.mock.calls[0]![0] as {
        select: Record<string, unknown>;
      }
    ).select;
    expect(Object.keys(select)).toEqual(["enableAi"]);
    expect(select).not.toHaveProperty("enableAutoRemediation");
    expect(select).not.toHaveProperty("enableAiCommandExecution");
  });
});

describe("Enable AI on but no LLM provider", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("skips the AI rules quietly and still proposes the deterministic rule's runbook", async () => {
    const spies: EngineSpies = mockEngine({
      project: projectRow(true),
      rules: [
        fakeRule("AI composes commands"),
        fakeRule("AI picks the runbook"),
        fakeRule("deterministic Suggest"),
      ],
      hasLlmProvider: false,
    });

    await raise("incident");

    const created: Array<AutoRemediationSuggestion> = createdSuggestions(spies);
    expect(created).toHaveLength(1);
    expect(created[0]!.status).toBe(AutoRemediationSuggestionStatus.Suggested);
    expect(created[0]!.runbookId?.toString()).toBe(RUNBOOK_ID.toString());
    expect(created[0]!.autoRemediationRuleId?.toString()).toBe(
      SUGGEST_RULE_ID.toString(),
    );
    expect(spies.enqueue).not.toHaveBeenCalled();
    // Looked up once, lazily, for the first AI rule — never per rule.
    expect(spies.llmProvider).toHaveBeenCalledTimes(1);
  });

  it("never looks a provider up for deterministic rules alone", async () => {
    const spies: EngineSpies = mockEngine({
      project: projectRow(true),
      rules: [fakeRule("deterministic Full Auto")],
      hasLlmProvider: false,
    });

    await raise("incident");

    expect(spies.llmProvider).not.toHaveBeenCalled();
    expect(spies.startRunbook).toHaveBeenCalledTimes(1);
  });
});

describe("the verifier's follow-up rounds obey Enable AI", () => {
  let getStatusForCluster: jest.SpyInstance;
  let getStatusForResource: jest.SpyInstance;
  let countRounds: jest.SpyInstance;

  function mockFollowUps(project: Project | null): EngineSpies {
    const spies: EngineSpies = mockEngine({ project });
    countRounds = jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));
    getStatusForCluster = jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(readyCluster());
    getStatusForResource = jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockResolvedValue(readyResource());
    return spies;
  }

  function followUpCluster(): Promise<boolean> {
    return AutoRemediationRuleEngineService.startFollowUpClusterRemediation({
      projectId: PROJECT_ID,
      kubernetesClusterId: CLUSTER_ID,
      incidentId: INCIDENT_ID,
    });
  }

  function followUpResource(): Promise<boolean> {
    return AutoRemediationRuleEngineService.startFollowUpResourceRemediation({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: new ObjectID(RESOURCE_ID),
      incidentId: INCIDENT_ID,
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each<[string, () => Promise<boolean>]>([
    ["cluster", followUpCluster],
    ["resource", followUpResource],
  ])("on a %s", (target: string, followUp: () => Promise<boolean>) => {
    it("does not ask again when Enable AI is off, and reads nothing past the switch", async () => {
      const spies: EngineSpies = mockFollowUps(projectRow(false));

      expect(await followUp()).toBe(false);

      expect(countRounds).not.toHaveBeenCalled();
      expect(getStatusForCluster).not.toHaveBeenCalled();
      expect(getStatusForResource).not.toHaveBeenCalled();
      expect(spies.createSuggestion).not.toHaveBeenCalled();
      expect(spies.enqueue).not.toHaveBeenCalled();
    });

    it("does not ask again when the project cannot be read", async () => {
      const spies: EngineSpies = mockFollowUps(null);

      expect(await followUp()).toBe(false);

      expect(spies.createSuggestion).not.toHaveBeenCalled();
      expect(spies.enqueue).not.toHaveBeenCalled();
    });

    it.each<[string, boolean | undefined]>([
      ["on", true],
      ["not selected (undefined)", undefined],
    ])(
      "asks again with Enable AI %s and no other project switch",
      async (_label: string, enableAi: boolean | undefined) => {
        const spies: EngineSpies = mockFollowUps(projectRow(enableAi));

        expect(await followUp()).toBe(true);

        const created: Array<AutoRemediationSuggestion> =
          createdSuggestions(spies);
        expect(created).toHaveLength(1);
        expect(created[0]!.ruleNameSnapshot).toContain("round 2");
        if (target === "cluster") {
          expect(created[0]!.kubernetesClusterId?.toString()).toBe(
            CLUSTER_ID.toString(),
          );
        } else {
          expect(created[0]!.resourceId?.toString()).toBe(RESOURCE_ID);
        }
        expect(spies.enqueue).toHaveBeenCalledTimes(1);
      },
    );

    it("reads the project once, as root, selecting Enable AI and nothing else", async () => {
      const spies: EngineSpies = mockFollowUps(projectRow(true));

      await followUp();

      expect(spies.findProject).toHaveBeenCalledTimes(1);
      expect(spies.findProject.mock.calls[0]![0]).toEqual({
        id: PROJECT_ID,
        select: { enableAi: true },
        props: { isRoot: true },
      });
    });
  });
});
