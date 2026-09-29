import RemediationExecutionRunner, {
  ResourceBreakerState,
  ResourceModeResolution,
  isClusterRemediationRound,
  isResourceRemediationRound,
} from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import { ConfidenceSignal } from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import {
  ObservabilityAssistantExtraTool,
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
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
import { MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR } from "../../../../Server/Services/AutoRemediationRuleEngineService";
import PostedRootCause from "../../../../Server/Utils/AI/SRE/PostedRootCause";
import logger from "../../../../Server/Utils/Logger";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import RunnerJob from "../../../../Models/DatabaseModels/RunnerJob";
import AutoRemediationExecutionMode from "../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
  AiRemediationRollbackStatus,
  RESOURCE_UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiAgentPosture,
  ResourceAiRemediationMode,
  ResourceCommandTier,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import RunnerJobStatus from "../../../../Types/Runbook/RunnerJobStatus";
import {
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
} from "../../../../Server/Utils/AI/ResourceAccess/ResourceAccessToolNames";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import OneUptimeDate from "../../../../Types/Date";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — a RESOURCE round of RemediationExecutionRunner
 * (remediation a resource's AI agent page asked for: a Docker or Podman
 * host, a Docker Swarm, Proxmox, VMware or Ceph cluster, a database server,
 * a host), built beside the cluster round and mirroring it:
 *
 * - the round is read off the suggestion row (a resource, no rule); its
 *   consent is the resource's own, so the project's AI command execution
 *   opt-in does not gate it, while Enable AI / auto-remediation still do;
 * - the resource is re-read at the start and must be remediation-ready; a
 *   deleted or no-longer-ready resource settles NoneApplicable with why;
 * - the mode is resolved exactly like a cluster's: a FullAuto snapshot runs
 *   unattended only while the resource's mode still is unattended, its
 *   hourly breaker has headroom and no other round holds it — each
 *   downgrade corrects the row, posts to the feed and opens the rationale;
 * - the model gets the resource toolkit (ResourceCommand on this resource
 *   only) plus the read-only infrastructure tool, a persona and a question
 *   that name the resource and its programs, and a context block for it;
 * - an unattended round that ran nothing but kept changes for a human
 *   settles Suggested with exactly those — after re-checking the resource
 *   live (ready, same agent, the agent's write scope) — else NoneApplicable;
 * - earlier rounds on the same resource for the same signal are shown.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const OTHER_SUGGESTION_ID: ObjectID = new ObjectID(
  "79797979-7979-4979-8979-797979797979",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const AGENT_ID: string = "44444444-4444-4444-8444-444444444444";
const OTHER_AGENT_ID: string = "45454545-4545-4545-8545-454545454545";
const JOB_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

function posture(
  overrides: Partial<ResourceAiAgentPosture> = {},
): ResourceAiAgentPosture {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "web-1",
    allowWrites: true,
    writeTargets: [],
    protectedTargets: [],
    reachable: true,
    ...overrides,
  };
}

function resource(
  overrides: Partial<ResourceAiAccessStatus> = {},
  postureOverrides: Partial<ResourceAiAgentPosture> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID.toString(),
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.Automatic,
    aiCommandAllowlist: [],
    agent: {
      agentId: AGENT_ID,
      connectionStatus: "connected",
      isOnline: true,
      posture: posture(postureOverrides),
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
    ...overrides,
  };
}

// The suggestion row as the database holds it: a resource round.
function resourceRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    status: AutoRemediationSuggestionStatus.Planning,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    executionMode: AutoRemediationExecutionMode.FullAuto,
    autoResolveOnRecovery: true,
    incidentId: INCIDENT_ID,
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    ruleNameSnapshot: 'AI remediation for Docker host "web-1"',
    verificationWindowMinutes: 15,
    createdAt: OneUptimeDate.getSomeMinutesAgo(1),
    ...overrides,
  };
}

function mockSuggestionHonouringSelect(
  row: Record<string, unknown>,
): jest.SpyInstance {
  return jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockImplementation(
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

function captureRequest(): { get: () => InvestigationRequest } {
  const captured: { value: InvestigationRequest | null } = { value: null };

  jest
    .spyOn(AIInvestigationEngine, "executeRun")
    .mockImplementation(
      async (data: { request: InvestigationRequest }): Promise<void> => {
        captured.value = data.request;
      },
    );

  return {
    get: (): InvestigationRequest => {
      expect(captured.value).not.toBeNull();
      return captured.value!;
    },
  };
}

function toolNames(request: InvestigationRequest): Array<string> {
  return (request.extraTools || []).map(
    (tool: ObservabilityAssistantExtraTool) => {
      return tool.definition.name;
    },
  );
}

function findTool(
  request: InvestigationRequest,
  name: string,
): ObservabilityAssistantExtraTool {
  const tool: ObservabilityAssistantExtraTool | undefined = (
    request.extraTools || []
  ).find((candidate: ObservabilityAssistantExtraTool) => {
    return candidate.definition.name === name;
  });
  expect(tool).toBeDefined();
  return tool!;
}

function postAnalysisArgs(analysisMarkdown: string): {
  analysisMarkdown: string;
  confidence: ConfidenceSignal;
  result: ObservabilityAssistantResult;
} {
  return {
    analysisMarkdown,
    confidence: {
      confident: true,
      source: "classification",
    } as ConfidenceSignal,
    result: {} as ObservabilityAssistantResult,
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

function resourceArgs(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return {
    stepType: "ResourceCommand",
    resourceId: RESOURCE_ID.toString(),
    command: "docker restart web",
    rationale: "the web container is wedged",
    expectedEffect: "web serves again",
    ...overrides,
  } as JSONObject;
}

describe("resource round classification", () => {
  it("a suggestion that names a resource and no rule is a resource round, never a cluster one", () => {
    expect(
      isResourceRemediationRound({
        resourceType: AiResourceType.Host,
        resourceId: RESOURCE_ID,
      }),
    ).toBe(true);
    expect(
      isClusterRemediationRound({
        resourceType: AiResourceType.Host,
        resourceId: RESOURCE_ID,
      } as never),
    ).toBe(false);
  });

  it.each([
    [
      "a rule round",
      {
        resourceType: AiResourceType.Host,
        resourceId: RESOURCE_ID,
        autoRemediationRuleId: ObjectID.generate(),
      },
    ],
    ["a row without a type", { resourceId: RESOURCE_ID }],
    ["a row without an id", { resourceType: AiResourceType.Host }],
    ["a cluster round", { kubernetesClusterId: ObjectID.generate() }],
  ])(
    "%s is not a resource round",
    (_label: string, row: Record<string, unknown>) => {
      expect(isResourceRemediationRound(row as never)).toBe(false);
    },
  );
});

describe("RemediationExecutionRunner.checkProjectGates for a resource round", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not need the AI command execution opt-in, but still needs AI and auto-remediation", async () => {
    const project: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({
        enableAi: true,
        enableAutoRemediation: true,
        enableAiCommandExecution: false,
      } as unknown as Project);

    expect(
      await RemediationExecutionRunner.checkProjectGates({
        projectId: PROJECT_ID,
        isClusterRound: false,
        isResourceRound: true,
      }),
    ).toBeNull();

    // A rule round in the same project is still stopped by the opt-in.
    expect(
      await RemediationExecutionRunner.checkProjectGates({
        projectId: PROJECT_ID,
        isClusterRound: false,
      }),
    ).toContain("AI command execution is not enabled");

    project.mockResolvedValue({
      enableAi: false,
      enableAutoRemediation: true,
    } as unknown as Project);

    expect(
      await RemediationExecutionRunner.checkProjectGates({
        projectId: PROJECT_ID,
        isClusterRound: false,
        isResourceRound: true,
      }),
    ).toContain("AI or auto-remediation was disabled");
  });
});

describe("RemediationExecutionRunner.resolveResourceMode", () => {
  let countBy: jest.SpyInstance;
  let jobFindBy: jest.SpyInstance;
  let suggestionFindBy: jest.SpyInstance;

  function suggestion(
    executionMode: AutoRemediationExecutionMode,
  ): AutoRemediationSuggestion {
    return {
      id: SUGGESTION_ID,
      projectId: PROJECT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
      executionMode,
      createdAt: OneUptimeDate.getSomeMinutesAgo(1),
    } as unknown as AutoRemediationSuggestion;
  }

  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    countBy = jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jobFindBy = jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
    suggestionFindBy = jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("a Suggest snapshot asks, without reading the breaker", async () => {
    const resolution: ResourceModeResolution =
      await RemediationExecutionRunner.resolveResourceMode({
        suggestion: suggestion(AutoRemediationExecutionMode.Suggest),
        resource: resource({
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        }),
      });

    expect(resolution.mode).toBe("Suggest");
    expect(resolution.downgradedByModeChange).toBe(false);
    expect(countBy).not.toHaveBeenCalled();
  });

  it.each([
    ResourceAiRemediationMode.Automatic,
    ResourceAiRemediationMode.BypassApproval,
  ])(
    "a FullAuto snapshot on a %s resource with headroom and no hold runs FullAuto",
    async (mode: ResourceAiRemediationMode) => {
      const resolution: ResourceModeResolution =
        await RemediationExecutionRunner.resolveResourceMode({
          suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
          resource: resource({ aiRemediationMode: mode }),
        });

      expect(resolution).toMatchObject({
        mode: "FullAuto",
        downgradedByCircuitBreaker: false,
        downgradedByModeChange: false,
        downgradedByInFlightRound: false,
        autoExecutedInWindow: 0,
      });
      // The breaker and the hold read the resource, never a cluster.
      expect(
        (countBy.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
      ).toMatchObject({
        resourceType: AiResourceType.DockerHost,
        resourceId: RESOURCE_ID,
      });
      expect(jobFindBy).toHaveBeenCalledTimes(2);
    },
  );

  it("downgrades a FullAuto snapshot when the operator moved the resource to ask for approval", async () => {
    const resolution: ResourceModeResolution =
      await RemediationExecutionRunner.resolveResourceMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        resource: resource({
          aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
        }),
      });

    expect(resolution.mode).toBe("Suggest");
    expect(resolution.downgradedByModeChange).toBe(true);
    expect(countBy).not.toHaveBeenCalled();
  });

  it("downgrades when the hourly breaker tripped, even under Bypass approval", async () => {
    countBy.mockResolvedValue(
      new PositiveNumber(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR),
    );

    const resolution: ResourceModeResolution =
      await RemediationExecutionRunner.resolveResourceMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        resource: resource({
          aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
        }),
      });

    expect(resolution).toMatchObject({
      mode: "Suggest",
      downgradedByCircuitBreaker: true,
      breakerCheckFailed: false,
      autoExecutedInWindow: MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR,
    });
  });

  it("downgrades when the breaker cannot be checked", async () => {
    countBy.mockRejectedValue(new Error("db down"));

    const resolution: ResourceModeResolution =
      await RemediationExecutionRunner.resolveResourceMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        resource: resource(),
      });

    expect(resolution).toMatchObject({
      mode: "Suggest",
      downgradedByCircuitBreaker: true,
      breakerCheckFailed: true,
    });
  });

  it("downgrades when another round holds the resource, and names it", async () => {
    suggestionFindBy.mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;
        if (typeof query["status"] === "string") {
          return [];
        }
        return [
          {
            id: OTHER_SUGGESTION_ID,
            status: AutoRemediationSuggestionStatus.AutoExecuted,
            verificationStatus: AutoRemediationVerificationStatus.Pending,
            verificationDeadlineAt: OneUptimeDate.addRemoveMinutes(
              OneUptimeDate.getCurrentDate(),
              5,
            ),
            ruleNameSnapshot: 'AI remediation for Docker host "web-1"',
          } as unknown as AutoRemediationSuggestion,
        ];
      },
    );

    const resolution: ResourceModeResolution =
      await RemediationExecutionRunner.resolveResourceMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        resource: resource(),
      });

    expect(resolution.mode).toBe("Suggest");
    expect(resolution.downgradedByInFlightRound).toBe(true);
    expect(resolution.inFlightRound).toMatchObject({
      suggestionId: OTHER_SUGGESTION_ID.toString(),
      description: "applied a fix that is still being verified",
    });
  });

  it("downgrades when the hold cannot be checked", async () => {
    jobFindBy
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("db down"));

    const resolution: ResourceModeResolution =
      await RemediationExecutionRunner.resolveResourceMode({
        suggestion: suggestion(AutoRemediationExecutionMode.FullAuto),
        resource: resource(),
      });

    expect(resolution).toMatchObject({
      mode: "Suggest",
      downgradedByInFlightRound: true,
      inFlightRound: null,
    });
  });

  it("delegates the breaker to the rule engine's resource breaker", async () => {
    const state: ResourceBreakerState =
      await RemediationExecutionRunner.getResourceBreakerState({
        resourceType: AiResourceType.Host,
        resourceId: RESOURCE_ID.toString(),
      });

    expect(state).toEqual({ autoExecutedInWindow: 0, hasHeadroom: true });
  });
});

describe("RemediationExecutionRunner.executeRemediation — resource rounds", () => {
  let suggestionCas: jest.SpyInstance;
  let suggestionUpdate: jest.SpyInstance;
  let incidentFeed: jest.SpyInstance;
  let statusForResource: jest.SpyInstance;
  let countBy: jest.SpyInstance;
  let suggestionFindBy: jest.SpyInstance;
  let enqueue: jest.SpyInstance;
  let project: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);
    jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);
    suggestionCas = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);
    suggestionUpdate = jest
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    incidentFeed = jest
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
    // The project did NOT opt into AI command execution: a resource round does not need it.
    project = jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: PROJECT_ID,
      enableAi: true,
      enableAutoRemediation: true,
      enableAiCommandExecution: false,
    } as unknown as Project);
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      id: INCIDENT_ID,
      title: "web-1 keeps exiting",
      description: "OOMKilled",
      incidentNumber: 7,
    } as unknown as Incident);
    jest.spyOn(PostedRootCause, "getForSubject").mockResolvedValue(null);
    suggestionFindBy = jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([]);
    countBy = jest
      .spyOn(AutoRemediationSuggestionService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    statusForResource = jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockResolvedValue(resource());
    jest
      .spyOn(ResourceAiAccessService, "recordCommandOutcome")
      .mockResolvedValue(undefined);
    enqueue = jest
      .spyOn(RunnerJobService, "enqueueAiResourceCommand")
      .mockResolvedValue({
        id: JOB_ID,
        status: RunnerJobStatus.Pending,
        payload: { displayCommand: "docker restart web", program: "docker" },
      } as unknown as RunnerJob);
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue({
      id: JOB_ID,
      status: RunnerJobStatus.Succeeded,
      exitCode: 0,
      output: "web",
    } as unknown as RunnerJob);
    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({ id: "lock" } as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("runs an Automatic resource's round FullAuto with the resource toolkit, the read tool, the persona and the context", async () => {
    const findOneById: jest.SpyInstance =
      mockSuggestionHonouringSelect(resourceRow());
    const ruleRead: jest.SpyInstance = jest.spyOn(
      AutoRemediationRuleService,
      "findOneById",
    );
    const clusterRead: jest.SpyInstance = jest.spyOn(
      KubernetesClusterAiAccessService,
      "getStatusForCluster",
    );
    const request: { get: () => InvestigationRequest } = captureRequest();

    await run();

    const select: Record<string, boolean> = (
      findOneById.mock.calls[0]![0] as { select: Record<string, boolean> }
    ).select;
    expect(select["resourceType"]).toBe(true);
    expect(select["resourceId"]).toBe(true);

    expect(statusForResource).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
    });
    expect(ruleRead).not.toHaveBeenCalled();
    expect(clusterRead).not.toHaveBeenCalled();

    expect(toolNames(request.get()).sort()).toEqual(
      [
        "list_command_targets",
        "execute_remediation_command",
        LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
        RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
      ].sort(),
    );
    expect(request.get().personaOverride).toContain(
      "turned on Automatic remediation",
    );
    expect(request.get().personaOverride).toContain('Docker host "web-1"');
    expect(request.get().questionOverride).toContain(
      'A signal has been declared on Docker host "web-1"',
    );
    expect(request.get().questionOverride).toContain("docker");

    const context: string = request.get().contextSummary || "";
    expect(context).toContain("# The resource");
    expect(context).toContain(
      `Docker host "web-1" (resourceId: ${RESOURCE_ID.toString()}), reached through its Docker AI agent (programs: docker)`,
    );
    expect(context).toContain("Remediation mode: Automatic");
    expect(context).toContain(
      "An unattended run becomes a proposal when the hourly per-resource circuit breaker trips",
    );
    expect(context).toContain("Where the Docker AI agent writes:");
    expect(context).toContain("You may execute at most 5 commands");
    expect(context).not.toContain("Matched auto-remediation rule");
    expect(context).not.toContain("downgraded");

    // Headroom: nothing to correct on the row, nothing on the feed.
    expect(incidentFeed).not.toHaveBeenCalled();
    expect(suggestionUpdate).not.toHaveBeenCalled();
  });

  it("runs a RequireApproval resource's round as a plan for approval", async () => {
    mockSuggestionHonouringSelect(
      resourceRow({ executionMode: AutoRemediationExecutionMode.Suggest }),
    );
    statusForResource.mockResolvedValue(
      resource({
        aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
      }),
    );
    const request: { get: () => InvestigationRequest } = captureRequest();

    await run();

    expect(toolNames(request.get())).toContain("propose_remediation_commands");
    expect(toolNames(request.get())).not.toContain(
      "execute_remediation_command",
    );
    expect(request.get().personaOverride).toContain("REMEDIATION PLANNING");
    expect(request.get().questionOverride).toContain(
      "compose a plan for human approval",
    );
    expect(request.get().contextSummary).toContain(
      "Remediation mode: a human approves",
    );
  });

  it("runs a BypassApproval resource with the bypass persona and question", async () => {
    mockSuggestionHonouringSelect(resourceRow());
    statusForResource.mockResolvedValue(
      resource({
        aiRemediationMode: ResourceAiRemediationMode.BypassApproval,
      }),
    );
    const request: { get: () => InvestigationRequest } = captureRequest();

    await run();

    expect(request.get().personaOverride).toContain(
      "chose to bypass approvals entirely",
    );
    expect(request.get().questionOverride).toContain(
      "its operator bypassed approvals",
    );
    expect(request.get().contextSummary).toContain(
      "Remediation mode: Bypass approval",
    );
  });

  it("is stopped by the project kill switches like every round", async () => {
    mockSuggestionHonouringSelect(resourceRow());
    project.mockResolvedValue({
      enableAi: true,
      enableAutoRemediation: false,
    } as unknown as Project);
    const executeRun: jest.SpyInstance = jest.spyOn(
      AIInvestigationEngine,
      "executeRun",
    );

    await run();

    expect(executeRun).not.toHaveBeenCalled();
    expect(suggestionCas.mock.calls[0]![0]).toMatchObject({
      set: { status: AutoRemediationSuggestionStatus.NoneApplicable },
    });
  });

  it.each([
    [
      "no longer ready",
      resource({
        isRemediationReady: false,
        gaps: [
          {
            code: "remediation_write_access_missing",
            title: "The Docker AI agent is read-only",
            nextStep: "Set ONEUPTIME_AI_ALLOW_WRITES=true.",
            blocksInvestigation: false,
            blocksRemediation: true,
          },
        ],
      }),
      'OneUptime AI can no longer remediate Docker host "web-1": The Docker AI agent is read-only.',
    ],
    [
      "deleted",
      null,
      'OneUptime AI can no longer remediate Docker host "(deleted)".',
    ],
  ])(
    "settles NoneApplicable, naming why, when the resource is %s",
    async (
      _label: string,
      status: ResourceAiAccessStatus | null,
      expected: string,
    ) => {
      mockSuggestionHonouringSelect(resourceRow());
      statusForResource.mockResolvedValue(status);
      const executeRun: jest.SpyInstance = jest.spyOn(
        AIInvestigationEngine,
        "executeRun",
      );

      await run();

      expect(executeRun).not.toHaveBeenCalled();
      const set: Record<string, unknown> = (
        suggestionCas.mock.calls[0]![0] as { set: Record<string, unknown> }
      ).set;
      expect(set["status"]).toBe(
        AutoRemediationSuggestionStatus.NoneApplicable,
      );
      expect(set["rationaleMarkdown"]).toContain(expected);
      expect(set["rationaleMarkdown"]).toContain(
        "Review the Docker host's AI agent page (AI → AI agent).",
      );
    },
  );

  it("a breaker downgrade corrects the row, tells the human on the feed and opens the rationale", async () => {
    mockSuggestionHonouringSelect(resourceRow());
    countBy.mockResolvedValue(
      new PositiveNumber(MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR),
    );
    const request: { get: () => InvestigationRequest } = captureRequest();

    await run();

    expect(toolNames(request.get())).toContain("propose_remediation_commands");
    expect(suggestionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SUGGESTION_ID,
        data: {
          executionMode: AutoRemediationExecutionMode.Suggest,
          autoResolveOnRecovery: false,
        },
      }),
    );
    const markdown: string = (
      incidentFeed.mock.calls[0]![0] as { feedInfoInMarkdown: string }
    ).feedInfoInMarkdown;
    expect(markdown).toContain(
      'AI remediation for Docker host "web-1": the hourly circuit breaker tripped',
    );
    expect(markdown).toContain(
      `Docker host "web-1" already had ${MAX_AUTO_EXECUTIONS_PER_RULE_PER_HOUR} unattended AI fix(es)`,
    );
    expect(request.get().contextSummary).toContain(
      'This round was downgraded to approval: The hourly circuit breaker for Docker host "web-1" tripped',
    );

    // The note opens the rationale when the round settles.
    await request.get().postAnalysis!(postAnalysisArgs("**Summary** nothing"));
    const set: Record<string, unknown> = (
      suggestionCas.mock.calls[0]![0] as { set: Record<string, unknown> }
    ).set;
    expect(set["rationaleMarkdown"]).toMatch(
      /^The hourly circuit breaker for Docker host "web-1" tripped/,
    );
  });

  it("a mode change after the announcement is its own downgrade", async () => {
    mockSuggestionHonouringSelect(resourceRow());
    statusForResource.mockResolvedValue(
      resource({
        aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
      }),
    );
    captureRequest();

    await run();

    const markdown: string = (
      incidentFeed.mock.calls[0]![0] as { feedInfoInMarkdown: string }
    ).feedInfoInMarkdown;
    expect(markdown).toContain(
      'The AI remediation mode of Docker host "web-1" was changed to "Ask for approval"',
    );
  });

  it("settles AutoExecuted with verification once the round ran a change", async () => {
    mockSuggestionHonouringSelect(resourceRow());
    const request: { get: () => InvestigationRequest } = captureRequest();

    await run();

    const outcome: ToolCallOutcome = await findTool(
      request.get(),
      "execute_remediation_command",
    ).execute(resourceArgs());
    expect(outcome.success).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);

    await request.get().postAnalysis!(
      postAnalysisArgs("**Summary** restarted web"),
    );

    const cas: Record<string, unknown> = suggestionCas.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(cas["fromStatus"]).toBe(AutoRemediationSuggestionStatus.Planning);
    const set: Record<string, unknown> = cas["set"] as Record<string, unknown>;
    expect(set["status"]).toBe(AutoRemediationSuggestionStatus.AutoExecuted);
    expect(set["verificationStatus"]).toBe(
      AutoRemediationVerificationStatus.Pending,
    );
    const plan: AiRemediationCommandPlan = AiRemediationCommandPlanUtil.parse(
      set["commandPlan"] as JSONObject,
    )!;
    expect(plan.commands[0]).toMatchObject({
      stepType: RunbookStepType.ResourceCommand,
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID.toString(),
      runnerId: AGENT_ID,
    });
    expect(plan.commands[0]!.execution?.status).toBe(
      AiRemediationCommandExecutionStatus.Succeeded,
    );

    const markdowns: Array<string> = incidentFeed.mock.calls.map(
      (call: Array<unknown>): string => {
        return (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
      },
    );
    expect(markdowns[markdowns.length - 1]).toContain(
      'AI remediation for Docker host "web-1": AI executed 1 command(s).',
    );
    expect(markdowns.join("\n")).not.toContain("Auto Remediation Rule");
  });

  it("an unattended round that ran nothing proposes exactly the changes it kept for a human", async () => {
    mockSuggestionHonouringSelect(resourceRow());
    const request: { get: () => InvestigationRequest } = captureRequest();

    await run();

    const refused: ToolCallOutcome = await findTool(
      request.get(),
      "execute_remediation_command",
    ).execute(
      resourceArgs({
        command: "docker stop web",
        rollbackCommand: "docker start web",
      }),
    );
    expect(refused.success).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();

    await request.get().postAnalysis!(postAnalysisArgs("**Summary** stop it"));

    // The row stops claiming an unattended round before it is proposed.
    expect(suggestionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          executionMode: AutoRemediationExecutionMode.Suggest,
          autoResolveOnRecovery: false,
        },
      }),
    );

    const set: Record<string, unknown> = (
      suggestionCas.mock.calls[0]![0] as { set: Record<string, unknown> }
    ).set;
    expect(set["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);
    expect(set["rationaleMarkdown"]).toContain(
      "OneUptime AI did not run the following change(s) on its own",
    );
    expect(set["rationaleMarkdown"]).not.toContain("kubectl");
    const plan: AiRemediationCommandPlan = AiRemediationCommandPlanUtil.parse(
      set["commandPlan"] as JSONObject,
    )!;
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0]).toMatchObject({
      sequence: 1,
      stepType: RunbookStepType.ResourceCommand,
      command: "docker stop web",
      rollbackCommand: "docker start web",
      resourceCommandTier: ResourceCommandTier.RiskyWrite,
      policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
      runnerId: AGENT_ID,
    });

    const markdowns: Array<string> = incidentFeed.mock.calls.map(
      (call: Array<unknown>): string => {
        return (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
      },
    );
    expect(markdowns[markdowns.length - 1]).toContain(
      "AI needs your approval for 1 change(s) it did not run on its own",
    );
  });

  it.each([
    [
      "stopped allowing remediation",
      resource({ isRemediationReady: false }),
      'Docker host "web-1" stopped allowing AI remediation during this round',
    ],
    [
      "is reached through another agent",
      resource({
        agent: {
          agentId: OTHER_AGENT_ID,
          connectionStatus: "connected",
          isOnline: true,
          posture: posture(),
        },
      }),
      "is no longer reached through the Docker AI agent this round composed its changes for",
    ],
    [
      "has an agent that would refuse the change",
      resource({}, { protectedTargets: ["web"] }),
      'The Docker AI agent of Docker host "web-1" would refuse every change this round kept',
    ],
    ["was deleted", null, 'Docker host "web-1" was deleted during this round'],
  ])(
    "proposes nothing when, at settle, the resource %s",
    async (
      _label: string,
      live: ResourceAiAccessStatus | null,
      expected: string,
    ) => {
      mockSuggestionHonouringSelect(resourceRow());
      const request: { get: () => InvestigationRequest } = captureRequest();

      await run();

      await findTool(request.get(), "execute_remediation_command").execute(
        resourceArgs({ command: "docker stop web" }),
      );

      statusForResource.mockResolvedValue(live);

      await request.get().postAnalysis!(postAnalysisArgs("**Summary** x"));

      const set: Record<string, unknown> = (
        suggestionCas.mock.calls[0]![0] as { set: Record<string, unknown> }
      ).set;
      expect(set["status"]).toBe(
        AutoRemediationSuggestionStatus.NoneApplicable,
      );
      expect(set["rationaleMarkdown"]).toContain(expected);
      expect(set["rationaleMarkdown"]).toContain(
        "Review the Docker host's AI agent page (AI → AI agent).",
      );
    },
  );

  it("shows the model the earlier rounds on this resource for this signal", async () => {
    mockSuggestionHonouringSelect(
      resourceRow({
        executionMode: AutoRemediationExecutionMode.Suggest,
        ruleNameSnapshot: 'AI remediation for Docker host "web-1" (round 2)',
      }),
    );
    suggestionFindBy.mockResolvedValue([
      {
        id: OTHER_SUGGESTION_ID,
        status: AutoRemediationSuggestionStatus.AutoExecuted,
        verificationStatus: AutoRemediationVerificationStatus.Failed,
        verificationNote: "Monitors still down.",
        commandPlan: {
          commands: [
            {
              sequence: 1,
              stepType: RunbookStepType.ResourceCommand,
              runnerId: AGENT_ID,
              runnerNameSnapshot: "Docker AI agent",
              resourceType: AiResourceType.DockerHost,
              resourceId: RESOURCE_ID.toString(),
              command: "docker restart web",
              rollbackCommand: "docker start web",
              timeoutInMs: 60000,
              rationale: "r",
              expectedEffect: "e",
              policyVerdict: AiRemediationCommandPolicyVerdict.AutoApproved,
              execution: {
                status: AiRemediationCommandExecutionStatus.Succeeded,
              },
              rollbackExecution: {
                status: AiRemediationCommandExecutionStatus.Failed,
              },
            },
          ],
          rollbackStatus: AiRemediationRollbackStatus.Failed,
        },
      } as unknown as AutoRemediationSuggestion,
    ]);
    const request: { get: () => InvestigationRequest } = captureRequest();

    await run();

    const context: string = request.get().contextSummary || "";
    expect(context).toContain(
      "# Previous remediation attempts on this Docker host for this signal",
    );
    expect(context).toContain("docker restart web");
    expect(context).toContain(
      `WARNING: this attempt's changes may STILL BE APPLIED on the Docker host — confirm the live state with ${RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME} before acting.`,
    );
    expect(context).toContain(
      `diagnose the Docker host as it is now (${RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME})`,
    );

    const previousQuery: Record<string, unknown> = suggestionFindBy.mock.calls
      .map((call: Array<unknown>) => {
        return (call[0] as { query: Record<string, unknown> }).query;
      })
      .find((query: Record<string, unknown>) => {
        return "incidentId" in query;
      }) as Record<string, unknown>;
    expect(previousQuery).toMatchObject({
      incidentId: INCIDENT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
    });
    expect(previousQuery["kubernetesClusterId"]).toBeUndefined();
  });

  it("the downgrade note names another round holding the resource", async () => {
    mockSuggestionHonouringSelect(resourceRow());
    suggestionFindBy.mockImplementation(
      async (args: unknown): Promise<Array<AutoRemediationSuggestion>> => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;
        if (typeof query["status"] === "string" || "incidentId" in query) {
          return [];
        }
        return [
          {
            id: OTHER_SUGGESTION_ID,
            status: AutoRemediationSuggestionStatus.Planning,
            executionMode: AutoRemediationExecutionMode.FullAuto,
            createdAt: OneUptimeDate.getSomeMinutesAgo(30),
            ruleNameSnapshot: 'AI remediation for Docker host "web-1"',
          } as unknown as AutoRemediationSuggestion,
        ];
      },
    );
    const request: { get: () => InvestigationRequest } = captureRequest();

    await run();

    expect(request.get().contextSummary).toContain(
      'another OneUptime AI round on Docker host "web-1" (AI remediation for Docker host "web-1") is still running unattended',
    );
    expect(request.get().contextSummary).toContain(
      "This round was downgraded to approval",
    );
    // A Suggest round's context no longer promises an unattended run.
    expect(request.get().contextSummary).not.toContain(
      RESOURCE_UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY,
    );
  });
});
