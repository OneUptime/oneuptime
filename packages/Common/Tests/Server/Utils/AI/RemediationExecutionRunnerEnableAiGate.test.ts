import RemediationExecutionRunner from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import { ObservabilityAssistantExtraTool } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AutoRemediationRuleService from "../../../../Server/Services/AutoRemediationRuleService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import PostedRootCause from "../../../../Server/Utils/AI/SRE/PostedRootCause";
import logger from "../../../../Server/Utils/Logger";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AutoRemediationExecutionMode from "../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import OneUptimeDate from "../../../../Types/Date";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — Enable AI is the ONE project switch every
 * remediation round passes when it runs (RemediationExecutionRunner.
 * executeRemediation, through checkProjectGates), whichever lane started it:
 *
 * - a RULE round (an auto-remediation rule that composes commands), a
 *   CLUSTER round (a Kubernetes cluster's AI agent page asked) and a
 *   RESOURCE round (an infrastructure resource's AI agent page asked) get
 *   the same answer from the project in every state. The retired "Enable
 *   auto-remediation" kill switch and "Enable AI command execution" opt-in
 *   are gone, so no lane needs anything more from the project, and a stale
 *   value of either on a row means nothing;
 * - Enable AI off (or a project row that is gone) settles the round
 *   NoneApplicable with the gate's refusal BEFORE the round's own consent —
 *   its rule, its cluster's or its resource's AI page — is read, and runs
 *   nothing; the run completes quietly;
 * - Enable AI on (or not selected: off only when === false) hands the
 *   round to the engine with no other project switch asked for;
 * - what is checked before the gate still wins over it: a retried run whose
 *   earlier attempt already executed commands settles what happened, and a
 *   cluster round whose cluster was deleted while it waited is closed as
 *   such — neither is ever reported as "AI was disabled".
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CLUSTER_RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "36363636-3636-4636-8636-363636363636",
);
const RESOURCE_AGENT_ID: string = "45454545-4545-4545-8545-454545454545";
const RUNNER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);

const AI_DISABLED_MESSAGE: string =
  "AI was disabled for this project before the run started (Project Settings → AI Features) — nothing was run or proposed.";

type RoundKind = "rule" | "cluster" | "resource";

const ROUND_KINDS: Array<RoundKind> = ["rule", "cluster", "resource"];

// The suggestion row as the database holds it, for each lane.
function suggestionRow(
  kind: RoundKind,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const common: Record<string, unknown> = {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    status: AutoRemediationSuggestionStatus.Planning,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    incidentId: INCIDENT_ID,
    verificationWindowMinutes: 15,
    createdAt: OneUptimeDate.getSomeMinutesAgo(1),
  };

  const lane: Record<RoundKind, Record<string, unknown>> = {
    rule: {
      autoRemediationRuleId: RULE_ID,
      ruleNameSnapshot: "Restart the API service",
    },
    cluster: {
      executionMode: AutoRemediationExecutionMode.FullAuto,
      autoResolveOnRecovery: true,
      kubernetesClusterId: CLUSTER_ID,
      ruleNameSnapshot: 'AI remediation for cluster "prod-us"',
    },
    resource: {
      executionMode: AutoRemediationExecutionMode.FullAuto,
      autoResolveOnRecovery: true,
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
      ruleNameSnapshot: 'AI remediation for Docker host "web-1"',
    },
  };

  return { ...common, ...lane[kind], ...overrides };
}

function clusterStatus(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    runner: {
      id: CLUSTER_RUNNER_ID.toString(),
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
      posture: { inCluster: true, allowWrites: true },
    },
    accessMethod: "in_cluster",
    aiAgent: null,
    automaticInvestigation: { incidents: false, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.BypassApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: new Date().toISOString(),
  };
}

function resourceStatus(): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID.toString(),
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: [],
    agent: {
      agentId: RESOURCE_AGENT_ID,
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

// A commandPlan column value proving an earlier attempt already executed.
function executedPlanJson(): JSONObject {
  return {
    commands: [
      {
        sequence: 1,
        stepType: "Bash",
        runnerId: RUNNER_ID.toString(),
        runnerNameSnapshot: "prod-runner",
        command: "systemctl restart api",
        timeoutInMs: 60000,
        rationale: "Restart the crashed service.",
        expectedEffect: "The service comes back.",
        policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
        wasAutoExecuted: true,
        execution: {
          status: AiRemediationCommandExecutionStatus.Succeeded,
          exitCode: 0,
        },
      },
    ],
  };
}

async function run(): Promise<void> {
  await RemediationExecutionRunner.executeRemediation({
    aiRunId: RUN_ID,
    projectId: PROJECT_ID,
    suggestionId: SUGGESTION_ID,
    attemptCount: 1,
  });
}

describe("RemediationExecutionRunner — Enable AI is the one project gate for every round", () => {
  let runCas: jest.SpyInstance;
  let suggestionCas: jest.SpyInstance;
  let suggestionRead: jest.SpyInstance;
  let projectRead: jest.SpyInstance;
  let ruleRead: jest.SpyInstance;
  let clusterRead: jest.SpyInstance;
  let resourceRead: jest.SpyInstance;
  let executeRun: jest.SpyInstance;
  let captured: Array<InvestigationRequest>;

  // The read that holds the round's own consent, per lane.
  function consentRead(kind: RoundKind): jest.SpyInstance {
    const reads: Record<RoundKind, jest.SpyInstance> = {
      rule: ruleRead,
      cluster: clusterRead,
      resource: resourceRead,
    };
    return reads[kind];
  }

  /*
   * Serve the row through the runner's own select, so a column the runner
   * forgets to ask for is genuinely absent — as with a real findOneById.
   */
  function serveSuggestion(row: Record<string, unknown>): void {
    suggestionRead.mockImplementation(
      async (args: unknown): Promise<AutoRemediationSuggestion> => {
        const select: Record<string, unknown> = (
          args as { select: Record<string, unknown> }
        ).select;
        const picked: Record<string, unknown> = { id: row["id"] };
        for (const key of Object.keys(select)) {
          if (key in row) {
            picked[key] = row[key];
          }
        }
        return picked as unknown as AutoRemediationSuggestion;
      },
    );
  }

  function serveProject(project: Record<string, unknown> | null): void {
    projectRead.mockResolvedValue(project as unknown as Project);
  }

  // What the round came to: "engine", or the rationale it settled with.
  type Outcome = string;

  function outcome(): Outcome {
    if (executeRun.mock.calls.length > 0) {
      expect(suggestionCas).not.toHaveBeenCalled();
      return "engine";
    }
    expect(suggestionCas).toHaveBeenCalledTimes(1);
    const set: { status: string; rationaleMarkdown: string } = (
      suggestionCas.mock.calls[0]![0] as {
        set: { status: string; rationaleMarkdown: string };
      }
    ).set;
    expect(set.status).toBe(AutoRemediationSuggestionStatus.NoneApplicable);
    return set.rationaleMarkdown;
  }

  beforeEach(() => {
    captured = [];
    runCas = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);
    jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    suggestionCas = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);
    jest
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    // No previous rounds on this subject, nothing counted by a breaker.
    jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([]);
    jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    suggestionRead = jest.spyOn(
      AutoRemediationSuggestionService,
      "findOneById",
    );
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
    for (const level of ["debug", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation((): void => {
        return undefined;
      });
    }
    projectRead = jest.spyOn(ProjectService, "findOneById");
    serveProject({ id: PROJECT_ID, enableAi: true });
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      id: INCIDENT_ID,
      title: "API error rate is high",
      description: "5xx spike on checkout",
      incidentNumber: 42,
    } as unknown as Incident);
    jest.spyOn(PostedRootCause, "getForSubject").mockResolvedValue(null);
    jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ id: "lock" } as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

    // Each lane's own consent says yes: only the project can say no.
    ruleRead = jest
      .spyOn(AutoRemediationRuleService, "findOneById")
      .mockResolvedValue({
        id: RULE_ID,
        _id: RULE_ID.toString(),
        isEnabled: true,
        aiComposesCommands: true,
        executionMode: AutoRemediationExecutionMode.Suggest,
        commandAllowlist: [],
        commandRunners: [],
      } as unknown as AutoRemediationRule);
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([]);
    clusterRead = jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(clusterStatus());
    resourceRead = jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockResolvedValue(resourceStatus());

    executeRun = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockImplementation(
        async (data: { request: InvestigationRequest }): Promise<void> => {
          captured.push(data.request);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(ROUND_KINDS)("a %s round", (kind: RoundKind) => {
    it("is stopped by Enable AI off: settles NoneApplicable with the gate's refusal before its own consent is read, and runs nothing", async () => {
      serveSuggestion(suggestionRow(kind));
      serveProject({ id: PROJECT_ID, enableAi: false });

      await run();

      expect(executeRun).not.toHaveBeenCalled();
      expect(consentRead(kind)).not.toHaveBeenCalled();
      expect(suggestionCas).toHaveBeenCalledTimes(1);
      expect(suggestionCas).toHaveBeenCalledWith({
        suggestionId: SUGGESTION_ID,
        fromStatus: AutoRemediationSuggestionStatus.Planning,
        set: {
          status: AutoRemediationSuggestionStatus.NoneApplicable,
          rationaleMarkdown: AI_DISABLED_MESSAGE,
        },
      });
      // The run itself ends quietly: a switched-off project is not an error.
      expect(runCas).toHaveBeenCalledWith(
        expect.objectContaining({
          aiRunId: RUN_ID,
          fromStatus: AIRunStatus.Running,
          set: expect.objectContaining({ status: AIRunStatus.Completed }),
        }),
      );
    });

    it("is stopped the same way when the project row is gone — the gate fails closed", async () => {
      serveSuggestion(suggestionRow(kind));
      serveProject(null);

      await run();

      expect(executeRun).not.toHaveBeenCalled();
      expect(consentRead(kind)).not.toHaveBeenCalled();
      expect(outcome()).toBe(AI_DISABLED_MESSAGE);
    });

    it("goes to the engine with Enable AI on, asking the project for Enable AI alone", async () => {
      serveSuggestion(suggestionRow(kind));

      await run();

      expect(outcome()).toBe("engine");
      expect(consentRead(kind)).toHaveBeenCalledTimes(1);
      expect(projectRead).toHaveBeenCalledTimes(1);
      expect(projectRead).toHaveBeenCalledWith({
        id: PROJECT_ID,
        select: { enableAi: true },
        props: { isRoot: true },
      });
      expect(captured).toHaveLength(1);
      expect(
        (captured[0]!.extraTools || []).map(
          (tool: ObservabilityAssistantExtraTool): string => {
            return tool.definition.name;
          },
        ),
      ).toContain("list_command_targets");
    });

    it.each([
      ["auto-remediation switched off", { enableAutoRemediation: false }],
      [
        "AI command execution never opted into",
        { enableAiCommandExecution: undefined },
      ],
      [
        "both retired switches off",
        { enableAutoRemediation: false, enableAiCommandExecution: false },
      ],
    ])(
      "goes to the engine when the row still carries %s — the retired switches mean nothing",
      async (_label: string, stale: Record<string, unknown>) => {
        serveSuggestion(suggestionRow(kind));
        serveProject({ id: PROJECT_ID, enableAi: true, ...stale });

        await run();

        expect(outcome()).toBe("engine");
      },
    );

    it("goes to the engine when Enable AI was not selected — it is off only when explicitly false", async () => {
      serveSuggestion(suggestionRow(kind));
      serveProject({ id: PROJECT_ID });

      await run();

      expect(outcome()).toBe("engine");
    });
  });

  it("gives a rule, a cluster and a resource round the same answer in every project state", async () => {
    const states: Array<[string, Record<string, unknown> | null]> = [
      ["on", { id: PROJECT_ID, enableAi: true }],
      ["not selected", { id: PROJECT_ID }],
      ["off", { id: PROJECT_ID, enableAi: false }],
      ["gone", null],
      [
        "on, retired switches off",
        {
          id: PROJECT_ID,
          enableAi: true,
          enableAutoRemediation: false,
          enableAiCommandExecution: false,
        },
      ],
      [
        "off, retired switches on",
        {
          id: PROJECT_ID,
          enableAi: false,
          enableAutoRemediation: true,
          enableAiCommandExecution: true,
        },
      ],
    ];

    const answers: Record<string, Record<RoundKind, Outcome>> = {};

    for (const [state, project] of states) {
      answers[state] = {} as Record<RoundKind, Outcome>;

      for (const kind of ROUND_KINDS) {
        suggestionCas.mockClear();
        executeRun.mockClear();
        serveSuggestion(suggestionRow(kind));
        serveProject(project);

        await run();

        answers[state]![kind] = outcome();
      }
    }

    expect(answers).toEqual({
      on: { rule: "engine", cluster: "engine", resource: "engine" },
      "not selected": {
        rule: "engine",
        cluster: "engine",
        resource: "engine",
      },
      off: {
        rule: AI_DISABLED_MESSAGE,
        cluster: AI_DISABLED_MESSAGE,
        resource: AI_DISABLED_MESSAGE,
      },
      gone: {
        rule: AI_DISABLED_MESSAGE,
        cluster: AI_DISABLED_MESSAGE,
        resource: AI_DISABLED_MESSAGE,
      },
      "on, retired switches off": {
        rule: "engine",
        cluster: "engine",
        resource: "engine",
      },
      "off, retired switches on": {
        rule: AI_DISABLED_MESSAGE,
        cluster: AI_DISABLED_MESSAGE,
        resource: AI_DISABLED_MESSAGE,
      },
    });
  });

  describe("what is checked before the gate still wins over it", () => {
    it("a round whose cluster was deleted while it waited is closed as such with AI off — never blamed on the switch", async () => {
      // The delete nulled the cluster id; a cluster round never had a rule.
      serveSuggestion(
        suggestionRow("cluster", { kubernetesClusterId: undefined }),
      );
      serveProject({ id: PROJECT_ID, enableAi: false });

      await run();

      expect(executeRun).not.toHaveBeenCalled();
      expect(projectRead).not.toHaveBeenCalled();
      const rationale: Outcome = outcome();
      expect(rationale).toBe(
        'The Kubernetes cluster "prod-us" was deleted before OneUptime AI could remediate it. Nothing was run or proposed.',
      );
      expect(rationale).not.toContain("AI was disabled");
    });

    it("a retried run whose earlier attempt already executed commands settles what ran with AI off — the gate never hides executed commands", async () => {
      serveSuggestion(
        suggestionRow("rule", { commandPlan: executedPlanJson() }),
      );
      serveProject({ id: PROJECT_ID, enableAi: false });

      await run();

      expect(executeRun).not.toHaveBeenCalled();
      expect(projectRead).not.toHaveBeenCalled();
      expect(suggestionCas).toHaveBeenCalledTimes(1);
      const set: { status: string; rationaleMarkdown: string } = (
        suggestionCas.mock.calls[0]![0] as {
          set: { status: string; rationaleMarkdown: string };
        }
      ).set;
      expect(set.status).toBe(AutoRemediationSuggestionStatus.AutoExecuted);
      expect(set.rationaleMarkdown).toContain("interrupted");
      expect(set.rationaleMarkdown).not.toContain("AI was disabled");
    });

    it("negative control: a rule round whose rule was deleted, with AI off, is refused by the gate — the rule is never read", async () => {
      serveSuggestion(suggestionRow("rule"));
      serveProject({ id: PROJECT_ID, enableAi: false });
      ruleRead.mockResolvedValue(null);

      await run();

      expect(ruleRead).not.toHaveBeenCalled();
      expect(outcome()).toBe(AI_DISABLED_MESSAGE);
    });
  });
});
