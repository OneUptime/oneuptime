import RemediationExecutionRunner from "../../../../Server/Utils/AI/Remediation/RemediationExecutionRunner";
import RemediationTrackRecordReader, {
  EarlierFix,
} from "../../../../Server/Utils/AI/Remediation/RemediationTrackRecordReader";
import CloudRoundContext from "../../../../Server/Utils/AI/Remediation/CloudRoundContext";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import { ConfidenceSignal } from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import {
  ObservabilityAssistantExtraTool,
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIRunService from "../../../../Server/Services/AIRunService";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import RunnerJobService from "../../../../Server/Services/RunnerJobService";
import { MessageBlocksByWorkspaceType } from "../../../../Server/Services/WorkspaceNotificationRuleService";
import RemediationChatMessage from "../../../../Server/Utils/AutoRemediation/RemediationChatMessage";
import CloudChangeDryRun from "../../../../Server/Utils/AutoRemediation/CloudChangeDryRun";
import PostedRootCause from "../../../../Server/Utils/AI/SRE/PostedRootCause";
import logger from "../../../../Server/Utils/Logger";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import AutoRemediationExecutionMode from "../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import {
  RemediationTrackRecord,
  RemediationTrackRecordOutcome,
} from "../../../../Types/AutoRemediation/RemediationTrackRecord";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import OneUptimeDate from "../../../../Types/Date";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - what RemediationExecutionRunner hands the planner
 * and the people about OneUptime AI's earlier fixes, and what it posts
 * when it proposes one:
 *
 *  - a resource round's context names the fixes OneUptime AI made before
 *    on that resource, for other incidents and alerts, read for that
 *    resource only and never the round's own suggestion or signal
 *    (RemediationTrackRecordReader.readEarlierFixes); a cluster round's,
 *    the ones on that cluster;
 *  - a cloud account's round also names what its signal is linked to in
 *    the account - its Cloud resources and App Platforms environments
 *    (CloudRoundContext); no other resource's round asks;
 *  - a proposal is stored with each change's track record, and the plan
 *    as stored is what the dry run checks and the feed shows;
 *  - the proposal's feed item carries the buttons to approve or dismiss it
 *    from Slack and Microsoft Teams (RemediationChatMessage); the other
 *    feed items of a round carry none.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const EARLIER_INCIDENT_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RESOURCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const AGENT_ID: string = "44444444-4444-4444-8444-444444444444";

// The blocks a proposal's message carries, as RemediationChatMessage builds them.
const PROPOSAL_BLOCKS: Array<MessageBlocksByWorkspaceType> = [
  { workspaceType: WorkspaceType.Slack, messageBlocks: [] },
];

function dockerHost(
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID.toString(),
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    agent: {
      agentId: AGENT_ID,
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
    ...overrides,
  };
}

function awsAccount(): ResourceAiAccessStatus {
  const status: ResourceAiAccessStatus = dockerHost({
    resourceType: AiResourceType.AwsAccount,
    resourceName: "prod",
  });

  status.agent!.posture = {
    ...status.agent!.posture!,
    resourceType: AiResourceType.AwsAccount,
    resourceIdentifier: "123456789012",
  };

  return status;
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    status: AutoRemediationSuggestionStatus.Planning,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    executionMode: AutoRemediationExecutionMode.Suggest,
    autoResolveOnRecovery: false,
    incidentId: INCIDENT_ID,
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    ruleNameSnapshot: 'AI remediation for Docker host "web-1"',
    verificationWindowMinutes: 15,
    createdAt: OneUptimeDate.getSomeMinutesAgo(1),
    ...overrides,
  };
}

function readsRow(data: Record<string, unknown>): void {
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockImplementation(
      async (args: unknown): Promise<AutoRemediationSuggestion> => {
        const select: Record<string, unknown> = (
          args as { select: Record<string, unknown> }
        ).select;
        const picked: Record<string, unknown> = { id: data["id"] };

        for (const key of Object.keys(select)) {
          if (key in data) {
            picked[key] = data[key];
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
    confidence: { confident: true, source: "classification" } as never,
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

function earlierFix(overrides: Partial<EarlierFix> = {}): EarlierFix {
  return {
    suggestionId: "99999999-9999-4999-8999-999999999999",
    subjectKind: "incident",
    subjectId: EARLIER_INCIDENT_ID,
    subjectNumber: "INC-12",
    subjectTitle: "web-1 down",
    ranAt: OneUptimeDate.getSomeMinutesAgo(30),
    outcome: RemediationTrackRecordOutcome.Worked,
    changes: [{ command: "docker restart web", key: null, ran: true }],
    wasRolledBack: false,
    ...overrides,
  };
}

const TRACK_RECORD: RemediationTrackRecord = {
  workedCount: 2,
  didNotWorkCount: 0,
  runs: [
    {
      subjectKind: "incident",
      subjectId: EARLIER_INCIDENT_ID,
      subjectNumber: "INC-12",
      ranAt: "2026-10-30T10:00:00.000Z",
      outcome: RemediationTrackRecordOutcome.Worked,
    },
  ],
};

let suggestionCas: jest.SpyInstance;
let incidentFeed: jest.SpyInstance;
let statusForResource: jest.SpyInstance;
let readEarlierFixes: jest.SpyInstance;
let describeLinkedCloudResources: jest.SpyInstance;
let withTrackRecords: jest.SpyInstance;
let proposalBlocks: jest.SpyInstance;
let startDryRun: jest.SpyInstance;

beforeEach(() => {
  startDryRun = jest
    .spyOn(CloudChangeDryRun, "startForProposedPlan")
    .mockImplementation((): void => {
      return undefined;
    });
  jest
    .spyOn(AIRunService, "attemptStatusTransition")
    .mockResolvedValue(1 as never);
  jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(undefined as never);
  suggestionCas = jest
    .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
    .mockResolvedValue(1 as never);
  jest
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

  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    id: PROJECT_ID,
    enableAi: true,
  } as unknown as Project);
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
    id: INCIDENT_ID,
    title: "web-1 keeps exiting",
    description: "OOMKilled",
    incidentNumber: 7,
  } as unknown as Incident);
  jest.spyOn(PostedRootCause, "getForSubject").mockResolvedValue(null);
  jest.spyOn(AutoRemediationSuggestionService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(AutoRemediationSuggestionService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(RunnerJobService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  statusForResource = jest
    .spyOn(ResourceAiAccessService, "getStatusForResource")
    .mockResolvedValue(dockerHost());
  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({ id: "lock" } as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

  readEarlierFixes = jest
    .spyOn(RemediationTrackRecordReader, "readEarlierFixes")
    .mockResolvedValue([]);
  describeLinkedCloudResources = jest
    .spyOn(CloudRoundContext, "describeLinkedCloudResources")
    .mockResolvedValue([]);
  withTrackRecords = jest
    .spyOn(RemediationTrackRecordReader, "withTrackRecords")
    .mockImplementation(
      async (data: {
        plan: AiRemediationCommandPlan;
      }): Promise<AiRemediationCommandPlan> => {
        return {
          ...data.plan,
          commands: data.plan.commands.map(
            (command: AiRemediationCommand): AiRemediationCommand => {
              return { ...command, trackRecord: TRACK_RECORD };
            },
          ),
        };
      },
    );
  proposalBlocks = jest
    .spyOn(RemediationChatMessage, "getProposalBlocks")
    .mockResolvedValue(PROPOSAL_BLOCKS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the fixes made before, in the planner's context", () => {
  it("a resource round names the fixes made on that resource, read for it alone and never for its own signal", async () => {
    readsRow(row());
    readEarlierFixes.mockResolvedValue([
      earlierFix(),
      earlierFix({
        suggestionId: "98989898-9898-4898-8898-989898989898",
        outcome: RemediationTrackRecordOutcome.DidNotWork,
        changes: [{ command: "docker stop web", key: null, ran: true }],
        wasRolledBack: true,
      }),
    ]);
    const request: { get: () => InvestigationRequest } = captureRequest();

    await run();

    expect(readEarlierFixes).toHaveBeenCalledTimes(1);
    expect(readEarlierFixes).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      target: {
        resourceType: AiResourceType.DockerHost,
        resourceId: RESOURCE_ID.toString(),
      },
      excludeSuggestionId: SUGGESTION_ID,
      excludeSubject: { incidentId: INCIDENT_ID, alertId: undefined },
    });

    const context: string = request.get().contextSummary || "";

    expect(context).toContain(
      "# Fixes OneUptime AI made on this Docker host before, for other incidents and alerts",
    );
    expect(context).toContain(
      "- Today, for incident INC-12 (web-1 down): WORKED (verified fixed).",
    );
    expect(context).toContain("  - ran docker restart web");
    expect(context).toContain(
      "DID NOT WORK (verification failed; it was rolled back)",
    );
    // After the resource and the earlier rounds of this signal.
    expect(context.indexOf("# Fixes OneUptime AI made")).toBeGreaterThan(
      context.indexOf("# The resource"),
    );
  });

  it("no earlier fix: the context has no such section", async () => {
    readsRow(row());
    const request: { get: () => InvestigationRequest } = captureRequest();

    await run();

    expect(request.get().contextSummary || "").not.toContain(
      "Fixes OneUptime AI made",
    );
  });

  it("a cluster round reads the fixes made on its cluster, and calls it a cluster", async () => {
    const suggestion: AutoRemediationSuggestion = {
      id: SUGGESTION_ID,
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      kubernetesClusterId: CLUSTER_ID,
    } as unknown as AutoRemediationSuggestion;
    readEarlierFixes.mockResolvedValue([earlierFix()]);

    // The round's context reads it the same way (buildExecutionContext).
    const lines: Array<string> = await (
      RemediationExecutionRunner as unknown as {
        describeEarlierFixes: (
          suggestion: AutoRemediationSuggestion,
        ) => Promise<Array<string>>;
      }
    ).describeEarlierFixes(suggestion);

    expect(readEarlierFixes).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kubernetesClusterId: CLUSTER_ID.toString() },
        excludeSuggestionId: SUGGESTION_ID,
      }),
    );
    expect(lines.join("\n")).toContain(
      "# Fixes OneUptime AI made on this cluster before",
    );
  });

  it("a rule's round names no one target, so nothing is read", async () => {
    const lines: Array<string> = await (
      RemediationExecutionRunner as unknown as {
        describeEarlierFixes: (
          suggestion: AutoRemediationSuggestion,
        ) => Promise<Array<string>>;
      }
    ).describeEarlierFixes({
      id: SUGGESTION_ID,
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      resourceType: AiResourceType.DockerHost,
      resourceId: RESOURCE_ID,
      autoRemediationRuleId: ObjectID.generate(),
    } as unknown as AutoRemediationSuggestion);

    expect(lines).toEqual([]);
    expect(readEarlierFixes).not.toHaveBeenCalled();
  });
});

describe("a cloud account's round names what its signal is linked to there", () => {
  it("the account's linked Cloud resources and App Platforms environments are in the context", async () => {
    readsRow(
      row({
        resourceType: AiResourceType.AwsAccount,
        ruleNameSnapshot: 'AI remediation for AWS account "prod"',
      }),
    );
    statusForResource.mockResolvedValue(awsAccount());
    describeLinkedCloudResources.mockResolvedValue([
      "",
      "# What this incident is linked to in this account",
      '- Cloud environment "checkout · us-east-1"',
    ]);
    const request: { get: () => InvestigationRequest } = captureRequest();

    await run();

    expect(describeLinkedCloudResources).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      cloudAccountId: RESOURCE_ID,
      incidentId: INCIDENT_ID,
      alertId: undefined,
    });
    expect(request.get().contextSummary).toContain(
      '# What this incident is linked to in this account\n- Cloud environment "checkout · us-east-1"',
    );
  });

  it("no other resource's round asks", async () => {
    readsRow(row());
    captureRequest();

    await run();

    expect(describeLinkedCloudResources).not.toHaveBeenCalled();
  });
});

describe("a proposal, with its track record and its buttons", () => {
  // A round that asks first: the plan it proposes, settled for approval.
  async function propose(): Promise<void> {
    readsRow(row());
    const request: { get: () => InvestigationRequest } = captureRequest();

    await run();

    await findTool(request.get(), "propose_remediation_commands").execute({
      commands: [
        {
          stepType: "ResourceCommand",
          resourceId: RESOURCE_ID.toString(),
          command: "docker restart web",
          rationale: "the web container is wedged",
          expectedEffect: "web serves again",
        },
      ],
    } as JSONObject);

    await request.get().postAnalysis!(postAnalysisArgs("**Summary** restart"));
  }

  it("is stored with each change's track record, and the plan as stored is what is dry-run and posted", async () => {
    await propose();

    expect(withTrackRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        excludeSuggestionId: SUGGESTION_ID,
        excludeSubject: { incidentId: INCIDENT_ID, alertId: undefined },
      }),
    );

    const set: Record<string, unknown> = (
      suggestionCas.mock.calls[0]![0] as { set: Record<string, unknown> }
    ).set;
    expect(set["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);

    const stored: AiRemediationCommandPlan = AiRemediationCommandPlanUtil.parse(
      set["commandPlan"] as JSONObject,
    )!;
    expect(stored.commands[0]!.command).toBe("docker restart web");
    expect(stored.commands[0]!.trackRecord).toEqual(TRACK_RECORD);

    const dryRun: { plan: AiRemediationCommandPlan } = startDryRun.mock
      .calls[0]![0] as { plan: AiRemediationCommandPlan };
    expect(dryRun.plan.commands[0]!.trackRecord).toEqual(TRACK_RECORD);
  });

  it("its feed item carries the buttons to approve or dismiss it from the chat", async () => {
    await propose();

    expect(proposalBlocks).toHaveBeenCalledTimes(1);

    const asked: {
      suggestion: AutoRemediationSuggestion;
      commandPlan: AiRemediationCommandPlan;
    } = proposalBlocks.mock.calls[0]![0] as {
      suggestion: AutoRemediationSuggestion;
      commandPlan: AiRemediationCommandPlan;
    };
    expect(asked.suggestion.id!.toString()).toBe(SUGGESTION_ID.toString());
    expect(asked.commandPlan.commands[0]!.trackRecord).toEqual(TRACK_RECORD);

    const withButtons: Array<JSONObject> = incidentFeed.mock.calls
      .map((call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      })
      .filter((item: JSONObject): boolean => {
        return Boolean(
          (item["workspaceNotification"] as JSONObject | undefined)?.[
            "appendMessageBlocks"
          ],
        );
      });

    expect(withButtons).toHaveLength(1);
    expect(withButtons[0]!["workspaceNotification"]).toEqual({
      sendWorkspaceNotification: true,
      appendMessageBlocks: PROPOSAL_BLOCKS,
    });
  });

  it("a round that ran on its own but kept a change for a human proposes it the same way", async () => {
    readsRow(
      row({
        executionMode: AutoRemediationExecutionMode.FullAuto,
        autoResolveOnRecovery: true,
      }),
    );
    statusForResource.mockResolvedValue(
      dockerHost({ aiRemediationMode: ResourceAiRemediationMode.Automatic }),
    );
    const request: { get: () => InvestigationRequest } = captureRequest();

    await run();

    // A risky change: never run unattended, kept for a human instead.
    await findTool(request.get(), "execute_remediation_command").execute({
      stepType: "ResourceCommand",
      resourceId: RESOURCE_ID.toString(),
      command: "docker stop web",
      rollbackCommand: "docker start web",
      rationale: "the web container is wedged",
      expectedEffect: "web serves again",
    } as JSONObject);

    await request.get().postAnalysis!(postAnalysisArgs("**Summary** stop it"));

    const set: Record<string, unknown> = (
      suggestionCas.mock.calls[0]![0] as { set: Record<string, unknown> }
    ).set;
    expect(set["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);
    expect(
      AiRemediationCommandPlanUtil.parse(set["commandPlan"] as JSONObject)!
        .commands[0]!.trackRecord,
    ).toEqual(TRACK_RECORD);
    expect(proposalBlocks).toHaveBeenCalledTimes(1);
    expect(
      incidentFeed.mock.calls.some((call: Array<unknown>): boolean => {
        const blocks: unknown = (
          call[0] as { workspaceNotification: JSONObject }
        ).workspaceNotification["appendMessageBlocks"];

        return blocks === PROPOSAL_BLOCKS;
      }),
    ).toBe(true);
  });

  it("no blocks to add: the feed item is posted as before", async () => {
    proposalBlocks.mockResolvedValue([]);

    await propose();

    for (const call of incidentFeed.mock.calls) {
      expect(
        (call[0] as { workspaceNotification: JSONObject })
          .workspaceNotification,
      ).not.toHaveProperty("appendMessageBlocks");
    }
  });
});
